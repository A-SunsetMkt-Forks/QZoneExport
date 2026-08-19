// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Requester } from '../core/qzone-api/request';
import { Logger } from '../core/shared/logger';
import type { CollectorEnv, QzoneBackupConfig } from '../core/collector/modules/types';
import type { CollectContext } from '../core/collector/pipeline';
import { VideosCollector } from '../core/collector/modules/videos';

const OLD = 1500000000; // 旧视频上传时间（秒，早于增量时间）
const NEW = 1700000000; // 新视频上传时间（秒，晚于增量时间）

/** 模拟「上次之后」增量配置（采集器直接读 env.config） */
function makeVideosConfig(): QzoneBackupConfig {
    const seconds = { min: 0, max: 0 };
    return {
        Common: { mediaMode: 'Download', downloadType: 'Browser', isAutoFileSuffix: false, AvatarHost: -1 },
        Videos: {
            exportType: 'HTML',
            pageSize: 30,
            randomSeconds: seconds,
            Comments: { isGet: false, pageSize: 10, randomSeconds: seconds },
            Like: { isGet: false, randomSeconds: seconds },
            fileStructureType: 'File',
            RenameType: 'Default',
            IncrementInherit: false,
            IncrementType: 'LastTime',
            IncrementTime: '2023-01-01 00:00:00',
            IncrementField: 'uploadTime',
        },
    } as unknown as QzoneBackupConfig;
}

function makeEnv(oldData: Record<string, unknown>, fetchBody: string, onTask: (task: unknown) => void): { env: CollectorEnv } {
    const config = makeVideosConfig();
    const fetchFn = (async () => {
        return new Response(fetchBody, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }) as unknown as typeof fetch;

    const env: CollectorEnv = {
        ctx: { ownerUin: 1001, targetUin: 1001, gtk: 123, token: 'tk', route: 102 },
        config,
        requester: new Requester({
            config: () => ({ listRetryCount: 0, listRetrySleep: 0, waitCount: 0, waitTime: 0, RestSleepUrls: [] }),
            fetchFn,
            sleepFn: async () => {},
        }),
        logger: new Logger({ mirror: false }),
        tick: async () => {},
        report: async () => {},
        fail: () => {},
        getOldData: async (module) => oldData[module] as any,
        addMediaTask: (task) => {
            onTask(task);
        },
        detectSuffix: async () => '.mp4',
        writeJsonToJs: async () => {},
        writeText: async () => {},
        writeFile: async () => {},
        loadStaging: async () => undefined,
        saveStaging: async () => {},
        sleep: async () => {},
    };
    return { env };
}

const fakeCtx = { uin: 1001, report: async () => {}, tick: async () => {} } as unknown as CollectContext;

describe('视频增量备份：旧视频不重复登记下载任务', () => {
    it('上次备份后：仅新视频登记下载，第一页里的旧视频不登记', async () => {
        const oldData = {
            Videos: [
                { vid: 'old1', uploadtime: OLD },
                { vid: 'old2', uploadtime: OLD + 1000 },
            ],
        };
        // 视频列表按上传时间倒序（新→旧），第一页同时包含新视频与旧视频
        const listBody = JSON.stringify({
            code: 0,
            data: {
                Videos: [
                    { vid: 'new1', uploadtime: NEW, url3: 'https://x.example/new1.mp4' },
                    { vid: 'old1', uploadtime: OLD, url3: 'https://x.example/old1.mp4' },
                    { vid: 'old2', uploadtime: OLD + 1000, url3: 'https://x.example/old2.mp4' },
                ],
                total: 3,
            },
        });
        const tasks: any[] = [];
        const { env } = makeEnv(oldData, listBody, (task) => tasks.push(task));

        await new VideosCollector(env).collect(fakeCtx);

        const urls = tasks.map((t) => t.url);
        // 新视频登记下载（视频本体，可能追加下载参数，但保留 new1 标识）
        expect(urls.some((u) => u.includes('new1'))).toBe(true);
        // 旧视频绝不登记下载（回归：此前 skipOldItems 依赖 isNewItem 未打标而失效，整页旧视频被重下）
        expect(urls.some((u) => u.includes('old1'))).toBe(false);
        expect(urls.some((u) => u.includes('old2'))).toBe(false);
        // 只登记了一个视频本体任务（无预览图，因为视频无 pre/url1/preview_img）
        expect(tasks.length).toBe(1);
    });

    it('全量备份时所有视频都登记下载（不受旧数据过滤影响）', async () => {
        const oldData = {
            Videos: [{ vid: 'old1', uploadtime: OLD }],
        };
        const listBody = JSON.stringify({
            code: 0,
            data: {
                Videos: [
                    { vid: 'new1', uploadtime: NEW, url3: 'https://x.example/new1.mp4' },
                    { vid: 'old1', uploadtime: OLD, url3: 'https://x.example/old1.mp4' },
                ],
                total: 2,
            },
        });
        const tasks: any[] = [];
        const { env } = makeEnv(oldData, listBody, (task) => tasks.push(task));
        // 切换为全量备份
        (env.config as any).Videos.IncrementType = 'Full';

        await new VideosCollector(env).collect(fakeCtx);

        const urls = tasks.map((t) => t.url);
        // 全量备份：新老视频都登记下载
        expect(urls.some((u) => u.includes('new1'))).toBe(true);
        expect(urls.some((u) => u.includes('old1'))).toBe(true);
        expect(tasks.length).toBe(2);
    });
});
