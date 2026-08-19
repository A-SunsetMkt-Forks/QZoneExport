/**
 * 通知聚合管理器。
 *
 * 替代 panel-status / panel-error / panel-stage 三条互相竞争的提示线，
 * 改为「主状态行」（由 api.ts 直写 DOM）+「通知区」（由此模块管理）。
 *
 * 特性：
 *  - 三级通知（P0 阻塞 / P1 需关注 / P2 操作反馈）
 *  - 同类文本去重（相同 text 只留最新）
 *  - 最多可见 2 条（超出则 P2 先被推掉）
 *  - P2 通知 5s 自动消失；P0 / P1 必须手动关闭或由状态恢复清除
 *  - 纯数据模型，不碰 DOM —— 渲染由 api.ts 的 scheduleRender 驱动
 */

export type NoticeLevel = 'p0' | 'p1' | 'p2';

export interface NoticeAction {
    /** 按钮文案（如 "重试失败"、"打包下载"） */
    label: string;
    /** 事件 key（如 "retry-failed"、"download-zip"、"view-logs"、"dismiss"） */
    action: string;
}

export interface Notice {
    id: string;
    level: NoticeLevel;
    text: string;
    actions?: NoticeAction[];
    createdAt: number;
}

const AUTO_DISMISS_P2_MS = 5000;
const MAX_VISIBLE = 2;

export function createNoticeManager() {
    const items: Notice[] = [];

    /** 添加/替换通知。相同 text 的去重（更新时间，不堆叠） */
    function add(notice: Omit<Notice, 'createdAt'>): void {
        const existing = items.find(n => n.text === notice.text);
        if (existing) {
            existing.createdAt = Date.now();
            existing.actions = notice.actions;
            if (existing.level !== notice.level) {
                // level 变化通常意味着状态变化（P2→P1 或反之），允许升级
                (existing as { level: NoticeLevel }).level = notice.level;
            }
            return;
        }
        items.unshift({ ...notice, createdAt: Date.now() });
    }

    /** 按 id 移除 */
    function dismiss(id: string): void {
        for (let i = items.length - 1; i >= 0; i--) {
            const n = items[i]; if (!n) continue;
            if (n.id === id) { items.splice(i, 1); return; }
        }
    }

    /** 批量移除某个级别的通知（如恢复下载后清掉所有暂停相关 P2） */
    function dismissLevel(level: NoticeLevel): void {
        for (let i = items.length - 1; i >= 0; i--) {
            const n = items[i]; if (!n) continue;
            if (n.level === level) items.splice(i, 1);
        }
    }

    /** 返回当前应可见的通知列表（≤2 条，P2 超时自动剔除） */
    function getVisible(): Notice[] {
        const threshold = Date.now() - AUTO_DISMISS_P2_MS;
        for (let i = items.length - 1; i >= 0; i--) {
            const n = items[i]; if (!n) continue;
            if (n.level === 'p2' && n.createdAt < threshold) {
                items.splice(i, 1);
            }
        }
        return items.slice(0, MAX_VISIBLE);
    }

    return { items, add, dismiss, dismissLevel, getVisible };
}

export type NoticeManager = ReturnType<typeof createNoticeManager>;

/**
 * 渲染通知到 DOM 容器。
 *
 * 约定：容器应提前清空（由调用方在 rAF 中控制），
 * 每条通知渲染为 `.notice .notice-{level}`，操作按钮为 `.notice-btn`。
 * 按钮点击委托给容器的事件代理（api.ts 中绑定）。
 */
export function renderNoticeHTML(notice: Notice): string {
    const actionsHtml = notice.actions && notice.actions.length
        ? ' ' + notice.actions.map(a =>
            `<button class="notice-btn" data-notice-id="${notice.id}" data-notice-action="${a.action}">${a.label}</button>`
        ).join('')
        : '';
    return `<div class="notice notice-${notice.level}" data-notice-id="${notice.id}">
        <span class="notice-text">${notice.text}</span>
        ${actionsHtml}
        <button class="notice-btn notice-close" data-notice-id="${notice.id}" data-notice-action="dismiss" title="关闭">×</button>
    </div>`;
}
