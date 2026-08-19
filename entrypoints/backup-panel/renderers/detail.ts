/**
 * 采集明细 Tab 渲染器：读取 PageLedger 的页级账本（经 __QZ_ENGINE__.getDetailMgr()），
 * 展示每个分页模块「哪一页成功 / 失败 / 丢失 / 死页」，供手动断点补偿前核对。
 *
 * 与 media.ts 同为表格 + 分页 + 筛选，但数据源是账本（非 DM 任务），且只读不写。
 */

import { getModuleLabel } from '../../../core/shared/backup-options';
import { escapeHtml, escapeAttr, syncModuleFilterOptions } from '../utils';
import { clampPage, buildPageButtons } from './media';
import type { PanelContext } from '../context';
import type { PageRecord } from '../../../core/collector/reliability';

/** 取 __QZ_ENGINE__ 暴露的明细聚合器（只读账本） */
function getDetailMgr(): { pagesSorted: () => Promise<PageRecord[]> } | null {
    const eng = (window as any).__QZ_ENGINE__;
    if (eng && typeof eng.getDetailMgr === 'function') return eng.getDetailMgr();
    return null;
}

/** 更新明细页签 badge：总页数，若有失败/丢失/死页则标红 */
function applyDetailBadge(ctx: PanelContext, pages: PageRecord[]): void {
    if (!ctx.cDetail) return;
    ctx.cDetail.textContent = String(pages.length);
    const hasIssues = pages.some((p) => p.state === 'failed' || p.state === 'missing' || p.state === 'dead');
    ctx.cDetail.classList.toggle('has-issues', hasIssues);
}

/** 异步刷新 badge（用于非激活页签也能随进度更新计数） */
export async function updateDetailBadge(ctx: PanelContext): Promise<void> {
    const mgr = getDetailMgr();
    if (!mgr || typeof mgr.pagesSorted !== 'function') {
        applyDetailBadge(ctx, []);
        return;
    }
    let pages: PageRecord[] = [];
    try {
        pages = await mgr.pagesSorted();
    } catch {
        pages = [];
    }
    applyDetailBadge(ctx, pages);
}

function stateClass(s: string): string {
    switch (s) {
        case 'success': return 'ok';
        case 'failed': return 'fail';
        case 'missing': return 'fail';
        case 'dead': return 'fail';
        default: return 'pending';
    }
}

function stateLabel(s: string): string {
    switch (s) {
        case 'success': return '成功';
        case 'failed': return '失败';
        case 'missing': return '丢失';
        case 'dead': return '死页';
        case 'fetching': return '采集中';
        default: return s;
    }
}

/**
 * 明细状态筛选匹配。
 * 「失败」页签合并了 failed + missing：二者都是「这一页没拿全、可重试补救」的异常，
 * 操作路径一致（都走「重试失败页」按钮），具体是报错还是截断由明细表的「实采/期望」与
 * 「错误信息」两列呈现，无需单独成 tab。其余状态（success/dead/fetching）一对一。
 */
function matchesStateFilter(state: string, filter: string): boolean {
    if (filter === 'all') return true;
    if (filter === 'failed') return state === 'failed' || state === 'missing';
    return state === filter;
}

/**
 * 明细表「模块」列的可读标签：
 * 相册模块记账键为 `Photos:<albumId>`，原始键对用户无意义；若记录带 title 则显示「相册：{相册名}」，
 * 否则回退到 getModuleLabel（普通模块名）/ 原始键。
 */
function detailModuleLabel(p: PageRecord): string {
    if (p.title && p.module.startsWith('Photos:')) {
        return '相册：' + p.title;
    }
    return getModuleLabel(p.module) || p.module;
}

