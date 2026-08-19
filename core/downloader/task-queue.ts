import type { IDBPDatabase } from 'idb';
import { openQzoneDb, STORE_TASKS, INDEX_TASKS_UIN } from '../store/db';

/**
 * 媒体下载任务队列（持久化到IndexedDB，支撑下载级断点续传）
 *
 * 存储模型（v3 起）：tasks 库以 task.id 为 key 逐条存储，并建立 uin 索引，
 * add/update 均为单条读写，避免每次更新都重写整个任务数组。
 *
 * v3.2 性能修复（2026-08-07）：
 *  - add() 不再调用 this.all() 全量加载来去重，改为逐条 get() 检查。
 *    （全量加载 50000 个 DownloadTask 仅为了构建一个 Set<id>，纯属浪费。）
 *  - clearAll() 改用 uin 索引取出主键后批量删除，不再加载完整任务对象。
 */

export type TaskState = 'pending' | 'in_progress' | 'paused' | 'complete' | 'interrupted';

/** 下载器类型 */
export type TrackerType = 'disk' | 'browser' | 'aria2' | 'none';

/** 单个下载任务（持久化到 IndexedDB 的精简视图） */
export interface DownloadTask {
    /** 任务唯一ID（url+目标路径哈希或uid） */
    id: string;
    /** 所属 QQ 号（用于索引查询，避免全表扫描） */
    uin: number | string;
    /** 所属模块 */
    module: string;
    /** 下载地址 */
    url: string;
    /** 相对目录 */
    dir: string;
    /** 文件名（含后缀） */
    name: string;
    /** 状态 */
    state: TaskState;
    /** 浏览器下载管理器ID（chrome.downloads分配，0表示未分配） */
    downloadId?: number;
    /** Aria2 任务 ID（用于 tellStatus/pause/resume/cancel） */
    aria2Gid?: string;
    /** 已重试次数 */
    retries?: number;
    /** 下载优先级（视频任务置 1，普通媒体为 0），用于续传恢复时保持优先插队语义 */
    priority?: number;
    /** 文件字节数（已知时用于「已存在且大小匹配」跳过判断） */
    size?: number;
    /** 最后错误信息 */
    error?: string;
    /** 所属条目 ID（说说 tid / 日志 blogId / 相册 albumId 等） */
    ownerId?: string;
    /** 所属内容摘要（说说前 20 字 / 相册名 / 日志标题） */
    ownerTitle?: string;
    /** 缩略图 URL（失败时仍能展示大概） */
    thumbUrl?: string;
    /** 下载器类型 */
    trackerType?: TrackerType;
}

/** 实时内存视图 */
export interface LiveDownloadTask extends DownloadTask {
    downloadedBytes?: number;
    totalBytes?: number;
    speedBps?: number;
    startedAt?: number;
    updatedAt?: number;
    etaMs?: number;
    lastSampleBytes?: number;
    lastSampleAt?: number;
    speedSamples?: number[];
}


export type QueueLog = (level: string, msg: string) => void;

export class TaskQueue {
    private dbPromise: Promise<IDBPDatabase>;
    private log?: QueueLog;

    constructor(readonly uin: number | string, log?: QueueLog) {
        this.dbPromise = openQzoneDb();
        this.log = log;
    }

    /**
     * 读取本 uin 的全部任务（经 uin 索引）。
     * 注意：任务数极大时（5 万+）仍会全部加载到内存。
     * 高频路径（add/update）已改用逐条/游标读写，不走此方法。
     */
    async all(): Promise<DownloadTask[]> {
        const db = await this.dbPromise;
        return (await db.getAllFromIndex(STORE_TASKS, INDEX_TASKS_UIN, this.uin)) as DownloadTask[];
    }

    /** 单条写入/覆盖（keyPath=id） */
    private async putOne(task: DownloadTask): Promise<void> {
        const db = await this.dbPromise;
        await db.put(STORE_TASKS, { ...task, uin: this.uin });
    }

    /** 批量单条写入（事务内完成） */
    private async putMany(tasks: DownloadTask[]): Promise<void> {
        if (tasks.length === 0) return;
        const db = await this.dbPromise;
        const tx = db.transaction(STORE_TASKS, 'readwrite');
        for (const task of tasks) {
            void tx.store.put({ ...task, uin: this.uin });
        }
        await tx.done;
    }

