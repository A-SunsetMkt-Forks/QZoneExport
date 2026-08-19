/**
 * ZIP 打包（替代旧 api.js isStreamZipSupported / streamZipToDisk / Zip）
 *
 * v3 已具备真正的流式 ZIP（core/archive/zip-writer.ts，基于 @zip.js/zip.js，支持 Zip64）。
 * 本文件提供与旧 API 兼容的封装：
 *   - isStreamZipSupported：当前环境是否支持「选目录 + 直写盘」打包
 *   - streamZipToDisk：把 ZipCollector 收集的内存归档写入磁盘 ZIP 文件
 *   - inMemoryZip：返回 Blob（非直写盘模式下的产物）
 */

import { StreamingZipWriter, type ZipSink } from './zip-writer';
import { ZipCollector } from '../fs/writer';
import { DiskFS } from '../fs/disk-fs';

/** 是否支持「选目录 + 直写盘」打包（失败回退内存 Blob） */
export function isStreamZipSupported(): boolean {
    return typeof (globalThis as any).showDirectoryPicker === 'function';
}

class DiskSink implements ZipSink {
    private writable: FileSystemWritableFileStream;
    constructor(writable: FileSystemWritableFileStream) {
        this.writable = writable;
    }
    async write(chunk: Uint8Array): Promise<void> {
        await this.writable.write(new Blob([chunk as BlobPart]));
    }
    async close(): Promise<void> {
        await this.writable.close();
    }
}

class MemorySink implements ZipSink {
    private chunks: Uint8Array[] = [];
    private total = 0;
    async write(chunk: Uint8Array): Promise<void> {
        this.chunks.push(chunk);
        this.total += chunk.length;
    }
    async close(): Promise<void> {
        /* no-op */
    }
    toBlob(): Blob {
        return new Blob(this.chunks as BlobPart[], { type: 'application/zip' });
    }
}

/** 支持进度回调的直写盘打包：把 collector 内容压成 ZIP 写到 root 目录下的 filename */
export async function streamZipToDisk(
    collector: ZipCollector,
    filename: string,
    onProgress?: (done: number, total: number) => void,
): Promise<void> {
    const root = (globalThis as any).__QZ_DISK_FS__ as DiskFS | undefined;
    if (!root || !root.isEnabled()) {
        throw new Error('未选择备份目录，无法直写盘打包');
    }
    const fileHandle = await root.write(filename, new Blob([]));
    const writable = await (fileHandle as any).createWritable();
    const sink = new DiskSink(writable as FileSystemWritableFileStream);
    const zip = new StreamingZipWriter(sink, 6);
    const entries = collector.getEntries();
    const total = entries.length;
    let done = 0;
    for (const entry of entries) {
        const bytes = typeof entry.data === 'string' ? new TextEncoder().encode(entry.data) : entry.data;
        await zip.addFile(entry.path, bytes);
        done++;
        onProgress?.(done, total);
    }
    await zip.close();
}

/** 内存打包：返回 ZIP Blob（非直写盘模式） */
export async function inMemoryZip(collector: ZipCollector): Promise<Blob> {
    const sink = new MemorySink();
    const zip = new StreamingZipWriter(sink, 6);
    for (const entry of collector.getEntries()) {
        const bytes = typeof entry.data === 'string' ? new TextEncoder().encode(entry.data) : entry.data;
        await zip.addFile(entry.path, bytes);
    }
    await zip.close();
    return (sink as MemorySink).toBlob();
}
