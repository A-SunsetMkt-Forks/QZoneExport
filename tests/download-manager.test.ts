/**
 * DownloadManager 关键行为回归测试：
 *  - 并发上限信号量（downloadThread）
 *  - 统一进度百分比（globalProgress.percent，含未知 size / pending 分母）
 *  - restoreFromQueue / 重试 的残留清零
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DownloadManager } from '../core/downloader/manager';
import { DLEvent } from '../core/shared/messages';

describe('DownloadManager 并发上限（downloadThread）', () => {
    let fakeChrome: any;
    beforeEach(() => {
        // 模拟 background 转发：chrome.downloads.download 50ms 后才返回 downloadId
        fakeChrome = {
            runtime: {
                lastError: undefined,
                sendMessage: (_msg: any, cb: any) => {
                    setTimeout(() => cb({ ok: true, downloadId: Math.floor(Math.random() * 1e9) }), 50);
                },
            },
        };
        (globalThis as any).chrome = fakeChrome;
    });
    afterEach(() => {
        delete (globalThis as any).chrome;
    });

    it('并发提交受 downloadThread 限制：同时 submit 的任务数不超过上限', async () => {
        const dm = new DownloadManager({});
        dm.setConcurrencyLimit(2);
        // 用 spy 统计 driver.submit 的并发调用数（信号量实际约束的对象）
        let active = 0, maxActive = 0;
        const driver: any = (dm as any).drivers.browser;
        const origSubmit = driver.submit.bind(driver);
        driver.submit = async (req: any, rep: any) => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise((r) => setTimeout(r, 50));
            active--;
            return { trackerId: 12345 };
        };
        for (let i = 0; i < 5; i++) {
            dm.upsert({
                id: 't' + i, module: 'M', url: 'u' + i, dir: 'd', name: 'n' + i + '.jpg',
                state: 'pending', trackerType: 'browser',
            });
            void dm.submitTask('t' + i);
        }
        await new Promise((r) => setTimeout(r, 200));
        // 浏览器任务无终态广播，槽位持续保持：并发 submit 峰值应被限制在上限 2
        expect(maxActive).toBeLessThanOrEqual(2);
        expect(maxActive).toBe(2);
        dm.clear();
    });

    it('放宽上限后等待中的任务被立即唤醒', async () => {
        const dm = new DownloadManager({});
        dm.setConcurrencyLimit(1);
        let active = 0, maxActive = 0, submitCalls = 0;
        const driver: any = (dm as any).drivers.browser;
        const origSubmit = driver.submit.bind(driver);
        driver.submit = async (req: any, rep: any) => {
            active++;
            maxActive = Math.max(maxActive, active);
            submitCalls++;
            await new Promise((r) => setTimeout(r, 50));
            active--;
            return { trackerId: 12345 };
        };
        for (let i = 0; i < 3; i++) {
            dm.upsert({
                id: 'w' + i, module: 'M', url: 'u' + i, dir: 'd', name: 'n' + i + '.jpg',
                state: 'pending', trackerType: 'browser',
            });
            void dm.submitTask('w' + i);
        }
        await new Promise((r) => setTimeout(r, 120));
        expect(maxActive).toBe(1); // 上限为 1，峰值仅 1
        expect(submitCalls).toBe(1); // 仅 w0 被提交，w1/w2 在等待
        dm.setConcurrencyLimit(5); // 放宽，唤醒其余等待任务
        await new Promise((r) => setTimeout(r, 150));
        // 浏览器任务无终态广播，槽位持续保持，但全部 3 个任务都应已被提交
        expect(submitCalls).toBe(3); // 等待的 w1/w2 被立即唤醒并提交
        dm.clear();
    });

    it('同一 id 被重复 submitTask 不重复占槽（防并发塌缩成 1）', async () => {
        const dm: any = new DownloadManager({});
        dm.setConcurrencyLimit(3);
        let submitCalls = 0;
        const driver: any = (dm as any).drivers.browser;
        driver.submit = async (_req: any, rep: any) => {
            submitCalls++;
            // 模拟下载完成 -> 释放槽（与真实驱动 onState('complete') 等价）
            setTimeout(() => rep.onState?.('complete'), 20);
            return { trackerId: 999 };
        };
        // 模拟采集器对同一条媒体任务重复 addMediaTask（跨页/跨模块去重有缝隙时发生）：
        // 同一 id 被 submitTask 两次
        const N = 20;
        for (let i = 0; i < N; i++) {
            const id = 'dup' + i;
            dm.upsert({ id, module: 'M', url: 'u' + i, dir: 'd', name: 'n' + i + '.jpg', state: 'pending', trackerType: 'browser' });
            void dm.submitTask(id);
            void dm.submitTask(id); // 重复提交
        }
        await new Promise((r) => setTimeout(r, 800)); // 等全部完成
        // 每个 id 只真正提交一次（重复调用被重入守卫跳过）
        expect(submitCalls).toBe(N);
        // 无并发槽泄漏：全部完成后信号量与持有集合应归零
        expect((dm as any)._activeSubmits).toBe(0);
        expect((dm as any)._heldSlots.size).toBe(0);
        expect((dm as any)._submitting.size).toBe(0);
        dm.clear();
    });
});

describe('DownloadManager.globalProgress 统一百分比', () => {
    it('未知 size 任务计入分母但贡献 0 进度；complete 计满、pending 计 0', () => {
        const dm = new DownloadManager({});
        dm.upsert({ id: 'a', module: 'M', url: 'u1', dir: 'd', name: 'a.jpg', state: 'complete', totalBytes: 100, downloadedBytes: 100, trackerType: 'browser' });
        dm.upsert({ id: 'b', module: 'M', url: 'u2', dir: 'd', name: 'b.jpg', state: 'in_progress', totalBytes: 100, downloadedBytes: 50, trackerType: 'browser' });
        dm.upsert({ id: 'c', module: 'M', url: 'u3', dir: 'd', name: 'c.jpg', state: 'in_progress', trackerType: 'browser' }); // 未知 size
        dm.upsert({ id: 'd', module: 'M', url: 'u4', dir: 'd', name: 'd.jpg', state: 'pending', trackerType: 'browser' });
        const gp = dm.globalProgress();
        // 加权：a=1, b=0.5, c=0, d=0 => 1.5/4 = 37.5% => 38
        expect(gp.percent).toBe(38);
        dm.clear();
    });

    it('无任务时百分比为 0', () => {
        const dm = new DownloadManager({});
        expect(dm.globalProgress().percent).toBe(0);
        dm.clear();
    });

    it('全部完成时为 100', () => {
        const dm = new DownloadManager({});
        for (let i = 0; i < 4; i++) {
            dm.upsert({ id: 'x' + i, module: 'M', url: 'u' + i, dir: 'd', name: 'n' + i, state: 'complete', totalBytes: 10, downloadedBytes: 10, trackerType: 'browser' });
        }
        expect(dm.globalProgress().percent).toBe(100);
        dm.clear();
    });
});

describe('DownloadManager.globalProgress 口径（失败/取消不计入完成度）', () => {
    it('F3: 一批任务在 80% 处集体失败，percent 仅反映 complete 任务', () => {
        const dm = new DownloadManager({});
        for (let i = 0; i < 2; i++) {
            dm.upsert({ id: 'ok' + i, module: 'M', url: 'u' + i, dir: 'd', name: 'ok' + i + '.jpg', state: 'complete', totalBytes: 100, downloadedBytes: 100, trackerType: 'browser' });
        }
        for (let i = 0; i < 8; i++) {
            // 在 80% 处失败的 interrupted 任务：旧口径会按字节比计入完成度，导致「全部失败却显示高进度」
            dm.upsert({ id: 'fail' + i, module: 'M', url: 'f' + i, dir: 'd', name: 'fail' + i + '.jpg', state: 'interrupted', totalBytes: 100, downloadedBytes: 80, trackerType: 'browser' });
        }
        const gp = dm.globalProgress();
        // 加权：2 个 complete 各 1；8 个 interrupted 各 0；共 10 个任务 => 2/10 = 20%
        expect(gp.percent).toBe(20);
        dm.clear();
    });
});

describe('DownloadManager 浏览器下载进度（background runtime 通道）', () => {
    let fakeChrome: any;
    let onMsgListeners: any[];
    beforeEach(() => {
        onMsgListeners = [];
        fakeChrome = {
            runtime: {
                lastError: undefined,
                sendMessage: (_msg: any, cb?: any) => { setTimeout(() => cb && cb({ ok: true, downloadId: 999 }), 10); },
                onMessage: {
                    addListener: (fn: any) => onMsgListeners.push(fn),
                    removeListener: (fn: any) => { const i = onMsgListeners.indexOf(fn); if (i >= 0) onMsgListeners.splice(i, 1); },
                },
            },
        };
        (globalThis as any).chrome = fakeChrome;
    });
    afterEach(() => { delete (globalThis as any).chrome; });

    it('F9: background 经 runtime 广播的完成帧被 DM 接收，任务进入 complete 并释放并发槽', async () => {
        const dm = new DownloadManager({});
        dm.setConcurrencyLimit(1);
        const driver: any = (dm as any).drivers.browser;
        // spy：直接返回 downloadId，模拟 background 已发起浏览器下载
        driver.submit = async () => ({ trackerId: 999 });
        dm.upsert({ id: 't0', module: 'M', url: 'u0', dir: 'd', name: 'n0.jpg', state: 'pending', trackerType: 'browser' });
        void dm.submitTask('t0');
        await new Promise((r) => setTimeout(r, 30)); // 等待 submit 完成、downloadId 注册
        expect((dm as any)._dlIdToId.get(999)).toBe('t0');

        // 模拟 background 经 chrome.tabs.sendMessage 广播完成帧（runtime 通道）
        onMsgListeners.forEach((fn) => fn({
            type: DLEvent.PROGRESS_BATCH,
            items: [{ downloadId: 999, state: 'complete', bytesReceived: 100, totalBytes: 100 }],
        }));

        const t0 = dm.get('t0');
        expect(t0 && t0.state).toBe('complete');
        // 并发槽释放：后续任务可正常提交（不会永久阻塞在 _acquireSlot）
        expect((dm as any)._heldSlots.size).toBe(0);
        expect((dm as any)._activeSubmits).toBe(0);
        let submitted = false;
        const d2: any = (dm as any).drivers.browser;
        d2.submit = async () => { submitted = true; return { trackerId: 1000 }; };
        dm.upsert({ id: 't1', module: 'M', url: 'u1', dir: 'd', name: 'n1.jpg', state: 'pending', trackerType: 'browser' });
        void dm.submitTask('t1');
        await new Promise((r) => setTimeout(r, 30));
        expect(submitted).toBe(true);
        dm.clear();
    });

    it('F4: onCreated 经 filename 反向索引 O(1) 解析并回填 downloadId（不触发 O(n) 遍历）', () => {
        const dm = new DownloadManager({});
        dm.upsert({ id: 't0', module: 'M', url: 'u0', dir: 'd', name: 'n0.jpg', state: 'in_progress', trackerType: 'browser' });
        // 模拟 background onCreated 广播：downloadId 未登记，但 filename 命中已注册 task.name
        onMsgListeners.forEach((fn) => fn({
            type: DLEvent.CREATED,
            downloadId: 777,
            filename: 'n0.jpg',
            totalBytes: 50,
        }));
        const t0 = dm.get('t0');
        expect(t0 && t0.downloadId).toBe(777);
        expect(t0 && t0.totalBytes).toBe(50);
        expect((dm as any)._dlIdToId.get(777)).toBe('t0');
        dm.clear();
    });
});

describe('DownloadManager 下载卡死超时兜底', () => {
    let fakeChrome: any;
    beforeEach(() => {
        fakeChrome = { runtime: { sendMessage: (_m: any, cb?: any) => cb && cb({ ok: true, downloadId: 1 }) } };
        (globalThis as any).chrome = fakeChrome;
    });
    afterEach(() => { delete (globalThis as any).chrome; });

    it('F11: 长时间无进度采样的 in_progress 任务被强制标记 interrupted 并释放槽', async () => {
        const dm = new DownloadManager({});
        dm.setConcurrencyLimit(1);
        const driver: any = (dm as any).drivers.browser;
        driver.submit = async () => ({ trackerId: 555 });
        dm.upsert({
            id: 'stuck', module: 'M', url: 'u', dir: 'd', name: 'stuck.jpg',
            state: 'in_progress', totalBytes: 100, downloadedBytes: 30, trackerType: 'browser',
            _lastSampleAt: Date.now() - 200000, // 远超 _STALE_TASK_MS，模拟传输已失联
        });
        (dm as any)._heldSlots.add('stuck');
        (dm as any)._activeSubmits = 1;
        await new Promise((r) => setTimeout(r, 1300)); // 等待停滞看门狗 tick（1s 周期）
        const t = dm.get('stuck');
        expect(t && t.state).toBe('interrupted');
        expect(t && (t as any).error).toContain('卡死');
        expect((dm as any)._heldSlots.size).toBe(0);
        dm.clear();
    });
});

describe('DownloadManager.restoreManifestFromQueue 残留清零', () => {
    it('续传恢复的任务 downloadedBytes 等残留被清零', async () => {
        const dm = new DownloadManager({});
        const stale = {
            id: 'r1', module: 'M', url: 'u', dir: 'd', name: 'n.jpg',
            state: 'pending', trackerType: 'browser',
            downloadedBytes: 500, speedBps: 1234, etaMs: 999,
            _lastSampleAt: 111, _lastSampleBytes: 500,
        };
        // 注入一个只含该陈旧记录的伪持久化队列
        (dm as any).queue = {
            all: async () => [stale],
            add: async () => {},
            update: async () => {},
        } as any;
        const origUpsert = dm.upsert.bind(dm);
        let captured: any = null;
        dm.upsert = ((patch: any) => {
            if (patch.id === 'r1') captured = patch;
            return origUpsert(patch);
        }) as typeof dm.upsert;
        await dm.restoreManifestFromQueue();
        expect(captured).not.toBeNull();
        expect(captured.downloadedBytes).toBe(0);
        expect(captured.speedBps).toBe(0);
        expect(captured.etaMs).toBeUndefined();
        expect(captured._lastSampleAt).toBe(0);
        dm.clear();
    });
});

describe('DownloadManager.restoreManifestFromQueue 完整清单状态恢复', () => {
    it('complete 不重下、interrupted 不自动重试、pending 重新入队', async () => {
        const dm = new DownloadManager({});
        const tasks = [
            { id: 'c1', module: 'M', url: 'u1', dir: 'd', name: 'done.jpg', state: 'complete', trackerType: 'browser' },
            { id: 'i1', module: 'M', url: 'u2', dir: 'd', name: 'fail.jpg', state: 'interrupted', trackerType: 'browser', error: 'boom' },
            { id: 'p1', module: 'M', url: 'u3', dir: 'd', name: 'pend.jpg', state: 'pending', trackerType: 'browser' },
        ];
        (dm as any).queue = {
            all: async () => tasks,
            add: async () => {},
            update: async () => {},
        } as any;
        const submitSpy = vi.spyOn(dm, 'submitTask').mockResolvedValue();
        const restored = await dm.restoreManifestFromQueue();
        expect(restored).toBe(3);
        const c = dm.get('c1');
        const i = dm.get('i1');
        const p = dm.get('p1');
        expect(c).toBeTruthy();
        expect(c!.state).toBe('complete');
        expect(i).toBeTruthy();
        expect(i!.state).toBe('interrupted');
        expect(i!.error).toBe('boom');
        expect(p).toBeTruthy();
        expect(p!.state).toBe('pending');
        // 仅 pending 重新入队续下；complete / interrupted 不自动动
        expect(submitSpy).toHaveBeenCalledWith('p1');
        expect(submitSpy).not.toHaveBeenCalledWith('c1');
        expect(submitSpy).not.toHaveBeenCalledWith('i1');
        dm.clear();
    });

    it('已存在于内存的任务被跳过（幂等），不会重复提交', async () => {
        const dm = new DownloadManager({});
        const tasks = [
            { id: 'x1', module: 'M', url: 'u1', dir: 'd', name: 'a.jpg', state: 'complete', trackerType: 'browser' },
        ];
        (dm as any).queue = {
            all: async () => tasks,
            add: async () => {},
            update: async () => {},
        } as any;
        // 预先在内存里放一个同名任务（模拟采集器 restore 已注册）
        dm.upsert({ id: 'x1', module: 'M', url: 'u1', dir: 'd', name: 'a.jpg', state: 'complete', trackerType: 'browser' as any, _src: 'collector' });
        const submitSpy = vi.spyOn(dm, 'submitTask').mockResolvedValue();
        const restored = await dm.restoreManifestFromQueue();
        expect(restored).toBe(0);
        expect(submitSpy).not.toHaveBeenCalled();
        dm.clear();
    });

    it('终态护栏：已 complete 的任务被采集器重登记为 pending 时仍保持 complete（不被降级重下）', () => {
        const dm = new DownloadManager({});
        // 模拟续传恢复后内存态：任务已 complete 并落盘
        dm.upsert({ id: 'c1', module: 'M', url: 'u1', dir: 'd', name: 'done.jpg', state: 'complete', trackerType: 'browser' as any });
        // 采集器随后对同一媒体重登记（默认 state:'pending'）
        dm.upsert({ id: 'c1', module: 'M', url: 'u1', dir: 'd', name: 'done.jpg', state: 'pending', trackerType: 'browser' as any });
        // 终态护栏：state 不被降级，仍保持 complete；
        // 后续 host.addMediaTask 调 submitTask 会在 manager.ts:617 因 complete 短路返回，不再下载
        expect(dm.get('c1')!.state).toBe('complete');
        dm.clear();
    });
});

describe('DownloadManager 操作失败反馈（F6/F8）', () => {
    let fakeChrome: any;
    beforeEach(() => {
        fakeChrome = { runtime: { sendMessage: (_m: any, cb?: any) => cb && cb({ ok: true, downloadId: 1 }) } };
        (globalThis as any).chrome = fakeChrome;
    });
    afterEach(() => { delete (globalThis as any).chrome; });

    it('F6: 暂停底层失败时 emit task-error 且不改变任务状态', async () => {
        const dm = new DownloadManager({});
        dm.upsert({ id: 'p0', module: 'M', url: 'u', dir: 'd', name: 'p0.jpg', state: 'in_progress', downloadId: 1, trackerType: 'browser' });
        const driver: any = (dm as any).drivers.browser;
        driver.pause = async () => { throw new Error('chrome.downloads.pause 失败'); };
        const errors: any[] = [];
        dm.subscribe('task-error', (p: any) => errors.push(p));
        await dm.pauseTask('p0');
        expect(errors.length).toBe(1);
        expect(errors[0].op).toBe('pause');
        expect(errors[0].id).toBe('p0');
        expect(dm.get('p0')!.state).toBe('in_progress'); // 状态未被错误改写
        dm.clear();
    });

    it('F6: 取消底层失败时 emit task-error 且不伪造已取消终态（F8）', async () => {
        const dm = new DownloadManager({});
        dm.upsert({ id: 'c0', module: 'M', url: 'u', dir: 'd', name: 'c0.jpg', state: 'in_progress', downloadId: 2, trackerType: 'browser' });
        const driver: any = (dm as any).drivers.browser;
        driver.cancel = async () => { throw new Error('chrome.downloads.erase 失败'); };
        const errors: any[] = [];
        dm.subscribe('task-error', (p: any) => errors.push(p));
        await dm.cancel(['c0']);
        expect(errors.length).toBe(1);
        expect(errors[0].op).toBe('cancel');
        expect(errors[0].id).toBe('c0');
        // F8: 底层取消失败不标记 interrupted/已取消，保留真实状态
        expect(dm.get('c0')!.state).toBe('in_progress');
        dm.clear();
    });

    it('取消底层成功时正常标记 interrupted/已取消', async () => {
        const dm = new DownloadManager({});
        dm.upsert({ id: 'ok', module: 'M', url: 'u', dir: 'd', name: 'ok.jpg', state: 'in_progress', downloadId: 3, trackerType: 'browser' });
        const driver: any = (dm as any).drivers.browser;
        driver.cancel = async () => {};
        const errors: any[] = [];
        dm.subscribe('task-error', (p: any) => errors.push(p));
        await dm.cancel(['ok']);
        expect(errors.length).toBe(0);
        expect(dm.get('ok')!.state).toBe('interrupted');
        expect(dm.get('ok')!.error).toBe('已取消');
        dm.clear();
    });
});

/* ===================== 下载管理 / 概览 一致性修复回归 ===================== */

