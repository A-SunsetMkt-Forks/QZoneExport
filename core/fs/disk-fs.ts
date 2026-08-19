/**
 * 文件系统直写盘（File System Access API）
 * 替代旧 api.js API.Utils.DiskFS，行为与旧实现一致：
 *  - 用户手势上下文内 selectRoot 弹出目录选择并校验读写权限
 *  - getDir 逐级解析/创建目录并缓存句柄，避免重复遍历
 *  - write / writeStream / exists 覆盖写、流写、存在性判断
 */

/** 归一化路径：去除首尾多余的斜杠 */
function normalizeDirPath(dirPath: string): string {
    return (dirPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** 拆分文件路径为目录与文件名 */
function splitPath(filepath: string): { dir: string; name: string } {
    const path = (filepath || '').replace(/^\/+/, '');
    const index = path.lastIndexOf('/');
    if (index === -1) {
        return { dir: '', name: path };
    }
    return { dir: path.substring(0, index), name: path.substring(index + 1) };
}

/** 逐块写入句柄：大文件流式落盘、不驻留内存（background 代理分块下载用） */
export interface ChunkSink {
    /** 追加一块字节（Uint8Array 或 ArrayBuffer）；调用方需保证块顺序 */
    write(chunk: Uint8Array | ArrayBuffer): Promise<void>;
    /** 写完关闭并落盘 */
    close(): Promise<void>;
}

export class DiskFS {
    private root: FileSystemDirectoryHandle | null = null;
    private readonly dirCache = new Map<string, FileSystemDirectoryHandle>();

    /** 当前环境是否支持目录选择（MV3 File System Access API） */
    static isSupported(): boolean {
        return typeof (globalThis as any).showDirectoryPicker === 'function';
    }

    /** 是否已选定目录（即当前走直写盘模式） */
    isEnabled(): boolean {
        return !!this.root;
    }

    /** 当前根目录句柄（可能为 null） */
    getRoot(): FileSystemDirectoryHandle | null {
        return this.root;
    }

    /**
     * 选择备份根目录（必须在用户手势上下文调用；用户取消抛 AbortError）
     */
    async selectRoot(): Promise<FileSystemDirectoryHandle> {
        const picker = (globalThis as any).showDirectoryPicker as
            | ((opts?: any) => Promise<FileSystemDirectoryHandle>)
            | undefined;
        if (!picker) {
            throw new Error('当前浏览器不支持目录选择（需支持 File System Access API）');
        }
        const handle = await picker({ mode: 'readwrite', startIn: 'downloads' });
        // 校验读写权限，未授权时主动申请（仍处于用户手势上下文）
        const query = (handle as any).queryPermission;
        if (typeof query === 'function') {
            let permission = await query.call(handle, { mode: 'readwrite' });
            const request = (handle as any).requestPermission;
            if (permission !== 'granted' && typeof request === 'function') {
                permission = await request.call(handle, { mode: 'readwrite' });
            }
            if (permission !== 'granted') {
                throw new Error('未获得所选目录的读写权限');
            }
        }
        this.root = handle;
        this.dirCache.clear();
        this.dirCache.set('', handle);
        return handle;
    }

    /** 重置（切回打包模式或重新备份时） */
    reset(): void {
        this.root = null;
        this.dirCache.clear();
    }

    /**
     * 获取目录句柄，按需逐级创建
     * @param dirPath 以/分隔的目录路径，空字符串表示根目录
     */
    async getDir(dirPath: string): Promise<FileSystemDirectoryHandle> {
        const path = normalizeDirPath(dirPath);
        const cached = this.dirCache.get(path);
        if (cached) {
            return cached;
        }
        if (!this.root) {
            throw new Error('尚未选择备份目录');
        }
        let handle: FileSystemDirectoryHandle = this.root;
        let walked = '';
        for (const segment of path.split('/')) {
            if (!segment || segment === '.') {
                continue;
            }
            walked = walked ? walked + '/' + segment : segment;
            const cachedSegment = this.dirCache.get(walked);
            if (cachedSegment) {
                handle = cachedSegment;
                continue;
            }
            handle = await handle.getDirectoryHandle(segment, { create: true });
            this.dirCache.set(walked, handle);
        }
        return handle;
    }

    /**
     * 写入文件内容（覆盖写）；失败时 abort 清理，避免残留 0 字节文件
     */
    async write(filepath: string, data: string | Blob | ArrayBuffer | Uint8Array): Promise<FileSystemFileHandle> {
        const parts = splitPath(filepath);
        const dirHandle = await this.getDir(parts.dir);
        const fileHandle = await dirHandle.getFileHandle(parts.name, { create: true });
        const writable = await fileHandle.createWritable();
        try {
            await writable.write(data as any);
        } catch (error) {
            try {
                await writable.abort(error);
            } catch {
                /* 中止清理失败可忽略 */
            }
            throw error;
        }
        await writable.close();
        return fileHandle;
    }

    /** 把可读流直接写入文件（大文件不驻留内存） */
    async writeStream(filepath: string, stream: ReadableStream<Uint8Array>): Promise<FileSystemFileHandle> {
        const parts = splitPath(filepath);
        const dirHandle = await this.getDir(parts.dir);
        const fileHandle = await dirHandle.getFileHandle(parts.name, { create: true });
        const writable = await fileHandle.createWritable();
        await stream.pipeTo(writable);
        return fileHandle;
    }

    /**
     * 开启逐块写入槽（大文件流式落盘，不驻留内存）。
     * 一次 createWritable、多次 write、最后 close——区别于 writeStream（接受已就绪的 ReadableStream）。
     * 用于 background 代理分块回传场景：content 每收到一块即 append 落盘，无需重建流/一次性 base64。
     */
    async chunkSink(filepath: string): Promise<ChunkSink> {
        const parts = splitPath(filepath);
        const dirHandle = await this.getDir(parts.dir);
        const fileHandle = await dirHandle.getFileHandle(parts.name, { create: true });
        const writable = await fileHandle.createWritable();
        return {
            write: async (chunk: Uint8Array | ArrayBuffer) => {
                await writable.write(chunk as any);
            },
            close: async () => {
                await writable.close();
            },
        };
    }

    /** 文件是否已存在且非空（断点续传跳过已完成文件用） */
    async exists(filepath: string): Promise<boolean> {
        const parts = splitPath(filepath);
        try {
            const dirHandle = await this.getDir(parts.dir);
            const fileHandle = await dirHandle.getFileHandle(parts.name, { create: false });
            const file = await fileHandle.getFile();
            return file.size > 0;
        } catch {
            return false;
        }
    }

    /** 读取文件内容流（合并阶段按序读取临时分片用） */
    async readStream(filepath: string): Promise<ReadableStream<Uint8Array>> {
        const parts = splitPath(filepath);
        const dirHandle = await this.getDir(parts.dir);
        const fileHandle = await dirHandle.getFileHandle(parts.name, { create: false });
        const file = await fileHandle.getFile();
        return file.stream() as unknown as ReadableStream<Uint8Array>;
    }

    /** 查询文件大小（字节） */
    async sizeOf(filepath: string): Promise<number> {
        const parts = splitPath(filepath);
        try {
            const dirHandle = await this.getDir(parts.dir);
            const fileHandle = await dirHandle.getFileHandle(parts.name, { create: false });
            const file = await fileHandle.getFile();
            return file.size;
        } catch {
            return 0;
        }
    }

    /** 递归删除文件或目录（清理 M3U8 临时分片目录用） */
    async deleteRecursive(filepath: string): Promise<void> {
        const parts = splitPath(filepath);
        const dirHandle = await this.getDir(parts.dir);
        await dirHandle.removeEntry(parts.name, { recursive: true });
    }
}
