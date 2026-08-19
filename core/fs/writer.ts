/**
 * 统一文件写入层（替代旧 api.js writeText / createFolder / switchToRoot
 * 与 common.js writeJsonToJs）
 *
 * 双后端：
 *  - DiskFS 模式：用户已选目录，直接写盘（File System Access API）
 *  - ZIP 模式：未选目录，收集进内存归档（最终由 zip-fallback / zip-writer 打包）
 *
 * 旧版用 QZone.Common.Filer 作为 ZIP 模式的临时文件系统兜底；这里改为内存收集，
 * 与 core/archive 的流式 ZIP 衔接，避免引入旧 polyfill。
 */

import { DiskFS } from './disk-fs';
import type { ChunkSink } from './disk-fs';
import type { StreamingZipWriter } from '../archive/zip-writer';

export interface ZipEntry {
    path: string;
    data: Uint8Array | string;
}

/** 内存归档收集器（ZIP 模式使用） */
export class ZipCollector {
    private readonly entries: ZipEntry[] = [];
    /**
     * 已收集且内容非空的路径索引。
     * 仅为 has() 提供 O(1) 判定——条目数可达数万（媒体文件），线性扫描不可接受。
     */
    private readonly nonEmptyPaths = new Set<string>();

    add(path: string, data: Uint8Array | string): void {
        this.entries.push({ path, data });
        const empty = typeof data === 'string' ? data.length === 0 : data.byteLength === 0;
        if (!empty) {
            this.nonEmptyPaths.add(path);
        }
    }

    /** 是否已收集该路径且内容非空（与 DiskFS.exists 语义对齐） */
    has(path: string): boolean {
        return this.nonEmptyPaths.has(path);
    }

    getEntries(): readonly ZipEntry[] {
        return this.entries;
    }

    get size(): number {
        return this.entries.length;
    }

    clear(): void {
        this.entries.length = 0;
        this.nonEmptyPaths.clear();
    }

    /** 把所有收集到的条目写入流式 ZIP writer */
    async flushTo(zip: StreamingZipWriter): Promise<void> {
        for (const entry of this.entries) {
            const bytes =
                typeof entry.data === 'string'
                    ? new TextEncoder().encode(entry.data)
                    : entry.data;
            await zip.addFile(entry.path, bytes);
        }
    }
}

export class FileWriter {
    private readonly disk: DiskFS;
    private readonly zip: ZipCollector;
    /** 当前根目录名称（用于 ZIP 模式下的顶层目录前缀） */
    private rootFolderName = '';

    constructor(disk: DiskFS, zip: ZipCollector, rootFolderName = '') {
        this.disk = disk;
        this.zip = zip;
        this.rootFolderName = rootFolderName;
    }

    /** 是否走直写盘（已选目录） */
    get diskEnabled(): boolean {
        return this.disk.isEnabled();
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

    /** 确保目录存在（DiskFS 模式：逐级创建；ZIP 模式：无需操作） */
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
        this.zip.add(full, text);
    }

    /** 写二进制数据 */
    async writeFile(data: Uint8Array | Blob, path: string): Promise<void> {
        const full = this.fullPath(path);
        if (this.diskEnabled) {
            await this.disk.write(full, data);
            return;
        }
        if (data instanceof Blob) {
            const buf = await data.arrayBuffer();
            this.zip.add(full, new Uint8Array(buf));
        } else {
            this.zip.add(full, data);
        }
    }

    /** 文件是否已写入且非空（两种后端语义一致）
     * 供备份收尾校验产物是否真的落地，路径用相对备份根的形式传入
     */
    async exists(path: string): Promise<boolean> {
        const full = this.fullPath(path);
        if (this.diskEnabled) {
            return this.disk.exists(full);
        }
        return this.zip.has(full);
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
     * 流式写文件（大文件不驻留内存）；ZIP 模式退化为内存收集（与原行为一致）
     */
    async writeStreamFile(path: string, stream: ReadableStream<Uint8Array>): Promise<void> {
        const full = this.fullPath(path);
        if (this.diskEnabled) {
            await this.disk.writeStream(full, stream);
            return;
        }
        const buf = await new Response(stream as unknown as BodyInit).arrayBuffer();
        this.zip.add(full, new Uint8Array(buf));
    }

    /**
     * 开启逐块写入槽（background 代理分块下载用：每收一块即 append 落盘，不重建流 /
     * 不一次性 base64 整文件，内存恒定、大文件无上限）。
     * Disk 模式委托 DiskFS.chunkSink；ZIP 模式先内存累积、close 时合并 add（与 writeStreamFile 退化一致）。
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
                this.zip.add(full, merged);
            },
        };
    }
}
