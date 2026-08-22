/**
 * DownloadManager（v3 TypeScript 版，替代旧 public/js/download-manager.js）
 *
 * 职责（与旧版契约一致，供 backup-panel.content.ts 消费）：
 *   - 统一管理三种下载器任务（browser / disk / aria2）
 *   - 字节级进度、速度滑窗、ETA
 *   - 事件总线：task-added / task-updated / stats / log → 面板通过 subscribe() 订阅
 *   - 操作接口：retry / pauseAll / resumeAll / retryFailed / cancel / clear
 *   - 日志分级 INFO/WARN/ERROR，供「日志 Tab」展示与导出
 *
 * 进度来源：
 *   - browser：background 监听 chrome.downloads.onChanged 后广播
 *     browser_dl_created / browser_dl_progress（见 entrypoints/background.ts），本管理器直接监听
 *   - disk / aria2：由对应 driver 的 ProgressReporter 直接回报
 *
 * 挂载：由 engine-bridge.content.ts 实例化后挂到 window.QZoneDownloadManager，
 *       与旧版位置一致，确保 backup-panel 无需改动即可对接。
 */

import { hashString } from '../shared/utils';
import { LIMITS, TIMING } from '../shared/constants';
import { BG_MSG, DLEvent } from '../shared/messages';
import { BrowserDriver } from './drivers/browser';
import { DiskDriver } from './drivers/disk';
import { Aria2Driver } from './drivers/aria2';
import { extractHost, looksLikeRefererMissing } from './dnr-auto';
import { TaskQueue, type DownloadTask } from './task-queue';
import type { DownloadDriver, DriverType, ProgressReporter } from './drivers/types';
import type { FileWriter } from '../fs/writer';

export type TaskState = 'pending' | 'in_progress' | 'paused' | 'complete' | 'interrupted';

export interface LiveTask {
    id: string;
    state: TaskState;
    module: string;
    url: string;
    dir: string;
    name: string;
    trackerType: DriverType | 'none';
    ownerId?: string | number;
    ownerTitle?: string;
    thumbUrl?: string;
    downloadId?: number;
    aria2Gid?: string;
    totalBytes?: number;
    downloadedBytes?: number;
    speedSamples?: Array<{ t: number; bytes: number }>;
    error?: string;
    speedBps?: number;
    etaMs?: number;
    retries?: number;
    /** 下载优先级：数值越大越靠前下载（视频任务置 VIDEO_PRIORITY，普通媒体为 0）。
     *  视频直链有效期极短，需优先插队下载，避免排在海量图片之后排队等待期间链接过期失效 */
    priority?: number;
    _createdAt?: number;
    _order?: number;
    _src?: string;
    _lastSampleAt?: number;
    _lastSampleBytes?: number;
}

export interface DmLogEntry {
    ts: number;
    tsText: string;
    level: string;
    msg: string;
    message: string;
    extra?: unknown;
}

export type DmEvent = 'task-added' | 'task-updated' | 'stats' | 'log' | 'task-error';

export type DmEventPayload =
    | { type: 'task-added'; task: LiveTask }
    | { type: 'task-updated'; task: LiveTask }
    | { type: 'stats'; stats: Record<string, number> }
    | { type: 'log'; entry: DmLogEntry }
    // 操作（暂停/继续/取消）底层执行失败时的通知，供面板给出 UI 反馈
    | { type: 'task-error'; id: string; op: 'pause' | 'resume' | 'cancel'; error: string };

type Listener = (payload: unknown) => void;

const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

/** 视频任务优先级：高于普通媒体(0)，使其在并发槽释放时优先插队下载（视频直链有效期短） */
const VIDEO_PRIORITY = 1;

/** 是否为视频文件（按文件名/URL 后缀判定，用于下载优先级提升）。
 *  仅视频本体（mp4/m3u8/flv/ts/webm/mov/mkv/avi/wmv/m4v）提升，视频预览图(.jpeg)不提升 */
function isVideoName(name: string): boolean {
    const n = (name || '').toLowerCase();
    return n.endsWith('.mp4') || n.endsWith('.m3u8') || n.endsWith('.flv')
        || n.endsWith('.ts') || n.endsWith('.webm') || n.endsWith('.mov')
        || n.endsWith('.mkv') || n.endsWith('.avi') || n.endsWith('.wmv') || n.endsWith('.m4v');
}

