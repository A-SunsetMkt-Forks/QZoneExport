/**
 * Markdown 导出（v3 TypeScript 版，替代旧 public/js/modules/export-md.js）
 *
 * 设计：自洽、不依赖旧 API.Common / lodash / turndown。
 *  - 输入为 v3 采集器产出的数据（与旧版字段一致：custom_create_time / custom_html /
 *    custom_comments / pic / rt_uinname 等，经同一 toJson 解析）
 *  - 输出 Markdown，结构对齐 V2：
 *      · 列表类模块（说说/留言板/分享/访客/视频/收藏）：按「年」拆分多个 `{year}.md`，
 *        并保留一个合并的 `index.md`（V2 中为模块名 .md）；
 *      · 日志/日记：每篇独立导出为 `module/{分类}/{序号}_{日期}_【{标题}】.md`；
 *      · 相册：每个相册一个文件夹，内含按年 `{year}.md` + 相册汇总 `index.md`；
 *      · 好友：单个 `QQ好友.md`。
 *  - 媒体转为 `![name](path)`、评论/转发/点赞结构化呈现。
 *
 * 注意：本实现不追求与旧 formatContent 逐字节一致，仅保证结构、时间、媒体、
 *       评论、转发等关键信息的完整可用。
 */

import type { FileWriter } from '../../fs/writer';
import { parseDate } from '../../shared/utils';

type AnyItem = Record<string, any> & { [k: string]: any };

/** Markdown 导出选项（部分开关来自用户配置，需透传到渲染层） */
export interface MarkdownOptions {
    /** 是否生成其他空间用户的空间链接（仅 MarkDown 生效，HTML 默认生成） */
    hasUserLink?: boolean;
    /** 空间主人信息（来自 user.js，用于根 index.md 开篇说明）；缺省则省略对应行 */
    nickname?: string;
    spaceName?: string;
    desc?: string;
    signature?: string;
    uin?: number | string;
    /** 导出时间（Date），用于根 index.md 开篇说明；缺省则省略 */
    exportTime?: Date;
    /**
     * 原始用户档案（即 user.js 中的字段，如 sex/constellation/bloodtype/country 等）。
     * 用于根 index.md 的「空间资料」小节；缺省则省略该小节。
     */
    profile?: Record<string, unknown>;
    /**
     * 媒体处理方式（对齐配置 mediaMode/下载器）：true=外链（媒体不下载，用在线地址）；
     * false/缺省=下载模式（已下载本地文件，引用本地路径）。决定表情图等媒体引用「在线链接」还是「本地文件」。
     */
    isQzoneUrl?: boolean;
}

/** 根 index.md 开篇说明所用空间主人信息（MarkdownOptions 中对应字段的子集） */
interface MarkdownMeta {
    nickname?: string;
    spaceName?: string;
    desc?: string;
    signature?: string;
    uin?: number | string;
    exportTime?: Date;
    /** 原始用户档案（user.js 字段），用于「空间资料」小节 */
    profile?: Record<string, unknown>;
}

/* ============================ 基础工具 ============================ */

/** 渲染用户空间超链接（移植自旧版 api.js getUserLink）。昵称先还原 token（表情/@），再转义强调符 */
function renderUserLink(uin: unknown, name: string, hasUserLink: boolean): string {
    const safe = escapeMarkdown(formatTokens(name));
    if (hasUserLink && uin) {
        const url = 'https://user.qzone.qq.com/' + String(uin);
        return `[${safe}](${url})`;
    }
    return safe;
}

/** 从任意对象上提取 uin（兼容 uin / custom_uin / fromUin 等字段） */
function pickUin(o: any): unknown {
    if (!o) return undefined;
    return o.uin ?? o.custom_uin ?? o.fromUin ?? o.fuin ?? o.uinname ?? undefined;
}

/** 话题搜索链接的域名片段（QQ 空间#话题#的旧跳转地址），遇到时只还原话题文本，不再生成跳转链接 */
const TOPIC_LINK_HOST = 'rc.qzone.qq.com/qzonesoso/';

/** QQ 表情在线地址（外链模式引用在线链接；用 https 避免混合内容拦截） */
const QQ_EMOTICON_URL = 'https://qzonestyle.gtimg.cn/qzone/em/e{id}.gif';
/** QQ 表情本地路径（下载模式：采集器下载到 Common/images/e{id}.gif，与查看器一致） */
const QQ_EMOTICON_LOCAL = 'Common/images/e{id}.gif';
/**
 * 媒体处理方式：true=外链（表情用在线链接）；false=下载模式（用本地文件路径）。
 * 由 exportModuleMarkdown 透传 opts.isQzoneUrl 设置，与备份查看器对媒体「外链在线/下载本地」的约定一致。
 */
let markdownLinkMode = false;
/** 表情地址（依媒体处理方式选择在线/本地） */
function emoticonUrl(id: string): string {
    return mediaHref((markdownLinkMode ? QQ_EMOTICON_URL : QQ_EMOTICON_LOCAL).replace('{id}', id));
}

/**
 * 当前正在生成的 MD 文件所在目录（相对备份根，空串=根目录）。
 * 备份里媒体地址是「相对备份根」存的（如 Common/images/e100.gif、Messages/images/x.jpg），
 * 而 Markdown 相对路径以文件所在目录为基准解析，直接引用会错位
 * （Messages/2021.md 里写 Common/images/... 实际指向 Messages/Common/images/...）。
 * 写某文件前把它的目录记到这里，媒体引用统一换算成相对该目录的真实相对路径。
 */
let mdRelDir = '';
/** 计算从 fromDir（相对备份根）到 target（相对备份根）的相对路径（供 Markdown 引用） */
function relPath(fromDir: string, target: string): string {
    if (!fromDir) return target;
    if (!target) return target;
    const f = fromDir.split('/').filter(Boolean);
    const t = target.split('/').filter(Boolean);
    let i = 0;
    while (i < f.length && i < t.length && f[i] === t[i]) i++;
    const up = '../'.repeat(f.length - i);
    const down = t.slice(i).join('/');
    return up + down || '.';
}
/** 把「相对备份根」的本地媒体路径改写成相对当前 MD 文件所在目录的正确相对路径；在线/协议地址不动。
 *  内容内嵌的媒体常存成 `../模块/images/…`（查看器 normalizeModulePath 也先剥 `../` 再根相对化），
 *  这里统一剥掉前导 `../` 得到根相对路径后，再换算到当前 MD 文件目录。 */
