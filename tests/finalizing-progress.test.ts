/**
 * computeDisplayProgress：收尾阶段总进度封顶逻辑单测。
 *
 * 锁死不变量：进入「整理备份文件」收尾窗口（finalizing && !finished）时，
 * 主数字与绿段压在 99%，complete() 调用（finished=true）后放行到真实百分比。
 */
import { describe, it, expect } from 'vitest';
import { computeDisplayProgress } from '../entrypoints/backup-panel/renderers/overview';

describe('computeDisplayProgress 收尾阶段封顶', () => {
    it('下载已 100% 进入整理窗口：主数字压在 99 而非 100', () => {
        const r = computeDisplayProgress({ overallPct: 100, fillPct: 100, finalizing: true, finished: false });
        expect(r.overall).toBe(99);
        expect(r.fill).toBe(99);
    });

    it('下载 100% 但含失败（绿段 < 100）：收尾时各自压到不超过 99', () => {
        const r = computeDisplayProgress({ overallPct: 100, fillPct: 97, finalizing: true, finished: false });
        expect(r.overall).toBe(99);
        // 绿段本来 97，收尾时不超过 displayOverall(99)
        expect(r.fill).toBe(97);
    });

    it('收尾期间主数字本就 < 99（如 98 下载）：保持原值不虚高', () => {
        const r = computeDisplayProgress({ overallPct: 98, fillPct: 98, finalizing: true, finished: false });
        expect(r.overall).toBe(98);
        expect(r.fill).toBe(98);
    });

    it('complete() 已调用（finished=true）：即使 finalizing 残留也放行到真实百分比', () => {
        const r = computeDisplayProgress({ overallPct: 100, fillPct: 100, finalizing: true, finished: true });
        expect(r.overall).toBe(100);
        expect(r.fill).toBe(100);
    });

    it('正常下载进行中（finalizing=false）：原样透传，不封顶', () => {
        const r = computeDisplayProgress({ overallPct: 42, fillPct: 40, finalizing: false, finished: false });
        expect(r.overall).toBe(42);
        expect(r.fill).toBe(40);
    });

    it('无媒体备份、采集完成（finished=true, overallPct=100）：显示 100', () => {
        const r = computeDisplayProgress({ overallPct: 100, fillPct: 100, finalizing: false, finished: true });
        expect(r.overall).toBe(100);
    });
});
