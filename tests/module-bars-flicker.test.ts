// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';

// 模拟 getDM（overview.ts 内部取媒体进度快照用），便于在测试中注入逐帧变化的媒体进度
let currentMediaByModule: Record<string, { overallPercent: number; totalTasks: number }> | null = null;
vi.mock('../entrypoints/backup-panel/dm', () => ({
    getDM: () => ({ moduleProgressMap: () => currentMediaByModule }),
}));

import { renderModuleBars } from '../entrypoints/backup-panel/renderers/overview';
import type { ModState } from '../entrypoints/backup-panel/context';

function makeCtx(): any {
    const container = document.createElement('div');
    container.id = 'ov-modules';
    return {
        ovModulesEl: container,
        moduleMap: new Map<string, ModState>(),
        selectedModules: ['Photos'],
    };
}

describe('模块进度条在媒体下载期间不重建（消灭闪烁）', () => {
    it('媒体进度逐帧抖动 + 快照间隙时，节点身份保持不变且 className 恒为 active，直至真正 settle', () => {
        const ctx = makeCtx();
        const st: ModState = { status: 'done', phases: { collect: { done: 100, total: 100 } } };
        ctx.moduleMap.set('Photos', st);

        // 逐帧模拟：overallPercent 在 96~99 间抖动（任务边界常见），偶尔整帧缺失（快照间隙）
        const frames: (Record<string, { overallPercent: number; totalTasks: number }> | null)[] = [
            { Photos: { overallPercent: 96, totalTasks: 5 } },
            { Photos: { overallPercent: 99, totalTasks: 5 } },
            null, // 快照间隙
            { Photos: { overallPercent: 97, totalTasks: 5 } },
            { Photos: { overallPercent: 99, totalTasks: 5 } },
            null,
            { Photos: { overallPercent: 98, totalTasks: 5 } },
        ];

        // 首帧建立节点
        currentMediaByModule = frames[0]!;
        renderModuleBars(ctx);
        const node0 = ctx.ovModulesEl.querySelector('.mod-progress[data-mod="Photos"]') as HTMLElement;
        expect(node0).toBeTruthy();
        expect(node0.className).toBe('mod-progress done');

        // 后续帧：节点身份必须保持（说明没有 replaceChild 重建 → 不会「丢失又出现」），
        // 且蓝色段宽度单调不回退（媒体进度只增不减，杜绝「忽隐忽现」闪烁）。
        const fillEl = node0.querySelector('.fill') as HTMLElement;
        let lastWidth = parseFloat(fillEl.style.width) || 0;
        for (let i = 1; i < frames.length; i++) {
            currentMediaByModule = frames[i] ?? null;
            renderModuleBars(ctx);
            const node = ctx.ovModulesEl.querySelector('.mod-progress[data-mod="Photos"]') as HTMLElement;
            expect(node).toBe(node0); // 同一节点 → 仅就地更新宽度/文本
            expect(node.className).toBe('mod-progress done'); // 条保持 done，不翻 active
            const w = parseFloat((node.querySelector('.fill') as HTMLElement).style.width) || 0;
            expect(w).toBeGreaterThanOrEqual(lastWidth); // 宽度只增不减
            lastWidth = w;
        }

        // 真正的 settle：overallPercent 到 100 → 一次性转 done，且之后间隙不回退
        currentMediaByModule = { Photos: { overallPercent: 100, totalTasks: 5 } };
        renderModuleBars(ctx);
        expect(ctx.ovModulesEl.querySelector('.mod-progress[data-mod="Photos"]')).toBe(node0);
        expect(node0.className).toBe('mod-progress done');

        currentMediaByModule = null; // settle 后间隙
        renderModuleBars(ctx);
        expect(ctx.ovModulesEl.querySelector('.mod-progress[data-mod="Photos"]')).toBe(node0);
        expect(node0.className).toBe('mod-progress done'); // 不回退成 active
    });

    it('多模块同时处于「下载中」时，任一模块的瞬时抖动都不应引发其它模块的节点重建', () => {
        const ctx = makeCtx();
        ctx.selectedModules = ['Photos', 'Videos', 'Boards'];
        for (const m of ['Photos', 'Videos', 'Boards']) {
            ctx.moduleMap.set(m, { status: 'done', phases: { collect: { done: 100, total: 100 } } } as ModState);
        }

        const base: Record<string, { overallPercent: number; totalTasks: number }> = {
            Photos: { overallPercent: 90, totalTasks: 5 },
            Videos: { overallPercent: 80, totalTasks: 5 },
            Boards: { overallPercent: 70, totalTasks: 5 },
        };
        const snap = () => JSON.parse(JSON.stringify(base));

        currentMediaByModule = snap();
        renderModuleBars(ctx);
        const nodes: Record<string, HTMLElement> = {};
        for (const m of ['Photos', 'Videos', 'Boards']) {
            nodes[m] = ctx.ovModulesEl.querySelector(`.mod-progress[data-mod="${m}"]`) as HTMLElement;
            expect(nodes[m].className).toBe('mod-progress done');
        }

        // 抖动 10 帧：只让 Photos 的进度在 99 附近跳变，其余不变
        for (let f = 0; f < 10; f++) {
            const s = snap();
            s.Photos.overallPercent = f % 2 === 0 ? 99 : 98; // 抖动但不真正 settle
            currentMediaByModule = s;
            renderModuleBars(ctx);
            for (const m of ['Photos', 'Videos', 'Boards']) {
                const node = ctx.ovModulesEl.querySelector(`.mod-progress[data-mod="${m}"]`) as HTMLElement;
                expect(node).toBe(nodes[m]); // 三个模块节点身份全部保持
                expect(node.className).toBe('mod-progress done');
            }
        }
    });

    it('逐批添加任务：活跃期媒体瞬时 100% 不锁定，采集完成后才按真实状态显示「媒体下载中」', () => {
        const ctx = makeCtx();
        const st: ModState = { status: 'active', phases: { albums: { done: 1, total: 2 } } };
        ctx.moduleMap.set('Photos', st);

        // 活跃期：第一批相册任务已下完，但下一批任务还没添加（overallPercent 瞬时 100%）。
        // 此时不能永久锁定 mediaSettled，否则后续新任务加入后会一直显示「成功」。
        currentMediaByModule = { Photos: { overallPercent: 100, totalTasks: 2 } };
        renderModuleBars(ctx);
        const midSt = ctx.moduleMap.get('Photos')!;
        expect(midSt.hasMediaTasks).toBe(true);
        expect(midSt.mediaSettled).not.toBe(true);

        // 采集完成，但新任务已加入，媒体进度回落到 50%。
        midSt.status = 'done';
        currentMediaByModule = { Photos: { overallPercent: 50, totalTasks: 4 } };
        renderModuleBars(ctx);
        const badge = ctx.ovModulesEl.querySelector('.mod-progress[data-mod="Photos"] .stg') as HTMLElement;
        expect(badge.textContent).toBe('媒体下载中');

        // 最终全部下载完成 → 徽标切回「成功」。
        currentMediaByModule = { Photos: { overallPercent: 100, totalTasks: 4 } };
        renderModuleBars(ctx);
        expect(badge.textContent).toBe('成功');
    });
});
