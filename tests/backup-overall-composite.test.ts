/**
 * 备份「总进度」合成口径回归（方案 A）。
 *
 * 背景：概览顶部「总进度」原先 = DM.globalProgress().overallPercent（纯媒体下载进度），
 * 导致「单模块媒体秒下完、后续模块还在采集」时顶部虚高到 100%（见用户反馈）。
 * 方案 A：总进度 = 各勾选模块「采集进度 + 媒体下载进度」均值的均值。
 *
 * 这里固化：
 *  1) computeBackupOverall 的核心不变量（单模块媒体少不会提前 100%）；
 *  2) moduleProgressPct 的采集进度算法；
 *  3) DownloadManager.moduleProgressMap 按模块聚合的正确性。
 */
import { describe, it, expect } from 'vitest';
import { computeBackupOverall, moduleProgressPct } from '../entrypoints/backup-panel/renderers/overview';
import type { ModState } from '../entrypoints/backup-panel/context';
import { DownloadManager } from '../core/downloader/manager';

/** 构造模块状态：phases 形如 { list: {done,total,failed} } */
function modState(status: ModState['status'], phases: Record<string, { done: number; total: number; failed?: number }>, mediaDownloading?: boolean): ModState {
    return { status, phases, currentPhase: undefined, currentPhaseLabel: undefined, mediaDownloading };
}

describe('moduleProgressPct 采集进度算法', () => {
    it('done 模块（phases 已补满）记 100', () => {
        const st = modState('done', { list: { done: 10, total: 10 }, comments: { done: 5, total: 5 } });
        expect(moduleProgressPct('Messages', st)).toBe(100);
    });
    it('进行中模块按主体对齐进度：枚举过半（comments 尚未启动）即 50%', () => {
        const st = modState('active', { list: { done: 5, total: 10 } });
        // 仅 list 有总数 10，已处理 5 => 50%（评论未启动不计入，进度跟随枚举）
        expect(moduleProgressPct('Messages', st)).toBe(50);
    });
    it('失败计入「已处理」：done 10 中含 2 失败仍记 100（由 module-complete 补满）', () => {
        const st = modState('done', { list: { done: 10, total: 10, failed: 2 }, comments: { done: 5, total: 5 } });
        expect(moduleProgressPct('Messages', st)).toBe(100);
    });
    it('已开始前（无 phases）记 0', () => {
        const st = modState('active', {});
        expect(moduleProgressPct('Messages', st)).toBe(0);
    });
});

