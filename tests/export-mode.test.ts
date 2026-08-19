import { describe, it, expect } from 'vitest';
import { resolveExportMode, exportModeLabel, EXPORT_MODE_DIRECTORY, EXPORT_MODE_ZIP } from '../core/shared/backup-options';

/**
 * 回归测试：备份产出方式由运行环境能力决定（用户无需手动选择）。
 *
 * 历史 bug——曾暴露「打包方式」下拉选项让用户手动选，但编排层门控又用
 * `DiskFS.isSupported()`（浏览器能力判断，Chrome 恒 true）单独判定是否选目录，
 * 导致手动选 ZIP 时仍被强制选目录、直写盘、从不生成压缩包。
 *
 * 现改为环境驱动：支持直写目录 → 'Directory'（直写），否则 → 'Zip'（回退压缩包）。
 * resolveExportMode 是纯函数，便于在此锁定「能力 → 产出方式」的映射不漂移。
 */
describe('resolveExportMode (产出方式=环境驱动)', () => {
    it('环境支持直写本地目录 → Directory（直写）', () => {
        expect(resolveExportMode(true)).toBe(EXPORT_MODE_DIRECTORY);
        expect(resolveExportMode(true)).toBe('Directory');
    });

    it('环境不支持直写本地目录 → Zip（回退压缩包）', () => {
        expect(resolveExportMode(false)).toBe(EXPORT_MODE_ZIP);
        expect(resolveExportMode(false)).toBe('Zip');
    });

    it('类型收窄：返回值仅为 Directory | Zip', () => {
        const a = resolveExportMode(true);
        const b = resolveExportMode(false);
        const all: string[] = [a, b];
        expect(all.every((m) => m === 'Directory' || m === 'Zip')).toBe(true);
    });
});

describe('exportModeLabel (产出方式展示文案)', () => {
    it("Directory → '写入本地目录'", () => {
        expect(exportModeLabel('Directory')).toBe('写入本地目录');
    });

    it("Zip → '打包下载 ZIP'", () => {
        expect(exportModeLabel('Zip')).toBe('打包下载 ZIP');
    });
});
