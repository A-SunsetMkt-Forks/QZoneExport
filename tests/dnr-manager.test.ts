/**
 * Disk（直写目录）模式下载失败自动注册 DNR 并重试一次（content → background DNR_ADD_HOST）集成测试。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DownloadManager } from '../core/downloader/manager';

describe('Disk 失败自动注册 DNR 并重试一次', () => {
    let calls: any[];
    let fakeChrome: any;
    beforeEach(() => {
        calls = [];
        fakeChrome = {
            runtime: {
                lastError: undefined,
                sendMessage: async (msg: any) => {
                    calls.push(msg);
                    // 模拟 background 成功增量注册 Referer 规则 + 持久化
                    return { ok: true, added: true, persisted: true };
                },
            },
        };
        (globalThis as any).chrome = fakeChrome;
    });
    afterEach(() => {
        delete (globalThis as any).chrome;
    });

    it('Disk 任务 HTTP 403 时自动请求 DNR_ADD_HOST 并自动重试一次（防循环：同 host 不再触发）', async () => {
        const dm: any = new DownloadManager({});
        dm.setConcurrencyLimit(10);
        // 假 disk 驱动：始终返回 HTTP 403（模拟该 host 不在 refererUrls、缺 Referer 被服务端拒绝）
        (dm as any).drivers.disk = { type: 'disk', submit: async () => ({ error: 'HTTP 403 Forbidden' }) };
        dm.upsert({ id: 'd1', module: 'M', url: 'https://shp.qpic.cn/x.jpg', dir: 'd', name: 'x.jpg', state: 'pending', trackerType: 'disk' });
        await dm.submitTask('d1');
        // 等待自动重试（fire-and-forget）完成两轮回合
        await new Promise((r) => setTimeout(r, 300));
        const dnrCalls = calls.filter((c) => c.type === 'dnr_add_host');
        // 第一次失败触发注册；自动重试仍 403，但 host 已记入防循环集合，不再重复注册
        expect(dnrCalls.length).toBe(1);
        expect(dnrCalls[0].host).toBe('shp.qpic.cn');
        // 任务最终仍 interrupted（驱动持续 403 无法自愈），但已被自动重试过一次
        expect(dm.get('d1').state).toBe('interrupted');
        expect(dm.get('d1').error).toContain('403');
        expect(dm.get('d1').retries).toBeGreaterThanOrEqual(1);
        dm.clear();
    });

    it('浏览器模式（非 disk）失败不触发自动 DNR', async () => {
        const dm: any = new DownloadManager({});
        dm.setConcurrencyLimit(10);
        (dm as any).drivers.browser = { type: 'browser', submit: async () => ({ error: 'HTTP 403 Forbidden' }) };
        dm.upsert({ id: 'b1', module: 'M', url: 'https://shp.qpic.cn/x.jpg', dir: 'd', name: 'x.jpg', state: 'pending', trackerType: 'browser' });
        await dm.submitTask('b1');
        await new Promise((r) => setTimeout(r, 100));
        expect(calls.filter((c) => c.type === 'dnr_add_host').length).toBe(0);
        dm.clear();
    });

    it('任意 http(s) 域名的失败都会触发自动 DNR（不再限制 QQ 系）', async () => {
        const dm: any = new DownloadManager({});
        dm.setConcurrencyLimit(10);
        (dm as any).drivers.disk = { type: 'disk', submit: async () => ({ error: 'HTTP 403' }) };
        // 非 QQ 系第三方图床地址：按新策略也应自动注册 Referer 规则并重试一次
        dm.upsert({ id: 'x1', module: 'M', url: 'https://third-party-cdn.example.org/x.jpg', dir: 'd', name: 'x.jpg', state: 'pending', trackerType: 'disk' });
        await dm.submitTask('x1');
        await new Promise((r) => setTimeout(r, 100));
        const dnrCalls = calls.filter((c) => c.type === 'dnr_add_host');
        expect(dnrCalls.length).toBe(1);
        expect(dnrCalls[0].host).toBe('third-party-cdn.example.org');
        expect(dm.get('x1').retries).toBeGreaterThanOrEqual(1);
        dm.clear();
    });

    it('非 http(s) 协议（如 data:）的失败不触发自动 DNR（协议护栏）', async () => {
        const dm: any = new DownloadManager({});
        dm.setConcurrencyLimit(10);
        (dm as any).drivers.disk = { type: 'disk', submit: async () => ({ error: 'HTTP 403' }) };
        dm.upsert({ id: 'z1', module: 'M', url: 'data:image/png;base64,AAAA', dir: 'd', name: 'z.png', state: 'pending', trackerType: 'disk' });
        await dm.submitTask('z1');
        await new Promise((r) => setTimeout(r, 100));
        expect(calls.filter((c) => c.type === 'dnr_add_host').length).toBe(0);
        dm.clear();
    });

    it('同 host 多个失败任务：仅注册一次 DNR 规则，但每个失败任务都自动重试一次', async () => {
        const dm: any = new DownloadManager({});
        dm.setConcurrencyLimit(10);
        (dm as any).drivers.disk = { type: 'disk', submit: async () => ({ error: 'HTTP 403' }) };
        for (const id of ['h1', 'h2', 'h3']) {
            dm.upsert({ id, module: 'M', url: `https://shp.qpic.cn/${id}.jpg`, dir: 'd', name: `${id}.jpg`, state: 'pending', trackerType: 'disk' });
            void dm.submitTask(id);
        }
        await new Promise((r) => setTimeout(r, 400));
        const dnrCalls = calls.filter((c) => c.type === 'dnr_add_host');
        expect(dnrCalls.length).toBe(1); // 同一 host 规则只注册一次
        expect(dnrCalls[0].host).toBe('shp.qpic.cn');
        for (const id of ['h1', 'h2', 'h3']) {
            // 该 host 下每个失败文件都应被自动重试一次（不只是第一个）
            expect(dm.get(id).retries).toBeGreaterThanOrEqual(1);
        }
        dm.clear();
    });
});
