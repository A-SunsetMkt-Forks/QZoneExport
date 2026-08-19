/**
 * 概览模块进度列表「全量展示 + 状态区分」回归测试。
 *
 * 需求：概览页签的模块进度列表必须完整呈现全部模块（无论是否勾选、是否可备份），
 * 并用不同状态标识区分：
 *   - 已选中但未开始 → 未开始（idle）
 *   - 未选中         → 未选择（unselected）
 *   - 他人空间私有模块 → 无权限（noperm）
 *   - 已开始/成功/失败 → 真实进度条
 * 防止「未勾选模块 / 他人空间私有模块」被悄悄隐藏，导致用户误以为本次备份范围更大。
 */
import { describe, it, expect } from 'vitest';
import { renderModuleBars, buildModulePlaceholder } from '../entrypoints/backup-panel/renderers/overview';
import type { PanelContext, ModState } from '../entrypoints/backup-panel/context';
import { MODULES } from '../core/shared/backup-options';

/** 构造最小可用的假 PanelContext（renderModuleBars 只用到下列字段） */
function fakeCtx(opts: {
    moduleMap?: Map<string, ModState>;
    selectedModules?: string[];
    isOtherSpace?: boolean;
}): PanelContext {
    const el = { innerHTML: '' } as unknown as HTMLElement;
    return {
        ovModulesEl: el,
        moduleMap: opts.moduleMap ?? new Map(),
        selectedModules: opts.selectedModules,
        isOtherSpace: opts.isOtherSpace,
    } as unknown as PanelContext;
}

/** 统计某次渲染后列表里各状态标识的出现次数 */
function counts(html: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const tag of ['未开始', '未选择', '无权限', '进行中', '成功', '失败']) {
        const n = html.split(tag).length - 1;
        if (n > 0) out[tag] = n;
    }
    return out;
}

describe('renderModuleBars 全量展示 + 状态分类', () => {
    it('个人空间：始终展示全部模块，未勾选的标「未选择」、已勾选未开始的标「未开始」', () => {
        const ctx = fakeCtx({ selectedModules: ['Messages', 'Photos'], isOtherSpace: false });
        renderModuleBars(ctx);
        const c = counts(ctx.ovModulesEl.innerHTML);
        // 10 个模块全展示
        expect(ctx.ovModulesEl.innerHTML.match(/mod-progress/g)!.length).toBe(MODULES.length);
        // 勾选但未开始：Messages + Photos = 2 个「未开始」
        expect(c['未开始']).toBe(2);
        // 其余 8 个未勾选 → 未选择
        expect(c['未选择']).toBe(MODULES.length - 2);
        expect(c['无权限']).toBeUndefined();
    });

    it('他人空间：私有模块（日记/好友/收藏）标「无权限」，未勾选的非私有模块仍标「未选择」', () => {
        // 真实场景：popup 已过滤掉私有模块，selectedModules 仅含可备份模块
        const ctx = fakeCtx({ selectedModules: ['Messages', 'Photos'], isOtherSpace: true });
        renderModuleBars(ctx);
        const c = counts(ctx.ovModulesEl.innerHTML);
        expect(ctx.ovModulesEl.innerHTML.match(/mod-progress/g)!.length).toBe(MODULES.length);
        // 私有模块恒为「无权限」（Diaries / Friends / Favorites）
        expect(c['无权限']).toBe(3);
        // 勾选的非私有模块 → 未开始
        expect(c['未开始']).toBe(2);
        // 未勾选的非私有模块（Blogs/Videos/Boards/Visitors/Shares）→ 未选择
        expect(c['未选择']).toBe(MODULES.length - 3 - 2);
    });

    it('已开始模块：走真实进度条（不显示未开始/未选择/无权限占位标识）', () => {
        const map = new Map<string, ModState>([
            ['Messages', { status: 'active', phases: { list: { done: 50, total: 100 } } }],
        ]);
        const ctx = fakeCtx({ moduleMap: map, selectedModules: ['Messages', 'Blogs'], isOtherSpace: false });
        renderModuleBars(ctx);
        const c = counts(ctx.ovModulesEl.innerHTML);
        expect(c['进行中']).toBe(1); // Messages 真实进度
        expect(c['未开始']).toBe(1); // Blogs 选中未开始
        expect(c['未选择']).toBe(MODULES.length - 2); // 其他未勾选
        expect(ctx.ovModulesEl.innerHTML).toContain('50%');
    });

    it('selectedModules 缺省（旧调用方）：退化为全部选中，不误标「未选择」', () => {
        const ctx = fakeCtx({ isOtherSpace: false }); // 无 selectedModules
        renderModuleBars(ctx);
        const c = counts(ctx.ovModulesEl.innerHTML);
        // 全模块标「未开始」，无「未选择」
        expect(c['未开始']).toBe(MODULES.length);
        expect(c['未选择']).toBeUndefined();
    });
});

describe('buildModulePlaceholder 三类占位条', () => {
    it('idle / unselected / noperm 各自带对应状态徽标与提示', () => {
        const idle = buildModulePlaceholder('Messages', 'idle');
        const unsel = buildModulePlaceholder('Blogs', 'unselected');
        const noPerm = buildModulePlaceholder('Diaries', 'noperm');
        expect(idle).toContain('stg-idle');
        expect(idle).toContain('未开始');
        expect(unsel).toContain('stg-unselected');
        expect(unsel).toContain('未选择');
        // 注：未选择模块不再叠加「本次未勾选」内联提示（与徽章重复），仅保留「未选择」徽章
        expect(noPerm).toContain('stg-noperm');
        expect(noPerm).toContain('无权限');
        expect(noPerm).toContain('仅自己空间可备份');
    });
});
