import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiskFS } from '../core/fs/disk-fs';
import { FileWriter, ZipCollector } from '../core/fs/writer';
import type { ModuleBackupRow } from '../core/store/backup-db';
import {
    REQUIRED_VIEWER_FILES,
    exportBackupHistory,
    exportOthers,
    exportViewerWithVerify,
    findMissingViewerFiles,
} from '../core/export/site';

const ROOT = 'QQ空间备份_10001';
const globalAny = globalThis as any;

/** 未选目录 → 走 ZIP 内存收集，便于断言产物路径 */
function makeWriter(): { writer: FileWriter; zip: ZipCollector } {
    const zip = new ZipCollector();
    const writer = new FileWriter(new DiskFS(), zip, ROOT);
    return { writer, zip };
}

/** 收集器内的路径集合（去掉根目录前缀，便于断言） */
function paths(zip: ZipCollector): string[] {
    return zip.getEntries().map((e) => e.path.replace(ROOT + '/', ''));
}

/**
 * 装扩展环境：getURL 直接回传路径，fetch 由 handler 决定成败
 * handler 返回 null 表示该资源取不到
 */
function stubExtension(handler: (path: string) => string | null): void {
    globalAny.chrome = { runtime: { getURL: (p: string) => p } };
    globalAny.fetch = vi.fn(async (url: string) => {
        const body = handler(url);
        if (body === null) {
            return { ok: false, status: 404 } as unknown as Response;
        }
        const bytes = new TextEncoder().encode(body);
        return {
            ok: true,
            status: 200,
            arrayBuffer: async () => bytes.buffer.slice(0),
        } as unknown as Response;
    });
}

let originalChrome: unknown;
let originalFetch: unknown;

beforeEach(() => {
    originalChrome = globalAny.chrome;
    originalFetch = globalAny.fetch;
});

afterEach(() => {
    globalAny.chrome = originalChrome;
    globalAny.fetch = originalFetch;
    vi.restoreAllMocks();
});

