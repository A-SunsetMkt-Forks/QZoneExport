import type { BackupCheckpoint, CheckpointStore, ModuleCheckpoint } from './checkpoint';
import { makeBatchId, PageLedger } from './reliability';
import { EventBus, type ProgressEvent } from './events';

/**
 * 备份采集编排器
 * 替代 content.js QZoneOperator.next() 的硬编码状态机（L945-1068）：
 * - 声明式模块序列，支持暂停/取消/单模块重跑
 * - 断点续传：已完成模块直接跳过，进行中模块从「阶段×游标」续采
 */

/** 模块采集器运行时上下文 */
export interface CollectContext {
    /** 备份目标QQ */
    uin: number;
    /** 模块断点（续传时为上次进度，全新为undefined） */
    checkpoint?: ModuleCheckpoint;
    /** 上报进度（同时驱动checkpoint落盘） */
    report(progress: Omit<ProgressEvent, 'module'> & { completed?: boolean }): Promise<void>;
    /** 暂停/取消检查点：collector应在每个分页/条目边界调用 */
    tick(): Promise<void>;
    /** 页级可靠性账本（持久化在 chrome.storage.local，跨子域/换页可读） */
    ledger: PageLedger;
    /** 本次备份运行标识（区分多次备份，旧 batch 的 failed 记录不参与补偿） */
    batchId: string;
    /** 手动重试模式：仅对 ledger 中 failed/missing 页重采，跳过正常枚举 */
    retryMode?: boolean;
}

/** 模块采集器接口（各业务模块实现） */
export interface ModuleCollector {
    /** 模块名（Messages/Blogs/...） */
    module: string;
    /** 执行采集（内部按分页推进，通过ctx.tick()响应暂停/取消） */
    collect(ctx: CollectContext): Promise<void>;
    /** 断点续传：从 staging 恢复数据，只注册媒体+写导出（可选，未实现则回退 collect） */
    restore?(ctx: CollectContext): Promise<void>;
    /** 断点补偿：仅重采 ledger 中 failed/missing 页（手动重试用，可选） */
    retryFailedPages?(ctx: CollectContext): Promise<void>;
}

/** 取消信号错误 */
export class CancelledError extends Error {
    constructor() {
        super('备份已取消');
        this.name = 'CancelledError';
    }
}

export type PipelineState = 'idle' | 'running' | 'paused' | 'cancelled' | 'completed';

export interface PipelineOptions {
    uin: number;
    collectors: ModuleCollector[];
    checkpointStore: CheckpointStore;
    /** 页级可靠性账本（持久化在 chrome.storage.local）；不传则使用默认实例 */
    ledger?: PageLedger;
    events?: EventBus;
    /** 模块采集异常时是否继续后续模块（与旧版行为一致，默认true） */
    continueOnError?: boolean;
}

export class Pipeline {
    readonly events: EventBus;
    private state: PipelineState = 'idle';
    private pauseWaiters: Array<() => void> = [];

    constructor(private readonly options: PipelineOptions) {
        this.events = options.events || new EventBus();
    }

    getState(): PipelineState {
        return this.state;
    }

    /** 暂停（在下一个tick边界生效） */
    pause(): void {
        if (this.state === 'running') {
            this.state = 'paused';
            this.events.emit({ type: 'paused' });
        }
    }

    /** 恢复运行 */
    resume(): void {
        if (this.state === 'paused') {
            this.state = 'running';
            this.events.emit({ type: 'resumed' });
            const waiters = this.pauseWaiters;
            this.pauseWaiters = [];
            waiters.forEach((resolve) => resolve());
        }
    }

    /** 取消（在下一个tick边界生效，断点保留供下次续传） */
    cancel(): void {
        if (this.state === 'running' || this.state === 'paused') {
            const wasPaused = this.state === 'paused';
            this.state = 'cancelled';
            this.events.emit({ type: 'cancelled' });
            if (wasPaused) {
                const waiters = this.pauseWaiters;
                this.pauseWaiters = [];
                waiters.forEach((resolve) => resolve());
            }
        }
    }