    /**
     * 追加任务（按 id 去重）。
     * 不再调用 this.all() 全量加载；改为逐条 get() 检查，每批次仅 O(n) 次小读。
     */
    async add(tasks: DownloadTask[]): Promise<number> {
        if (tasks.length === 0) return 0;
        const db = await this.dbPromise;
        const tx = db.transaction(STORE_TASKS, 'readwrite');
        let appended = 0;
        for (const task of tasks) {
            const existing = await tx.store.get(task.id) as DownloadTask | undefined;
            // 仅跳过同 uin 的重复任务；不同 uin 允许覆盖（id 即 keyPath）
            if (existing && existing.uin === this.uin) continue;
            tx.store.put({ ...task, uin: this.uin });
            appended++;
        }
        await tx.done;
        return appended;
    }

    /** 更新单任务状态（仅读取并写回该条记录） */
    async update(id: string, patch: Partial<DownloadTask>): Promise<void> {
        const db = await this.dbPromise;
        const current = (await db.get(STORE_TASKS, id)) as DownloadTask | undefined;
        if (!current) {
            this.log?.('WARN', `[Queue] uin=${this.uin} 更新缺失任务 ${id}，跳过`);
            return;
        }
        const newState = patch.state ?? current.state;
        await db.put(STORE_TASKS, { ...current, ...patch, id, uin: this.uin });
    }

    /** 读取单条任务（按 id） */
    async getOne(id: string): Promise<DownloadTask | undefined> {
        const db = await this.dbPromise;
        return (await db.get(STORE_TASKS, id)) as DownloadTask | undefined;
    }

    /** 待处理任务（pending + 中断/进行中，用于续传重新入队） */
    async pending(): Promise<DownloadTask[]> {
        const tasks = await this.all();
        const remaining = tasks.filter((task) => task.state !== 'complete');
        this.log?.('INFO', `[Queue] uin=${this.uin} 待处理任务 ${remaining.length}/${tasks.length} 条（含 pending/in_progress/paused/interrupted）`);
        return remaining;
    }

    /** 按状态统计 */
    async stats(): Promise<Record<TaskState, number>> {
        const tasks = await this.all();
        const stats: Record<TaskState, number> = { pending: 0, in_progress: 0, paused: 0, complete: 0, interrupted: 0 };
        for (const task of tasks) {
            stats[task.state] = (stats[task.state] || 0) + 1;
        }
        return stats;
    }

    /**
     * 清空本 uin 的全部下载任务记录。
     * 不再加载完整任务对象 —— 改用 uin 索引直接取主键后批量删除。
     */
    async clearAll(): Promise<number> {
        const db = await this.dbPromise;
        const tx = db.transaction(STORE_TASKS, 'readwrite');
        const index = tx.store.index(INDEX_TASKS_UIN);
        const keys = await index.getAllKeys(this.uin);
        for (const key of keys) {
            tx.store.delete(key);
        }
        await tx.done;
        this.log?.('INFO', `[Queue] uin=${this.uin} 清理 ${keys.length} 条旧任务记录`);
        return keys.length;
    }

    /**
     * 清空整个 tasks store 的所有下载任务记录（无视 uin）。
     * 用于备份启动时彻底清理历史残留 —— 避免多账号切换备份时，旧 uin 的任务
     * 永久残留、长期累积撑满 IndexedDB 配额导致浏览器卡死。
     * 注意：会清除其它 uin 的下载续传记录（一般备份场景不需要跨账号续传）。
     */
    async clearAllGlobal(): Promise<number> {
        const db = await this.dbPromise;
        const tx = db.transaction(STORE_TASKS, 'readwrite');
        const keys = await tx.store.getAllKeys();
        for (const key of keys) {
            tx.store.delete(key);
        }
        await tx.done;
        this.log?.('INFO', `[Queue] 清理全部 uin 共计 ${keys.length} 条旧任务记录`);
        return keys.length;
    }

    /** 清空本 uin 的所有任务（同一事务内完成） */
    async clear(): Promise<void> {
        const db = await this.dbPromise;
        const tx = db.transaction(STORE_TASKS, 'readwrite');
        const keys = await tx.store.index(INDEX_TASKS_UIN).getAllKeys(this.uin);
        for (const key of keys) {
            tx.store.delete(key);
        }
        await tx.done;
        this.log?.('INFO', `[Queue] uin=${this.uin} 已清空 ${keys.length} 条持久化下载任务`);
    }
}
