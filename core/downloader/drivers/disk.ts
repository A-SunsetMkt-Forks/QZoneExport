/**
 * 直写盘下载器（替代旧 common.js downloadsToDisk）
 * 通过 fetch 拉取二进制，直接写入磁盘（DiskFS 模式）或收集进 ZIP（打包模式）。
 * 进度通过 Content-Length + 已接收字节回报。
 *
 * 下载通道选择（修复「302→http 被 Mixed Content 拦」）：
 *  - 所有源统一优先直连 fetch（零额外开销）。http 源先经 toHttps 升 https 再直连，绝大多数媒体（含 *.qpic.cn）经此成功。
 *  - 仅当直连抛错（混合内容/CORS/网络，典型为 http 签名 URL 302→http 被 HTTPS 页 Mixed Content 拦）时，
 *    才回退 background 代理：background 持 host_permissions ['<all_urls>']，不受 Mixed Content/CORS 约束，可自由跟随 http 302。
 *  - 不强制 http 源走代理：background 的 fetch 不带页面 Referer/Cookie，多数 http 媒体依赖 DNR 注入的 Referer 鉴权，
 *    强制走代理会 403 → 空数据，反而比直连更糟（直连失败回退才是最稳路径）。
 */

import type { DownloadDriver, DownloadRequest, ProgressReporter } from './types';
import type { FileWriter } from '../../fs/writer';
import type { ChunkSink } from '../../fs/disk-fs';
import { mergeM3u8 } from '../m3u8-merger';
import { toHttps, base64ToBytes } from '../../shared/utils';
import { BG_MSG } from '../../shared/messages';

export class DiskDriver implements DownloadDriver {
    readonly type = 'disk' as const;
    private readonly writer: FileWriter;
    /** 下载超时（毫秒），用于 AbortController */
    private readonly timeoutMs: number;

    constructor(writer: FileWriter, timeoutMs = 60000) {
        this.writer = writer;
        this.timeoutMs = timeoutMs;
    }

    async submit(req: DownloadRequest, reporter: ProgressReporter): Promise<{ trackerId?: string; error?: string }> {
        // 直写盘模式跨备份去重：目标路径已存在非空文件 → 跳过，不重复下载覆盖。
        // 磁盘是「是否已下载」的真相源——同一 URL 生成同一文件名（hashString(url)+后缀），
        // 且按实际目标文件是否存在判断，天然抗「换备份目录」场景（换目录则文件不存在 → 正常重下），
        // 不受 chrome.storage 里 URL 去重集合被 clearStaging 清空的影响。
        if (this.writer.diskEnabled) {
            const relPath = (req.dir ? req.dir.replace(/\/$/, '') + '/' : '') + req.name;
            if (await this.writer.exists(relPath)) {
                reporter.onState?.('complete');
                return { trackerId: 'disk_skip_' + req.id };
            }
        }

        // 统一升级为 HTTPS：助手运行在 HTTPS 页面下，若媒体地址仍为 http://（如 http://xxx.qpic.cn/...）
        // 直接 fetch 会被 Mixed Content 策略拦截。DNR 规则已放行跨域，但协议必须 https 才能放行；
        // 此处兜底确保「第一跳」始终以 HTTPS 拉取（重定向后的 http 落点由代理通道兜底）。
        const targetUrl = toHttps(req.url);

        // M3U8 直播/点播流：助手直写目录下自动识别分片、按需下载/续传并顺序合并为完整视频
        if (targetUrl && targetUrl.includes('.m3u8') && this.writer.diskEnabled) {
            const disk = this.writer.getDiskFS();
            if (disk) {
                return mergeM3u8(disk, { ...req, url: targetUrl }, reporter, this.timeoutMs);
            }
        }

        // 统一策略：优先直连 fetch（零额外开销）。http 源已先经 toHttps 升 https，绝大多数媒体—含 *.qpic.cn—经此成功。
        // 仅当直连抛错（混合内容/CORS/网络，典型为 http 签名 URL 302→http 被 HTTPS 页 Mixed Content 拦）时，
        // 才回退 background 代理。background 持 <all_urls>，不受 Mixed Content/CORS 约束，可自由跟随 http 302。
        // 注意：不可对 http 源「强制代理」——background 的 fetch 不带页面 Referer/Cookie，多数 http 媒体依赖
        // DNR 注入的 Referer 鉴权，强行走代理会 403 → 空数据，反而比直连更糟。
        const direct = await this.tryDirect(targetUrl, req, reporter);
        if (direct) return direct; // 成功或确定性 HTTP 错误，无需代理
        return this.downloadViaProxy(targetUrl, req, reporter);
    }

