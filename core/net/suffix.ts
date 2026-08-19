/**
 * 文件后缀探测（替代旧 api.js autoFileSuffix / getFileSuffix / getFileSuffixByUrl /
 * getMimeType）
 *
 * 策略与旧版一致：
 *   1) 优先从 URL 路径直接匹配后缀（去参数后取末段扩展名）；
 *   2) 若开启「自动探测」(isAutoFileSuffix)，则对转 HTTPS + 加防盗链参数后的地址
 *      发起请求，根据 Content-Type 推断后缀（通过 background fetch 探测，避免 CORS）。
 */

import { isExtensionEnv } from '../shared/env';
import { TIMING } from '../shared/constants';
import { BG_MSG } from '../shared/messages';
import { getFileSuffixByUrl, toHttps } from '../shared/utils';

/** MIME → 后缀（常用媒体类型映射） */
const MIME_SUFFIX: Record<string, string> = {
    'image/jpeg': 'jpeg',
    'image/jpg': 'jpeg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/x-m4v': 'mp4',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/amr': 'amr',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'application/zip': 'zip',
    'application/x-javascript': 'js',
    'text/javascript': 'js',
    'application/json': 'json',
};

import { makeDownloadUrl } from '../shared/url';

export { makeDownloadUrl };

/**
 * 经 background Service Worker 探测 MIME（无 CORS 限制），超时返回空串
 * 等价于旧 api.js getMimeType 委托 chrome.runtime.sendMessage({type:'getMimeType'})
 */
async function probeMimeType(viewUrl: string, timeoutMs: number = TIMING.MIME_PROBE_TIMEOUT): Promise<string> {
    if (!isExtensionEnv()) {
        // 测试/非扩展环境：直接 fetch（可能受 CORS 限制，失败即空串）
        try {
            const resp = await fetch(viewUrl, { method: 'GET', credentials: 'include' });
            return resp.headers.get('content-type') || '';
        } catch {
            return '';
        }
    }
    return new Promise<string>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                resolve('');
            }
        }, timeoutMs);
        try {
            chrome.runtime.sendMessage(
                { from: 'content', type: BG_MSG.GET_MIME_TYPE, url: viewUrl, timeout: timeoutMs },
                (data: any) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    if (chrome.runtime.lastError) {
                        resolve('');
                        return;
                    }
                    resolve(typeof data === 'string' ? data : '');
                },
            );
        } catch {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve('');
            }
        }
    });
}

/**
 * 自动探测文件后缀
 * @param url 文件地址
 * @param isAutoFileSuffix 是否开启 MIME 探测（默认 true）
 * @param timeoutMs MIME 探测超时（ms）。对应配置 autoFileSuffixTimeOut（秒）×1000；
 *        不传则回退到 TIMING.MIME_PROBE_TIMEOUT。旧版 api.js 透传 QZone_Config.Common.autoFileSuffixTimeOut。
 */
export async function autoFileSuffix(url: string, isAutoFileSuffix = true, timeoutMs: number = TIMING.MIME_PROBE_TIMEOUT): Promise<string> {
    const suffix = getFileSuffixByUrl(url);
    if (!isAutoFileSuffix) {
        return suffix;
    }
    const viewUrl = makeDownloadUrl(toHttps(url), true);
    const mime = await probeMimeType(viewUrl, timeoutMs);
    if (mime) {
        const lower = mime.split(';')[0]?.trim().toLowerCase() || '';
        const mapped = MIME_SUFFIX[lower];
        if (mapped) {
            return '.' + mapped;
        }
        // 未命中映射表：尝试取子类型作为后缀（如 application/octet-stream → stream）
        const sub = lower.split('/')[1];
        if (sub && /^[a-z0-9]+$/.test(sub)) {
            return '.' + sub;
        }
    }
    return suffix;
}