    /**
     * 运行备份
     * @param resumeFrom 传入未完成断点则续传；不传则全新开始
     */
    async run(resumeFrom?: BackupCheckpoint): Promise<PipelineState> {
        const { uin, collectors, checkpointStore, ledger = new PageLedger(), continueOnError = true } = this.options;
        const batchId = makeBatchId();

        // 状态必须在首个await前同步置位，否则run后立即pause会被忽略
        this.state = 'running';
        const checkpoint = resumeFrom || (await checkpointStore.start(uin, collectors.map((collector) => collector.module)));

        for (const collector of collectors) {
            if ((this.state as PipelineState) === 'cancelled') {
                break;
            }
            const moduleCp = checkpoint.modules[collector.module];
            if (moduleCp && moduleCp.completed) {
                // 断点续传：已完成模块从 staging 恢复数据，不请求网络
                this.events.emit({ type: 'module-start', module: collector.module });
                try {
                    const restoreCtx: CollectContext = {
                        uin,
                        checkpoint: moduleCp,
                        ledger,
                        batchId,
                        retryMode: false,
                        report: async (progress) => {
                        this.events.emit({
                            type: 'progress',
                            data: { module: collector.module, phase: progress.phase, done: progress.done, total: progress.total, failed: progress.failed, label: progress.label, subject: progress.subject },
                        });
                        },
                        tick: () => this.tick(),
                    };
                    if (collector.restore) {
                        await collector.restore(restoreCtx);
                    } else {
                        // 未实现 restore 的模块回退全量采集
                        await collector.collect(restoreCtx);
                    }
                    this.events.emit({ type: 'module-complete', module: collector.module });
                } catch (error: any) {
                    if (error instanceof CancelledError) {
                        break;
                    }
                    this.events.emit({ type: 'module-error', module: collector.module, error: error?.message || String(error) });
                    if (!continueOnError) {
                        throw error;
                    }
                }
                continue;
            }

            this.events.emit({ type: 'module-start', module: collector.module });
            try {
                await collector.collect({
                    uin,
                    checkpoint: moduleCp,
                    ledger,
                    batchId,
                    retryMode: false,
                    report: async (progress) => {
                        const next: ModuleCheckpoint = {
                            phase: progress.phase,
                            cursor: progress.done,
                            done: progress.done,
                            total: progress.total,
                            completed: progress.completed || false,
                        };
                        checkpoint.modules[collector.module] = next;
                        await checkpointStore.updateModule(uin, collector.module, next);
                        this.events.emit({
                            type: 'progress',
                            data: { module: collector.module, phase: progress.phase, done: progress.done, total: progress.total, failed: progress.failed, label: progress.label, bytes: progress.bytes, speed: progress.speed, subject: progress.subject },
                        });
                    },
                    tick: () => this.tick(),
                });
                // collector正常结束视为模块完成
                const finalCp = checkpoint.modules[collector.module];
                if (!finalCp || !finalCp.completed) {
                    const completedCp: ModuleCheckpoint = {
                        phase: finalCp?.phase || 'done',
                        cursor: finalCp?.cursor || 0,
                        done: finalCp?.done || 0,
                        total: finalCp?.total ?? -1,
                        completed: true,
                    };
                    checkpoint.modules[collector.module] = completedCp;
                    await checkpointStore.updateModule(uin, collector.module, completedCp);
                }
                this.events.emit({ type: 'module-complete', module: collector.module });
            } catch (error: any) {
                if (error instanceof CancelledError) {
                    break;
                }
                // 与旧版一致：单模块异常记录后继续后续模块
                this.events.emit({ type: 'module-error', module: collector.module, error: error?.message || String(error) });
                if (!continueOnError) {
                    throw error;
                }
            }
        }

        if ((this.state as PipelineState) === 'cancelled') {
            // 断点保留，供下次「是否从中断处继续」
            return this.state;
        }
        await checkpointStore.complete(uin);
        // 断点补偿收尾：清掉旧 batch 账本，统计本 batch 残留失败/丢失/死页并汇总
        let failed = 0;
        let missing = 0;
        let dead = 0;
        for (const collector of collectors) {
            const module = collector.module;
            await ledger.pruneOtherBatches(String(uin), module, batchId);
            const pages = await ledger.list(String(uin), module);
            for (const p of pages) {
                // 死页（dead）为跨 batch 保留的终态，需一并计入汇总；其余状态仅统计当前 batch
                if (p.batchId !== batchId && p.state !== 'dead') continue;
                if (p.state === 'failed') failed++;
                else if (p.state === 'missing') missing++;
                else if (p.state === 'dead') dead++;
            }
        }
        this.events.emit({ type: 'reliability-summary', data: { uin, batchId, failed, missing, dead } });
        this.state = 'completed';
        this.events.emit({ type: 'completed' });
        return this.state;
    }

    /** 暂停/取消检查点 */
    private async tick(): Promise<void> {
        if (this.state === 'cancelled') {
            throw new CancelledError();
        }
        if (this.state === 'paused') {
            await new Promise<void>((resolve) => this.pauseWaiters.push(resolve));
            // 恢复后再次检查是否已被取消
            if ((this.state as PipelineState) === 'cancelled') {
                throw new CancelledError();
            }
        }
    }
}