describe('浏览器下载状态迁移：进度帧无 state 时推断 in_progress（#3/#6）', () => {
    let onMsgListeners: any[];
    beforeEach(() => {
        onMsgListeners = [];
        (globalThis as any).chrome = {
            runtime: {
                lastError: undefined,
                sendMessage: (_msg: any, cb?: any) => { setTimeout(() => cb && cb({ ok: true, downloadId: 4001 }), 5); },
                onMessage: {
                    addListener: (fn: any) => onMsgListeners.push(fn),
                    removeListener: (fn: any) => { const i = onMsgListeners.indexOf(fn); if (i >= 0) onMsgListeners.splice(i, 1); },
                },
            },
        };
    });
    afterEach(() => { delete (globalThis as any).chrome; });

    it('#3/#6: 仅含 bytesReceived 的进度帧会把 pending 任务推进为 in_progress，并计算速度', async () => {
        const dm = new DownloadManager({});
        dm.upsert({ id: 'p0', module: 'M', url: 'u', dir: 'd', name: 'p0.jpg', state: 'pending', downloadId: 4001, trackerType: 'browser' });
        // Chrome 的 onChanged delta 在下载途中只带 bytesReceived，没有 state 字段
        onMsgListeners.forEach((fn) => fn({
            type: DLEvent.PROGRESS_BATCH,
            items: [{ downloadId: 4001, bytesReceived: 1000, totalBytes: 10000 }],
        }));
        expect(dm.get('p0')!.state).toBe('in_progress');

        // 第二帧：间隔足够长，速度应被计算出来（> 0）
        await new Promise((r) => setTimeout(r, 160));
        onMsgListeners.forEach((fn) => fn({
            type: DLEvent.PROGRESS_BATCH,
            items: [{ downloadId: 4001, bytesReceived: 5000, totalBytes: 10000 }],
        }));
        const t = dm.get('p0')!;
        expect(t.downloadedBytes).toBe(5000);
        expect(t.speedBps || 0).toBeGreaterThan(0);
        // 概览「正在下载 Top3」与媒体页签「进行中」筛选依赖该状态
        expect(dm.tasksSorted().filter((x) => x.state === 'in_progress').length).toBe(1);
        expect(dm.globalProgress().speedBps).toBeGreaterThan(0);
        dm.clear();
    });

    it('#3: 终态帧不被推断覆盖，complete/interrupted 仍按 state 生效', () => {
        const dm = new DownloadManager({});
        dm.upsert({ id: 'p1', module: 'M', url: 'u', dir: 'd', name: 'p1.jpg', state: 'pending', downloadId: 4002, trackerType: 'browser' });
        onMsgListeners.forEach((fn) => fn({
            type: DLEvent.PROGRESS_BATCH,
            items: [{ downloadId: 4002, bytesReceived: 100, totalBytes: 100, state: 'complete' }],
        }));
        expect(dm.get('p1')!.state).toBe('complete');
        dm.clear();
    });

    it('#3: 暂停帧优先于推断，paused 不会被 bytesReceived 顶成 in_progress', () => {
        const dm = new DownloadManager({});
        dm.upsert({ id: 'p2', module: 'M', url: 'u', dir: 'd', name: 'p2.jpg', state: 'paused', downloadId: 4003, trackerType: 'browser' });
        // Chrome 以 paused:true 通知暂停，同帧仍带 bytesReceived；此时应保留 paused 而非推断 in_progress
        onMsgListeners.forEach((fn) => fn({
            type: DLEvent.PROGRESS_BATCH,
            items: [{ downloadId: 4003, bytesReceived: 300, totalBytes: 1000, paused: true }],
        }));
        expect(dm.get('p2')!.state).toBe('paused');
        dm.clear();
    });

    it('#3/#6: BrowserDriver.submit 在拿到 downloadId 后立即上报 in_progress', async () => {
        const dm = new DownloadManager({});
        dm.upsert({ id: 's0', module: 'M', url: 'u', dir: 'd', name: 's0.jpg', state: 'pending', trackerType: 'browser' });
        dm.submitTask('s0');
        await new Promise((r) => setTimeout(r, 30));
        // 不主动上报则任务会一直 pending -> Top3/进行中恒空、速度恒 0
        expect(dm.get('s0')!.state).toBe('in_progress');
        dm.clear();
    });
});

