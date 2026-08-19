/**
 * 备份面板「概览」页签布局回归护栏。
 *
 * 背景：概览页签是 `display:flex; flex-direction:column; overflow:hidden` 的定高容器
 * （.panel 定高 88vh → .panels → .tab-panel absolute inset:0）。历史上多次出现
 * 「TOP3 正在下载列表完全空白」的回归，根因始终是同一个 flex 陷阱：
 *
 *   给模块区写 `flex: 1`（= grow 1 / shrink 1 / **basis 0**）时，它的收缩权重
 *   `shrink × basis = 1 × 0 = 0`，内容溢出时它一点都不让；全部溢出量被甩给排在
 *   后面的 .ov-section--top3，把 TOP3 压成 0 高度，被父级 overflow:hidden 裁掉，
 *   表现为「连空态文案都看不见」。
 *
 * 因此这里把三条关键约束固化成断言，避免后续调布局时再次踩坑。
 */
import { describe, it, expect } from 'vitest';
import { STYLES } from '../entrypoints/backup-panel/styles';

/** 取出某个选择器的声明块（只匹配顶层的 `selector { ... }`） */
function ruleOf(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(STYLES);
    return (m && m[1]) || '';
}

describe('backup-panel 概览页签布局约束', () => {
    it('TOP3 区块必须 flex: 0 0 auto —— 任何情况下都不允许被挤压', () => {
        const rule = ruleOf('.ov-section--top3');
        expect(rule, '缺少 .ov-section--top3 规则').not.toBe('');
        expect(rule.replace(/\s+/g, ' ')).toMatch(/flex:\s*0\s+0\s+auto/);
    });

    it('模块区不得使用裸 flex:1（basis 为 0 会把溢出量全部甩给 TOP3）', () => {
        const rule = ruleOf('.ov-section--modules');
        expect(rule, '缺少 .ov-section--modules 规则').not.toBe('');
        const flat = rule.replace(/\s+/g, ' ');
        // 不变量：basis 必须是 auto（绝不退化成 basis:0 的裸 flex:1，否则溢出量全甩给 TOP3）。
        // grow 可为 0（不主动拉伸填满，避免模块区与 TOP3 间出现大片空白）或 1（拉伸填满），二者均安全。
        // shrink 可为 0（由 .tab-panel[data-panel="ov"] 的 overflow-y:auto 在 Tab 层面整体滚动，不会压模块区）
        //   或 1（模块区自身吸收溢出），二者均安全——唯独 basis:0 的裸 flex:1 会被下方断言拒掉。
        expect(flat).toMatch(/flex:\s*[01]\s+[01]\s+auto/);
        // 禁止退化回 `flex: 1;`
        expect(flat).not.toMatch(/flex:\s*1\s*;/);
    });

    it('概览内固定区块（目录 CTA / 全局进度）不参与收缩', () => {
        expect(ruleOf('.dir-cta').replace(/\s+/g, ' ')).toMatch(/flex:\s*none/);
        expect(ruleOf('.ov-global').replace(/\s+/g, ' ')).toMatch(/flex:\s*none/);
    });

    it('TOP3 空态与满态占位高度一致，避免任务进出时高度跳动', () => {
        expect(ruleOf('.ov-top3').replace(/\s+/g, ' ')).toMatch(/min-height:\s*90px/);
        expect(ruleOf('.top3-empty').replace(/\s+/g, ' ')).toMatch(/min-height:\s*90px/);
    });

    it('.panel 保持定高 88vh —— 媒体分页栏可见性依赖这条确定高度链', () => {
        expect(ruleOf('.panel').replace(/\s+/g, ' ')).toMatch(/height:\s*88vh/);
    });
});