function mediaHref(url: string): string {
    if (!url) return url;
    if (/^(https?:)?\/\//i.test(url) || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#')) return url;
    const rootRel = url.replace(/^(\.\.\/)+/, '') || url;
    return relPath(mdRelDir, rootRel);
}

/** 转义行内 Markdown 强调/代码字符（`*`/`_`/`` ` ``），避免用户名含这些字符时破坏渲染
 *  （如 `**芷炫**` 变 `***芷炫***`）。不转义 `[`/`]`，以便昵称里的表情 token 转成的 `![e100](url)` 图片语法不受影响 */
function escapeMarkdown(s: string): string {
    return String(s ?? '').replace(/([\\`*_])/g, '\\$1');
}

/** QQ JML token → 可用 Markdown：表情 [em]e123[/em] → 图片；@{}（@某人的 JML）→ 纯文本 @昵称。
 *  与查看器 formatText/formatHtmlContent 同一口径，凡展示用户文本的地方都应先过一遍，
 *  保证 MD 与备份查看器对表情/@（以及下文话题）的处理一致。 */
function formatTokens(s: string): string {
    if (!s) return '';
    return String(s)
        .replace(/\[em\]e(\d+)\[\/em\]/gi, (_m, id) => `![e${id}](${emoticonUrl(id)})`)
        .replace(/@\{[^}]*\}/g, (m) => {
            const nick = m.match(/nick:([^,}]*)/);
            return '@' + (nick ? nick[1] : '');
        });
}

function htmlToMarkdown(html: string): string {
    if (!html) return '';
    let s = html;
    // token（表情/@）先于标签剥离就地还原，避免先转义后二次转义
    s = formatTokens(s);
    s = s.replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (_m, src) => `![](${mediaHref(src)})`);
    s = s.replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, (_m, href, text) => {
        // 话题链接：不再保留跳转，仅还原话题文本（与查看器新规则一致）
        if (href && href.includes(TOPIC_LINK_HOST)) {
            return text || href;
        }
        // 正文内嵌的本地媒体路径同样按 MD 文件所在层级改写相对前缀
        return `[${text || href}](${mediaHref(href)})`;
    });
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/p>/gi, '\n');
    s = s.replace(/<p\b[^>]*>/gi, '');
    s = s.replace(/<[^>]+>/g, '');
    s = s
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    // 话题：与查看器规则一致（# 后直到下一个 # 或空白为一个话题）。
    // 纯文本保留 #话题#，不使用原生 HTML（破坏公众号/Notion 兼容，见导出设计标准 §6/§7）。
    // 仅当话题位于行首时加反斜杠转义，避免被 Markdown 误判为标题。
    s = s.replace(/(^|\n)#([^#\s]+)/g, (_m, pre, topic) => `${pre}\\#${topic}`);
    return s.trim();
}

/** 从 content 中提取图片 URL 列表 */
function extractImages(content: string): string[] {
    const out: string[] = [];
    const re = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content || ''))) {
        out.push(m[1] || '');
    }
    return out;
}

/** 取条目时间原始字符串（兼容各模块不同字段名） */
function resolveTimeRaw(item: AnyItem): string | number {
    return (
        item.custom_create_time ??
        item.create_time ??
        item.pubTime ??
        item.pubtime ??
        item.shareTime ??
        item.time ??
        // 相片/视频拍摄时间：优先于上传时间。QQ 的原图转载相片 uploadTime 是固定占位
        // "1970-01-01 07:59:59"，若读 uploadTime 会把年份归档到 1970；真实拍摄时间在
        // shootTime/rawshoottime（与查看器 photoTimeOf 拍摄优先的口径一致）。
        item.rawshoottime ??
        item.shootTime ??
        item.uploadTime ??
        item.uploadtime ??
        item.createTime ??
        item.custom_publish_time ??
        ''
    );
}

/** 候选时间字段（优先级：越前越优先；与 resolveTimeRaw 同序） */
const TIME_CANDIDATE_KEYS: Array<keyof AnyItem> = [
    'custom_create_time', 'create_time', 'pubTime', 'pubtime', 'shareTime', 'time',
    'rawshoottime', 'shootTime', 'uploadTime', 'uploadtime', 'createTime', 'custom_publish_time',
];

/**
 * 解析条目时间。
 * 采集器里部分模块把时间存成秒级时间戳 Number；逐字段尝试，取第一个「可解析且非 1970 纪元」的时间。
 * 特别地，相片 `shootTime=0`（Unix 纪元）会被腾讯当占位返回，而此时 uploadTime 可能才是真实上传时间；
 * 若用 `resolveTimeRaw`（`??` 语义）会因 0 不是 null/undefined 而误取 1970，故这里逐字段解析并跳过 1970。
 */
function parseItemTime(item: AnyItem): Date {
    for (const key of TIME_CANDIDATE_KEYS) {
        const raw = item[key];
        if (raw == null || raw === '') continue;
        let d: Date;
        if (typeof raw === 'number') {
            d = parseDate(raw);
        } else {
            const trimmed = String(raw).trim();
            // 纯数字秒(10)/毫秒(13)时间戳 → 按数值解析
            if (/^\d+$/.test(trimmed) && trimmed.length >= 10 && trimmed.length <= 13) {
                const n = Number.parseInt(trimmed, 10);
                d = Number.isFinite(n) ? parseDate(n) : new Date(NaN);
            } else {
                d = parseDate(trimmed);
            }
        }
        if (isNaN(d.getTime())) continue;
        // 1970 是 Unix 纪元占位，QQ 空间 2005 年后才有内容，真实时间不可能在此；跳过该字段取下一个
        if (d.getUTCFullYear() === 1970) continue;
        return d;
    }
    return new Date(NaN);
}

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

/** 导出时间格式化为 `YYYY-MM-DD HH:mm` */
function formatExportTime(d: Date): string {
    if (!(d instanceof Date) || isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/* ====================== 空间档案字段映射（来自 user.js） ====================== */

/** 去除 QQ 空间签名的 BBcode 标签（[url=][ft=][I] 等），仅保留纯文本 */
function stripBBCode(s: string): string {
    return s
        .replace(/\[[\/]?[a-zA-Z][^\]]*\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** sex：1=男 2=女 */
function mapSex(v: unknown): string | undefined {
    if (v === 1) return '男';
    if (v === 2) return '女';
    return undefined;
}

/** constellation：1=水瓶座 … 12=摩羯座 */
function mapConstellation(v: unknown): string | undefined {
    const map = ['', '水瓶座', '双鱼座', '白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座', '天秤座', '天蝎座', '射手座', '摩羯座'];
    const n = Number(v);
    return n >= 1 && n <= 12 ? map[n] : undefined;
}

/** bloodtype：1=A 型 2=B 型 3=O 型 4=AB 型 5=其他（QQ 编码 1~5，0=未填跳过） */
function mapBloodType(v: unknown): string | undefined {
    const map = ['', 'A 型', 'B 型', 'O 型', 'AB 型', '其他'];
    const n = Number(v);
    return n >= 1 && n <= 5 ? map[n] : undefined;
}

/**
 * marriage：1=单身 2=已婚 3=恋爱中（QQ 个人档「感情状况」通用数字编码）。
 * 仅 1~3 有广泛佐证，其余取值（离异/分居等）跳过，避免臆测。
 */
function mapMarriage(v: unknown): string | undefined {
    const map = ['', '单身', '已婚', '恋爱中'];
    const n = Number(v);
    return n >= 1 && n <= 3 ? map[n] : undefined;
}

/** 拼接「国家 省 市」，自动跳过空字段 */
function joinLocation(c: unknown, p: unknown, ci: unknown): string {
    return [c, p, ci]
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter(Boolean)
        .join(' ');
}

/** QQ 个人档里表示「未填写」的占位文案，渲染时应跳过（注意：QQ 未填公司时显示的原文是「还没有」，按用户要求原样保留，不在跳过名单） */
const PROFILE_PLACEHOLDERS = new Set(['无', '暂无', '保密', '未填写', '不公开', '（未填写）', '（空）']);
/** 判断字段是否为「未填写」占位（空串或已知占位文案） */
function isProfilePlaceholder(v: unknown): boolean {
    if (typeof v !== 'string') return v === undefined || v === null;
    const s = v.trim();
    return s === '' || PROFILE_PLACEHOLDERS.has(s);
}

/**
 * 由原始 user.js 档案生成「空间资料」小节的 Markdown 行。
 * 仅输出有实际意义的字段；无效值（如 age=124/birthyear=1901 这类默认占位）一律跳过。
 * 昵称/QQ/空间名已在开篇说明呈现，此处只补充其余档案字段，避免重复。
 */
function buildSpaceProfileLines(profile?: Record<string, unknown>): string[] {
    if (!profile) return [];
    const get = (k: string): unknown => profile[k];
    const rows: Array<[string, string]> = [];

    const sex = mapSex(get('sex'));
    if (sex) rows.push(['性别', sex]);

    const birthday = typeof get('birthday') === 'string' ? (get('birthday') as string).trim() : '';
    if (birthday && birthday !== '0-0') rows.push(['生日', birthday]);

    const constellation = mapConstellation(get('constellation'));
    if (constellation) rows.push(['星座', constellation]);

    const blood = mapBloodType(get('bloodtype'));
    if (blood) rows.push(['血型', blood]);

    const marriage = mapMarriage(get('marriage'));
    if (marriage) rows.push(['婚姻', marriage]);

    const loc = joinLocation(get('country'), get('province'), get('city'));
    if (loc) rows.push(['所在地', loc]);

    const home = joinLocation(get('hco'), get('hp'), get('hc'));
    if (home && home !== loc) rows.push(['家乡', home]);

    const company = typeof get('company') === 'string' ? (get('company') as string).trim() : '';
    if (company && !isProfilePlaceholder(company)) {
        const cloc = joinLocation(get('cco'), get('cp'), get('cc'));
        rows.push(['公司', cloc ? `${company}（${cloc}）` : company]);
    }

    const rawSig = typeof get('signature') === 'string' ? (get('signature') as string) : '';
    const sig = stripBBCode(rawSig);
    if (sig) rows.push(['个性签名', sig]);

    if (rows.length === 0) return [];
    return ['## 空间资料', '', ...rows.map(([k, v]) => `- **${k}**：${v}`), ''];
}

/** 格式化为 `YYYY-MM-DD HH:mm` */
function formatTime(item: AnyItem): string {
    const d = parseItemTime(item);
    if (d && !isNaN(d.getTime())) {
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }
    return String(resolveTimeRaw(item) || '');
}

/** 格式化为 `YYYYMMDDHHMMSS`（用于文件名） */
function formatTimeForFile(item: AnyItem): string {
    const d = parseItemTime(item);
    if (d && !isNaN(d.getTime())) {
        return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
    }
    return '00000000000000';
}

function yearOf(item: AnyItem): string {
    const d = parseItemTime(item);
    if (d && !isNaN(d.getTime())) return String(d.getFullYear());
    return 'unknown';
}

function monthOf(item: AnyItem): string {
    const d = parseItemTime(item);
    if (d && !isNaN(d.getTime())) return String(d.getMonth() + 1).padStart(2, '0');
    return 'unknown';
}

/** 时间分组键（年份/月份文本）的倒序比较键：unknown 视为最小，沉底 */
function orderKey(k: string): number {
    return k === 'unknown' ? -1 : Number(k);
}

/** 文件名非法字符清洗（保留中英文，仅剔除文件系统禁用符） */
function safeName(s: string): string {
    const cleaned = String(s ?? '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || '未命名';
}

/* ============================ 条目渲染 ============================ */

/**
 * 评论条目取时间文本。
 * 不同模块评论字段不同：Messages 用 createTime 字符串，留言板 replyList 用 `time` 秒级时间戳。
 * 这里统一兼容 Date 字符串 / 秒级时间戳 / 毫秒级时间戳。
 */
function formatCommentTime(c: any): string {
    // 优先取完整时间戳（数字秒/毫秒或 ISO 串），其次才是 createTime 这类中文日期
    // （真实数据里 createTime 常是「2021年01月08日」无时分秒，create_time 才是完整时间）
    const raw = c?.postTime ?? c?.create_time ?? c?.created_time ?? c?.time ?? c?.createTime ?? c?.createdTime ?? '';
    if (raw == null || raw === '') return '';
    const s = String(raw).trim();
    let d: Date | undefined;
    if (typeof raw === 'number') d = parseDate(raw);
    else if (/^\d{10,13}$/.test(s)) d = parseDate(Number.parseInt(s, 10));
    else {
        d = parseDate(s);
        // 中文日期（如「2021年01月08日」）new Date 无法解析，先转 ISO 再试
        if (isNaN(d.getTime()) && /年/.test(s)) {
            const iso = s.replace('年', '-').replace('月', '-').replace('日', '');
            d = parseDate(iso);
        }
    }
    if (d && !isNaN(d.getTime())) {
        return `（${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}）`;
    }
    return s ? `（${s}）` : '';
}

/** 按模块取该条目的评论数组（各模块存放字段不一致） */
function commentsOf(module: string, item: AnyItem): any[] {
    if (module === 'Boards') return Array.isArray(item.replyList) ? item.replyList : [];
    if (module === 'Videos' || module === 'Shares') return Array.isArray(item.comments) ? item.comments : [];
    if (Array.isArray(item.custom_comments)) return item.custom_comments;
    return Array.isArray(item.comments) ? item.comments : [];
}

/** 按模块取该条目的点赞数组 */
function likesOf(module: string, item: AnyItem): any[] {
    if (Array.isArray(item.custom_like_list)) return item.custom_like_list;
    if (Array.isArray(item.likeList)) return item.likeList;
    if (module === 'Shares' && Array.isArray(item.likes)) return item.likes;
    return [];
}

/**
 * 按模块取该条目的正文文本（采集器各模块字段未完全归一，这里就地兼容）。
 * Boards → 留言板 HTML 文本；Videos → 标题/描述；Shares → 描述+来源；Visitors → 访客名；其余 → 通用字段。
 */
function entryBodyText(module: string, item: AnyItem): string {
    switch (module) {
        case 'Boards':
            // 留言的图片写在正文里，htmlContent 才含真实 <img> 标签；ubbContent 是 BBcode
            // （[img]url[/img]），htmlToMarkdown 无法还原成图片，故优先 htmlContent（与查看器一致）。
            return item.htmlContent || item.ubbContent || item.content || '';
        case 'Videos': {
            const parts: string[] = [];
            if (item.title) parts.push(`**${item.title}**`);
            if (item.name && item.name !== item.title) parts.push(item.name);
            if (item.desc) parts.push(item.desc);
            return parts.join('\n\n');
        }
        case 'Shares': {
            const parts: string[] = [];
            if (item.desc) parts.push(item.desc);
            const src = item.source;
            if (src && typeof src === 'object') {
                if (src.title) parts.push(`**${src.title}**`);
                if (src.desc) parts.push(src.desc);
                if (src.url && src.url !== '#') parts.push(`[${src.title || src.desc || '原文链接'}](${src.url})`);
            }
            return parts.join('\n\n');
        }
        case 'Visitors':
            // 访客信息由 renderEntry 标题行渲染（含空间链接），设空避免与标题重复
            return '';
        default:
            return item.content || item.summary || item.message || item.custom_abstract || '';
    }
}

/** 取评论/回复的发表人（与查看器 commentUser 同口径：poster 嵌套优先，其次扁平字段） */
function commentAuthor(c: any): { uin?: unknown; name?: string } {
    if (c?.poster) {
        return {
            uin: c.poster.uin ?? c.poster.id ?? c.poster.fuin,
            name: c.poster.name || c.poster.nick || c.poster.nickname,
        };
    }
    return {
        uin: c?.uin ?? c?.fuin,
        name: c?.name || c?.nick || c?.uinname,
    };
}

function renderComments(module: string, item: AnyItem, hasUserLink: boolean, title = '评论'): string {
    const comments = commentsOf(module, item);
    if (comments.length === 0) return '';
    const lines = comments.map((c: any) => {
        const author = commentAuthor(c);
        const display = renderUserLink(author.uin, author.name || '匿名', hasUserLink);
        const content = typeof c.content === 'string' ? htmlToMarkdown(c.content) : String(c.content || '');
        const time = formatCommentTime(c);
        let line = `- ${display}${time}：${content}`;
        const replies = Array.isArray(c.replies) ? c.replies
            : Array.isArray(c.list_3) ? c.list_3
            : Array.isArray(c.replyList) ? c.replyList : [];
        for (const r of replies) {
            const rauthor = commentAuthor(r);
            const rdisplay = renderUserLink(rauthor.uin, rauthor.name || '匿名', hasUserLink);
            const rcontent = typeof r.content === 'string' ? htmlToMarkdown(r.content) : String(r.content || '');
            const rtime = formatCommentTime(r);
            line += `\n  - ${rdisplay}${rtime}：${rcontent}`;
        }
        return line;
    });
    // 统一评论块标题：`**标题（N）**` + 列表，避免调用方再叠一个标题造成重复
    return `**${title}（${comments.length}）**\n` + lines.join('\n');
}

/** 解析图片对象为可用的 URL（V2 formatMediaMarkdown 读的是 custom_url / custom_filepath，此处保持一致） */
function resolveImageUrl(p: any): string {
    if (p == null) return '';
    if (typeof p === 'string') return p;
    return (
        p.custom_filepath ||
        p.custom_url ||
        p.url ||
        p.url1 ||
        p.hd_url ||
        p.smallurl ||
        p.original ||
        p.pic ||
        ''
    );
}

/** 从视频对象提取封面/预览图地址（与查看器 videoPoster 一致：本地优先，退外链） */
function resolveVideoCover(v: any): string {
    if (v == null || typeof v === 'string') return '';
    return (
        v.custom_pre_filepath ||
        v.custom_pre_url ||
        v.custom_pre ||
        v.preview_img ||
        v.pre ||
        v.url1 ||
        v.cover ||
        ''
    );
}

function renderMedia(module: string, item: AnyItem): string {
    const lines: string[] = [];
    const pushImg = (url: string) => {
        url = mediaHref(url);
        if (url && !lines.includes(`![图片](${url})`)) lines.push(`![图片](${url})`);
    };
    const pushVideo = (url: string) => {
        if ((url = mediaHref(url))) lines.push(`[视频](${url})`);
    };
    // 视频统一「封面可点击打开视频」：取到封面与可播放地址时输出 [![封面](cover)](playUrl)，
    // 否则退回仅封面图 / 仅视频链接。
    const pushVideoCover = (playUrl: string, coverUrl: string) => {
        playUrl = mediaHref(playUrl);
        coverUrl = mediaHref(coverUrl);
        if (playUrl && coverUrl) lines.push(`[![图片](${coverUrl})](${playUrl})`);
        else if (playUrl) pushVideo(playUrl);
        else if (coverUrl) pushImg(coverUrl);
    };
    // 通用：Messages 等的配图 / 视频（部分模块只写 custom_images，如 Favorites）
    const pics: unknown[] = Array.isArray(item.pic) ? item.pic : Array.isArray(item.custom_images) ? item.custom_images : [];
    for (const p of pics) pushImg(resolveImageUrl(p));
    // 视频：Messages 等用 video（可能是单对象或数组）；收藏（Favorites）统一放在 custom_videos（含 preview_img 封面）
    let rawVideos: unknown = Array.isArray(item.video) || (item.video && typeof item.video === 'object') ? item.video : item.custom_videos;
    if (rawVideos && !Array.isArray(rawVideos)) rawVideos = [rawVideos];
    for (const v of (rawVideos as any[]) || []) {
        const play = typeof v === 'string' ? v
            : (v as any)?.custom_filepath || (v as any)?.custom_url || (v as any)?.url
                || (v as any)?.hd_url || (v as any)?.video_url || (v as any)?.play_url || '';
        pushVideoCover(play, resolveVideoCover(v));
    }
    // 分享内嵌的来源图片（source.images）
    if (module === 'Shares') {
        const src = item.source;
        for (const img of Array.isArray(src?.images) ? src.images : []) pushImg(resolveImageUrl(img));
    }
    // 视频模块：封面可点击打开视频文件；无封面时退回视频链接，无视频时退封面
    if (module === 'Videos') {
        const play = item.custom_filepath || item.custom_url || item.url || (item.video_info && item.video_info.video_url) || '';
        const cover = item.custom_pre_filepath || item.custom_pre_url || item.pre || item.url1 || '';
        pushVideoCover(play, cover);
    }
    // 留言板背景图 bmp 是图片 ID（如 "18d495a008528421"）而非 URL，本地无对应文件，
    // 渲染成 ![](id) 必然路径错误，故不渲染（方案 A ③，2026-08-20 起移除）
    // 正文内嵌 <img>（Messages 正文里的图）
    for (const img of extractImages(item.content || '')) pushImg(img);
    return lines.length ? '\n' + lines.join('\n') : '';
}

function renderForward(item: AnyItem, hasUserLink: boolean): string {
    if (!item.rt_uinname && !item.forward && !item.rt_content) return '';
    const who = item.rt_uinname || item.rt_nick || '某人';
    const display = renderUserLink(item.rt_uin || item.custom_uin || item.uin, who, hasUserLink);
    const content = item.rt_content || item.forward || item.content || '';
    return `\n> @${display}：\n> ${htmlToMarkdown(content).replace(/\n/g, '\n> ')}`;
}

function renderLikes(module: string, item: AnyItem, hasUserLink: boolean): string {
    const likes = likesOf(module, item);
    if (!Array.isArray(likes) || likes.length === 0) return '';
    const names = likes
        .map((l: any) => {
            const name = l.name || l.nick || l.uinname || l.uin || '';
            return name ? renderUserLink(pickUin(l), name, hasUserLink) : '';
        })
        .filter(Boolean);
    if (names.length === 0) return '';
    return `\n**点赞：** ${names.join('、')}`;
}

/** 访客访问内容概述（移植自查看器 visitorTitle：查看了哪些模块） */
function visitorTitle(item: AnyItem): string {
    const parts: string[] = [];
    if (item.shuoshuoes?.length) parts.push('说说');
    if (item.blogs?.length) parts.push('日志');
    if (item.photoes?.length) parts.push('相册');
    if (item.shares?.length) parts.push('分享');
    return parts.length === 0 ? '访问了空间' : '查看' + parts.join('、');
}

/** 列表类模块中「单条内容」的 Markdown 片段（用于按年归档文件与合并文件） */
function renderEntry(module: string, item: AnyItem, hasUserLink: boolean): string {
    const time = formatTime(item);
    const content = htmlToMarkdown(entryBodyText(module, item));
    const location = item.location ? `\n📍 ${item.location}` : '';
    const media = renderMedia(module, item);
    const forward = renderForward(item, hasUserLink);
    const likes = renderLikes(module, item, hasUserLink);
    // 留言板的 replyList 是「回复」而非「评论」，标题区分开
    const comments = renderComments(module, item, hasUserLink, module === 'Boards' ? '回复' : '评论');
    // 留言板/访客：标题行带用户名（含空间链接）；访客标题行含「访问了什么」
    const head = module === 'Boards'
        ? `### ${time} · ${renderUserLink(pickUin(item), item.nickname || item.name || '匿名', hasUserLink)}`
        : module === 'Visitors'
            ? `### ${time} · ${renderUserLink(pickUin(item), item.nickname || item.name || '匿名', hasUserLink)} ${visitorTitle(item)}`
            : `### ${time}`;
    return [
        head,
        // 访客信息已含在标题行，正文不再补「无正文」
        content ? content + location : (module === 'Visitors' ? '' : '(无正文)' + location),
        forward,
        media,
        likes,
        comments,
    ]
        .filter((s) => s !== '')
        .join('\n');
}

/** 日志/日记「单篇」完整 Markdown 文档 */
function renderArticle(module: string, item: AnyItem, hasUserLink: boolean): string {
    const title = formatTokens(item.title || '(无标题)');
    const date = formatTime(item);
    // 正文：优先完整 HTML（custom_html），否则退化为 content
    const raw = item.custom_html || item.content || item.summary || '';
    const body = htmlToMarkdown(raw);
    const comments = renderComments(module, item, hasUserLink);
    const sections = [`# ${title}`, `> ${date}`, ''];
    if (body) sections.push(body);
    sections.push('');
    // 评论标题由 renderComments 统一输出（**评论（N）**），这里不再重复打标题
    if (comments) sections.push(comments);
    return sections.filter((s) => s !== '').join('\n');
}

/* ============================ 数据归一化 ============================ */

/** 留言板/访客把列表包在 { items } 里，这里拆出来，避免被当成空数组 */
function normalizeItems(module: string, items: unknown): AnyItem[] {
    if (module === 'Boards' || module === 'Visitors') {
        const obj = items as { items?: AnyItem[] };
        if (obj && Array.isArray(obj.items)) return obj.items;
    }
    return (Array.isArray(items) ? items : []) as AnyItem[];
}

const TITLE_MAP: Record<string, string> = {
    Messages: '说说', Blogs: '日志', Diaries: '日记', Photos: '相册',
    Videos: '视频', Boards: '留言板', Friends: '好友', Favorites: '收藏',
    Shares: '分享', Visitors: '访客', Common: '其他',
};

/* ============================ 导出实现 ============================ */

/** 列表类模块：按年拆分 `{year}.md`，并写一份合并 `index.md` */
async function exportListByYear(
    module: string,
    items: AnyItem[],
    writer: FileWriter,
    opts?: MarkdownOptions,
): Promise<void> {
    const hasUserLink = opts?.hasUserLink ?? true;
    const title = TITLE_MAP[module] || module;
    const dir = module;
    await writer.createFolder(dir);
    // 本模块 MD 文件都位于 {dir}（如 Messages/），媒体引用按该目录换算相对路径
    mdRelDir = dir;

    // 时间倒序（最新在上，与 QQ 空间页面一致）：采集器传入即按 IncrementField 降序，
    // 这里只负责把「年/月分组」也排成倒序（组内保持采集器降序）；unknown 年份/月份沉底。
    const byYear = new Map<string, AnyItem[]>();
    for (const it of items) {
        const y = yearOf(it);
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y)!.push(it);
    }
    const years = Array.from(byYear.keys()).sort((a, b) => orderKey(b) - orderKey(a));

    const yearFiles: string[] = [];
    for (const y of years) {
        const list = byYear.get(y)!;
        const lines: string[] = [`# ${title} ${y}年（共 ${list.length} 条）`, ''];
        const byMonth = new Map<string, AnyItem[]>();
        for (const it of list) {
            const m = monthOf(it);
            if (!byMonth.has(m)) byMonth.set(m, []);
            byMonth.get(m)!.push(it);
        }
        const months = Array.from(byMonth.keys()).sort((a, b) => orderKey(b) - orderKey(a));
        for (const m of months) {
            lines.push(`## ${m}月`);
            for (const it of byMonth.get(m)!) {
                lines.push(renderEntry(module, it, hasUserLink), '');
            }
        }
        const text = lines.join('\n');
        const file = `${dir}/${y}.md`;
        await writer.writeText(text, file);
        yearFiles.push(file);
    }

    // 合并文件
    const combined: string[] = [
        `# ${title}（共 ${items.length} 条）`,
        '',
        '> 本模块按年份拆分为多个 `{year}.md` 文件，本文为合并视图。',
        '',
    ];
    if (years.length === 0) {
        combined.push('_无数据_');
    } else {
        for (const y of years) {
            combined.push(`## ${y}年`);
            for (const it of byYear.get(y)!) {
                combined.push(renderEntry(module, it, hasUserLink), '');
            }
        }
    }
    await writer.writeText(combined.join('\n'), `${dir}/index.md`);
}

/** 日志/日记：每篇独立 MD 文件，按分类归档；并生成模块级 `index.md` 作为入口 */
async function exportArticles(
    module: string,
    items: AnyItem[],
    writer: FileWriter,
    opts?: MarkdownOptions,
): Promise<void> {
    const hasUserLink = opts?.hasUserLink ?? true;
    const dir = module;
    await writer.createFolder(dir);
    const total = String(items.length).length;
    const toc: string[] = [
        `# ${TITLE_MAP[module] || module}（共 ${items.length} 篇）`,
        '',
        '> 每篇日志为独立文件，按分类归档于子目录。',
        '',
    ];
    if (items.length === 0) toc.push('_无内容_');
    for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        const order = String(i + 1).padStart(total, '0');
        const date = formatTimeForFile(item);
        const title = safeName(item.title || '未命名');
        const category = safeName(item.category || '默认');
        const categoryDir = `${dir}/${category}`;
        await writer.createFolder(categoryDir);
        // 文章在 {dir}/{category}/ 下，媒体引用按该目录换算相对路径
        mdRelDir = categoryDir;
        const md = renderArticle(module, item, hasUserLink);
        const file = `${categoryDir}/${order}_${date}_【${title}】.md`;
        await writer.writeText(md, file);
        const rel = `./${category}/${order}_${date}_【${title}】.md`;
        toc.push(`- [${title}](./${rel})`);
    }
    await writer.writeText(toc.join('\n'), `${dir}/index.md`);
}

/** 相册：每个相册一个文件夹，按相册分类嵌套（对齐 QQ 空间相册分类），内含按年 `{year}.md` + 相册汇总 `index.md`；
 *  目录统一用 `Albums`（与 JSON/查看器的 Albums/ 对齐，而非旧代码遗留的 Photos）。
 *  相片媒体文件由采集器下载到各自位置，此处只组织 MD 文件目录，引用路径按相对换算。 */
async function exportPhotos(
    albums: AnyItem[],
    writer: FileWriter,
    opts?: MarkdownOptions,
): Promise<void> {
    const hasUserLink = opts?.hasUserLink ?? true;
    const dir = 'Albums';
    await writer.createFolder(dir);

    // 把相册按其分类（className）分组，便于 MD 目录与汇总按分类组织
    const byCategory = new Map<string, AnyItem[]>();
    for (const album of albums) {
        const cat = safeName(album.className || '未分类');
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(album);
    }
    // 分类排序：尽量按 classSort，缺省保持采集器顺序
    const categories = Array.from(byCategory.keys()).sort((a, b) => {
        const sa = (byCategory.get(a)![0] as AnyItem).classSort;
        const sb = (byCategory.get(b)![0] as AnyItem).classSort;
        if (typeof sa === 'number' && typeof sb === 'number') return sa - sb;
        return 0;
    });

    for (const cat of categories) {
        for (const album of byCategory.get(cat)!) {
            const photos: AnyItem[] = Array.isArray(album.photoList) ? album.photoList : [];
            const albumName = safeName(album.name || '未命名相册');
            const albumDir = `${dir}/${cat}/${albumName}`;
            await writer.createFolder(albumDir);
            // 相册在本相册文件夹 {albumDir}/ 下，媒体引用按该目录换算相对路径
            mdRelDir = albumDir;

            const byYear = new Map<string, AnyItem[]>();
            for (const p of photos) {
                const y = yearOf(p);
                if (!byYear.has(y)) byYear.set(y, []);
                byYear.get(y)!.push(p);
            }
            // 年份倒序（最新在上），组内保持采集器降序
            const years = Array.from(byYear.keys()).sort((a, b) => orderKey(b) - orderKey(a));
            for (const y of years) {
                const lines: string[] = [`# ${albumName} ${y}年（共 ${byYear.get(y)!.length} 张）`, ''];
                for (const p of byYear.get(y)!) {
                    lines.push(renderPhoto(p, hasUserLink), '');
                }
                await writer.writeText(lines.join('\n'), `${albumDir}/${y}.md`);
            }
            // 相册汇总
            const summary: string[] = [`# ${albumName}（共 ${photos.length} 张）`, ''];
            if (photos.length === 0) summary.push('_无相片_');
            for (const p of photos) summary.push(renderPhoto(p, hasUserLink), '');
            await writer.writeText(summary.join('\n'), `${albumDir}/index.md`);
        }
    }

    // 模块级汇总 Albums/index.md（按相册分类分组，列出各相册入口）
    const albumSummary: string[] = [
        `# 相册（共 ${albums.length} 个相册）`,
        '',
        '> 按相册分类拆分目录，每个相册内含按年拆分与汇总 `index.md`。',
        '',
    ];
    if (albums.length === 0) albumSummary.push('_无相册_');
    for (const cat of categories) {
        const list = byCategory.get(cat)!;
        albumSummary.push(`## ${cat}（${list.length}）`, '');
        for (const album of list) {
            const photos: AnyItem[] = Array.isArray(album.photoList) ? album.photoList : [];
            const albumName = safeName(album.name || '未命名相册');
            albumSummary.push(`- [${albumName}](./${safeName(album.className || '未分类')}/${albumName}/index.md)（${photos.length} 张）`);
        }
        albumSummary.push('');
    }
    await writer.writeText(albumSummary.join('\n'), `${dir}/index.md`);
}

/** 单张相片/视频的 Markdown 片段 */
function renderPhoto(photo: AnyItem, hasUserLink: boolean): string {
    const rawName = photo.name || '';
    const name = formatTokens(rawName);
    const desc = formatTokens(photo.desc || rawName);
    const lines: string[] = [];
    if (name) lines.push(`> ${name}`);
    if (photo.is_video) {
        // 相片里的视频：封面可点击打开视频文件（本地文件优先，退在线视频地址）
        const play = mediaHref(photo.custom_filepath
            || (photo.video_info && photo.video_info.video_url)
            || photo.custom_url || photo.url || '');
        const cover = mediaHref(photo.custom_pre_filepath || photo.custom_pre_url || photo.custom_url || photo.url || '');
        if (play && cover) {
            lines.push(`[![${name || '视频封面'}](${cover})](${play})`);
        } else if (play) {
            lines.push(`![${name || '视频封面'}](${play})`);
        }
        if (play) lines.push(`> 📹 [点击播放视频](${play})`);
    } else {
        const url = mediaHref(photo.custom_filepath || photo.custom_url || photo.url || '');
        if (url) lines.push(`![${name || '图片'}](${url})`);
    }
    if (desc) lines.push(`> ${desc}`);
    const cmt = renderComments('Photos', photo, hasUserLink);
    if (cmt) lines.push(cmt);
    lines.push('---');
    return lines.filter((s) => s !== '').join('\n');
}

/** 好友：单个 `QQ好友.md` */
async function exportFriends(
    friends: AnyItem[],
    writer: FileWriter,
    _opts?: MarkdownOptions,
): Promise<void> {
    const dir = 'Friends';
    await writer.createFolder(dir);
    const byGroup = new Map<string, AnyItem[]>();
    for (const f of friends) {
        const g = f.groupName || '未分组';
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g)!.push(f);
    }
    const groups = Array.from(byGroup.keys()).sort();
    const lines: string[] = [
        `# QQ好友（共 ${friends.length} 位）`,
        '',
        '> 按分组列出；点击昵称可跳转其 QQ 空间（若已开启生成空间链接）。',
        '',
    ];
    for (const g of groups) {
        const list = byGroup.get(g)!;
        lines.push(`## ${g}（${list.length}）`, '');
        for (const f of list) {
            const nickname = f.remark || f.name || '匿名';
            lines.push(`- ${renderUserLink(f.uin, nickname, true)}`);
        }
        lines.push('', '---', '');
    }
    await writer.writeText(lines.join('\n'), `${dir}/QQ好友.md`);
}

/** 收藏：按年拆分 `{year}.md` + 合并 `index.md` */
async function exportFavorites(
    favorites: AnyItem[],
    writer: FileWriter,
    opts?: MarkdownOptions,
): Promise<void> {
    const hasUserLink = opts?.hasUserLink ?? true;
    const dir = 'Favorites';
    await writer.createFolder(dir);
    mdRelDir = dir;

    const byYear = new Map<string, AnyItem[]>();
    for (const it of favorites) {
        const y = yearOf(it);
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y)!.push(it);
    }
    const years = Array.from(byYear.keys()).sort((a, b) => orderKey(b) - orderKey(a));
    for (const y of years) {
        const lines: string[] = [`# 收藏 ${y}年`, ''];
        const byMonth = new Map<string, AnyItem[]>();
        for (const it of byYear.get(y)!) {
            const m = monthOf(it);
            if (!byMonth.has(m)) byMonth.set(m, []);
            byMonth.get(m)!.push(it);
        }
        // 月份倒序（最新在上），组内保持采集器降序
        const months = Array.from(byMonth.keys()).sort((a, b) => orderKey(b) - orderKey(a));
        for (const m of months) {
            lines.push(`## ${m}月`);
            for (const it of byMonth.get(m)!) {
                lines.push(renderFavorite(it, hasUserLink), '---');
            }
        }
        await writer.writeText(lines.join('\n'), `${dir}/${y}.md`);
    }
    // 合并
    const combined: string[] = [
        `# 收藏（共 ${favorites.length} 条）`,
        '',
        '> 本模块按年份拆分为多个 `{year}.md` 文件，本文为合并视图。',
        '',
    ];
    for (const y of years) {
        combined.push(`## ${y}年`);
        for (const it of byYear.get(y)!) combined.push(renderFavorite(it, hasUserLink), '---');
    }
    await writer.writeText(combined.join('\n'), `${dir}/index.md`);
}

/** 收藏类型 → 中文标签（与查看器 favoriteTypeLabel 一致） */
const FAVORITE_TYPE_TEXT: Record<number, string> = {
    0: '全部', 1: '网页', 2: '照片', 3: '日志', 4: '照片', 5: '说说', 6: '文字', 7: '分享',
};

/** 收藏「被收藏内容」的正文/摘要（对齐 V2：说说优选详情内容，其余取摘要） */
function favoriteBodyText(item: AnyItem): string {
    const detail = item.shuoshuo_info?.detail_shuoshuo_info?.content;
    if (Number(item.type) === 5 && detail) {
        return String(detail);
    }
    return String(item.custom_abstract || item.abstract || item.desp || '');
}

/** 收藏的「收藏理由」（收藏时写的话，shuoshuo/share 都可能带；对齐查看器 favoriteReason） */
function favoriteReasonText(item: AnyItem): string {
    return String(item.shuoshuo_info?.reason ?? item.share_info?.reason ?? '');
}

/** 收藏原内容链接（日志类收藏链到原日志；其余用 url，需联网） */
function favoriteSourceUrl(item: AnyItem): string {
    const blog = item.blog_info;
    if (blog?.owner_uin && blog?.id) {
        return `https://user.qzone.qq.com/${blog.owner_uin}/blog/${blog.id}`;
    }
    return String(item.url || '');
}

/**
 * 渲染单条收藏。
 * 对齐 V2 与查看器结构：首行「类型 + 收藏时间」，随后收藏理由、被收藏内容
 * 的标题（带原链接）、正文/摘要、媒体，各自占独立段落；正文 HTML 一律转 Markdown。
 */
function renderFavorite(favorite: AnyItem, hasUserLink: boolean): string {
    const typeLabel = FAVORITE_TYPE_TEXT[Number(favorite.type)] || '收藏';
    const time = formatTime(favorite);
    const lines: string[] = [`**[${typeLabel}]** ${time}`];

    const reasonMd = htmlToMarkdown(favoriteReasonText(favorite));
    if (reasonMd.trim() !== '') lines.push(reasonMd);

    const title = formatTokens(String(favorite.title || favorite.custom_title || '').trim());
    if (title) {
        const src = hasUserLink ? favoriteSourceUrl(favorite) : '';
        lines.push(src ? `**《${title}》**（[原内容](${src})）` : `**《${title}》**`);
    }

    const bodyMd = htmlToMarkdown(favoriteBodyText(favorite));
    if (bodyMd.trim() !== '') lines.push(bodyMd);

    // 收藏内嵌媒体（图片/视频列表）
    const media = renderMedia('Favorites', favorite);
    if (media.trim() !== '') lines.push(media.trim());

    return lines.filter((s) => s.trim() !== '').join('\n\n');
}

/* ============================ 根目录聚合 ============================ */

/** 根 index.md 条目（仅记录实际导出 MarkDown 的模块） */
interface RootIndexEntry {
    /** 模块目录名（相册为 Albums，其余与模块名一致） */
    dir: string;
    /** 展示标题 */
    title: string;
    /** 该模块的入口 MD 文件 */
    primary: string;
    /** 条数文案（如「1,284 条」），用于根 index 开篇说明 */
    countText: string;
}

/** 各模块条数单位（用于根 index 开篇说明） */
const COUNT_UNIT: Record<string, string> = {
    Messages: '条', Videos: '条', Shares: '条', Visitors: '条',
    Boards: '条', Favorites: '条', Blogs: '篇', Diaries: '篇',
    Photos: '个', Friends: '位',
};

/** 模块目录与 MODULE_ORDER 对应（相册目录是 Albums，故单独映射） */
const ROOT_INDEX_ORDER = [
    'Messages', 'Blogs', 'Diaries', 'Photos', 'Videos',
    'Boards', 'Friends', 'Favorites', 'Shares', 'Visitors',
] as const;

// 累加态：跨模块导出共享，必须在每次备份开始时 reset（见 resetMarkdownRootIndex）。
const rootIndexEntries: RootIndexEntry[] = [];
/** 根 index.md 开篇说明所用空间主人信息（跨模块共享，备份开始 reset） */
let markdownMeta: MarkdownMeta = {};

/** 重置根 index.md 累加态（每次备份启动调用一次，避免跨备份污染） */
export function resetMarkdownRootIndex(): void {
    rootIndexEntries.length = 0;
    markdownMeta = {};
    markdownLinkMode = false;
    mdRelDir = '';
}

/** 记录某模块的根索引条目（相册目录统一为 Albums）；count 为该模块导出条数 */
function recordRootIndex(module: string, count: number): void {
    const unit = COUNT_UNIT[module] || '条';
    const countText = `${count} ${unit}`;
    if (module === 'Photos') {
        rootIndexEntries.push({ dir: 'Albums', title: '相册', primary: 'Albums/index.md', countText });
        return;
    }
    if (module === 'Friends') {
        rootIndexEntries.push({ dir: 'Friends', title: '好友', primary: 'Friends/QQ好友.md', countText });
        return;
    }
    const title = TITLE_MAP[module] || module;
    rootIndexEntries.push({ dir: module, title, primary: `${module}/index.md`, countText });
}

/** 刷新根目录 index.md（按 MODULE_ORDER 排序，仅含本次实际导出的模块） */
async function writeRootIndex(writer: FileWriter): Promise<void> {
    // 根 index.md 位于备份根：媒体引用根相对即可，无需 ../ 前缀
    mdRelDir = '';
    const orderOf = (dir: string): number => {
        const idx = ROOT_INDEX_ORDER.indexOf((dir === 'Albums' ? 'Photos' : dir) as (typeof ROOT_INDEX_ORDER)[number]);
        return idx < 0 ? Number.MAX_SAFE_INTEGER : idx;
    };
    const seen = new Set<string>();
    const sorted = rootIndexEntries.filter((e) => (seen.has(e.dir) ? false : (seen.add(e.dir), true)))
        .sort((a, b) => orderOf(a.dir) - orderOf(b.dir));
    const lines: string[] = ['# QQ空间备份', ''];
    // 开篇说明（导出设计标准 §1）：来源 + 空间主人/名/QQ + 空间简介 + 导出时间 + 用途
    lines.push('> **导出说明**');
    lines.push('> - 来源：QQ 空间');
    // 空间主人信息各占一行，避免长行换行难看
    const nickname = markdownMeta.nickname;
    if (nickname) lines.push(`> - 空间主人：${nickname}`);
    const spaceName = markdownMeta.spaceName;
    if (spaceName && spaceName !== nickname) {
        lines.push(`> - 空间名：${spaceName}`);
    }
    if (markdownMeta.uin !== undefined && markdownMeta.uin !== '') {
        lines.push(`> - QQ：${markdownMeta.uin}`);
    }
    if (markdownMeta.desc) {
        lines.push(`> - 空间简介：${String(markdownMeta.desc).replace(/\s+/g, ' ').trim()}`);
    }
    if (markdownMeta.exportTime) {
        lines.push(`> - 导出时间：${formatExportTime(markdownMeta.exportTime)}`);
    }
    // 使用中文工具名「QQ空间导出助手」，避免英文名中夹杂
    lines.push('> - 由 QQ空间导出助手 生成，纯文本备份，可自由复制、编辑、转发；图片以链接形式引用。');
    lines.push('', '## 目录');
    // 模块条数直接放在目录条目括号里，开篇不再单独汇总
    if (sorted.length === 0) {
        lines.push('_无模块导出_');
    } else {
        for (const e of sorted) {
            const tail = e.countText ? `（${e.countText}）` : '';
            lines.push(`- [${e.title}](${e.primary})${tail}`);
        }
    }
    // 空间资料小节（来自 user.js 原始档案）；无档案字段时整段省略
    const profileLines = buildSpaceProfileLines(markdownMeta.profile);
    if (profileLines.length) lines.push('', ...profileLines);
    await writer.writeText(lines.join('\n'), 'index.md');
}

/* ============================ 入口 ============================ */

/** 导出模块 Markdown（落盘/ZIP）。按模块类型选择归档方式。 */
export async function exportModuleMarkdown(
    module: string,
    items: unknown,
    writer: FileWriter,
    opts?: MarkdownOptions,
): Promise<void> {
    const data = normalizeItems(module, items);
    // 透传空间主人信息到根 index.md 开篇说明（首次传入的 exportTime 锁定，保证整份备份时间一致）
    if (opts) {
        if (opts.isQzoneUrl !== undefined) markdownLinkMode = opts.isQzoneUrl;
        if (opts.nickname !== undefined) markdownMeta.nickname = opts.nickname;
        if (opts.spaceName !== undefined) markdownMeta.spaceName = opts.spaceName;
        if (opts.desc !== undefined) markdownMeta.desc = opts.desc;
        if (opts.signature !== undefined) markdownMeta.signature = opts.signature;
        if (opts.uin !== undefined) markdownMeta.uin = opts.uin;
        if (opts.exportTime !== undefined && markdownMeta.exportTime === undefined) {
            markdownMeta.exportTime = opts.exportTime;
        }
        if (opts.profile !== undefined && markdownMeta.profile === undefined) {
            markdownMeta.profile = opts.profile;
        }
    }
    switch (module) {
        case 'Photos':
            await exportPhotos(data, writer, opts);
            break;
        case 'Friends':
            await exportFriends(data, writer, opts);
            break;
        case 'Favorites':
            await exportFavorites(data, writer, opts);
            break;
        case 'Blogs':
        case 'Diaries':
            await exportArticles(module, data, writer, opts);
            break;
        default:
            await exportListByYear(module, data, writer, opts);
            break;
    }
    // 每次导出后刷新根 index.md（仅含实际导出的模块，按 MODULE_ORDER）
    recordRootIndex(module, data.length);
    await writeRootIndex(writer);
}

/**
 * 单个模块渲染为合并 Markdown 文本（保留旧接口；内部使用与导出一致的条目渲染）。
 * @deprecated 落盘请用 {@link exportModuleMarkdown}。
 */
export function renderModuleMarkdown(
    module: string,
    items: AnyItem[],
    opts?: MarkdownOptions,
): string {
    const hasUserLink = opts?.hasUserLink ?? true;
    const data = normalizeItems(module, items);
    const title = TITLE_MAP[module] || module;
    if (!Array.isArray(data) || data.length === 0) {
        return `# ${title}\n\n_无数据_\n`;
    }
    if (module === 'Blogs' || module === 'Diaries') {
        return data.map((it) => renderArticle(module, it, hasUserLink)).join('\n\n---\n\n');
    }
    const sections: string[] = [`# ${title}（共 ${data.length} 条）`, ''];
    const byYear = new Map<string, AnyItem[]>();
    for (const it of data) {
        const y = yearOf(it);
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y)!.push(it);
    }
    for (const y of Array.from(byYear.keys()).sort((a, b) => orderKey(b) - orderKey(a))) {
        sections.push(`## ${y}年`);
        for (const it of byYear.get(y)!) sections.push(renderEntry(module, it, hasUserLink), '');
    }
    return sections.join('\n');
}