describe('重试：复用同一任务记录且清理上一轮残留（#2）', () => {
    beforeEach(() => {
        (globalThis as any).chrome = {
            runtime: {
                lastError: undefined,
                sendMessage: (_msg: any, cb?: any) => { setTimeout(() => cb && cb({ ok: true, downloadId: 9001 }), 5); },
            },
        };
    });
    afterEach(() => { delete (globalThis as any).chrome; });

    it('#2: retry 复用同一任务记录，清空 error/下载字节/旧 downloadId，retries+1', async () => {
        const dm = new DownloadManager({});
        // 先 spy submitTask 为 no-op，使 retry 只做「重置 + 回到 pending」，断言确定性强
        const origSubmit = (dm as any).submitTask.bind(dm);
        (dm as any).submitTask = async () => {};
        dm.upsert({ id: 'r0', module: 'M', url: 'u', dir: 'd', name: 'r0.jpg', state: 'interrupted', downloadId: 9001, error: '下载失败', downloadedBytes: 500, speedBps: 100, retries: 1, trackerType: 'browser' });
        // retry 接收 string[]，单任务需包成数组（字符串会被 for...of 拆成字符，导致静默不生效）
        dm.retry(['r0']);
        await new Promise((r) => setTimeout(r, 10));
        const t = dm.get('r0')!;
        expect(t.id).toBe('r0'); // 复用同一记录，不新建任务（否则会出现两条记录）
        expect(dm.tasksSorted().length).toBe(1); // 没有重复记录
        expect(t.state).toBe('pending'); // 回到待提交
        expect(t.error).toBeUndefined(); // 上一轮报错已清空（upsert 跳过 undefined，必须直接置空）
        expect(t.downloadedBytes).toBe(0);
        expect(t.speedBps).toBe(0);
        expect(t.downloadId).toBeUndefined(); // 旧 downloadId 已解绑
        expect(t.retries).toBe(2);
        (dm as any).submitTask = origSubmit;
        dm.clear();
    });

    it('#2: retryFailed 把所有 interrupted 任务批量回到 pending 并清空 error，不影响 complete', async () => {
        const dm = new DownloadManager({});
        const origSubmit = (dm as any).submitTask.bind(dm);
        (dm as any).submitTask = async () => {};
        dm.upsert({ id: 'f0', module: 'M', url: 'u', dir: 'd', name: 'f0.jpg', state: 'interrupted', error: '失败', retries: 1, trackerType: 'browser' });
        dm.upsert({ id: 'f1', module: 'M', url: 'u2', dir: 'd', name: 'f1.jpg', state: 'interrupted', error: '失败', retries: 1, trackerType: 'browser' });
        dm.upsert({ id: 'ok', module: 'M', url: 'u3', dir: 'd', name: 'ok.jpg', state: 'complete', trackerType: 'browser' });
        dm.retryFailed();
        await new Promise((r) => setTimeout(r, 10));
        expect(dm.get('f0')!.state).toBe('pending');
        expect(dm.get('f0')!.error).toBeUndefined();
        expect(dm.get('f1')!.state).toBe('pending');
        expect(dm.get('f1')!.error).toBeUndefined();
        expect(dm.get('ok')!.state).toBe('complete'); // 成功项不受影响
        (dm as any).submitTask = origSubmit;
        dm.clear();
    });

    it('重试重入保护：连续多次 retryFailed 只生效一次，不重复 re-pend 同一批', async () => {
        const dm = new DownloadManager({});
        const origSubmit = (dm as any).submitTask.bind(dm);
        (dm as any).submitTask = async () => {};
        dm.upsert({ id: 'f0', module: 'M', url: 'u', dir: 'd', name: 'f0.jpg', state: 'interrupted', error: '失败', retries: 2, trackerType: 'browser' });
        dm.upsert({ id: 'f1', module: 'M', url: 'u2', dir: 'd', name: 'f1.jpg', state: 'interrupted', error: '失败', retries: 2, trackerType: 'browser' });
        // 模拟人工在失败页签反复点击：连续多次调用
        dm.retryFailed();
        dm.retryFailed();
        dm.retryFailed();
        await new Promise((r) => setTimeout(r, 10));
        // _retrying 锁忽略重叠调用，每条只重试一次（retries 由 2 变 3，而非 5），无重复记录
        expect(dm.get('f0')!.retries).toBe(3);
        expect(dm.get('f1')!.retries).toBe(3);
        expect(dm.tasksSorted().length).toBe(2);
        (dm as any).submitTask = origSubmit;
        dm.clear();
    });

    it('重试去重：已处于 pending/in_progress 的任务不被重复 re-pend', async () => {
        const dm = new DownloadManager({});
        const origSubmit = (dm as any).submitTask.bind(dm);
        (dm as any).submitTask = async () => {};
        dm.upsert({ id: 'run', module: 'M', url: 'u', dir: 'd', name: 'run.jpg', state: 'in_progress', retries: 1, trackerType: 'browser' });
        dm.upsert({ id: 'f0', module: 'M', url: 'u2', dir: 'd', name: 'f0.jpg', state: 'interrupted', error: '失败', retries: 1, trackerType: 'browser' });
        dm.retryFailed();
        await new Promise((r) => setTimeout(r, 10));
        expect(dm.get('run')!.retries).toBe(1); // 进行中任务未被重复 re-pend
        expect(dm.get('run')!.state).toBe('in_progress');
        expect(dm.get('f0')!.state).toBe('pending'); // 失败任务正常重试
        (dm as any).submitTask = origSubmit;
        dm.clear();
    });

    it('重试不串行启动（直写目录 Disk 模式）：失败任务立即进入并发队列，峰值受 downloadThread 限制而非 1', async () => {
        const dm: any = new DownloadManager({});
        dm.setConcurrencyLimit(10);
        // 仿 DiskDriver：submit 内部 await 整段 fetch + 写盘（见 core/downloader/drivers/disk.ts），
        // 即 submitTask 的 `await driver.submit` 要等整段下载完成才返回；下载中持续回报进度。
        // 这才是用户真实场景：若 retry 循环逐个 `await submitTask`，会逐条卡死成串行（峰值=1）。
        (dm as any).drivers.disk = {
            type: 'disk',
            submit: async (req: any, rep: any) => {
                const steps = 10;
                for (let s = 1; s <= steps; s++) {
                    await new Promise((r) => setTimeout(r, 15));
                    rep.onProgress?.(s * 10, 100);
                }
                rep.onState?.('complete');
                return { trackerId: 'disk_' + req.id };
            },
        };
        (dm as any)._defaultTracker = () => 'disk';
        const N = 30;
        for (let i = 0; i < N; i++) {
            dm.upsert({ id: 'f' + i, module: 'M', url: 'u' + i, dir: 'd', name: 'f' + i + '.jpg', state: 'interrupted', error: '失败', retries: 1, trackerType: 'disk' });
        }
        // 时间线采样：每 20ms 记录一次 in_progress 数量
        const samples: number[] = [];
        const timer = setInterval(() => {
            const all = dm.tasksSorted() as any[];
            samples.push(all.filter((t: any) => t.state === 'in_progress').length);
        }, 20);
        // retryFailed 不应 await 每个任务串行启动；应把所有失败任务立即推入并发信号量
        await dm.retryFailed();
        await new Promise((r) => setTimeout(r, N * 150 + 400));
        clearInterval(timer);
        const maxInProgress = Math.max(0, ...samples);
        const limit = (dm as any)._maxConcurrent;
        // downloadThread=10 → 峰值应并行 10 个，而非退化成「下载完一个才出下一个」的 1
        expect(maxInProgress).toBe(limit);
        expect(maxInProgress).toBeGreaterThan(1);
        dm.clear();
    }, 20000);
});