describe('computeBackupOverall 合成总进度不变量', () => {
    const SIX = ['talks', 'blogs', 'photos', 'videos', 'board', 'friends'];

    it('单模块（说说）媒体秒下完、其余还在采集 → 整体≈1/6 ≈ 17%，而非 100%（核心回归）', () => {
        const moduleMap = new Map<string, ModState>([
            ['talks', modState('done', { list: { done: 20, total: 20 } })],
            // 后续模块尚在采集：photos 30%
            ['photos', modState('active', { list: { done: 30, total: 100 } })],
        ]);
        const mediaByModule: Record<string, { overallPercent: number; totalTasks: number }> = {
            talks: { overallPercent: 100, totalTasks: 3 }, // 说说媒体已 100%
            // photos/videos... 媒体尚未入队：不在此表（视为 0 任务）
        };
        const overall = computeBackupOverall({ moduleMap, selectedModules: SIX, mediaByModule, finished: false });
        // (100 + 30) / 6 ≈ 21.7 → 22，远低于 100
        expect(overall).toBeLessThan(40);
        expect(overall).toBeGreaterThan(15);
    });

    it('全部模块采集完成且媒体 settled → 100%', () => {
        const moduleMap = new Map<string, ModState>(
            SIX.map(m => [m, modState('done', { list: { done: 10, total: 10 } })]),
        );
        const mediaByModule: Record<string, { overallPercent: number; totalTasks: number }> = {};
        for (const m of SIX) mediaByModule[m] = { overallPercent: 100, totalTasks: 5 };
        expect(computeBackupOverall({ moduleMap, selectedModules: SIX, mediaByModule, finished: false })).toBe(100);
    });

    it('模块无媒体任务时退化为仅看采集进度', () => {
        // 说说无媒体：采集 100% 即模块 100%
        const moduleMap = new Map<string, ModState>([
            ['talks', modState('done', { list: { done: 10, total: 10 } })],
            ['photos', modState('active', { list: { done: 50, total: 100 } })],
        ]);
        const mediaByModule: Record<string, { overallPercent: number; totalTasks: number }> = {
            // talks 不在表中 → 视为无媒体
            photos: { overallPercent: 0, totalTasks: 0 },
        };
        // (100 + 50) / 2 = 75
        expect(computeBackupOverall({ moduleMap, selectedModules: ['talks', 'photos'], mediaByModule, finished: false })).toBe(75);
    });

    it('finished 不再单独强制 100（回归 #14）：complete() 已调用但媒体仍在下载（sticky）→ 返回真实合成值而非 100', () => {
        // 模拟：complete() 已调用（finished=true），但媒体仍在后台下载（sticky 标记在身）。
        const moduleMap = new Map<string, ModState>(
            SIX.map(m => [m, modState('done', { list: { done: 10, total: 10 } }, true)]),
        );
        const mediaByModule: Record<string, { overallPercent: number; totalTasks: number }> = {};
        for (const m of SIX) mediaByModule[m] = { overallPercent: 50, totalTasks: 5 }; // 媒体仅 50%
        // 旧实现 `if (finished || allSettled) return 100` 会在此误报 100；新实现返回真实合成值 (100+50)/2 = 75。
        expect(computeBackupOverall({ moduleMap, selectedModules: SIX, mediaByModule, finished: true })).toBe(75);
    });

    it('未勾选任何模块且未完成 → 0', () => {
        expect(computeBackupOverall({ moduleMap: new Map(), selectedModules: [], mediaByModule: undefined, finished: false })).toBe(0);
    });

    it('媒体进行中（50%）与采集进行中（50%）合成模块 = 50%', () => {
        const moduleMap = new Map<string, ModState>([
            ['videos', modState('active', { list: { done: 50, total: 100 } })],
        ]);
        const mediaByModule: Record<string, { overallPercent: number; totalTasks: number }> = {
            videos: { overallPercent: 50, totalTasks: 4 },
        };
        // 单模块：(50 + 50)/2 = 50
        expect(computeBackupOverall({ moduleMap, selectedModules: ['videos'], mediaByModule, finished: false })).toBe(50);
    });

    it('采集全 done、媒体 99% 尚未 settled → 总进度封顶 99%，不能四舍五入到 100%（核心回归 #13）', () => {
        const moduleMap = new Map<string, ModState>(
            SIX.map(m => [m, modState('done', { list: { done: 10, total: 10 } })]),
        );
        const mediaByModule: Record<string, { overallPercent: number; totalTasks: number }> = {};
        for (const m of SIX) mediaByModule[m] = { overallPercent: 99, totalTasks: 5 };
        // 每模块 (100 + 99)/2 = 99.5，均值 99.5，Math.round 会变成 100，必须被 99 封顶。
        expect(computeBackupOverall({ moduleMap, selectedModules: SIX, mediaByModule, finished: false })).toBe(99);
    });

    it('部分模块无媒体、其余媒体 99% → 总进度仍不提前 100%', () => {
        const moduleMap = new Map<string, ModState>(
            SIX.map(m => [m, modState('done', { list: { done: 10, total: 10 } })]),
        );
        const mediaByModule: Record<string, { overallPercent: number; totalTasks: number }> = {
            talks: { overallPercent: 100, totalTasks: 1 }, // 该模块已真正结束
            photos: { overallPercent: 99, totalTasks: 5 }, // 尚未 settled
        };
        // talks: (100+100)/2=100；photos: (100+99)/2=99.5；其余 4 个无媒体：100；
        // 平均值远高于 99.5，但 photos 未 settled，整体应封顶 99。
        expect(computeBackupOverall({ moduleMap, selectedModules: SIX, mediaByModule, finished: false })).toBe(99);
    });

    it('sticky 标记即便 DM 快照漏掉该模块也强制「未结束」→ 封顶 99 且不回退到 0', () => {
        // 模拟：模块采集完、媒体下载中，但本次渲染 dm.moduleProgressMap() 暂未含该模块（快照间隙）。
        const moduleMap = new Map<string, ModState>([
            ['photos', modState('done', { list: { done: 10, total: 10 } }, true)],
        ]);
        const overall = computeBackupOverall({ moduleMap, selectedModules: ['photos'], mediaByModule: {}, finished: false });
        expect(overall).toBeLessThanOrEqual(99);
        expect(overall).toBeGreaterThan(0); // 不为 0（采集已 100%，只是媒体未知）
    });

    it('主体对齐（Photos）：相册全部收完 → 模块采集进度 100%，不为明细稀释', () => {
        const moduleMap = new Map<string, ModState>([
            ['Photos', modState('active', {
                albums: { done: 10, total: 10 },
                'album-comments': { done: 5, total: 10 },  // 明细未完成但不再影响主体进度
            })],
        ]);
        // 逐页内联后 SUBJECT_CONFIG['Photos']=['albums']，仅 albums 影响主体进度
        const overall = computeBackupOverall({ moduleMap, selectedModules: ['Photos'], mediaByModule: {}, finished: false });
        expect(overall).toBe(100); // albums=10/10=100%，明细滞后不影响
    });
});

