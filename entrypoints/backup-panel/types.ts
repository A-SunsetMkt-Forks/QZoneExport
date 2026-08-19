/**
 * 备份面板类型定义
 */

export interface PanelOpenOptions {
    mode: 'zip' | 'directory';
    directoryName?: string;
    /** 用户在选择模块弹窗中勾选的模块总数，固定不变（用于「X/Y 模块」统计，见 #7） */
    totalModules?: number;
    /** 用户勾选的模块标识列表（用于概览展示全部模块进度，含「未开始」状态） */
    selectedModules?: string[];
    /** 是否他人空间：决定私有模块（日记/好友/收藏）是否标注「无权限」而非「未选择」 */
    isOtherSpace?: boolean;
}

export interface ProgressData {
    module: string;
    phase: string;
    done: number;
    total: number;
    failed?: number;
    label?: string;
    /** 主体对齐进度（采集层改造：collector 经 report 显式上报 subject，聚合层直接读） */
    subject?: { done: number; total: number };
}

export type PanelEvent =
    | { type: 'progress'; data: ProgressData }
    | { type: 'module-start'; module: string }
    | { type: 'module-complete'; module: string }
    | { type: 'module-error'; module: string; error: string; category?: string }
    | { type: 'request-retry'; message: string; remain: number; retryAt: number; category?: string }
    | { type: 'request-recover' }
    | { type: 'paused' }
    | { type: 'resumed' };

export type PanelAction = 'download-zip' | 'retry-downloads' | 'close';

export interface BackupPanelAPI {
    open(options: PanelOpenOptions): void;
    dispatch(event: PanelEvent): void;
    setStage(text: string, status?: string): void;
    /**
     * 进入「整理备份文件」收尾阶段：下载已全部出结论（总进度已 100%），
     * 但生成查看器 / 合并外部文件尚未完成。主状态行持续显示终态前提示，
     * 由 complete() 调用后才放行到 100%。
     */
    beginFinalize(text: string): void;
    complete(result: { mode: 'zip' | 'directory'; needMerge?: boolean; mediaLinkMode?: boolean }): void;
    error(message: string): void;
    close(): void;
    onAction(cb: (action: PanelAction) => void): void;
    waitForDirectory(onSelect: () => Promise<string>): Promise<void>;
    confirm(message: string): Promise<boolean>;
    alert(message: string): Promise<void>;
}
