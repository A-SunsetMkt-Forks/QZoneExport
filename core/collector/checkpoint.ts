import { normalizeForDedup } from '../shared/url';
import { type KvArea, defaultArea } from '../store/backup-db';

/**
 * 断点续传「已下载集合」的键分隔符。
 * 旧版只存纯 URL（全局去重），会导致跨模块误杀：A 模块下载过的图片，
 * B 模块（如收藏）引用同一 URL 时被判定「已下载」而跳过，但 B 模块目录里
 * 该文件从未落盘，查看器找不到本地文件只能回退外链。
 * 新版以 `dir<SEP>url` 为键（目录级 / 模块级去重）：同一文件只在「同一目录」
 * 才被认为已下载，其它模块目录会独立下载自己的副本。该分隔符不会出现在
 * 目录名（如 Favorites/images）或 URL 中，可安全用于拼接/拆分。
 */
export const DL_DOWNLOADED_SEP = '\u0000';

/**
 * 单次备份的断点续传存储
 * checkpoint粒度：模块 × 阶段 × 分页游标；采集数据边采边落staging
 * 前提约束：登录态有效且源数据未变时，恢复才有意义（由调用方提示用户选择）
 *
 * 存储后端：注入式 KvArea（默认 chrome.storage.local）。
 * 关键修复（v3 断点续传重构）：此前后端是「content script 所在页面 origin 的
 * IndexedDB」，而 QZone 各模块落在不同子域（user/blog/qzonemood...）属不同 origin，
 * 换子域/换页/换账号后续传页读不到断点 → getPending 返回 undefined → 编排层退化为
 * 全新备份（清 staging + 重置 modules），表现为「已完成模块也被整段重采」。
 * chrome.storage.local 是扩展 origin 的共享存储，跨子域/换页/换账号续传页都能读到，
 * 从根上消除该结构性缺陷。
 */

/** 单模块采集断点 */
export interface ModuleCheckpoint {
    /** 当前阶段（如 list/comments/likes/visitors/export），由各模块collector自定义 */
    phase: string;
    /** 分页游标（已完成的页数或偏移量） */
    cursor: number;
    /** 已采集条目数 */
    done: number;
    /** 总条目数（未知为-1） */
    total: number;
    /** 模块是否已完成 */
    completed: boolean;
}

/** 单次备份断点 */
export interface BackupCheckpoint {
    /** 备份目标QQ */
    uin: number;
    /** 本次备份启动时间 */
    startedAt: number;
    /** 本次备份勾选的模块 */
    selectedModules: string[];
    /** 各模块断点 */
    modules: Record<string, ModuleCheckpoint>;
    /** 整体是否完成 */
    completed: boolean;
}

/** 键前缀（与 BackupDb 的 backup:/backup_meta: 命名空间隔离，互不干扰） */
const CP_PREFIX = 'cp:'; // cp:<uin> -> BackupCheckpoint
const STAGING_PREFIX = 'staging:'; // staging:<uin>:<module> -> 模块采集暂存
const DL_PREFIX = 'dl:'; // dl:<uin> -> 已下载集合 string[]

/**
 * 已知模块名清单（与采集引擎 MODULE_ORDER 对齐）。
 * clearStaging 直接移除该 uin 名下「已知模块 + _downloaded」的暂存键，
 * 避免 `get(null)` 枚举全量 storage（会拉取大型 backup 行数据）。
 * 新增模块时务必同步此处，否则其 staging 在 clearStaging 时不会被清（仅残留、不影响续传正确性）。
 */
const MODULE_NAMES = ['Messages', 'Blogs', 'Diaries', 'Photos', 'Videos', 'Boards', 'Friends', 'Favorites', 'Shares', 'Visitors'];

export class CheckpointStore {
    private readonly area: KvArea;

    constructor(area?: KvArea) {
        this.area = area ?? defaultArea();
    }

    private cpKey(uin: number | string): string {
        return CP_PREFIX + uin;
    }

    /** 读取未完成的备份断点（无或已完成返回undefined） */
    async getPending(uin: number | string): Promise<BackupCheckpoint | undefined> {
        const key = this.cpKey(uin);
        const res = await this.area.get(key);
        const checkpoint = res[key] as BackupCheckpoint | undefined;
        if (!checkpoint || checkpoint.completed) {
            return undefined;
        }
        return checkpoint;
    }

    /** 开始新备份（覆盖旧断点并清空暂存数据） */
    async start(uin: number, selectedModules: string[]): Promise<BackupCheckpoint> {
        const checkpoint: BackupCheckpoint = {
            uin,
            startedAt: Date.now(),
            selectedModules,
            modules: {},
            completed: false,
        };
        await this.area.set({ [this.cpKey(uin)]: checkpoint });
        await this.clearStaging(uin);
        return checkpoint;
    }