describe('视频任务优先插队（避免直链排队过期）', () => {
    beforeEach(() => {
        (globalThis as any).chrome = {
            runtime: {
                lastError: undefined,
                sendMessage: (_msg: any, cb?: any) => { setTimeout(() => cb && cb({ ok: true, downloadId: 9001 }), 5); },
            },
        };
    });
    afterEach(() => { delete (globalThis as any).chrome; });

    it('视频任务 priority 置 1，tasksSorted 视频排在所有普通媒体之前', () => {
        const dm = new DownloadManager({});
        dm.upsert({ id: 'i0', module: 'M', url: 'u', dir: 'd', name: 'i0.jpg', state: 'pending', trackerType: 'browser' });
        dm.upsert({ id: 'v0', module: 'M', url: 'v', dir: 'd', name: 'v0.mp4', state: 'pending', trackerType: 'browser' }); // 后创建
        dm.upsert({ id: 'i1', module: 'M', url: 'u2', dir: 'd', name: 'i1.jpg', state: 'pending', trackerType: 'browser' });
        const order = dm.tasksSorted().map((t) => t.id);
        expect(order.indexOf('v0')).toBeLessThan(order.indexOf('i0'));
        expect(order.indexOf('v0')).toBeLessThan(order.indexOf('i1'));
        expect(dm.get('v0')!.priority).toBe(1);
        expect(dm.get('i0')!.priority).toBe(0);
        dm.clear();
    });

    it('并发槽满时，视频等待者优先于普通等待者获得槽位', async () => {
        const dm = new DownloadManager({});
        dm.setConcurrencyLimit(1);
        // img1 先登记并占用唯一并发槽（in_progress，测试环境无完成帧故持续占用）
        dm.upsert({ id: 'img1', module: 'M', url: 'u1', dir: 'd', name: 'img1.jpg', state: 'pending', trackerType: 'browser' });
        await dm.submitTask('img1');
        expect(dm.get('img1')!.state).toBe('in_progress'); // 已占槽
        // 先登记 img2 与 vid（槽已满时 submitTask 会进入等待队列）
        dm.upsert({ id: 'img2', module: 'M', url: 'u2', dir: 'd', name: 'img2.jpg', state: 'pending', trackerType: 'browser' });
        dm.upsert({ id: 'vid', module: 'M', url: 'v', dir: 'd', name: 'vid.mp4', state: 'pending', trackerType: 'browser' });
        const pv = dm.submitTask('vid');
        const p2 = dm.submitTask('img2');
        expect(dm.get('img2')!.state).toBe('pending');
        expect(dm.get('vid')!.state).toBe('pending');
        // 释放 img1 的槽：置 complete → 唤醒等待队列中优先级最高者（vid）
        dm.upsert({ id: 'img1', state: 'complete' });
        await pv; // vid 获得槽位并完成提交
        await new Promise((r) => setTimeout(r, 20));
        expect(dm.get('vid')!.state).toBe('in_progress'); // 视频优先获槽
        expect(dm.get('img2')!.state).toBe('pending'); // 普通图片仍在等
        void p2; // 不再释放槽，img2 保持等待
        dm.clear();
    });
});

