/**
 * 备份相关的共享常量、类型、存储结构
 *
 * 由 popup/App.vue、qzone-hint.content.ts、options/App.vue 三处共同引用，
 * 避免"默认模块列表、私有模块、下载器名称映射"等关键配置在多处重复维护，
 * 防止将来改一处忘另一处导致的不一致 Bug。
 */

import { DEFAULT_INCREMENT_TIME } from '../collector/increment';

/* ===== 模块配置（与 popup/App.vue 里的 MODULES 完全一致，旧版 content.js 约定一致） ===== */

export interface ModuleConfig {
    /** 模块英文标识（与内容脚本/引擎完全一致，不可改） */
    value: string;
    /** 中文名称，用于界面展示 */
    label: string;
}

export const MODULES: readonly ModuleConfig[] = [
    { value: 'Messages', label: '说说' },
    { value: 'Blogs', label: '日志' },
    { value: 'Diaries', label: '日记' },
    { value: 'Photos', label: '相册' },
    { value: 'Videos', label: '视频' },
    { value: 'Boards', label: '留言' },
    { value: 'Friends', label: '好友' },
    { value: 'Favorites', label: '收藏' },
    { value: 'Shares', label: '分享' },
    { value: 'Visitors', label: '访客' },
] as const;

/** 仅个人空间可备份的私有模块（他人空间时自动置灰） */
export const PRIVATE_MODULES: readonly string[] = ['Diaries', 'Friends', 'Favorites'];

/* ===== 下拉选项（配置页下拉框、弹窗摘要文案 共用的唯一来源） ===== */

/** 下拉选项通用形状（与 naive-ui NSelect / NRadioGroup 的 options 兼容） */
export interface SelectOption {
    label: string;
    value: string;
}

/**
 * 备份产出方式：由运行环境能力决定，用户无需手动选择（「打包方式」/ ZIP 压缩包已整体下线）。
 * - 浏览器支持 File System Access API（Chrome/Edge）→ 直写本地目录
 * - 不支持（Firefox）→ 经 DownloadsBackend 直写下载目录
 * 历史上「手动选 ZIP」的门控 bug 已随 Zip 功能下线和环境驱动方案一并消除，
 * 现在两种后端都直接落盘，不再有「打包下载 ZIP」的产物形态。
 */

/** 媒体处理选项：Download=下载到本地；Link=不下载、内容直接引用外链 */
export const MEDIA_MODE_OPTIONS: SelectOption[] = [
    { label: '下载到本地', value: 'Download' },
    { label: '使用QQ空间外链', value: 'Link' },
];

/**
 * 媒体下载方式选项。
 * 不含历史值 'QZone'（旧版用它表达「不下载、用外链」，loadConfig 已归一化为 mediaMode='Link'），
 * 也不含已淘汰的 'File'。
 */
export const DOWNLOAD_TYPE_OPTIONS: SelectOption[] = [
    { label: '助手直写目录', value: 'Disk' },
    { label: '浏览器下载器', value: 'Browser' },
    { label: 'Aria2协议下载器', value: 'Aria2' },
];

/**
 * 下载方式选项按运行环境过滤：
 * - Firefox：不支持 File System Access API，「助手直写目录」(Disk) 不可用 → 过滤掉，只留 Browser/Aria2。
 *   媒体/文案/查看器统一走 downloads.download 直写下载目录（形态 B：下载目录/QQ空间备份_<uin>/）。
 * - Chrome/Edge：全量保留。
 */
export function downloadTypeOptionsFor(isFirefox: boolean): SelectOption[] {
    if (!isFirefox) return DOWNLOAD_TYPE_OPTIONS;
    return DOWNLOAD_TYPE_OPTIONS.filter((opt) => opt.value !== 'Disk');
}

/** 默认媒体下载方式：Firefox='Browser'（直写目录不可用），Chrome='Disk' */
export function defaultDownloadTypeFor(isFirefox: boolean): string {
    return isFirefox ? 'Browser' : DEFAULT_DOWNLOAD_TYPE;
}

/** 媒体走外链（不下载）时的统一摘要文案 */
export const MEDIA_LINK_TEXT = '不下载，用QQ空间外链';

/**
 * 媒体下载器名称映射（供界面/摘要显示）。
 * 由 DOWNLOAD_TYPE_OPTIONS 派生，确保「配置页下拉框」与「弹窗/popup 摘要」永远同一套文案；
 * 额外补 QZone 历史值，避免老配置在摘要里显示成裸英文。
 */
export const DOWNLOAD_TYPE_LABEL: Readonly<Record<string, string>> = (() => {
    const map: Record<string, string> = {};
    for (const opt of DOWNLOAD_TYPE_OPTIONS) map[opt.value] = opt.label;
    map.QZone = 'QQ空间外链';
    return Object.freeze(map);
})();

