/**
 * 完成横幅回归测试。
 *
 * 核心缺陷（本次修复）：横幅原先在 `complete()` 里就地写死，是采集结束那一刻的
 * 一次性快照。媒体下载此后还会跑很久，于是横幅永久停留在旧计数上：
 *   · 横幅「已完成 157/393，仍在进行」，而「媒体」页签实时数字早已 380+
 *   · 队列跑空后横幅仍宣称「仍在进行」，不会自愈
 *
 * 修复后横幅由纯函数 buildCompletionBanner 每帧依据实时快照重算。
 * 下面用「同一个 info + 不同 gp」反复调用来锁死这个契约。
 */
import { describe, it, expect } from 'vitest';
import { buildCompletionBanner } from '../entrypoints/backup-panel/renderers/banner';
import type { CompletionInfo } from '../entrypoints/backup-panel/renderers/banner';
import type { DmProgress } from '../entrypoints/backup-panel/dm';

/** 造一份进度快照；未给的分项按「其余都是 pending」补齐，保证不变式成立 */
function gpOf(o: Partial<DmProgress> & { totalTasks: number; succeeded: number; failed: number }): DmProgress {
    const running = o.running ?? 0;
    const paused = o.paused ?? 0;
    const pending = o.pending ?? Math.max(0, o.totalTasks - o.succeeded - o.failed - running - paused);
    const unsettled = pending + running + paused;
    // 先展开 o（含 totalTasks/succeeded/failed 三个必填项），再覆盖派生字段，
    // 避免 TS2783「属性重复指定」。
    return {
        ...o,
        totalBytes: 0, downloadedBytes: 0, speedBps: 0,
        percent: 0, settledPercent: 0, failedPercent: 0,
        settled: o.succeeded + o.failed,
        pending, running, paused, unsettled,
        isSettled: o.totalTasks === 0 || unsettled === 0,
    };
}

const DIR: CompletionInfo = { mode: 'directory' };

describe('buildCompletionBanner 实时性（修复横幅冻结）', () => {
    it('同一 info 配不同快照必须给出不同文案 —— 横幅不得停留在旧计数', () => {
        // 采集刚结束那一刻
        const early = buildCompletionBanner(DIR, gpOf({ totalTasks: 393, succeeded: 157, failed: 3, running: 8 }));
        expect(early.cls).toBe('warn');
        expect(early.text).toContain('已完成 157/393');
        expect(early.text).toContain('下载进行中');

        // 下载推进后用同一个 info 重算
        const later = buildCompletionBanner(DIR, gpOf({ totalTasks: 393, succeeded: 380, failed: 3, running: 10 }));
        expect(later.text).toContain('已完成 380/393');
        expect(later.text).not.toContain('157'); // 旧数字必须消失

        // 队列跑空 —— 横幅必须自愈为「已结束」，不能再说「仍在进行」
        const done = buildCompletionBanner(DIR, gpOf({ totalTasks: 393, succeeded: 390, failed: 3 }));
        expect(done.text).not.toContain('进行中');
        expect(done.text).toContain('3 个媒体文件下载失败');
        expect(done.cls).toBe('warn');
    });

    it('全部成功跑完时收敛为无警告的完成态', () => {
        const v = buildCompletionBanner(DIR, gpOf({ totalTasks: 10, succeeded: 10, failed: 0 }));
        expect(v.cls).toBe('ok');
        expect(v.text).toContain('全部媒体文件下载成功');
        expect(v.statusText).toBe('备份完成。');
    });

    it('未结论任务全为暂停时说「已暂停」，而不是谎称「进行中」', () => {
        const v = buildCompletionBanner(DIR, gpOf({ totalTasks: 10, succeeded: 4, failed: 1, paused: 5 }));
        expect(v.text).toContain('下载已暂停');
        expect(v.text).not.toContain('进行中');
        expect(v.text).toContain('待处理 5');
        expect(v.statusText).toContain('已暂停');
    });

    it('暂停与下载中并存时仍按「进行中」处理（并非全部暂停）', () => {
        const v = buildCompletionBanner(DIR, gpOf({ totalTasks: 10, succeeded: 4, failed: 0, paused: 3, running: 3 }));
        expect(v.text).toContain('下载进行中');
        expect(v.text).toContain('待处理 6');
    });

    it('待处理计数覆盖 pending+running+paused，暂停项不会凭空消失', () => {
        const v = buildCompletionBanner(DIR, gpOf({ totalTasks: 20, succeeded: 5, failed: 2, pending: 6, running: 4, paused: 3 }));
        expect(v.text).toContain('待处理 13'); // 6 + 4 + 3
    });
});

describe('buildCompletionBanner 模式分支', () => {
    it('外链模式不提下载计数', () => {
        const v = buildCompletionBanner({ mode: 'directory', mediaLinkMode: true }, gpOf({ totalTasks: 0, succeeded: 0, failed: 0 }));
        expect(v.cls).toBe('ok');
        expect(v.text).toContain('媒体使用QQ空间外链');
        expect(v.text).not.toContain('已完成');
    });

    it('needMerge 提示只在下载真正结束后出现', () => {
        const info: CompletionInfo = { mode: 'directory', needMerge: true };
        const running = buildCompletionBanner(info, gpOf({ totalTasks: 10, succeeded: 3, failed: 0, running: 7 }));
        expect(running.text).not.toContain('合并回备份目录'); // 下载中不催搬文件

        const settled = buildCompletionBanner(info, gpOf({ totalTasks: 10, succeeded: 10, failed: 0 }));
        expect(settled.text).toContain('合并回备份目录');
    });

    it('downloads 模式直写下载目录，无「打包下载」引导', () => {
        const info: CompletionInfo = { mode: 'downloads' };
        const running = buildCompletionBanner(info, gpOf({ totalTasks: 100, succeeded: 40, failed: 0, running: 60 }));
        expect(running.text).toContain('媒体文件下载进行中');
        expect(running.text).not.toContain('打包下载'); // 形态 B 无打包按钮

        const done = buildCompletionBanner(info, gpOf({ totalTasks: 100, succeeded: 100, failed: 0 }));
        expect(done.text).toContain('全部媒体文件下载成功');
        expect(done.text).toContain('文件已直接写入下载目录');
        expect(done.text).not.toContain('进行中');
        expect(done.text).not.toContain('打包下载');
    });

    it('downloads + 外链模式不追加落盘位置文案', () => {
        const v = buildCompletionBanner({ mode: 'downloads', mediaLinkMode: true }, gpOf({ totalTasks: 0, succeeded: 0, failed: 0 }));
        expect(v.text).toContain('媒体使用QQ空间外链');
        expect(v.text).not.toContain('媒体下载进行中');
    });

    it('无进度快照（旧 DM 实例）时按已结束处理，不会永久卡在「进行中」', () => {
        const v = buildCompletionBanner(DIR, null);
        expect(v.text).not.toContain('进行中');
        expect(v.cls).toBe('ok');
    });
});
