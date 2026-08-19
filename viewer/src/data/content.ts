/**
 * 备份记录的字段取值助手
 *
 * 备份数据里同一样东西常有多个候选字段（下载到本地的路径、空间外链、不同尺寸的原图），
 * 取值优先级与旧模板保持一致（见 src/templates/*.html），避免查看器与旧页面显示不同。
 */
import { assetUrl, normalizeModulePath } from './sources';

/**
 * 同步解包图片 URL（用于查看器和未触发备份引擎去重阶段的旧数据兼容）：
 * 1) 先把 p.qpimg.cn/cgi-bin/cgi_imgproxy 代理的 url= 取出来
 * 2) 然后 normalize 协议/相对协议
 * 3) url.cn 短链需要网络请求（备份时 MediaTaskRegistry.add 负责异步解包并写 custom_url），
 *    查看器无法跨域 GET url.cn，因此若读取了未备份过的旧数据遇到 url.cn 外链，会返回
 *    原地址（<img> 会显示失败；建议在备份阶段就解完）。
 */
function unwrapViewerImageUrl(url?: string | null): string {
    if (!url) return '';
    let u = url;
    // 同步层仅解代理链：cgi_imgproxy 的 url= 参数（可能被编码一次或两次）
    if (u.indexOf('//p.qpimg.cn/cgi-bin/cgi_imgproxy') > -1
        || u.indexOf('p.qpimg.cn/cgi-bin/cgi_imgproxy') > -1) {
        const regUrl = /^[^?]+\?([\w\W]+)$/;
        const regPara = /([^&=]+)=([\w\W]*?)(&|$|#)/g;
        const arrUrl = regUrl.exec(u);
        if (arrUrl && arrUrl[1]) {
            const params: Record<string, string> = {};
            let m: RegExpExecArray | null;
            while ((m = regPara.exec(arrUrl[1])) != null) {
                params[m[1]!] = m[2]!;
            }
            if (params['url']) {
                u = params['url'];
            }
        }
    }
    try { u = decodeURIComponent(u); } catch { /* ignore */ }
    // 再扫一次，避免双重编码（cgi_imgproxy 内层又包了一次 cgi_imgproxy，虽罕见）
    if (u.indexOf('//p.qpimg.cn/cgi-bin/cgi_imgproxy') > -1
        || u.indexOf('p.qpimg.cn/cgi-bin/cgi_imgproxy') > -1) {
        const regUrl = /^[^?]+\?([\w\W]+)$/;
        const regPara = /([^&=]+)=([\w\W]*?)(&|$|#)/g;
        const arrUrl = regUrl.exec(u);
        if (arrUrl && arrUrl[1]) {
            const params: Record<string, string> = {};
            let m: RegExpExecArray | null;
            while ((m = regPara.exec(arrUrl[1])) != null) {
                params[m[1]!] = m[2]!;
            }
            if (params['url']) {
                u = params['url'];
                try { u = decodeURIComponent(u); } catch { /* ignore */ }
            }
        }
    }
    // 相对协议统一为 https://（查看器页面一般以 https 打开，避免混合内容拦截）
    u = u.replace(/^\/\//g, 'https://').replace(/^http:\/\//g, 'https://');
    return u;
}

/** 图片地址：优先本地文件，其次外链，再退化到各尺寸原图 */
export function imageUrl(image: Record<string, any> | null | undefined): string {
    if (!image) {
        return '';
    }
    const rawPath = image.custom_filepath || image.custom_url || image.o_url
        || image.hd_url || image.b_url || image.s_url || image.url;
    // 外链（没有 custom_filepath 的情况）走解包函数，把 cgi_imgproxy 先还原掉；
    // 本地路径直接 assetUrl
    const path = rawPath && /^(https?:)?\/\//.test(rawPath) ? unwrapViewerImageUrl(rawPath) : rawPath;
    return assetUrl(path);
}

/** 视频播放地址 */
export function videoUrl(video: Record<string, any> | null | undefined): string {
    if (!video) {
        return '';
    }
    const rawPath = video.custom_filepath || video.custom_url || video.url3;
    const path = rawPath && /^(https?:)?\/\//.test(rawPath) ? unwrapViewerImageUrl(rawPath) : rawPath;
    return assetUrl(path);
}

/** 视频封面 */
export function videoPoster(video: Record<string, any> | null | undefined): string {
    if (!video) {
        return '';
    }
    const rawPath = video.custom_pre_filepath || video.custom_pre_url || video.url1;
    const path = rawPath && /^(https?:)?\/\//.test(rawPath) ? unwrapViewerImageUrl(rawPath) : rawPath;
    return assetUrl(path);
}

/**
 * 是否腾讯视频（判定与旧页 API.Videos.isTencentVideo 一致）
 * url3 含 mp4/m3u8 就是空间自己的视频；否则看 url3 里有没有 tencentvideo 标识。
 */
function isTencentVideo(video: Record<string, any>): boolean {
    const url2 = String(video.url2 || '');
    const url3 = String(video.url3 || '');
    if (!url2 || url3.includes('.mp4') || url3.includes('.m3u8')) {
        return false;
    }
    return url3.includes('tencentvideo');
}

/**
 * 是否外部视频（腾讯视频、Flash 等）
 * 这类视频没有可下载的源文件，旧页面也只是给个链接跳到原站播放。
 */
export function isExternalVideo(video: Record<string, any> | null | undefined): boolean {
    if (!video) {
        return false;
    }
    if (isTencentVideo(video)) {
        return true;
    }
    return String(video.url3 || '').includes('.swf');
}

/** 外部视频的跳转地址（需联网，与旧页 getVideoUrl 一致） */
export function externalVideoUrl(video: Record<string, any>): string {
    if (video.source_type === 'share' && video.rt_url) {
        return video.rt_url;
    }
    if (isTencentVideo(video)) {
        if (!video.video_id) {
            return video.url2 || '';
        }
        const params = new URLSearchParams({
            origin: 'https://user.qzone.qq.com',
            vid: String(video.video_id),
            autoplay: 'true',
            platId: 'qzone_feed',
        });
        return 'https://v.qq.com/txp/iframe/player.html?' + params.toString();
    }
    return video.url3 || video.url || '';
}

/** 评论/回复的发表人（poster 优先，其次记录自身的 uin/name 各种别名） */
export function commentUser(comment: Record<string, any>): { uin?: string | number; name?: string } {
    if (comment.poster) {
        return {
            uin: comment.poster.uin || comment.poster.id || comment.poster.fuin,
            name: comment.poster.name || comment.poster.nick || comment.poster.nickname,
        };
    }
    return {
        uin: comment.uin || comment.fuin,
        name: comment.name || comment.nick || comment.nickname,
    };
}

/** 评论的回复列表（不同接口字段名不同） */
export function commentReplies(comment: Record<string, any>): Record<string, any>[] {
    return comment.replies || comment.list_3 || comment.replyList || [];
}

/** 记录的评论列表（说说用 custom_comments，其它模块多为 comments） */
export function itemComments(item: Record<string, any>): Record<string, any>[] {
    return item.custom_comments || item.comments || [];
}

/** 位置描述（拍摄地点优先，其次上传地点） */
export function locationOf(item: Record<string, any>): string {
    const lbs = item.story_info?.lbs || item.lbs;
    if (!lbs) {
        return '';
    }
    return lbs.idname || lbs.name || '';
}

/**
 * 解码日志/日记正文
 * 兼容两种存储格式（查看器必须同时支持，否则旧备份打不开）：
 *  - 旧格式：正文以 base64 存在 custom_html（历史版本用 utf8ToBase64 编码）；
 *  - 新格式：正文直接以原始 UTF-8 HTML 字符串存储（更省体积、可读）。
 * 通过「是否纯 base64 且解码后为 HTML」来判别，两种都安全还原；
 * 任一环节失败都退回原字段，不让整页报错。
 */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export function decodeHtml(value?: string | null): string {
    if (!value) {
        return '';
    }
    // 新格式：正文含 <、空格等字符，本身就不是合法的 base64 → 原样返回
    if (!BASE64_RE.test(value) || value.length % 4 !== 0) {
        return value;
    }
    try {
        // atob 产出的是字节串，中文需经 UTF-8 解码才不乱码
        const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
        const decoded = new TextDecoder('utf-8').decode(bytes);
        // 解码结果应为 HTML（以 < 开头）；否则把原值当作新格式原始字符串返回
        if (/^\s*</.test(decoded)) {
            return decoded;
        }
        return value;
    } catch {
        return value;
    }
}

/**
 * 把正文 HTML 里的相对资源路径改为查看器可用的路径
 * 旧页面位于备份的模块目录下，图片路径是模块相对的（如 images/x.jpg，文件实际在
 * Blogs/images/x.jpg）；新引擎写入的路径直接是相对备份根的（如 Blogs/images/x.jpg）。
 * 查看器在备份根目录，旧格式需传入 moduleDir 补上模块名才能解析到真实文件；
 * 新格式以顶层目录开头，不受影响。
 */
export function fixHtmlAssets(html: string, moduleDir?: string): string {
    // 匹配 src/href 属性中的相对路径（排除绝对 URL、data:、锡点链接）
    return html.replace(/(src|href)="([^"]+)"/g, (_match, attr, rawPath) => {
        // 跳过已是绝对地址或特殊协议的
        if (/^(https?:|\/\/|data:|#|javascript:)/i.test(rawPath)) {
            return _match;
        }
        // 去掉开头的 ../ 前缀（可能多层）；旧格式（模块相对）补上模块名，新格式不受影响
        const path = moduleDir
            ? normalizeModulePath(rawPath, moduleDir)
            : rawPath.replace(/^(\.\.\/)+/, '');
        return `${attr}="${assetUrl(path)}"`;
    });
}

/** 用户空间头像：优先备份里下载好的本地头像（Common/images/{uin}，无扩展名） */
export function avatarUrl(uin?: string | number | null): string {
    if (!uin) {
        return '';
    }
    return assetUrl('Common/images/' + uin);
}

/** 头像未下载时的在线地址（与旧页 getUserLogoUrl 一致，需联网） */
export function avatarFallbackUrl(uin?: string | number | null): string {
    if (!uin) {
        return '';
    }
    return `https://qlogo.store.qq.com/qzone/${uin}/${uin}/100`;
}

/** 用户空间主页（需联网） */
export function userUrl(uin?: string | number | null): string {
    return uin ? `https://user.qzone.qq.com/${uin}` : '';
}

/**
 * 访客的访问内容概述
 * 与 api.js 的 API.Visitors.getTitle 一致；访客页与个人中心都要用，故收在这里。
 */
export function visitorTitle(item: Record<string, any>): string {
    const parts: string[] = [];
    if (item.shuoshuoes?.length) {
        parts.push('说说');
    }
    if (item.blogs?.length) {
        parts.push('日志');
    }
    if (item.photoes?.length) {
        parts.push('相册');
    }
    if (item.shares?.length) {
        parts.push('分享');
    }
    return parts.length === 0 ? '访问了主页' : '查看了' + parts.join('、');
}

/** 收藏类型（与 api.js 的 API.Favorites.getType 一致） */
const FAVORITE_TYPES: Record<number, string> = {
    0: '全部', 1: '网页', 2: '照片', 3: '日志', 4: '照片', 5: '说说', 6: '文字', 7: '分享',
};

export function favoriteTypeLabel(item: Record<string, any>): string {
    return FAVORITE_TYPES[Number(item.type)] || '未知';
}

/**
 * 分享显示类型（与旧版 API.Shares.getDisplayType L4073-4086 完全一致）
 * 分享分类体系是独立的，不同于收藏类型：
 *   1=日志、2=相册、3=照片、4=网页、5=视频、10=商品、13=新闻、17=微博、18=音乐
 */
const SHARE_DISPLAY_TYPES: Record<number, string> = {
    1: '日志',
    2: '相册',
    3: '照片',
    4: '网页',
    5: '视频',
    10: '商品',
    13: '新闻',
    17: '微博',
    18: '音乐',
};

/**
 * 单条分享的类型标签（显示在昵称右侧的类型徽章）
 */
export function shareTypeLabel(item: Record<string, any>): string {
    return SHARE_DISPLAY_TYPES[Number(item.type)] || '其它';
}

/**
 * 分享源的「来源」信息（旧版 blockquote.source 下方的 list-group 行）
 * 返回对象结构与旧模板渲染完全对齐，避免 undefined 访问：
 *   { name: 来源应用名（空字符串表示无）, url: 来源应用链接, count: 该内容被分享的次数 }
 */
export function shareFromInfo(item: Record<string, any>): { name: string; url: string; count: number } {
    const from = (item && item.source && item.source.from) || {};
    const name = String(from.name || '').trim();
    const urlRaw = String(from.url || '').trim();
    const url = /^https?:/i.test(urlRaw) ? urlRaw : '';
    const count = Number(item && item.source && item.source.count) || 0;
    return { name, url, count };
}

/** 收藏理由（用户自己写的话） */
export function favoriteReason(item: Record<string, any>): string {
    return item.shuoshuo_info?.reason || item.share_info?.reason || '';
}

/** 好友昵称（只取 nick） */
export function friendNick(row: Record<string, any>): string {
    return row.nick || '';
}

/** 卡片上的主显示名：有备注用备注（与 QQ 的习惯一致），否则用昵称 */
export function friendDisplayName(row: Record<string, any>): string {
    return row.remark || friendNick(row) || String(row.uin || '');
}

/** 共同好友数（common.friend 可能是数组也可能是数字） */
export function friendCommonCount(row: Record<string, any>): number {
    const friends = row.common?.friend;
    if (Array.isArray(friends)) {
        return friends.length;
    }
    return Number(friends) || 0;
}

/** QQ 聊天链接（与旧页 API.Common.getMessageUrl 一致） */
export function messageUrl(uin?: string | number): string {
    return uin ? `tencent://message/?uin=${uin}` : '';
}

/** 点赞用户列表：字段为 fuin/nick/if_qq_friend（见旧页 TPL.LIKE_LIST） */
export function likeUsers(item: Record<string, any>): { uin?: string | number; name?: string; isFriend?: boolean }[] {
    return (item.likes || []).map((like: Record<string, any>) => ({
        uin: like.fuin || like.uin,
        name: like.nick || like.name,
        isFriend: like.if_qq_friend === 1 || like.isFriend === 1,
    }));
}

/** 点赞总数：接口给的 likeTotal 可能大于实际拉到的名单长度 */
export function likeTotal(item: Record<string, any>): number {
    const total = Number(item.likeTotal ?? item.like_total ?? NaN);
    return Number.isFinite(total) ? total : (item.likes || []).length;
}

/** 最近访问：字段为 uin/name/isFriend（见旧页 TPL.VISITOR_LIST） */
export function visitorUsers(item: Record<string, any>): { uin?: string | number; name?: string; isFriend?: boolean }[] {
    return (item.custom_visitor?.list || []).map((user: Record<string, any>) => ({
        uin: user.uin,
        name: user.name || user.nick,
        isFriend: user.isFriend === 1,
    }));
}

/** 浏览量 */
export function viewCount(item: Record<string, any>): number {
    return Number(item.custom_visitor?.viewCount ?? 0) || 0;
}

/** 说说发表时间（created_time 优先，custom_create_time 兜底） */
export function messagePublishTime(item: Record<string, any>): number | string | undefined {
    return item.created_time || item.custom_create_time;
}

/** 说说修改时间（lastmodify 为秒级时间戳）；无修改时间时兜底发表时间，用于排序与展示 */
export function messageEffectiveTime(item: Record<string, any>): number | string | undefined {
    return item.lastmodify || messagePublishTime(item);
}

/** 日志/日记发表时间 */
export function articlePublishTime(item: Record<string, any>): number | string | undefined {
    return item.pubtime || item.pubTime || item.time;
}

/** 日志/日记修改时间（lastModifyTime 为秒级时间戳）；无修改时间时兜底发表时间 */
export function articleEffectiveTime(item: Record<string, any>): number | string | undefined {
    return item.lastModifyTime || articlePublishTime(item);
}

/**
 * 日志标签（原创/转载/置顶/推荐）
 * 旧页列表与表格都会显示这些标识（见 api.js getBlogLabel），取自 effect 的位标志：
 * 4=置顶、21=推荐、3/28/35/36=转载、8=审核不通过（位 22 审核中不展示），
 * 一个都没命中则为「原创」。位序 <32 取 effect/effect1，否则取 effect2。
 */
function effectBit(item: Record<string, any>, bit: number): boolean {
    if (bit < 32) {
        return ((Number(item.effect ?? item.effect1 ?? 0) | 0) & (1 << bit)) !== 0;
    }
    return ((Number(item.effect2 ?? 0) | 0) & (1 << bit)) !== 0;
}

export function blogLabels(item: Record<string, any>): string[] {
    // 数据里没有任何 effect 字段时不猜标识（早期备份可能不含该字段）
    if (item.effect === undefined && item.effect1 === undefined && item.effect2 === undefined) {
        return [];
    }
    const config: Array<[number, string]> = [
        [8, '审核不通过'],
        [4, '置顶'],
        [21, '推荐'],
        [3, '转载'],
        [28, '转载'],
        [35, '转载'],
        [36, '转载'],
    ];
    const labels: string[] = [];
    for (const [bit, label] of config) {
        if (effectBit(item, bit) && !labels.includes(label)) {
            labels.push(label);
        }
    }
    return labels.length === 0 ? ['原创'] : labels;
}

/** 日志/日记是否置顶（effect 位 4）；置顶条目列表里始终排在最前 */
export function isArticleTop(item: Record<string, any>): boolean {
    return effectBit(item, 4);
}

/** 标签对应的颜色（置顶/推荐醒目些，转载与原创保持中性） */
export function blogLabelType(label: string): 'default' | 'success' | 'info' | 'warning' | 'error' {
    switch (label) {
        case '置顶':
            return 'warning';
        case '推荐':
            return 'info';
        case '原创':
            return 'success';
        case '审核不通过':
            return 'error';
        default:
            return 'default';
    }
}

/**
 * 说说来源（微信朋友圈 / 朋友网）
 * 判定与 api.js isWeChat 一致：t1_source===1 && t1_subtype===29 为微信同步，
 * t1_source===0 为朋友网（旧页 messages.html 同样分这两种）。
 */
export function messageSource(item: Record<string, any>): string {
    if (item.t1_source === 1 && item.t1_subtype === 29) {
        return '微信朋友圈';
    }
    if (item.t1_source === 0) {
        return '朋友网';
    }
    return '';
}
