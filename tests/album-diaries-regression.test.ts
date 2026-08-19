// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { albumList, diaryList } from '../core/qzone-api/clients';
import { isGetNextPage } from '../core/collector/modules/helpers';
import { isModulePrivate, PRIVATE_MODULES, getPrivateModuleLabels, MODULES } from '../core/shared/backup-options';
import { DiariesCollector } from '../core/collector/modules/diaries';
import { Requester } from '../core/qzone-api/request';
import { Logger } from '../core/shared/logger';
import type { CollectContext } from '../core/collector/pipeline';
import type { CollectorEnv } from '../core/collector/modules/types';

/**
 * 回归测试：
 * 1) 一键备份确认界面「相册列表无法获取清单」
 *    根因：albumList 深取 cfg.Photos.pageSize，配置未就绪时抛 TypeError，
 *    清单被上层静默兜底成空数组。
 * 2) 私密日记备份检查
 *    根因：diaries.ts 列表翻页把 oldItems 传成 undefined，导致「上次备份」
 *    增量模式下停止条件永远不成立，退化为全量翻页。
 */

const ctx = { ownerUin: 1001, targetUin: 2002, gtk: 123, token: 'tk', route: 102 };

describe('相册清单：配置缺失时的兜底（回归）', () => {
    it('配置为空对象时不抛异常，并使用默认 pageSize=3000', () => {
        // 修复前：cfg.Photos 为 undefined，深取 pageSize 抛 TypeError
        expect(() => albumList(ctx as any, {} as any, 0)).not.toThrow();
        const call = albumList(ctx as any, {} as any, 0);
        expect(call.params.pageNum).toBe(3000);
        expect(call.params.pageStart).toBe(0);
    });

    it('Photos 分组存在但 pageSize 缺失/非法时同样回退默认值', () => {
        for (const bad of [undefined, null, 0, -1, NaN, 'abc']) {
            const call = albumList(ctx as any, { Photos: { pageSize: bad } } as any, 0);
            expect(call.params.pageNum).toBe(3000);
        }
    });

    it('配置正常时严格使用配置值，并正确换算分页偏移', () => {
        const cfg = { Photos: { pageSize: 20 } } as any;
        expect(albumList(ctx as any, cfg, 0).params.pageStart).toBe(0);
        expect(albumList(ctx as any, cfg, 2).params.pageStart).toBe(40);
        expect(albumList(ctx as any, cfg, 2).params.pageNum).toBe(20);
    });

    it('请求参数携带正确的目标 uin 与鉴权信息', () => {
        const call = albumList(ctx as any, { Photos: { pageSize: 10 } } as any, 0);
        expect(call.params.hostUin).toBe(2002);
        expect(call.params.uin).toBe(1001);
        expect(call.params.g_tk).toBe(123);
    });
});

describe('私密日记：增量翻页判断（回归）', () => {
    const lastCfg = {
        IncrementType: 'LastTime',
        IncrementTime: '2020-01-01 00:00:00',
        IncrementField: 'pubtime',
    };

    it('「上次备份」模式下，本页已越过增量位置时必须停止翻页', () => {
        // 2000-01-01，早于增量时间 → 已备份过，应停止
        const oldItems = [{ pubtime: 1 }];
        const pageItems = [{ pubtime: 946684800 }];
        expect(isGetNextPage(oldItems, pageItems, lastCfg)).toBe(false);
        // 修复前 diaries 传的是 undefined，会错误地继续翻页
        expect(isGetNextPage(undefined, pageItems, lastCfg)).toBe(true);
    });

    it('无历史数据时继续翻页（首次备份等价全量）', () => {
        expect(isGetNextPage([], [{ pubtime: 1893456000 }], lastCfg)).toBe(true);
    });

    it('全量模式忽略历史数据，始终继续翻页', () => {
        const fullCfg = { ...lastCfg, IncrementType: 'Full' };
        expect(isGetNextPage([{ pubtime: 1 }], [{ pubtime: 946684800 }], fullCfg)).toBe(true);
    });
});

