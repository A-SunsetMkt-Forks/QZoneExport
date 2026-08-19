/**
 * M3U8 流媒体合并下载器（"助手直写目录"模式专属）
 *
 * 能力：
 *  - 自动解析 M3U8 分片列表（支持 Master Playlist 多码率选优、#EXT-X-KEY AES-128 解密、
 *    #EXT-X-BYTERANGE 字节区间）
 *  - 并发下载每个 TS 分片到临时目录（按临时文件存在性实现分片级断点续传）
 *  - 用单一可写流按序把分片拼接进最终文件，全程不把整个视频驻留内存（规避 >2GB OOM）
 *  - 合并完成后清理临时分片目录
 *
 * 产物为 MPEG-TS 流（直接 concat 相邻 TS 分片是标准做法），扩展名统一为 .ts；
 * 若需标准 MP4 容器需额外转封装（如 ffmpeg.wasm），本模块不做。
 */

import type { DownloadRequest, ProgressReporter } from './drivers/types';
import type { DiskFS } from '../fs/disk-fs';
import { runPool } from './pool';
import { toHttps } from '../shared/utils';

/** 单个分片 */
interface M3u8Segment {
    url: string;
    byteRange?: { length: number; offset: number };
    key?: { method: 'AES-128' | 'NONE'; uri?: string; iv: Uint8Array };
}

interface ParsedM3u8 {
    segments: M3u8Segment[];
    variants?: { bw: number; uri: string }[];
}

/** 分片并发数（磁盘 IO 为主，过高反而因随机寻道变慢） */
const SEGMENT_CONCURRENCY = 8;
/** 临时分片目录名前缀（位于视频所在目录内，合并后整体删除） */
const TMP_DIR_PREFIX = '__m3u8_tmp__';

/** 相对/绝对地址补全（与 video-tasks.applyTsUrl 同逻辑，内联避免跨模块耦合） */
function applyTsUrl(target: string, base: string): string {
    if (/^https?:\/\//i.test(target)) {
        return target;
    }
    try {
        return new URL(target, base).href;
    } catch {
        return target;
    }
}

function hexToBytes(hex: string): Uint8Array {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return out;
}

/** 解析 #EXT-X-KEY 行 */
function parseKey(line: string, base: string): { method: 'AES-128' | 'NONE'; uri?: string; iv: Uint8Array } {
    const method = /METHOD=([^,]+)/.exec(line)?.[1] || 'NONE';
    if (method === 'NONE') {
        return { method: 'NONE', iv: new Uint8Array(16) };
    }
    const uri = /URI="([^"]+)"/.exec(line)?.[1];
    const ivHex = /IV=0x([0-9A-Fa-f]+)/.exec(line)?.[1];
    const iv = ivHex ? hexToBytes(ivHex) : new Uint8Array(16);
    return { method: 'AES-128', uri: uri ? applyTsUrl(uri, base) : undefined, iv };
}

/**
 * 解析 M3U8 文本为分片列表。
 * 若为 Master Playlist（含 #EXT-X-STREAM-INF），解析出的 variants 交由上层递归选取带宽最高的再解析。
 */
function parseM3u8(text: string, base: string): ParsedM3u8 {
    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
    const segments: M3u8Segment[] = [];
    let currentKey: { method: 'AES-128' | 'NONE'; uri?: string; iv: Uint8Array } | undefined;
    let pendingByteRange: { length: number; offset: number } | null = null;
    let byteRangeBaseUrl: string | null = null;
    let autoOffset = 0;
    const variants: { bw: number; uri: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.startsWith('#EXT-X-STREAM-INF')) {
            const bw = parseInt(/BANDWIDTH=(\d+)/.exec(line)?.[1] || '0', 10);
            const uri = applyTsUrl(lines[++i] || '', base);
            variants.push({ bw, uri });
            continue;
        }
        if (line.startsWith('#EXT-X-KEY')) {
            currentKey = parseKey(line, base);
            continue;
        }
        if (line.startsWith('#EXT-X-BYTERANGE')) {
            const m = /(\d+)(?:@(\d+))?/.exec(line);
            const length = m ? Number(m[1]) : 0;
            const offset = m && m[2] !== undefined ? Number(m[2]) : autoOffset;
            pendingByteRange = { length, offset };
            continue;
        }
        if (line.startsWith('#')) {
            // #EXTM3U / #EXTINF / #EXT-X-MEDIA-SEQUENCE 等：忽略
            continue;
        }
        const url = applyTsUrl(line, base);
        if (pendingByteRange) {
            segments.push({ url: byteRangeBaseUrl || url, byteRange: pendingByteRange, key: currentKey });
            autoOffset = pendingByteRange.offset + pendingByteRange.length;
            byteRangeBaseUrl = url;
            pendingByteRange = null;
        } else {
            byteRangeBaseUrl = url;
            segments.push({ url, key: currentKey });
        }
    }
    return variants.length ? { segments, variants } : { segments };
}

/** 带超时的 fetch */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/** AES-128-CBC 解密（HLS 整段加密） */
async function decryptAes128(data: Uint8Array, keyBytes: Uint8Array, iv: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'AES-CBC' }, false, ['decrypt']);
    const dec = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv as BufferSource }, cryptoKey, data as BufferSource);
    return new Uint8Array(dec);
}

