import { describe, expect, it } from 'vitest';
import { CheckpointStore } from '../core/collector/checkpoint';
import { type KvArea } from '../core/store/backup-db';

/** 内存版 KvArea（支持 get(null)），模拟 chrome.storage.local 的共享 KV 行为，不依赖扩展环境 */
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

/**
 * 验证 Phase 2 存储迁移后，断点不再依赖「页面 origin 的 IndexedDB」——
 * 换子域 / 换页 / 换账号的新页面实例能读到彼此写入的断点与暂存。
 * 此前（页面 origin IndexedDB）新实例读不到 → getPending 返 undefined → 退化为全新备份。
 */
describe('断点续传：跨上下文断点可读（chrome.storage.local 共享）', () => {
    it('不同 CheckpointStore 实例共享同一 KvArea 时，能读到彼此写入的断点与暂存', async () => {
        const area = memoryKvArea();
        const storeA = new CheckpointStore(area);
        const storeB = new CheckpointStore(area); // 模拟「换了子域/换页」的新页面实例

        await storeA.start(7788, ['Messages', 'Blogs']);
        await storeA.saveStaging(7788, 'Messages', [{ tid: '1' }, { tid: '2' }, { tid: '3' }]);
        await storeA.updateModule(7788, 'Messages', { phase: 'list', cursor: 3, done: 3, total: 10, completed: false });

        // 新页面实例（storeB）应能读到断点，无需回到原页面 origin 的 IndexedDB
        const pending = await storeB.getPending(7788);
        expect(pending).toBeDefined();
        expect(pending!.modules['Messages']!.done).toBe(3);
        expect(await storeB.loadStaging(7788, 'Messages')).toHaveLength(3);

        // 全新备份路径仍能整段清空（clearStaging 跨实例生效）
        await storeB.start(7788, ['Messages', 'Blogs']);
        expect(await storeB.loadStaging(7788, 'Messages')).toBeUndefined();
        expect((await storeB.getDownloadedUrls(7788)).size).toBe(0);
    });
});

/**
 * 验证 Phase 1 的 staging-based 续采起点推导：list 中断于第 N 条时，
 * 续传从 ceil(N / pageSize) 页继续，而非首页（旧逻辑用 cpPhase==='list' 限定 +
 * cursor 推送，会在「中断于明细阶段」或「staging 缺失」时退化为 0 → 整段重采）。
 */
describe('断点续传：staging-based 续采起点推导', () => {
    it('list 已采 45 条（pageSize=20）时，续传从 ceil(45/20)=3 页继续而非首页', async () => {
        const area = memoryKvArea();
        const store = new CheckpointStore(area);
        const uin = 9999;
        const pageSize = 20;
        const partial = Array.from({ length: 45 }, (_, i) => ({ tid: String(i) })); // 0..44

        await store.start(uin, ['Messages']);
        await store.saveStaging(uin, 'Messages', partial);
        await store.updateModule(uin, 'Messages', { phase: 'list', cursor: 45, done: 45, total: 100, completed: false });

        // 各分页采集器（messages/diaries/blogs/videos/favorites）统一的续采起点推导
        const staging = (await store.loadStaging<typeof partial>(uin, 'Messages')) || [];
        const startPage = Math.ceil(staging.length / pageSize);
        expect(startPage).toBe(3);

        // 对照：旧逻辑（cpPhase==='list' 限定 + cursor/pageSize）在明细阶段中断时
        // partialItems 取不到 → startPage=0；这里用 staging 长度推导，与 phase 名无关。
    });

    it('staging 为空且 checkpoint 存在时（明细阶段被中断但暂存缺失）退化为保守全量续采', async () => {
        const area = memoryKvArea();
        const store = new CheckpointStore(area);
        const uin = 5555;
        const pageSize = 20;

        await store.start(uin, ['Messages']);
        // 模拟：列表已采完、正在采明细，但 staging 因异常为空
        await store.updateModule(uin, 'Messages', { phase: 'comments', cursor: 100, done: 100, total: 100, completed: false });

        const staging = (await store.loadStaging<unknown[]>(uin, 'Messages')) || [];
        const startPage = Math.ceil(staging.length / pageSize);
        // staging 缺失时不凭 cursor 臆推（cursor 在明细阶段已变为明细数），保守从头重拉列表
        expect(startPage).toBe(0);
    });
});
