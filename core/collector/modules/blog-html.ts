import { hashString, toHttp, toParams, toUrl } from '../../shared/utils';
import { resolveMediaSuffix, type MediaOwner, type MediaTaskRegistry } from './helpers';
import type { CollectorEnv } from './types';

/**
 * 日志/日记详情页HTML处理（Blogs/Diaries 共用）
 * 移植自 api.js API.Blogs 的 DOM 相关逻辑与 blogs.js handerContentImages/handerMedias，
 * 用原生 DOMParser 替代 jQuery
 */

/** 从页面script标签中按正则提取变量（移植自 api.js readScriptVar L1922-1938） */
export function readScriptVar(doc: Document, regexp: RegExp): RegExpExecArray | null {
    const scripts = doc.querySelectorAll('script');
    for (const script of scripts) {
        const result = regexp.exec(script.textContent || '');
        if (result != null) {
            return result;
        }
    }
    return null;
}

/** 读取日志DOM中的详细信息（移植自 api.js readDetailInfo L2726-2730） */
export function readDetailInfo(doc: Document): Record<string, unknown> | null {
    // 获得网页中的日志JSON数据
    const blogData = readScriptVar(doc, /var g_oBlogData\s+=\s+({[\s\S]+});\s/);
    return (blogData && JSON.parse(blogData[1]!).data) || null;
}

/** 是否为模板日志（移植自 api.js isTemplateBlog L2737-2743） */
export function isTemplateBlog(item: { exblogtype?: number | string; blogType?: unknown } | null): boolean {
    if (!item) {
        return false;
    }
    return item.exblogtype == 2 || !!item.blogType;
}

/**
 * 读取模板日志内容（移植自 api.js readTemplateContent L2750-2769）
 * MV3不使用eval，将JS单引号字符串字面量转为JSON字符串后解码
 */
