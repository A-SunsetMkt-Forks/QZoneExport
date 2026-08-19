/**
 * 通知管理器 + 术语一致性回归测试
 *
 * 覆盖：
 *  - NoticeManager add/dismiss/dismissLevel/getVisible（纯数据，不涉 DOM）
 *  - 去重 / 合并 / 限 2 条 / P2 自动消失 / P0 不自动消失
 *  - 渲染 HTML 包含 data 属性用于事件代理
 *  - STATE_LABEL 词汇完整性（无遗漏状态）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createNoticeManager, renderNoticeHTML } from '../entrypoints/backup-panel/notices';
import { STATE_LABEL, STATE_COLOR, MODULE_STATUS_LABEL } from '../entrypoints/backup-panel/constants';
import type { NoticeManager } from '../entrypoints/backup-panel/notices';

let mgr: NoticeManager;
beforeEach(() => { mgr = createNoticeManager(); });

function n(text: string, level: 'p0' | 'p1' | 'p2' = 'p1'): { id: string; level: typeof level; text: string } {
    return { id: 'n-' + text, level, text };
}

/* ===== NoticeManager 纯数据 ===== */

describe('NoticeManager 去重与合并', () => {
    it('相同 text 不堆叠，更新时间', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        mgr.add(n('网络错误'));
        vi.setSystemTime(1005000);
        mgr.add(n('网络错误'));
        expect(mgr.getVisible()).toHaveLength(1);
        expect(mgr.getVisible()[0]!.createdAt).toBe(1005000);
        vi.useRealTimers();
    });

    it('不同 text 分别保留', () => {
        mgr.add(n('下载失败'));
        mgr.add(n('请求重试中'));
        expect(mgr.getVisible()).toHaveLength(2);
    });

    it('相同 text 但 level 升级（P2→P1）时保留最新 level', () => {
        vi.useFakeTimers({ now: 1000000 });
        mgr.add(n('操作未生效', 'p2'));
        mgr.add(n('操作未生效', 'p1'));
        expect(mgr.getVisible()[0]!.level).toBe('p1');
        vi.useRealTimers();
    });
});

describe('NoticeManager.上限', () => {
    it('超出 2 条时只返回最新 2 条', () => {
        mgr.add(n('A'));
        mgr.add(n('B'));
        mgr.add(n('C'));
        const v = mgr.getVisible();
        expect(v).toHaveLength(2);
        expect(v[0]!.text).toBe('C');
        expect(v[1]!.text).toBe('B');
    });

    it('dismiss 后腾出空位', () => {
        mgr.add(n('A'));
        mgr.add(n('B'));
        mgr.add(n('C'));
        mgr.dismiss(mgr.getVisible()[0]!.id);
        // A/B still in items, C dismissed
        const v = mgr.getVisible();
        expect(v).toHaveLength(2);
    });
});

describe('NoticeManager.autoDismiss', () => {
    it('P2 5 秒后自动消失', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        mgr.add(n('操作完成', 'p2'));
        expect(mgr.getVisible()).toHaveLength(1);
        vi.setSystemTime(1005001);
        expect(mgr.getVisible()).toHaveLength(0);
        vi.useRealTimers();
    });

    it('P1 不自动消失', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        mgr.add(n('下载失败', 'p1'));
        vi.setSystemTime(1010000);
        expect(mgr.getVisible()).toHaveLength(1);
        vi.useRealTimers();
    });

    it('P0 不自动消失', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        mgr.add(n('备份异常', 'p0'));
        vi.setSystemTime(1100000);
        expect(mgr.getVisible()).toHaveLength(1);
        vi.useRealTimers();
    });
});

describe('NoticeManager.dismissLevel', () => {
    it('清理整级通知', () => {
        mgr.add(n('A', 'p1'));
        mgr.add(n('B', 'p1'));
        mgr.add(n('C', 'p2'));
        mgr.dismissLevel('p1');
        const v = mgr.getVisible();
        expect(v).toHaveLength(1);
        expect(v[0]!.text).toBe('C');
    });
});

/* ===== renderNoticeHTML 输出 ===== */

describe('renderNoticeHTML', () => {
    it('无 actions 时不渲染按钮组', () => {
        const html = renderNoticeHTML({ id: 'n1', level: 'p1', text: '错误', createdAt: 0 });
        expect(html).toContain('notice-text');
        expect(html).not.toContain('notice-btn">重试');
    });

    it('actions 渲染为 data 属性按钮（委托点击）', () => {
        const html = renderNoticeHTML({
            id: 'n-fail', level: 'p1', text: '3 个下载失败', createdAt: 0,
            actions: [{ label: '重试失败', action: 'retry-failed' }],
        });
        expect(html).toContain('data-notice-id="n-fail"');
        expect(html).toContain('data-notice-action="retry-failed"');
        expect(html).toContain('重试失败');
    });

    it('始终带关闭按钮', () => {
        const html = renderNoticeHTML({ id: 'x', level: 'p2', text: 'info', createdAt: 0 });
        expect(html).toContain('data-notice-action="dismiss"');
    });
});

/* ===== 术语完整性 ===== */

describe('统一词汇表完整性', () => {
    it('STATE_LABEL 覆盖所有 6 个核心状态', () => {
        const keys = ['pending', 'in_progress', 'paused', 'complete', 'interrupted', 'error'];
        for (const k of keys) expect(STATE_LABEL[k]).toBeTruthy();
    });

    it('STATE_COLOR 与 STATE_LABEL 键名一致', () => {
        const labelKeys = Object.keys(STATE_LABEL);
        for (const k of labelKeys) expect(STATE_COLOR[k]).toBeTruthy();
    });

    it('MODULE_STATUS_LABEL 覆盖全部模块状态（含未选择/无权限）', () => {
        const keys = ['idle', 'active', 'done', 'fail', 'unselected', 'noperm'];
        for (const k of keys) expect(MODULE_STATUS_LABEL[k]).toBeTruthy();
    });

    it('模块状态标签语义不重复（待开始≠待下载）', () => {
        expect(MODULE_STATUS_LABEL.idle).not.toBe(STATE_LABEL.pending);
    });
});
