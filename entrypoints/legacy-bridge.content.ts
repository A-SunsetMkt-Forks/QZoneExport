import { defineContentScript } from 'wxt/utils/define-content-script';
import JSON5 from 'json5';
import { StreamingZipWriter, type ZipSink } from '../core/archive/zip-writer';

/**
 * 旧代码 MV3 能力桥（P4）
 * 与旧版全局内容脚本运行在同一隔离世界，把无法在传统脚本中使用的
 * npm 能力挂到 window 供旧代码调用：
 * - __QZ_ARCHIVE__：流式ZIP直写盘（showSaveFilePicker + zip.js），不支持时旧代码回退jszip
 * - __QZ_JSON5__：宽松JSON解析。部分接口返回的是JS对象字面量（无引号key、
 *   单引号字符串），旧版依赖 eval 解析，MV3 禁用 eval 后改用 JSON5 兜底
 */
export default defineContentScript({
    matches: ['https://*.qzone.qq.com/*'],
    main() {
        const globalTarget = window as unknown as Record<string, unknown>;
        globalTarget['__QZ_JSON5__'] = JSON5;
        globalTarget['__QZ_ARCHIVE__'] = {
            /** 环境是否支持流式直写盘 */
            supported(): boolean {
                return typeof (window as any).showSaveFilePicker === 'function';
            },

            /**
             * 创建流式ZIP保存器（弹出另存为对话框，需用户手势触发）
             * @param filename 建议文件名
             * @returns 保存器（用户取消时抛出AbortError）
             */
            async createZipSaver(filename: string) {
                const picker = (window as any).showSaveFilePicker as (options: unknown) => Promise<any>;
                if (typeof picker !== 'function') {
                    return null;
                }
                const handle = await picker.call(window, {
                    suggestedName: filename,
                    types: [{ description: 'Zip 压缩包', accept: { 'application/zip': ['.zip'] } }],
                });
                const writable = await handle.createWritable();
                const sink: ZipSink = {
                    write: (chunk) => writable.write(chunk),
                    close: () => writable.close(),
                    abort: (reason) => writable.abort(reason),
                };
                const writer = new StreamingZipWriter(sink);
                return {
                    addFile: (path: string, data: Uint8Array) => writer.addFile(path, data),
                    close: () => writer.close(),
                    abort: (reason?: unknown) => writer.abort(reason),
                };
            },
        };
    },
});