export function readTemplateContent(doc: Document): string | undefined {
    const regRes = readScriptVar(doc, /var g_oBlogContent\s+=\s+'([\s\S]+\/div>)';/);
    const raw = (regRes && regRes[1]) || '';
    if (!raw) {
        return undefined;
    }
    try {
        const jsonLiteral = raw
            .replace(/\\x([0-9a-fA-F]{2})/g, '\\u00$1')
            .replace(/"/g, '\\"')
            .replace(/\\'/g, "'");
        return JSON.parse('"' + jsonLiteral + '"');
    } catch (error) {
        // 纯 DOM 解析工具，不引入 env 依赖，这条罕见的解析失败保留 console
        console.warn('解析模板日志内容失败，已跳过', error);
        return undefined;
    }
}

/** 日志有效位判断（移植自 api.js getEffectBit L2579-2588） */
export function getEffectBit(e: { effect?: number; effect1?: number; effect2?: number }, t: number): number | undefined {
    if (t < 0 || t > 63) {
        throw new Error('nBit param error');
    }
    if (t < 32) {
        return ((e.effect || e.effect1 || 0) & (1 << t)) as number;
    } else if (t < 64) {
        return ((e.effect2 || 0) & (1 << t)) as number;
    }
    return undefined;
}

/** 日志原始数据接口（getBlogLabel 参数类型） */
export interface BlogRawItem {
    effect?: number;
    effect1?: number;
    effect2?: number;
    [key: string]: unknown;
}

/** 获取日志标签（移植自 api.js getBlogLabel L2548-2577） */
export function getBlogLabel(item: BlogRawItem): string[] {
    const allLabelCfg: Array<[string, string]> = [
        ['8', '审核不通过'],
        ['22', '审核中'],
        ['4', '置顶'],
        ['21', '推荐'],
        ['3', '转载'],
        ['28', '转载'],
        ['35', '转载'],
        ['36', '转载'],
    ];
    const labels: string[] = [];
    for (const [bit, label] of allLabelCfg) {
        if (bit == '22') {
            continue;
        }
        if (getEffectBit(item, Number(bit))) {
            if (labels.indexOf(label) > -1) {
                continue;
            }
            labels.push(label);
        }
    }
    if (labels.length === 0) {
        labels.push('原创');
    }
    return labels;
}

/** 获取腾讯视频的iframe播放地址（移植自 videos.js getTencentVideoUrl L606-619） */
export function getTencentVideoUrl(vid: string): string {
    return toUrl('https://v.qq.com/txp/iframe/player.html', {
        origin: 'https://user.qzone.qq.com',
        vid,
        autoplay: 'true',
        volume: 100,
        disableplugin: 'IframeBottomOpenClientBar',
        additionplugin: 'IframeUiSearch',
        platId: 'qzone_feed',
        show1080p: 'true',
        isDebugIframe: 'false',
    });
}

/**
 * 处理日志正文的图片（移植自 blogs.js handerContentImages L557-604）
 * 下载任务登记 + 改写离线地址 + 画廊标记
 */
export async function handleContentImages(
    env: CollectorEnv,
    registry: MediaTaskRegistry,
    item: unknown,
    detail: Element,
    moduleDir: string,
    exportType: string,
): Promise<void> {
    const images = detail.querySelectorAll('img');
    for (let i = 0; i < images.length; i++) {
        const img = images[i]!;
        // 处理相对协议
        let url = img.getAttribute('orgsrc') || img.getAttribute('src') || '';
        url = toHttp(url);

        // 添加下载任务
        if (!registry.isQzoneUrl()) {
            // 非QQ空间外链
            const uid = hashString(url);
            const suffix = await resolveMediaSuffix(url, env);
            const customFilename = uid + suffix;

            // 添加下载任务
            registry.newTask(url, moduleDir, customFilename, item);

            // 新的图片离线地址（相对备份根目录，如 Blogs/images/xxx）
            url = 'MarkDown' === exportType ? '../' + moduleDir + '/' + customFilename : moduleDir + '/' + customFilename;
        }

        // 修改日志中的图片链接与索引
        img.setAttribute('src', url);
        img.setAttribute('data-idx', String(i));

        // 图片上层的超链接
        const imageLink = img.parentElement && img.parentElement.tagName === 'A' ? img.parentElement : null;
        if (imageLink) {
            // 更改图片地址，画廊查看大图
            imageLink.setAttribute('href', url);
            imageLink.classList.add('lightgallery');
        } else {
            // 没有超链接的，需要添加超链接，用于生成画廊
            const wrapper = detail.ownerDocument!.createElement('a');
            wrapper.className = 'lightgallery';
            wrapper.setAttribute('href', url);
            img.replaceWith(wrapper);
            wrapper.appendChild(img);
        }
    }
}

/**
 * 处理日志正文的视频（移植自 blogs.js handerMedias L611-683）
 */
export async function handleContentMedias(
    env: CollectorEnv,
    registry: MediaTaskRegistry,
    item: unknown,
    detail: Element,
    moduleDir: string,
    exportType: string,
): Promise<void> {
    const embeds = detail.querySelectorAll('embed');
    const doc = detail.ownerDocument!;
    for (const embed of embeds) {
        const dataType = embed.getAttribute('data-type');
        let vid = embed.getAttribute('data-vid');
        let iframeUrl = embed.getAttribute('src') || '';
        const srcInfo = toParams(iframeUrl);
        switch (dataType) {
            case '1': {
                // 相册视频（MP4地址，TODO 是否也存在M3U8的场景？）
                const mp4Url = embed.getAttribute('data-mp4');
                if (Object.prototype.hasOwnProperty.call(srcInfo, 'vurl') || mp4Url) {
                    // 视频下载地址
                    let vurl = mp4Url || decodeURIComponent(srcInfo['vurl']!);
                    if (!registry.isQzoneUrl()) {
                        // 非QQ空间外链
                        const uid = hashString(vurl);
                        const suffix = await resolveMediaSuffix(vurl, env);
                        const customFilename = uid + suffix;
                        registry.newTask(vurl, moduleDir, customFilename, item);
                        // 新的离线地址（相对备份根目录）
                        vurl = 'MarkDown' === exportType ? '../' + moduleDir + '/' + customFilename : moduleDir + '/' + customFilename;
                    }
                    replaceWithHtml(doc, embed, `<video src="${vurl}" height="auto" width="100%" controls="controls" ></video>`);
                } else {
                    if (!vid) {
                        // 未知数据，不处理
                        env.logger.warn('未知数据，不处理（无 vid，跳过该嵌入元素）');
                        return;
                    }
                    // iframe 播放地址
                    iframeUrl = 'https://h5.qzone.qq.com/video/index?vid=' + vid;
                    replaceWithHtml(doc, embed, `<iframe src="${iframeUrl}" height="auto" width="100%" allowfullscreen="true"></iframe>`);
                }
                break;
            }
            case '51': {
                // 外部视频
                if (!vid) {
                    // 历史数据或特殊数据跳过不处理
                    env.logger.warn('未知数据，不处理（无 vid，跳过该嵌入元素）');
                    return;
                }
                iframeUrl = getTencentVideoUrl(vid);
                replaceWithHtml(doc, embed, `<iframe src="${iframeUrl}" height="auto" width="100%" allowfullscreen="true"></iframe>`);
                break;
            }
            default: {
                // 其他的，默认取src中的vid，当外部视频处理
                vid = srcInfo['vid'] || null;
                if (vid) {
                    iframeUrl = getTencentVideoUrl(vid);
                }
                replaceWithHtml(doc, embed, `<iframe src="${iframeUrl}" height="auto" width="100%" allowfullscreen="true"></iframe>`);
                break;
            }
        }
    }
}

/** 用HTML片段替换元素 */
function replaceWithHtml(doc: Document, el: Element, html: string): void {
    const tpl = doc.createElement('template');
    tpl.innerHTML = html;
    el.replaceWith(...tpl.content.childNodes);
}

/** 日志详情处理结果 */
export interface BlogDetailResult {
    /** 页面内嵌JSON中的详情数据（可能为null） */
    detailItem: Record<string, unknown> | null;
    /** 原始正文HTML（原始 UTF-8 字符串，不再 base64） */
    html: string;
    /** 处理后正文HTML（原始 UTF-8 字符串，图片视频已本地化） */
    customHtml: string;
}

/**
 * 解析日志/日记详情页（列表项 → 详情DOM → 正文与媒体处理）
 * 移植自 blogs.js getAllContents 单项处理（L71-115）
 * @param detailHtml 详情接口返回的HTML文本
 * @param useTemplate 是否处理模板日志（日记不处理）
 */
export async function processBlogDetail(
    env: CollectorEnv,
    registry: MediaTaskRegistry,
    item: MediaOwner,
    detailHtml: string,
    moduleDir: string,
    exportType: string,
    useTemplate: boolean,
): Promise<BlogDetailResult> {
    const doc = new DOMParser().parseFromString(detailHtml, 'text/html');

    // 基于DOM获取详细信息
    const detailItem = readDetailInfo(doc);

    // 获得网页中的日志正文
    const detail = doc.querySelector('#blogDetailDiv');
    if (!detail) {
        return { detailItem, html: '', customHtml: '' };
    }

    // 是否为模板日志（日志内容在变量中）
    if (useTemplate && isTemplateBlog(detailItem || item)) {
        const tplContent = readTemplateContent(doc);
        if (tplContent) {
            detail.innerHTML = tplContent;
        }
    }

    // 原始HTML（直接以 UTF-8 字符串存储，不再 base64，体积更小且可读）
    const html = detail.innerHTML;

    // 处理图片信息
    await handleContentImages(env, registry, item, detail, moduleDir, exportType);

    // 处理视频信息
    await handleContentMedias(env, registry, item, detail, moduleDir, exportType);

    // 处理后HTML（图片/视频已本地化，直接以 UTF-8 字符串存储）
    const customHtml = detail.innerHTML;

    return { detailItem, html, customHtml };
}
