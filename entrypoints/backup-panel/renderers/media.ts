/**
 * 媒体 Tab 渲染器：表格、分页、搜索、批量操作
 */

import { getModuleLabel } from '../../../core/shared/backup-options';
import { getDM } from '../dm';
import type { DmApi } from '../dm';
import { fmtBytes, fmtDuration, isImageName, isVideoName, escapeHtml, escapeAttr, cssEscapeUrl, syncModuleFilterOptions } from '../utils';
import { STATE_COLOR, STATE_LABEL, TRACKER_LABEL } from '../constants';
import type { LiveTask, PanelContext } from '../context';

/** 修正页码到合法范围 */
export function clampPage(p: number, totalPages: number): number {
    if (totalPages <= 0) return 1;
    if (p < 1) return 1;
    if (p > totalPages) return totalPages;
    return p;
}

/** 生成分页按钮 HTML */
export function buildPageButtons(current: number, totalPages: number): string {
    if (totalPages <= 1) return '<button disabled>1</button>';
    const buttons: string[] = [];
    const push = (label: string, page: number | string, opts: { disabled?: boolean; active?: boolean } = {}) => {
        const cls = (opts.active ? 'active' : '') + (opts.disabled ? ' disabled' : '');
        const dataPage = typeof page === 'number' ? `data-page="${page}"` : '';
        const dis = opts.disabled ? 'disabled' : '';
        buttons.push(`<button class="${cls}" ${dataPage} ${dis}>${label}</button>`);
    };
    push('«', 1, { disabled: current === 1 });
    push('‹', current - 1, { disabled: current === 1 });
    const windowSet = new Set<number>();
    windowSet.add(1); windowSet.add(totalPages);
    for (let i = current - 2; i <= current + 2; i++) if (i >= 1 && i <= totalPages) windowSet.add(i);
    const win = Array.from(windowSet).sort((a, b) => a - b);
    let prev = 0;
    for (const p of win) {
        if (prev > 0 && p - prev > 1) push('…', 'ellipsis', { disabled: true });
        push(String(p), p, { active: p === current });
        prev = p;
    }
    push('›', current + 1, { disabled: current === totalPages });
    push('»', totalPages, { disabled: current === totalPages });
    return buttons.join('');
}

/**
 * 计算当前筛选条件下的全部任务（含过滤/排序）。
 *
 * `totalAll` 直接取自**同一次** `tasksSorted()` 的长度，不再另调 `stats().total`。
 * 旧实现一行内调了两次 `dm.stats()`（`dm.stats() && dm.stats().total`），
 * 既是两次全量遍历的浪费，也让「总数」与「实际渲染的行」来自不同快照。
 * 现在分母与行数据严格同源，`tasksSorted().length` 恒等于 `stats().total`。
 */
function collectFilteredTasks(ctx: PanelContext, dm: DmApi | null): { all: LiveTask[]; totalAll: number } {
    let all: LiveTask[] = [];
    let totalAll = 0;
    if (dm && typeof dm.tasksSorted === 'function') {
        const rawTasks = dm.tasksSorted();
        all = Array.isArray(rawTasks) ? rawTasks : [];
        totalAll = all.length;
        // 同步「按模块筛选」下拉（基于全部任务中的模块集合；选项变化时重建并保留当前选择）
        const distinctMods = Array.from(new Set(all.map((t: LiveTask) => t.module).filter(Boolean))) as string[];
        ctx.mediaModuleFilter = syncModuleFilterOptions(ctx.mediaModuleFilterSel, ctx.mediaModuleFilter, distinctMods);
        if (ctx.stateFilter !== 'all') all = all.filter((t: LiveTask) => t.state === ctx.stateFilter);
        if (ctx.mediaTypeFilter === 'image') all = all.filter((t: LiveTask) => t.name && isImageName(t.name));
        else if (ctx.mediaTypeFilter === 'video') all = all.filter((t: LiveTask) => t.name && isVideoName(t.name));
        if (ctx.mediaModuleFilter !== 'all') all = all.filter((t: LiveTask) => (t.module || '') === ctx.mediaModuleFilter);
        if (ctx.mediaKeyword) {
            const kw = ctx.mediaKeyword;
            all = all.filter((t: LiveTask) => {
                const hay = [t.name, t.dir, t.url, t.ownerId, t.ownerTitle, t.module].filter(Boolean).join('\n').toLowerCase();
                return hay.includes(kw);
            });
        }
        if (ctx.mediaSort === 'newest') all.sort((a: LiveTask, b: LiveTask) => (b._createdAt || 0) - (a._createdAt || 0));
        else if (ctx.mediaSort === 'oldest') all.sort((a: LiveTask, b: LiveTask) => (a._createdAt || 0) - (b._createdAt || 0));
    }
    return { all, totalAll };
}

