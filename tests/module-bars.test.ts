/**
 * 模块进度条回归测试。
 *
 * 核心缺陷（本次修复）：模块条原先只有单色进度条，失败项（failed）计入 done
 * 却无法在视觉上区分，用户看不出某模块有多少失败。新版把条拆成
 * 「绿色成功段 + 红色失败段」两段。
 *
 * 关键不变量：green 取 done - failed（而非直接拿 done 当成功）。
 * 因为 module-complete 会把 done 强制补到 total（含失败），若不减 failed，
 * 绿段会包含失败，造成「绿 + 红 > 100%」的割裂。
 *
 * 下面用 buildModuleBar（纯函数，不依赖 DOM）逐条锁死上述契约。
 */
import { describe, it, expect } from 'vitest';
import { buildModuleBar } from '../entrypoints/backup-panel/renderers/overview';
import type { ModState } from '../entrypoints/backup-panel/context';

function bar(mod: string, st: ModState): string {
    return buildModuleBar(mod, st);
}

/** 取模块条 HTML 里 .fill 与 .fill-fail 的 width / left */
function segs(html: string): { green: number; fail: number; left: number } {
    const fill = /class="fill" style="width:(\d+)%"/.exec(html);
    const fail = /class="fill-fail" style="left:(\d+)%;width:(\d+)%"/.exec(html);
    return {
        green: fill ? Number(fill[1]) : 0,
        left: fail ? Number(fail[1]) : 0,
        fail: fail ? Number(fail[2]) : 0,
    };
}

describe('buildModuleBar 绿/红两段分段', () => {
    it('纯成功进度：绿段 = 已处理%，无红段', () => {
        const h = bar('Messages', { status: 'active', phases: { list: { done: 80, total: 100 } } });
        const s = segs(h);
        expect(s.green).toBe(80);
        expect(s.fail).toBe(0);
        expect(h).toContain('80%');
        expect(h).not.toContain('失败');
    });

    it('module-complete 补满：done 被强制到 total 但 failed 保留，绿段必须扣掉失败（不虚高）', () => {
        // 模拟 module-complete 后：done=total=100，failed=20
        const h = bar('Photos', { status: 'done', phases: { download: { done: 100, total: 100, failed: 20 } } });
        const s = segs(h);
        // 80 成功 + 20 失败 = 100，绿段 80 而非 100
        expect(s.green).toBe(80);
        expect(s.left).toBe(80);
        expect(s.fail).toBe(20);
        expect(h).toContain('100%');        // 主数字=已处理比例，跑完必到 100%
        expect(h).toContain('失败20');      // 失败数量明确展示
    });

    it('进行中 + 既有成功又有失败：绿+红=已处理%，失败不被重复计入绿段', () => {
        const h = bar('Blogs', { status: 'active', phases: { list: { done: 30, total: 100, failed: 10 } } });
        const s = segs(h);
        // done=30 含失败的话，成功=20，失败=10 → 20 + 10 = 30
        expect(s.green).toBe(20);
        expect(s.fail).toBe(10);
        expect(s.left).toBe(20);
        expect(h).toContain('30%');
    });

    it('全部失败的模块：绿段 0，红段铺满 100%', () => {
        const h = bar('Boards', { status: 'done', phases: { list: { done: 100, total: 100, failed: 100 } } });
        const s = segs(h);
        expect(s.green).toBe(0);
        expect(s.fail).toBe(100);
        expect(h).toContain('失败100');
    });

    it('主体阶段预置为 indeterminate（done=0,total=-1）：首帧显示「采集中」而非假 100%', () => {
        // 复现修复前倒退：第一页明细（done=total）处理期间 subject['list'] 尚未写入，
        // 渲染回落旧 sum 公式把 done=total 的明细 phase 累加算成 100%。
        // 预置 subject['list']={done:0,total:-1} 后，应走 subject 分支、显示「采集中」。
        const h = bar('Messages', {
            status: 'active',
            phases: { full_content: { done: 20, total: 20 }, comments: { done: 20, total: 20 } },
            subject: { list: { done: 0, total: -1 } },
        });
        expect(h).toContain('采集中');
        expect(h).not.toContain('100%');
        const s = segs(h);
        expect(s.green).toBe(0);
    });

    it('多 phase 累加（主体模式）：失败按主体总数折算，绿+红仍不超过 100%', () => {
        const h = bar('Messages', {
            status: 'done',
            phases: {
                list: { done: 100, total: 100, failed: 5 },
                comments: { done: 100, total: 100, failed: 3 },
            },
        });
        const s = segs(h);
        expect(s.green).toBe(92); // 主体总数100，失败8 → 绿=100-8
        expect(s.fail).toBe(8);   // (5+3)/100
        expect(s.green + s.fail).toBeLessThanOrEqual(100);
        expect(h).toContain('100%');
    });

    it('未知 total（主体总数未知）：显示「采集中」，绝不假 100%（修复历史 bug）', () => {
        const h = bar('Visitors', { status: 'active', phases: { list: { done: 45, total: -1, failed: 5 } } });
        // 主体总数未知 → indeterminate：主数字显示「采集中」而非 100%
        expect(h).toContain('采集中');
        expect(h).not.toContain('100%');
    });

    it('已全部处理时不显示「跳过」标注，进度按成功计', () => {
        const h = bar('Shares', { status: 'done', phases: { list: { done: 100, total: 100 } } });
        const s = segs(h);
        expect(s.green).toBe(100);
        expect(s.fail).toBe(0);
        expect(h).not.toContain('跳过');
    });
});

