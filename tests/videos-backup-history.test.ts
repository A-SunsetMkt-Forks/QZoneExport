import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { BackupEngine } from '../core/collector/modules/engine';
import { CheckpointStore } from '../core/collector/checkpoint';
import { PageLedger } from '../core/collector/reliability';
import { BackupDb, type KvArea } from '../core/store/backup-db';
import { formatDateValue } from '../core/shared/utils';
import type { QzoneBackupConfig } from '../core/collector/modules/types';
import type { QzoneContext } from '../core/qzone-api/context';

const UIN = 12345;

/** 内存版 KvArea（支持 get(null) 枚举全量），用于单测，不依赖 chrome.storage.local */
function memoryKvArea(): KvArea {
    const store: Record<string, unknown> = {};
    return {
        async get(keys) {
            if (keys === null) return { ...store };
            const result: Record<string, unknown> = {};
            const list = Array.isArray(keys) ? keys : [keys];
            for (const k of list) if (store[k] !== undefined) result[k] = store[k];
            return result;
        },
        async set(items) {
            Object.assign(store, items);
        },
        async remove(keys) {
            for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k];
        },
    };
}


const VIDEO_LIST_JSON = JSON.stringify({
    code: 0,
    data: {
        Videos: [
            { vid: 'v1', uploadtime: 1600000000, title: '视频一' },
            { vid: 'v2', uploadtime: 1600001000, title: '视频二' },
        ],
        total: 2,
    },
});

function buildEngine() {
    const cp = new CheckpointStore(memoryKvArea());
    const db = new BackupDb(memoryKvArea());
    const config = {
        Common: { downloadType: 'aria2', AvatarHost: 0 },
        Videos: {
            IncrementField: 'uploadtime',
            Comments: { isGet: false },
            Like: { isGet: false },
            exportType: 'HTML',
        },
    } as unknown as QzoneBackupConfig;
    const ctx = { targetUin: UIN } as unknown as QzoneContext;
    const body = `shine0_Callback(${VIDEO_LIST_JSON})`;
    const fetchFn = (async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'application/javascript; charset=utf-8' },
        arrayBuffer: async () => new TextEncoder().encode(body).buffer,
        text: async () => body,
        json: async () => JSON.parse(VIDEO_LIST_JSON),
    })) as unknown as typeof fetch;
    const host = {
        writeJsonToJs: async () => {
            /* engine 的 env.writeJsonToJs 会额外 saveStaging(currentModule) */
        },
        writeText: async () => {},
        addMediaTask: () => {},
        detectSuffix: async () => '.mp4',
    };
    const engine = new BackupEngine({
        ctx,
        config,
        modules: ['Videos'],
        host: host as any,
        retry: { maxRetries: 1 } as any,
        fetchFn,
        checkpointStore: cp,
        backupDb: db,
        ledger: new PageLedger(memoryKvArea()),
    });
    return { engine, db };
}

/**
 * spy createEnv 捕获「resolveConfig 后的 resolvedConfig」——即 collector 实际使用的 config。
 * engine.run() 的增量时间覆盖作用在 resolvedConfig 上（resolveConfig 返回新对象），
 * 而非原始 options.config，故断言必须针对捕获到的 resolvedConfig。
 */
function captureResolvedConfig(engine: BackupEngine): () => Record<string, any> {
    let captured: Record<string, any> | undefined;
    const orig = (engine as any).createEnv.bind(engine);
    (engine as any).createEnv = (cfg: Record<string, any>) => {
        captured = cfg;
        return orig(cfg);
    };
    return () => captured!;
}

describe('仅备份视频模块 → 增量备份表格写入', () => {
    it('engine.run(Videos) 后 Options 增量表格应含 Videos 行', async () => {
        const { engine, db } = buildEngine();
        const result = await engine.run();
        expect(result.state).toBe('completed');

        // 确认 staging 已写入（模拟 saveBackupHistory 读取）
        const staged = await (engine as any).checkpointStore.loadStaging(UIN, 'Videos');
        expect(staged).toBeDefined();

        // 模拟 Options 读取：getMeta 应含 Videos 行
        const meta = await db.getMeta();
        expect(meta[UIN]).toBeDefined();
        const videosRow = (meta[UIN] || []).find((m: any) => m.module === 'Videos');
        expect(videosRow).toBeDefined();
        expect(videosRow?.count).toBe(2);
    });
});

