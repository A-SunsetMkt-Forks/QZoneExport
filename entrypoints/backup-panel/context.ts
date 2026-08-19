/**
 * 备份面板渲染上下文（共享 DOM 引用与状态）
 *
 * 所有 renderer 函数通过此上下文访问 DOM 元素和共享状态，
 * 替代原来 createPanel() 闭包中的局部变量。
 */

import type { PanelAction } from './types';
import type { CompletionInfo } from './renderers/banner';

export type LiveTask = any; // 跟 DM 的类型保持宽松即可

export interface PanelContext {
    /* === DOM 引用 === */
    shadow: ShadowRoot;
    $: (sel: string) => HTMLElement;
    $$: (sel: string) => HTMLElement[];

    statusEl: HTMLElement;
    /** 聚合通知容器（替代原 panel-error） */
    notificationsEl: HTMLElement;
    bannerEl: HTMLElement;
    footerEl: HTMLElement;
    downloadBtn: HTMLButtonElement;
    closeBtn: HTMLButtonElement;
    headerClose: HTMLButtonElement;
    /** 页签容器（.panels）：用于测量并固定统一高度，切换页签不再跳动 */
    panelsEl: HTMLElement;

    sTotal: HTMLElement;
    sOk: HTMLElement;
    sRun: HTMLElement;
    sFail: HTMLElement;
    sPause: HTMLElement;
    sWait: HTMLElement;

    ovPct: HTMLElement;
    ovBytes: HTMLElement;
    ovSpeed: HTMLElement;
    /** 总耗时标签（备份开始 → 完成 的墙钟时长，实时走字） */
    ovElapsed: HTMLElement;
    ovFill: HTMLElement;
    ovModsTag: HTMLElement;
    /** 进度条失败段（红色斜纹），与 ovFill 拼成「处理进度」 */
    ovFillFail: HTMLElement;
    /** 进度条下方口径说明文案 */
    ovProgressNote: HTMLElement;
    ovModulesEl: HTMLElement;
    ovTop3: HTMLElement;
    cOv: HTMLElement;
    cMedia: HTMLElement;
    cLog: HTMLElement;

    mediaTable: HTMLElement;
    mediaTbody: HTMLElement;
    mediaChkAll: HTMLInputElement;
    mediaPageInfo: HTMLElement;
    mediaPageSize: HTMLSelectElement;
    mediaPageButtons: HTMLElement;
    mediaSearch: HTMLInputElement;
    stateFilterGroup: HTMLElement;
    typeFilterGroup: HTMLElement;
    mediaSortSel: HTMLSelectElement;
    mediaModuleFilterSel: HTMLSelectElement;
    btnPause: HTMLButtonElement;
    btnResume: HTMLButtonElement;
    btnRetry: HTMLButtonElement;
    btnCancel: HTMLButtonElement;

    /** 采集明细 Tab */
    detailTbody: HTMLElement;
    detailPageInfo: HTMLElement;
    detailPageSize: HTMLSelectElement;
    detailPageButtons: HTMLElement;
    detailSearch: HTMLInputElement;
    detailStateFilterGroup: HTMLElement;
    detailModuleFilterSel: HTMLSelectElement;
    btnRetryDetail: HTMLButtonElement;
    cDetail: HTMLElement;

    levFilterGroup: HTMLElement;
    logSearch: HTMLInputElement;
    logList: HTMLElement;
    btnClearLog: HTMLButtonElement;
    btnExportLogTxt: HTMLButtonElement;
    btnExportLogJson: HTMLButtonElement;

    dirCtaEl: HTMLElement;
    dirCtaBtn: HTMLButtonElement;

    /* === 状态 === */
    currentTab: 'ov' | 'media' | 'log' | 'detail' | 'about';
    stateFilter: string;
    mediaTypeFilter: string;
    mediaModuleFilter: string;
    mediaSort: string;
    levFilter: 'ALL' | 'INFO' | 'WARN' | 'ERROR';
    mediaKeyword: string;
    logKeyword: string;
    selectedMediaIds: Set<string>;
    moduleMap: Map<string, ModState>;
    /** 总模块数：用户在备份弹窗选择模块时即确定，不随已完成模块递增（见 #7） */
    totalModules?: number;
    /** 用户勾选的模块标识列表（概览展示全部模块用，含未开始状态） */
    selectedModules?: string[];
    /** 是否他人空间：决定私有模块（日记/好友/收藏）标注「无权限」而非「未选择」 */
    isOtherSpace?: boolean;

    mediaCurrentPage: number;
    mediaPageSizeOpts: number[];
    mediaPageSizeVal: number;