function pad(n: number, w = 2): string {
    return String(n).padStart(w, '0');
}
function fmtTs(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
function normalizeState(s: string): TaskState {
    const v = String(s || '').toLowerCase();
    if (v === 'inprogress' || v === 'downloading') return 'in_progress';
    if (v === 'complete' || v === 'done') return 'complete';
    if (v === 'interrupted' || v === 'error' || v === 'fail') return 'interrupted';
    if (v === 'paused') return 'paused';
    return 'pending';
}
/**
 * 全局进度快照。**完成判定的唯一权威来源**。
 *
 * 三套口径各司其职，不要混用：
 *  - `percent` / `succeeded`：「成功完成度」，只算真正落盘成功的，失败不虚高。
 *  - `settledPercent` / `settled`：「处理进度」，成功与失败都算「有结论」，
 *    用于回答「下载环节结束了没」——全部跑完（哪怕全失败）也会到 100%。
 *  - `failedPercent` / `failed`：失败规模，供进度条渲染红色失败段。
 *  - `overallPercent`：面板主数字口径 = 成功（字节比）+ 失败（满权重），
 *    兼顾「进行中平滑」与「结束必定 100%」，供用户直观判断整体进度。
 *
 * 判定是否结束请一律用 `isSettled`（计数比较），切勿用 `settledPercent >= 100`。
 */
export interface GlobalProgress {
    totalBytes: number;
    downloadedBytes: number;
    speedBps: number;
    etaMs?: number;
    /** 成功完成度（0-100）：complete 计满权重，in_progress/paused 按字节比，interrupted/pending 记 0 */
    percent: number;
    /** 已到终态（complete + interrupted）的任务数 */
    settled: number;
    /** 成功（complete）任务数 */
    succeeded: number;
    /** 失败（interrupted，含用户取消）任务数 */
    failed: number;
    /** 尚无结论（pending + in_progress + paused）的任务数。含 paused，避免暂停被误判为已结束 */
    unsettled: number;
    /** 排队中（pending）任务数 */
    pending: number;
    /** 下载中（in_progress）任务数 */
    running: number;
    /** 已暂停（paused）任务数 */
    paused: number;
    /**
     * 任务总数。
     *
     * 不变式（渲染层可据此断言，任意时刻恒成立）：
     *   `succeeded + failed + pending + running + paused === totalTasks`
     *   `succeeded + failed === settled`，`pending + running + paused === unsettled`
     *
     * 有了分项计数，UI 渲染路径不再需要额外调用 `stats()` —— 单次遍历即可
     * 覆盖顶栏 chip、进度条、横幅、媒体页签的全部计数需求，从根上杜绝
     * 「同一屏两个数字来自两次独立遍历」的口径漂移。
     */
    totalTasks: number;
    /** 处理进度（0-100）：已有结论的任务占比，全部跑完（含失败）即 100 */
    settledPercent: number;
    /** 失败任务占比（0-100）：percent + failedPercent ≈ settledPercent */
    failedPercent: number;
    /**
     * 【UI 主展示口径】总进度（0-100）：失败也算「已处理」，与 `percent` 的差别是
     * 把 interrupted 任务按满权重计入分子，因此下载环节结束后必定为 100%，
     * 不会出现「跑完了却卡在 97%」的观感问题。
     *
     * 与 `settledPercent` 的差别：进行中的任务按已下载字节比计入，因此数字连续
     * 平滑，而 settledPercent 是纯计数、只在任务出结论时阶跃。
     *
     * 不变式：`overallPercent ≈ percent + failedPercent`，且 `isSettled` 时恒为 100。
     */
    overallPercent: number;
    /** 【完成判定】下载环节是否已全部出结论（无任务视为已结束）。UI 应据此而非百分比判定完成 */
    isSettled: boolean;
}

/**
 * 展示用百分比（0-100）。
 *
 * `reached` 表示「按计数口径确实已达成」。未达成时上限钳到 99：
 * 否则 Math.round 会把 999/1000（99.9%）显示成 100%，UI 据此宣布
 * 「全部完成」，而实际还有任务未出结论 —— 即「假完成」。
 * 完成判定必须比计数（settled === total），百分比只负责展示。
 */
function displayPercent(part: number, total: number, reached: boolean): number {
    if (total <= 0) return 0;
    if (reached) return 100;
    const raw = Math.round((part / total) * 100);
    return Math.max(0, Math.min(99, raw));
}

function consoleFnForLevel(level: string): 'error' | 'warn' | 'info' | 'log' {
    const l = (level || 'INFO').toUpperCase();
    if (l === 'ERROR') return 'error';
    if (l === 'WARN') return 'warn';
    if (l === 'INFO') return 'info';
    return 'log';
}

export interface DownloadManagerOptions {
    writer?: FileWriter;
    aria2?: { host: string; token?: string; dir?: string };
    /** 任务完成时回调（用于标记已下载 URL，支撑断点去重）；dir 用于目录级去重 */
    onTaskComplete?: (url: string, dir?: string) => void;
    /** 所属 QQ 号，用于 TaskQueue 持久化索引（可选，稍后通过 setUin 设置亦可） */
    uin?: number | string;
}

export class DownloadManager {
    private readonly tasks = new Map<string, LiveTask>();
    private readonly listeners = new Map<DmEvent, Set<Listener>>();
    private readonly _dlIdToId = new Map<number, string>();
    private readonly _gidToId = new Map<string, string>();
    /** name → id 反向索引：避免浏览器下载进度回调时的 O(n) 遍历匹配 */
    private readonly _nameToId = new Map<string, string>();
    private _order = 0;
    private _logs: DmLogEntry[] = [];
    private _statsDirty = false;
    private drivers: Partial<Record<DriverType, DownloadDriver>> = {};
    private readonly writer?: FileWriter;
    private readonly options: DownloadManagerOptions;
    private queue: TaskQueue | null = null;

    /** 并发提交上限（对应 Options.downloadThread；<=0 视为 1） */
    private _maxConcurrent = 10;
    /** 每个任务提交之间的间隔毫秒（对应 Options.downloadSleep，默认 0） */
    private _submitIntervalMs = 0;
    /** 当前活跃（已占用并发槽、尚未进入终态）的提交数 */
    private _activeSubmits = 0;
    /** 等待并发槽的唤醒回调（携带优先级，高优先级插入队首，确保视频优先获槽） */
    private _submitWaiters: Array<{ resolve: () => void; prio: number; order: number }> = [];
    /** 当前持有并发槽、尚未到达终态的任务 id（用于终态时释放槽，避免重复释放） */
    private _heldSlots = new Set<string>();
    /** 停滞速度归零定时器（真实卡顿时将 speedBps 归零，避免显示冻结的旧速度） */
    private _staleSpeedTimer: ReturnType<typeof setInterval> | null = null;
    private readonly _STALE_SPEED_MS = 2500;
    /** 下载卡死超时：超过此时长仍无任何进度采样事件（含进度心跳），判为底层传输失联，
     *  强制转 interrupted 并释放并发槽，避免单点故障冻死整条下载流水线 */
    private readonly _STALE_TASK_MS = 180000;
    /** 卸载 runtime 进度监听的清理函数（F9：订阅 background 经 chrome.tabs.sendMessage 广播的进度） */
    private _browserRuntimeUnsub: (() => void) | null = null;
    /** 全局暂停标记：暂停期间不发起任何新下载（贯穿提交链路，含排队中任务） */
    private _paused = false;
    /** 重试进行中标记：防止「重试失败」被反复触发导致同一批任务重复 re-pend/重提交 */
    private _retrying = false;
    /** 提交重入守卫：记录正在提交/下载中的任务 id。同一 id 被重复调用 submitTask 时
     *  （采集器对同一条媒体任务跨页/跨模块重复 addMediaTask，upsert 去重成同一 id 后
     *  submitTask 被排两次）直接跳过，避免重复占用并发槽却只释放一次导致槽泄漏、
     *  有效并发塌缩成 1（表现为「进行中永远只有 1 个、待开始堆积如山」）。任务进入终态时清出。 */
    private _submitting = new Set<string>();

    /** Disk 模式失败自动注册 DNR：已注册 Referer 规则的 host（同 host 仅注册一次，避免重复 addRules） */
    private _autoDnrHosts = new Set<string>();
    /** 已自动重试过的任务 id（每个任务仅自动重试一次，避免重试仍失败时无限循环） */
    private _autoRetriedTasks = new Set<string>();

    constructor(opts: DownloadManagerOptions = {}) {
        this.options = opts;
        this.writer = opts.writer;
        if (opts.aria2) {
            this.drivers.aria2 = new Aria2Driver(opts.aria2);
        }
        this.drivers.browser = new BrowserDriver();
        if (this.writer) {
            this.drivers.disk = new DiskDriver(this.writer);
        }
        if (opts.uin != null) this.queue = new TaskQueue(opts.uin, (lvl, msg) => this.log(lvl, msg));
        this._installBrowserProgressListener();
        this._startStaleSpeedWatch();
    }

    /** 设置/更新持久化队列所属 QQ 号（DM 早于 uin 可用时构造，可稍后调用） */
    setUin(uin: number | string): void {
        if (uin == null) return;
        if (!this.queue || String(this.queue.uin) !== String(uin)) {
            this.queue = new TaskQueue(uin, (lvl, msg) => this.log(lvl, msg));
        }
    }

    /**
     * 设置并发提交上限（对应 Options.downloadThread）。
     * 该值限制同时处于「进行中」的下载任务数量，避免一次性发起海量下载
     * 拖垮浏览器/系统（旧版 _.chunk 分批并行语义）。<=0 视为 1。
     * 调大时会立即唤醒等待中的任务。
     */
    setConcurrencyLimit(n: number): void {
        this._maxConcurrent = Math.max(1, Number(n) || 1);
        // 放宽上限后，唤醒尽可能多的等待者
        while (this._submitWaiters.length && this._activeSubmits < this._maxConcurrent) {
            const next = this._submitWaiters.shift()!;
            this._activeSubmits++;
            if (this._submitIntervalMs > 0) setTimeout(() => next.resolve(), this._submitIntervalMs);
            else next.resolve();
        }
    }

    /** 设置每个任务提交之间的间隔毫秒（对应 Options.downloadSleep） */
    setSubmitIntervalMs(ms: number): void {
        this._submitIntervalMs = Math.max(0, Number(ms) || 0);
    }

    /** 获取当前并发上限（便于调试/展示） */
    getConcurrencyLimit(): number {
        return this._maxConcurrent;
    }

    /* ===================== 并发槽（信号量） ===================== */
    /** 获取一个并发槽；若已达上限则按优先级排队等待，直到有任务进入终态释放槽。
     *  高优先级（视频）任务插入等待队列队首，确保槽位释放时优先获得，避免链接过期 */
    private _acquireSlot(id?: string): Promise<void> {
        if (this._activeSubmits < this._maxConcurrent) {
            this._activeSubmits++;
            return Promise.resolve();
        }
        const prio = (id && this.tasks.get(id)?.priority) || 0;
        const order = (id && this.tasks.get(id)?._order) || 0;
        return new Promise<void>((resolve) => {
            const waiter = { resolve, prio, order };
            // 插入到正确位置：优先级高者在前；同优先级按 _order 先后（先到先得）
            let i = this._submitWaiters.length;
            while (i > 0) {
                const w = this._submitWaiters[i - 1]!;
                if (w.prio > prio || (w.prio === prio && w.order <= order)) break;
                i--;
            }
            this._submitWaiters.splice(i, 0, waiter);
        });
    }

    /** 释放一个并发槽并唤醒下一个（最高优先级）等待者（按 submitIntervalMs 节流） */
    private _releaseSlot(): void {
        this._activeSubmits = Math.max(0, this._activeSubmits - 1);
        const next = this._submitWaiters.shift();
        if (next) {
            this._activeSubmits++;
            if (this._submitIntervalMs > 0) setTimeout(() => next.resolve(), this._submitIntervalMs);
            else next.resolve();
        }
    }

    /** 任务进入终态时释放其持有的并发槽（幂等，仅首次释放生效） */
    private _releaseSlotIfHeld(id: string): void {
        if (this._heldSlots.has(id)) {
            this._heldSlots.delete(id);
            this._releaseSlot();
        }
    }

    /**
     * 停滞速度归零：周期性检查 in_progress 任务，若超过 _STALE_SPEED_MS 无任何进度采样，
     * 说明下载实际已卡住（网络中断/Chrome 暂停进度回报），将 speedBps 归零并刷新 UI，
     * 避免面板一直显示冻结的历史速度值。仅在速度由正转 0 时发事件，避免空转刷屏。
     */
    private _startStaleSpeedWatch(): void {
        if (typeof setInterval === 'undefined' || this._staleSpeedTimer) return;
        this._staleSpeedTimer = setInterval(() => {
            const now = Date.now();
            for (const t of this.tasks.values()) {
                if (t.state !== 'in_progress') continue;
                const last = t._lastSampleAt || 0;
                // 速度停滞：归零速度避免面板显示冻结的历史速度值（仅在由正转 0 时发事件，避免空转刷屏）
                if ((t.speedBps || 0) > 0 && last && now - last > this._STALE_SPEED_MS) {
                    t.speedBps = 0;
                    t.etaMs = undefined;
                    this.emit('task-updated', t);
                    this._markStatsDirty();
                }
                // 卡死兜底：长时间（>_STALE_TASK_MS）无任何进度采样事件（含进度心跳），
                // 说明底层传输已失联（网络中断 / 完成事件丢失）。强制转 interrupted 并释放并发槽，
                // 避免单个卡死任务永久占用槽位导致整条下载流水线冻死。
                if (last && now - last > this._STALE_TASK_MS) {
                    this.log('WARN', `下载卡死超时（${Math.round((now - last) / 1000)}s 无进度），强制标记失败并释放槽：${t.name || t.id}`);
                    this.upsert({ id: t.id, state: 'interrupted', error: '下载卡死（超时无进度）', _src: 'stale-timeout' });
                }
            }
        }, 1000);
    }

    /* ===================== 事件总线 ===================== */
    subscribe(event: DmEvent, listener: Listener): () => void {
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(listener);
        return () => set!.delete(listener);
    }
    private emit(event: DmEvent, payload: any): void {
        const set = this.listeners.get(event);
        if (set) {
            for (const l of set) {
                try {
                    l(payload);
                } catch {
                    /* 单个订阅者异常不影响其他 */
                }
            }
        }
    }

    /* ===================== 日志 ===================== */
    log(level: string, msg: string, extra: unknown = null): void {
        const lv = (level || 'INFO').toString().toUpperCase();
        const text = String(msg);
        const item: DmLogEntry = {
            ts: Date.now(),
            tsText: fmtTs(Date.now()),
            level: lv,
            msg: text,
            message: text,
            extra,
        };
        this._logs.push(item);
        if (this._logs.length > LIMITS.LOG_BUFFER_SIZE) {
            this._logs.shift();
        }
        try {
            const m = text + (extra ? ' | extra=' + (typeof extra === 'object' ? JSON.stringify(extra) : String(extra)) : '');
            const prefix = `[QZ-DM ${item.tsText} ${lv}]`;
            const fn = consoleFnForLevel(lv);
            if (typeof console[fn] === 'function') console[fn](prefix, m);
            else console.log(prefix, m);
        } catch {
            /* console 不可用不能让 DM 崩 */
        }
        this.emit('log', item);
    }
    logs(): DmLogEntry[] {
        return this._logs.slice();
    }
    exportLogs(format: 'txt' | 'json' = 'txt', options: { level?: string; includeExtra?: boolean } = {}): string {
        const levelFilter = (options.level || 'ALL').toString().toUpperCase();
        const list = levelFilter === 'ALL' ? this._logs : this._logs.filter((i) => i.level === levelFilter);
        if (format === 'json') {
            return JSON.stringify({ exportedAt: Date.now(), count: list.length, items: list }, null, 2);
        }
        return list
            .map((i) => `${i.tsText} [${i.level}] ${i.msg}` + (options.includeExtra && i.extra ? ' | extra=' + JSON.stringify(i.extra) : ''))
            .join('\n');
    }

    /* ===================== 任务读写 ===================== */
    hashForTask(t: Partial<LiveTask>): string {
        if (!t) return '';
        if (t.id) return String(t.id);
        const seed = (t.module || '') + '::' + (t.dir || '') + '::' + (t.name || t.url || Math.random());
        return 'h_' + hashString(seed);
    }

    get(id: string): LiveTask | null {
        if (!id) return null;
        return this.tasks.get(id) || null;
    }

    upsert(patch: Partial<LiveTask> & { _src?: string }): LiveTask | null {
        const src = patch._src ? String(patch._src) : '';
        const p = { ...patch } as Partial<LiveTask>;
        delete (p as any)._src;

        let id = p.id;
        const hasModule = !!p.module;
        const hasDir = !!p.dir;
        const hasName = !!p.name;
        const hasUrl = !!p.url;
        const hasDownloadId = !!(p.downloadId && typeof p.downloadId === 'number' && p.downloadId > 0);
        const hasAria2Gid = !!p.aria2Gid;
        if (!id && !hasModule && !hasDir && !hasName && !hasUrl && !hasDownloadId && !hasAria2Gid) {
            this.log('WARN', `[DM-UPSERT-SKIP] 拒绝空壳任务（无 id/module/dir/name/url/downloadId）src=${src || 'unknown'}`);
            return null;
        }
        if (!id) {
            const seed = (p.module || '') + '::' + (p.dir || '') + '::' + (p.name || p.url || Math.random());
            id = 'h_' + hashString(seed);
        }

        const existed = this.tasks.get(id);
        if (!existed) {
            const task: LiveTask = Object.assign(
                {
                    id,
                    state: 'pending' as TaskState,
                    trackerType: 'none' as DriverType,
                    module: 'Common',
                    url: '',
                    dir: '',
                    name: '',
                    _createdAt: Date.now(),
                    _order: this._order++,
                    downloadedBytes: 0,
                    speedSamples: [],
                },
                p,
            );
            if (!task.id) task.id = id;
            // 优先级：上游显式传入 priority 则尊重；否则按文件名/URL 判定视频并提升，
            // 使视频直链在并发槽释放时优先插队，避免排队等待期间过期失效
            if (task.priority == null) {
                task.priority = isVideoName(task.name || task.url || '') ? VIDEO_PRIORITY : 0;
            }
            this.tasks.set(id, task);
            this._bindBackRefs(task);
            this.emit('task-added', task);
            this._markStatsDirty();
            if (this.queue) void this._persist(task);
            return task;
        }

        let changed = false;
        for (const k of Object.keys(p)) {
            const v = (p as any)[k];
            if (v === undefined) continue;
            // 终态护栏：completed 任务不可被续传时采集器的重登记降级回 pending，
            // 否则已下载完成的媒体会被重新下载。重试/恢复只针对 interrupted/paused。
            if (k === 'state' && existed.state === 'complete' && v !== 'complete') continue;
            if ((existed as any)[k] !== v) {
                (existed as any)[k] = v;
                changed = true;
            }
        }
        // 进度心跳（browser/driver progress）即使字节未变也视为一次有效刷新：
        // 让速度按「无新增字节」正常衰减、并刷新 UI，避免同值 delta 被吞导致进度/速度卡死
        if (!changed && existed && existed.state === 'in_progress' && (p._src === 'browser-progress' || p._src === 'driver-progress')) {
            changed = true;
        }
        if (changed) {
            // 速度 / ETA：基于相邻采样点做指数滑动平均，避免进度抖动
            const sampleBytes = Number(existed.downloadedBytes || 0);
            if (existed.state === 'in_progress') {
                const now = Date.now();
                const lastT = existed._lastSampleAt || 0;
                const lastB = (existed._lastSampleBytes != null) ? existed._lastSampleBytes : null;
                if (lastT && lastB != null) {
                    const dtSec = (now - lastT) / 1000;
                    if (dtSec > 0.1) {
                        const inst = (sampleBytes - lastB) / dtSec;
                        if (inst >= 0) existed.speedBps = existed.speedBps != null ? existed.speedBps * 0.7 + inst * 0.3 : inst;
                        existed._lastSampleAt = now;
                        existed._lastSampleBytes = sampleBytes;
                    }
                } else {
                    existed._lastSampleAt = now;
                    existed._lastSampleBytes = sampleBytes;
                }
                const totB = Number(existed.totalBytes || 0);
                existed.etaMs = (existed.speedBps && existed.speedBps > 0 && totB) ? Math.max(0, (totB - sampleBytes) / existed.speedBps * 1000) : undefined;
            } else {
                existed.speedBps = 0;
                existed.etaMs = undefined;
            }
            this._bindBackRefs(existed);
            this.emit('task-updated', existed);
            this._markStatsDirty();
            if (this.queue && (existed.state === 'complete' || existed.state === 'interrupted')) {
                void this._persist(existed);
            }
            // 任务进入终态：释放其占用的并发槽，唤醒下一个等待提交的任务；
            // 同时清出重入守卫，允许后续 retry/restore 对该 id 重新提交
            if (existed.state === 'complete' || existed.state === 'interrupted') {
                this._releaseSlotIfHeld(existed.id);
                this._submitting.delete(existed.id);
            }
        }
        return existed;
    }

    private _bindBackRefs(task: LiveTask): void {
        if (task.downloadId && typeof task.downloadId === 'number' && task.downloadId > 0) {
            this._dlIdToId.set(task.downloadId, task.id);
        }
        if (task.aria2Gid) {
            this._gidToId.set(task.aria2Gid, task.id);
        }
        if (task.name) {
            this._nameToId.set(task.name, task.id);
        }
    }

    tasksSorted(): LiveTask[] {
        // 优先级高者在前（视频优先），同优先级按到达顺序(_order)稳定排序
        return Array.from(this.tasks.values()).sort((a, b) => {
            const pa = a.priority || 0, pb = b.priority || 0;
            if (pa !== pb) return pb - pa;
            return (a._order || 0) - (b._order || 0);
        });
    }

    private _markStatsDirty(): void {
        if (this._statsDirty) return;
        this._statsDirty = true;
        setTimeout(() => {
            this._statsDirty = false;
            this.emit('stats', this.stats());
        }, TIMING.STATS_DEBOUNCE);
    }
    stats(): Record<string, number> {
        const s: Record<string, number> = { pending: 0, in_progress: 0, paused: 0, complete: 0, interrupted: 0, total: this.tasks.size };
        for (const t of this.tasks.values()) {
            s[t.state] = (s[t.state] || 0) + 1;
        }
        return s;
    }

    /* ===================== Firefox 形态 B：文案/查看器落盘进度 ===================== */

    private metaWrite: { done: number; total: number } | null = null;

    /** 文案/查看器落盘进度（写文件 N/M），供进度面板注脚展示 */
    setMetaWriteProgress(done: number, total: number): void {
        this.metaWrite = { done: Math.max(0, done), total: Math.max(0, total) };
        this._markStatsDirty();
    }

    getMetaWriteProgress(): { done: number; total: number } | null {
        return this.metaWrite;
    }

    /* ===================== 提交下载 ===================== */
    async submitTask(id: string): Promise<void> {
        const task = this.tasks.get(id);
        if (!task) return;
        // 重入守卫：同一任务正在提交/下载中时，重复调用直接跳过，不重复占用并发槽
        // （避免重复提交导致槽泄漏、有效并发塌缩成 1）。任务进入终态时从本集合清出。
        if (this._submitting.has(id)) return;
        this._submitting.add(id);
        // 受并发上限约束：达到 downloadThread 时按优先级排队等待，避免一次性发起海量下载
        await this._acquireSlot(id);
        // 排队期间任务可能已被取消/移除/完成，需重新校验
        const t = this.tasks.get(id);
        if (!t || t.state === 'interrupted' || t.state === 'complete') {
            this._releaseSlot();
            this._submitting.delete(id);
            return;
        }
        // 全局暂停：暂停期间不发起任何新下载。把排队中/待提交的任务标记回 paused，
        // 释放并发槽，待 resumeAll 时再重新入队，避免暂停被后续排队任务「漏掉」
        if (this._paused) {
            this.upsert({ id, state: 'paused', _src: 'submit-blocked-paused' });
            this._releaseSlot();
            this._submitting.delete(id);
            return;
        }
        // 标记本任务已占用一个并发槽，待进入终态（complete/interrupted）时释放
        this._heldSlots.add(id);

        const trackerType = t.trackerType && t.trackerType !== 'none' ? t.trackerType : this._defaultTracker();
        const driver = this.drivers[trackerType];
        if (!driver) {
            this.log('WARN', `[DM] 无可用下载器 ${trackerType}，任务 ${id} 跳过`);
            this._releaseSlotIfHeld(id);
            this._submitting.delete(id);
            return;
        }
        // 更新 trackerType（若之前是 none）
        if (t.trackerType === 'none') {
            t.trackerType = trackerType;
        }
        const reporter: ProgressReporter = {
            onProgress: (downloaded, total) => {
                // 总大小只升不降：驱动在 total 未知时会传 0（如 aria2 的 totalLength 尚未就绪、
                // 响应无 Content-Length），若直接覆盖会把已探明的总大小抹成 0，导致进度条与
                // 剩余时间凭空消失。这里保留已知值，仅在拿到有效值时更新。
                const known = this.tasks.get(id)?.totalBytes || 0;
                const totalBytes = total > 0 ? total : known;
                this.upsert({ id, downloadedBytes: downloaded, totalBytes, state: 'in_progress', _src: 'driver-progress' });
            },
            onState: (state, error) => {
                if (state === 'complete') {
                    this.upsert({ id, state, error, _src: 'driver-state' });
                    if (this.options.onTaskComplete) {
                        try { this.options.onTaskComplete(t.url, t.dir); } catch { /* ignore */ }
                    }
                } else if (state === 'interrupted') {
                    // 任务被驱动主动报告中断（如浏览器驱动经 background 广播）：走统一失败处理，
                    // 以便 Disk 模式下触发「疑似 Referer 缺失 → 自动注册 DNR → 重试」
                    this._failTask(id, error || '下载失败', 'driver-state');
                } else {
                    this.upsert({ id, state, error, _src: 'driver-state' });
                }
            },
        };
        try {
            const result = await driver.submit(
                { id: t.id, module: t.module, url: t.url, dir: t.dir, name: t.name, ownerId: t.ownerId, ownerTitle: t.ownerTitle, thumbUrl: t.thumbUrl, totalBytes: t.totalBytes, rootFolderName: this.writer?.getRootFolderName?.() || '' },
                reporter,
            );
            if (result.trackerId !== undefined) {
                // 驱动成功接受任务即视为「正在下载」。非浏览器驱动（aria2/disk）原本只靠
                // onProgress(bytesReceived>0) 推断 in_progress；若底层未在下载中途回报字节进度
                // （如 aria2 某些场景 totalLength 延迟上报、流式/分块下载），任务会从 pending 直接跳到
                // complete，永远不出现「正在下载」状态，导致概览 TOP3「正在下载」列表恒为空。
                // 这里在 submit 成功接受任务时主动置 in_progress（仅当尚未进入终态），兜底补齐状态。
                const cur = this.tasks.get(id);
                const patch: Partial<LiveTask> & { _src?: string } = { id, _src: 'driver-id' };
                if (typeof result.trackerId === 'number') patch.downloadId = result.trackerId;
                else patch.aria2Gid = String(result.trackerId);
                if (cur && cur.state === 'pending') patch.state = 'in_progress';
                this.upsert(patch);
            }
            if (result.error) {
                this._failTask(id, result.error, 'driver-error');
            }
        } catch (e) {
            this._failTask(id, e instanceof Error ? e.message : String(e), 'driver-exception');
        }
        // 注意：并发槽不在 submit 结束后立即释放；由 upsert 在任务进入终态时统一释放，
        // 从而同时覆盖 disk/aria2（submit 内 await 完成）与 browser（submit 仅启动、完成靠广播）两种模型。
    }

    /**
     * 统一失败处理：置 interrupted 并（仅 Disk 模式）尝试自动注册 DNR 后重试一次。
     * 收口 submitTask 内三处失败路径（driver onState interrupted / driver 返回 error / 异常）。
     */
    private _failTask(id: string, error: string, src: string): void {
        this.upsert({ id, state: 'interrupted', error, _src: src });
        // 自动补救为 fire-and-forget，不阻塞当前 submitTask 收尾（并发槽释放等）
        void this._maybeAutoDnrAndRetry(id, error);
    }

    /**
     * Disk（直写目录）模式下载失败时，若错误疑似 Referer 缺失，则对该任务 URL 所属 host
     * 自动请求 background 增量注册一条 Referer DNR 规则，注册成功后自动重试该任务一次。
     *
     * 不限制域名：助手要下载的 URL 都来自 QQ 空间备份数据，无论是否为 QQ 系域名，
     * 都视为助手请求的内容（可能含第三方图床/转存 CDN），失败且疑似 Referer 缺失即自动补救。
     * 仅由 extractHost 做协议护栏（拒绝 data:/blob: 等非 http(s)），不引入域名白名单。
     *
     * 防循环策略（两套独立集合）：
     *  - _autoDnrHosts：同 host 只注册一次 DNR 规则（避免同一域名海量文件重复 addRules）；
     *  - _autoRetriedTasks：同任务只自动重试一次，避免「重试仍失败 → 又触发 → 又重试」无限循环。
     * 两者分离：同一 host 下多个文件失败，规则只注册一次，但每个失败文件都会被自动重试一次。
     */
    private async _maybeAutoDnrAndRetry(id: string, error: string): Promise<void> {
        const task = this.tasks.get(id);
        if (!task) return;
        if (task.trackerType !== 'disk') return; // 仅直写目录（受 DNR 约束）；浏览器/Aria2 不走此逻辑
        if (!looksLikeRefererMissing(error)) return;
        const host = extractHost(task.url);
        if (!host) return; // 仅 http(s) 协议的合法 host 才自动补救
        if (this._autoRetriedTasks.has(id)) return; // 本任务已自动重试过，避免无限循环
        this._autoRetriedTasks.add(id);
        const needRegister = !this._autoDnrHosts.has(host); // 同 host 仅注册一次
        if (needRegister) this._autoDnrHosts.add(host); // 先占坑，避免并发重复注册同一 host
        const rt: any = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime : undefined;
        if (!rt || typeof rt.sendMessage !== 'function') return;
        try {
            if (needRegister) {
                const resp = await rt.sendMessage({ from: 'content', type: BG_MSG.DNR_ADD_HOST, host });
                if (resp && (resp.ok || resp.added)) {
                    void this.retryTask(id).catch(() => { /* ignore */ });
                }
            } else {
                // host 规则已注册（同域名其它文件已触发过），直接自动重试本任务，不重复注册
                void this.retryTask(id).catch(() => { /* ignore */ });
            }
        } catch {
            // background 未就绪 / 通道异常：注册失败时回滚占坑，允许用户下次手动↻后再触发
            if (needRegister) this._autoDnrHosts.delete(host);
        }
    }

    private _defaultTracker(): DriverType {
        // 默认优先 disk（与 QZone_Config.Common.downloadType 默认值「助手直写目录」一致）
        return 'disk';
    }

    /* ===================== Browser 进度（background 广播） ===================== */
    private _installBrowserProgressListener(): void {
        // 归一化一条下载事件并交给既有处理逻辑（window 与 runtime 两条通道共用）
        const handleDlMessage = (d: any): void => {
            if (!d || typeof d !== 'object') return;
            if (d.type === DLEvent.CREATED) {
                const taskId = this._resolveByDownloadId(d.downloadId, d.filename, d.url);
                // 解析不到对应任务时不创建孤儿任务：我们的下载都先经 addMediaTask 登记，
                // onCreated 仅用于回填 downloadId/totalBytes；解析失败（用户手动下载或时序竞态）
                // 若仍 upsert 会生成游离任务、污染统计与进度
                if (!taskId) return;
                if (d.filename) {
                    // 同时以全路径注册 _nameToId，加速 onChanged 的 O(1) 查询
                    this._nameToId.set(String(d.filename), taskId);
                }
                const createdPatch: Partial<LiveTask> & { _src?: string } = {
                    id: taskId,
                    downloadId: d.downloadId,
                    trackerType: 'browser',
                    _src: 'browser-created',
                };
                if (d.totalBytes && Number(d.totalBytes) > 0) createdPatch.totalBytes = Number(d.totalBytes);
                this.upsert(createdPatch);
            } else if (d.type === DLEvent.PROGRESS) {
                this._onBrowserProgress(d);
            } else if (d.type === DLEvent.PROGRESS_BATCH && Array.isArray(d.items)) {
                // 背景批量合并广播（每个 downloadId 一帧），逐条还原为单条进度处理
                for (const item of d.items) {
                    if (item && typeof item === 'object') this._onBrowserProgress(item);
                }
            }
        };

        // 通道 B：页面内 window.postMessage（仅浏览器环境，保留兼容）
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            const onWindowMessage = (ev: MessageEvent) => handleDlMessage(ev.data);
            window.addEventListener('message', onWindowMessage);
        }

        // 通道 A：background service worker 经 chrome.tabs.sendMessage 广播的浏览器下载进度。
        // content script 默认只监听 window.postMessage，收不到 runtime 通道，导致 Browser 模式下
        // 进度/完成事件丢失、并发槽永不释放、媒体下载整体冻死。这里补齐 runtime 监听，
        // 把 background 上报的事件直接交给同一处理逻辑。
        if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.onMessage?.addListener === 'function') {
            const onRuntime = (request: any) => { handleDlMessage(request); };
            chrome.runtime.onMessage.addListener(onRuntime);
            this._browserRuntimeUnsub = () => {
                try { chrome.runtime.onMessage.removeListener(onRuntime); } catch { /* ignore */ }
            };
        }
    }

    private _resolveByDownloadId(downloadId: number, filename?: string, url?: string): string {
        // 快路径 1：downloadId 反向索引（submitTask 后已注册，O(1)）
        const byId = this._dlIdToId.get(downloadId);
        if (byId) return byId;
        // 快路径 2：filename 反向索引（onCreated/onProgress 已补全，O(1)）
        if (filename) {
            const byName = this._nameToId.get(String(filename));
            if (byName) return byName;
            // 浏览器透出全路径、task.name 为短名时，用 basename 再试一次
            const base = String(filename).split(/[\\/]/).pop() || '';
            if (base && base !== filename) {
                const byBase = this._nameToId.get(base);
                if (byBase) return byBase;
            }
        }
        // 兜底（极少触发）：浏览器文件名与 task.name 既不同也非包含关系时，O(n) 模糊匹配
        if (filename) {
            for (const t of this.tasks.values()) {
                if (t.name && filename.indexOf(t.name) > -1) {
                    this._nameToId.set(t.name, t.id); // 补漏
                    return t.id;
                }
            }
        }
        return '';
    }

    private _onBrowserProgress(msg: any): void {
        let taskId = this._dlIdToId.get(Number(msg.downloadId)) || msg.taskId || null;
        if (!taskId && msg.filename) {
            // 快路径：O(1) 精确匹配
            taskId = this._nameToId.get(String(msg.filename)) || null;
        }
        if (!taskId && msg.filename) {
            // 兜底：O(n) 模糊匹配（浏览器透出的文件名可能与 task.name 不同）
            const fullFn = String(msg.filename);
            for (const t of this.tasks.values()) {
                if (t.name && fullFn.indexOf(t.name) > -1) {
                    taskId = t.id;
                    // 同时以短名和全路径注册，加速后续所有路径的查询
                    this._nameToId.set(t.name, t.id);
                    this._nameToId.set(fullFn, t.id);
                    break;
                }
            }
        }
        if (!taskId) return;
        const patch: Partial<LiveTask> & { _src?: string } = { id: taskId, trackerType: 'browser', _src: 'browser-progress' };
        if (msg.bytesReceived != null) patch.downloadedBytes = Number(msg.bytesReceived) || 0;
        if (msg.totalBytes != null) { const tb = Number(msg.totalBytes); if (tb > 0) patch.totalBytes = tb; }
        const curState = this.tasks.get(taskId)?.state;
        if (msg.state === 'in_progress') {
            patch.state = 'in_progress';
        } else if (!msg.state && msg.bytesReceived != null && curState === 'pending') {
            // Chrome 的 onChanged delta 是增量：下载途中的帧只有 bytesReceived，
            // 只有进入 complete/interrupted 时才携带 state。若不在这里推断，
            // 任务会从 pending 直接跳到终态，中途永远不是 in_progress（见 #3/#6）
            patch.state = 'in_progress';
        } else if (msg.paused === false && curState === 'paused') {
            // 恢复下载：Chrome 以 paused:false 通知，同样不带 state
            patch.state = 'in_progress';
        }
        // paused 在 in_progress 之后判断，确保同帧两者并存时 paused 优先
        if (msg.paused === true) patch.state = 'paused';
        if (msg.state === 'complete') {
            const existed = this.tasks.get(taskId);
            const finalTotal = patch.totalBytes || (existed && existed.totalBytes) || patch.downloadedBytes || 0;
            patch.state = 'complete';
            patch.downloadedBytes = finalTotal;
            patch.totalBytes = finalTotal;
            const completedUrl = this.tasks.get(taskId)?.url || '';
            if (completedUrl && this.options.onTaskComplete) {
                try { this.options.onTaskComplete(completedUrl, this.tasks.get(taskId)?.dir); } catch { /* ignore */ }
            }
        } else if (msg.state === 'interrupted') {
            patch.state = 'interrupted';
            // 不用 Chrome 的 USER_CANCELED 覆盖 DM 主动 cancel 设置的 '已取消' 文案
            const existed = this.tasks.get(taskId);
            const isUserCancelled = existed && existed.error === '已取消';
            if (msg.error && !isUserCancelled) patch.error = String(msg.error);
            this.log('ERROR', `浏览器下载失败：${this.tasks.get(taskId)?.name || taskId} - ${patch.error || existed?.error || '未知错误'}`);
        }
        this.upsert(patch);
    }

    /* ===================== 操作接口 ===================== */
    async retry(taskIds?: string[]): Promise<void> {
        // 重入保护：人工在失败页签反复点击「重试失败」时，避免同一批失败任务被多次
        // re-pend/重提交（表现为「待开始又变回 N 条、反复循环」）。一次重试未结束前忽略新请求
        if (this._retrying) return;
        this._retrying = true;
        try {
            const ids = taskIds && taskIds.length ? taskIds : Array.from(this.tasks.values()).filter((t) => t.state === 'interrupted').map((t) => t.id);
            for (const id of ids) {
                const t = this.tasks.get(id);
                if (!t) continue;
                // 已处于 pending/in_progress 的任务不重复 re-pend（防御性，避免重叠重试时重复提交）
                if (t.state === 'pending' || t.state === 'in_progress') continue;
                // 重置速度采样点：避免重试后旧 _lastSampleBytes 导致 inst < 0 永远跳过速度更新
                t._lastSampleAt = 0;
                t._lastSampleBytes = undefined;
                t.downloadedBytes = 0;
                t.speedBps = 0;
                t.etaMs = undefined;
                // upsert 会跳过 undefined 值（增量语义），因此 error 必须在此直接清空，
                // 否则重试成功后任务上仍残留上一轮的报错文案，列表/概览继续显示失败原因
                t.error = undefined;
                // 清理旧 downloadId 映射，避免 _dlIdToId 残留导致内存泄漏
                if (t.downloadId) {
                    this._dlIdToId.delete(t.downloadId);
                    t.downloadId = undefined;
                }
                // 重试复用同一个 task.id（不新建任务），因此不会出现「同一文件两条记录」；
                // downloadId 由后续 submitTask 的 driver-id 回填覆盖
                this.upsert({ id, state: 'pending', retries: (t.retries || 0) + 1, _src: 'retry' });
                // 不 await：与正常提交流程（void submitTask）一致，让所有失败任务立即进入并发信号量
                // 排队，由「文件下载并发(downloadThread)」控制真正并行数；避免逐个 await 把重试启动串行化
                // （之前会让「下完一个才出现下一个」的观感在并发上限较低时更明显）。
                // 重入/重复提交已由下方 per-task 状态守卫（pending/in_progress 跳过）兜底。
                void this.submitTask(id).catch(() => { /* ignore */ });
            }
        } finally {
            this._retrying = false;
        }
    }
    async retryFailed(): Promise<void> {
        await this.retry();
    }
    async pauseAll(): Promise<void> {
        // 置全局暂停标记：后续 submitTask 在提交前会被拦截，排队中任务不再发起新下载
        this._paused = true;
        for (const t of this.tasks.values()) {
            if (t.state === 'in_progress' && (t.downloadId || t.aria2Gid)) {
                const driver = this.drivers[t.trackerType as DriverType];
                try {
                    if (t.downloadId && driver?.pause) await driver.pause(t.downloadId);
                    else if (t.aria2Gid && driver?.pause) await driver.pause(t.aria2Gid);
                    this.upsert({ id: t.id, state: 'paused', _src: 'pauseAll' });
                } catch (e) {
                    this.log('WARN', `暂停任务失败 id=${t.id}`, e);
                }
            }
        }
        this.log('INFO', '已全局暂停：进行中下载已暂停，排队任务将不再发起新下载');
    }
    async resumeAll(): Promise<void> {
        this._paused = false;
        for (const t of this.tasks.values()) {
            if (t.state !== 'paused') continue;
            const driver = this.drivers[t.trackerType as DriverType];
            try {
                if (t.downloadId || t.aria2Gid) {
                    // 已发起过的下载：恢复底层传输并回到 in_progress
                    if (t.downloadId && driver?.resume) await driver.resume(t.downloadId);
                    else if (t.aria2Gid && driver?.resume) await driver.resume(t.aria2Gid);
                    this.upsert({ id: t.id, state: 'in_progress', _src: 'resumeAll' });
                } else {
                    // 被全局暂停拦在提交前的任务（尚未取得 downloadId）：重新入队提交
                    this.upsert({ id: t.id, state: 'pending', _src: 'resumeAll' });
                    void this.submitTask(t.id).catch(() => { /* ignore */ });
                }
            } catch (e) {
                this.log('WARN', `恢复任务失败 id=${t.id}`, e);
            }
        }
        this.log('INFO', '已全局恢复：继续下载进行中与排队任务');
    }
    async cancel(taskIds?: string[]): Promise<void> {
        const ids = taskIds && taskIds.length ? taskIds : Array.from(this.tasks.keys());
        for (const id of ids) {
            const t = this.tasks.get(id);
            if (!t) continue;
            const driver = this.drivers[t.trackerType as DriverType];
            try {
                if (t.downloadId && driver?.cancel) await driver.cancel(t.downloadId);
                else if (t.aria2Gid && driver?.cancel) await driver.cancel(t.aria2Gid);
                // 底层取消成功：标记终态为已取消
                this.upsert({ id, state: 'interrupted', error: '已取消', _src: 'cancel' });
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                this.log('WARN', `取消任务失败 id=${id}`, e);
                // F8: 底层取消失败时不伪造「已取消」终态，保留真实状态并通知面板，
                // 避免 UI 显示已取消而底层下载仍在继续的状态失真
                this.emit('task-error', { id, op: 'cancel', error: msg });
            }
        }
    }

    /**
     * 全局进度（详见 {@link GlobalProgress}）。
     *
     * 任务权重统一：每个任务等权计入分母（含 pending 与未知 size），避免
     * 「字节算法」与「计数算法(run*0.5)」两套口径打架，也避免未知 size
     * 任务被排除在分母外导致进度虚高。
     *
     * 百分比一律经 {@link displayPercent} 钳制：未按计数达成时封顶 99，
     * 消除「四舍五入到 100% 却还在下载」的假完成。
     */
    /**
     * 对一组任务计算全局进度快照。抽出来供 {@link globalProgress}（全量）与
     * {@link moduleProgressMap}（按模块）复用，避免两套加权算法漂移。
     */
    private _progressOf(tasks: Iterable<LiveTask>): GlobalProgress {
        let totalBytes = 0, downloadedBytes = 0, speedBps = 0;
        let weightedDone = 0, weightedTotal = 0;
        let succeeded = 0, failed = 0, pending = 0, running = 0, paused = 0;
        for (const t of tasks) {
            const tb = Number(t.totalBytes || 0);
            const db = Number(t.downloadedBytes || 0);
            speedBps += Number(t.speedBps || 0);
            if (tb > 0) {
                totalBytes += tb;
                downloadedBytes += Math.min(db, tb);
            }
            weightedTotal += 1;
            if (t.state === 'complete') {
                weightedDone += 1;
                succeeded += 1;
            } else if (t.state === 'in_progress' || t.state === 'paused') {
                // paused 仍按已下载字节比计入完成度（已下载部分客观存在），
                // 但它「尚无结论」，不计入 settled —— 暂停不等于结束。
                weightedDone += tb > 0 ? Math.min(db, tb) / tb : 0;
                if (t.state === 'paused') paused += 1; else running += 1;
            } else if (t.state === 'interrupted') {
                // interrupted（失败/用户取消）不计完成度，避免「全部失败却显示高进度」
                // 掩盖失败规模；但它「已有结论」，计入 settled，让 settledPercent
                // 能到 100%，从而区分「还在下载」与「下载已结束但有失败」（见 #8）。
                failed += 1;
            } else {
                // pending 及任何未知状态：计入分母，既不计完成度也不计结论。
                // 归入 pending 而非丢弃，保证不变式
                // succeeded + failed + pending + running + paused === totalTasks 恒成立。
                pending += 1;
            }
        }
        const settled = succeeded + failed;
        const unsettled = pending + running + paused;
        // 完成判定以计数为准（不是百分比）：无任务视为已结束，避免空管理器永远「未完成」
        const isSettled = weightedTotal === 0 || unsettled === 0;
        const etaMs = speedBps > 0 && totalBytes > downloadedBytes ? (totalBytes - downloadedBytes) / speedBps * 1000 : undefined;
        return {
            totalBytes, downloadedBytes, speedBps, etaMs,
            percent: displayPercent(weightedDone, weightedTotal, weightedTotal > 0 && succeeded === weightedTotal),
            settled, succeeded, failed, unsettled,
            pending, running, paused,
            totalTasks: weightedTotal,
            settledPercent: displayPercent(settled, weightedTotal, weightedTotal > 0 && isSettled),
            failedPercent: displayPercent(failed, weightedTotal, weightedTotal > 0 && failed === weightedTotal),
            // 总进度：失败按满权重计入分子（已处理，只是结论是失败），
            // 进行中仍按字节比 —— 既平滑又能在下载环节结束时真正走满 100%
            overallPercent: displayPercent(weightedDone + failed, weightedTotal, weightedTotal > 0 && isSettled),
            isSettled,
        };
    }

    globalProgress(): GlobalProgress {
        return this._progressOf(this.tasks.values());
    }

    /**
     * 按模块聚合媒体下载进度，供概览「合成总进度」使用（每个模块的媒体完成度）。
     *
     * 返回 `{ [module]: { overallPercent, totalTasks } }`：
     *  - `overallPercent`：该模块媒体任务的加权总进度（失败按满权重计入，
     *    与 {@link globalProgress} 口径一致，结束时必到 100%）。
     *  - `totalTasks`：该模块媒体任务数（为 0 表示该模块无媒体，概览应退化为仅看采集进度）。
     *
     * 单趟遍历按 `task.module` 分组，O(n) 一次完成，不重复扫描任务表。
     */
    moduleProgressMap(): Record<string, { overallPercent: number; totalTasks: number }> {
        const groups = new Map<string, LiveTask[]>();
        for (const t of this.tasks.values()) {
            const arr = groups.get(t.module);
            if (arr) arr.push(t);
            else groups.set(t.module, [t]);
        }
        const out: Record<string, { overallPercent: number; totalTasks: number }> = {};
        for (const [mod, arr] of groups) {
            const p = this._progressOf(arr);
            out[mod] = { overallPercent: p.overallPercent, totalTasks: p.totalTasks };
        }
        return out;
    }

    /** 暂停单个任务 */
    async pauseTask(id: string): Promise<void> {
        const t = this.tasks.get(id);
        if (!t || t.state !== 'in_progress') return;
        const driver = this.drivers[t.trackerType as DriverType];
        try {
            if (t.downloadId && driver?.pause) await driver.pause(t.downloadId);
            else if (t.aria2Gid && driver?.pause) await driver.pause(t.aria2Gid);
            this.upsert({ id, state: 'paused', _src: 'pauseTask' });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.log('WARN', `暂停任务失败 id=${id}`, e);
            // F6: 操作失败需通知面板，否则 UI 无任何反馈
            this.emit('task-error', { id, op: 'pause', error: msg });
        }
    }

    /** 继续单个任务 */
    async resumeTask(id: string): Promise<void> {
        const t = this.tasks.get(id);
        if (!t || t.state !== 'paused') return;
        const driver = this.drivers[t.trackerType as DriverType];
        try {
            if (t.downloadId && driver?.resume) await driver.resume(t.downloadId);
            else if (t.aria2Gid && driver?.resume) await driver.resume(t.aria2Gid);
            this.upsert({ id, state: 'in_progress', _src: 'resumeTask' });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.log('WARN', `恢复任务失败 id=${id}`, e);
            // F6: 操作失败需通知面板
            this.emit('task-error', { id, op: 'resume', error: msg });
        }
    }

    /** 重试单个失败任务 */
    async retryTask(id: string): Promise<void> { await this.retry([id]); }

    /** 取消单个任务 */
    async cancelTask(id: string): Promise<void> { await this.cancel([id]); }

    /** 清空内存中的日志缓冲 */
    clearLogs(): void { this._logs = []; }

    clear(): void {
        this.tasks.clear();
        // 停止停滞看门狗定时器，避免 clear 后定时器仍持有 DM 引用导致内存/定时器泄漏
        if (this._staleSpeedTimer) { clearInterval(this._staleSpeedTimer); this._staleSpeedTimer = null; }
        this._dlIdToId.clear();
        this._gidToId.clear();
        this._nameToId.clear();
        // 先归零并发记账，再释放持有槽：避免 _releaseSlot 唤醒的 waiter 在 _activeSubmits
        // 尚未归零时被错误累加，造成 clear() 瞬间并发数短暂越过上限。
        this._submitWaiters.length = 0;
        this._activeSubmits = 0;
        // 仅做一次性唤醒，确保任何挂起在 _acquireSlot 的 submitTask 能走出等待（计数已归零，不会超额）
        for (const _id of this._heldSlots) {
            this._releaseSlot();
        }
        this._heldSlots.clear();
        // 卸载 runtime 进度监听（F9），避免 DM 复用/重建后重复注册导致内存泄漏
        if (this._browserRuntimeUnsub) {
            this._browserRuntimeUnsub();
            this._browserRuntimeUnsub = null;
        }
        this._paused = false;
        this._markStatsDirty();
    }

    /** 清空 IndexedDB 中全部 uin 的下载任务记录（备份启动时调用，避免多账号切换累积撑满配额导致卡死） */
    async clearStaleTasks(): Promise<void> {
        if (!this.queue) return;
        const count = await this.queue.clearAllGlobal();
        if (count > 0) this.log('INFO', `清理 ${count} 条历史下载任务记录`);
    }

    /* ===================== TaskQueue 持久化（断点续传） ===================== */
    private async _persist(task: LiveTask): Promise<void> {
        if (!this.queue) return;
        const dt: DownloadTask = {
            id: task.id,
            uin: this.queue.uin,
            module: task.module,
            url: task.url,
            dir: task.dir,
            name: task.name,
            state: task.state,
            downloadId: task.downloadId,
            aria2Gid: task.aria2Gid,
            retries: task.retries,
            priority: task.priority,
            error: task.error,
            ownerId: task.ownerId != null ? String(task.ownerId) : undefined,
            ownerTitle: task.ownerTitle,
            thumbUrl: task.thumbUrl,
            trackerType: task.trackerType === 'none' ? undefined : (task.trackerType as any),
        };
        try {
            await this.queue.add([dt]);
            const { id: _id, uin: _uin, ...patch } = dt;
            await this.queue.update(task.id, patch);
        } catch {
            /* 持久化失败不影响内存态下载 */
        }
    }

    /**
     * 从持久化队列恢复【完整】媒体清单（续传场景由调用方在 resume 时调用）。
     *
     * 与旧 restoreFromQueue 的区别：
     *  - 读 queue.all()（含已完成的 complete），而非 queue.pending()（会过滤掉 complete）；
     *  - 按持久化的真实状态还原，而不是把所有任务都当成「未完成」重新下载。
     *
     * 状态映射：
     *  - complete            → 还原为已完成（显示完成，不重下）
     *  - interrupted         → 还原为失败（留在清单，等用户手动重试；不自动重试避免对持续失败项死循环）
     *  - pending/in_progress → 还原为 pending 并重新入队续下
     *  - paused              → 还原为已暂停
     *
     * 已存在于内存的任务会被跳过，避免重复提交。
     */
    async restoreManifestFromQueue(): Promise<number> {
        if (!this.queue) return 0;
        const all = await this.queue.all();
        let restored = 0;
        let resubmitted = 0;
        for (const t of all) {
            if (this.tasks.has(t.id)) continue;
            const state = (t.state || 'pending') as TaskState;
            const live = this.upsert({
                id: t.id,
                module: t.module,
                url: t.url,
                dir: t.dir,
                name: t.name,
                state,
                trackerType: (t.trackerType || 'none') as any,
                ownerId: t.ownerId,
                ownerTitle: t.ownerTitle,
                thumbUrl: t.thumbUrl,
                error: t.error,
                retries: t.retries,
                priority: t.priority,
                // 清空上次尝试残留的进度/采样，避免续传时旧 downloadedBytes 污染全局进度与速度计算
                downloadedBytes: 0,
                speedBps: 0,
                etaMs: undefined,
                _lastSampleAt: 0,
                _lastSampleBytes: undefined,
                _src: 'queue-restore',
            });
            if (!live?.id) continue;
            restored++;
            // 仅「未完成且非暂停/失败」的任务重新入队续下；完成/失败/暂停不自动动
            if (state === 'pending' || state === 'in_progress') {
                void this.submitTask(live.id).catch(() => { /* ignore */ });
                resubmitted++;
            }
        }
        if (restored > 0) {
            this.log('INFO', `从持久化队列恢复 ${restored} 个媒体任务（其中 ${resubmitted} 个重新入队续下，${restored - resubmitted} 个为已完成/失败/暂停）`);
        }
        return restored;
    }

    /** 运行时配置/重建 Aria2 驱动（用户在设置页切换下载器后调用） */
    configureAria2(opts: { host: string; token?: string; dir?: string }): void {
        this.drivers.aria2 = new Aria2Driver(opts);
    }

    /* ===================== 旧任务同步（保持兼容） ===================== */
    syncLegacy(legacyTasks: Array<Record<string, any>>, src?: string): number {
        let added = 0;
        for (const t of legacyTasks || []) {
            const patch: Partial<LiveTask> & { _src?: string } = {
                module: t.module || 'Common',
                url: t.url,
                dir: t.dir,
                name: t.name,
                trackerType: this._guessTracker(t),
                ownerId: t.ownerId,
                ownerTitle: t.ownerTitle,
                thumbUrl: t.thumbUrl || t.url,
                _src: src || 'syncLegacy',
            };
            if (t.downloadState) patch.state = normalizeState(t.downloadState);
            if (typeof t.__dmId !== 'undefined') patch.id = t.__dmId;
            if (t.id && typeof t.id === 'number' && t.id > 0) patch.downloadId = t.id;
            if (t.aria2Gid) patch.aria2Gid = t.aria2Gid;
            if (t.error) patch.error = String(t.error);
            if (t.size) patch.totalBytes = Number(t.size) || 0;
            const live = this.upsert(patch);
            if (live && live.id && typeof t.__dmId === 'undefined') {
                try {
                    t.__dmId = live.id;
                    added++;
                } catch {
                    /* ignore sealed */
                }
            }
        }
        if (added > 0) this.log('INFO', `同步 ${added} 个旧版任务到 DownloadManager`);
        return added;
    }
    private _guessTracker(t: Record<string, any>): DriverType | 'none' {
        if (t.aria2Gid) return 'aria2';
        if (typeof t.id === 'number' && t.id !== 0) return 'browser';
        return 'none';
    }
}

/** 单例工厂：挂到 window.QZoneDownloadManager，供面板与跨世界桥接使用 */
export function installDownloadManager(opts: DownloadManagerOptions = {}): DownloadManager {
    const dm = new DownloadManager(opts);
    (window as any).QZoneDownloadManager = dm;
    return dm;
}
