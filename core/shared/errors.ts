/**
 * 错误分类体系（P7）
 *
 * 采集期的错误原先只以「一句 message 字符串」在事件与日志里流转，UI 只能笼统提示
 * 「请求发生错误」。这里把错误归入有限的几类，使得：
 * - 日志能带上分类，导出后一眼看出是网络问题还是登录失效
 * - UI 能按类给针对性提示（未登录→重新登录；限流→稍后再试；超时→检查网络）
 * - 备份结束可按分类/模块做错误汇总
 *
 * 归类只依据「抛出的 Error message」与「业务返回的 code」，不依赖运行环境，便于单测。
 */

export type ErrorCategory =
    | 'network' // 网络/连接失败或服务端 5xx
    | 'timeout' // 接口请求超时（AbortController 触发）
    | 'auth' // 未登录 / 登录态失效，需要重新登录
    | 'permission' // 无访问权限（如加密内容、-4009）
    | 'rateLimit' // 使用人数过多，需稍后再试
    | 'business' // 接口返回 code != 0 的其它业务错误
    | 'parse' // 响应解析失败
    | 'cancelled' // 用户主动取消
    | 'unknown'; // 未能归类

export interface ClassifiedError {
    category: ErrorCategory;
    /** 面向用户的中文说明（含处理建议） */
    userMessage: string;
    /** 原始错误信息（诊断用） */
    raw: string;
}

/** 各分类的用户可读说明与处理建议 */
const CATEGORY_MESSAGE: Record<ErrorCategory, string> = {
    network: '网络连接异常，请检查网络后重试',
    timeout: '网络请求超时，可能网络较慢或空间响应缓慢',
    auth: '登录状态已失效，请重新登录 QQ 空间后再备份',
    permission: '没有访问权限，该内容可能已加密或仅主人可见',
    rateLimit: '操作过于频繁，QQ 空间提示稍后再试',
    business: '数据返回异常',
    parse: '响应内容解析失败',
    cancelled: '备份已取消',
    unknown: '发生未知错误',
};

/** 取分类的用户可读说明 */
export function describeCategory(category: ErrorCategory): string {
    return CATEGORY_MESSAGE[category];
}

/**
 * 依据业务返回码归类
 * QZone 常见码：-3000 未登录、-4009 无权限、-10000 使用人数过多
 */
export function classifyCode(code: number, message?: string): ErrorCategory {
    if (!code || code === 0) {
        return 'business'; // 调用方应只在确有异常时调用；code 0 不该到这里
    }
    if (code === -4009) {
        return 'permission';
    }
    if (code === -3000) {
        return 'auth';
    }
    if (code === -10000 || (message && message.indexOf('使用人数过多') > -1)) {
        return 'rateLimit';
    }
    return 'business';
}

/** 从任意抛出的错误里取出 message 文本 */
function messageOf(error: unknown): string {
    if (error instanceof Error) {
        return error.message || error.name;
    }
    if (error === null || error === undefined) {
        return String(error);
    }
    if (typeof error === 'object') {
        const msg = (error as { message?: unknown }).message;
        return typeof msg === 'string' ? msg : String(error);
    }
    return String(error);
}

/** 从错误里取 name（用于识别 CancelledError/AbortError） */
function nameOf(error: unknown): string {
    return error instanceof Error ? error.name : '';
}

/** 从错误里取结构化业务码（存在时优先用于归类，比 message 字符串稳定） */
function codeOf(error: unknown): number | undefined {
    if (error && typeof error === 'object') {
        const c = (error as { code?: unknown }).code;
        if (typeof c === 'number') return c;
    }
    return undefined;
}

/**
 * 归类一个抛出的错误
 * 优先依据结构化 code（接口返回码/显式附加的属性），稳定且不受文案变更影响；
 * 仅当 code 缺失时才退回 message 文本模式匹配。
 */
export function classifyError(error: unknown): ClassifiedError {
    const raw = messageOf(error);
    const code = codeOf(error);
    if (code !== undefined) {
        const category = classifyCode(code, raw);
        return { category, userMessage: describeCategory(category), raw };
    }
    const name = nameOf(error);
    const category = detectCategory(name, raw);
    return { category, userMessage: describeCategory(category), raw };
}

/** 按 name + message 判定分类（顺序敏感：先判最具体的） */
function detectCategory(name: string, raw: string): ErrorCategory {
    if (name === 'CancelledError' || raw.indexOf('已取消') > -1) {
        return 'cancelled';
    }
    if (name === 'AbortError' || raw.indexOf('请求超时') > -1) {
        return 'timeout';
    }
    if (raw.indexOf('使用人数过多') > -1) {
        return 'rateLimit';
    }
    if (/未登录|登录态|登录已失效|重新登录/.test(raw)) {
        return 'auth';
    }
    if (/无权限|无访问权限|权限不足/.test(raw)) {
        return 'permission';
    }
    // 网络类：fetch 失败、DNS、连接中断、CSP 等浏览器错误
    if (/failed to fetch|networkerror|net::|err_|load failed|连接|网络/i.test(raw)) {
        return 'network';
    }
    // HTTP 状态：401/403 视为登录/权限，5xx 视为服务端网络问题
    const http = /^HTTP\s+(\d{3})/.exec(raw);
    if (http) {
        const status = Number(http[1]);
        if (status === 401 || status === 403) {
            return 'auth';
        }
        if (status >= 500) {
            return 'network';
        }
        return 'business';
    }
    if (name === 'QuotaExceededError' || raw.indexOf('QuotaExceeded') > -1) {
        return 'business'; // 存储配额超限，归为业务类（备份数据量过大导致 IndexedDB 满载）
    }
    if (raw.indexOf('解析') > -1 || raw.indexOf('JSON') > -1) {
        return 'parse';
    }
    // 业务码形式（code=-xxxx）归为业务错误
    if (/code\s*=\s*-?\d+/i.test(raw)) {
        return 'business';
    }
    return 'unknown';
}
