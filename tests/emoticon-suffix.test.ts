/**
 * 回归测试：表情下载（#1）与媒体后缀一致性（#2）
 * - MediaTaskRegistry.addEmoticons：解析 [em]eXXX[/em] 并下载到 Common/images/eXXX.gif，跨模块去重，外链模式跳过
 * - resolveMediaSuffix：开启自动探测时以 MIME 真实类型为准，否则用 URL 扩展名，兜底 .jpeg
 */
import { describe, it, expect } from 'vitest';
import { resolveMediaSuffix, MediaTaskRegistry } from '../core/collector/modules/helpers';
import { makeDownloadUrl } from '../core/shared/url';

function makeEnv(opts: { auto?: boolean; detect?: string } = {}) {
    return {
        config: { Common: { isAutoFileSuffix: opts.auto ?? false, mediaMode: 'download', downloadType: 'disk' } },
        // 模拟 autoFileSuffix 的真实行为：探测成功返回探测值；探测失败（未提供 detect）返回空，
        // 由 resolveMediaSuffix 回退到 URL 扩展名 / .jpeg。
        detectSuffix: async (_u: string) => (opts.detect ? opts.detect : ''),
    } as any;
}

describe('resolveMediaSuffix（#2 类型一致）', () => {
    it('关闭自动探测且有 URL 扩展名时返回 URL 扩展名', async () => {
        const env = makeEnv({ auto: false });
        expect(await resolveMediaSuffix('https://x/y/abc.gif?a=1', env)).toBe('.gif');
    });

    it('两者皆空时兜底 .jpeg，避免无扩展名', async () => {
        const env = makeEnv({ auto: false });
        expect(await resolveMediaSuffix('https://x/y/abc', env)).toBe('.jpeg');
    });

    it('开启自动探测时以探测到的真实 MIME 类型为准（URL 末段 .gif 但实际为 png）', async () => {
        const env = makeEnv({ auto: true, detect: '.png' });
        expect(await resolveMediaSuffix('https://x/y/abc.gif', env)).toBe('.png');
    });

    it('开启自动探测但探测失败回退 URL 扩展名', async () => {
        // 使用独立 URL 避开模块级 _suffixCache，确保走到「探测失败 → URL 扩展名」分支
        const env = makeEnv({ auto: true }); // detect 未给 → 桩返回空，模拟探测失败
        expect(await resolveMediaSuffix('https://x/y/probe-fail.gif', env)).toBe('.gif');
    });

    it('同一 URL 只探测一次（缓存）', async () => {
        const env = makeEnv({ auto: false });
        const url = 'https://x/y/cache-test.png';
        const first = await resolveMediaSuffix(url, env);
        const second = await resolveMediaSuffix(url, env);
        expect(first).toBe(second);
        expect(second).toBe('.png');
    });
});

describe('MediaTaskRegistry.addEmoticons（#1 表情下载）', () => {
    function makeRegistry(opts: { link?: boolean } = {}) {
        const added: any[] = [];
        const env = {
            config: {
                Common: {
                    mediaMode: opts.link ? 'Link' : 'download',
                    downloadType: opts.link ? 'QZone' : 'disk',
                    isAutoFileSuffix: false,
                },
            },
            addMediaTask: (t: any) => { added.push(t); },
        } as any;
        const reg = new MediaTaskRegistry(env, 'Messages');
        return { reg, added };
    }

    it('解析 [em]eXXX[/em] 并下载到 Common/images/eXXX.gif', async () => {
        const { reg, added } = makeRegistry();
        await reg.addEmoticons(['说说内容带表情 [em]e100[/em] 还有 [em]e402[/em]', null, undefined], {});
        expect(added.length).toBe(2);
        expect(added.map((a) => a.name).sort()).toEqual(['e100.gif', 'e402.gif']);
        expect(added.every((a) => a.dir === 'Common/images')).toBe(true);
        // newTask 内部对下载 URL 追加 ?save=1&d=1，断言须与 makeDownloadUrl 的实际落盘地址一致
        expect(
            added.every((a) => a.url === makeDownloadUrl(`https://qzonestyle.gtimg.cn/qzone/em/${a.name}`, true)),
        ).toBe(true);
    });

    it('同一条目内/跨调用重复表情只登记一次（去重）', async () => {
        const { reg, added } = makeRegistry();
        await reg.addEmoticons(['[em]e999[/em]'], {});
        await reg.addEmoticons(['又来一次 [em]e999[/em]'], {});
        expect(added.length).toBe(1);
        expect(added[0].name).toBe('e999.gif');
    });

    it('外链（QZone/Link）模式不下载表情', async () => {
        const { reg, added } = makeRegistry({ link: true });
        await reg.addEmoticons(['[em]e555[/em]'], {});
        expect(added.length).toBe(0);
    });

    it('无表情文本时不登记任何任务', async () => {
        const { reg, added } = makeRegistry();
        await reg.addEmoticons(['纯文本没有表情', '还有一段'], {});
        expect(added.length).toBe(0);
    });
});
