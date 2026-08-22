/**
 * DownloadsBackend —— FileWriter 的第三个落盘后端（仅 Firefox，形态 B 全直写）
 *
 * 背景：Firefox 不支持 File System Access API（Disk 后端不可用），且任何扩展上下文都无法注册
 * Service Worker（streamsaver 流式不可用，已探针实锤），downloads.download 是唯一能落盘的通道——
 * 但它只接受 URL。本后端把内存中的文案/查看器数据（文本/字节）经 onConnect('qze-write') 通道
 * 交给 background，background 用自身 blob URL + filename（含子目录）触发 downloads.download
 * 直写下载目录，落盘路径：下载目录/QQ空间备份_<uin>/<path>。内存恒 = 单文件。
 *
 * 并发：与媒体共享 downloadThread 配置（同一配置值、独立小并发池）；浏览器对 downloads.download
 * 会自动排队，扩展侧只需避免一次性提交成千上万个。
 *
 * 为什么走 onConnect 而非 onMessage：background 主 onMessage 监听器是 async 函数（MDN：async 监听器
 * 为每条消息返回 Promise，阻止其他监听器响应），异步 sendResponse 会被吞；onConnect 端口消息不经
 * onMessage 多监听器机制，天然避开（与探针 dlsub 同因同解）。
 */

export interface DownloadsBackendOptions {
    /** 并发提交上限（与 downloadThread 共享同一配置值），默认 4 */
    concurrency?: number;
    /** 每个文件落盘完成后的进度回调（供并入媒体进度面板：写文件 N/M） */
    onProgress?: (done: number, total: number) => void;
}

interface PendingWrite {
    path: string;
    data: Uint8Array | string;
    resolve: () => void;
    reject: (err: Error) => void;
}

export class DownloadsBackend {
    private readonly queue: PendingWrite[] = [];
    private active = 0;
    private doneCount = 0;
    private concurrency: number;
    private readonly onProgress?: (done: number, total: number) => void;
    /** 已成功落盘的路径索引（供 FileWriter.exists 收尾校验，与 ZipCollector.has 语义对齐） */
    private readonly writtenPaths = new Set<string>();

    constructor(options: DownloadsBackendOptions = {}) {
        this.concurrency = Math.max(1, options.concurrency ?? 4);
        this.onProgress = options.onProgress;
    }

    /** 更新并发上限（备份启动时用 downloadThread 配置覆盖默认值） */
    setConcurrency(n: number): void {
        this.concurrency = Math.max(1, Math.floor(n) || 1);
    }

    /** 待写文件数（队列 + 进行中） */
    get pendingCount(): number {
        return this.queue.length + this.active;
    }

    /** 已落盘完成数 */
    get doneCountValue(): number {
        return this.doneCount;
    }

    writeText(text: string, path: string): Promise<void> {
        return this.enqueue({ path, data: text });
    }

    writeBytes(bytes: Uint8Array, path: string): Promise<void> {
        return this.enqueue({ path, data: bytes });
    }

    /** 等待队列全部排空（备份收尾时调用） */
    async flush(): Promise<void> {
        while (this.pendingCount > 0) {
            await new Promise((r) => setTimeout(r, 50));
        }
    }

    private enqueue(item: Omit<PendingWrite, 'resolve' | 'reject'>): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.queue.push({ ...item, resolve, reject });
            this.pump();
        });
    }

    private pump(): void {
        while (this.active < this.concurrency && this.queue.length > 0) {
            const item = this.queue.shift()!;
            this.active++;
            this.submitOne(item).then(
                () => { this.finish(item, null); },
                (err) => { this.finish(item, err instanceof Error ? err : new Error(String(err))); }
            );
        }
    }

    private finish(item: PendingWrite, err: Error | null): void {
        this.active--;
        this.doneCount++;
        if (err) item.reject(err);
        else {
            this.writtenPaths.add(item.path);
            item.resolve();
        }
        try {
            this.onProgress?.(this.doneCount, this.doneCount + this.pendingCount);
        } catch { /* 进度回调失败不影响写盘 */ }
        this.pump();
    }

    /** 该路径是否已成功落盘（供 FileWriter.exists 收尾校验） */
    hasWritten(path: string): boolean {
        return this.writtenPaths.has(path);
    }

    private submitOne(item: PendingWrite): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let port: chrome.runtime.Port;
            let settled = false;
            try {
                port = chrome.runtime.connect({ name: 'qze-write' });
            } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
                return;
            }
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    try { port.disconnect(); } catch { /* ignore */ }
                    reject(new Error('写文件超时: ' + item.path));
                }
            }, 30000);
            port.onMessage.addListener((resp: any) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try { port.disconnect(); } catch { /* ignore */ }
                if (resp && resp.ok) resolve();
                else reject(new Error((resp && resp.error) || '写文件失败: ' + item.path));
            });
            port.onDisconnect.addListener(() => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    reject(new Error('写文件端口断开: ' + item.path));
                }
            });
            const payload: Record<string, unknown> = {
                cmd: 'write_file',
                path: item.path,
            };
            if (typeof item.data === 'string') {
                payload.data = item.data;
            } else {
                // 传精确范围的 ArrayBuffer（底层 buffer 可能更大）；结构化克隆跨上下文后仍为 ArrayBuffer
                const u = item.data;
                payload.data = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
            }
            try {
                port.postMessage(payload);
            } catch (e) {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    try { port.disconnect(); } catch { /* ignore */ }
                    reject(e instanceof Error ? e : new Error(String(e)));
                }
            }
        });
    }
}