/** 筛选条件指纹：任一变化即视为需要全量重建 */
function filterKeyOf(ctx: PanelContext): string {
    return [ctx.stateFilter, ctx.mediaTypeFilter, ctx.mediaModuleFilter, ctx.mediaKeyword, ctx.mediaSort, ctx.mediaPageSizeVal].join('|');
}

/** 绑定单行事件（chk + 四个操作按钮） */
function bindRowEvents(tr: HTMLElement, id: string, dm: DmApi | null, ctx: PanelContext): void {
    const chk = tr.querySelector('input.row-chk') as HTMLInputElement | null;
    if (chk) {
        chk.onchange = () => {
            if (chk.checked) ctx.selectedMediaIds.add(id); else ctx.selectedMediaIds.delete(id);
            tr.classList.toggle('selected', chk.checked);
            const allChecked = (Array.from(ctx.mediaTbody.querySelectorAll('input.row-chk')) as HTMLInputElement[]).every(c => c.checked);
            ctx.mediaChkAll.checked = allChecked;
        };
    }
    const bind = (cls: string, fn: ((id: string) => Promise<void>) | undefined) => {
        const btn = tr.querySelector('.' + cls) as HTMLButtonElement | null;
        if (btn && fn) btn.onclick = () => fn(id);
    };
    bind('cb-retry', dm && dm.retryTask ? dm.retryTask.bind(dm) : undefined);
    bind('cb-pause', dm && dm.pauseTask ? dm.pauseTask.bind(dm) : undefined);
    bind('cb-resume', dm && dm.resumeTask ? dm.resumeTask.bind(dm) : undefined);
    bind('cb-cancel', dm && dm.cancelTask ? dm.cancelTask.bind(dm) : undefined);
    // 复制下载链接
    const copyBtn = tr.querySelector('.cb-copy-url') as HTMLButtonElement | null;
    if (copyBtn) {
        copyBtn.onclick = async () => {
            const all = (dm && dm.tasksSorted ? dm.tasksSorted() : []) as LiveTask[];
            const task = all.find(x => x.id === id);
            const url = (task && task.url) || '';
            if (!url) return;
            try {
                await navigator.clipboard.writeText(url);
                const orig = copyBtn.textContent; // 原图标（🔗）
                copyBtn.textContent = '✓';
                copyBtn.setAttribute('title', '已复制');
                copyBtn.classList.add('btn-primary');
                setTimeout(() => { copyBtn.textContent = orig; copyBtn.setAttribute('title', '复制下载链接'); copyBtn.classList.remove('btn-primary'); }, 1200);
            } catch {
                // Shadow DOM 内 clipboard 可能受限，兜底用 execCommand
                const ta = document.createElement('textarea');
                ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
                (tr.getRootNode() as ShadowRoot).appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); } catch { /* ignore */ }
                ta.remove();
            }
        };
    }
}

/**
 * 单任务进度口径（#6）。浏览器下载常常拿不到 totalBytes（服务端无 Content-Length），
 * 此时按 done/total 计算会恒为 0%，看上去像「没在动」。这里统一：
 *  - complete：一律 100%
 *  - 大小未知且正在下载：不确定进度条（动画），而不是 0%
 *  - 其余：按字节比
 */
