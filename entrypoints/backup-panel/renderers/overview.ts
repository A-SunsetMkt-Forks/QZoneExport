/**
 * 概览 Tab 渲染器：全局进度、模块进度条、Top3 实时卡片
 */

import { getModuleLabel, MODULES, isModulePrivate } from '../../../core/shared/backup-options';
import { getDM } from '../dm';
import { fmtBytes, fmtDuration, isImageName, isVideoName, escapeHtml, escapeAttr, cssEscapeUrl } from '../utils';
import { STATE_COLOR, STATE_LABEL, TRACKER_LABEL, MODULE_STATUS_LABEL } from '../constants';
import { computeSubjectProgress } from '../subject-config';
import type { LiveTask, ModState, PanelContext } from '../context';

/**
 * 模块总数口径（#7）：以用户在备份弹窗勾选的模块数为准，备份全程固定不变。
 * 若因兼容原因未传入（旧调用方），退回「已登记模块数」并至少不小于它。
 */
export function totalModulesOf(ctx: PanelContext): number {
    const picked = ctx.totalModules;
    if (typeof picked === 'number' && picked > 0) return Math.max(picked, ctx.moduleMap.size);
    return ctx.moduleMap.size;
}

/**
 * 收尾阶段总进度封顶：下载已全部出结论（overallPct 已到 100%），但「整理备份文件」
 * （生成查看器 + 合并外部文件）尚未完成、complete() 尚未调用时，把主数字与绿段
 * 压在 99%，直到 complete() 才放行到 100%。避免「总进度 100% 却仍显示整理中」的矛盾。
 *
 * 纯函数，便于单测（renderOverview 依赖完整 DOM，难以直接测）。
 */
export function computeDisplayProgress(opts: {
    overallPct: number;
    fillPct: number;
    finalizing: boolean;
    finished: boolean;
}): { overall: number; fill: number } {
    const finalizing = opts.finalizing && !opts.finished;
    const overall = finalizing ? Math.min(opts.overallPct, 99) : opts.overallPct;
    const fill = finalizing ? Math.min(opts.fillPct, overall) : opts.fillPct;
    return { overall, fill };
}

/**
 * 进度条下方口径说明（#8）。
 *
 * 主数字已改为「总进度」口径（成功 + 失败都算已处理，跑完必到 100%），
 * 因此注脚的职责变成回答「这 100% 里有多少是真成功」：
 *  - 「成功 X / N」：真正落盘成功的文件数
 *  - 「失败 M」：有结论但失败的数量，配合红色进度段
 *  - 「成功完成度 P%」：仅在存在失败时展示，说明主数字与成功率的差额从何而来
 *
 * 完成判定用 `isSettled`（计数）而非百分比：后者在 999/1000 时会被四舍五入成
 * 100%，导致还剩任务却宣布「全部下载完成」。
 */
function buildProgressNote(total: number, ok: number, failed: number, successPct: number, isSettled: boolean, finished = false): string {
    // 无下载任务：外链模式或本次备份不含媒体。采集已完成时明确告知「无需下载」，
    // 否则用户会对着 0%/空注脚怀疑卡住
    if (total <= 0) return finished ? '本次备份无需下载媒体文件' : '';
    const parts: string[] = [`成功 <span class="lg-ok">${ok}</span> / ${total}`];
    if (failed > 0) parts.push(`失败 <span class="lg-fail">${failed}</span>`);
    if (isSettled) {
        parts.push(failed > 0
            ? `文件下载已结束，成功完成度 ${successPct}%（失败项可在「媒体」页签重试）`
            : '文件全部下载完成');
    } else if (failed > 0) {
        parts.push(`成功完成度 ${successPct}%`);
    }
    return parts.join(' · ');
}

/**
 * 渲染统计 chip（顶栏 6 个指标）+ 全局进度条。
 *
 * 【单一数据源】整个函数只向 DM 取一次快照（`globalProgress()`）。
 * 旧实现顶栏用 `stats()`、进度条用 `globalProgress()`，同一屏的数字来自两次
 * 独立遍历，口径极易漂移；且 393 个任务 × 每帧两次全量遍历纯属浪费。
 * `globalProgress()` 现已带 pending/running/paused 分项，足以覆盖全部展示需求。
 * `stats()` 仅作为旧 DM 实例的兜底，正常路径不会调用。
 */