/**
 * 采集完成 + 媒体下载中：模块条保持 done 样式（100% 绿、宽度不变），
 * 仅徽标从「成功」改为「媒体下载中」。条本身不动 = 不会忽隐忽现。
 * 顶级总进度（computeBackupOverall）用 sticky 标记按采集+媒体双口径计算。
 */
describe('采集完成 + 媒体下载中：条不动，仅徽标区分', () => {
    it('done + hasMediaTasks + 尚未 settle：显示「媒体下载中」徽标，但条保持 100% done', () => {
        const st: ModState = {
            status: 'done',
            phases: { collect: { done: 100, total: 100 } },
            hasMediaTasks: true,
            // mediaSettled 未置 → 媒体仍在下载
        };
        const h = buildModuleBar('Photos', st);
        expect(h).toContain('媒体下载中');
        expect(h).not.toContain('成功');
        expect(h).toContain('100%');
        // 条保持 done 样式（绿），不翻 active（蓝）
        expect(h).toContain('mod-progress done');
        expect(h).not.toContain('mod-progress active');
    });

    it('hasMediaTasks 且 mediaSettled：恢复正常「成功」+ 100%', () => {
        const st: ModState = {
            status: 'done',
            phases: { collect: { done: 100, total: 100 } },
            hasMediaTasks: true,
            mediaSettled: true, // 媒体已下完
        };
        const h = buildModuleBar('Photos', st);
        expect(h).toContain('成功');
        expect(h).not.toContain('媒体下载中');
        expect(h).toContain('100%');
    });

    it('done 但无媒体任务：正常「成功」+100%（与 HEAD 一致）', () => {
        const st: ModState = { status: 'done', phases: { collect: { done: 100, total: 100 } } };
        const h = buildModuleBar('Photos', st);
        expect(h).toContain('成功');
        expect(h).toContain('100%');
        expect(h).not.toContain('媒体下载中');
    });

    it('快照间隙：hasMediaTasks 已置位但 mediaSettled 未置 → 仍显示「媒体下载中」，条 100% 不动', () => {
        // 最关键的回归：模块条绝不能因为一帧快照缺失就翻回「成功」又翻回「媒体下载中」
        const st: ModState = {
            status: 'done',
            phases: { collect: { done: 100, total: 100 } },
            hasMediaTasks: true,
            // mediaSettled 未置（媒体还在下）
        };
        const h = buildModuleBar('Photos', st);
        expect(h).toContain('媒体下载中');
        expect(h).toContain('100%');
        expect(h).toContain('mod-progress done'); // 不翻 active
    });
});

/**
 * 主体对齐进度（选项 A）回归：进度按「主体个数」评估，不再被 photos/媒体等海量
 * phase 稀释，也不再因未知 total 假 100%。
 */
describe('主体对齐进度（选项 A）', () => {
    it('Photos：all albums collected → 100%（明细不再拉低主体进度）', () => {
        const h = bar('Photos', {
            status: 'active',
            phases: {
                albums: { done: 10, total: 10 },
                'album-comments': { done: 5, total: 10 },  // 明细滞后不影响
            },
        });
        expect(h).toContain('100%'); // 逐页内联：仅 albums 影响主体进度
    });

    it('Photos：枚举 100% → 100%（明细滞后不将进度拉回）', () => {
        const h = bar('Photos', {
            status: 'active',
            phases: {
                albums: { done: 10, total: 10 },
                'album-comments': { done: 7, total: 10 },
                media: { done: 10, total: 10 },
            },
        });
        expect(h).toContain('100%'); // albums=10/10=100%
    });

    it('Photos：全部相册枚举 + 相册级明细收完 → 100%', () => {
        const h = bar('Photos', {
            status: 'done',
            phases: {
                albums: { done: 10, total: 10 },
                'album-comments': { done: 10, total: 10 },
                'album-likes': { done: 10, total: 10 },
                'album-visitors': { done: 10, total: 10 },
                media: { done: 10, total: 10 },
            },
        });
        expect(h).toContain('100%');
    });

    it('Photos：主体总数未知（total=-1）→ 显示「采集中」', () => {
        const h = bar('Photos', {
            status: 'active',
            phases: {
                albums: { done: 4, total: -1 },
                'album-comments': { done: 2, total: -1 },
            },
        });
        expect(h).toContain('采集中');
        expect(h).not.toContain('100%');
    });

    it('Blogs：list 过半但 comments 未启动（不在此 phases）→ 按枚举进度显示 50%', () => {
        const h = bar('Blogs', { status: 'active', phases: { list: { done: 50, total: 100 } } });
        expect(h).toContain('50%');
    });
});

