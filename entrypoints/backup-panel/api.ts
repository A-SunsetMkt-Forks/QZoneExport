/**
 * 备份面板核心：createPanel 工厂函数 + BackupPanelAPI 实现
 *
 * 创建 Shadow DOM 面板实例，提供完整的备份进度可视化、媒体下载监控、
 * 日志查看、确认对话框等功能。
 *
 * v3.1 消息架构重构（2026-08-07）：
 *  - panel-status / panel-error / panel-stage 三行收敛为 Primary Status + Notifications
 *  - 完成信息仅出现在 Completion Banner，不在 status 重复
 *  - 错误/通知走 NoticeManager 聚合（去重、限 2 条、P2 自消）
 *  - 主状态行仅「场景切换」更新，不再每 tick 闪烁
 */

import { getModuleLabel } from '../../core/shared/backup-options';
import { getDM } from './dm';
import { CATEGORY_TIPS, PHASE_NAMES, STATE_LABEL } from './constants';
import { escapeHtml, escapeAttr } from './utils';
import { buildPanelHtml } from './template';
import { renderStats, renderModuleBars, renderOverviewTop3, totalModulesOf } from './renderers/overview';
import { renderMediaGrid, loadMoreMedia } from './renderers/media';
import { renderDetailGrid, updateDetailBadge } from './renderers/detail';
import { renderCompletionBanner } from './renderers/banner';
import { renderLogs } from './renderers/logs';
import { createNoticeManager, renderNoticeHTML } from './notices';
import type { NoticeManager } from './notices';
import type { BackupPanelAPI, PanelAction, PanelEvent, PanelOpenOptions } from './types';
import type { LiveTask, PanelContext, ModState } from './context';

/* ===== 导出主入口 ===== */

