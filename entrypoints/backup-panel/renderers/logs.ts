/**
 * 日志 Tab 渲染器
 */

import { getDM } from '../dm';
import { escapeHtml } from '../utils';
import type { PanelContext } from '../context';

/** 渲染日志列表（斜 300 条 + 自动滚到底） */
export function renderLogs(ctx: PanelContext): void {
    const dm = getDM();
    if (!dm || typeof dm.logs !== 'function') {
        ctx.logList.innerHTML = '<div style="color:#64748b;">日志将在这里展示…</div>';
        ctx.cLog.textContent = '0';
        return;
    }
    const rawLogs = dm.logs() as any;
    let all: any[] = Array.isArray(rawLogs) ? rawLogs : [];
    if (!Array.isArray(rawLogs) && rawLogs && typeof rawLogs === 'object' && Array.isArray(rawLogs.items)) {
        all = rawLogs.items;
    }
    if (ctx.levFilter !== 'ALL') all = all.filter((l: any) => (l && l.level) === ctx.levFilter);
    if (ctx.logKeyword) all = all.filter((l: any) => String((l && l.message) || '').toLowerCase().includes(ctx.logKeyword));
    ctx.cLog.textContent = String(all.length);
    const slice = all.slice(-300);
    if (slice.length === 0) {
        ctx.logList.innerHTML = '<div style="color:#64748b;">暂无日志</div>';
        return;
    }
    ctx.logList.innerHTML = slice.map(l => {
        const ts = (l && l.ts) || Date.now();
        const t = new Date(ts);
        const hh = String(t.getHours()).padStart(2, '0');
        const mm = String(t.getMinutes()).padStart(2, '0');
        const ss = String(t.getSeconds()).padStart(2, '0');
        const lev = String((l && l.level) || 'INFO');
        const msg = String((l && l.message) || '');
        return `<div class="log-row"><span class="log-time">${hh}:${mm}:${ss}</span><span class="log-lev ${lev}">${lev}</span><span class="log-msg">${escapeHtml(msg)}</span></div>`;
    }).join('');
    requestAnimationFrame(() => { ctx.logList.scrollTop = ctx.logList.scrollHeight; });
}
