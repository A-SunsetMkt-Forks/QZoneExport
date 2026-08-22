/**
 * 统一文件写入层（替代旧 api.js writeText / createFolder / switchToRoot
 * 与 common.js writeJsonToJs）
 *
 * 双后端（ZipCollector 内存归档已于 2026-08-22 下线：Chrome 恒直写目录、
 * Firefox 形态 B 恒 downloads 直写，打包 ZIP 功能全面失效，见 firefox-mv3 分支记录）：
 *  - DiskFS 模式：用户已选目录，直接写盘（File System Access API，Chrome/Edge）
 *  - Downloads 模式：Firefox 形态 B——经 background downloads.download 直写下载目录
 *    （下载目录/QQ空间备份_<uin>/），内存=单文件
 *  - 两者皆不可用（diskEnabled=false 且未装配 DownloadsBackend）→ 显式抛错。
 *    替代旧「静默收集进内存 ZIP」兜底（该兜底在 waitForDirectory 阻塞下永不触发，
 *    且静默收集反而可能在收尾时丢数据，显式报错更安全）
 */

import { DiskFS } from './disk-fs';
import type { ChunkSink } from './disk-fs';
import { DownloadsBackend } from './downloads-writer';

export class FileWriter {
    private readonly disk: DiskFS;
    /**
     * Downloads 后端（仅 Firefox 形态 B：无 FS Access + 无 SW 流式，文案/查看器
     * 经 downloads.download 直写下载目录），内存=单文件。
     */
    private readonly downloads?: DownloadsBackend;
    /** 当前根目录名称（如 QQ空间备份_<uin>，用于下载目录顶层路径包裹） */
    private rootFolderName = '';

    constructor(disk: DiskFS, rootFolderName = '', downloads?: DownloadsBackend) {
        this.disk = disk;
        this.rootFolderName = rootFolderName;
        this.downloads = downloads;
    }

    /** 是否走直写盘（已选目录） */
    get diskEnabled(): boolean {
        return this.disk.isEnabled();
    }

    /** 是否走 downloads 直写（Firefox：未选盘但有 DownloadsBackend） */
    get downloadsEnabled(): boolean {
        return !this.diskEnabled && !!this.downloads;
    }

    /** 是否有可用的落盘后端（无 → 所有写操作抛错，防静默丢数据） */
    get writable(): boolean {
        return this.diskEnabled || !!this.downloads;
    }

    setRootFolderName(name: string): void {
        this.rootFolderName = name;
    }

    getRootFolderName(): string {
        return this.rootFolderName;
    }

    /** 拼接根目录前缀（与旧版产物结构一致：<root>/<path>） */
    private fullPath(path: string): string {
        const clean = (path || '').replace(/^\/+/, '');
        if (!this.rootFolderName) {
            return clean;
        }
        return this.rootFolderName + '/' + clean;
    }

    /** 无可用后端时显式报错（替代旧「静默收集进内存 ZIP」的兜底） */
    private assertWritable(): void {
        if (!this.writable) {
            throw new Error('未选择备份保存目录，备份无法写入（请先选择保存目录后再开始备份）');
        }
    }

    /** 确保目录存在（DiskFS 模式：逐级创建；downloads 模式：无需操作，下载自动建目录） */
    async createFolder(path: string): Promise<void> {
        if (!this.diskEnabled) {
            return;
        }
        const clean = this.fullPath(path).replace(/\/+$/, '');
        if (!clean) {
            return;
        }
        await this.disk.getDir(clean);
    }

    /** 写文本文件 */
    async writeText(text: string, path: string): Promise<void> {
        const full = this.fullPath(path);
        if (this.diskEnabled) {
            await this.disk.write(full, text);
            return;
        }
        if (this.downloads) {
            await this.downloads.writeText(text, full);
            return;
        }
        this.assertWritable();
    }

    /** 写二进制数据 */
    async writeFile(data: Uint8Array | Blob, path: string): Promise<void> {
        const full = this.fullPath(path);
        if (this.diskEnabled) {
            await this.disk.write(full, data);
            return;
        }
        if (this.downloads) {
            const bytes = data instanceof Blob
                ? new Uint8Array(await data.arrayBuffer())
                : data;
            await this.downloads.writeBytes(bytes, full);
            return;
        }
        this.assertWritable();
    }

    /** 文件是否已写入且非空（两种后端语义一致）
     * 供备份收尾校验产物是否真的落地，路径用相对备份根的形式传入
     */
    async exists(path: string): Promise<boolean> {
        const full = this.fullPath(path);
        if (this.diskEnabled) {
            return this.disk.exists(full);
        }
        if (this.downloads) {
            return this.downloads.hasWritten(full);
        }
        return false;
    }

    /** 写数据文件：window.<global> = <data> */
    async writeJsonToJs(global: string, data: unknown, path: string): Promise<void> {
        const serialized = `window.${global} = ${JSON.stringify(data, null, 0)};`;
        await this.writeText(serialized, path);
    }

    /** 写纯 JSON 文件（不包裹 window.x=，便于二次处理/跨平台解析）。pretty=true 时格式化缩进。 */
    async writeJson(data: unknown, path: string, pretty = true): Promise<void> {
        await this.writeText(JSON.stringify(data, null, pretty ? 2 : 0), path);
    }

    /** 暴露底层 DiskFS（M3U8 合并器需要底层流式写/读/删能力） */
    getDiskFS(): DiskFS | null {
        return this.diskEnabled ? this.disk : null;
    }

    /**
     * 流式写文件（大文件不驻留内存）；downloads 模式退化为内存收集后整包写入（文案单文件小，内存可控）
     */
    async writeStreamFile(path: string, stream: ReadableStream<Uint8Array>): Promise<void> {
        const full = this.fullPath(path);
        if (this.diskEnabled) {
            await this.disk.writeStream(full, stream);
            return;
        }
        const buf = await new Response(stream as unknown as BodyInit).arrayBuffer();
        if (this.downloads) {
            await this.downloads.writeBytes(new Uint8Array(buf), full);
            return;
        }
        this.assertWritable();
    }

    /**
     * 开启逐块写入槽（background 代理分块下载用：每收一块即 append 落盘，不重建流 /
     * 不一次性 base64 整文件，内存恒定、大文件无上限）。
     * Disk 模式委托 DiskFS.chunkSink；downloads 模式先内存累积、close 时整包写入。
     */
    async openChunkSink(path: string): Promise<ChunkSink> {
        const full = this.fullPath(path);
        if (this.diskEnabled) {
            return this.disk.chunkSink(full);
        }
        const chunks: Uint8Array[] = [];
        let size = 0;
        return {
            write: async (chunk: Uint8Array | ArrayBuffer) => {
                const u = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk;
                chunks.push(u);
                size += u.length;
            },
            close: async () => {
                const merged = new Uint8Array(size);
                let off = 0;
                for (const c of chunks) {
                    merged.set(c, off);
                    off += c.length;
                }
                if (this.downloads) {
                    await this.downloads.writeBytes(merged, full);
                    return;
                }
                this.assertWritable();
            },
        };
    }
}
