/**
 * 下载器驱动接口（v3 替代旧 common.js 三种下载器）
 * 每个 driver 负责一种下载方式：browser / disk / aria2
 */

export type DriverType = 'browser' | 'disk' | 'aria2';

/** 提交给 driver 的下载请求（DM 内部 LiveTask 的精简视图） */
export interface DownloadRequest {
    id: string;
    module: string;
    url: string;
    dir: string;
    name: string;
    ownerId?: string | number;
    ownerTitle?: string;
    thumbUrl?: string;
    totalBytes?: number;
    /** 备份根目录名（如 QQ空间备份_<uin>），用于浏览器/aria2 下载的顶层路径包裹 */
    rootFolderName?: string;
}

/** 下载进度回调（driver → DM） */
export interface ProgressReporter {
    onProgress?: (downloadedBytes: number, totalBytes: number) => void;
    onState?: (state: 'in_progress' | 'complete' | 'interrupted' | 'paused', error?: string) => void;
}

/** 驱动统一接口 */
export interface DownloadDriver {
    readonly type: DriverType;
    /** 提交单个下载任务，返回下载器侧标识（如 browser downloadId / aria2 gid），失败抛错 */
    submit(req: DownloadRequest, reporter: ProgressReporter): Promise<{ trackerId?: number | string; error?: string }>;
    /** 暂停（仅 browser / aria2 有意义） */
    pause?(trackerId: number | string): Promise<void>;
    /** 恢复 */
    resume?(trackerId: number | string): Promise<void>;
    /** 取消 */
    cancel?(trackerId: number | string): Promise<void>;
}