/**
 * 把 M3U8 视频流合并下载为单个文件（助手直写目录模式）。
 * @returns 与 DownloadDriver.submit 一致的结果对象
 */
export async function mergeM3u8(
    disk: DiskFS,
    req: DownloadRequest,
    reporter: ProgressReporter,
    timeoutMs = 60000,
): Promise<{ trackerId?: string; error?: string }> {
    reporter.onState?.('in_progress');
    try {
        // 1) 拉取并解析 M3U8（支持 Master Playlist 多码率选优）
        const m3u8Resp = await fetchWithTimeout(toHttps(req.url), { method: 'GET' }, timeoutMs);
        if (!m3u8Resp.ok) {
            return { error: `M3U8 清单请求失败 HTTP ${m3u8Resp.status}` };
        }
        let parsed = parseM3u8(await m3u8Resp.text(), req.url);
        if (parsed.variants && parsed.variants.length) {
            const best = parsed.variants.sort((a, b) => b.bw - a.bw)[0]!;
            const vResp = await fetchWithTimeout(toHttps(best.uri), { method: 'GET' }, timeoutMs);
            if (!vResp.ok) {
                return { error: `M3U8 变码率清单请求失败 HTTP ${vResp.status}` };
            }
            parsed = parseM3u8(await vResp.text(), best.uri);
        }
        const segments = parsed.segments;
        if (!segments.length) {
            return { error: 'M3U8 解析后无可用分片' };
        }

        // 2) 预拉取解密密钥（相同 URI 只拉一次）
        const keyCache = new Map<string, Uint8Array>();
        const keyUris = new Set<string>();
        for (const seg of segments) {
            if (seg.key && seg.key.method === 'AES-128' && seg.key.uri) {
                keyUris.add(seg.key.uri);
            }
        }
        for (const uri of keyUris) {
            const r = await fetchWithTimeout(toHttps(uri), { method: 'GET' }, timeoutMs);
            keyCache.set(uri, new Uint8Array(await r.arrayBuffer()));
        }

        const folder = req.dir ? req.dir.replace(/\/$/, '') : '';
        const finalPath = (folder ? folder + '/' : '') + req.name;
        const tmpDir = (folder ? folder + '/' : '') + TMP_DIR_PREFIX + '/' + req.id;
        const total = segments.length;
        const pad = (n: number) => String(n).padStart(5, '0');

        // 3) 并发下载分片到临时目录（按临时文件存在性实现分片级断点续传）
        let completed = 0;
        await runPool(segments, async (seg, idx) => {
            const tmpPath = `${tmpDir}/seg_${pad(idx)}.ts`;
            if (await disk.exists(tmpPath)) {
                completed++;
                reporter.onProgress?.(completed, total);
                return;
            }
            const headers: Record<string, string> = {};
            if (seg.byteRange) {
                const end = seg.byteRange.offset + seg.byteRange.length - 1;
                headers['Range'] = `bytes=${seg.byteRange.offset}-${end}`;
            }
            const resp = await fetchWithTimeout(
                toHttps(seg.url),
                { method: 'GET', headers },
                timeoutMs,
            );
            if (!resp.ok || !resp.body) {
                throw new Error(`分片下载失败 HTTP ${resp.status} @ ${seg.url}`);
            }
            let buf = new Uint8Array(await resp.arrayBuffer());
            if (seg.key && seg.key.method === 'AES-128' && seg.key.uri) {
                const kb = keyCache.get(seg.key.uri);
                if (kb) {
                    buf = await decryptAes128(buf, kb, seg.key.iv);
                }
            }
            await disk.writeStream(tmpPath, new Blob([buf as BlobPart]).stream());
            completed++;
            reporter.onProgress?.(completed, total);
        }, { concurrency: SEGMENT_CONCURRENCY });

        // 4) 顺序合并：单一可写流按序写入，全程不驻留整个视频内存
        const clean = finalPath.replace(/^\/+/, '');
        const slash = clean.lastIndexOf('/');
        const dir = slash === -1 ? '' : clean.substring(0, slash);
        const name = slash === -1 ? clean : clean.substring(slash + 1);
        const dirHandle = await disk.getDir(dir);
        const fileHandle = await dirHandle.getFileHandle(name, { create: true });
        const writable = await fileHandle.createWritable();
        try {
            const merged = new ReadableStream<Uint8Array>({
                async start(controller) {
                    for (let i = 0; i < total; i++) {
                        const s = await disk.readStream(`${tmpDir}/seg_${pad(i)}.ts`);
                        const reader = s.getReader();
                        for (;;) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            if (value) controller.enqueue(value);
                        }
                    }
                    controller.close();
                },
            });
            await merged.pipeTo(writable);
        } catch (e) {
            try {
                await writable.abort(e);
            } catch {
                /* ignore */
            }
            throw e;
        }

        // 5) 清理临时分片目录
        try {
            await disk.deleteRecursive(tmpDir);
        } catch {
            /* ignore */
        }

        reporter.onState?.('complete');
        return { trackerId: 'm3u8_' + req.id };
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
}