describe('私密日记：采集器翻页行为（端到端回归）', () => {
    /** 构造只跑 list 阶段的日记采集环境 */
    function makeDiaryEnv(pages: Array<{ pubtime: number; title: string }[]>, total: number, oldItems: unknown[]) {
        const seconds = { min: 0, max: 0 };
        const diariesCfg: any = {
            exportType: 'JSON',
            pageSize: 2,
            randomSeconds: seconds,
            Info: { randomSeconds: seconds },
            Comments: { isGet: false, pageSize: 2, randomSeconds: seconds },
            Like: { isGet: false, randomSeconds: seconds },
            Visitor: { isGet: false, pageSize: 2, randomSeconds: seconds },
            IncrementType: 'LastTime',
            IncrementTime: '2020-01-01 00:00:00',
            IncrementField: 'pubtime',
        };
        const listUrls: string[] = [];
        let listHit = 0;

        const fetchFn = (async (url: string) => {
            let body = '{"code":0,"data":{}}';
            if (url.includes('privateblog_get_titlelist')) {
                listUrls.push(url);
                const page = pages[listHit] || [];
                listHit++;
                body = `_Callback(${JSON.stringify({ code: 0, data: { total_num: total, titlelist: page } })})`;
            }
            return new Response(body, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
        }) as unknown as typeof fetch;

        const env: CollectorEnv = {
            ctx: { ownerUin: 1001, targetUin: 1001, gtk: 123, token: 'tk', route: 102 },
            config: { Common: {}, Diaries: diariesCfg } as any,
            requester: new Requester({
                config: () => ({ listRetryCount: 0, listRetrySleep: 0, waitCount: 0, waitTime: 0, RestSleepUrls: [] }),
                fetchFn,
                sleepFn: async () => {},
            }),
            logger: new Logger({ mirror: false }),
            tick: async () => {},
            report: async () => {},
            fail: () => {},
            getOldData: async () => oldItems as any,
            addMediaTask: () => {},
            detectSuffix: async () => '.jpg',
            writeJsonToJs: async () => {},
            writeText: async () => {},
            writeFile: async () => {},
            loadStaging: async () => undefined,
            saveStaging: async () => {},
            sleep: async () => {},
        };
        return { env, listUrls: () => listUrls };
    }

    /** 只驱动 list 阶段：详情/评论等阶段的请求都会落到默认空响应 */
    const fakeCtx = { uin: 1001, report: async () => {}, tick: async () => {} } as unknown as CollectContext;

    it('存在历史数据且本页已越过增量位置时，必须停止翻页', async () => {
        // 第 1 页时间早于 IncrementTime(2020-01-01) → 已备份过，应在第 1 页后停止
        const pages = [
            [
                { pubtime: 946684800, title: 'a' },
                { pubtime: 946684801, title: 'b' },
            ],
            [
                { pubtime: 946684802, title: 'c' },
                { pubtime: 946684803, title: 'd' },
            ],
        ];
        const { env, listUrls } = makeDiaryEnv(pages, 100, [{ pubtime: 1, title: 'old' }]);
        const collector = new DiariesCollector(env);
        await collector.collect(fakeCtx);
        // 修复前：oldItems 传成 undefined，isGetNextPage 恒为 true，会继续翻第 2 页
        expect(listUrls().length).toBe(1);
    });

    it('无历史数据时按总数正常翻页，不被增量条件提前截断', async () => {
        const pages = [
            [
                { pubtime: 946684800, title: 'a' },
                { pubtime: 946684801, title: 'b' },
            ],
            [
                { pubtime: 946684802, title: 'c' },
                { pubtime: 946684803, title: 'd' },
            ],
        ];
        const { env, listUrls } = makeDiaryEnv(pages, 4, []);
        const collector = new DiariesCollector(env);
        await collector.collect(fakeCtx);
        expect(listUrls().length).toBe(2);
    });
});

describe('私密日记：接口参数（本人空间语义）', () => {
    it('日记列表始终以登录者自身 uin 请求（日记仅本人可见）', () => {
        const cfg = { Diaries: { pageSize: 20 } } as any;
        const call = diaryList({ ownerUin: 1001, targetUin: 2002, gtk: 123, token: 'tk', route: 102 } as any, cfg, 2);
        expect(call.params.uin).toBe(1001);
        expect(call.params.vuin).toBe(1001);
        expect(call.params.pos).toBe(40);
        expect(call.params.numperpage).toBe(20);
    });
});

describe('私密日记：权限校验与备份条件', () => {
    it('日记属于私有模块，他人空间应被判定为不可备份', () => {
        expect(isModulePrivate('Diaries')).toBe(true);
        expect(PRIVATE_MODULES).toContain('Diaries');
    });

    it('公开模块不受私有限制', () => {
        expect(isModulePrivate('Messages')).toBe(false);
        expect(isModulePrivate('Photos')).toBe(false);
    });

    it('置灰说明中包含「日记」中文名', () => {
        expect(getPrivateModuleLabels()).toContain('日记');
    });

    it('确认界面的模块禁用判定：仅在非空间主人时禁用私有模块', () => {
        // 与 qzone-hint.content.ts 中 `!ctx.isOwner && isModulePrivate(m.value)` 一致
        const disabledFor = (isOwner: boolean) =>
            MODULES.filter((m) => !isOwner && isModulePrivate(m.value)).map((m) => m.value);
        expect(disabledFor(true)).toEqual([]);
        expect(disabledFor(false)).toContain('Diaries');
    });
});
