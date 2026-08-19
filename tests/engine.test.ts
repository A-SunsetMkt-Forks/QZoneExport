import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { CheckpointStore } from '../core/collector/checkpoint';
import { type KvArea } from '../core/store/backup-db';
import { CancelledError, Pipeline, type CollectContext, type ModuleCollector } from '../core/collector/pipeline';
import { PageLedger } from '../core/collector/reliability';

/** 内存版 KvArea（支持 get(null) 枚举全量），用于单测，不依赖 chrome.storage.local */
function memoryKvArea(): KvArea {
    const store: Record<string, unknown> = {};
    return {
        async get(keys) {
            if (keys === null) return { ...store };
            const result: Record<string, unknown> = {};
            const list = Array.isArray(keys) ? keys : [keys];
            for (const k of list) if (store[k] !== undefined) result[k] = store[k];
            return result;
        },
        async set(items) {
            Object.assign(store, items);
        },
        async remove(keys) {
            for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k];
        },
    };
}
import type { EngineEvent } from '../core/collector/events';
import { retryWithBackoff, runPool } from '../core/downloader/pool';
import { TaskQueue, type DownloadTask } from '../core/downloader/task-queue';

/** 构造分页式模拟采集器 */
function fakeCollector(module: string, pages: number, log: string[]): ModuleCollector {
    return {
        module,
        async collect(ctx: CollectContext) {
            // 断点续传：从上次游标继续
            const startPage = ctx.checkpoint ? ctx.checkpoint.cursor : 0;
            for (let page = startPage; page < pages; page++) {
                await ctx.tick();
                log.push(`${module}:${page}`);
                await ctx.report({ phase: 'list', done: page + 1, total: pages });
            }
            await ctx.report({ phase: 'list', done: pages, total: pages, completed: true });
        },
    };
}

describe('Pipeline 声明式编排', () => {
    it('顺序执行全部模块并标记完成', async () => {
        const store = new CheckpointStore(memoryKvArea());
        const log: string[] = [];
        const events: EngineEvent[] = [];
        const pipeline = new Pipeline({
            uin: 1001,
            collectors: [fakeCollector('Messages', 2, log), fakeCollector('Blogs', 1, log)],
            checkpointStore: store,
            ledger: new PageLedger(memoryKvArea()),
        });
        pipeline.events.on((event) => events.push(event));

        const state = await pipeline.run();
        expect(state).toBe('completed');
        expect(log).toEqual(['Messages:0', 'Messages:1', 'Blogs:0']);
        expect(await store.getPending(1001)).toBeUndefined();
        expect(events.some((event) => event.type === 'completed')).toBe(true);
        expect(events.filter((event) => event.type === 'module-complete').length).toBe(2);
    });

    it('取消后断点保留，续传跳过已完成模块并从游标继续', async () => {
        const store = new CheckpointStore(memoryKvArea());
        const log: string[] = [];
        // Messages 采集到第2页时取消
        const cancelAt2: ModuleCollector = {
            module: 'Messages',
            async collect(ctx) {
                const startPage = ctx.checkpoint ? ctx.checkpoint.cursor : 0;
                for (let page = startPage; page < 4; page++) {
                    await ctx.tick();
                    log.push(`Messages:${page}`);
                    await ctx.report({ phase: 'list', done: page + 1, total: 4 });
                    if (page === 1 && log.length <= 2) {
                        pipeline1.cancel();
                    }
                }
                await ctx.report({ phase: 'list', done: 4, total: 4, completed: true });
            },
        };
        const pipeline1 = new Pipeline({ uin: 1002, collectors: [cancelAt2, fakeCollector('Blogs', 1, log)], checkpointStore: store, ledger: new PageLedger(memoryKvArea()) });
        const state1 = await pipeline1.run();
        expect(state1).toBe('cancelled');
        expect(log).toEqual(['Messages:0', 'Messages:1']);

        // 断点存在
        const pending = await store.getPending(1002);
        expect(pending).toBeDefined();
        expect(pending!.modules['Messages']!.cursor).toBe(2);
        expect(pending!.modules['Messages']!.completed).toBe(false);

        // 续传：Messages从第3页(cursor=2)继续，Blogs正常执行
        const pipeline2 = new Pipeline({
            uin: 1002,
            collectors: [fakeCollector('Messages', 4, log), fakeCollector('Blogs', 1, log)],
            checkpointStore: store,
            ledger: new PageLedger(memoryKvArea()),
        });
        const state2 = await pipeline2.run(pending);
        expect(state2).toBe('completed');
        expect(log).toEqual(['Messages:0', 'Messages:1', 'Messages:2', 'Messages:3', 'Blogs:0']);
    });

    it('暂停后恢复继续执行', async () => {
        const store = new CheckpointStore(memoryKvArea());
        const log: string[] = [];
        const pipeline = new Pipeline({ uin: 1003, collectors: [fakeCollector('Messages', 3, log)], checkpointStore: store, ledger: new PageLedger(memoryKvArea()) });

        const runPromise = pipeline.run();
        pipeline.pause();
        // 暂停期间放行事件循环，采集应停在tick边界
        await new Promise((resolve) => setTimeout(resolve, 20));
        const pausedCount = log.length;
        expect(pipeline.getState()).toBe('paused');

        pipeline.resume();
        const state = await runPromise;
        expect(state).toBe('completed');
        expect(log.length).toBe(3);
        expect(pausedCount).toBeLessThanOrEqual(3);
    });

    it('单模块异常时继续后续模块（continueOnError默认）', async () => {
        const store = new CheckpointStore(memoryKvArea());
        const log: string[] = [];
        const broken: ModuleCollector = {
            module: 'Diaries',
            async collect() {
                throw new Error('接口挂了');
            },
        };
        const events: EngineEvent[] = [];
        const pipeline = new Pipeline({
            uin: 1004,
            collectors: [broken, fakeCollector('Boards', 1, log)],
            checkpointStore: store,
            ledger: new PageLedger(memoryKvArea()),
        });
        pipeline.events.on((event) => events.push(event));
        const state = await pipeline.run();
        expect(state).toBe('completed');
        expect(log).toEqual(['Boards:0']);
        expect(events.some((event) => event.type === 'module-error' && event.module === 'Diaries')).toBe(true);
    });

    it('数据暂存与恢复读取', async () => {
        const store = new CheckpointStore(memoryKvArea());
        await store.start(1005, ['Messages']);
        await store.saveStaging(1005, 'Messages', [{ tid: 'a' }]);
        expect(await store.loadStaging(1005, 'Messages')).toEqual([{ tid: 'a' }]);
        await store.discard(1005);
        expect(await store.loadStaging(1005, 'Messages')).toBeUndefined();
    });
});