export function renderStats(ctx: PanelContext): void {
    const dm = getDM();
    const gp = (dm && typeof dm.globalProgress === 'function') ? dm.globalProgress() : null;
    // 兜底：仅当 DM 尚未提供 globalProgress（旧实例）时才退回 stats()
    const s = (!gp && dm && typeof dm.stats === 'function') ? dm.stats() : null;

    const total = gp?.totalTasks ?? s?.total ?? 0;
    const ok = gp?.succeeded ?? s?.complete ?? 0;
    const run = gp?.running ?? s?.in_progress ?? 0;
    const fail = gp?.failed ?? s?.interrupted ?? 0;
    const pause = gp?.paused ?? s?.paused ?? 0;
    const wait = gp?.pending ?? s?.pending ?? 0;

    ctx.sTotal.textContent = String(total);
    ctx.sOk.textContent = String(ok);
    ctx.sRun.textContent = String(run);
    ctx.sFail.textContent = String(fail);
    ctx.sPause.textContent = String(pause);
    ctx.sWait.textContent = String(wait);
    ctx.cMedia.textContent = String(total);

    // Global progress：统一使用 DM 计算的任务权重百分比，避免口径分裂。
    // 主数字用「总进度」overallPercent（成功按字节比 + 失败按满权重），
    // 保证下载环节跑完后必定显示 100%，不会因几个失败项永远卡在 97%（#9）。
    // 进度条仍分两段呈现，让「100% 里有多少是失败」一眼可见：
    //   · 绿色段 percent    —— 成功完成度
    //   · 红色段 failedPercent —— 失败规模，两段合计即主数字
    if (gp) {
        const totalBytes = gp.totalBytes || 0;
        const doneBytes = gp.downloadedBytes || 0;
        const speed = gp.speedBps || 0;
        const pct = gp.percent || 0;            // 媒体成功完成度（仅供注脚）
        const failedCnt = fail;
        const okCnt = ok;
        const totalCnt = total;
        const isSettled = gp.isSettled ?? (totalCnt > 0 && (gp.settled ?? 0) >= totalCnt);
        const finished = !!ctx.completion;
        // 方案 A：顶部「总进度」改为各勾选模块「采集 + 媒体」的均值（不再只看媒体下载）。
        // 这样单模块媒体秒下完、后续模块还在采集时，顶部不会虚高到 100%。
        const selected = (ctx.selectedModules && ctx.selectedModules.length)
            ? ctx.selectedModules
            : MODULES.map(m => m.value);
        const mediaByModule = dm?.moduleProgressMap ? dm.moduleProgressMap() : null;
        // 同步持久标记，使总进度判定不依赖「本帧 DM 快照是否含该模块」（与模块条一致）
        syncMediaFlags(ctx, mediaByModule);
        const overallPct = computeBackupOverall({
            moduleMap: ctx.moduleMap,
            selectedModules: selected,
            mediaByModule: mediaByModule ?? undefined,
            finished,
        });
        // 红段 = 媒体失败占媒体总量比例，从绿段右端「扣出」（保证 绿+红≤100），
        // 既保留 F3-ext 的失败可见性，又让绿段表示「真正成功的那部分总进度」。
        const failShare = gp.failedPercent || 0;
        const fillPct = Math.max(0, Math.min(100, overallPct - failShare));
        // 收尾中（媒体已 100%，但「整理备份文件」尚未完成 / complete() 未调用）：
        // 把主数字与绿段压在 99%，直到 complete() 才放行到 100%。否则会出现
        // 「总进度 100% 却仍显示『正在整理备份文件』」的矛盾画面。
        const { overall: displayOverall, fill: displayFill } = computeDisplayProgress({
            overallPct, fillPct, finalizing: !!ctx.finalizing, finished,
        });
        ctx.ovPct.textContent = displayOverall + '%';
        ctx.ovFill.style.width = displayFill + '%';
        if (ctx.ovFillFail) {
            ctx.ovFillFail.style.left = Math.min(100, displayFill) + '%';
            ctx.ovFillFail.style.width = Math.max(0, Math.min(100 - displayFill, failShare)) + '%';
        }
        ctx.ovBytes.textContent = fmtBytes(doneBytes) + ' / ' + (totalBytes ? fmtBytes(totalBytes) : '未知');
        ctx.ovSpeed.textContent = '⬇ ' + fmtBytes(speed) + '/s';
        if (ctx.ovElapsed) {
            // 总耗时：备份开始（选目录后）→ 完成/异常 的墙钟时长；未开始显示 '-'
            const elapsed = ctx.startedAt ? (ctx.finishedAt ?? Date.now()) - ctx.startedAt : undefined;
            ctx.ovElapsed.textContent = '⏱ 已用时 ' + fmtDuration(elapsed);
        }
        if (ctx.ovProgressNote) {
            ctx.ovProgressNote.innerHTML = buildProgressNote(totalCnt, okCnt, failedCnt, pct, isSettled, finished);
            // Firefox 形态 B：文案/查看器落盘进度（写文件 N/M）
            const mw = (dm && typeof dm.getMetaWriteProgress === 'function') ? dm.getMetaWriteProgress() : null;
            if (mw && mw.total > 0) {
                const extra = document.createElement('div');
                extra.className = 'ov-meta-write';
                extra.textContent = '✍️ 写文案文件 ' + mw.done + '/' + mw.total;
                ctx.ovProgressNote.appendChild(extra);
            }
        }
    } else {
        // DM 不可用时（面板先于引擎挂载 / 备份中途 clear）重置进度显示，
        // 避免残留上一轮旧值导致「0 任务却 67% / 3.2MB/s」的矛盾画面。
        // 例外：采集已完成（无下载环节可言）时补到 100%，否则备份做完了却显示 0%
        const finished = !!ctx.completion;
        // 收尾中同样压在 99%（与 if 分支一致），避免「100% 却仍显示整理中」
        const finalizing = !!ctx.finalizing && !finished;
        const pctText = finalizing ? '99%' : (finished ? '100%' : '0%');
        const fillW = finalizing ? '99%' : (finished ? '100%' : '0%');
        ctx.ovPct.textContent = pctText;
        ctx.ovFill.style.width = fillW;
        if (ctx.ovFillFail) { ctx.ovFillFail.style.left = fillW; ctx.ovFillFail.style.width = '0%'; }
        ctx.ovBytes.textContent = fmtBytes(0) + ' / 未知';
        ctx.ovSpeed.textContent = '⬇ 0 B/s';
        if (ctx.ovElapsed) {
            const elapsed = ctx.startedAt ? (ctx.finishedAt ?? Date.now()) - ctx.startedAt : undefined;
            ctx.ovElapsed.textContent = '⏱ 已用时 ' + fmtDuration(elapsed);
        }
        if (ctx.ovProgressNote) ctx.ovProgressNote.textContent = finished ? '本次备份无需下载媒体文件' : '';
    }
    const doneMods = Array.from(ctx.moduleMap.values()).filter(m => m.status === 'done' || m.status === 'fail').length;
    // 分母取用户在备份弹窗勾选的模块总数（open 时即固定），而不是 moduleMap.size。
    // moduleMap 是「已开始的模块」，会随备份推进递增，导致早期出现 1/1、2/2 这类
    // 永远 100% 的假象（见 #7）。兜底：未传入时退回 moduleMap.size
    ctx.ovModsTag.textContent = '🗂 ' + doneMods + '/' + totalModulesOf(ctx) + ' 模块';
}

