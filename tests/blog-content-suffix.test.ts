// @vitest-environment happy-dom
/**
 * 回归测试：日志/日记正文图片后缀识别（修复 V3 升级遗漏）
 *
 * 背景：V3 重构时，blog-html.ts 的 handleContentImages（日志与日记正文图片共用）
 * 与 blogs.ts 的 handleListImages 重新手写了后缀识别逻辑，但顺序写反
 * （URL 扩展名优先、仅当 URL 无扩展名才探测 MIME），且缺少 .jpeg 兜底；
 * 导致「图片类型识别」开关打开后：
 *   1) URL 已带扩展名（如 .gif 实为 jpeg/png）时，开关被完全忽略；
 *   2) 探测失败且 URL 无扩展名时，落盘文件无扩展名。
 * 修复后两处均改走 resolveMediaSuffix（探测优先 → URL 扩展名 → .jpeg 兜底）。
 *
 * 本测试直接驱动 handleContentImages，覆盖 Blogs / Diaries 正文图片路径。
 */
import { describe, it, expect } from 'vitest';
import { handleContentImages } from '../core/collector/modules/blog-html';
import { MediaTaskRegistry } from '../core/collector/modules/helpers';

function makeEnv(opts: { auto?: boolean; detect?: string } = {}) {
    const added: any[] = [];
    const env: any = {
        config: {
            Common: {
                isAutoFileSuffix: opts.auto ?? false,
                mediaMode: 'download',
                downloadType: 'disk',
            },
        },
        // 模拟 autoFileSuffix 真实行为：探测成功返回探测值；探测失败（未给 detect）返回空，
        // 由 resolveMediaSuffix 回退到 URL 扩展名 / .jpeg。
        detectSuffix: async (_u: string) => (opts.detect ? opts.detect : ''),
        addMediaTask: (t: any) => added.push(t),
    };
    return { env, added };
}

function parseDetail(html: string): Element {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.querySelector('#d') as Element;
}

describe('日志/日记正文图片后缀识别（修复 V3 遗漏）', () => {
    it('开关打开时以 MIME 真实类型为准，即使 URL 末段是 .gif', async () => {
        const { env, added } = makeEnv({ auto: true, detect: '.png' });
        const reg = new MediaTaskRegistry(env, 'Blogs');
        const detail = parseDetail('<div id="d"><img src="http://qpic.cn/photo/abc.gif"></div>');
        await handleContentImages(env, reg, {}, detail, 'Blogs/images', 'HTML');
        expect(added.length).toBe(1);
        // 修复关键：开关打开时不再盲信 URL 的 .gif，应以探测到的真实类型（png）命名
        expect(added[0].name.endsWith('.png')).toBe(true);
        expect(added[0].dir).toBe('Blogs/images');
        // 离线地址已改写，正文不再出现远程图片地址
        expect(detail.innerHTML).not.toContain('http://qpic.cn/photo/abc.gif');
        expect(detail.innerHTML).toContain('images/');
    });

    it('探测失败且无 URL 扩展名时兜底 .jpeg，绝不出现无扩展名文件', async () => {
        const { env, added } = makeEnv({ auto: true }); // detect 空 → 模拟探测失败
        const reg = new MediaTaskRegistry(env, 'Diaries');
        const detail = parseDetail('<div id="d"><img src="http://qpic.cn/photo/noext"></div>');
        await handleContentImages(env, reg, {}, detail, 'Diaries/images', 'HTML');
        expect(added.length).toBe(1);
        // 修复关键：URL 与探测都给不出后缀时，必须兜底 .jpeg，不能落盘无扩展名文件
        expect(added[0].name).toMatch(/\.jpeg$/);
        expect(added[0].dir).toBe('Diaries/images');
    });

    it('开关关闭时回退 URL 扩展名', async () => {
        const { env, added } = makeEnv({ auto: false });
        const reg = new MediaTaskRegistry(env, 'Diaries');
        const detail = parseDetail('<div id="d"><img src="http://qpic.cn/photo/abc.jpg"></div>');
        await handleContentImages(env, reg, {}, detail, 'Diaries/images', 'HTML');
        expect(added.length).toBe(1);
        expect(added[0].name.endsWith('.jpg')).toBe(true);
        expect(added[0].dir).toBe('Diaries/images');
    });
});
