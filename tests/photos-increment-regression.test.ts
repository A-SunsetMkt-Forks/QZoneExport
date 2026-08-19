// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { AvatarTaskRegistry } from '../core/collector/modules/helpers';
import { PhotosCollector } from '../core/collector/modules/photos';
import { Requester } from '../core/qzone-api/request';
import { Logger } from '../core/shared/logger';
import type { CollectContext } from '../core/collector/pipeline';
import type { CollectorEnv } from '../core/collector/modules/types';

/**
 * 回归测试：相册增量备份下，已备份相册的评论/赞/访客不应被重复采集
 * 根因：相册是二级结构（相册→相片），album 级从不走 unionBackedUpItems，
 * 导致 album.isNewItem 永远为 undefined → isNewItem() 恒返 true →
 * isNewAlbum 对历史相册误判为「新」，collectAlbumComments/collectAlbumLikes/
 * collectAlbumVisitors 里的 `if (!isNewAlbum) continue` 跳过分支永不被触发，
 * 于是每轮增量都重复拉取已备份相册的评论/赞/访客（冗余 API、与增量语义相悖）。
 * 修复：initAlbums 把合并进工作集的未改名历史相册标记 isNewItem=false。
 *
 * 注：相片本身不会因该 bug 丢失——collectAlbumPhotoList 会把旧相册 photoList
 * 作为 initialPhotos 传入，unionItems 已保留旧相片，相片级 unionBackedUpItems
 * 合并在此处实际是冗余的；故本测试以「评论/赞/访客是否重复采集」作为回归点。
 */

const NEW_TIME = 2000000000; // 晚于增量时间 → 新增
const INCREMENT_TIME = '2020-01-01 00:00:00';

function makePhotosConfig(incrementType: 'Full' | 'LastTime', getComments: boolean): any {
    const seconds = { min: 0, max: 0 };
    return {
        Common: {},
        Photos: {
            exportType: 'HTML',
            pageSize: 10,
            randomSeconds: seconds,
            Comments: { isGet: getComments, pageSize: 100, randomSeconds: seconds },
            Images: {
                pageSize: 10,
                listType: 'List',
                randomSeconds: seconds,
                Comments: { isGet: false, pageSize: 100, randomSeconds: seconds },
                exifType: 'raw',
                Info: { isGet: false, pageSize: 200, randomSeconds: seconds },
                isGetVideo: false,
                isGetPreview: false,
                fileStructureType: 'File',
                RenameType: 'Default',
            },
            IncrementType: incrementType,
            IncrementTime: INCREMENT_TIME,
            IncrementField: 'uploadTime',
            Like: { isGet: false, randomSeconds: seconds },
            Visitor: { isGet: false, pageSize: 24, randomSeconds: seconds },
        },
    };
}

/** 构造相册采集环境，统计 albumComments 接口调用次数 */
function makePhotosEnv(oldAlbums: unknown[], cfg: any) {
    const captured: Record<string, unknown> = {};
    let albumCommentCalls = 0;
    const seconds = { min: 0, max: 0 };

    const fetchFn = (async (url: string) => {
        let body = '{"code":0,"data":{}}';
        if (url.includes('fcg_list_album_v3')) {
            body = `shine0_Callback(${JSON.stringify({
                code: 0,
                data: { albumsInUser: 1, albumList: [{ id: 1, name: 'A', allowAccess: 1, total: 1, lastuploadtime: NEW_TIME, comment: 5 }] },
            })})`;
        } else if (url.includes('cgi_list_photo')) {
            body = `shine0_Callback(${JSON.stringify({
                code: 0,
                data: {
                    totalInAlbum: 1,
                    photoList: [{ lloc: 'p-new', uploadtime: NEW_TIME, url: 'http://new' }],
                    topic: { pre: 'http://pre', url: 'http://a' },
                },
            })})`;
        } else if (url.includes('cgi_pcomment_xml_v2')) {
            albumCommentCalls++;
            body = `_Callback(${JSON.stringify({ code: 0, data: { comments: [], total: 0, commentList: [] } })})`;
        }
        return new Response(body, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }) as unknown as typeof fetch;

    const env: CollectorEnv = {
        ctx: { ownerUin: 1001, targetUin: 1001, gtk: 123, token: 'tk', route: 102 },
        config: cfg,
        requester: new Requester({
            config: () => ({ listRetryCount: 0, listRetrySleep: 0, waitCount: 0, waitTime: 0, RestSleepUrls: [] }),
            fetchFn,
            sleepFn: async () => {},
        }),
        logger: new Logger({ mirror: false }),
        tick: async () => {},
        report: async () => {},
        fail: () => {},
        getOldData: async () => oldAlbums as any,
        addMediaTask: () => {},
        detectSuffix: async () => '.jpg',
        writeJsonToJs: async (global: string, data: unknown) => {
            captured[global] = data;
        },
        writeText: async () => {},
        writeFile: async () => {},
        loadStaging: async () => undefined,
        saveStaging: async () => {},
        sleep: async () => {},
    };
    return { env, captured, albumCommentCalls: () => albumCommentCalls };
}

const fakeCtx = { uin: 1001, report: async () => {}, tick: async () => {} } as unknown as CollectContext;

/** 历史备份：1 个同名相册（isNewItem 故意不设置，模拟真实落盘数据） */
function oldBackupAlbums() {
    return [{ id: 1, name: 'A', allowAccess: 1, photoList: [{ lloc: 'p-old', uploadtime: 1000, url: 'http://old' }] }];
}

describe('相册：增量下已备份相册不重复采集评论（回归）', () => {
    it('「上次备份」模式下，历史相册的评论接口调用次数为 0（跳过分支生效）', async () => {
        const { env, albumCommentCalls } = makePhotosEnv(oldBackupAlbums(), makePhotosConfig('LastTime', true));
        const collector = new PhotosCollector(env, [], new AvatarTaskRegistry(env));
        await collector.collect(fakeCtx);
        // 修复前：isNewAlbum 误判为「新」→ 跳过分支不触发 → 重复拉取评论（>0）
        expect(albumCommentCalls()).toBe(0);
    });

    it('「全量」模式下仍采集评论（证明是增量跳过而非误关评论开关）', async () => {
        const { env, albumCommentCalls } = makePhotosEnv(oldBackupAlbums(), makePhotosConfig('Full', true));
        const collector = new PhotosCollector(env, [], new AvatarTaskRegistry(env));
        await collector.collect(fakeCtx);
        expect(albumCommentCalls()).toBeGreaterThan(0);
    });

    it('增量下相片仍保留（旧相片经 initialPhotos 传入，不丢失）', async () => {
        const { env, captured } = makePhotosEnv(oldBackupAlbums(), makePhotosConfig('LastTime', false));
        const collector = new PhotosCollector(env, [], new AvatarTaskRegistry(env));
        await collector.collect(fakeCtx);
        const albums = captured['albums'] as Array<{ photoList?: Array<{ lloc: string }> }>;
        const llocs = (albums[0]!.photoList || []).map((p) => p.lloc).sort();
        expect(llocs).toEqual(['p-new', 'p-old']);
    });
});