/**
 * 单模块「采集进度」（0-100）：仅统计 moduleMap 里的采集阶段
 * （list / comments / likes / …），失败也计入「已处理」，跑完必到 100%。
 * 与媒体下载无关，仅供合成总进度里「采集」那一半使用。
 *
 * 算法与 buildModuleBar 的进度段完全一致（同一份 sum 公式），保证模块条与
 * 顶部总进度的口径不漂移。
 */
export function moduleProgressPct(mod: string, st: ModState): number {
    // 优先按「主体个数」评估（选项 A）：9/10 主体完成即 90%，评论/赞仍在跑不显 100%，
    // 未知 total 不假 100%。详见 subject-config.ts。
    const sp = computeSubjectProgress(mod, st);
    if (sp) {
        if (st.status === 'done') return 100;
        return sp.indeterminate ? 0 : sp.pct;
    }
    // ===== 回退：旧 sum 公式（无 SUBJECT_CONFIG 或尚未启动任何主体对齐 phase）=====
    let sumSuccess = 0, sumFail = 0, sumTotal = 0;
    // module-complete 会把 done 强制补到 total（含失败），仅 done 状态需要按 total 补满；
    // 进行中 / 失败态直接用上报的 done，否则会把进行中模块直接补到 100%
    const forced = st.status === 'done';
    for (const ph of Object.values(st.phases)) {
        const t = ph.total || 0;            // -1 表示未知
        const d = ph.done || 0;
        const f = ph.failed || 0;
        // 该 phase 已处理口径：done 与 total 取大（仅 done 状态，对齐 module-complete 补满逻辑）
        const processed = forced ? Math.max(d, t > 0 ? t : 0) : d;
        sumFail += f;
        sumSuccess += Math.max(0, processed - f);
        sumTotal += t > 0 ? Math.max(processed, t) : processed;
    }
    if (sumTotal > 0) {
        const greenPct = Math.min(100, Math.round((sumSuccess / sumTotal) * 100));
        const failPct = Math.min(100 - greenPct, Math.round((sumFail / sumTotal) * 100));
        return Math.min(100, greenPct + failPct); // 已处理比例，跑完必到 100%
    }
    if (st.status === 'done') return 100;
    return 0; // 已开始但尚无 phase 计数时不虚高（由徽标文案体现处理中）
}

/**
 * 合成「备份总进度」（方案 A）：各勾选模块「采集进度 + 媒体下载进度」均值的均值。
 *
 *  - 采集进度：取 `moduleMap[mod]` 的 {@link moduleProgressPct}（item 计数）。
 *  - 媒体进度：取 DM 按模块聚合的 `overallPercent`；模块无媒体任务时退化为仅看采集。
 *  - 未开始 / 未勾选的模块记为 0，从而整体进度**不会**因「个别模块媒体少」而提前 100%
 *    （修复：单模块媒体秒下完、后续模块还在采集时顶部仍显示 100% 的割裂感）。
 *
 * 纯函数，便于单测（renderStats 依赖 DOM，难以直接测）。
 */
