import { describe, expect, it } from 'vitest';
import { BlobReader, TextWriter, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import { memorySink, StreamingZipWriter } from '../core/archive/zip-writer';

const encoder = new TextEncoder();

/** 解包校验工具 */
async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
    const reader = new ZipReader(new BlobReader(new Blob([bytes as BlobPart])));
    const entries = await reader.getEntries();
    const result = new Map<string, Uint8Array>();
    for (const entry of entries) {
        if (entry.directory) {
            continue;
        }
        result.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
    }
    await reader.close();
    return result;
}

describe('StreamingZipWriter 流式打包（zip.js）', () => {
    it('多文件roundtrip（含中文路径与子目录）', async () => {
        const sink = memorySink();
        const writer = new StreamingZipWriter(sink);
        await writer.addFile('index.html', encoder.encode('<html>首页</html>'));
        await writer.addFile('说说/json/messages.js', encoder.encode('window.messages=[1,2,3]'));
        await writer.addFile('Albums/相册A/图片说明.txt', encoder.encode('desc'));
        await writer.close();

        const unzipped = await unzip(sink.bytes());
        expect([...unzipped.keys()].sort()).toEqual(['Albums/相册A/图片说明.txt', 'index.html', '说说/json/messages.js']);
        expect(new TextDecoder().decode(unzipped.get('index.html'))).toBe('<html>首页</html>');
        expect(new TextDecoder().decode(unzipped.get('说说/json/messages.js'))).toBe('window.messages=[1,2,3]');
    });

    it('大量小文件顺序写入且close幂等', async () => {
        const sink = memorySink();
        const writer = new StreamingZipWriter(sink, 1);
        for (let i = 0; i < 200; i++) {
            await writer.addFile(`dir/${i}.txt`, encoder.encode('content-' + i));
        }
        await writer.close();
        await writer.close();

        const unzipped = await unzip(sink.bytes());
        expect(unzipped.size).toBe(200);
        expect(new TextDecoder().decode(unzipped.get('dir/199.txt'))).toBe('content-199');
    });

    it('二进制内容无损', async () => {
        const sink = memorySink();
        const writer = new StreamingZipWriter(sink);
        const binary = new Uint8Array(4096);
        for (let i = 0; i < binary.length; i++) {
            binary[i] = i % 256;
        }
        await writer.addFile('bin.dat', binary);
        await writer.close();
        expect((await unzip(sink.bytes())).get('bin.dat')).toEqual(binary);
    });

    it('Zip64路径可读（zip.js超限自动启用，读取端可正常解包）', async () => {
        // 单测中不构造真实4GB数据，验证zip.js读写链路对多条目归档的正确性
        const sink = memorySink();
        const writer = new StreamingZipWriter(sink, 0);
        for (let i = 0; i < 1000; i++) {
            await writer.addFile(`f/${i}`, encoder.encode(String(i)));
        }
        await writer.close();
        const reader = new ZipReader(new BlobReader(new Blob([sink.bytes() as BlobPart])));
        const entries = await reader.getEntries();
        expect(entries.length).toBe(1000);
        const last = entries[999]!;
        expect(last.directory).toBe(false);
        expect(!last.directory && (await last.getData(new TextWriter()))).toBe('999');
        await reader.close();
    });
});