function progressOf(t: LiveTask): { pct: number; indeterminate: boolean } {
    const done = Number(t.downloadedBytes || 0);
    const total = Number(t.totalBytes || 0);
    const st = t.state || 'pending';
    if (st === 'complete') return { pct: 100, indeterminate: false };
    if (total > 0) return { pct: Math.min(100, Math.round((done / total) * 100)), indeterminate: false };
    if (st === 'in_progress') return { pct: 100, indeterminate: true };
    return { pct: 0, indeterminate: false };
}

const INDETERMINATE_STYLE = 'width:100%;animation:qz-indeterminate 1.2s ease-in-out infinite;background:linear-gradient(90deg,#2080f055,#2080f0,#2080f055);background-size:200% 100%;';

/** 增量更新已渲染行的进度/状态（不全量重建，保留滚动位置） */
function updateLoadedRows(ctx: PanelContext, all: LiveTask[], dm: DmApi | null): void {
    const loaded = ctx._mediaLoadedIds;
    if (!loaded || loaded.size === 0) return;
    const byId = new Map<string, LiveTask>(all.map(t => [String(t.id), t] as [string, LiveTask]));
    ctx.mediaTbody.querySelectorAll('tr[data-id]').forEach((tr) => {
        const id = tr.getAttribute('data-id') || '';
        const t = byId.get(id);
        if (!t) return;
        // 状态 chip
        const st = t.state || 'pending';
        const stateCls = st === 'complete' ? 'ok' : st === 'in_progress' ? 'running' : st === 'interrupted' ? 'fail' : st === 'paused' ? 'pause' : 'pending';
        const stateColor = STATE_COLOR[st] || '#64748b';
        const chip = tr.querySelector('.state-chip') as HTMLElement | null;
        if (chip) {
            chip.className = 'state-chip ' + stateCls;
            const dot = chip.querySelector('.dot') as HTMLElement | null;
            if (dot) dot.style.background = stateColor;
            const label = STATE_LABEL[st] || st;
            // 保留 dot，仅替换文本节点
            if (chip.lastChild && chip.lastChild.nodeType === Node.TEXT_NODE) chip.lastChild.textContent = label;
            else chip.appendChild(document.createTextNode(label));
        }
        // 进度列
        const done = Number(t.downloadedBytes || 0);
        const total = Number(t.totalBytes || 0);
        const prog = progressOf(t);
        const fill = tr.querySelector('.col-progress .bar .fill') as HTMLElement | null;
        if (fill) fill.setAttribute('style', prog.indeterminate ? INDETERMINATE_STYLE : `width:${prog.pct}%;`);
        const meta = tr.querySelector('.col-progress .meta') as HTMLElement | null;
        if (meta) {
            meta.innerHTML = `<span>${fmtBytes(done)} / ${total ? fmtBytes(total) : '?'}</span><span class="spd">${fmtBytes(t.speedBps)}/s</span><span class="eta">剩余 ${fmtDuration(t.etaMs)}</span>`;
        }
        // 原因行：重试成功后必须消失，重试失败后要更新为新的原因
        const nameCell = tr.querySelector('.cell-name') as HTMLElement | null;
        if (nameCell) {
            const errEl = nameCell.querySelector('.f-err') as HTMLElement | null;
            if (t.error) {
                const text = String(t.error);
                if (errEl) {
                    errEl.innerHTML = `<b>原因：</b>${escapeHtml(text)}`;
                    errEl.setAttribute('title', '原因：' + text);
                } else {
                    const span = document.createElement('span');
                    span.className = 'f-err';
                    span.title = '原因：' + text;
                    span.innerHTML = `<b>原因：</b>${escapeHtml(text)}`;
                    nameCell.appendChild(span);
                }
            } else if (errEl) {
                errEl.remove();
            }
        }
        // 操作按钮：状态迁移后按钮组需同步（如 interrupted→pending 后不应再显示「重试」）
        const actions = tr.querySelector('.col-actions') as HTMLElement | null;
        if (actions && actions.getAttribute('data-btnkey') !== st) {
            actions.setAttribute('data-btnkey', st);
            actions.innerHTML = buildRowButtons(st);
            bindRowEvents(tr as HTMLElement, id, dm, ctx);
        }
    });
}