export function computeBackupOverall(opts: {
    moduleMap: Map<string, ModState>;
    selectedModules: string[];
    mediaByModule?: Record<string, { overallPercent: number; totalTasks: number }> | null;
    finished: boolean;
}): number {
    const mods = opts.selectedModules;
    if (!mods.length) return opts.finished ? 100 : 0;
    let sum = 0;
    let allSettled = true;
    for (const mod of mods) {
        const st = opts.moduleMap.get(mod);
        const collect = st ? moduleProgressPct(mod, st) : 0;
        const mp = opts.mediaByModule?.[mod];
        // 「该模块有媒体」以稳定事实 hasMediaTasks 为主（DM 聚合到过就永久为真），
        // 兼容旧 sticky 标记 mediaDownloading 与本帧实时快照。只要曾被确认有媒体，
        // 即便本帧 DM 快照缺失该模块，也强制视为「未结束」，避免总进度误报 100%，
        // 与模块条口径完全一致（renderModuleBars 用同一标记，二者不再分裂）。
        const hasMediaLive = !!(mp && mp.totalTasks > 0);
        const hasMedia = hasMediaLive || st?.hasMediaTasks === true || st?.mediaDownloading === true;
        // 媒体进度：快照缺失时回落到持久缓存 lastMediaPct，避免总进度在快照间隙抖动回退
        const media = hasMediaLive
            ? (mp?.overallPercent ?? 0)
            : (st?.lastMediaPct ?? (hasMedia ? 50 : 0));
        // 媒体真正下完以单调标记 mediaSettled 为准（与模块条同口径），避免总进度在快照间隙抖动回退
        const mediaSettled = st?.mediaSettled === true || media >= 100;
        if (!hasMedia) {
            // 无媒体：采集完成即模块完成（已 done 记 100，进行中记采集进度，未开始记 0）
            const settled = collect === 100;
            if (!settled) allSettled = false;
            sum += st ? (st.status === 'done' ? 100 : collect) : 0;
        } else {
            // 采集进度与媒体进度各 50% 合成模块完成度（对称、直观）
            // 模块真正结束：采集已 100% 且媒体已 settled（overallPercent 到 100，仅 DM settled 时才为 100）
            if (collect < 100 || !mediaSettled) allSettled = false;
            sum += Math.min(100, (collect + media) / 2);
        }
    }
    // 仅当所有勾选模块都已真正结束（采集 100% 且媒体 100%）才显示 100%。
    // 注意：finished（complete() 已调用）不再单独强制 100% —— complete() 不等媒体下载完，
    // 媒体可能仍在后台跑，此时必须压在 99%，否则会出现「总进度 100% 却仍有模块下载中」的割裂。
    if (allSettled) return 100;
    return Math.min(99, Math.round(sum / mods.length));
}

/** 模块进度条内部数据结构（用于精细 DOM 更新，避免整节点重建导致 transition 重置） */
interface ModuleBarData {
    kind: 'bar' | 'idle' | 'unselected' | 'noperm';
    mod: string;
    statusClass: string;
    pct: number;
    greenPct: number;
    failPct: number;
    /** 主体总数未知：进度无法确定，显示「采集中」而非假百分比 */
    indeterminate?: boolean;
    badgeClass: string;
    badgeText: string;
    extraText: string;
}

/** 计算模块进度条的数值与样式状态 */
function buildModuleBarData(mod: string, st: ModState): ModuleBarData {
    // 失败条数（所有 phase 累加），用于「· 失败N」文案与失败段折算
    let sumFail = 0;
    for (const ph of Object.values(st.phases)) sumFail += ph.failed || 0;

    // 优先按「主体个数」评估（选项 A）：进度 = 已完成主体数 / 总主体数。
    const sp = computeSubjectProgress(mod, st);
    let pct = 0, greenPct = 0, failPct = 0, indeterminate = false;
    if (sp) {
        if (st.status === 'done') {
            // 模块已完成：主数字强制 100；失败段仍按失败条数占主体总数的比例折算
            pct = 100;
            const failSubjects = sp.total > 0 ? Math.min(sumFail, sp.total) : 0;
            failPct = sp.total > 0 ? Math.min(100, Math.round((failSubjects / sp.total) * 100)) : 0;
            greenPct = Math.max(0, 100 - failPct);
        } else if (sp.indeterminate) {
            // 主体总数未知：显示「采集中」，不渲染假进度（不假 100%）
            pct = 0; greenPct = 0; failPct = 0; indeterminate = true;
        } else {
            pct = sp.pct;
            // 失败段：按失败条数占主体总数的比例折算（失败条目归属到已处理主体里）
            const failSubjects = sp.total > 0 ? Math.min(sumFail, sp.total) : 0;
            failPct = sp.total > 0 ? Math.min(100, Math.round((failSubjects / sp.total) * 100)) : 0;
            greenPct = Math.max(0, pct - failPct);
        }
    } else {
        // ===== 回退：旧 sum 公式（无 SUBJECT_CONFIG 或尚未启动任何主体对齐 phase）=====
        // 分两段统计：成功段（绿）与失败段（红）。
        // 关键：green 取 done - failed，而非直接拿 done 当成功——
        // module-complete 会把 done 强制补到 total（含失败），若不减 failed，
        // 绿段会包含失败造成「绿 + 红 > 100%」。done 是否含失败都不影响该公式。
        let sumSuccess = 0, sumTotal = 0;
        // module-complete 会把 done 强制补到 total（含失败），仅 done 状态需要按 total 补满；
        // 进行中 / 失败态直接用上报的 done，否则会把进行中模块直接补到 100%
        const forced = st.status === 'done';
        for (const ph of Object.values(st.phases)) {
            const t = ph.total || 0;            // -1 表示未知
            const d = ph.done || 0;
            const f = ph.failed || 0;
            // 该 phase 已处理口径：done 与 total 取大（仅 done 状态，对齐 module-complete 补满逻辑）
            const processed = forced ? Math.max(d, t > 0 ? t : 0) : d;
            sumSuccess += Math.max(0, processed - f);
            sumTotal += t > 0 ? Math.max(processed, t) : processed;
        }
        if (sumTotal > 0) {
            // 成功段占比，失败段从剩余空间扣，保证 绿 + 红 ≤ 100%
            greenPct = Math.min(100, Math.round((sumSuccess / sumTotal) * 100));
            failPct = Math.min(100 - greenPct, Math.round((sumFail / sumTotal) * 100));
            pct = Math.min(100, greenPct + failPct); // 主数字 = 已处理比例，跑完必到 100%
        } else if (st.status === 'done') {
            pct = 100;
            if (sumFail > 0) { greenPct = 0; failPct = 100; }
            else { greenPct = 100; failPct = 0; }
        } else if (st.status === 'active') {
            pct = 0; // 已开始但尚无 phase 计数时不渲染假进度；处理中状态由徽标文案体现
        }
    }
    const statusClass = st.status === 'done' ? 'done' : st.status === 'fail' ? 'fail' : st.status === 'active' ? 'active' : '';
    let badgeClass: string, badgeText: string;
    if (st.status === 'done') { badgeClass = 'stg-ok'; badgeText = MODULE_STATUS_LABEL.done || ''; }
    else if (st.status === 'fail') { badgeClass = 'stg-err'; badgeText = MODULE_STATUS_LABEL.fail || ''; }
    else if (st.status === 'active' && st.currentPhaseLabel) { badgeClass = 'stg-run'; badgeText = st.currentPhaseLabel || ''; }
    else if (st.status === 'active') { badgeClass = 'stg-run'; badgeText = MODULE_STATUS_LABEL.active || ''; }
    else { badgeClass = 'stg-idle'; badgeText = MODULE_STATUS_LABEL.idle || ''; }

    // 「采集已完成 + 媒体仍在下载」：模块条保持 done 样式（100% 绿、宽度不变、绝不抖动）。
    // 仅把徽标从「成功」改为「下载中」——进度条本身稳定如 HEAD，变动只发生在徽标文案。
    // 顶级总进度（computeBackupOverall）已经用 sticky 标记按采集+媒体双口径计算，不会假 100%。
    // 注意：hasMediaTasks / mediaSettled 由 syncMediaFlags（renderModuleBars 开头调用）维护，
    // 二者皆为单调标记——hasMediaTasks 一旦 DM 聚合到即永久为 true，mediaSettled 一旦到 100 即不复位。
    if (st.status === 'done' && st.hasMediaTasks && !st.mediaSettled) {
        badgeClass = 'stg-run';
        badgeText = MODULE_STATUS_LABEL.downloading || '媒体下载中';
    }
    return {
        kind: 'bar',
        mod,
        statusClass,
        pct,
        greenPct,
        failPct,
        indeterminate,
        badgeClass,
        badgeText,
        extraText: sumFail ? ` · 失败${sumFail}` : '',
    };
}

