import { toJson } from '../shared/utils';
import { REST_URLS, type RestUrlKey } from './urls';
import type { QzoneApiResponse } from './types';

/**
 * 请求器重试配置（对应 QZone_Config.Common 中的同名项）
 */
export interface RetryConfig {
    /** 重试次数 */
    listRetryCount: number;
    /** 重试间隔（秒） */
    listRetrySleep: number;
    /** 稍后重试次数（接口限流场景） */
    waitCount: number;
    /** 稍后重试间隔（秒） */
    waitTime: number;
    /** 命中「使用人数过多」时切换为稍后重试的接口清单（REST_URLS键名） */
    RestSleepUrls: RestUrlKey[];
    /**
     * 接口请求超时（秒）
     * 旧版 $.ajax 未设 timeout，接口一旦挂起会永久卡住整个采集；这里用 AbortController
     * 给每次 fetch 加超时，超时按可重试错误并入重试循环。0 或未配置表示不限时（保持旧行为）。
     */
    requestTimeout?: number;
}

/** 请求参数值类型 */
export type ParamValue = string | number | undefined;

/** 重试事件（供UI显示错误提示，替代旧版直接操作 #errorTips DOM） */
export interface RequestEvents {
    onRetry?: (info: { url: string; message: string; retryAt: number; remain: number; code?: number; inFlight?: number; api?: string }) => void;
    onGiveUp?: (info: { url: string; message: string; code?: number; api?: string }) => void;
    onRecover?: (info: { url: string }) => void;
}

export interface RequesterOptions {
    config: () => RetryConfig;
    events?: RequestEvents;
    /** 可注入的fetch实现（测试用） */
    fetchFn?: typeof fetch;
    /** 可注入的等待实现（测试免等待） */
    sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** rest 模式（-10000/「使用人数过多」）单页重试睡眠硬上限（毫秒），防止 waitTime 过大冻结整备 */
const MAX_REST_WAIT_MS = 60_000;

/** 单次请求的可选项 */
export interface RequestOptions {
    /**
     * 响应编码（如 gb2312）
     * 不传时按「响应头 charset → HTML meta charset → utf-8」顺序探测
     */
    charset?: string;
}

/**
 * 探测响应编码
 * fetch 的 Response.text() 恒按 UTF-8 解码、无视 Content-Type 的 charset（与 XHR 的
 * responseText 不同），而部分接口返回 GBK 系编码（如日志详情 outCharset=gb2312），
 * 因此必须自行探测并解码，否则中文全成乱码
 */
function detectCharset(contentType: string | null, buffer: ArrayBuffer): string {
    const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || '');
    if (fromHeader) {
        return fromHeader[1]!;
    }
    // 响应头没声明时，从HTML头部的 meta 探测（meta 本身是ASCII，用UTF-8解码不影响匹配）
    const head = new TextDecoder('utf-8').decode(buffer.slice(0, 1024));
    const fromMeta = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head);
    if (fromMeta) {
        return fromMeta[1]!;
    }
    return 'utf-8';
}

/** 按指定编码解码响应体，编码不被支持时回退UTF-8 */
function decodeBuffer(buffer: ArrayBuffer, charset: string): string {
    try {
        return new TextDecoder(charset).decode(buffer);
    } catch {
        console.warn('不支持的响应编码，已按UTF-8解码', charset);
        return new TextDecoder('utf-8').decode(buffer);
    }
}

/**
 * 从 URL 提取简短接口标识（取 host + 末段路径），用于重试日志诊断「剩余N」来自哪个接口。
 * 任何异常都回退到截断的 url 原文，绝不抛出。
 */
function safeApiLabel(url: string): string {
    try {
        const u = new URL(url);
        const seg = u.pathname.split('/').filter(Boolean).pop() || u.pathname;
        const q = u.search ? u.search.slice(1, 48) : '';
        return u.host + '/' + seg + (q ? '?' + q : '');
    } catch {
        return url.slice(0, 80);
    }
}

/**
 * 序列化GET参数
 */
export function serializeParams(params?: Record<string, ParamValue>): string {
    if (!params) {
        return '';
    }
    const parts: string[] = [];
    for (const key of Object.keys(params)) {
        const value = params[key];
        if (value === undefined) {
            continue;
        }
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
    }
    return parts.join('&');
}

/**
 * 统一请求器
 * 语义移植自 api.js API.Utils.get（L563-645）：
 * - HTTP错误与业务code非0（-4009权限问题除外）时重试，重试间隔listRetrySleep
 * - 命中 -10000/「使用人数过多」且URL在RestSleepUrls清单时，切换为 waitCount×waitTime 的长间隔重试（仅切换一次）
 * - 响应非JSON时视作成功返回原文（如HTML详情页）
 */
export class Requester {
    private readonly options: RequesterOptions;
    /** 当前在途请求数（诊断用：判断「剩余N」刷屏是单循环还是大量并发） */
    private inFlightCount = 0;

    constructor(options: RequesterOptions) {
        this.options = options;
    }