    /** 更新单模块断点 */
    async updateModule(uin: number | string, module: string, moduleCheckpoint: ModuleCheckpoint): Promise<void> {
        const key = this.cpKey(uin);
        const res = await this.area.get(key);
        const checkpoint = res[key] as BackupCheckpoint | undefined;
        if (!checkpoint) {
            return;
        }
        checkpoint.modules[module] = moduleCheckpoint;
        await this.area.set({ [key]: checkpoint });
    }

    /** 标记整体完成（保留断点记录以供查询，pending判断依赖completed标记） */
    async complete(uin: number | string): Promise<void> {
        const key = this.cpKey(uin);
        const res = await this.area.get(key);
        const checkpoint = res[key] as BackupCheckpoint | undefined;
        if (!checkpoint) {
            return;
        }
        checkpoint.completed = true;
        await this.area.set({ [key]: checkpoint });
    }

    /** 丢弃断点（用户选择重新开始时） */
    async discard(uin: number | string): Promise<void> {
        await this.area.remove(this.cpKey(uin));
        await this.clearStaging(uin);
    }

    /** 暂存模块采集数据（边采边落，替代全量驻留内存） */
    async saveStaging(uin: number | string, module: string, data: unknown): Promise<void> {
        // 采集数据来自 content script 内的纯 TS collector，非 Vue 响应式对象，
        // 故无需 toPlain；chrome.storage 的 JSON 序列化即可正确落盘。
        await this.area.set({ [`${STAGING_PREFIX}${uin}:${module}`]: data });
    }

    /** 读取模块暂存数据 */
    async loadStaging<T = unknown>(uin: number | string, module: string): Promise<T | undefined> {
        const key = `${STAGING_PREFIX}${uin}:${module}`;
        const res = await this.area.get(key);
        return res[key] as T | undefined;
    }

    /** 清空指定QQ的全部暂存数据（含断点续传已下载集合 _downloaded）。
     *  直接按已知键移除，不枚举全量 storage。 */
    async clearStaging(uin: number | string): Promise<void> {
        const keys: string[] = [`${DL_PREFIX}${uin}`];
        for (const m of MODULE_NAMES) {
            keys.push(`${STAGING_PREFIX}${uin}:${m}`);
        }
        await this.area.remove(keys);
    }

    /** 标记 URL 已下载完成（供续传时跳过已完成的下载任务），按目录键 */
    async markDownloaded(uin: number | string, dir: string, url: string): Promise<void> {
        const key = `${DL_PREFIX}${uin}`;
        const res = await this.area.get(key);
        const set = (res[key] as string[] | undefined) || [];
        // 去重键剥离防盗链 token/key 等查询参数（与 isAlreadyDownloaded 读取侧保持一致）：
        // QQ 媒体地址的 token 每次会话都不同，跨会话续传时去参后才判为「同一资源已下载」，避免重复下载。
        const k = dir + DL_DOWNLOADED_SEP + normalizeForDedup(url);
        if (!set.includes(k)) {
            set.push(k);
            await this.area.set({ [key]: set });
        }
    }

    /** 批量标记 URL 已下载（每项带目录，用于目录级去重） */
    async markDownloadedBatch(uin: number | string, entries: Array<{ url: string; dir?: string }>): Promise<void> {
        if (entries.length === 0) return;
        const key = `${DL_PREFIX}${uin}`;
        const res = await this.area.get(key);
        const set = new Set((res[key] as string[] | undefined) || []);
        for (const { url, dir } of entries) {
            // 去重键剥离 token（与 markDownloaded 单条、isAlreadyDownloaded 读取侧保持一致）
            set.add((dir || '') + DL_DOWNLOADED_SEP + normalizeForDedup(url));
        }
        await this.area.set({ [key]: [...set] });
    }

    /** 获取已下载集合（目录级键 `dir<SEP>url`） */
    async getDownloadedUrls(uin: number | string): Promise<Set<string>> {
        const key = `${DL_PREFIX}${uin}`;
        const res = await this.area.get(key);
        const list = (res[key] as string[] | undefined) || [];
        // 仅保留含分隔符的新格式条目；旧版纯 URL 条目（无分隔符，全局去重语义）
        // 视为失效并丢弃，对应文件会在本轮重新下载——这正是模块级去重要消除的
        // 「跨模块误跳」，且重新下载无数据丢失风险。
        return new Set(list.filter((k) => k.includes(DL_DOWNLOADED_SEP)));
    }
}