/** 计算占位模块条的数据 */
function buildModulePlaceholderData(mod: string, kind: 'idle' | 'unselected' | 'noperm'): ModuleBarData {
    const badgeText = MODULE_STATUS_LABEL[kind] || kind;
    return {
        kind,
        mod,
        statusClass: kind,
        pct: 0,
        greenPct: 0,
        failPct: 0,
        badgeClass: `stg-${kind}`,
        badgeText,
        extraText: kind === 'noperm' ? ' · 仅自己空间可备份' : '',
    };
}

/** 将模块进度条数据渲染为 HTML 字符串 */
function moduleBarHtml(data: ModuleBarData): string {
    const baseName = getModuleLabel(data.mod);
    const extraSpan = data.extraText ? `<span class="mod-extra">${escapeHtml(data.extraText)}</span>` : '';
    const badgeSpan = `<span class="stg ${escapeAttr(data.badgeClass)}">${escapeHtml(data.badgeText)}</span>`;
    if (data.kind !== 'bar') {
        return `<div class="mod-progress ${data.statusClass}" data-mod="${escapeAttr(data.mod)}" data-kind="${escapeAttr(data.kind)}">
            <div class="mod-head"><span class="name">${escapeHtml(baseName)}${extraSpan}${badgeSpan}</span><span class="pct">—</span></div>
            <div class="bar"><div class="fill" style="width:0%"></div></div>
        </div>`;
    }
    const pctLabel = data.indeterminate ? '采集中' : `${data.pct}%`;
    const cls2 = data.indeterminate ? `${data.statusClass} indeterminate` : data.statusClass;
    return `<div class="mod-progress ${cls2}" data-mod="${escapeAttr(data.mod)}" data-kind="${escapeAttr(data.kind)}">
        <div class="mod-head"><span class="name">${escapeHtml(baseName)}${extraSpan}${badgeSpan}</span><span class="pct">${pctLabel}</span></div>
        <div class="bar"><div class="fill" style="width:${data.greenPct}%"></div><div class="fill-fail" style="left:${data.greenPct}%;width:${data.failPct}%"></div></div>
    </div>`;
}