describe('globalProgress 处理进度口径（#8）', () => {
    it('#8: 混合成功/失败/进行中/排队时，settled 与 failed 口径正确', () => {
        const dm = new DownloadManager({});
        dm.upsert({ id: 'a', module: 'M', url: 'u', dir: 'd', name: 'a.jpg', state: 'complete', totalBytes: 100, downloadedBytes: 100, trackerType: 'browser' });
        dm.upsert({ id: 'b', module: 'M', url: 'u2', dir: 'd', name: 'b.jpg', state: 'complete', totalBytes: 100, downloadedBytes: 100, trackerType: 'browser' });
        dm.upsert({ id: 'c', module: 'M', url: 'u3', dir: 'd', name: 'c.jpg', state: 'interrupted', totalBytes: 100, downloadedBytes: 50, error: '失败', trackerType: 'browser' });
        dm.upsert({ id: 'd', module: 'M', url: 'u4', dir: 'd', name: 'd.jpg', state: 'pending', totalBytes: 100, trackerType: 'browser' });
        const gp = dm.globalProgress();
        expect(gp.totalTasks).toBe(4);
        expect(gp.settled).toBe(3); // a,b 完成 + c 失败，均有结论
        expect(gp.failed).toBe(1);
        expect(gp.settledPercent).toBe(75); // 处理进度 = 已有结论 3/4
        expect(gp.failedPercent).toBe(25); // 失败占比 1/4
        dm.clear();
    });

    it('#8: 全部完成到 100%，无失败段', () => {
        const dm = new DownloadManager({});
        dm.upsert({ id: 'a', module: 'M', url: 'u', dir: 'd', name: 'a.jpg', state: 'complete', totalBytes: 10, downloadedBytes: 10, trackerType: 'browser' });
        dm.upsert({ id: 'b', module: 'M', url: 'u2', dir: 'd', name: 'b.jpg', state: 'complete', totalBytes: 10, downloadedBytes: 10, trackerType: 'browser' });
        const gp = dm.globalProgress();
        expect(gp.settled).toBe(2);
        expect(gp.failed).toBe(0);
        expect(gp.settledPercent).toBe(100);
        expect(gp.failedPercent).toBe(0);
        dm.clear();
    });

    it('#8: 空管理器不除零，各百分比为 0', () => {
        const dm = new DownloadManager({});
        const gp = dm.globalProgress();
        expect(gp.totalTasks).toBe(0);
        expect(gp.settledPercent).toBe(0);
        expect(gp.failedPercent).toBe(0);
    });
});