describe('DownloadManager.moduleProgressMap 按模块聚合', () => {
    it('按 task.module 分组，各模块 overallPercent/totalTasks 与全局一致', () => {
        const dm = new DownloadManager({});
        // talks：2 个 complete（各 100B），1 个 in_progress 50/100
        dm.upsert({ id: 't1', module: 'talks', url: 'u1', dir: 'd', name: 't1.jpg', state: 'complete', totalBytes: 100, downloadedBytes: 100, trackerType: 'browser' });
        dm.upsert({ id: 't2', module: 'talks', url: 'u2', dir: 'd', name: 't2.jpg', state: 'complete', totalBytes: 100, downloadedBytes: 100, trackerType: 'browser' });
        dm.upsert({ id: 't3', module: 'talks', url: 'u3', dir: 'd', name: 't3.jpg', state: 'in_progress', totalBytes: 100, downloadedBytes: 50, trackerType: 'browser' });
        // photos：1 个 in_progress 0/100（未知 size? 否，有 total）
        dm.upsert({ id: 'p1', module: 'photos', url: 'u4', dir: 'd', name: 'p1.jpg', state: 'in_progress', totalBytes: 100, downloadedBytes: 0, trackerType: 'browser' });

        const map = dm.moduleProgressMap();
        // talks：加权 (1 + 1 + 0.5)/3 = 83.3% → 83
        expect(map.talks!.overallPercent).toBe(83);
        expect(map.talks!.totalTasks).toBe(3);
        // photos：加权 (0)/1 = 0
        expect(map.photos!.overallPercent).toBe(0);
        expect(map.photos!.totalTasks).toBe(1);
        // 全局 totalTasks == 各模块之和
        const gp = dm.globalProgress();
        expect(gp.totalTasks).toBe(map.talks!.totalTasks + map.photos!.totalTasks);
        dm.clear();
    });

    it('空管理器返回空对象', () => {
        const dm = new DownloadManager({});
        expect(dm.moduleProgressMap()).toEqual({});
        dm.clear();
    });
});
