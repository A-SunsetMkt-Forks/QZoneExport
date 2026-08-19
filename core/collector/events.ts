/**
 * 备份进度事件总线（替代旧版直接操作DOM的StatusIndicator耦合）
 */

/** 进度事件 */
export interface ProgressEvent {
    /** 模块名（Messages/Blogs/...，整体事件为 * ) */
    module: string;
    /** 阶段（list/comments/likes/visitors/export/download...） */
    phase: string;
    /** 已完成条目数 */
    done: number;
    /** 总条目数（未知为-1） */
    total: number;
    /** 失败条目数（请求失败跳过的） */
    failed?: number;
    /** 当前处理对象的描述标签（如相册名，显示在阶段名后） */
    label?: string;
    /** 已传输字节数（下载阶段可选） */
    bytes?: number;
    /** 速度（字节/秒，下载阶段可选） */
    speed?: number;
    /** 主体对齐进度（采集层改造：collector 对主体阶段显式上报 subject，聚合层直接读，不靠猜 phase 名） */
    subject?: { done: number; total: number };
}

/**
 * 引擎生命周期事件
 * module-error / request-retry 带可选 category（错误分类，见 shared/errors.ts），
 * 供 UI 按类给针对性提示（未登录/限流/超时…）
 */
export type EngineEvent =
    | { type: 'progress'; data: ProgressEvent }
    | { type: 'module-start'; module: string }
    | { type: 'module-complete'; module: string }
    | { type: 'module-error'; module: string; error: string; category?: string; api?: string }
    /** 接口请求失败待重试（与模块采集异常区分：这是可自恢复的临时态） */
    | { type: 'request-retry'; message: string; remain: number; retryAt: number; category?: string; inFlight?: number; api?: string }
    /** 接口请求恢复正常（用于清除重试提示） */
    | { type: 'request-recover' }
    | { type: 'paused' }
    | { type: 'resumed' }
    | { type: 'cancelled' }
    | { type: 'completed' }
    /** 页级可靠性汇总（本轮备份结束、断点补偿收尾后）：failed/missing 为仍残留待补页数，dead 为重试耗尽 */
    | { type: 'reliability-summary'; data: { uin: number; batchId: string; failed: number; missing: number; dead: number } };

export type EngineEventListener = (event: EngineEvent) => void;

/**
 * 简单事件总线
 */
export class EventBus {
    private listeners = new Set<EngineEventListener>();

    on(listener: EngineEventListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    emit(event: EngineEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (error) {
                console.error('进度事件监听器异常', error);
            }
        }
    }
}