/**
 * 完成判定重构：settled/settledPercent + failed/failedPercent。
 * 核心契约：
 *  1. 判定「结束」用计数（isSettled），不用百分比 —— 百分比会四舍五入出假完成
 *  2. 失败也算「有结论」，全失败同样到 100% 处理进度
 *  3. paused 属于「未结论」，暂停 ≠ 结束
 */
describe('globalProgress 完成判定（settled / failed 口径）', () => {
    /** 批量造任务：states 为每个任务的状态 */
    function mk(states: string[]): DownloadManager {
        const dm = new DownloadManager({});
        states.forEach((st, i) => {
            dm.upsert({
                id: 't' + i, module: 'M', url: 'u' + i, dir: 'd', name: 't' + i + '.jpg',
                state: st as any, totalBytes: 100,
                downloadedBytes: st === 'complete' ? 100 : (st === 'pending' ? 0 : 50),
                trackerType: 'browser',
            });
        });
        return dm;
    }

    it('succeeded / failed / unsettled 三者互斥且求和等于总数（paused 计入未结论）', () => {
        const dm = mk(['complete', 'complete', 'interrupted', 'in_progress', 'paused', 'pending']);
        const gp = dm.globalProgress();
        expect(gp.totalTasks).toBe(6);
        expect(gp.succeeded).toBe(2);
        expect(gp.failed).toBe(1);
        expect(gp.settled).toBe(3); // 成功 2 + 失败 1
        expect(gp.unsettled).toBe(3); // in_progress + paused + pending
        expect(gp.succeeded + gp.failed + gp.unsettled).toBe(gp.totalTasks);
        expect(gp.isSettled).toBe(false);
        dm.clear();
    });

    it('全部失败时处理进度也到 100%，但成功完成度为 0', () => {
        const dm = mk(['interrupted', 'interrupted', 'interrupted']);
        const gp = dm.globalProgress();
        expect(gp.isSettled).toBe(true); // 全部有结论 → 下载环节已结束
        expect(gp.settledPercent).toBe(100);
        expect(gp.failedPercent).toBe(100);
        expect(gp.percent).toBe(0); // 成功完成度不因失败而虚高
        expect(gp.unsettled).toBe(0);
        dm.clear();
    });

    it('成功与失败混合跑完时 isSettled 为 true，且 percent + failedPercent = 100', () => {
        const dm = mk(['complete', 'complete', 'complete', 'interrupted']);
        const gp = dm.globalProgress();
        expect(gp.isSettled).toBe(true);
        expect(gp.settledPercent).toBe(100);
        expect(gp.percent).toBe(75);
        expect(gp.failedPercent).toBe(25);
        expect(gp.percent + gp.failedPercent).toBe(100);
        dm.clear();
    });

    it('paused 不算结束：暂停中的任务使 isSettled 保持 false', () => {
        const dm = mk(['complete', 'paused']);
        const gp = dm.globalProgress();
        expect(gp.unsettled).toBe(1);
        expect(gp.isSettled).toBe(false);
        expect(gp.settledPercent).toBeLessThan(100); // 绝不能显示「已结束」
        dm.clear();
    });

    it('空管理器视为已结束（isSettled=true），避免无任务时永远「未完成」', () => {
        const dm = new DownloadManager({});
        const gp = dm.globalProgress();
        expect(gp.isSettled).toBe(true);
        expect(gp.unsettled).toBe(0);
        expect(gp.percent).toBe(0);
    });

    it('999/1000 不得四舍五入成 100%（假完成防护）', () => {
        const states = new Array(999).fill('complete');
        states.push('pending');
        const dm = mk(states);
        const gp = dm.globalProgress();
        expect(gp.totalTasks).toBe(1000);
        expect(gp.settled).toBe(999);
        expect(gp.isSettled).toBe(false);
        // 原始值 99.9%，四舍五入会变 100 —— 必须被钳制到 99
        expect(gp.settledPercent).toBe(99);
        expect(gp.percent).toBe(99);
        dm.clear();
    });

    it('最后一个任务出结论后立即翻转为 100% 与 isSettled=true', () => {
        const dm = mk(['complete', 'complete', 'in_progress']);
        expect(dm.globalProgress().isSettled).toBe(false);
        dm.upsert({
            id: 't2', module: 'M', url: 'u2', dir: 'd', name: 't2.jpg',
            state: 'complete', totalBytes: 100, downloadedBytes: 100, trackerType: 'browser',
        });
        const gp = dm.globalProgress();
        expect(gp.isSettled).toBe(true);
        expect(gp.settledPercent).toBe(100);
        expect(gp.percent).toBe(100);
        dm.clear();
    });

    /**
     * 面板主数字口径（#9）：用户反馈「跑完了总进度还是到不了 100%」。
     * 根因是主数字取的是 percent（成功完成度，失败记 0）。overallPercent 把
     * 失败按满权重计入分子，保证下载环节结束后必定 100%。
     */
    describe('overallPercent（面板主数字：失败也算已处理）', () => {
        it('有失败但已全部跑完时，overallPercent 为 100（percent 仍诚实低于 100）', () => {
            const dm = mk(['complete', 'complete', 'complete', 'interrupted']);
            const gp = dm.globalProgress();
            expect(gp.overallPercent).toBe(100);
            expect(gp.percent).toBe(75);
            expect(gp.failedPercent).toBe(25);
            dm.clear();
        });

        it('全部失败时 overallPercent 也为 100（下载环节确实结束了）', () => {
            const dm = mk(['interrupted', 'interrupted']);
            const gp = dm.globalProgress();
            expect(gp.overallPercent).toBe(100);
            expect(gp.percent).toBe(0);
            dm.clear();
        });

        it('未结束时不得虚报 100：仍有 pending 时被钳制在 99 以下', () => {
            const states = new Array(999).fill('interrupted');
            states.push('pending');
            const dm = mk(states);
            const gp = dm.globalProgress();
            expect(gp.isSettled).toBe(false);
            expect(gp.overallPercent).toBe(99);
            dm.clear();
        });

        it('进行中按字节比平滑推进，且始终不小于成功完成度', () => {
            // 2 完成 + 1 失败 + 1 下载中(50%) → (2 + 0.5 + 1) / 4 = 87.5% → 88
            const dm = mk(['complete', 'complete', 'interrupted', 'in_progress']);
            const gp = dm.globalProgress();
            expect(gp.overallPercent).toBe(88);
            expect(gp.overallPercent).toBeGreaterThanOrEqual(gp.percent);
            dm.clear();
        });

        it('空管理器 overallPercent 为 0，不因 isSettled 而虚报 100', () => {
            const dm = new DownloadManager({});
            expect(dm.globalProgress().overallPercent).toBe(0);
        });
    });
});