/** 精细更新已有模块节点：只改变化的文本/宽度，不重建节点，避免 CSS transition 重置 */
function updateModuleBarNode(node: HTMLElement, data: ModuleBarData): void {
    const cls = `mod-progress ${data.statusClass}`;
    if (node.className !== cls) node.className = cls;

    const pctEl = node.querySelector('.pct') as HTMLElement | null;
    const pctText = data.kind === 'bar' ? (data.indeterminate ? '采集中' : `${data.pct}%`) : '—';
    if (pctEl && pctEl.textContent !== pctText) pctEl.textContent = pctText;

    const fillEl = node.querySelector('.fill') as HTMLElement | null;
    const fillWidth = `${data.greenPct}%`;
    if (fillEl && fillEl.style.width !== fillWidth) fillEl.style.width = fillWidth;

    let failEl = node.querySelector('.fill-fail') as HTMLElement | null;
    if (data.kind === 'bar') {
        if (data.failPct > 0) {
            if (!failEl) {
                failEl = document.createElement('div');
                failEl.className = 'fill-fail';
                const bar = node.querySelector('.bar');
                if (bar) bar.appendChild(failEl);
            }
            const failLeft = `${data.greenPct}%`;
            const failWidth = `${data.failPct}%`;
            if (failEl.style.left !== failLeft) failEl.style.left = failLeft;
            if (failEl.style.width !== failWidth) failEl.style.width = failWidth;
        } else if (failEl) {
            failEl.remove();
        }
    } else if (failEl) {
        failEl.remove();
    }

    const stgEl = node.querySelector('.stg') as HTMLElement | null;
    if (stgEl) {
        const stgCls = `stg ${data.badgeClass}`;
        if (stgEl.className !== stgCls) stgEl.className = stgCls;
        if (stgEl.textContent !== data.badgeText) stgEl.textContent = data.badgeText;
    }

    const nameEl = node.querySelector('.name') as HTMLElement | null;
    if (nameEl) {
        let extraEl = nameEl.querySelector('.mod-extra') as HTMLElement | null;
        if (data.extraText) {
            if (!extraEl) {
                extraEl = document.createElement('span');
                extraEl.className = 'mod-extra';
                nameEl.insertBefore(extraEl, stgEl);
            }
            if (extraEl.textContent !== data.extraText) extraEl.textContent = data.extraText;
        } else if (extraEl) {
            extraEl.remove();
        }
    }
}

/** 持久标记「该模块有媒体任务」：DM 聚合到其任务即永久置 true。
 * 媒体进度缓存 / settled 锁定只在「采集非进行中」时写入，避免像相册这种
 * 逐相册增量添加下载任务的模块，在「上一批已下完、下一批还没添加」的间隙
 * 被快照成 100%，导致 collection 已完成后仍显示「成功」而非「媒体下载中」。
 * 采集完成后（status !== 'active'）再单调缓存、锁定，仍然能避免快照间隙回退。 */
function syncMediaFlags(
    ctx: PanelContext,
    mediaByModule: Record<string, { overallPercent: number; totalTasks: number }> | null | undefined,
): void {
    if (!mediaByModule) return;
    for (const [mod, mp] of Object.entries(mediaByModule)) {
        if (mp && mp.totalTasks > 0) {
            const st = ctx.moduleMap.get(mod);
            if (st) {
                st.hasMediaTasks = true;
                // 仅在非采集阶段缓存/锁定：逐相册/逐页增量添加任务的模块，
                // 活跃期可能出现「当前批次已完成」的瞬时 100%，此时不能永久锁定。
                if (st.status !== 'active') {
                    if (typeof mp.overallPercent === 'number') {
                        // 单调缓存：只增不减，杜绝快照间隙回退造成条形抖动
                        st.lastMediaPct = Math.max(st.lastMediaPct ?? 0, mp.overallPercent);
                    }
                    // overallPercent 仅在 DM settled 时才到 100（见 manager.displayPercent），
                    // 一旦到 100 即永久锁定 mediaSettled，杜绝后续快照抖动把模块条翻回「下载中」。
                    if (mp.overallPercent >= 100) st.mediaSettled = true;
                }
            }
        }
    }
}

/** 单条模块进度条 HTML（纯函数，便于单测绿/红分段逻辑，不直接触碰 DOM） */
export function buildModuleBar(mod: string, st: ModState): string {
    return moduleBarHtml(buildModuleBarData(mod, st));
}

