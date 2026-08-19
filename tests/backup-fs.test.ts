import { describe, it, expect } from 'vitest';
import { createDirectoryHandleFs } from '../core/export/backup-fs';
import { compareBackups } from '../core/export/merge-backup';

/**
 * 模拟 File System Access API 的目录句柄：目录/文件缺失且 create=false 时抛 NotFoundError，
 * 复现真实浏览器行为——此前的 bug 正是缺失模块目录时该 NotFoundError 一路冒泡、
 * 在 Options 工具页被包成「比较失败：A requested file or directory could not be found...」。
 */
function notFoundError(): Error {
    const e = new Error(
        'A requested file or directory could not be found at the time an operation was processed.',
    ) as DOMException;
    (e as any).name = 'NotFoundError';
    return e;
}

interface FsNode {
    dir?: MockDirHandle;
    file?: { text: string; bytes?: Uint8Array };
}

class MockFileHandle {
    constructor(
        private data: { text: string; bytes?: Uint8Array },
        public name: string,
    ) {}
    async getFile(): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }> {
        const text = this.data.text;
        const bytes = this.data.bytes ?? new TextEncoder().encode(text);
        return {
            text: async () => text,
            arrayBuffer: async () =>
                bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        };
    }
    async createWritable(): Promise<{ write(c: string | Uint8Array): void; close(): Promise<void> }> {
        return {
            write: (c) => {
                if (typeof c === 'string') this.data.text = c;
                else this.data.bytes = c;
            },
            close: async () => {},
        };
    }
}

class MockDirHandle {
    tree: Map<string, FsNode> = new Map();
    constructor(public name = 'root') {}
    async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MockDirHandle> {
        const node = this.tree.get(name);
        if (node?.dir) return node.dir;
        if (!node && opts?.create) {
            const dir = new MockDirHandle(name);
            this.tree.set(name, { dir });
            return dir;
        }
        throw notFoundError();
    }
    async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MockFileHandle> {
        const node = this.tree.get(name);
        if (node?.file) return new MockFileHandle(node.file, name);
        if (!node && opts?.create) {
            const f = { text: '' };
            this.tree.set(name, { file: f });
            return new MockFileHandle(f, name);
        }
        throw notFoundError();
    }
    async *entries(): AsyncIterableIterator<[string, MockDirHandle | MockFileHandle]> {
        for (const [name, node] of this.tree) {
            if (node.dir) yield [name, node.dir];
            else if (node.file) yield [name, new MockFileHandle(node.file, name)];
        }
    }
}

/** 构造只含指定模块 json 的备份根目录（其余模块目录不存在） */
function makeRoot(modules: Record<string, unknown>, media: Record<string, Uint8Array> = {}): MockDirHandle {
    const root = new MockDirHandle('backup');
    const ensureDir = (segs: string[]): MockDirHandle => {
        let dir = root;
        for (const seg of segs) {
            const node = dir.tree.get(seg);
            if (node?.dir) {
                dir = node.dir;
            } else {
                const nd = new MockDirHandle(seg);
                dir.tree.set(seg, { dir: nd });
                dir = nd;
            }
        }
        return dir;
    };
    for (const [rel, data] of Object.entries(modules)) {
        const parts = rel.split('/');
        const fileName = parts.pop()!;
        const dir = ensureDir(parts);
        dir.tree.set(fileName, { file: { text: JSON.stringify(data) } });
    }
    for (const [rel, bytes] of Object.entries(media)) {
        const parts = rel.split('/');
        const fileName = parts.pop()!;
        const dir = ensureDir(parts);
        dir.tree.set(fileName, { file: { text: '', bytes } });
    }
    return root;
}

const encoder = new TextEncoder();