/**
 * 分项计数（pending / running / paused）—— 让 globalProgress() 成为**唯一**数据源。
 *
 * 背景：顶栏 chip 原先取自 `stats()`、进度条取自 `globalProgress()`，同一屏的数字
 * 来自两次独立遍历，口径极易漂移。补齐分项后渲染层单次取数即可，`stats()` 退为兜底。
 * 契约：`succeeded + failed + pending + running + paused === totalTasks`，
 * 且与 `stats()` 的对应字段逐项相等（两者不得给出不同答案）。
 */
describe('globalProgress 分项计数与 stats() 一致性', () => {
    function mk(states: string[]): DownloadManager {
        const dm = new DownloadManager({});
        states.forEach((st, i) => {
            dm.upsert({
                id: 't' + i, module: 'M', url: 'u' + i, dir: 'd', name: 't' + i + '.jpg',
                state: st as any, totalBytes: 100,
                downloadedBytes: st === 'complete' ? 100 : (st === 'pending' ? 0 : 50),
                trackerType: 'browser',
            });
        });
        return dm;
    }

    it('五项分类求和恒等于总数，且与 stats() 逐项一致', () => {
        const dm = mk(['complete', 'complete', 'complete', 'interrupted', 'in_progress', 'in_progress', 'paused', 'pending']);
        const gp = dm.globalProgress();
        const s = dm.stats();
        // 不变式：任意时刻五项互斥且铺满全集
        expect(gp.succeeded + gp.failed + gp.pending + gp.running + gp.paused).toBe(gp.totalTasks);
        expect(gp.pending + gp.running + gp.paused).toBe(gp.unsettled);
        expect(gp.succeeded + gp.failed).toBe(gp.settled);
        // 与 stats() 不得给出不同答案（否则顶栏与进度条又会打架）
        expect(gp.totalTasks).toBe(s.total);
        expect(gp.succeeded).toBe(s.complete);
        expect(gp.failed).toBe(s.interrupted);
        expect(gp.running).toBe(s.in_progress);
        expect(gp.paused).toBe(s.paused);
        expect(gp.pending).toBe(s.pending);
        dm.clear();
    });

    it('「媒体」页签行数与总进度计数同源：tasksSorted().length === totalTasks', () => {
        const dm = mk(['complete', 'interrupted', 'in_progress', 'pending', 'paused']);
        const gp = dm.globalProgress();
        const rows = dm.tasksSorted();
        // 媒体页签的分母取自 tasksSorted().length，必须与总进度块的 totalTasks 相等
        expect(rows.length).toBe(gp.totalTasks);
        // 按状态筛选出的行数必须与对应分项计数严格相等
        expect(rows.filter((t) => t.state === 'complete').length).toBe(gp.succeeded);
        expect(rows.filter((t) => t.state === 'interrupted').length).toBe(gp.failed);
        expect(rows.filter((t) => t.state === 'paused').length).toBe(gp.paused);
        dm.clear();
    });

    it('任务后期追加导致 total 变化时，分母与分项同步增长（不出现分子>分母）', () => {
        const dm = mk(['complete', 'complete']);
        expect(dm.globalProgress().totalTasks).toBe(2);
        // 采集后期才注册入队的新任务
        dm.upsert({ id: 'late1', module: 'M', url: 'ul1', dir: 'd', name: 'l1.jpg', state: 'pending', totalBytes: 100, trackerType: 'browser' });
        dm.upsert({ id: 'late2', module: 'M', url: 'ul2', dir: 'd', name: 'l2.jpg', state: 'pending', totalBytes: 100, trackerType: 'browser' });
        const gp = dm.globalProgress();
        expect(gp.totalTasks).toBe(4);
        expect(gp.succeeded).toBe(2);
        expect(gp.pending).toBe(2);
        expect(gp.succeeded).toBeLessThanOrEqual(gp.totalTasks);
        expect(gp.isSettled).toBe(false); // 新任务未出结论 → 不得宣布已结束
        expect(gp.succeeded + gp.failed + gp.pending + gp.running + gp.paused).toBe(gp.totalTasks);
        dm.clear();
    });

    it('失败任务重试后计数迁移而非重复累加（同一 id 不会被计两次）', () => {
        const dm = mk(['complete', 'interrupted']);
        let gp = dm.globalProgress();
        expect(gp.totalTasks).toBe(2);
        expect(gp.failed).toBe(1);
        // 重试：同一个 id 从 interrupted 迁回 pending，总数不得增加
        dm.upsert({ id: 't1', state: 'pending', downloadedBytes: 0, error: undefined, _src: 'retry' } as any);
        gp = dm.globalProgress();
        expect(gp.totalTasks).toBe(2); // 不是 3
        expect(gp.failed).toBe(0); // 已离开失败态
        expect(gp.pending).toBe(1);
        expect(gp.succeeded + gp.failed + gp.pending + gp.running + gp.paused).toBe(gp.totalTasks);
        // 重试成功后回到 complete，仍然只占一个名额
        dm.upsert({ id: 't1', state: 'complete', totalBytes: 100, downloadedBytes: 100 } as any);
        gp = dm.globalProgress();
        expect(gp.totalTasks).toBe(2);
        expect(gp.succeeded).toBe(2);
        expect(gp.isSettled).toBe(true);
        dm.clear();
    });

    it('暂停态不计入已完成：paused 只进 paused/unsettled，不污染 succeeded', () => {
        const dm = mk(['complete', 'paused', 'paused']);
        const gp = dm.globalProgress();
        expect(gp.succeeded).toBe(1);
        expect(gp.paused).toBe(2);
        expect(gp.running).toBe(0);
        expect(gp.unsettled).toBe(2);
        expect(gp.isSettled).toBe(false);
        dm.clear();
    });
});

