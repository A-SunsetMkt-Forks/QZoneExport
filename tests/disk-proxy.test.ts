/**
 * DiskDriver 下载通道回归测试，覆盖两点：
 *  1) 经 background 代理分块下载时，字节逐块真实 append 落盘（修复「0 字节文件 / 一次性 base64 整文件」）。
 *  2) 路由护栏：http 源若直连成功，绝不打开代理端口（防止把「已知 302 才走代理」错误改成「所有 http 强制走代理」）。
 *
 * 模拟 background 的 disk-fetch 端口行为（分块协议）：
 *   content 发 {type:'start'} → background 回 {type:'meta'} → 若干 {type:'chunk',data:base64} → {type:'done'}
 *                              | {type:'error', message}
 * 每块以 base64 字符串回传（实测 Uint8Array 经 port 结构化克隆会丢数据，base64 通道稳定），content 每收一块即解码 append 落盘。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DiskDriver } from '../core/downloader/drivers/disk';
import { bytesToBase64 } from '../core/shared/utils';

function makeBytes(n: number): Uint8Array {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = (i * 7 + 3) & 0xff;
    return b;
}

// 把字节切成若干块（模拟 background 的 reader.read() 分块）
function splitChunks(bytes: Uint8Array, size: number): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += size) {
        out.push(bytes.subarray(i, Math.min(i + size, bytes.length)));
    }
    return out;
}

// 等一个 macrotask，确保 submit 内的「直连(异步 fetch)失败 → 回退代理、挂好端口监听器」完成
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('DiskDriver 下载通道', () => {
    let portListeners: ((msg: any) => void)[] = [];
    const port: any = {
        postMessage: (_m: any) => { /* noop：由测试手动 emit 模拟 background 回包 */ },
        onMessage: { addListener: (fn: any) => portListeners.push(fn) },
        onDisconnect: { addListener: () => {} },
        disconnect: () => {},
    };
    let connectCalls = 0;
    let fakeChrome: any;
    let written: { bytes?: Uint8Array; path?: string } = {};
    let fakeWriter: any;
    let reporterCalls: { progress: Array<[number, number]>; state: string[] } = { progress: [], state: [] };
    /** 模拟目标文件是否已在磁盘（非空）。测试跨备份去重跳过后置 true 验证跳过分支 */
    let existsResult = false;

    beforeEach(() => {
        portListeners = [];
        connectCalls = 0;
        written = {};
        reporterCalls = { progress: [], state: [] };
        existsResult = false;
        fakeChrome = { runtime: { connect: vi.fn(() => { connectCalls++; return port; }) } };
        (globalThis as any).chrome = fakeChrome;
        // 默认：直连 fetch 失败（模拟 Mixed Content/网络），迫使回退代理——已有代理测试依赖此路径。
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch (mock direct blocked)')));
        fakeWriter = {
            get diskEnabled() { return true; },
            getDiskFS: () => ({}) as any,
            // 跨备份去重：目标文件已存在（非空）则跳过。默认 false（文件不存在，正常下载）
            exists: async () => existsResult,
            writeStreamFile: async () => {},
            writeFile: async (data: Uint8Array, path: string) => { written.bytes = data; written.path = path; },
            // 模拟 DiskFS.chunkSink：收集每块，close 时合并为完整字节（与真实落盘等价）
            openChunkSink: async (path: string) => {
                const chunks: Uint8Array[] = [];
                return {
                    write: async (c: Uint8Array | ArrayBuffer) => {
                        chunks.push(c instanceof ArrayBuffer ? new Uint8Array(c) : c);
                    },
                    close: async () => {
                        const total = chunks.reduce((s, c) => s + c.length, 0);
                        const out = new Uint8Array(total);
                        let off = 0;
                        for (const c of chunks) { out.set(c, off); off += c.length; }
                        written.bytes = out;
                        written.path = path;
                    },
                };
            },
        };
    });

    afterEach(() => {
        delete (globalThis as any).chrome;
        vi.unstubAllGlobals();
    });

    function emit(msg: any): void {
        for (const l of portListeners) l(msg);
    }

    function metaMsg(opts: { status: number; statusText?: string; contentLength?: number }): any {
        const ok = opts.status >= 200 && opts.status < 300;
        return {
            type: 'meta',
            status: opts.status,
            statusText: opts.statusText || (ok ? 'OK' : ''),
            contentLength: opts.contentLength ?? 0,
        };
    }

    const reporter = () => ({
        onProgress: (a: number, b: number) => reporterCalls.progress.push([a, b]),
        onState: (s: string) => reporterCalls.state.push(s),
        onError: () => {},
    });

    // —— 代理路径：直连失败 → 回退代理，分块字节真实写入 ——
    it('http 源走代理：分块字节逐块 append 落盘（文件大小真实，非 0KB）', async () => {
        const bytes = makeBytes(2048);
        const chunks = splitChunks(bytes, 1024); // 2 块
        const driver = new DiskDriver(fakeWriter as any);
        const req = { id: 't1', url: 'http://r.photo.store.qq.com/psc?x', dir: 'photos', name: 'a.jpg' } as any;
        const p = driver.submit(req, reporter() as any);
        await tick();
        emit(metaMsg({ status: 200, contentLength: bytes.length }));
        for (const c of chunks) emit({ type: 'chunk', data: bytesToBase64(c) });
        emit({ type: 'done' });
        const res = await p;
        expect(res.trackerId).toBe('disk_proxy_t1');
        expect(res.error).toBeUndefined();
        // 关键断言：写入的字节与源完全一致（证明分块跨 port 传输 + append 无损，非 0KB）
        expect(written.bytes).toBeInstanceOf(Uint8Array);
        expect(Array.from(written.bytes as Uint8Array)).toEqual(Array.from(bytes));
        expect(written.path).toBe('photos/a.jpg');
        // 分块时每块回报一次进度：第 1 块后 [1024,2048]，第 2 块后 [2048,2048]
        expect(reporterCalls.progress).toEqual([[bytes.length / 2, bytes.length], [bytes.length, bytes.length]]);
        expect(reporterCalls.state).toEqual(['complete']);
    });

    it('较大文件多块分块（2000+2000+1000）：顺序与内容逐字节一致', async () => {
        const bytes = makeBytes(5000);
        const chunks = splitChunks(bytes, 2000); // [2000,2000,1000]
        const driver = new DiskDriver(fakeWriter as any);
        const req = { id: 't2', url: 'http://x/big.jpg', dir: '', name: 'b.png' } as any;
        const p = driver.submit(req, reporter() as any);
        await tick();
        emit(metaMsg({ status: 200, contentLength: bytes.length }));
        for (const c of chunks) emit({ type: 'chunk', data: bytesToBase64(c) });
        emit({ type: 'done' });
        const res = await p;
        expect(res.trackerId).toBe('disk_proxy_t2');
        expect(Array.from(written.bytes as Uint8Array)).toEqual(Array.from(bytes));
        expect(written.path).toBe('b.png');
    });

    it('单块（< 分块阈值）也能正确落盘', async () => {
        const bytes = makeBytes(512);
        const driver = new DiskDriver(fakeWriter as any);
        const req = { id: 't3', url: 'http://x/one.jpg', dir: 'd', name: 'c.jpg' } as any;
        const p = driver.submit(req, reporter() as any);
        await tick();
        emit(metaMsg({ status: 200, contentLength: bytes.length }));
        emit({ type: 'chunk', data: bytesToBase64(bytes) });
        emit({ type: 'done' });
        const res = await p;
        expect(res.trackerId).toBe('disk_proxy_t3');
        expect(Array.from(written.bytes as Uint8Array)).toEqual(Array.from(bytes));
    });

    it('background 回传空数据（meta ok 但无 chunk）：判定失败（不再写出 0KB 文件）', async () => {
        const driver = new DiskDriver(fakeWriter as any);
        const req = { id: 't4', url: 'http://x/empty.jpg', dir: 'd', name: 'e.jpg' } as any;
        const p = driver.submit(req, reporter() as any);
        await tick();
        emit(metaMsg({ status: 200, contentLength: 0 }));
        emit({ type: 'done' });
        const res = await p;
        expect(res.trackerId).toBeUndefined();
        expect(res.error).toContain('空数据');
        expect(written.bytes).toBeUndefined(); // 没有写出文件
    });

    it('HTTP 非 2xx（如 403）：直接返回错误，不写文件', async () => {
        const driver = new DiskDriver(fakeWriter as any);
        const req = { id: 't5', url: 'http://x/forbidden.jpg', dir: 'd', name: 'f.jpg' } as any;
        const p = driver.submit(req, reporter() as any);
        await tick();
        emit(metaMsg({ status: 403, statusText: 'Forbidden' }));
        emit({ type: 'done' });
        const res = await p;
        expect(res.trackerId).toBeUndefined();
        expect(res.error).toContain('HTTP 403');
        expect(written.bytes).toBeUndefined();
    });

    it('background 端口返回 error：任务失败', async () => {
        const driver = new DiskDriver(fakeWriter as any);
        const req = { id: 't6', url: 'http://x/err.jpg', dir: 'd', name: 'g.jpg' } as any;
        const p = driver.submit(req, reporter() as any);
        await tick();
        emit({ type: 'error', message: 'mock network down' });
        const res = await p;
        expect(res.trackerId).toBeUndefined();
        expect(res.error).toBe('mock network down');
    });

    it('chrome.runtime 不可用时（单测/非扩展环境）代理直接失败而非卡死', async () => {
        delete (globalThis as any).chrome;
        const driver = new DiskDriver(fakeWriter as any);
        const req = { id: 't7', url: 'http://x/nope.jpg', dir: 'd', name: 'h.jpg' } as any;
        const res = await driver.submit(req, reporter() as any);
        expect(res.trackerId).toBeUndefined();
        expect(res.error).toContain('background 代理');
    });

    // —— 跨备份去重：目标文件已存在则跳过，不重复下载覆盖 ——
    it('直写盘跨备份去重：目标文件已存在（非空）→ 跳过，不 fetch、不写盘、上报 complete', async () => {
        existsResult = true;
        const driver = new DiskDriver(fakeWriter as any);
        const req = { id: 'skip1', url: 'http://x/exists.jpg', dir: 'Messages/images', name: 'a.jpg' } as any;
        const res = await driver.submit(req, reporter() as any);
        expect(res.trackerId).toBe('disk_skip_skip1');
        expect(res.error).toBeUndefined();
        expect(written.bytes).toBeUndefined(); // 未写盘（未覆盖已有文件）
        expect(reporterCalls.state).toEqual(['complete']);
        expect(connectCalls).toBe(0); // 未走代理
        // fetch 未被调用（跳过分支不发起网络请求）
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('直写盘跨备份去重：目标文件不存在 → 照常下载（不误跳过）', async () => {
        existsResult = false;
        const body = new ReadableStream<Uint8Array>({
            start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); },
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, status: 200, statusText: 'OK',
            body,
            headers: { get: (k: string) => (k === 'content-length' ? '3' : null) },
        }));
        const driver = new DiskDriver(fakeWriter as any);
        const req = { id: 'skip2', url: 'http://x/new.jpg', dir: 'Messages/images', name: 'b.jpg' } as any;
        const res = await driver.submit(req, reporter() as any);
        expect(res.trackerId).toBe('disk_skip2'); // 正常直连落盘
        expect(vi.mocked(fetch)).toHaveBeenCalled();
    });

    // —— 路由护栏：http 源直连成功时绝不走代理 ——
    it('路由护栏：http 源直连成功时绝不打开代理端口（防止 forceProxy 回归）', async () => {
        const body = new ReadableStream<Uint8Array>({
            start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); },
        });
        // 直连 fetch 成功（模拟 *.qpic.cn 等 http 源经 toHttps 直连可用）
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, status: 200, statusText: 'OK',
            body,
            headers: { get: (k: string) => (k === 'content-length' ? '3' : null) },
        }));
        const driver = new DiskDriver(fakeWriter as any);
        const req = { id: 'rt1', url: 'http://xxx.qpic.cn/a.jpg', dir: 'p', name: 'a.jpg' } as any;
        const res = await driver.submit(req, reporter() as any);
        expect(res.trackerId).toBe('disk_rt1'); // 直连成功落盘
        expect(res.error).toBeUndefined();
        expect(connectCalls).toBe(0); // 绝未打开代理端口
    });
});