describe('DirectoryHandleFs 缺失目录/文件不抛错（修复比较失败）', () => {
    it('readJson 在模块目录不存在时返回 null 而非抛 NotFoundError', async () => {
        // 只含 Messages，没有 Albums/Boards/... 等目录
        const root = makeRoot({ 'Messages/json/messages.json': [{ tid: 'A' }] });
        const fs = createDirectoryHandleFs(root as any);

        // 不存在的模块目录
        expect(await fs.readJson('Albums/json/albums.json')).toBeNull();
        // 存在的模块
        expect(await fs.readJson('Messages/json/messages.json')).toEqual([{ tid: 'A' }]);
    });

    it('exists / readBinary 在路径不存在时返回 false / null 而非抛错', async () => {
        const root = makeRoot(
            { 'Messages/json/messages.json': [{ tid: 'A' }] },
            { 'Messages/images/a.png': encoder.encode('PNG') },
        );
        const fs = createDirectoryHandleFs(root as any);

        expect(await fs.exists('Boards/json/boards.json')).toBe(false);
        expect(await fs.exists('Messages/images/a.png')).toBe(true);
        expect(await fs.readBinary('Boards/images/missing.jpg')).toBeNull();
        expect(await fs.readBinary('Messages/images/a.png')).not.toBeNull();
    });

    it('compareBackups 在备份缺模块目录时仍完整跑完（不冒泡 NotFoundError）', async () => {
        // 两个备份都只含说说（其余 9 个模块目录缺失）
        const oldRoot = makeRoot({ 'Messages/json/messages.json': [{ tid: 'A' }, { tid: 'B' }] });
        const newRoot = makeRoot({ 'Messages/json/messages.json': [{ tid: 'A' }] });
        const oldFs = createDirectoryHandleFs(oldRoot as any);
        const newFs = createDirectoryHandleFs(newRoot as any);

        // 此前此处会因缺失目录抛 NotFoundError → 「比较失败」
        const diffs = await compareBackups(oldFs, newFs);
        expect(diffs.length).toBe(10);
        const messages = diffs.find((d) => d.module === 'Messages')!;
        expect(messages.existsOld).toBe(true);
        expect(messages.existsNew).toBe(true);
        // 缺失目录的模块不应使 existsOld/existsNew 抛错
        const photos = diffs.find((d) => d.module === 'Photos')!;
        expect(photos.existsOld).toBe(false);
        expect(photos.existsNew).toBe(false);
    });

    it('readJson 在 .json 缺失时回退读同目录 .js（兼容 V2 只导 .js 的备份）', async () => {
        // 旧版备份只有 Messages/json/messages.js（window.Messages = [...]，无 .json 汇总）
        const root = new MockDirHandle('backup');
        const messagesDir = new MockDirHandle('Messages');
        const jsonDir = new MockDirHandle('json');
        jsonDir.tree.set('messages.js', { file: { text: 'window.Messages = [{"tid":"A","content":"a"}];' } });
        messagesDir.tree.set('json', { dir: jsonDir });
        root.tree.set('Messages', { dir: messagesDir });

        const fs = createDirectoryHandleFs(root as any);
        // merge 引擎请求的是 .json，应回退解析 .js
        const data = await fs.readJson('Messages/json/messages.json');
        expect(data).toEqual([{ tid: 'A', content: 'a' }]);
    });

    it('readJson 回退解析 minified 的方括号形式 .js（window["Messages"]=[...]）', async () => {
        // 部分 JS 压缩器把点访问改写成方括号访问：window.Messages → window["Messages"]。
        // 旧版前缀正则只认 window.Messages=，遇方括号形式会解析失败 → 「无法解析数据文件内容」。
        const root = new MockDirHandle('backup');
        const messagesDir = new MockDirHandle('Messages');
        const jsonDir = new MockDirHandle('json');
        jsonDir.tree.set('messages.js', { file: { text: 'window["Messages"]=[{"tid":"A","content":"a"}];' } });
        messagesDir.tree.set('json', { dir: jsonDir });
        root.tree.set('Messages', { dir: messagesDir });

        const fs = createDirectoryHandleFs(root as any);
        const data = await fs.readJson('Messages/json/messages.json');
        expect(data).toEqual([{ tid: 'A', content: 'a' }]);
    });

    it('readJson 回退解析无空格压缩的 .js（window.Messages=[...]）', async () => {
        // 简单 jsmin 把 window.Messages = [...] 压成 window.Messages=[...]（= 前后无空格）
        const root = new MockDirHandle('backup');
        const messagesDir = new MockDirHandle('Messages');
        const jsonDir = new MockDirHandle('json');
        jsonDir.tree.set('messages.js', { file: { text: 'window.Messages=[{"tid":"A"}];' } });
        messagesDir.tree.set('json', { dir: jsonDir });
        root.tree.set('Messages', { dir: messagesDir });

        const fs = createDirectoryHandleFs(root as any);
        const data = await fs.readJson('Messages/json/messages.json');
        expect(data).toEqual([{ tid: 'A' }]);
    });

    it('readJson 回退解析尾部带非 JSON 残留的 .js（window.messages=[...];backedup）', async () => {
        // 真实备份样本：文件以 `];backedup` 结尾——数据字面量 ]; 之后还跟着字面量标记文本。
        // 旧逻辑把 [ 到文件末尾整体当 JSON.parse → 因尾部 backedup 失败 → 「无法解析数据文件内容」。
        const root = new MockDirHandle('backup');
        const messagesDir = new MockDirHandle('Messages');
        const jsonDir = new MockDirHandle('json');
        jsonDir.tree.set('messages.js', {
            file: { text: 'window.messages=[{"tid":"A"},{"tid":"B"}];backedup' },
        });
        messagesDir.tree.set('json', { dir: jsonDir });
        root.tree.set('Messages', { dir: messagesDir });

        const fs = createDirectoryHandleFs(root as any);
        const data = await fs.readJson('Messages/json/messages.json');
        expect(data).toEqual([{ tid: 'A' }, { tid: 'B' }]);
    });
});