describe('备份查看器生成', () => {
    it('查看器首页写入备份根目录，脚本/样式写入 Common/js、Common/css', async () => {
        stubExtension((p) => 'content-of:' + p);
        const { writer, zip } = makeWriter();

        const result = await exportViewerWithVerify(writer, { uin: 10001 });

        expect(result.ok).toBe(true);
        expect(result.missingRequired).toEqual([]);
        expect(result.attempts).toBe(1);
        expect(result.usedFallbackIndex).toBe(false);

        const written = paths(zip);
        // 首页必须与数据目录同级，否则其相对路径数据请求全部 404；
        // 脚本/样式归入 Common/js、Common/css，与数据同属 Common 命名空间
        expect(written).toContain('index.html');
        expect(written).toContain('Common/js/index.js');
        expect(written).toContain('Common/css/index.css');
        // 不应再出现历史上的错误位置
        expect(written.some((p) => p.startsWith('Common/viewer/'))).toBe(false);
        // 地图依赖与占位图各归其位
        expect(written).toContain('Common/vendor/echarts.min.js');
        expect(written).toContain('Common/vendor/maps/china.js');
        expect(written).toContain('Common/images/favicon.ico');
        expect(written).toContain('Common/images/no_cover.gif');
        expect(written).toContain('Common/images/media_missing.png');
        // ZIP 条目应带备份根目录前缀
        expect(zip.getEntries().every((e) => e.path.startsWith(ROOT + '/'))).toBe(true);
    });

    it('随查看器一并导出微信表情到 Common/images/，脱离 jsdelivr 外部 CDN', async () => {
        stubExtension((p) => 'content-of:' + p);
        const { writer, zip } = makeWriter();

        const result = await exportViewerWithVerify(writer, { uin: 10001 });

        expect(result.ok).toBe(true);
        const written = paths(zip);
        // 微信表情随备份导出到本地 Common/images/，查看器离线即可显示，不再依赖 jsdelivr 在线引用
        expect(written).toContain('Common/images/2_02.png');
        expect(written).toContain('Common/images/Yellowdog.png');
        expect(written).toContain('Common/images/Let Down.png');
        // 表情属于可选资源：即使个别缺失也不应阻断查看器打开，且不计入关键缺失
        expect(result.missingRequired).not.toContain('Common/images/2_02.png');
    });

    it('首轮部分资源失败时自动重试并补齐', async () => {
        let firstPass = true;
        stubExtension((p) => {
            // 首轮 Common/js/index.js 取不到，重试时恢复正常
            if (p === 'viewer/Common/js/index.js' && firstPass) {
                firstPass = false;
                return null;
            }
            return 'content-of:' + p;
        });
        const { writer, zip } = makeWriter();
        const errors: unknown[][] = [];

        const result = await exportViewerWithVerify(writer, { uin: 10001 }, {
            error: (...args: unknown[]) => errors.push(args),
        });

        expect(result.attempts).toBe(2);
        expect(result.ok).toBe(true);
        expect(paths(zip)).toContain('Common/js/index.js');
        // 重试前必须留下错误日志
        expect(errors.length).toBeGreaterThan(0);
    });

    it('index.html 始终取不到时启用兜底首页，且引用 Common/js/index.js 与 Common/css/index.css', async () => {
        stubExtension((p) => (p === 'viewer/index.html' ? null : 'content-of:' + p));
        const { writer, zip } = makeWriter();

        const result = await exportViewerWithVerify(writer, { uin: 10001, nickname: '张三' });

        expect(result.usedFallbackIndex).toBe(true);
        // 兜底后关键文件齐备，查看器仍可打开
        expect(result.ok).toBe(true);

        const entry = zip.getEntries().find((e) => e.path === ROOT + '/index.html');
        const html = String(entry?.data);
        expect(html).toContain('./Common/js/index.js');
        expect(html).toContain('./Common/css/index.css');
        expect(html).toContain('张三');
    });

    it('关键文件持续缺失时上报失败而非静默通过', async () => {
        // Common/js/index.js 永远取不到，兜底首页也救不回来
        stubExtension((p) => (p === 'viewer/Common/js/index.js' ? null : 'content-of:' + p));
        const { writer } = makeWriter();
        const errors: unknown[][] = [];

        const result = await exportViewerWithVerify(writer, { uin: 10001 }, {
            error: (...args: unknown[]) => errors.push(args),
        });

        expect(result.ok).toBe(false);
        expect(result.missingRequired).toEqual(['Common/js/index.js']);
        expect(errors.length).toBeGreaterThan(0);
    });

    it('exportOthers 在写出个人档与配置的同时生成查看器', async () => {
        stubExtension((p) => 'content-of:' + p);
        const { writer, zip } = makeWriter();

        const result = await exportOthers(writer, { uin: 10001 }, { Common: { exportType: 'HTML' } });

        expect(result.ok).toBe(true);
        const written = paths(zip);
        expect(written).toContain('Common/json/user.js');
        expect(written).toContain('Common/json/user.json');
        expect(written).toContain('Common/json/config.js');
        expect(written).toContain('index.html');
    });

    it('非扩展环境下不生成查看器，且如实报告缺失', async () => {
        delete globalAny.chrome;
        const { writer } = makeWriter();

        const missing = await findMissingViewerFiles(writer);
        for (const required of REQUIRED_VIEWER_FILES) {
            expect(missing).toContain(required);
        }
    });

    it('exportBackupHistory 写出纯 JSON 增量备份文件并按模块顺序排序', async () => {
        stubExtension((p) => 'content-of:' + p);
        const { writer, zip } = makeWriter();

        const rows: ModuleBackupRow[] = [
            { module: 'Photos', data: [{ id: 1 }], time: 300 },
            { module: 'Messages', data: [{ id: 2 }], time: 100 },
        ];
        await exportBackupHistory(writer, rows, 10001);

        const path = ROOT + '/Common/json/助手备份数据_10001.json';
        expect(paths(zip)).toContain('Common/json/助手备份数据_10001.json');
        const entry = zip.getEntries().find((e) => e.path === path);
        const payload = JSON.parse(String(entry?.data));
        // 纯 JSON（无 window.xxx = 前缀），且只含当前 uin；按模块顺序排序
        expect(payload).toEqual({ Backedup: { '10001': [rows[1], rows[0]] } });
        // 复刻 V2 顺序：Messages 先于 Photos
        expect(payload.Backedup['10001'].map((r: ModuleBackupRow) => r.module)).toEqual(['Messages', 'Photos']);
    });

    it('exportOthers 接收增量行后一并写出增量 JSON（与 user/config/查看器共存）', async () => {
        stubExtension((p) => 'content-of:' + p);
        const { writer, zip } = makeWriter();

        const rows: ModuleBackupRow[] = [{ module: 'Blogs', data: [], time: 1 }];
        const result = await exportOthers(
            writer,
            { uin: 10001 },
            { Common: { exportType: 'HTML' } },
            undefined,
            rows,
            10001,
        );

        expect(result.ok).toBe(true);
        const written = paths(zip);
        expect(written).toContain('Common/json/user.js');
        expect(written).toContain('Common/json/user.json');
        expect(written).toContain('Common/json/config.js');
        expect(written).toContain('Common/json/助手备份数据_10001.json');
    });

    it('未传增量行时 exportOthers 不写出增量 JSON', async () => {
        stubExtension((p) => 'content-of:' + p);
        const { writer, zip } = makeWriter();

        await exportOthers(writer, { uin: 10001 }, { Common: { exportType: 'HTML' } });

        expect(paths(zip).some((p) => p.startsWith('Common/json/助手备份数据_'))).toBe(false);
    });
});
