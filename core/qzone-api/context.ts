import { calcGtk, getCookieValue } from '../shared/utils';

/**
 * QQ空间运行时上下文（登录QQ、备份QQ、鉴权参数）
 * 由内容脚本环境初始化，域层仅消费
 */
export interface QzoneContext {
    /** 当前登录QQ */
    ownerUin: number;
    /** 备份目标QQ */
    targetUin: number;
    /** g_tk 校验参数 */
    gtk: number;
    /** 页面 qzonetoken */
    token: string;
    /** 相册路由号，默认102 */
    route?: number;
    /** 私密日志密码签名 */
    pwd2sig?: string;
}

/**
 * 上下文环境接口（隔离DOM访问，便于测试）
 */
export interface ContextEnv {
    /** 页面URL */
    href: string;
    /** document.cookie */
    cookie: string;
    /** 页面script文本清单（用于提取qzonetoken） */
    scriptTexts: () => string[];
}

/**
 * 从页面script文本中提取qzonetoken
 * 移植自 api.js getQZoneToken（L745-759）
 */
export function extractQzoneToken(scriptTexts: string[]): string {
    for (let text of scriptTexts) {
        text = text.replace(/ /g, '');
        if (text.indexOf('window.g_qzonetoken') !== -1) {
            const match = /return"(\w*?)";/g.exec(text);
            if (match && match[1]) {
                return match[1];
            }
        }
    }
    return '';
}

/**
 * 从URL提取备份目标QQ
 * 移植自 api.js initUin（L764-791）
 */
export function extractTargetUin(href: string): number | undefined {
    const rs = /\/user\.qzone\.qq\.com\/([\d]+)/.exec(href);
    return rs ? Number(rs[1]) : undefined;
}

/**
 * 从Cookie提取登录QQ
 * 移植自 api.js initUin（cookie uin 形如 o0123456789）
 */
export function extractOwnerUin(cookie: string): number | undefined {
    const raw = getCookieValue(cookie, 'uin') || '';
    const res = /\d.+/g.exec(raw);
    return res && res.length > 0 ? Number(res[0]) : undefined;
}

/**
 * 计算 g_tk
 * 移植自 api.js initGtk（L797-815）：qzone域优先p_skey，qq.com域取skey/rv2
 */
export function extractGtk(env: Pick<ContextEnv, 'href' | 'cookie'>): number | undefined {
    let skey: string | undefined;
    if (env.href.indexOf('qzone.qq.com') > 0) {
        skey = getCookieValue(env.cookie, 'p_skey');
    } else if (env.href.indexOf('qq.com') > 0) {
        skey = getCookieValue(env.cookie, 'skey') || getCookieValue(env.cookie, 'rv2');
    }
    if (!skey) {
        return undefined;
    }
    return calcGtk(skey);
}

/**
 * 初始化完整上下文
 */
export function initContext(env: ContextEnv): QzoneContext | undefined {
    const ownerUin = extractOwnerUin(env.cookie);
    const targetUin = extractTargetUin(env.href) || ownerUin;
    const gtk = extractGtk(env);
    if (!ownerUin || !targetUin || gtk === undefined) {
        return undefined;
    }
    return {
        ownerUin,
        targetUin,
        gtk,
        token: extractQzoneToken(env.scriptTexts()),
        route: 102,
    };
}