    /**
     * GET请求，返回原始文本（与旧版一致，由调用方自行toJson）
     * @param options 可指定响应编码；不传则自动探测（见 detectCharset）
     */
    async get(url: string, params?: Record<string, ParamValue>, options?: RequestOptions): Promise<string> {
        const cfg = this.options.config();
        const events = this.options.events || {};
        const fetchFn = this.options.fetchFn || fetch;
        const sleepFn = this.options.sleepFn || defaultSleep;

        const query = serializeParams(params);
        const fullUrl = query ? url + (url.indexOf('?') === -1 ? '?' : '&') + query : url;
        const api = safeApiLabel(fullUrl);
        // 诊断：记录在途请求数，onRetry 时一并上报，用于区分「单循环重试」与「大量并发请求各自重试」
        this.inFlightCount++;
        const releaseInFlight = () => { this.inFlightCount = Math.max(0, this.inFlightCount - 1); };

        let waitCount = cfg.listRetryCount;
        let waitTime = cfg.listRetrySleep * 1000;
        // 这次请求是否已切换为长间隔重试
        let isWaitTimeRest = false;

        // 硬上限：无论 listRetryCount / waitCount 如何配置，单次 get 的总尝试次数都有界，
        // 防止「稍候重试」与「-10000/使用人数过多」组合下因 waitTime 过大导致单请求卡死数小时。
        const maxAttempts = Math.max(1, cfg.listRetryCount) + Math.max(0, cfg.waitCount) + 3;
        let attempts = 0;

        // 首次请求 + waitCount 次重试
        try {
        let lastReason = ''; // 最近一次失败的真实原因（诊断用，供 maxAttempts 兜底分支携带）
        while (true) {
            let message = '未知错误';
            let lastCode: number | undefined; // 最近一次响应的业务码，供回调透传给分类器（F7）
            attempts++;
            if (attempts > maxAttempts) {
                const reason = lastReason || message;
                events.onGiveUp && events.onGiveUp({ url, message: '重试次数过多，已放弃', code: lastCode, api });
                throw new Error('重试次数过多，已放弃: ' + reason);
            }
            try {
                const response = await this.fetchWithTimeout(fetchFn, fullUrl, cfg.requestTimeout);
                // 按响应实际编码解码（不能用 response.text()，它恒按UTF-8解码）
                const buffer = await response.arrayBuffer();
                const charset = options?.charset || detectCharset(response.headers.get('content-type'), buffer);
                const text = decodeBuffer(buffer, charset);
                if (!response.ok) {
                    message = 'HTTP ' + response.status;
                } else {
                    let resJson: QzoneApiResponse;
                    try {
                        resJson = toJson(text);
                        lastCode = resJson.code; // F7: 记录业务码透传给回调
                    } catch {
                        // 转换JSON错误时，当作成功返回（如日志详情返回HTML）
                        events.onRecover && events.onRecover({ url });
                        return text;
                    }
                    // 0 正常场景；-4009 权限问题，无需重试
                    if (!resJson.code || resJson.code == 0 || resJson.code == -4009) {
                        events.onRecover && events.onRecover({ url });
                        return text;
                    }
                    message = resJson.message || 'code=' + resJson.code;
                    if (resJson.code === -10000 || resJson.message === '使用人数过多，请稍后再试') {
                        if (!isWaitTimeRest) {
                            // 重试之后仍返回重试，次数不该重置
                            for (const cfgUrlKey of cfg.RestSleepUrls) {
                                if (REST_URLS[cfgUrlKey] && url.includes(REST_URLS[cfgUrlKey])) {
                                    isWaitTimeRest = true;
                                    break;
                                }
                            }
                            if (isWaitTimeRest) {
                                // 请稍候重试专用时间间隔（夹到上限，避免单页重试睡数小时冻结备份）
                                waitCount = cfg.waitCount;
                                waitTime = Math.min(cfg.waitTime, MAX_REST_WAIT_MS / 1000) * 1000;
                            }
                        }
                    }
                }
            } catch (error: any) {
                message = (error && error.message) || String(error);
            }
            lastReason = message;

                if (waitCount > 0) {
                events.onRetry &&
                    events.onRetry({ url, message, retryAt: Date.now() + waitTime, remain: waitCount, code: lastCode, inFlight: this.inFlightCount, api });
                waitCount--;
                await sleepFn(waitTime);
                continue;
            }
            events.onGiveUp && events.onGiveUp({ url, message, code: lastCode, api });
            throw new Error(message);
        }
        } finally {
            releaseInFlight();
        }
    }

    /**
     * 带超时的 fetch
     * timeout>0 时用 AbortController 到点中止；无论成功失败都清掉定时器，避免泄漏。
     * 中止会让 fetch 抛出 name='AbortError' 的异常，转成「接口请求超时」信息交由上层重试。
     */
    private async fetchWithTimeout(fetchFn: typeof fetch, url: string, timeoutSec?: number): Promise<Response> {
        const timeout = timeoutSec && timeoutSec > 0 ? timeoutSec * 1000 : 0;
        if (!timeout) {
            return fetchFn(url, { method: 'GET', credentials: 'include' });
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            return await fetchFn(url, { method: 'GET', credentials: 'include', signal: controller.signal });
        } catch (error: any) {
            if (error && error.name === 'AbortError') {
                throw new Error('接口请求超时（' + timeoutSec + '秒）', { cause: error });
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * GET并解析JSON（JSONP剥壳）
     */
    async getJson<T = any>(url: string, params?: Record<string, ParamValue>, jsonpKey?: RegExp, options?: RequestOptions): Promise<T> {
        const text = await this.get(url, params, options);
        return toJson<T>(text, jsonpKey);
    }
}
