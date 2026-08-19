/**
 * Disk（直写目录）模式媒体下载失败时，自动识别「疑似 Referer 缺失」并生成 DNR 规则。
 *
 * 背景：直写目录模式下，媒体经 content script 在 qzone.qq.com 页面下 fetch。跨域/鉴权依赖
 * background 注册的 DNR 规则（给请求注入 Referer / 放行 CORS）。若某媒体 host 不在
 * refererUrls 里，DNR 不会给它加 Referer，服务端可能返回 403 或 CORS 失败。本项目已有
 * 3 个默认 CDN 域名规则（qq.com / qpic.cn / gtimg.com，前者以域名锚点覆盖其全部子域），
 * 但日志/说说/相册里常有非 QQ 系下载地址（第三方图床、转存 CDN 等），白名单无法覆盖。
 *
 * 设计取舍：不做域名白名单。助手要下载的 URL 本就是从 QQ 空间备份数据里抽出来的，
 * 无论是不是 QQ 域名，都视为「助手请求的内容」，失败且疑似 Referer 缺失时一律自动补规则。
 * 仅用 extractHost 做协议层护栏（只接受 http/https，拒绝 data:/blob:/javascript: 等），
 * 避免给无意义/危险的 URL 注册 Referer 规则。真正避免「死循环/污染」的边界由 manager 的
 * 「每 host 注册一次 + 每任务重试一次」防循环策略负责（dnr-auto 本身不引入状态）。
 *
 * 本模块只做「识别 + 生成规则」的纯函数，不依赖 chrome 运行时，便于单测；
 * 真正的 DNR 注册（updateDynamicRules）由 background.ts 完成。
 */

/** 从 URL 提取 hostname；仅接受 http/https 协议，拒绝 data:/blob:/javascript:/about: 等，返回 null */
export function extractHost(url: string): string | null {
    if (!url) return null;
    try {
        const u = new URL(url);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        return u.hostname || null;
    } catch {
        return null;
    }
}

/**
 * 错误文案是否为「疑似 Referer 缺失 / 跨域鉴权」类，值得尝试自动加 Referer 规则。
 * 注意：Failed to fetch / CORS / 401 / 403 都可能是 Referer 缺失导致（也可能不是，
 * 如签名过期/死链），但自动补救动作（加 Referer + 重试一次）成本低且受「每 host 一次」限制，
 * 不会造成死循环，故一并纳入识别。
 */
export function looksLikeRefererMissing(error: string): boolean {
    if (!error) return false;
    const e = error.toLowerCase();
    if (/\b(401|403)\b/.test(e)) return true; // HTTP 鉴权失败
    if (e.includes('failed to fetch')) return true; // CORS / 跨域 / 混合内容
    if (e.includes('cors')) return true;
    if (e.includes('access-control')) return true;
    if (e.includes('networkerror') || e.includes('network error')) return true;
    return false;
}

/**
 * 针对某 host 生成一条「设置 Referer」的 DNR modifyHeaders 规则。
 * id 由调用方分配（避开既有 referer 规则 1..N 与全局 CORS 规则 1000）。
 * 规则对所有 xmlhttprequest 生效，与 registerDnrRules 中既有 referer 规则行为一致。
 */
export function buildRefererRule(host: string, id: number): chrome.declarativeNetRequest.Rule {
    return {
        id,
        priority: 50,
        action: {
            type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
            requestHeaders: [
                { header: 'Referer', operation: 'set' as chrome.declarativeNetRequest.HeaderOperation, value: 'https://user.qzone.qq.com/' },
            ],
        },
        condition: {
            urlFilter: `||${host}^`,
            resourceTypes: ['xmlhttprequest' as chrome.declarativeNetRequest.ResourceType],
        },
    };
}

/**
 * Disk（直写目录）模式媒体下载的「http→https 升级」规则。
 *
 * 背景：部分老 CDN 媒体地址（如 r.photo.store.qq.com 的签名 URL）返回 302，
 * 且 Location 是 http://（例如 http://photocq.photo.store.qq.com/...）。
 * 预览用 <img src=http://r...> 是被动资源、允许混合内容回落 http，所以正常；
 * 但下载时 disk.ts 仅把「第一跳」toHttps，跟随 302 后目标仍是 http，触发
 * Chrome 的「HTTPS→HTTP 不安全重定向」拦截 → Failed to fetch。
 *
 * 修法：在 DNR 层把助手在 qzone.qq.com 页发起的「站外 http xhrequest」一律升级为 https
 * （正则 ^http://(.*)$ 覆盖任意 http host，含 photo.store.qq.com / photocq.photo.store.qq.com 等）。
 *
 * ⚠️ 实测结论（2026-08-16）：本规则**无法**救「fetch 跟随 302 落 http」这一跳——
 * Chrome 在 DNR 重写之前就会以 Mixed Content 拦截「HTTPS 页 → http 重定向目标」的主动请求，
 * 因此即便 id=2000 在场，直写目录下载 r.photo.store.qq.com 这类「302→http Location」的相册原图
 * 仍 Failed to fetch（预览用 <img> 属被动混合内容故正常）。content script 的 fetch 即便
 * redirect:'manual' 也因 opaqueredirect 拿不到 http Location。
 * → 真正的修复是让 DiskDriver 改走 background 代理 fetch（background 持 <all_urls>，不受
 *   Mixed Content/CORS 约束，可自由跟随 http 重定向），见 disk.ts / background.ts 的 disk_fetch 代理。
 *   本规则保留为「其它未走代理的 http xhrequest」的兜底升级。
 *
 * 仅作用于 xmlhttprequest（即媒体下载通道），不动图片/CSS 等被动资源；
 * 且仅站外（excludedRequestDomains 排除 qzone.qq.com 自身），不影响站内 API。
 */
export const HTTPS_UPGRADE_RULE_ID = 2000;

export function buildHttpsUpgradeRule(): chrome.declarativeNetRequest.Rule {
    return {
        id: HTTPS_UPGRADE_RULE_ID,
        priority: 1,
        action: {
            type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
            redirect: { regexSubstitution: 'https://\\1' },
        } as chrome.declarativeNetRequest.RuleAction,
        condition: {
            regexFilter: '^http://(.*)$',
            initiatorDomains: ['qzone.qq.com'],
            excludedRequestDomains: ['qzone.qq.com'],
            resourceTypes: ['xmlhttprequest' as chrome.declarativeNetRequest.ResourceType],
        } as chrome.declarativeNetRequest.RuleCondition,
    };
}