/** 渲染模块进度条（始终完整展示全部模块，并按状态区分：无权限 / 未选择 / 未开始 / 进行中） */
export function renderModuleBars(ctx: PanelContext): void {
    // 始终以 MODULES 全量列表为基准，确保未选中 / 不可备份的模块也出现在进度列表里
    const allModIds: string[] = MODULES.map(m => m.value);
    const container = ctx.ovModulesEl;
    // 取 DM 按模块聚合的媒体进度，用于「采集完成但媒体下载中」时让模块条如实反映下载进度
    // （不提前顶到 100%）。媒体下载由 DM 驱动，与采集流水线事件解耦，故在此取一次快照。
    const dm = getDM();
    const mediaByModule = dm?.moduleProgressMap ? dm.moduleProgressMap() : null;
    // 持久标记「该模块有媒体任务」+ 缓存最新媒体进度：DM 一旦聚合到即永久为 true，
    // 使「采集完成 + 媒体下载中」态不依赖本帧快照，杜绝快照间隙触发 done↔active 重建闪烁。
    syncMediaFlags(ctx, mediaByModule);
    if (allModIds.length === 0) {
        const empty = '<div style="grid-column:1/-1;display:flex;justify-content:center;color:#94a3b8;font-size:12px;padding:16px 0;">备份开始后将展示各模块进度…</div>';
        if (container.innerHTML !== empty) container.innerHTML = empty;
        return;
    }
    // selectedModules 缺省（旧调用方）时退化为「全部选中」，避免误标「未选择」
    const selectedSet = new Set(
        (ctx.selectedModules && ctx.selectedModules.length) ? ctx.selectedModules : allModIds
    );
    const isOtherSpace = !!ctx.isOtherSpace;

    // 选中模块优先排前（按 MODULES 固定顺序），未选中/无权限模块排后，消除割裂感
    const orderedModIds = allModIds
        .filter(m => selectedSet.has(m))
        .concat(allModIds.filter(m => !selectedSet.has(m)));

    const dataFor = (mod: string): ModuleBarData => {
        // 1) 他人空间 + 私有模块（日记/好友/收藏）→ 无权限，无法备份
        if (isOtherSpace && isModulePrivate(mod)) {
            return buildModulePlaceholderData(mod, 'noperm');
        }
        const st = ctx.moduleMap.get(mod);
        // 2) 已选中且已开始采集 → 真实进度条（含 进行中/成功/失败）
        if (st) return buildModuleBarData(mod, st);
        // 3) 已选中但尚未开始 → 未开始
        if (selectedSet.has(mod)) {
            return buildModulePlaceholderData(mod, 'idle');
        }
        // 4) 本次未勾选 → 未选择
        return buildModulePlaceholderData(mod, 'unselected');
    };

    // 测试 mock 可能没有 children/replaceChild，回退到全量 innerHTML（保持单测兼容性）
    if (!container.children || typeof container.replaceChild !== 'function') {
        container.innerHTML = orderedModIds.map(mod => moduleBarHtml(dataFor(mod))).join('');
        return;
    }

    // 按模块 diff 更新 DOM：
    // - 位置不对的节点先移动到正确位置（insertBefore，不重建）；
    // - 每个节点一律就地更新 width / text / class（updateModuleBarNode），绝不 replaceChild，
    //   保证进度条节点恒在、蓝色段只向前走（单调），彻底消除「忽隐忽现」闪烁。
    for (let i = 0; i < orderedModIds.length; i++) {
        const mod = orderedModIds[i]!;
        const data = dataFor(mod);
        let child = container.children[i] as HTMLElement | undefined;

        if (!child || child.dataset.mod !== mod) {
            const existing = Array.from(container.children).find(c => (c as HTMLElement).dataset.mod === mod);
            if (existing) {
                container.insertBefore(existing, child || null);
                child = existing as HTMLElement;
            } else {
                const wrapper = document.createElement('div');
                wrapper.innerHTML = moduleBarHtml(data);
                const newChild = wrapper.firstElementChild as HTMLElement;
                container.insertBefore(newChild, child || null);
                child = newChild;
            }
        }

    // 无论状态 / 类型如何变化，一律就地更新（绝不重建节点）：
    // bar 与占位节点的 DOM 结构完全一致（都是 .mod-head + .bar > .fill[ + .fill-fail]），
    // updateModuleBarNode 已能覆盖所有字段（pct 文本、fill 宽度、stg 徽标、mod-extra、fill-fail 增删）。
    // 任何整段 replaceChild 都会让进度条在「旧节点移除 → 新节点插入」之间丢失一帧，
    // 表现为「进度条忽隐忽现」——这正是用户反馈的闪烁。就地更新只改 width/text/class，节点恒在。
    updateModuleBarNode(child, data);
    }
    while (container.children.length > orderedModIds.length) {
        container.removeChild(container.lastChild!);
    }
}

/** 未开始 / 未选择 / 无权限 三类「未产生进度」模块的统一占位条 */
export function buildModulePlaceholder(mod: string, kind: 'idle' | 'unselected' | 'noperm'): string {
    return moduleBarHtml(buildModulePlaceholderData(mod, kind));
}

/** 渲染 Top6 正在下载任务卡片 */
export function renderOverviewTop3(ctx: PanelContext): void {
    const dm = getDM();
    if (!dm || typeof dm.tasksSorted !== 'function') { ctx.ovTop3.innerHTML = '<div class="top3-empty">暂无进行中的下载任务</div>'; return; }
    const raw = dm.tasksSorted();
    const tasks: LiveTask[] = Array.isArray(raw) ? raw : [];
    const list: LiveTask[] = tasks.filter((t: LiveTask) => t && t.state === 'in_progress').slice(0, 6);
    if (list.length === 0) { ctx.ovTop3.innerHTML = '<div class="top3-empty">暂无进行中的下载任务</div>'; return; }
    if (!ctx.ovTop3) return;
    const container = ctx.ovTop3;
    // 按任务 id 复用 DOM 节点（keyed diff），只在首次创建时 innerHTML，
    // 之后的刷新全部就地更新文本/宽度——避免每帧整段 innerHTML 重建导致卡片「消失又出现」。
    const wanted = new Set(list.map(t => String(t.id)));
    Array.from(container.children).forEach(child => {
        const tid = (child as HTMLElement).dataset.tid;
        if (tid && !wanted.has(tid)) child.remove();
    });
    const placeholder = container.querySelector('.top3-empty');
    if (placeholder) placeholder.remove();
    for (const t of list) {
        const id = String(t.id);
        let node = Array.from(container.children).find(c => (c as HTMLElement).dataset.tid === id) as HTMLElement | undefined;
        if (!node) {
            node = document.createElement('div');
            node.className = 'top-card';
            node.dataset.tid = id;
            node.innerHTML = renderTopCard(t);
            container.appendChild(node);
            // 新节点统一用 updateTopCard 初始化动态样式（进度/动画/状态），
            // 避免与 renderTopCard 内联样式重复，也保证 indeterminate 走 class 而非 inline 动画。
            updateTopCard(node, t);
        } else {
            updateTopCard(node, t);
        }
    }
    // 按 list 顺序（tasksSorted 排序）重新排列，保证顺序稳定且不重建节点
    for (const t of list) {
        const node = Array.from(container.children).find(c => (c as HTMLElement).dataset.tid === String(t.id)) as HTMLElement | undefined;
        if (node) container.appendChild(node);
    }
}