/** 渲染采集明细表格（异步读取账本，按筛选条件过滤后分页展示） */
export async function renderDetailGrid(ctx: PanelContext): Promise<void> {
    const mgr = getDetailMgr();
    if (!mgr || typeof mgr.pagesSorted !== 'function') {
        ctx.detailTbody.innerHTML = '<tr><td colspan="7"><div class="empty-hint">采集明细暂不可用<br>请先开始一次备份</div></td></tr>';
        ctx.detailPageInfo.textContent = '-';
        ctx.detailPageButtons.innerHTML = '';
        applyDetailBadge(ctx, []);
        return;
    }

    let pages: PageRecord[] = [];
    try {
        pages = await mgr.pagesSorted();
    } catch {
        pages = [];
    }

    applyDetailBadge(ctx, pages);

    // 同步「按模块筛选」下拉（基于全部页记录中的模块集合）
    const distinctMods = Array.from(new Set(pages.map((p) => p.module).filter(Boolean))) as string[];
    // 相册模块键 `Photos:<albumId>` 在下拉里也显示可读名（值仍用原始键，保证筛选正确）
    const moduleLabels: Record<string, string> = {};
    for (const p of pages) {
        const label = detailModuleLabel(p);
        if (label !== p.module) moduleLabels[p.module] = label;
    }
    ctx.detailModuleFilter = syncModuleFilterOptions(ctx.detailModuleFilterSel, ctx.detailModuleFilter, distinctMods, moduleLabels);

    // 过滤
    let all = pages.filter((p) => matchesStateFilter(p.state, ctx.detailStateFilter));
    if (ctx.detailModuleFilter !== 'all') all = all.filter((p) => (p.module || '') === ctx.detailModuleFilter);
    if (ctx.detailKeyword) {
        const kw = ctx.detailKeyword.toLowerCase();
        all = all.filter((p) => (p.module + ' ' + (p.lastError || '')).toLowerCase().includes(kw));
    }

    if (all.length === 0) {
        ctx.detailTbody.innerHTML = '<tr><td colspan="7"><div class="empty-hint">当前筛选条件下暂无页记录</div></td></tr>';
        ctx.detailPageInfo.innerHTML = `筛选后共 <b>0</b> / 总 <b>${pages.length}</b> 页`;
        ctx.detailPageButtons.innerHTML = '';
        return;
    }

    const totalPages = Math.max(1, Math.ceil(all.length / ctx.detailPageSizeVal));
    ctx.detailCurrentPage = clampPage(ctx.detailCurrentPage, totalPages);
    const startIdx = (ctx.detailCurrentPage - 1) * ctx.detailPageSizeVal;
    const endIdx = Math.min(ctx.detailCurrentPage * ctx.detailPageSizeVal, all.length);
    const slice = all.slice(startIdx, endIdx);

    ctx.detailTbody.innerHTML = slice.map((p) => {
        const modLabel = detailModuleLabel(p);
        const time = p.fetchedAt ? new Date(p.fetchedAt).toLocaleString() : '-';
        const ratio = p.expectedCount > 0 ? `${p.itemCount} / ${p.expectedCount}` : String(p.itemCount);
        const err = p.lastError
            ? `<span class="f-err" title="${escapeAttr(p.lastError)}"><b>原因：</b>${escapeHtml(p.lastError)}</span>`
            : '';
        return `<tr data-module="${escapeAttr(p.module)}" data-page="${p.pageIndex}">
            <td>${escapeHtml(modLabel)}</td>
            <td>第 ${p.pageIndex + 1} 页</td>
            <td><span class="state-chip ${stateClass(p.state)}"><span class="dot"></span>${stateLabel(p.state)}</span></td>
            <td>${ratio}</td>
            <td>${p.retryCount}</td>
            <td>${escapeHtml(time)}</td>
            <td class="cell-name">${err}</td>
        </tr>`;
    }).join('');

    ctx.detailPageInfo.innerHTML = `第 <b>${ctx.detailCurrentPage}</b>/${totalPages} 页 · 筛选后 <b>${all.length}</b> / 总 <b>${pages.length}</b> 页`;
    ctx.detailPageButtons.innerHTML = buildPageButtons(ctx.detailCurrentPage, totalPages);
    bindDetailPageButtons(ctx, totalPages);
}

/** 绑定分页按钮（跳页：重渲染明细） */
function bindDetailPageButtons(ctx: PanelContext, totalPages: number): void {
    ctx.detailPageButtons.querySelectorAll('button[data-page]').forEach((btn) => {
        (btn as HTMLElement).onclick = () => {
            const p = Number((btn as HTMLElement).getAttribute('data-page'));
            if (!Number.isFinite(p) || p < 1) return;
            ctx.detailCurrentPage = clampPage(p, totalPages);
            void renderDetailGrid(ctx);
        };
    });
}