/**
 * 采集层 subject 透传回归（逐页内联版）。
 * 逐页内联后，明细阶段不再上报 subject，仅 list/albums 阶段为进度源。
 * SUBJECT_CONFIG 仅包含 ['list']（或 Photos 的 ['albums']），min-over-started 自动退化为直接读数。
 */
describe('采集层 subject 透传（逐页内联）', () => {
    it('st.subject 优先：仅 list 阶段有 subject，进度 = list.done/list.total', () => {
        // 逐页内联后 detail phases 不再上报 subject，仅 list 有
        const h = bar('Messages', {
            status: 'active',
            phases: { list: { done: 100, total: 100 } },
            subject: {
                list: { done: 50, total: 100 },
            },
        });
        const s = segs(h);
        expect(s.green).toBe(50); // SUBJECT_CONFIG['Messages']=['list'] → 50%
    });

    it('resume 旧 checkpoint（无 st.subject）：回退 st.phases 推断（仅 list phase）', () => {
        const h = bar('Messages', {
            status: 'active',
            phases: { list: { done: 50, total: 100 } },
        });
        const s = segs(h);
        expect(s.green).toBe(50); // SUBJECT_CONFIG['Messages']=['list'] → phases.list=50
    });

    it('主体总数未知（subject.total=-1）：indeterminate，进度条不假 100%', () => {
        const h = bar('Diaries', {
            status: 'active',
            phases: {},
            subject: { list: { done: 30, total: -1 } },
        });
        const s = segs(h);
        expect(s.green).toBe(0); // 不渲染假进度
        expect(h).toContain('采集中');
    });

    it('Photos：仅 albums 有 subject，进度 = albums.done/albums.total', () => {
        const h = bar('Photos', {
            status: 'active',
            phases: {
                albums: { done: 10, total: 10 },
                'album-likes': { done: 6, total: 10 },
            },
            subject: {
                albums: { done: 10, total: 10 },
            },
        });
        const s = segs(h);
        expect(s.green).toBe(100); // 仅 albums subject；album-likes 不再上报 subject
    });

    it('Photos：相片采集中途 albums=5/10 → 50%（进度跟随相片采集，不随相册列表枚举到 100%）', () => {
        const h = bar('Photos', {
            status: 'active',
            phases: {
                // 相册列表枚举已完成（album-list 100%），但不应驱动进度条
                'album-list': { done: 10, total: 10 },
                albums: { done: 5, total: 10 },
            },
            subject: {
                // 仅 albums subject 计入；album-list 不再上报 subject
                albums: { done: 5, total: 10 },
            },
        });
        const s = segs(h);
        expect(s.green).toBe(50); // 主体进度 = 已采集相片的相册数 / 总相册数
    });

    it('Photos：相册列表枚举完（album-list=100%）但相片未采 → 0%，不误报 100%', () => {
        const h = bar('Photos', {
            status: 'active',
            phases: {
                'album-list': { done: 10, total: 10 },
            },
            subject: {
                albums: { done: 0, total: 10 },
            },
        });
        const s = segs(h);
        expect(s.green).toBe(0); // 相册列表拉完不等于模块完成
    });
});

/**
 * 回归：list 已 100% 但「获取正文」(contents) 仍在跑 → 模块条不能显示 100%。
 * 背景：断点续传时 list 阶段已被记为 100%，而 contents 是 list 之后的独立重活，
 * 进度条若只数 list 就会假 100%（用户体感「正在获取正文中却显示 100%」）。
 * 修复：Blogs/Diaries 的 SUBJECT_CONFIG 含 'contents'，主体进度取 min(list,contents)。
 */
describe('主体进度含 contents（获取正文不假 100%）', () => {
    it('Blogs：list 100% 但 contents(获取正文) 50% → 取 min 显示 50%，不显示 100%', () => {
        const h = bar('Blogs', {
            status: 'active',
            phases: { list: { done: 100, total: 100 }, contents: { done: 50, total: 100 } },
            subject: {
                list: { done: 100, total: 100 },
                contents: { done: 50, total: 100 },
            },
        });
        const s = segs(h);
        expect(s.green).toBe(50);   // min(list=100, contents=50) = 50
        expect(h).toContain('50%');
        expect(h).not.toContain('100%');
    });

    it('Diaries：list 100% 但 contents 仍在跑（断点续传场景）→ 显示 contents 进度，不 100%', () => {
        const h = bar('Diaries', {
            status: 'active',
            phases: { list: { done: 100, total: 100 }, contents: { done: 30, total: 100 } },
            subject: {
                list: { done: 100, total: 100 },
                contents: { done: 30, total: 100 },
            },
        });
        const s = segs(h);
        expect(s.green).toBe(30);
        expect(h).toContain('30%');
        expect(h).not.toContain('100%');
    });

    it('Blogs：list 与 contents 都 100%（正文获取完）→ 正常 100%', () => {
        const h = bar('Blogs', {
            status: 'active',
            phases: { list: { done: 100, total: 100 }, contents: { done: 100, total: 100 } },
            subject: {
                list: { done: 100, total: 100 },
                contents: { done: 100, total: 100 },
            },
        });
        expect(h).toContain('100%');
    });
});