export function createPanel(): { host: HTMLElement; api: BackupPanelAPI } {
    const host = document.createElement('div');
    host.id = 'qz-backup-panel';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:none;';

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = buildPanelHtml();

    const $ = (sel: string) => shadow.querySelector(sel) as HTMLElement;
    const $$ = (sel: string) => Array.from(shadow.querySelectorAll(sel) as NodeListOf<HTMLElement>);

    /* ===== 共享 Context ===== */

    const ctx: PanelContext = {
        shadow,
        $,
        $$,
        statusEl: $('.panel-status'),
        notificationsEl: $('#notifications') as HTMLElement,
        bannerEl: $('.panel-banner'),
        footerEl: $('.panel-footer'),
        downloadBtn: $('.btn-download') as HTMLButtonElement,
        closeBtn: $('.btn-close') as HTMLButtonElement,
        headerClose: $('.panel-close') as HTMLButtonElement,

        panelsEl: $('.panels') as HTMLElement,

        sTotal: $('#s-total') as HTMLElement,
        sOk: $('#s-ok') as HTMLElement,
        sRun: $('#s-run') as HTMLElement,
        sFail: $('#s-fail') as HTMLElement,
        sPause: $('#s-pause') as HTMLElement,
        sWait: $('#s-wait') as HTMLElement,

        ovPct: $('#ov-pct') as HTMLElement,
        ovBytes: $('#ov-bytes') as HTMLElement,
        ovSpeed: $('#ov-speed') as HTMLElement,
        ovElapsed: $('#ov-elapsed') as HTMLElement,
        ovFill: $('#ov-fill') as HTMLElement,
        ovFillFail: $('#ov-fill-fail') as HTMLElement,
        ovProgressNote: $('#ov-progress-note') as HTMLElement,
        ovModsTag: $('#ov-mods') as HTMLElement,
        ovModulesEl: $('#ov-modules') as HTMLElement,
        ovTop3: $('#ov-top3') as HTMLElement,
        cOv: $('#c-ov') as HTMLElement,
        cMedia: $('#c-media') as HTMLElement,
        cLog: $('#c-log') as HTMLElement,

        mediaTable: $('#media-table-scroll') as HTMLElement,
        mediaTbody: $('#media-tbody') as HTMLElement,
        mediaChkAll: $('#media-chk-all') as HTMLInputElement,
        mediaPageInfo: $('#media-page-info') as HTMLElement,
        mediaPageSize: $('#media-page-size') as HTMLSelectElement,
        mediaPageButtons: $('#media-page-buttons') as HTMLElement,
        mediaSearch: $('#media-search') as HTMLInputElement,
        stateFilterGroup: $('#state-filter') as HTMLElement,
        typeFilterGroup: $('#type-filter') as HTMLElement,
        mediaSortSel: $('#media-sort') as HTMLSelectElement,
        mediaModuleFilterSel: $('#media-module-filter') as HTMLSelectElement,
        btnPause: $('#btn-pause') as HTMLButtonElement,
        btnResume: $('#btn-resume') as HTMLButtonElement,
        btnRetry: $('#btn-retry') as HTMLButtonElement,
        btnCancel: $('#btn-cancel') as HTMLButtonElement,

        detailTbody: $('#detail-tbody') as HTMLElement,
        detailPageInfo: $('#detail-page-info') as HTMLElement,
        detailPageSize: $('#detail-page-size') as HTMLSelectElement,
        detailPageButtons: $('#detail-page-buttons') as HTMLElement,
        detailSearch: $('#detail-search') as HTMLInputElement,
        detailStateFilterGroup: $('#detail-state-filter') as HTMLElement,
        detailModuleFilterSel: $('#detail-module-filter') as HTMLSelectElement,
        btnRetryDetail: $('#btn-retry-detail') as HTMLButtonElement,
        cDetail: $('#c-detail') as HTMLElement,

        levFilterGroup: $('#lev-filter') as HTMLElement,
        logSearch: $('#log-search') as HTMLInputElement,
        logList: $('#log-list') as HTMLElement,
        btnClearLog: $('#btn-clear-log') as HTMLButtonElement,
        btnExportLogTxt: $('#btn-export-log-txt') as HTMLButtonElement,
        btnExportLogJson: $('#btn-export-log-json') as HTMLButtonElement,

        dirCtaEl: $('#dir-cta') as HTMLElement,
        dirCtaBtn: $('#dir-cta-btn') as HTMLButtonElement,

        currentTab: 'ov',
        stateFilter: 'all',
        mediaTypeFilter: 'all',
        mediaModuleFilter: 'all',
        mediaSort: 'default',
        levFilter: 'ALL',
        mediaKeyword: '',
        logKeyword: '',
        selectedMediaIds: new Set(),
        moduleMap: new Map(),
        mediaCurrentPage: 1,
        mediaPageSizeOpts: [20, 50, 100, 200, 500],
        mediaPageSizeVal: 50,

        detailCurrentPage: 1,
        detailPageSizeOpts: [20, 50, 100, 200],
        detailPageSizeVal: 50,
        detailStateFilter: 'all',
        detailModuleFilter: 'all',
        detailKeyword: '',
        actionCb: null,
        dmUnsubscribe: null,
    };

    /* ===== 通知管理器（聚合去重 · 可消失 · 限 2 条） ===== */

    const notices: NoticeManager = createNoticeManager();
    let _lastStatusText = '';

    /** 将当前可见通知渲染到 DOM */
    function renderNotices(): void {
        if (!ctx.notificationsEl) return;
        const visible = notices.getVisible();
        ctx.notificationsEl.innerHTML = visible.map(renderNoticeHTML).join('');
    }

    /** 便捷：添加一条通知 */
    function addNotice(text: string, level: 'p0' | 'p1' | 'p2', actions?: { label: string; action: string }[]): void {
        notices.add({ id: 'n-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), level, text, actions });
        renderNotices();
    }

    /* ===== 主状态行更新 ===== */

    function setPrimaryStatus(text: string): void {
        if (_lastStatusText === text) return;
        _lastStatusText = text;
        ctx.statusEl.textContent = text;
    }

    /* ===== DM 订阅 ===== */

    // 渲染调度：把高频 DM 事件合并到一帧内
    let _renderRaf = 0;
    const _renderPending = { stats: false, top3: false, media: false, logs: false, notices: false, detail: false };
    function scheduleRender(kind: 'task' | 'stats' | 'log' | 'notice' | 'detail') {
        if (kind === 'task') { _renderPending.stats = true; _renderPending.top3 = true; _renderPending.media = true; }
        else if (kind === 'stats') { _renderPending.stats = true; }
        else if (kind === 'log') { _renderPending.logs = true; }
        else if (kind === 'notice') { _renderPending.notices = true; }
        else if (kind === 'detail') { _renderPending.detail = true; }
        if (_renderRaf) return;
        _renderRaf = requestAnimationFrame(() => {
            _renderRaf = 0;
            if (_renderPending.stats) {
                renderStats(ctx);
                // 媒体下载进度由 DM 驱动，与采集事件解耦：此处一并刷新模块条，
                // 让「采集完成 + 媒体下载中」的模块条随真实下载进度推进（不再卡在 100%）。
                renderModuleBars(ctx);
                maybeFreezeElapsed(); // 媒体全部 settled 时冻结总耗时（下载模式）
                renderCompletionBanner(ctx);
                _renderPending.stats = false;
            }
            if (_renderPending.notices) {
                renderNotices();
                _renderPending.notices = false;
            }
            if (_renderPending.top3) { renderOverviewTop3(ctx); _renderPending.top3 = false; }
            if (_renderPending.logs) { renderLogs(ctx); _renderPending.logs = false; }
            if (_renderPending.media) {
                if (ctx.currentTab === 'media') renderMediaGrid(ctx);
                _renderPending.media = false;
            }
            if (_renderPending.detail) {
                void updateDetailBadge(ctx);
                if (ctx.currentTab === 'detail') void renderDetailGrid(ctx);
                _renderPending.detail = false;
            }
            syncPanelHeight();
        });
    }

    /* ===== 备份总耗时：墙钟计时（含暂停 / 采集 / 媒体下载 / 收尾），实时走字 ===== */
    // 渲染循环是事件驱动（DM 发事件才重绘），备份静默期（如模块间空档）不会重绘，
    // 故用 1s 定时器兜底刷新「已用时」标签；startedAt 未置 / finishedAt 已置 即停。
    // 真正结束点 = 整备全部完成（含媒体下载），见 maybeFreezeElapsed。
    let _elapsedTimer = 0;
    function startElapsedTicker(): void {
        if (_elapsedTimer) return;
        _elapsedTimer = window.setInterval(() => {
            if (ctx.startedAt && !ctx.finishedAt) {
                maybeFreezeElapsed();        // 静默期也检测媒体是否已 settled，及时冻结
                if (!ctx.finishedAt) renderStats(ctx); // 未到真正结束，继续走字
            }
        }, 1000);
    }
    function stopElapsedTicker(): void {
        if (_elapsedTimer) { window.clearInterval(_elapsedTimer); _elapsedTimer = 0; }
    }

    /**
     * 冻结「总耗时 / 已用时」的真实结束点：选目录 → 整备真正完成（含媒体下载）。
     *  - 外链模式 / 无媒体任务：complete() 即结束，直接冻结。
     *  - 下载模式：媒体可能仍在后台跑，必须等 globalProgress().isSettled 为真才冻结，
     *    否则「总耗时」会漏算媒体下载那段最长尾时间（此前冻结在 complete() 仅含采集+收尾）。
     * 幂等：finishedAt 已置则直接返回；冻结时顺手停 1s 兜底定时器并定格「已用时」。
     */
    function maybeFreezeElapsed(): void {
        if (ctx.finishedAt) return;
        if (!ctx.completion) return;
        const link = !!ctx.completion.mediaLinkMode;
        let done: boolean;
        if (link) {
            done = true;
        } else {
            const dm = getDM();
            const gp = (dm && typeof dm.globalProgress === 'function') ? dm.globalProgress() : null;
            done = gp ? !!gp.isSettled : true; // DM 不可用时保守视为已结束
        }
        if (done) {
            ctx.finishedAt = Date.now();
            stopElapsedTicker();
            renderStats(ctx); // 定格「已用时」为最终值
        }
    }

    /* ===== 页签高度：纯 CSS 驱动，无需 JS 写死高度 =====
     * .panel 定高 88vh（确定值）；上方 Header/状态/通知/横幅/页签 flex:0 0 auto；
     * .panels 以 flex:1 1 auto 填充剩余、position:relative；各 .tab-panel 用
     * absolute; inset:0 填满 .panels（取到确定高度，规避 flex 百分比高度陷阱），
     * 内部自行滚动（.media-table-scroll / .log-list / .about-wrap），
     * 分页栏 flex:0 0 auto 钉在底部，不再被裁切。
     * 此处仅清除历史遗留的内联 height/flex，交给 CSS 接管。 */
    let _heightRaf = 0;
    function syncPanelHeight(): void {
        if (!ctx.panelsEl) return;
        ctx.panelsEl.style.height = '';
        ctx.panelsEl.style.flex = '';
        ctx.panelsHeight = 0;
    }
    function scheduleHeightSync(): void {
        if (_heightRaf) return;
        _heightRaf = requestAnimationFrame(() => { _heightRaf = 0; syncPanelHeight(); });
    }
    window.addEventListener('resize', scheduleHeightSync);

    function attachDM() {
        const dm = getDM();
        if (!dm || typeof dm.subscribe !== 'function' || ctx.dmUnsubscribe) return;
        const offs: Array<() => void> = [];
        const offTask = dm.subscribe('task-updated', () => scheduleRender('task'));
        if (offTask) offs.push(offTask);
        const offAdded = dm.subscribe('task-added', () => scheduleRender('task'));
        if (offAdded) offs.push(offAdded);
        const offStats = dm.subscribe('stats', () => scheduleRender('stats'));
        if (offStats) offs.push(offStats);
        const offLog = dm.subscribe('log', () => scheduleRender('log'));
        if (offLog) offs.push(offLog);
        const offErr = dm.subscribe('task-error', (p: any) => {
            const opText = p?.op === 'pause' ? '暂停' : p?.op === 'resume' ? '继续' : '取消';
            addNotice(`「${opText}」操作未生效，请查看日志`, 'p2', [
                { label: '查看日志', action: 'switch-log' },
            ]);
            scheduleRender('notice');
        });
        if (offErr) offs.push(offErr);
        ctx.dmUnsubscribe = () => { offs.forEach((f) => f()); offs.length = 0; ctx.dmUnsubscribe = null; };
        renderStats(ctx);
        renderOverviewTop3(ctx);
        renderMediaGrid(ctx);
        renderLogs(ctx);
    }

    /* ===== 通知区点击委托 ===== */

    ctx.notificationsEl?.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.notice-btn') as HTMLButtonElement | null;
        if (!btn) return;
        const noticeId = btn.dataset.noticeId || '';
        const action = btn.dataset.noticeAction || '';
        if (action === 'dismiss' || !action) {
            notices.dismiss(noticeId);
            renderNotices();
            return;
        }
        if (action === 'retry-failed') {
            const dm = getDM();
            if (dm && dm.retryFailed) { dm.retryFailed(); }
            else if (ctx.actionCb) ctx.actionCb('retry-downloads');
            notices.dismiss(noticeId);
            renderNotices();
            return;
        }
        if (action === 'view-logs' || action === 'switch-log') {
            const logTab = shadow.querySelector('.tab[data-tab="log"]') as HTMLButtonElement | null;
            if (logTab && !logTab.classList.contains('active')) logTab.click();
            return;
        }
        if (action === 'download-zip') {
            if (ctx.actionCb) ctx.actionCb('download-zip');
            return;
        }
    });

    /* ===== Tab 切换 ===== */

    $$('.tab').forEach((t) => {
        t.onclick = () => {
            const name = (t.dataset.tab as any);
            if (!name || name === ctx.currentTab) return;
            ctx.currentTab = name;
            $$('.tab').forEach(x => x.classList.toggle('active', (x.dataset.tab || '') === ctx.currentTab));
            $$('.tab-panel').forEach(x => x.classList.toggle('active', (x.dataset.panel || '') === ctx.currentTab));
            scheduleHeightSync();
            if (name === 'media') renderMediaGrid(ctx);
            else if (name === 'detail') void renderDetailGrid(ctx);
            else if (name === 'log') renderLogs(ctx);
        };
    });

    /* ===== 媒体列表无限滚动 ===== */
    ctx.mediaTable.addEventListener('scroll', () => {
        if (ctx.currentTab !== 'media') return;
        const el = ctx.mediaTable;
        const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 240;
        if (nearBottom) loadMoreMedia(ctx);
    });

    /* ===== 筛选器 ===== */

    ctx.stateFilterGroup.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
        if (!btn || !btn.dataset.state) return;
        ctx.stateFilter = btn.dataset.state;
        ctx.stateFilterGroup.querySelectorAll('button').forEach(b => b.classList.toggle('active', (b as HTMLButtonElement).dataset.state === ctx.stateFilter));
        ctx.mediaCurrentPage = 1;
        renderMediaGrid(ctx);
    });

    ctx.levFilterGroup.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
        if (!btn || !btn.dataset.lev) return;
        ctx.levFilter = btn.dataset.lev as any;
        ctx.levFilterGroup.querySelectorAll('button').forEach(b => b.classList.toggle('active', (b as HTMLButtonElement).dataset.lev === ctx.levFilter));
        renderLogs(ctx);
    });

    ctx.typeFilterGroup.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
        if (!btn || !btn.dataset.type) return;
        ctx.mediaTypeFilter = btn.dataset.type;
        ctx.typeFilterGroup.querySelectorAll('button').forEach(b => b.classList.toggle('active', (b as HTMLButtonElement).dataset.type === ctx.mediaTypeFilter));
        ctx.mediaCurrentPage = 1;
        renderMediaGrid(ctx);
    });

    ctx.mediaModuleFilterSel.addEventListener('change', () => {
        ctx.mediaModuleFilter = ctx.mediaModuleFilterSel.value || 'all';
        ctx.mediaCurrentPage = 1;
        renderMediaGrid(ctx);
    });

    ctx.mediaSortSel.addEventListener('change', () => {
        ctx.mediaSort = ctx.mediaSortSel.value || 'default';
        ctx.mediaCurrentPage = 1;
        renderMediaGrid(ctx);
    });

    let _searchMediaT: any = null;
    ctx.mediaSearch.addEventListener('input', () => {
        clearTimeout(_searchMediaT);
        _searchMediaT = setTimeout(() => { ctx.mediaKeyword = ctx.mediaSearch.value.trim().toLowerCase(); ctx.mediaCurrentPage = 1; renderMediaGrid(ctx); }, 150);
    });

    let _searchLogT: any = null;
    ctx.logSearch.addEventListener('input', () => {
        clearTimeout(_searchLogT);
        _searchLogT = setTimeout(() => { ctx.logKeyword = ctx.logSearch.value.trim().toLowerCase(); renderLogs(ctx); }, 150);
    });

    /* ===== 媒体分页 ===== */

    ctx.mediaPageSize.addEventListener('change', () => {
        const v = Number(ctx.mediaPageSize.value) || 50;
        ctx.mediaPageSizeVal = ctx.mediaPageSizeOpts.includes(v) ? v : 50;
        ctx.mediaCurrentPage = 1;
        renderMediaGrid(ctx);
    });

    ctx.mediaChkAll.addEventListener('change', () => {
        const chks = ctx.mediaTbody.querySelectorAll('input[type="checkbox"].row-chk') as NodeListOf<HTMLInputElement>;
        chks.forEach(c => {
            c.checked = ctx.mediaChkAll.checked;
            const id = c.getAttribute('data-id');
            if (id) {
                if (ctx.mediaChkAll.checked) ctx.selectedMediaIds.add(id); else ctx.selectedMediaIds.delete(id);
                const tr = c.closest('tr');
                if (tr) tr.classList.toggle('selected', ctx.mediaChkAll.checked);
            }
        });
    });

    /* ===== 采集明细：筛选 / 搜索 / 分页 / 重试 ===== */

    ctx.detailStateFilterGroup.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
        if (!btn || !btn.dataset.state) return;
        ctx.detailStateFilter = btn.dataset.state;
        ctx.detailStateFilterGroup.querySelectorAll('button').forEach(b => b.classList.toggle('active', (b as HTMLButtonElement).dataset.state === ctx.detailStateFilter));
        ctx.detailCurrentPage = 1;
        void renderDetailGrid(ctx);
    });

    ctx.detailModuleFilterSel.addEventListener('change', () => {
        ctx.detailModuleFilter = ctx.detailModuleFilterSel.value || 'all';
        ctx.detailCurrentPage = 1;
        void renderDetailGrid(ctx);
    });

    let _searchDetailT: any = null;
    ctx.detailSearch.addEventListener('input', () => {
        clearTimeout(_searchDetailT);
        _searchDetailT = setTimeout(() => { ctx.detailKeyword = ctx.detailSearch.value.trim().toLowerCase(); ctx.detailCurrentPage = 1; void renderDetailGrid(ctx); }, 150);
    });

    ctx.detailPageSize.addEventListener('change', () => {
        const v = Number(ctx.detailPageSize.value) || 50;
        ctx.detailPageSizeVal = ctx.detailPageSizeOpts.includes(v) ? v : 50;
        ctx.detailCurrentPage = 1;
        void renderDetailGrid(ctx);
    });

    ctx.btnRetryDetail.onclick = async () => {
        const eng = (window as any).__QZ_ENGINE__;
        if (!eng || typeof eng.retryFailedPages !== 'function') {
            await api.alert('备份引擎尚未初始化，无法重试失败页（请先运行一次备份）。');
            return;
        }
        if (ctx.btnRetryDetail.disabled) return;
        ctx.btnRetryDetail.disabled = true;

        // 重试是「重新采集」而非新一轮完整备份：清掉上一轮遗留的完成态/完成横幅，回到运行态，
        // 避免「进度条/明细正在采，顶部却仍显示『备份完成』」的矛盾（retryFailedPages 不触发 complete()）。
        ctx.completion = undefined;
        ctx.finalizing = false;
        ctx.bannerEl.className = 'panel-banner';
        ctx.bannerEl.textContent = '';
        ctx.finishedAt = undefined;
        setPrimaryStatus('正在重新采集失败页…');
        startElapsedTicker();

        try {
            await eng.retryFailedPages(undefined, undefined);
            addNotice('已提交重试：仅重新采集有失败页的模块，无失败页的模块会自动跳过', 'p2');
        } catch (err: any) {
            addNotice('重试失败页失败：' + (err?.message || String(err)), 'p1', [
                { label: '查看日志', action: 'switch-log' },
            ]);
        } finally {
            ctx.btnRetryDetail.disabled = false;
            // 重试结束后定格「已用时」、停掉兜底定时器；完成横幅不再重出，
            // 完成态由模块条 + 顶部总进度体现。
            ctx.finishedAt = Date.now();
            stopElapsedTicker();
            setPrimaryStatus('');
            // 重试是异步重采，稍后刷新明细（期间 progress 事件也会驱动刷新）
            setTimeout(() => { if (ctx.currentTab === 'detail') void renderDetailGrid(ctx); }, 1800);
        }
    };

    /* ===== 批量操作 ===== */

    ctx.btnPause.onclick = async () => {
        const dm = getDM();
        if (ctx.selectedMediaIds.size > 0) {
            await Promise.all(Array.from(ctx.selectedMediaIds).map(id => dm && dm.pauseTask && dm.pauseTask(id)));
        } else if (dm && dm.pauseAll) {
            await dm.pauseAll();
        }
    };

    ctx.btnResume.onclick = async () => {
        const dm = getDM();
        if (ctx.selectedMediaIds.size > 0) {
            await Promise.all(Array.from(ctx.selectedMediaIds).map(id => dm && dm.resumeTask && dm.resumeTask(id)));
        } else if (dm && dm.resumeAll) {
            await dm.resumeAll();
        }
    };

    ctx.btnRetry.onclick = async () => {
        const dm = getDM();
        if (dm && dm.retryFailed) {
            // 点击期间禁用按钮，避免人工反复点击导致同一批失败任务被多次 re-pend（_manager 另有重入锁兜底）
            if (ctx.btnRetry.disabled) return;
            ctx.btnRetry.disabled = true;
            try {
                await dm.retryFailed();
            } finally {
                ctx.btnRetry.disabled = false;
            }
            return;
        }
        if (ctx.actionCb) ctx.actionCb('retry-downloads');
    };

    ctx.btnCancel.onclick = async () => {
        if (ctx.selectedMediaIds.size === 0) return;
        const ok = await api.confirm('确认取消选中的 ' + ctx.selectedMediaIds.size + ' 个任务？取消后失败的任务可以点击「重试失败」重新加入。');
        if (!ok) return;
        const dm = getDM();
        await Promise.all(Array.from(ctx.selectedMediaIds).map(id => dm && dm.cancelTask && dm.cancelTask(id)));
        ctx.selectedMediaIds.clear();
        renderMediaGrid(ctx);
    };

    /* ===== 日志操作 ===== */

    ctx.btnClearLog.onclick = () => {
        const dm = getDM();
        if (dm && dm.clearLogs) dm.clearLogs();
        renderLogs(ctx);
    };

    function triggerDownload(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
        try {
            const blob = new Blob([text], { type: mime });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.rel = 'noopener';
            (document.body || document.documentElement).appendChild(a);
            a.click();
            setTimeout(() => {
                try { a.remove(); } catch (_) { /* ignore */ }
                try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
            }, 500);
            return true;
        } catch (e) {
            console && console.warn && console.warn('[backup-panel] 导出日志失败', e);
            return false;
        }
    }

    function buildLogFilename(suffix: 'txt' | 'json'): string {
        const d = new Date();
        const p = (n: number, w = 2) => String(n).padStart(w, '0');
        return `QZoneExport-log_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${suffix}`;
    }

    ctx.btnExportLogTxt.onclick = async () => {
        const dm = getDM();
        if (!dm || typeof dm.exportLogs !== 'function') {
            await api.alert('DownloadManager 还未初始化，暂时无法导出日志。');
            return;
        }
        const ok = triggerDownload(buildLogFilename('txt'), dm.exportLogs('txt', { level: ctx.levFilter }), 'text/plain;charset=utf-8');
        if (ok) dm.log && dm.log('INFO', '日志已导出为 TXT 文件（' + buildLogFilename('txt') + '）');
    };

    ctx.btnExportLogJson.onclick = async () => {
        const dm = getDM();
        if (!dm || typeof dm.exportLogs !== 'function') {
            await api.alert('DownloadManager 还未初始化，暂时无法导出日志。');
            return;
        }
        const ok = triggerDownload(buildLogFilename('json'), dm.exportLogs('json', { level: ctx.levFilter }), 'application/json;charset=utf-8');
        if (ok) dm.log && dm.log('INFO', '日志已导出为 JSON 文件（' + buildLogFilename('json') + '）');
    };

    /* ===== 媒体预览弹层 ===== */

    const previewOverlay = $('#media-preview');
    const previewBody = $('#media-preview-body');
    const previewClose = $('#media-preview-close');

    function openMediaPreview(url: string, isVideo: boolean) {
        if (!previewOverlay || !previewBody) return;
        previewBody.innerHTML = isVideo
            ? `<video src="${escapeAttr(url)}" controls autoplay style="max-width:100%;max-height:82vh;background:#000;border-radius:8px;"></video>`
            : `<img src="${escapeAttr(url)}" alt="预览" style="max-width:100%;max-height:82vh;border-radius:8px;">`;
        previewOverlay.style.display = 'flex';
    }

    // 关闭时务必暂停并销毁媒体元素：仅 display:none 不会停止 <video>/<audio> 播放，
    // 隐藏的媒体仍会持续输出音频并占用 src 连接。
    function closeMediaPreview() {
        if (!previewOverlay || !previewBody) return;
        previewBody.querySelectorAll('video, audio').forEach((m) => {
            try { (m as HTMLMediaElement).pause(); } catch { /* ignore */ }
        });
        previewBody.innerHTML = '';
        previewOverlay.style.display = 'none';
    }

    ctx.mediaTbody.addEventListener('click', (e) => {
        const el = (e.target as HTMLElement).closest('.m-preview') as HTMLElement | null;
        if (!el) return;
        const url = el.getAttribute('data-url') || '';
        const isVideo = el.getAttribute('data-video') === '1';
        if (url) openMediaPreview(url, isVideo);
    });
    if (previewClose) previewClose.onclick = () => closeMediaPreview();
    if (previewOverlay) previewOverlay.addEventListener('click', (e) => { if (e.target === previewOverlay) closeMediaPreview(); });
    if (previewOverlay) {
        previewOverlay.addEventListener('keydown', (e) => {
            if ((e as KeyboardEvent).key === 'Escape') closeMediaPreview();
        });
    }

    /* ===== 模块状态辅助 ===== */

    function moduleName(mod: string): string { return getModuleLabel(mod); }
    function phaseName(phase: string): string { return PHASE_NAMES[phase] || phase; }
    function ensureMod(mod: string): ModState {
        let st = ctx.moduleMap.get(mod);
        if (!st) { st = { status: 'idle', phases: {} }; ctx.moduleMap.set(mod, st); }
        return st;
    }

    /* ===== BackupPanelAPI 实现 ===== */

    const api: BackupPanelAPI = {
        open(options: PanelOpenOptions) {
            host.style.display = 'block';
            const dirPart = (options.mode === 'directory' && options.directoryName)
                ? ' · 已选定目录 ' + options.directoryName
                : '';
            setPrimaryStatus('正在采集QQ空间数据' + dirPart);
            ctx.totalModules = typeof options.totalModules === 'number' ? options.totalModules : undefined;
            ctx.selectedModules = Array.isArray(options.selectedModules) ? options.selectedModules : undefined;
            ctx.isOtherSpace = options.isOtherSpace === true;
            ctx.footerEl.style.display = 'none';
            ctx.footerEl.classList.remove('active');
            ctx.completion = undefined;
            ctx.moduleMap.clear();
            ctx.selectedMediaIds.clear();
            if (ctx.notificationsEl) ctx.notificationsEl.innerHTML = '';
            renderModuleBars(ctx);
            renderStats(ctx);
            renderOverviewTop3(ctx);
            renderMediaGrid(ctx);
            renderLogs(ctx);
            attachDM();
            scheduleHeightSync();
        },

        dispatch(event: PanelEvent) {
            switch (event.type) {
                case 'progress': {
                    const d = event.data;
                    const st = ensureMod(d.module);
                    st.phases[d.phase] = { done: d.done, total: d.total, failed: d.failed };
                    if (d.subject) {
                        (st.subject ||= {})[d.phase] = { done: d.subject.done, total: d.subject.total };
                    }
                    if (st.status !== 'done' && st.status !== 'fail') st.status = 'active';
                    st.currentPhase = d.phase;
                    const lab = d.label || phaseName(d.phase);
                    if (d.label) st.currentPhaseLabel = d.label;
                    else if (lab) st.currentPhaseLabel = lab;
                    renderModuleBars(ctx);
                    scheduleHeightSync();
                    renderStats(ctx);
                    // 采集明细仅在「采集类进度」时刷新：账本随页落盘，此时才会变化；
                    // 下载阶段账本不变，不再因高频下载进度 tick 反复重绘明细（避免页面卡顿）。
                    // Badge 即使未激活也随采集进度更新；明细表格仅在激活页签时重绘（由 RAF 内守卫处理）。
                    if (d.phase !== 'download') scheduleRender('detail');
                    // TOP3 实时下载卡片不能只依赖 DM 的 task-updated 订阅：
                    // 隔离世界 / 跨上下文时该订阅可能收不到事件，导致 TOP3 永远停在
                    // 打开面板那一刻的空态。进度派发（含下载阶段）必到，这里同步刷新，
                    // 保证「正在下载」随真实在跑的任务实时更新。
                    renderOverviewTop3(ctx);
                    ctx.cOv.textContent = String(totalModulesOf(ctx));
                    // 主状态行：仅场景切换更新，不每个 tick 闪烁
                    const modLabel = moduleName(d.module);
                    const phasePart = d.phase === 'download' ? '' : ' / ' + (st.currentPhaseLabel || phaseName(d.phase));
                    if (d.phase === 'download') {
                        setPrimaryStatus('正在下载媒体 · ' + modLabel);
                    } else {
                        setPrimaryStatus('正在备份 · ' + modLabel + phasePart);
                    }
                    break;
                }
                case 'module-start': {
                    const st = ensureMod(event.module);
                    st.status = 'active';
                    if (!st.currentPhaseLabel) st.currentPhaseLabel = '准备中…';
                    renderModuleBars(ctx);
                    scheduleHeightSync();
                    break;
                }
                case 'module-complete': {
                    const st = ensureMod(event.module);
                    st.status = 'done';
                    st.currentPhaseLabel = '已完成';
                    for (const [k, ph] of Object.entries(st.phases)) {
                        const total = Math.max(ph.done || 0, ph.total || 0);
                        st.phases[k] = { ...ph, done: total, total };
                    }
                    if (Object.keys(st.phases).length === 0) {
                        st.phases['collect'] = { done: 1, total: 1 };
                    }
                    // 采集完成。媒体下载标记不再在此处依赖「瞬时 DM 快照」置位（媒体任务提交常晚于
                    // module-complete，导致此处 mp 常为空、标记失效）。改为由渲染层在 DM 聚合到该模块
                    // 任务时持久标记 hasMediaTasks（见 overview.ts syncMediaFlags），彻底避免快照间隙
                    // 触发 active↔done 重建闪烁。
                    renderModuleBars(ctx);
                    scheduleHeightSync();
                    break;
                }
                case 'module-error': {
                    const tip = CATEGORY_TIPS[event.category || ''] || '';
                    const suffix = tip ? '（' + tip + '）' : '';
                    if (event.module === '*') {
                        const label = STATE_LABEL.error || '异常';
                        setPrimaryStatus(label);
                        addNotice('请求失败：' + event.error + suffix, 'p1', [
                            { label: '查看日志', action: 'switch-log' },
                        ]);
                    } else {
                        const st = ensureMod(event.module);
                        st.status = 'fail';
                        renderModuleBars(ctx);
                        scheduleHeightSync();
                    }
                    break;
                }
                case 'request-retry': {
                    const tip = CATEGORY_TIPS[event.category || ''] || '';
                    addNotice('请求重试中 · ' + event.message + (tip ? '（' + tip + '）' : ''), 'p1', [
                        { label: '查看日志', action: 'switch-log' },
                    ]);
                    scheduleRender('notice');
                    break;
                }
                case 'request-recover':
                    notices.dismissLevel('p1');
                    renderNotices();
                    break;
                case 'paused':
                    setPrimaryStatus('已暂停');
                    addNotice('备份已暂停。点击「继续」按钮或前往媒体页签恢复。', 'p1', [
                        { label: '继续', action: 'resume-all' },
                    ]);
                    break;
                case 'resumed': {
                    setPrimaryStatus('备份已继续');
                    notices.dismissLevel('p1');
                    notices.dismissLevel('p2');
                    renderNotices();
                    break;
                }
            }
        },

        setStage(text, status) {
            // 兼容别名：映射为通知。旧调用方可通过此接口继续工作
            addNotice(text, 'p2');
            if (status !== undefined) setPrimaryStatus(status);
        },

        beginFinalize(text) {
            // 下载已全部出结论（总进度已到 100%），进入「整理备份文件」收尾阶段。
            // 主状态行持续显示提示（而非 5s 即逝的通知），直到 complete() 才放行到 100%。
            ctx.finalizing = true;
            setPrimaryStatus(text);
        },

        complete(result) {
            // 媒体下载在此之后还可能持续运行，不在此处写死计数 ——
            // 横幅由 renderCompletionBanner 每帧跟着 globalProgress 实时重算
            ctx.finalizing = false; // 收尾完成，总进度放行到 100%
            // 注意：complete() 不再冻结总耗时（下载模式媒体可能仍在后台跑）。
            // 真正结束点交由 maybeFreezeElapsed：外链/无媒体立即冻结，下载模式等媒体 settled。
            setPrimaryStatus(''); // 清空主状态行：完成总结归横幅一处
            ctx.footerEl.style.display = 'flex';
            ctx.footerEl.classList.add('active');
            ctx.completion = {
                mode: result.mode,
                needMerge: result.needMerge,
                mediaLinkMode: result.mediaLinkMode,
            };
            renderCompletionBanner(ctx);
            if (result.mode !== 'directory') {
                ctx.downloadBtn.style.display = 'inline-flex';
            }
            renderStats(ctx);
            renderOverviewTop3(ctx);
            renderMediaGrid(ctx);
            renderLogs(ctx);
            maybeFreezeElapsed(); // 外链/无媒体模式在此即冻结；下载模式等媒体 settled 再冻结
        },

        error(message) {
            const label = STATE_LABEL.error || '异常';
            ctx.finalizing = false; // 异常中断收尾，不再压总进度
            ctx.finishedAt = Date.now(); // 异常中断同样冻结总耗时
            stopElapsedTicker();
            setPrimaryStatus(label + '：' + message);
            addNotice(message, 'p0', [
                { label: '查看日志', action: 'switch-log' },
            ]);
        },

        // 程序侧强制关闭（无确认）；UI 关闭按钮请走 init 作用域的 requestClose（带确认）
        close() {
            doClose();
        },

        onAction(cb) { ctx.actionCb = cb; },

        waitForDirectory(onSelect) {
            return new Promise<void>((resolve) => {
                setPrimaryStatus('请先选择备份保存目录');
                ctx.footerEl.style.display = 'flex';
                ctx.footerEl.classList.add('active');
                ctx.downloadBtn.style.display = 'none';

                ctx.dirCtaEl.style.display = 'flex';
                const ovTab = shadow.querySelector('.tab[data-tab="ov"]') as HTMLButtonElement | null;
                if (ovTab && !ovTab.classList.contains('active')) ovTab.click();

                const doPick = async () => {
                    try {
                        const name = await onSelect();
                        ctx.dirCtaBtn.onclick = null;
                        ctx.dirCtaEl.style.display = 'none';
                        ctx.footerEl.style.display = 'none';
                        ctx.footerEl.classList.remove('active');
                        setPrimaryStatus('已选定目录 · ' + name);
                        // 备份真正开始：锚定总耗时起点（墙钟含暂停/收尾），并启动 1s 走字定时器
                        ctx.startedAt = Date.now();
                        ctx.finishedAt = undefined;
                        startElapsedTicker();
                        resolve();
                    } catch (err: any) {
                        if (err && err.name === 'AbortError') {
                            setPrimaryStatus('已取消 · 请重新选择备份保存目录');
                            return;
                        }
                        setPrimaryStatus('选择目录失败');
                        addNotice('选择目录失败：' + (err.message || '未知错误') + '，请重试', 'p0');
                    }
                };
                ctx.dirCtaBtn.onclick = () => doPick();
            });
        },

        confirm(message) {
            return new Promise<boolean>((resolve) => {
                const overlay = $('.confirm-overlay');
                const msgEl = overlay.querySelector('.confirm-msg') as HTMLElement;
                const okBtn = overlay.querySelector('.confirm-ok') as HTMLButtonElement;
                const cancelBtn = overlay.querySelector('.confirm-cancel') as HTMLButtonElement;
                msgEl.textContent = message;
                cancelBtn.style.display = '';
                overlay.style.display = 'flex';
                const cleanup = (r: boolean) => {
                    overlay.style.display = 'none';
                    okBtn.onclick = null;
                    cancelBtn.onclick = null;
                    resolve(r);
                };
                okBtn.onclick = () => cleanup(true);
                cancelBtn.onclick = () => cleanup(false);
            });
        },

        alert(message) {
            return new Promise<void>((resolve) => {
                const overlay = $('.confirm-overlay');
                const msgEl = overlay.querySelector('.confirm-msg') as HTMLElement;
                const okBtn = overlay.querySelector('.confirm-ok') as HTMLButtonElement;
                const cancelBtn = overlay.querySelector('.confirm-cancel') as HTMLButtonElement;
                msgEl.textContent = message;
                cancelBtn.style.display = 'none';
                overlay.style.display = 'flex';
                const cleanup = () => {
                    overlay.style.display = 'none';
                    okBtn.onclick = null;
                    cancelBtn.onclick = null;
                    resolve();
                };
                okBtn.onclick = () => cleanup();
            });
        },
    };

    /* ===== Footer 按钮事件 ===== */
    ctx.headerClose.onclick = () => void requestClose();
    ctx.closeBtn.onclick = () => void requestClose();
    ctx.downloadBtn.onclick = () => { if (ctx.actionCb) ctx.actionCb('download-zip'); };

    // 暴露给外部（旧版兼容）
    (window as any).__QZ_BACKUP_PANEL__DM_ATTACH__ = attachDM;
    (window as any).__QZ_BACKUP_PANEL__ = api;

    /* ===== 关闭确认 / 刷新保护（防误操作中断备份） ===== */
    // 备份是否仍在进行中：采集中，或采集已结束但媒体仍在下载（尚未真正下载完成）
    function isBackupRunning(): boolean {
        if (ctx.finalizing) return true;
        for (const st of ctx.moduleMap.values()) {
            if (st.status === 'active') return true;
            if (st.mediaDownloading && !st.mediaSettled) return true;
        }
        return false;
    }
    // 真正执行关闭面板（隐藏并通知外部）
    function doClose(): void {
        stopElapsedTicker();
        host.style.display = 'none';
        if (ctx.actionCb) ctx.actionCb('close');
    }
    // UI 关闭按钮：进行中时弹确认，避免误操作中断备份
    async function requestClose(): Promise<void> {
        if (isBackupRunning()) {
            const ok = await api.confirm('备份仍在进行中，关闭面板将中断当前备份任务。确定要关闭吗？');
            if (!ok) return;
        }
        doClose();
    }
    // 浏览器刷新 / 关闭标签保护：进行中时拦截，避免进度丢失
    window.addEventListener('beforeunload', (e: BeforeUnloadEvent) => {
        if (isBackupRunning()) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    return { host, api };
}