    /** 采集明细 Tab 状态 */
    detailCurrentPage: number;
    detailPageSizeOpts: number[];
    detailPageSizeVal: number;
    detailStateFilter: string;
    detailModuleFilter: string;
    detailKeyword: string;

    /** 当前已渲染筛选条件指纹（state/type/keyword/sort/pageSize 拼接），变化时全量重建 */
    _mediaFilterKey?: string;
    /** 已加载到 DOM 的 task id 集合（增量更新时跳过重建，仅刷新进度/状态） */
    _mediaLoadedIds?: Set<string>;
    /** 是否正在追加加载（滚动到底触发），避免与全量重建竞态 */
    _mediaAppending?: boolean;

    /**
     * 备份完成上下文。`complete()` 触发后写入，作为「横幅需要持续重渲染」的开关。
     *
     * 媒体下载在采集结束后仍会继续跑，横幅里的「已完成 X/Y」必须跟着刷新，
     * 否则会永久停留在采集结束那一刻，与实时的「媒体」页签对不上（见 banner.ts）。
     */
    completion?: CompletionInfo;

    /**
     * 收尾中标志：下载环节已全部出结论（总进度已到 100%），但「整理备份文件」
     * （生成查看器 + 合并外部文件）尚未完成、complete() 尚未调用的窗口期。
     *
     * 用途：避免「总进度 100% 却仍显示『正在整理备份文件』」的矛盾画面。
     * 此期间总进度压在 99%，主状态行持续显示整理提示；complete() 调用后
     * 置 false，进度放行到 100% 并弹出完成横幅。
     */
    finalizing?: boolean;

    /** 备份开始时刻（ms）：选目录后备份真正开始的锚点；未开始为 undefined */
    startedAt?: number;
    /** 备份结束时刻（ms）：complete()/error() 冻结耗时展示的锚点；进行中为 undefined */
    finishedAt?: number;

    actionCb: ((action: PanelAction) => void) | null;
    dmUnsubscribe: (() => void) | null;

    /** 页签统一固定高度（px）：以「概览」页签为基准测量，所有页签共用，切换时整体高度稳定 */
    panelsHeight?: number;
}

/** 模块状态缓存（用于 Overview 模块进度条） */
export type ModState = {
    status: 'idle' | 'active' | 'done' | 'fail';
    phases: Record<string, { done: number; total: number; failed?: number }>;
    /** 主体对齐进度（采集层改造：由 collector 经 report 显式上报 subject，聚合层直接读，不靠猜 phase 名）。SUBJECT_CONFIG 仅作兼容回退（resume 旧 checkpoint 无 subject 数据时）。 */
    subject?: Record<string, { done: number; total: number }>;
    currentPhase?: string;
    currentPhaseLabel?: string;
    /**
     * 锁定「采集完成 + 媒体下载中」：module-complete 时若 DM 已聚合到该模块媒体任务则置 true，
     * 之后无论 DM 快照是否短暂缺失该模块，都保持「下载中」(active) 直到媒体 overallPercent
     * 真正到 100，杜绝 active↔done 反复切换造成的进度条闪烁；且不会在媒体未完时误报 100%。
     * 注意：该标记依赖「置位时机 DM 恰好已聚合到媒体」才可靠，故另设 hasMediaTasks 作稳定事实。
     */
    mediaDownloading?: boolean;
    /**
     * 该模块是否存在媒体下载任务（稳定事实）：渲染层在 DM 聚合到其任务时即永久置 true，
     * 不依赖「本帧 DM 快照是否含该模块」。一旦媒体任务进过 DM 就永远为真，
     * 从而「采集完成 + 媒体下载中」态能稳定保持「下载中」(active)，
     * 不因快照间隙在 done↔active 间反复切换导致进度条重建闪烁（这是前几轮闪烁的根因）。
     */
    hasMediaTasks?: boolean;
    /** 最近一次从 DM 读到的该模块媒体整体进度（%）；DM 快照缺失时回落到该值，避免进度条回退重长 */
    lastMediaPct?: number;
    /**
     * 媒体是否「真正下载完成」的单调标记：overallPercent 仅在 DM settled 时才到 100，
     * 一旦到 100 即永久为 true，绝不回退。这是消灭进度条闪烁的关键——
     * 「下载中(active)→已完成(done)」只发生一次，不会因为任务边界处 overallPercent 瞬时 99↔100 抖动
     * 或快照间隙在 active↔done 间反复翻转（renderModuleBars 现已改为永远就地更新、绝不 replaceChild，
     * 节点恒在；且媒体进度单调只增，蓝色段不会来回伸缩 → 不会再出现「丢失又出现」）。
     */
    mediaSettled?: boolean;
};