    /**
     * 直连 fetch（content script 在 qzone.qq.com HTTPS 下）。
     * - 返回 {trackerId}：成功落盘
     * - 返回 {error}：拿到响应但 HTTP 非 2xx（确定性失败，代理也会同样结果，无需回退）
     * - 返回 null：fetch 抛错（网络/混合内容/CORS），交给 submit 回退代理
     */
    private async tryDirect(targetUrl: string, req: DownloadRequest, reporter: ProgressReporter): Promise<{ trackerId?: string; error?: string } | null> {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.timeoutMs);
            // 注意：直写盘媒体请求运行在 content script（页面源 qzone.qq.com）下，跨域拉取受 CORS 约束。
            // DNR 放行规则只注入 `Access-Control-Allow-Origin: *`（不带 Allow-Credentials），而携带
            // credentials:'include' 的跨域请求要求 ACAO 必须为精确源且带 ACAC:true，与 `*` 冲突会直接报
            // "Failed to fetch"。媒体文件靠签名 URL + DNR 注入的 Referer 鉴权，无需用户 cookie，故此处不携凭据，
            // 与 v2 downloadsToDisk 的 `fetch(url)` 行为一致。
            const resp = await fetch(targetUrl, {
                method: 'GET',
                signal: controller.signal,
            });
            clearTimeout(timer);
            if (!resp.ok || !resp.body) {
                return { error: `HTTP ${resp.status} ${resp.statusText || ''}`.trim() };
            }
            const total = Number(resp.headers.get('content-length')) || 0;
            await this.streamToDisk(resp.body as ReadableStream<Uint8Array>, req, reporter, total);
            return { trackerId: 'disk_' + req.id };
        } catch {
            return null; // 抛错 → 回退代理
        }
    }

    /**
     * 经 background 代理 fetch（background 持 <all_urls>，不受 Mixed Content/CORS 约束，
     * 可自由跟随 http 302）。background 分块回传字节，content 每收一块即 append 落盘（见 openProxyStream）。
     * 用于直连抛错（混合内容/CORS/网络，典型为 http 签名 URL 302→http 被 HTTPS 页 Mixed Content 拦）的回退。
     */
    private async downloadViaProxy(targetUrl: string, req: DownloadRequest, reporter: ProgressReporter): Promise<{ trackerId?: string; error?: string }> {
        const filepath = (req.dir ? req.dir.replace(/\/$/, '') + '/' : '') + req.name;
        try {
            const { meta } = await this.openProxyStream(targetUrl, filepath, reporter);
            if (meta && !meta.ok) {
                return { error: `HTTP ${meta.status} ${meta.statusText || ''}`.trim() };
            }
            reporter.onState?.('complete');
            return { trackerId: 'disk_proxy_' + req.id };
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            return { error: errMsg };
        }
    }

    /**
     * 把媒体字节流写入 DiskFS，并回报进度（有总大小时）。
     * @param total 已知总大小（字节）；0 表示未知（不回报进度，避免把已探明总大小抹成 0）。
     */
    private async streamToDisk(stream: ReadableStream<Uint8Array>, req: DownloadRequest, reporter: ProgressReporter, total = 0): Promise<void> {
        const filepath = (req.dir ? req.dir.replace(/\/$/, '') + '/' : '') + req.name;
        let s: ReadableStream<Uint8Array> = stream;
        if (total) {
            let received = 0;
            s = stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
                transform(chunk, controller) {
                    received += chunk.length;
                    reporter.onProgress?.(received, total);
                    controller.enqueue(chunk);
                },
            }));
        }
        await this.writer.writeStreamFile(filepath, s);
        reporter.onState?.('complete');
    }

    /**
     * 打开到 background 的 disk-fetch 代理长连接，分块拉取媒体字节并直接 append 落盘。
     * 协议：content 连 port(name=BG_MSG.DISK_FETCH_PROXY) 发 {type:'start',url}；
     * background 回 {type:'meta',status,statusText,contentLength}
     * → 若干 {type:'chunk',data:base64} → {type:'done'}；异常 {type:'error',message}。
     * 每块经 port 以 base64 字符串回传（实测 Uint8Array 结构化克隆会丢数据，base64 字符串稳定），
     * content 每收一块即解码 append 落盘；不重建 ReadableStream、不一次性 base64 整文件（内存恒定、大文件无上限）。
     */
    private openProxyStream(url: string, filepath: string, reporter: ProgressReporter): Promise<{ meta: { ok: boolean; status: number; statusText: string; contentLength: number } | null }> {
        return new Promise((resolve, reject) => {
            const rt = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome.runtime : undefined;
            if (!rt || typeof rt.connect !== 'function') {
                reject(new Error('当前环境不支持 background 代理（chrome.runtime 不可用）'));
                return;
            }
            const port = rt.connect({ name: BG_MSG.DISK_FETCH_PROXY });
            let settled = false;
            let sink: ChunkSink | null = null;
            let metaRef: { ok: boolean; status: number; statusText: string; contentLength: number } | null = null;
            let received = 0;
            const cleanup = (): void => { try { port.disconnect(); } catch { /* ignore */ } };
            const fail = (err: Error): void => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(err);
            };
            // port.onMessage 的 async 回调不阻塞后续消息分发；若 chunk 早于 meta 的 openChunkSink
            // 完成而执行会丢块。用串行 chain 保证处理严格按到达顺序：meta 先开 sink，再逐块写 chunk。
            let chain: Promise<void> = Promise.resolve();
            const enqueue = (fn: () => Promise<void>): void => {
                chain = chain.then(fn).catch((e) => { fail(e instanceof Error ? e : new Error(String(e))); });
            };
            const handle = async (msg: any): Promise<void> => {
                if (!msg || typeof msg !== 'object') return;
                if (msg.type === 'error') {
                    fail(new Error(String(msg.message || 'background 代理返回错误')));
                    return;
                }
                if (msg.type === 'meta') {
                    metaRef = {
                        ok: Number(msg.status) >= 200 && Number(msg.status) < 300,
                        status: Number(msg.status),
                        statusText: String(msg.statusText || ''),
                        contentLength: Number(msg.contentLength) || 0,
                    };
                    if (metaRef.ok) {
                        sink = await this.writer.openChunkSink(filepath);
                    }
                    return;
                }
                if (msg.type === 'chunk') {
                    if (!sink) return; // 容错：meta 未到先收 chunk（正常不发生，background 先发 meta）
                    // 分块以 base64 字符串回传（实测 Uint8Array 经 port 结构化克隆会丢数据）。
                    // 同时保留二进制兜底（ArrayBuffer/Uint8Array），兼容任何仍走二进制的来源。
                    let data: Uint8Array | null = null;
                    if (typeof msg.data === 'string') {
                        try { data = base64ToBytes(msg.data); } catch { data = null; }
                    } else if (msg.data instanceof ArrayBuffer) {
                        data = new Uint8Array(msg.data);
                    } else if (msg.data && typeof (msg.data as { byteLength?: number }).byteLength === 'number') {
                        data = new Uint8Array(msg.data as unknown as ArrayLike<number>);
                    }
                    if (!data || data.byteLength === 0) return;
                    await sink.write(data);
                    received += data.byteLength;
                    if (metaRef && metaRef.contentLength) {
                        reporter.onProgress?.(received, metaRef.contentLength);
                    }
                    return;
                }
                if (msg.type === 'done') {
                    if (settled) return;
                    if (!sink) { // meta 非 ok（无 sink）：直接完成，由上层判 HTTP 错误
                        settled = true;
                        cleanup();
                        resolve({ meta: metaRef });
                        return;
                    }
                    if (received === 0) { // 已开 sink 但无任何字节：空数据，判失败（不写 0KB 文件）
                        settled = true;
                        cleanup();
                        reject(new Error('代理返回空数据'));
                        return;
                    }
                    try {
                        await sink.close();
                    } catch (e) {
                        fail(e instanceof Error ? e : new Error(String(e)));
                        return;
                    }
                    settled = true;
                    cleanup();
                    resolve({ meta: metaRef });
                }
            };
            port.onMessage.addListener((msg: any) => enqueue(() => handle(msg)));
            port.onDisconnect.addListener(() => {
                if (!settled) fail(new Error('background 代理连接中断'));
            });
            port.postMessage({ type: 'start', url, method: 'GET' });
        });
    }
}
