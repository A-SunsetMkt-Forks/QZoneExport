/**
 * 共享 URL 工具函数（解析、构建、代理剥离、协议转换、后缀提取）
 * 移值自 api.js，从 core/shared/utils.ts 拆分。
 */

/**
 * 提取 cgi_imgproxy 内层 URL
 * 典型场景：p.qpimg.cn 的图片代理会把真实图片 URL 编码到 query 的 url= 参数里，
 * 例：http://p.qpimg.cn/cgi-bin/cgi_imgproxy?url=http%3A%2F%2Furl.cn%2F2IWrZM0
 * 还原后得到：http://url.cn/2IWrZM0（注意内层仍可能是 url.cn 短链，需配合 unwrapUrlCn 二次解析）。
 */
export function unwrapQpicProxy(url?: string): string {
    url = url || '';
    if (url.indexOf('//p.qpimg.cn/cgi-bin/cgi_imgproxy') === -1
        && url.indexOf('p.qpimg.cn/cgi-bin/cgi_imgproxy') === -1) {
        return url;
    }
    const inner = toParams(url)['url'];
    return typeof inner === 'string' && inner ? inner : url;
}

/** 判断 URL 是否属于 url.cn 短链形式 */
export function isUrlCnShortlink(url?: string): boolean {
    const u = (url || '').trim();
    if (!u) return false;
    const withoutProtocol = u.replace(/^[a-zA-Z]+:\/\//, '').replace(/^\/+/, '');
    const hostPart = withoutProtocol.split('/')[0] || '';
    if (!hostPart) return false;
    const [host] = hostPart.split(':');
    return host?.toLowerCase() === 'url.cn';
}

/** 从 url.cn 返回的 HTML 里提取真实图片地址 */
export function extractRealUrlFromUrlCnHtml(html?: string): string {
    const text = (html || '').trim();
    if (!text) return '';
    const m1 = /<p[^>]*class=("|')link\1[^>]*>\s*(`|['"])?\s*(https?:\/\/[^\s<'"`]+?)\s*\2\s*<\/p>/i.exec(text);
    if (m1 && m1[3]) return m1[3].trim();
    if (/^https?:\/\/[^\s<]+$/i.test(text)) return text;
    const m2 = /(`|['"]|>)?\s*(https?:\/\/[^\s<'"`]+?)\s*(`|['"]|<|$)/.exec(text);
    if (m2 && m2[2]) return m2[2].trim();
    return '';
}

/** 同步层 URL 解包：剥离 cgi_imgproxy + decodeURIComponent 兜底 */
export function unwrapImageUrlSync(url?: string): string {
    if (!url) return '';
    let u = unwrapQpicProxy(url);
    try { u = decodeURIComponent(u); } catch { /* ignore */ }
    u = unwrapQpicProxy(u);
    return u;
}

/** 解析 URL 查询参数 */
export function toParams(url: string): Record<string, string> {
    const qIndex = url.indexOf('?');
    if (qIndex === -1) return {};
    const query = url.substring(qIndex + 1);
    // 按 & 分割后按 = 分割，兼容空值和无值 key
    const ret: Record<string, string> = {};
    for (const part of query.split('&')) {
        const eqIndex = part.indexOf('=');
        if (eqIndex === -1) {
            ret[part] = ''; // 无值 key（如 ?a&b=1）
        } else {
            const key = decodeURIComponent(part.substring(0, eqIndex));
            const value = part.substring(eqIndex + 1);
            // 去掉 hash 片段
            const hashIndex = value.indexOf('#');
            ret[key] = hashIndex === -1 ? value : value.substring(0, hashIndex);
        }
    }
    return ret;
}

/** 通过参数构建 URL */
export function toUrl(url: string, params?: Record<string, string | number | undefined>): string {
    if (!params) return url;
    const paramsArr = Object.keys(params).map((key) => key + '=' + params[key]);
    if (paramsArr.length === 0) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + paramsArr.join('&');
}

/** 转 HTTP 地址（图片代理还原、相对协议补全、解码） */
export function toHttp(url?: string): string {
    url = unwrapImageUrlSync(url);
    url = url.replace(/^\/\//g, 'http://');
    url = url.replace(/https:\//, 'http:/');
    try { url = decodeURIComponent(url); } catch (e) { console.error('URL解码异常', e, url); }
    return url;
}

/** 转 HTTPS 地址 */
export function toHttps(url?: string): string {
    let result = url || '';
    result = unwrapQpicProxy(result);
    result = result.replace(/^\/\//g, 'https://');
    result = result.replace(/http:\//g, 'https:/');
    try { result = decodeURIComponent(result); } catch { /* ignore */ }
    return result;
}

/** 去掉相册下载地址中的缩略图参数 */
export function trimDownloadUrl(url?: string): string {
    url = url || '';
    if (url.indexOf('?t=5&') > 0) url = url.replace('?t=5&', '?');
    else if (url.indexOf('?t=5') > 0) url = url.replace('?t=5', '');
    else if (url.indexOf('&t=5') > 0) url = url.replace('&t=5', '');
    return url;
}

/** 转换下载链接（追加 save=1&d=1 参数） */
export function makeDownloadUrl(url?: string, isDownload?: boolean): string {
    url = url || '';
    const d = 'save=1' + (isDownload ? '&d=1' : '');
    if (url && url.indexOf('?') > 0) url = url + '&' + d;
    else if (url) url = url + '?' + d;
    return trimDownloadUrl(url);
}

/** 转换查看地址（去掉下载参数） */
export function makeViewUrl(url?: string): string {
    url = url || '';
    url = url.replace('?save=1&d=1', '');
    url = url.replace('&save=1&d=1', '');
    url = url.replace('?save=1', '');
    url = url.replace('&save=1', '');
    url = url.replace('?d=1', '');
    url = url.replace('&d=1', '');
    return url;
}

/** 通过 URL 直接匹配文件后缀名 */
export function getFileSuffixByUrl(url?: string, defaultSuffix?: string): string {
    let _url = url || '';
    // 仅保留「路径」用于后缀识别：同时剔除查询参数(?)与片段(#)。
    // 朴素 split('?')[0] 不剔除 #片段，会导致 a.mp4#frag 这类地址因末尾被 #片段占据而提取不到后缀。
    const cut = (() => {
        const q = _url.indexOf('?');
        const h = _url.indexOf('#');
        if (q === -1 && h === -1) return -1;
        if (q === -1) return h;
        if (h === -1) return q;
        return Math.min(q, h);
    })();
    if (cut >= 0) _url = _url.slice(0, cut);
    // 取路径中最后一个点之后的片段作为后缀；要求该片段为纯字母数字（与旧正则 [a-z]+$ 等价），
    // 避免把 /sub.dir/file 这类中间点误判为后缀。点前允许任意字符（含路径分隔）。
    const dot = _url.lastIndexOf('.');
    if (dot >= 0) {
        const ext = _url.slice(dot + 1);
        if (/^[a-z0-9]+$/i.test(ext)) {
            return '.' + ext;
        }
    }
    return defaultSuffix || '';
}

/**
 * 媒体去重 / 命名用的 URL 归一化：仅保留「协议 + 主机 + 路径」，
 * 剔除查询参数（QQ 空间常把防盗链 token/key，如 dis_k/dis_t/vuin/rf，放在 query 中，
 * 导致同一资源每次地址都不同、去重失效）与片段标识（#...）。
 *
 * 为什么不用朴素 split('?')[0]：
 * - 它不会剔除 #fragment，URL 仅差片段时仍被判为不同资源，去重漏判；
 * - 它只是「首个问号之前」，对协议相对地址（//host/path）或非标准地址不够稳健；
 * - 它无法顺带统一主机大小写（URL 解析会自动小写 host）。
 * 这里用标准 URL 解析取 origin+pathname；协议相对 / 非法地址再退化去参兜底。
 *
 * 注意：仅用于「去重键 / 文件名哈希」的输入，绝不能用于实际下载地址——否则 token 缺失会 403 下载失败。
 */
export function normalizeForDedup(url: string): string {
    if (!url) return url;
    const raw = url.trim();
    // 无 scheme（协议相对 //host/path、相对路径等）无法用 URL 构造，直接退化去参
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
        const q = raw.indexOf('?');
        return q === -1 ? raw : raw.slice(0, q);
    }
    try {
        const u = new URL(raw);
        return u.origin + u.pathname;
    } catch {
        const q = raw.indexOf('?');
        return q === -1 ? raw : raw.slice(0, q);
    }
}

/** 从 Cookie 字符串中提取指定项 */
export function getCookieValue(cookieString: string, name: string): string | undefined {
    const value = '; ' + cookieString;
    const parts = value.split('; ' + name + '=');
    if (parts.length === 2) return parts.pop()!.split(';').shift();
    return undefined;
}

/** 获取条目评论数（字段名因模块而异） */
export function getCommentCount(item: unknown): number {
    const o = item as { replies?: unknown; reply_num?: unknown; cmtnum?: unknown };
    return Number(o.replies || o.reply_num || o.cmtnum || 0);
}