/** 就地更新单个下载任务卡（不重建节点，保留进度条动画、消除闪烁） */
function updateTopCard(node: HTMLElement, t: LiveTask): void {
    const done = Number(t.downloadedBytes || 0);
    const total = Number(t.totalBytes || 0);
    const stt = t.state || 'pending';
    const indeterminate = total <= 0 && stt === 'in_progress';
    const pct = indeterminate ? 100 : (total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0);
    const mod = getModuleLabel(t.module);
    const sizeText = total > 0 ? `${fmtBytes(done)}/${fmtBytes(total)}` : (stt === 'in_progress' ? '大小未知' : '—');

    // 进度条：用 class 表达「不确定进度」动画，避免每帧重写 inline 动画导致动画重启闪烁。
    // 尺寸已知时只对 inline width 赋值（同一值浏览器会忽略，不触发 transition 重启）。
    const barEl = node.querySelector('.top-bar') as HTMLElement | null;
    if (barEl) barEl.classList.toggle('is-indeterminate', indeterminate);
    const fillEl = node.querySelector('.top-bar .fill') as HTMLElement | null;
    if (fillEl) fillEl.style.width = indeterminate ? '' : `${pct}%`;

    const nameEl = node.querySelector('.top-name') as HTMLElement | null;
    if (nameEl) {
        const title = t.url || t.name || '未命名文件';
        const name = t.name || '未命名文件';
        if (nameEl.textContent !== name) nameEl.textContent = name;
        if (nameEl.getAttribute('title') !== title) nameEl.setAttribute('title', title);
    }
    const ownerEl = node.querySelector('.top-owner') as HTMLElement | null;
    if (ownerEl) {
        const html = mod ? `<b style="color:#2080f0;font-weight:700;">【${mod}】</b>` : '';
        if (ownerEl.innerHTML !== html) ownerEl.innerHTML = html;
    }
    const stEl = node.querySelector('.st') as HTMLElement | null;
    if (stEl) {
        const html = `<span class="st-dot" style="background:${STATE_COLOR[stt] || '#64748b'}"></span>${STATE_LABEL[stt] || stt}`;
        if (stEl.innerHTML !== html) stEl.innerHTML = html;
    }
    const speedEl = node.querySelector('.top-speed') as HTMLElement | null;
    if (speedEl) { const s = fmtBytes(t.speedBps) + '/s'; if (speedEl.textContent !== s) speedEl.textContent = s; }
    const sizeEl = node.querySelector('.top-size') as HTMLElement | null;
    if (sizeEl && sizeEl.textContent !== sizeText) sizeEl.textContent = sizeText;
}

function renderTopCard(t: LiveTask): string {
    const done = Number(t.downloadedBytes || 0);
    const total = Number(t.totalBytes || 0);
    const stt = t.state || 'pending';
    const track = TRACKER_LABEL[t.trackerType || 'none'] || '未知';
    const mod = getModuleLabel(t.module);
    const thumbStyle = t.thumbUrl ? `background-image:url('${cssEscapeUrl(t.thumbUrl)}');` : '';
    const fallbackIcon = isImageName(t.name) ? '🖼️' : (isVideoName(t.name) ? '🎬' : '📦');
    const sizeText = total > 0 ? `${fmtBytes(done)}/${fmtBytes(total)}` : (stt === 'in_progress' ? '大小未知' : '—');
    // 进度条内联只放占位 .fill（无动画/无 inline width）；具体的「确定/不确定进度」样式
    // 交给 updateTopCard 通过切换 .is-indeterminate class 统一处理，避免每帧重写 inline
    // 动画导致动画重启闪烁。
    return `<div class="top-thumb" style="${thumbStyle}">${t.thumbUrl ? '' : fallbackIcon}</div>
        <div class="top-body">
            <div class="top-name" title="${escapeAttr(t.name || t.url)}">${escapeHtml(t.name || '未命名文件')}</div>
            <div class="top-owner">${mod ? '<b style="color:#2080f0;font-weight:700;">【' + mod + '】</b>' : ''}</div>
            <div class="top-meta">
                <span class="st"><span class="st-dot" style="background:${STATE_COLOR[stt] || '#64748b'}"></span>${STATE_LABEL[stt] || stt}</span>
                <span>${track}</span>
                <span class="top-speed">${fmtBytes(t.speedBps)}/s</span>
                <span class="top-size">${sizeText}</span>
            </div>
            <div class="top-bar"><div class="fill"></div></div>
        </div>`;
}