/**
 * 公共模块默认值（与 src/js/config.js 的 Default_Config.Common 对齐）。
 *
 * 这是「配置页 / 弹窗 / background 初始化」共用的唯一默认值来源，特意下沉到 core/shared，
 * 避免原先分散在 options/config.ts 内部、与弹窗/background 各自硬编码导致默认值漂移。
 * 任何新增/修改公共默认值都应只改这里。
 */
export const COMMON_DEFAULTS = {
    listRetryCount: 5,
    listRetrySleep: 2,
    waitCount: 2,
    // 稍候重试间隔（秒）。保持较小值：分页备份是顺序逐页采集，若「使用人数过多」(-10000) 触发
    // rest 模式时单页会按 waitTime 睡眠重试，过大的值（旧默认 3600=1小时）会让单页重试卡数小时、
    // 表现为「死循环」并冻结整个备份；失败页交由 ledger 记录、稍后用「重试失败页」补偿即可。
    waitTime: 30,
    // 接口请求超时（秒），0 表示不限时（仅新引擎生效）
    requestTimeout: 30,
    // 导出格式（HTML / MarkDown），彻底全局，各模块不再单独配置
    exportType: 'HTML',
    // 增量备份公共默认（各模块可取消继承、单独配置）
    Increment: { IncrementType: 'Full', IncrementTime: DEFAULT_INCREMENT_TIME },
    // 获取点赞公共默认（默认开启）
    Like: { isGet: true, randomSeconds: { min: 1, max: 2 } },
    // 获取评论公共默认（全模块统一 isGet；默认开启，关闭时仍可能保留列表自带的首页评论）
    Comments: { isGet: true, pageSize: 20, randomSeconds: { min: 1, max: 2 } },
    // 获取最近访客公共默认（默认开启）
    Visitor: { isGet: true, pageSize: 24, randomSeconds: { min: 1, max: 2 } },
    RestSleepUrls: ['MESSAGES_LIST_URL'] as string[],
    AvatarHost: -1,
    mediaMode: 'Download',
    // 媒体下载方式默认「助手直写目录」：媒体由助手直接写入备份目录（与文案同目录、一步到位），
    // 无需像浏览器下载器/Aria2 那样备份完再把外部目录的媒体合并回备份目录。
    downloadType: 'Disk',
    Aria2: { rpc: 'http://localhost:6800/jsonrpc', token: '' as string | undefined, dir: '' as string | undefined },
    isAutoFileSuffix: true,
    // 图片类型识别超时（秒）：对图片 CDN 发 GET 只读 content-type，正常 <500ms 返回；
    // 失效/极慢的 URL 靠此超时兜底，默认 5s（旧值 30s 会让单个失效 URL 拖满 30s，成为媒体登记的大头）
    autoFileSuffixTimeOut: 5,
    // 文件后缀 MIME 探测最大并发数：对图片 CDN 发 GET 读 content-type（不下载 body），
    // 限流阈值远高于 QQ 空间 API，可设得比条目明细并发高一些；探测压力敏感时调小。
    suffixProbeConcurrency: 10,
    downloadThread: 10,
    // 条目级明细（评论/点赞/访客）采集最大并发数：避免单页条目裸 Promise.all 打爆接口与浏览器。
    // 接口易限流的大号可调小（如 3），求快可调大（上限视 Options 输入，建议不超过 30）。
    itemDetailConcurrency: 15,
    downloadSleep: 2,
    hasUserLink: true,

    refererUrls: [
        'gtimg.com',
        'qpic.cn',
        'qq.com',
    ] as string[],
};

/**
 * 关键默认值，直接取 COMMON_DEFAULTS（单一来源，杜绝漂移）。
 * 弹窗 / popup 在读取 sync.Common.* 失败（首次安装、sync 未写入配置）时使用它们兜底。
 */
export const DEFAULT_MEDIA_MODE: string = COMMON_DEFAULTS.mediaMode;
export const DEFAULT_DOWNLOAD_TYPE: string = COMMON_DEFAULTS.downloadType;
export const DEFAULT_EXPORT_TYPE: string = COMMON_DEFAULTS.exportType;

/**
 * 媒体处理方式 → 展示文案（popup 摘要与弹窗摘要共用，避免两处各写一份判断分支）。
 * mediaMode='Link' 或历史 downloadType='QZone' 都表示不下载、只引用外链。
 */
export function mediaSummaryText(mediaMode: string | undefined, downloadType: string | undefined): string {
    if (mediaMode === 'Link' || downloadType === 'QZone') return MEDIA_LINK_TEXT;
    const type = downloadType || DEFAULT_DOWNLOAD_TYPE;
    return DOWNLOAD_TYPE_LABEL[type] || type;
}

/* ===== 自动弹窗行为三态枚举（Section 二 核心状态机） ===== */