/** 渲染媒体列表（表格 + 分页 + 无限滚动 + 事件绑定） */
export function renderMediaGrid(ctx: PanelContext): void {
    const dm = getDM();
    if (!dm || typeof dm.tasksSorted !== 'function') {
        ctx.mediaTbody.innerHTML = '<tr><td colspan="7"><div class="empty-hint">任务列表为空<br>点击「一键开始备份」按钮开始备份</div></td></tr>';
        ctx.mediaPageInfo.textContent = '-';
        ctx.mediaPageButtons.innerHTML = '';
        ctx.mediaChkAll.checked = false;
        ctx._mediaFilterKey = '';
        ctx._mediaLoadedIds = new Set();
        return;
    }
    const { all, totalAll } = collectFilteredTasks(ctx, dm);
    ctx.cMedia.textContent = String(totalAll);

    if (all.length === 0) {
        ctx.mediaTbody.innerHTML = '<tr><td colspan="7"><div class="empty-hint">当前筛选条件下暂无任务</div></td></tr>';
        ctx.mediaPageInfo.innerHTML = `筛选后共 <b>0</b> / 总 <b>${totalAll}</b> 条`;
        ctx.mediaPageButtons.innerHTML = '';
        ctx.mediaChkAll.checked = false;
        ctx._mediaFilterKey = '';
        ctx._mediaLoadedIds = new Set();
        return;
    }

    const totalPages = Math.max(1, Math.ceil(all.length / ctx.mediaPageSizeVal));
    const fkey = filterKeyOf(ctx);
    const filterChanged = fkey !== ctx._mediaFilterKey;
    if (filterChanged) {
        // 筛选/排序/每页变化：回到第 1 页，全量重建
        ctx.mediaCurrentPage = 1;
        ctx._mediaFilterKey = fkey;
        ctx._mediaLoadedIds = new Set();
    }
    ctx.mediaCurrentPage = clampPage(ctx.mediaCurrentPage, totalPages);
    const startIdx = (ctx.mediaCurrentPage - 1) * ctx.mediaPageSizeVal;
    const endIdx = Math.min(ctx.mediaCurrentPage * ctx.mediaPageSizeVal, all.length);
    const pageSlice = all.slice(startIdx, endIdx);

    // 增量模式：仅当「当前页应展示的任务集合」与「已渲染的行集合」完全一致时才走增量。
    // 旧实现用 loadedIds.size >= pageSlice.length 判定，当任务因状态变化被筛选条件剔除
    // （典型：在「失败」筛选下重试成功，任务离开 interrupted）时集合已变但长度判定仍成立，
    // 导致该行赖在 DOM 里不走，必须手动切页签才刷新（#2）。
    const pageIds = pageSlice.map(t => String(t.id));
    const loadedIds = ctx._mediaLoadedIds;
    const sameRowSet = !filterChanged
        && !!loadedIds
        && loadedIds.size === pageIds.length
        && pageIds.every(pid => loadedIds.has(pid));
    if (sameRowSet && pageSlice.length > 0) {
        updateLoadedRows(ctx, all, dm);
        // 同步分页栏与全选状态
        ctx.mediaPageInfo.innerHTML = `第 <b>${ctx.mediaCurrentPage}</b>/${totalPages} 页 · 筛选后 <b>${all.length}</b> / 总 <b>${totalAll}</b> 条`;
        ctx.mediaPageButtons.innerHTML = buildPageButtons(ctx.mediaCurrentPage, totalPages);
        bindPageButtons(ctx, totalPages);
        const allVisibleChecked = pageSlice.every(t => ctx.selectedMediaIds.has(t.id));
        ctx.mediaChkAll.checked = allVisibleChecked;
        return;
    }

    // 全量重建当前已加载页（1..currentPage）
    ctx.mediaTbody.innerHTML = pageSlice.map(t => renderMediaRow(t, ctx)).join('');
    ctx._mediaLoadedIds = new Set(pageSlice.map(t => String(t.id)));
    ctx.mediaTbody.querySelectorAll('tr[data-id]').forEach((tr) => {
        const id = tr.getAttribute('data-id') || '';
        bindRowEvents(tr as HTMLElement, id, dm, ctx);
    });
    ctx.mediaPageInfo.innerHTML = `第 <b>${ctx.mediaCurrentPage}</b>/${totalPages} 页 · 筛选后 <b>${all.length}</b> / 总 <b>${totalAll}</b> 条`;
    ctx.mediaPageButtons.innerHTML = buildPageButtons(ctx.mediaCurrentPage, totalPages);
    bindPageButtons(ctx, totalPages);

    const allVisibleChecked = pageSlice.length > 0 && pageSlice.every(t => ctx.selectedMediaIds.has(t.id));
    ctx.mediaChkAll.checked = allVisibleChecked;
}

