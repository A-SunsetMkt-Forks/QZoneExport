/**
 * DownloadManager 类型安全访问封装
 *
 * 消除 backup-panel 中 17 处 `(window as any).QZoneDownloadManager`，
 * 提供类型推断与 null 安全。
 */

import type { DownloadManager } from '../../core/downloader/manager';

/** 类型安全的 DM 接口子集（panel 实际使用的方法） */
export interface DmApi {
    /** 按事件名订阅；返回取消订阅函数。事件：task-added / task-updated / stats / log / task-error */
    subscribe?(event: 'task-added' | 'task-updated' | 'stats' | 'log' | 'task-error', listener: (payload: any) => void): () => void;
    stats?(): DmStats;
    tasksSorted?(): DmTask[];
    logs?(): DmLogItem[];
    clearLogs?(): void;
    log?(level: string, msg: string, extra?: unknown): void;
    exportLogs?(format: 'txt' | 'json', opts?: { level?: string; includeExtra?: boolean }): string;
    globalProgress?(): DmProgress;
    /**
     * 按模块聚合媒体下载进度（合成总进度用）。
     * 返回每个模块的 `{ overallPercent, totalTasks }`；`totalTasks===0` 表示该模块无媒体。
     */
    moduleProgressMap?(): Record<string, { overallPercent: number; totalTasks: number }> | null;

    /** Firefox 形态 B：文案/查看器落盘进度（写文件 N/M），null 表示无进行中的文案写入 */
    getMetaWriteProgress?(): { done: number; total: number } | null;

    pauseAll?(): Promise<void>;
    resumeAll?(): Promise<void>;
    retryFailed?(): Promise<void>;
    pauseTask?(id: string): Promise<void>;
    resumeTask?(id: string): Promise<void>;
    retryTask?(id: string): Promise<void>;
    cancelTask?(id: string): Promise<void>;
}

export interface DmStats {
    total?: number;
    complete?: number;
    in_progress?: number;
    interrupted?: number;
    paused?: number;
    pending?: number;
}

export interface DmTask {
    id: string;
    state: string;
    module?: string;
    name?: string;
    url?: string;
    dir?: string;
    ownerId?: string;
    ownerTitle?: string;
    thumbUrl?: string;
    trackerType?: string;
    downloadedBytes?: number;
    totalBytes?: number;
    speedBps?: number;
    etaMs?: number;
    retries?: number;
    error?: string;
}

export interface DmLogItem {
    ts?: number;
    level?: string;
    message?: string;
    msg?: string;
    items?: DmLogItem[];
}

/**
 * 进度快照（对应 core/downloader/manager.ts 的 GlobalProgress）。
 * 全部可选是为了兼容旧版 DM 实例（面板可能挂在尚未更新的引擎上）。
 *
 * 判定「下载是否结束」请用 `isSettled`，不要用 `settledPercent >= 100`
 * —— 百分比是展示值，计数才是判定依据。
 */
export interface DmProgress {
    totalBytes?: number;
    downloadedBytes?: number;
    speedBps?: number;
    etaMs?: number;
    /** 成功完成度（0-100），所有任务计入分母，未知 size 计 0。失败任务记 0 */
    percent?: number;
    /** 已到终态（成功 + 失败）的任务数 */
    settled?: number;
    /** 成功任务数 */
    succeeded?: number;
    /** 失败任务数 */
    failed?: number;
    /** 尚无结论（排队 + 下载中 + 已暂停）的任务数 */
    unsettled?: number;
    /** 排队中任务数 */
    pending?: number;
    /** 下载中任务数 */
    running?: number;
    /** 已暂停任务数 */
    paused?: number;
    /**
     * 任务总数。不变式：`succeeded + failed + pending + running + paused === totalTasks`。
     * 渲染层只需这一份快照即可覆盖全部计数展示，不要再另调 `stats()` 混算。
     */
    totalTasks?: number;
    /** 处理进度（0-100）：已有结论的任务占比，全部跑完（含失败）即 100 */
    settledPercent?: number;
    /** 失败任务占比（0-100），用于进度条红色失败段 */
    failedPercent?: number;
    /**
     * 【面板主数字】总进度（0-100）：成功按字节比、失败按满权重计入，
     * 下载环节结束后必定 100%。旧 DM 实例可能没有此字段，渲染层需兜底。
     */
    overallPercent?: number;
    /** 【完成判定】下载环节是否已全部出结论 */
    isSettled?: boolean;
}

/** 获取 window 上的 DownloadManager 实例（类型安全） */
export function getDM(): DmApi | null {
    const dm = (typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>).QZoneDownloadManager : undefined) as DownloadManager | undefined;
    if (!dm) return null;
    return dm as unknown as DmApi;
}
