import { configure, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';

/**
 * 流式ZIP写入器（P4）
 * 基于zip.js边压边写，替代jszip generateAsync的全量内存驻留（content.js L1186）
 * 选型说明：zip.js完整支持Zip64（归档/单文件>4GB、条目数>65535均无上限），
 * fflate的Zip64不完整（单文件≤4GB、>65535条目产出损坏包），故弃用
 */

// 内容脚本环境创建Worker受宿主页CSP管辖，统一关闭Web Workers走单线程流式
// （压缩优先使用浏览器原生CompressionStream，zip.js自动探测）
configure({ useWebWorkers: false });

/** 输出目标抽象（FileSystemWritableFileStream 或测试用内存收集器） */
export interface ZipSink {
    write(chunk: Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort?(reason?: unknown): Promise<void>;
}

/** 压缩级别（zip.js取值0-9） */
export type ZipLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export class StreamingZipWriter {
    private zipWriter: ZipWriter<void>;
    private ended = false;

    constructor(
        private readonly sink: ZipSink,
        level: ZipLevel = 6,
    ) {
        const writable = new WritableStream<Uint8Array>({
            write: (chunk) => this.sink.write(chunk),
            close: () => this.sink.close(),
            abort: (reason) => (this.sink.abort ? this.sink.abort(reason) : Promise.resolve()),
        });
        // zip64自动启用（超限时写入Zip64结构），无需显式指定
        this.zipWriter = new ZipWriter(writable, { level });
    }

    /**
     * 压入单个文件（一次性提供完整内容；内容在压缩后即可释放）
     * @param path zip内相对路径（UTF-8文件名，中文路径安全）
     * @param data 文件内容
     */
    async addFile(path: string, data: Uint8Array): Promise<void> {
        await this.zipWriter.add(path, new Uint8ArrayReader(data));
    }

    /** 结束压缩并关闭输出（zip.js会随流关闭sink） */
    async close(): Promise<void> {
        if (this.ended) {
            return;
        }
        this.ended = true;
        await this.zipWriter.close();
    }

    /** 中止（尽量清理输出目标） */
    async abort(reason?: unknown): Promise<void> {
        this.ended = true;
        try {
            if (this.sink.abort) {
                await this.sink.abort(reason);
            }
        } catch {
            // 中止清理失败可忽略
        }
    }
}

/** 测试/回退用：把ZIP流收集为完整字节 */
export function memorySink(): ZipSink & { bytes(): Uint8Array } {
    const chunks: Uint8Array[] = [];
    return {
        async write(chunk) {
            chunks.push(chunk);
        },
        async close() {
            // 无需处理
        },
        bytes() {
            const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const out = new Uint8Array(total);
            let offset = 0;
            for (const chunk of chunks) {
                out.set(chunk, offset);
                offset += chunk.length;
            }
            return out;
        },
    };
}