/** 绑定分页按钮（跳页：全量重建并滚动到顶部） */
function bindPageButtons(ctx: PanelContext, totalPages: number): void {
    ctx.mediaPageButtons.querySelectorAll('button[data-page]').forEach((btn) => {
        (btn as HTMLElement).onclick = () => {
            const p = Number((btn as HTMLElement).getAttribute('data-page'));
            if (!Number.isFinite(p) || p < 1) return;
            ctx.mediaCurrentPage = clampPage(p, totalPages);
            // 跳页视为全量重建：清空 filterKey 触发重建（其实页变也算"跳"）
            ctx._mediaFilterKey = '';
            renderMediaGrid(ctx);
            requestAnimationFrame(() => {
                if (ctx.mediaTable && typeof ctx.mediaTable.scrollTo === 'function') { try { ctx.mediaTable.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { /* ignore */ } }
            });
        };
    });
}

/** 滚动到底部时加载下一页（委托 renderMediaGrid 重建当前页） */
export function loadMoreMedia(ctx: PanelContext): void {
    if (ctx._mediaAppending) return;
    const dm = getDM();
    if (!dm || typeof dm.tasksSorted !== 'function') return;
    const { all } = collectFilteredTasks(ctx, dm);
    if (all.length === 0) return;
    const totalPages = Math.max(1, Math.ceil(all.length / ctx.mediaPageSizeVal));
    if (ctx.mediaCurrentPage >= totalPages) return;
    ctx.mediaCurrentPage = clampPage(ctx.mediaCurrentPage + 1, totalPages);
    ctx._mediaFilterKey = ''; // 强制全量重建
    renderMediaGrid(ctx);
}

/**
 * 操作列按钮（按状态决定）。抽出成函数，供全量渲染与增量刷新共用，
 * 避免状态变化后按钮组还停留在旧状态（例如重试成功后仍显示「↻ 重试」）。
 */
export function buildRowButtons(st: string): string {
    let btns = '';
    btns += `<button class="btn btn-default icon-btn cb-copy-url" title="复制下载链接" aria-label="复制下载链接">🔗</button>`;
    if (st === 'in_progress' || st === 'pending') btns += `<button class="btn btn-warn icon-btn cb-pause" title="暂停此任务" aria-label="暂停此任务">⏸</button>`;
    if (st === 'paused') btns += `<button class="btn btn-primary icon-btn cb-resume" title="继续此任务" aria-label="继续此任务">▶</button>`;
    if (st === 'interrupted') btns += `<button class="btn btn-primary icon-btn cb-retry" title="重试此任务" aria-label="重试此任务">↻</button>`;
    btns += `<button class="btn btn-danger icon-btn cb-cancel" title="取消此任务（可在失败里重试）" aria-label="取消此任务">✕</button>`;
    return btns;
}

/** 渲染单行媒体任务 */
export function renderMediaRow(t: LiveTask, ctx: PanelContext): string {
    const id = t.id;
    const done = Number(t.downloadedBytes || 0);
    const total = Number(t.totalBytes || 0);
    const prog = progressOf(t);
    const st = t.state || 'pending';
    const track = TRACKER_LABEL[t.trackerType || 'none'] || '未知';
    const mod = getModuleLabel(t.module);
    const thumbStyle = t.thumbUrl ? `background-image:url('${cssEscapeUrl(t.thumbUrl)}');` : '';
    const fallbackIcon = isImageName(t.name) ? '🖼️' : (isVideoName(t.name) ? '🎬' : '📦');
    const typeLabel = isImageName(t.name) ? '图片' : (isVideoName(t.name) ? '视频' : '文件');
    const playBadge = isVideoName(t.name) ? '<span class="mt-play" title="视频">▶</span>' : '';
    const previewUrl = escapeAttr(t.url || t.thumbUrl || '');
    const isVideo = isVideoName(t.name) ? '1' : '0';
    const isSel = ctx.selectedMediaIds.has(id) ? 'selected' : '';
    const stateCls = st === 'complete' ? 'ok' : st === 'in_progress' ? 'running' : st === 'interrupted' ? 'fail' : st === 'paused' ? 'pause' : 'pending';
    const stateColor = STATE_COLOR[st] || '#64748b';

    // 「所属内容」列已移除（#1）：模块信息由「模块」列承载，避免同一信息两列重复。
    // 原本挂在该列的原因文案改为并入「文件 / 路径」列第三行，保证失败原因仍可见。
    const errLine = t.error
        ? `<span class="f-err" title="原因：${escapeAttr(String(t.error))}"><b>原因：</b>${escapeHtml(String(t.error))}</span>`
        : '';
    const nameTitle = escapeAttr(t.name || t.url);

    const btns = buildRowButtons(st);

    const retriesBadge = t.retries ? `<span style="margin-left:4px;padding:1px 5px;border-radius:3px;background:#f1f5f9;color:#475569;font-size:10px;">重${escapeHtml(String(t.retries))}</span>` : '';
    const trackBadge = `<span style="margin-left:4px;padding:1px 5px;border-radius:3px;background:#f8fafc;color:#475569;border:1px solid #e2e8f0;font-size:10px;">${escapeHtml(track)}</span>`;

    return `<tr class="${isSel}" data-id="${escapeAttr(id)}">
        <td class="col-chk"><input type="checkbox" class="row-chk" data-id="${escapeAttr(id)}" ${ctx.selectedMediaIds.has(id) ? 'checked' : ''} title="选中该行" /></td>
        <td class="col-type"><div class="media-type m-preview" data-url="${previewUrl}" data-video="${isVideo}" title="点击预览">
            <div class="mt-thumb" style="${thumbStyle}">
                ${t.thumbUrl ? `<img class="mt-img" loading="lazy" src="${cssEscapeUrl(t.thumbUrl)}" alt="" onerror="this.style.display='none';this.parentNode.classList.add('mt-failed')">` : ''}
                <span class="mt-ico">${fallbackIcon}</span>
                ${playBadge}
            </div>
            <span class="mt-label">${typeLabel}</span>
        </div></td>
        <td class="col-file">
            <div class="cell-name">
                <span class="f-name m-preview" data-url="${previewUrl}" data-video="${isVideo}" title="${nameTitle}">${escapeHtml(t.name || '未命名文件')}</span>
                <span class="f-path" title="${escapeAttr((t.dir || '') + (t.dir ? '/' : '') + (t.name || ''))}">${escapeHtml((t.dir || '') + (t.dir ? '/' : '') + (t.name || ''))}</span>
                ${errLine}
            </div>
        </td>
        <td class="col-state">
            <span class="state-chip ${stateCls}"><span class="dot" style="background:${stateColor}"></span>${escapeHtml(STATE_LABEL[st] || st)}</span>
        </td>
        <td class="col-module">
            <span class="mod-name" title="${escapeAttr(mod || '-')}">${escapeHtml(mod || '-')}</span>
            ${retriesBadge}
            ${trackBadge}
        </td>
        <td class="col-progress">
            <div class="cell-progress">
                <div class="bar"><div class="fill" style="${prog.indeterminate ? INDETERMINATE_STYLE : `width:${prog.pct}%;`}"></div></div>
                <div class="meta">
                    <span>${fmtBytes(done)} / ${total ? fmtBytes(total) : '?'}</span>
                    <span class="spd">${fmtBytes(t.speedBps)}/s</span>
                    <span class="eta">剩余 ${fmtDuration(t.etaMs)}</span>
                </div>
            </div>
        </td>
        <td class="col-actions" data-btnkey="${escapeAttr(st)}">${btns}</td>
    </tr>`;
}
