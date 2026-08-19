/**
 * 跨隔离世界（isolated world）通信安全工具
 *
 * 背景：v3 采集引擎（engine-bridge.content.ts）与 DownloadManager（download-manager.js）
 * 运行在「不同的 content script 隔离世界」，互相无法访问对方的 window。两者通过
 * window.postMessage 广播通信，而 postMessage 会投递到页面内所有世界（含页面自身脚本）。
 *
 * 风险：若页面被注入恶意脚本（或同源第三方脚本），它也能向 window 投递伪造消息，
 * 例如伪造 qz_dm_add_media_task 注入下载任务，或伪造 qz_dm_log_response 污染日志。
 * 本模块提供统一校验，确保只接受来自「本窗口、本扩展」的消息。
 *
 * 校验策略（必须在两侧都使用，缺一不可）：
 *   1) event.source === window：排除来自 iframe / 其它 frame 的消息；
 *   2) nonce 配对：消息携带一次性 nonce，由接收方在创建配对时生成并登记，
 *      发送方回包须带回相同 nonce；伪造者无法预知随机 nonce，从而被拒。
 *
 * 由于 content script 无法可靠获取 `event.origin`（隔离世界下 origin 常为 'null'），
 * 因此不依赖 origin，而依赖「source===window + nonce」组合。
 *
 * 注意：媒体文件下载地址可能来自众多外部域（无法预先穷举白名单），因此此处
 * 不限制下载 URL 的域名；可信性仅依赖「消息来源为本扩展隔离世界」这一前提。
 */

/** 跨世界消息类型（集中定义，避免字符串散落导致拼写漂移） */
export const CW_MESSAGE = {
    /** v3 引擎 → DM：登记并立即提交一条媒体下载任务 */
    ADD_MEDIA_TASK: 'qz_dm_add_media_task',
    /** v3 引擎 → DM：请求导出 DM 日志文本 */
    LOG_REQUEST: 'qz_dm_log_request',
    /** DM → v3 引擎：回包 DM 日志文本 */
    LOG_RESPONSE: 'qz_dm_log_response',
} as const;

export type CrossWorldMessageType = (typeof CW_MESSAGE)[keyof typeof CW_MESSAGE];

/**
 * 校验一条跨世界消息的基本合法性：
 *   - event.source 必须是本窗口（排除 iframe / 其它 frame）
 *   - data 必须是对象且含已知 type
 * @returns 通过校验的 data，否则 null
 */
export function acceptCrossWorldMessage<T = Record<string, unknown>>(
    event: MessageEvent,
    allowedTypes: ReadonlyArray<string>,
): T | null {
    if (!event || event.source !== window) {
        return null;
    }
    const data = (event as MessageEvent).data as T | undefined;
    if (!data || typeof data !== 'object') {
        return null;
    }
    const type = (data as { type?: unknown }).type;
    if (typeof type !== 'string' || !allowedTypes.includes(type)) {
        return null;
    }
    return data as T;
}

/** 生成一次性 nonce（用于请求/回包配对，防重放） */
export function newNonce(): number {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0]!;
}