describe('runPool 并发池', () => {
    it('限制并发且全部完成', async () => {
        let running = 0;
        let maxRunning = 0;
        const results: number[] = [];
        await runPool(
            [1, 2, 3, 4, 5, 6],
            async (item) => {
                running++;
                maxRunning = Math.max(maxRunning, running);
                await new Promise((resolve) => setTimeout(resolve, 5));
                running--;
                return item * 2;
            },
            { concurrency: 2 },
            (_item, _index, result) => {
                if (result.ok) results.push(result.value);
            },
        );
        expect(maxRunning).toBeLessThanOrEqual(2);
        expect(results.sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10, 12]);
    });

    it('单任务失败不中断整体', async () => {
        const failed: number[] = [];
        const succeeded: number[] = [];
        await runPool(
            [1, 2, 3],
            async (item) => {
                if (item === 2) throw new Error('boom');
                return item;
            },
            { concurrency: 3 },
            (item, _index, result) => (result.ok ? succeeded.push(item) : failed.push(item)),
        );
        expect(failed).toEqual([2]);
        expect(succeeded.sort()).toEqual([1, 3]);
    });

    it('retryWithBackoff 指数退避', async () => {
        const sleeps: number[] = [];
        let attempts = 0;
        const result = await retryWithBackoff(
            async () => {
                attempts++;
                if (attempts < 3) throw new Error('fail');
                return 'ok';
            },
            3,
            100,
            async (ms) => {
                sleeps.push(ms);
            },
        );
        expect(result).toBe('ok');
        expect(sleeps).toEqual([100, 200]);
    });

    it('retryWithBackoff 重试用尽抛出最后错误', async () => {
        await expect(
            retryWithBackoff(async () => Promise.reject(new Error('always')), 1, 1, async () => {}),
        ).rejects.toThrow('always');
    });
});

describe('TaskQueue 持久化任务队列', () => {
    const makeTask = (id: string, state: DownloadTask['state'] = 'pending'): DownloadTask => ({
        id,
        uin: 123456,
        module: 'Photos',
        url: 'https://x.com/' + id,
        dir: 'Albums/images',
        name: id + '.jpg',
        state,
    });

    it('追加去重与状态更新', async () => {
        const queue = new TaskQueue(2001);
        await queue.clear();
        expect(await queue.add([makeTask('a'), makeTask('b')])).toBe(2);
        // 重复追加被去重
        expect(await queue.add([makeTask('a'), makeTask('c')])).toBe(1);
        await queue.update('a', { state: 'complete', downloadId: 9 });
        const stats = await queue.stats();
        expect(stats.complete).toBe(1);
        expect(stats.pending).toBe(2);
    });

    it('pending返回未完成任务（含中断，用于续传重新入队）', async () => {
        const queue = new TaskQueue(2002);
        await queue.clear();
        await queue.add([makeTask('a', 'complete'), makeTask('b', 'interrupted'), makeTask('c', 'pending')]);
        const pending = await queue.pending();
        expect(pending.map((task) => task.id).sort()).toEqual(['b', 'c']);
    });
});

describe('CancelledError', () => {
    it('类型标识', () => {
        const error = new CancelledError();
        expect(error.name).toBe('CancelledError');
    });
});