export type LaunchPopupBehavior =
    /** 默认态：首次访问弹备份确认弹窗 */
    | 'ask_on_first_visit'
    /** 用户选了「下次不弹出」 → 只弹固定图标引导 */
    | 'show_pin_hint_only'
    /** 永久关闭（设置页里手动选，或关闭固定引导 ≥3 次自动升级） */
    | 'never_auto_popup';

/** 存储 Key（含版本号，后续升级策略时可整体重置） */
export const LAUNCH_FLOW_STORAGE_KEY = 'QZoneExport_LaunchFlow_v1';

export interface LaunchFlowStorage {
    version: 1;
    behavior: LaunchPopupBehavior;
    /** 用户选「下次不弹出」的时间戳（仅排错/统计） */
    optedOutAt?: number;
    /** 固定图标引导被关闭的次数 → 达到 3 次自动升级为 never_auto_popup */
    pinHintDismissCount: number;
    /** 弹窗内「☐ 下次不弹出」复选框的最后一次勾选状态（仅 UI 恢复默认值用） */
    lastOptOutCheckbox?: boolean;
}

export const LAUNCH_FLOW_DEFAULTS: LaunchFlowStorage = {
    version: 1,
    behavior: 'ask_on_first_visit',
    pinHintDismissCount: 0,
};

/** 固定图标引导关闭次数达到该值，自动收敛为不弹窗 */
export const PIN_HINT_AUTO_STOP_THRESHOLD = 3;

/* ===== 便捷工具函数 ===== */

/** 他人空间模式下，该模块是否禁用（私有模块） */
export function isModulePrivate(moduleValue: string): boolean {
    return PRIVATE_MODULES.includes(moduleValue);
}

/** 模块 value → 中文 label 映射（由 MODULES 派生，供 DownloadManager / Panel 等模块消费） */
export const MODULE_LABEL_MAP: Readonly<Record<string, string>> = (() => {
    const map: Record<string, string> = {};
    for (const m of MODULES) map[m.value] = m.label;
    return Object.freeze(map);
})();

/** 根据模块标识获取中文名，未知模块返回原值 */
export function getModuleLabel(value: string): string {
    return MODULE_LABEL_MAP[value] ?? value;
}

/** 返回他人模式下的私有模块中文名列表，用于置灰说明 */
export function getPrivateModuleLabels(): string[] {
    const labelMap = new Map<string, string>();
    for (const m of MODULES) labelMap.set(m.value, m.label);
    return PRIVATE_MODULES.map((v) => labelMap.get(v) ?? v);
}

/** 安全读取 LaunchFlow 配置（缺省/字段缺失/版本不匹配 → 返回默认值） */
export async function readLaunchFlow(): Promise<LaunchFlowStorage> {
    try {
        const stored = await chrome.storage.local.get([LAUNCH_FLOW_STORAGE_KEY]);
        const raw = stored[LAUNCH_FLOW_STORAGE_KEY] as Partial<LaunchFlowStorage> | undefined;
        if (!raw || raw.version !== LAUNCH_FLOW_DEFAULTS.version) {
            return { ...LAUNCH_FLOW_DEFAULTS };
        }
        return {
            ...LAUNCH_FLOW_DEFAULTS,
            ...raw,
            // 强制枚举校验：非法值兜底为默认
            behavior: (['ask_on_first_visit', 'show_pin_hint_only', 'never_auto_popup'].includes(raw.behavior as string)
                ? raw.behavior
                : LAUNCH_FLOW_DEFAULTS.behavior) as LaunchPopupBehavior,
            pinHintDismissCount: typeof raw.pinHintDismissCount === 'number' ? raw.pinHintDismissCount : 0,
        };
    } catch {
        return { ...LAUNCH_FLOW_DEFAULTS };
    }
}

/** 安全写入 LaunchFlow 配置（自动补 version 默认字段） */
export async function writeLaunchFlow(patch: Partial<LaunchFlowStorage>): Promise<LaunchFlowStorage> {
    const current = await readLaunchFlow();
    const next: LaunchFlowStorage = {
        ...current,
        ...patch,
        version: LAUNCH_FLOW_DEFAULTS.version,
    };
    await chrome.storage.local.set({ [LAUNCH_FLOW_STORAGE_KEY]: next });
    return next;
}

/** 将「固定图标引导」关闭次数 +1，达到阈值后自动升级为永不弹窗 */
export async function incrementPinHintDismiss(): Promise<LaunchFlowStorage> {
    const current = await readLaunchFlow();
    const count = current.pinHintDismissCount + 1;
    const reached = count >= PIN_HINT_AUTO_STOP_THRESHOLD;
    return writeLaunchFlow({
        pinHintDismissCount: count,
        behavior: reached ? 'never_auto_popup' : current.behavior,
    });
}