/* ===================== 浏览器下载器 速度/ETA 修复回归（#ETA / #Speed） =====================
 * 背景根因：Chrome 的 downloads.onChanged 不会为 bytesReceived / estimatedEndTime 的变化触发事件
 * （官方文档原文：除 bytesReceived / estimatedEndTime 外的属性变化才触发 onChanged）。
 * 旧实现里 background 只转发 onCreated/onChanged（下载途中仅带 state/paused/filename/error），
 * 浏览器下载器的 downloadedBytes 永远收不到增量 → upsert 的相邻采样差分恒为 0 →
 * speedBps 永不计算 → globalProgress().etaMs === undefined → 界面「⬇ 0 B/s」「⏱ 预估剩余 -」，
 * 进度条也只能在 complete 瞬间从 0 跳到 100%。
 * 修复：background 新增 400ms 轮询 chrome.downloads.search({state:'in_progress'}) 并广播 bytesReceived 帧。
 * 以下用例锁定该契约：
 *   1) 仅接收 state 帧（无 bytesReceived）的浏览器任务必须 speedBps=0 / etaMs=undefined（复现旧缺陷，锁定需求）；
 *   2) 接收 bytesReceived 帧（模拟修复后的轮询补帧）后，speedBps>0 且 task/global 的 etaMs 为有限正数。
 */
describe('浏览器下载器 速度/ETA 修复回归（#ETA/#Speed）', () => {
    let onMsgListeners: any[];
    beforeEach(() => {
        onMsgListeners = [];
        (globalThis as any).chrome = {
            runtime: {
                lastError: undefined,
                sendMessage: (_msg: any, cb?: any) => { setTimeout(() => cb && cb({ ok: true, downloadId: 7001 }), 5); },
                onMessage: {
                    addListener: (fn: any) => onMsgListeners.push(fn),
                    removeListener: (fn: any) => { const i = onMsgListeners.indexOf(fn); if (i >= 0) onMsgListeners.splice(i, 1); },
                },
            },
        };
    });
    afterEach(() => { delete (globalThis as any).chrome; });

    it('复现旧缺陷：仅 state 帧（无 bytesReceived）时浏览器下载器 speedBps=0 且 etaMs=undefined', async () => {
        const dm = new DownloadManager({});
        dm.upsert({ id: 'b0', module: 'M', url: 'u', dir: 'd', name: 'b0.jpg', state: 'pending', downloadId: 7001, trackerType: 'browser' });
        dm.submitTask('b0');
        await new Promise((r) => setTimeout(r, 200)); // 等待 submit 把状态推进为 in_progress（仅 state 帧）
        const t = dm.get('b0')!;
        expect(t.state).toBe('in_progress');
        // 没有 bytesReceived 帧 → 采样差分恒为 0 → 速度/ETA 永远算不出（旧缺陷表现）
        expect(t.speedBps || 0).toBe(0);
        expect(t.etaMs).toBeUndefined();
        // 全局概览同样读不到 ETA → 界面显示「预估剩余 -」
        expect(dm.globalProgress().etaMs).toBeUndefined();
        expect(dm.globalProgress().speedBps || 0).toBe(0);
        dm.clear();
    });

    it('修复验证：background 轮询补发 bytesReceived 帧后，speedBps>0 且 task/global etaMs 为有限正数', async () => {
        const dm = new DownloadManager({});
        dm.upsert({ id: 'b1', module: 'M', url: 'u', dir: 'd', name: 'b1.jpg', state: 'pending', downloadId: 7001, trackerType: 'browser' });
        dm.submitTask('b1');
        await new Promise((r) => setTimeout(r, 30));
        expect(dm.get('b1')!.state).toBe('in_progress');

        // 模拟修复后的 background 轮询：第 1 帧（建立基准采样点，downloadedBytes 0→1000）
        onMsgListeners.forEach((fn) => fn({
            type: DLEvent.PROGRESS_BATCH,
            items: [{ downloadId: 7001, bytesReceived: 1000, totalBytes: 10000 }],
        }));
        // 间隔 > 100ms 满足 upsert 速度采样阈值（dtSec>0.1），否则本帧只更新采样点不算速
        await new Promise((r) => setTimeout(r, 200));
        // 第 2 帧：字节递增 → 计算瞬时速度，进而推算 ETA
        onMsgListeners.forEach((fn) => fn({
            type: DLEvent.PROGRESS_BATCH,
            items: [{ downloadId: 7001, bytesReceived: 6000, totalBytes: 10000 }],
        }));
        await new Promise((r) => setTimeout(r, 20));

        const t = dm.get('b1')!;
        expect(t.downloadedBytes).toBe(6000);
        expect(t.speedBps && t.speedBps > 0).toBe(true); // 实时速度非 0
        // 仍在进行且已下载 < 总量 → ETA 为有限正数（界面「预估剩余 X」应显示，而非「-」）
        expect(typeof t.etaMs === 'number' && t.etaMs! > 0).toBe(true);
        const gp = dm.globalProgress();
        expect(gp.speedBps > 0).toBe(true);
        expect(typeof gp.etaMs === 'number' && gp.etaMs! > 0).toBe(true);
        dm.clear();
    });
});