describe('增量基线：LastTime 模式必须把 IncrementTime 覆盖为上次备份时间', () => {
    it('engine.run() 会把增量时间从兜底改成上次备份时间（作用于 collector 实际使用的 resolvedConfig）', async () => {
        const { engine, db } = buildEngine();
        const LAST_BACKUP_MS = 1700000000000; // 2023-11-14
        // 预置「上次备份」行（模拟 Options 导入或上一轮备份写入）
        await db.putRow(UIN, {
            module: 'Videos',
            data: [{ vid: 'old1', uploadtime: 1500000000 }, { vid: 'old2', uploadtime: 1500001000 }],
            time: LAST_BACKUP_MS,
        });

        // 开启 LastTime 增量，但 IncrementTime 还是兜底时间（App.vue 批量开启时的初值）
        // IncrementInherit=false 让 Videos 使用自身增量字段，避免 resolveConfig 继承 Common 默认覆盖
        const cfg = (engine as any).options.config as Record<string, any>;
        cfg.Videos.IncrementInherit = false;
        cfg.Videos.IncrementType = 'LastTime';
        cfg.Videos.IncrementTime = '2005-06-06 00:00:00';

        const getResolved = captureResolvedConfig(engine);
        await engine.run();

        // 关键断言：引擎已用 row.time 覆盖 resolvedConfig 的 IncrementTime
        const expected = formatDateValue(new Date(LAST_BACKUP_MS), 'yyyy-MM-dd hh:mm:ss');
        expect(getResolved().Videos.IncrementTime).toBe(expected);
    });

    it('没有历史备份行时保持兜底时间（首备即全量，不应误改）', async () => {
        const { engine } = buildEngine();
        const cfg = (engine as any).options.config as Record<string, any>;
        cfg.Videos.IncrementInherit = false;
        cfg.Videos.IncrementType = 'LastTime';
        cfg.Videos.IncrementTime = '2005-06-06 00:00:00';

        const getResolved = captureResolvedConfig(engine);
        await engine.run();

        expect(getResolved().Videos.IncrementTime).toBe('2005-06-06 00:00:00');
    });

    it('Custom 模式不被覆盖（保留用户自填时间）', async () => {
        const { engine, db } = buildEngine();
        await db.putRow(UIN, {
            module: 'Videos',
            data: [{ vid: 'old1', uploadtime: 1500000000 }],
            time: 1700000000000,
        });
        const cfg = (engine as any).options.config as Record<string, any>;
        cfg.Videos.IncrementInherit = false;
        cfg.Videos.IncrementType = 'Custom';
        cfg.Videos.IncrementTime = '2022-01-01 00:00:00';

        const getResolved = captureResolvedConfig(engine);
        await engine.run();

        expect(getResolved().Videos.IncrementTime).toBe('2022-01-01 00:00:00');
    });
});

describe('断点续传数据：全新备份时 clearStaging 整段清空（含已下载集合 _downloaded）', () => {
    it('start()/discard() 触发的 clearStaging 会清掉 ${uin}:_downloaded 与模块暂存', async () => {
        const cp = new CheckpointStore(memoryKvArea());
        // 断点续传用的已下载集合 + 模块暂存都预置
        await cp.markDownloadedBatch(UIN, [
            { url: 'https://a.ex/v1.mp4', dir: 'Videos' },
            { url: 'https://a.ex/v2.mp4', dir: 'Videos' },
        ]);
        await cp.saveStaging(UIN, 'Videos', [{ vid: 'x' }]);

        // 全新备份（非续传）路径会调用 clearStaging
        await cp.clearStaging(UIN);

        // 断点续传数据应被整段清空（_downloaded 本就属于续传暂存语义）
        expect((await cp.getDownloadedUrls(UIN)).size).toBe(0);
        expect(await cp.loadStaging(UIN, 'Videos')).toBeUndefined();
    });
});
