/**
 * 完成横幅渲染器。
 *
 * 【为什么单独抽出来】
 * 横幅原先是在 `api.ts` 的 `complete()` 里就地写死的一次性快照：采集阶段一结束
 * 就把「已完成 X/Y、失败 N」拍进 DOM，之后再不更新。但媒体下载是异步的，
 * complete 之后还会跑很久 —— 于是横幅永远冻结在采集结束那一刻，出现：
 *   · 横幅「已完成 157/393，仍在进行」，媒体页签实际已完成 380+
 *   · 下载队列早已跑空，横幅却还在说「仍在进行」，不会自愈
 *
 * 修复思路：把「快照写死」改成「纯函数 + 每帧重算」。
 * {@link buildCompletionBanner} 不碰 DOM、只依赖传入的进度快照，
 * 因此既可被渲染循环反复调用，也可直接单测。
 */

import { getDM } from '../dm';
import type { DmProgress } from '../dm';
import type { PanelContext } from '../context';
import { fmtDuration } from '../utils';

/** 备份完成时的上下文（来自 `complete(result)`，全程不变） */
export interface CompletionInfo {
    mode: 'zip' | 'directory';
    needMerge?: boolean;
    mediaLinkMode?: boolean;
}

/** 横幅渲染结果 */
export interface BannerView {
    cls: 'ok' | 'warn';
    /** 横幅正文 */
    text: string;
    /** 顶部状态行文案 */
    statusText: string;
}

/**
 * 依据「当前」进度快照生成横幅文案（纯函数，可反复调用）。
 *
 * 完成判定一律用 `isSettled`（计数）而非百分比 —— 百分比经过四舍五入，
 * 999/1000 会显示成 100%，据此判定会宣布假完成。
 *
 * @param info 备份完成上下文（mode / needMerge / mediaLinkMode）
 * @param gp   **实时**进度快照；为 null 时退化为不带计数的保守文案
 */
export function buildCompletionBanner(info: CompletionInfo, gp: DmProgress | null): BannerView {
    const total = gp?.totalTasks ?? 0;
    const doneDl = gp?.succeeded ?? 0;
    const failedDl = gp?.failed ?? 0;
    const unsettled = gp?.unsettled ?? 0;
    // 无 gp（旧 DM 实例）时不敢断言「还在下载」，按已结束处理，避免横幅永久卡在「进行中」
    const dlSettled = gp?.isSettled ?? true;
    // 未结论任务是否全部处于暂停态 —— 给出「已暂停」而非「进行中」的诚实文案
    const allPaused = unsettled > 0 && (gp?.paused ?? 0) >= unsettled;

    const hasDownloads = !info.mediaLinkMode; // 外链模式不下载本地文件

    let cls: 'ok' | 'warn' = 'ok';
    let text = '';
    let statusText = '备份完成。';

    if (info.mediaLinkMode) {
        text = '备份完成！文件已保存，媒体使用QQ空间外链，无需本地媒体文件。打开备份目录中的 index 即可查看。';
    } else if (hasDownloads) {
        if (!dlSettled) {
            cls = 'warn';
            text = allPaused
                ? `文案采集已完成，媒体文件下载已暂停（已完成 ${doneDl}/${total}，失败 ${failedDl}，待处理 ${unsettled}）。可在「媒体」页签点击「继续」恢复下载。`
                : `文案采集已完成，媒体文件下载进行中（已完成 ${doneDl}/${total}，失败 ${failedDl}，待处理 ${unsettled}）。可在「媒体」页签查看实时进度。`;
            statusText = allPaused ? '文案采集完成，媒体下载已暂停。' : '文案采集完成，媒体下载中…';
        } else if (failedDl > 0) {
            cls = 'warn';
            text = `备份完成！但 ${failedDl} 个媒体文件下载失败（已完成 ${doneDl}/${total}）。可在「媒体」页签点击「重试失败」补下，失败项不影响已备份网页内容。`;
            statusText = '备份完成，存在下载失败项。';
        } else {
            text = '备份完成！数据已保存，全部媒体文件下载成功。';
        }
    } else {
        text = '备份完成！文件已直接保存到你选择的目录。';
    }

    if (info.mode === 'directory') {
        // 合并提示只在下载真正结束后给出：下载中就催用户搬文件会导致搬到一半
        if (info.needMerge && dlSettled) {
            text += ' ⚠️ 媒体由外部下载器下载在其它目录，需把媒体文件合并回备份目录，否则查看备份时图片/视频无法显示。';
        }
    } else {
        // zip 模式：横幅换成「打包下载」引导，但内嵌的下载态描述同样需要实时
        const mediaPart = !dlSettled
            ? (allPaused ? '媒体下载已暂停 ' : '媒体下载进行中 ') + doneDl + '/' + total
            : (failedDl > 0 ? '有 ' + failedDl + ' 个下载失败' : '媒体已下载');
        text = hasDownloads
            ? `文案采集完成（${mediaPart}）。请点击下方「打包下载」按钮下载备份压缩包。`
            : '文案采集完成，请点击下方「打包下载」按钮下载备份压缩包。';
    }

    return { cls, text, statusText };
}

/**
 * 把横幅写入 DOM。**每帧渲染都会调用**，采集结束后横幅即随下载进度实时自愈。
 *
 * 未完成采集（`ctx.completion` 未设置）时直接返回，避免覆盖采集阶段的提示。
 */
export function renderCompletionBanner(ctx: PanelContext): void {
    const info = ctx.completion;
    if (!info) return;
    const dm = getDM();
    const gp = (dm && typeof dm.globalProgress === 'function') ? dm.globalProgress() : null;
    const view = buildCompletionBanner(info, gp);
    ctx.bannerEl.className = 'panel-banner ' + view.cls;
    ctx.bannerEl.textContent = view.text;
    // 主状态行由 api.ts 的 complete() 清空，不再在此写入，避免完成信息两处重复

    // 完成横幅追加「本次备份总耗时」：备份开始(选目录) → complete() 的墙钟时长，
    // 与顶部「已用时」同源同口径（fmtDuration，输出 Xs / Xm Ys / Xh Ym）。
    // 仅在整备真正结束（媒体已 settled / 外链模式无需下载）时显示，
    // 避免「媒体下载进行中」阶段就提前把总耗时拍死、与「下载中」文案矛盾。
    const trulyDone = (gp?.isSettled ?? true) || info.mediaLinkMode;
    let elapsedEl = ctx.bannerEl.querySelector('.banner-elapsed') as HTMLElement | null;
    if (trulyDone && ctx.startedAt != null && ctx.finishedAt != null) {
        const elapsedText = '本次备份总耗时 ' + fmtDuration(ctx.finishedAt - ctx.startedAt);
        if (!elapsedEl) {
            elapsedEl = document.createElement('div');
            elapsedEl.className = 'banner-elapsed';
            // 自包含内联样式：独立成行、弱化字号，亮/暗主题均靠 opacity 适配，无需改 styles.ts
            elapsedEl.style.cssText = 'margin-top:6px;font-size:12px;font-weight:400;opacity:.85;';
            ctx.bannerEl.appendChild(elapsedEl);
        }
        if (elapsedEl.textContent !== elapsedText) elapsedEl.textContent = elapsedText;
    } else if (elapsedEl) {
        elapsedEl.remove();
    }
}
