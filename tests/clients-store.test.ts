import { types } from 'node:util';
import { describe, expect, it } from 'vitest';
import * as clients from '../core/qzone-api/clients';
import type { QzoneContext } from '../core/qzone-api/context';
import { REST_URLS } from '../core/qzone-api/urls';
import { memoryArea, TypedStore } from '../core/store/storage';
import { BackupDb, countBackupData, type KvArea } from '../core/store/backup-db';

/** 内存版 KvArea（支持 get(null) 枚举全量），用于单测，不依赖 chrome.storage.local */
function memoryKvArea(initial?: Record<string, unknown>): KvArea {
    const store: Record<string, unknown> = { ...(initial || {}) };
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

/**
 * 忠实模拟 chrome.storage 的写入序列化行为。
 *
 * 关键差异：Chromium 在渲染进程把 JS 值转成 `base::Value` 时，判定数组用的是 C++ 层的
 * `v8::Value::IsArray()`——它只认 `JSArray`，**不穿透 Proxy**；而 JS 规范的 `Array.isArray()`
 * 是穿透 Proxy 的。于是 Vue 的 reactive 数组（本质是 Proxy）会掉进「普通对象」分支，
 * 被序列化成 `{"0":…,"1":…}`。普通的内存版 KvArea 无法暴露这个缺陷，故单独提供本实现。
 */
function chromeSerialize(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    // 这一行就是缺陷的本质：Proxy 包裹的数组不被当作数组
    if (Array.isArray(value) && !types.isProxy(value)) {
        return (value as unknown[]).map(chromeSerialize);
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object)) {
        out[key] = chromeSerialize((value as Record<string, unknown>)[key]);
    }
    return out;
}

/** 带 chrome 序列化语义的 KvArea */
function chromeLikeKvArea(initial?: Record<string, unknown>): KvArea {
    const store: Record<string, unknown> = { ...(initial || {}) };
    return {
        async get(keys) {
            if (keys === null) return { ...store };
            const result: Record<string, unknown> = {};
            for (const k of (Array.isArray(keys) ? keys : [keys])) {
                if (store[k] !== undefined) result[k] = store[k];
            }
            return result;
        },
        async set(items) {
            for (const [k, v] of Object.entries(items)) store[k] = chromeSerialize(v);
        },
        async remove(keys) {
            for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k];
        },
    };
}

const ctx: QzoneContext = { ownerUin: 111, targetUin: 222, gtk: 12345, token: 'tk', route: 102 };

const cfg: clients.QzoneApiConfig = {
    Blogs: { pageSize: 25, Comments: { pageSize: 20 }, Visitor: { pageSize: 10 } },
    Diaries: { pageSize: 25, Comments: { pageSize: 20 }, Visitor: { pageSize: 10 } },
    Messages: { pageSize: 20, Comments: { pageSize: 20 }, Visitor: { pageSize: 10 } },
    Boards: { pageSize: 20 },
    Photos: { pageSize: 30, Comments: { pageSize: 20 }, Images: { pageSize: 90, Comments: { pageSize: 20 }, Info: { pageSize: 0 } } },
    Videos: { pageSize: 20, Comments: { pageSize: 20 } },
    Favorites: { pageSize: 20 },
    Shares: { pageSize: 20, Comments: { pageSize: 20 }, Visitor: { pageSize: 10 } },
    Dev: { Maps: { TxKey: 'TXKEY' } },
};

describe('接口参数构建器（与旧版api.js等价性抽查）', () => {
    it('说说列表', () => {
        const call = clients.messageList(ctx, cfg, 3);
        expect(call.url).toBe(REST_URLS.MESSAGES_LIST_URL);
        expect(call.params).toMatchObject({
            uin: 222,
            ftype: 0,
            sort: 0,
            pos: 60,
            num: 20,
            replynum: 100,
            g_tk: 12345,
            callback: '_preloadCallback',
            format: 'jsonp',
            need_private_comment: 1,
            qzonetoken: 'tk',
        });
    });

    it('日志列表', () => {
        const call = clients.blogList(ctx, cfg, 2);
        expect(call.url).toBe(REST_URLS.BLOGS_LIST_URL);
        expect(call.params).toMatchObject({
            hostUin: 222,
            uin: 111,
            pos: 50,
            num: 25,
            reqInfo: '7',
            verbose: '1',
        });
    });

    it('日志评论 topicId 拼接目标QQ', () => {
        const call = clients.blogComments(ctx, cfg, 998, 1);
        expect(call.params.topicId).toBe('222_998');
        expect(call.params.start).toBe(20);
    });

    it('留言列表', () => {
        const call = clients.boardList(ctx, cfg, 1);
        expect(call.params).toMatchObject({ uin: 111, hostUin: 222, start: 20, num: 20 });
    });

    it('相册列表使用路由号', () => {
        const call = clients.albumList(ctx, cfg, 0);
        expect(call.params).toMatchObject({ idcNum: 102, pageStart: 0, pageNum: 30, appid: 4, sortOrder: '2' });
    });

    it('相片评论 topicId = albumId_picKey', () => {
        const call = clients.imageComments(ctx, cfg, 'A1', 'PK', 2);
        expect(call.params.topicId).toBe('A1_PK');
        expect(call.params.albumId).toBe('A1');
        expect(call.params.start).toBe(40);
    });

    it('说说最近访问 appid=311，起始编号从1开始', () => {
        const call = clients.messageVisitors(ctx, cfg, 'T1', 0);
        expect(call.url).toBe(REST_URLS.VISITOR_SINGLE_LIST_URL);
        expect(call.params).toMatchObject({ appid: 311, param: 'T1', beginNum: 1, num: 10 });
    });

    it('相册最近访问 param 前缀 2;', () => {
        const call = clients.albumVisitors(ctx, cfg, 'AL', 1);
        expect(call.params.param).toBe('2;AL');
        expect(call.params.beginNum).toBe(11);
    });

    it('访客列表：主人模式与他人模式', () => {
        const owner = clients.visitorList({ ...ctx, targetUin: 111 }, 1);
        expect(owner.url).toBe(REST_URLS.VISITOR_MORE_LIST_URL);
        expect(owner.params.mask).toBe(7);
        expect(owner.params.clear).toBe(1);

        const guest = clients.visitorList(ctx, 1);
        expect(guest.url).toBe(REST_URLS.VISITOR_SIMPLE_LIST_URL);
        expect(guest.params.mask).toBe(2);
        expect(guest.params.clear).toBeUndefined();
    });

    it('分享列表无鉴权参数（原样）', () => {
        const call = clients.shareList(ctx, cfg, 2);
        expect(call.params).toEqual({ uin: 222, page: 2, num: 20, spaceuin: 222, isfriend: 0, ttype: 0 });
    });

    it('点赞列表首页标识', () => {
        expect(clients.likeList(ctx, 'uk', 0).params.if_first_page).toBe(1);
        expect(clients.likeList(ctx, 'uk', 999).params.if_first_page).toBe(0);
    });

    it('坐标接口使用开发者Key', () => {
        expect(clients.lbsInfo(cfg, 1.5, 2.5).params).toEqual({ location: '1.5,2.5', key: 'TXKEY' });
    });
});

describe('TypedStore', () => {
    it('读写与默认值', async () => {
        const area = memoryArea();
        const store = new TypedStore(area, 'PreExportTypes', [] as string[]);
        expect(await store.get()).toEqual([]);
        await store.set(['Messages']);
        expect(await store.get()).toEqual(['Messages']);
        await store.remove();
        expect(await store.get()).toEqual([]);
    });
});

describe('BackupDb（storage.local 分键 + 旧存储迁移）', () => {
    const legacyRows = [{ module: 'Messages', data: [{ tid: '1' }], time: 1600000000000 }];

    it('读路径只认新键规则：未迁移的遗留数据读不到（不再做读兜底）', async () => {
        // v3.3：遗留单键统一由 migrateFromLegacy 在安装/更新时一次性迁移，
        // 读路径不再兜底。此前的读兜底会让「是否读到旧数据」取决于 SW 迁移时序，
        // 并迫使迁移逻辑额外绕开它，属于自造复杂度。
        const legacy = memoryKvArea({ Backedup: { '333': legacyRows } });
        const db = new BackupDb(legacy);
        expect(await db.getRows(333)).toEqual([]);
        expect(await db.getMeta()).toEqual({});
        // 迁移之后才可见
        await db.migrateFromLegacy();
        expect(await db.getRows(333)).toEqual(legacyRows);
    });

    it('迁移旧数据后从分键读取，旧存储被清除', async () => {
        const legacy = memoryKvArea({ Backedup: { '444': legacyRows } });
        const db = new BackupDb(legacy);
        const migrated = await db.migrateFromLegacy();
        expect(migrated).toContain('444');
        expect(await db.getRows(444)).toEqual(legacyRows);
        // 迁移后旧存储键被清除（不再占空间）
        expect(((await legacy.get('Backedup')).Backedup)).toBeUndefined();
        // 重复迁移不再迁移
        expect(await db.migrateFromLegacy()).not.toContain('444');
    });

    it('写入与删除', async () => {
        const area = memoryKvArea();
        const db = new BackupDb(area);
        await db.setRows(555, legacyRows);
        expect(await db.getRows(555)).toEqual(legacyRows);
        await db.removeRows(555);
        expect(await db.getRows(555)).toEqual([]);
    });

    it('getMeta 仅返回轻量元数据（不含 data 大字段）', async () => {
        const area = memoryKvArea();
        const db = new BackupDb(area);
        await db.setRows(555, legacyRows);
        const meta = await db.getMeta();
        expect(meta['555']).toEqual([{ module: 'Messages', time: 1600000000000, count: 1 }]);
    });

    describe('countBackupData 兼容数组与遗留对象形态', () => {
        it('数组形态', () => {
            expect(countBackupData([1, 2, 3])).toBe(3);
        });
        it('对象形态 {items} / {list} / {total}', () => {
            expect(countBackupData({ items: [1, 2], total: 2 })).toBe(2);
            expect(countBackupData({ list: [1, 2, 3], total: 3 })).toBe(3);
            expect(countBackupData({ total: 99 })).toBe(99);
        });
        it('非数组/非对象返回 0', () => {
            expect(countBackupData(undefined)).toBe(0);
            expect(countBackupData(null)).toBe(0);
            expect(countBackupData('x')).toBe(0);
        });
    });

    describe('迁移合并：不覆盖已导入/已备份的数组形态数据', () => {
        it('遗留对象形态与已存在新键数组形态并存时，保留新键数组形态', async () => {
            // 模拟用户场景：老版本遗留单键 Backedup 中数组模块是对象形态（{list,total}），
            // 而用户已通过导入把数组形态（纯数组）写入了新键 backup:uin:module。
            // 迁移必须合并而非覆盖，否则刷新后数组模块计数归零（而留言板/访客本就对象形态反而正常）。
            const legacyData = {
                '1334122472': [
                    { module: 'Messages', data: { list: Array(62).fill({ tid: 'x' }), total: 62 }, time: 1 },
                    { module: 'Boards', data: { items: Array(79).fill({}), total: 79 }, time: 1 },
                ],
            };
            const area = memoryKvArea({ Backedup: legacyData });
            // 预先写入已导入的数组形态新键（Messages 已是数组，Boards 尚无新键）
            const db = new BackupDb(area);
            await db.setRows('1334122472', [
                { module: 'Messages', data: Array(62).fill({ tid: 'a' }), time: 2 },
            ]);

            const migrated = await db.migrateFromLegacy();
            expect(migrated).toContain('1334122472');

            const rows = await db.getRows('1334122472');
            const messages = rows.find(r => r.module === 'Messages')!;
            const boards = rows.find(r => r.module === 'Boards')!;
            // Messages 必须是导入的数组形态（62 条），未被遗留对象形态覆盖
            expect(Array.isArray(messages.data)).toBe(true);
            expect((messages.data as unknown[]).length).toBe(62);
            // 计数对两种形态都正确
            expect(countBackupData(messages.data)).toBe(62);
            expect(countBackupData(boards.data)).toBe(79);
            // 遗留旧键被清除
            expect((await area.get('Backedup')).Backedup).toBeUndefined();
        });
    });

    describe('v3.3 索引化：不再全量读 storage，写入不再搬运全量', () => {
        /** 包装 KvArea，记录每次 get 的入参与每次 set 写入的键 */
        function trackingArea(initial?: Record<string, unknown>) {
            const inner = memoryKvArea(initial);
            const getCalls: (string | string[] | null)[] = [];
            const setKeys: string[][] = [];
            const area: KvArea = {
                async get(keys) { getCalls.push(keys); return inner.get(keys); },
                async set(items) { setKeys.push(Object.keys(items)); return inner.set(items); },
                async remove(keys) { return inner.remove(keys); },
            };
            return { area, getCalls, setKeys, inner };
        }

        const bigRows = [
            { module: 'Messages', data: Array(62).fill({ tid: 'm' }), time: 1 },
            { module: 'Photos', data: Array(19).fill({ id: 'p' }), time: 1 },
            { module: 'Boards', data: { items: Array(79).fill({}), total: 79 }, time: 1 },
        ];

        it('getRows / getMeta 按索引精确读，不触发 get(null) 全量读', async () => {
            const seed = memoryKvArea();
            const seedDb = new BackupDb(seed);
            await seedDb.setRows('777', bigRows);
            const snapshot = await seed.get(null);

            const { area, getCalls } = trackingArea(snapshot);
            const db = new BackupDb(area);
            getCalls.length = 0;

            expect((await db.getRows('777')).length).toBe(3);
            expect(Object.keys(await db.getMeta())).toEqual(['777']);
            // 关键：全程没有 get(null)。此前实现每次读都会把所有模块的完整 data 拉进内存，
            // 使「分键」退化回巨型单键。
            expect(getCalls.some(c => c === null)).toBe(false);
        });

        it('putRow 只写「该模块行 + meta」两个键，不搬运其它模块数据', async () => {
            const seed = memoryKvArea();
            const seedDb = new BackupDb(seed);
            await seedDb.setRows('888', bigRows);
            const snapshot = await seed.get(null);

            const { area, setKeys } = trackingArea(snapshot);
            const db = new BackupDb(area);
            setKeys.length = 0;

            await db.putRow('888', { module: 'Videos', data: Array(4).fill({ v: 1 }), time: 9 });

            // 只应写入 backup:888:Videos 与 backup_meta:888（uin 已在索引中，不额外写索引）
            const written = setKeys.flat();
            expect(written).toContain('backup:888:Videos');
            expect(written).toContain('backup_meta:888');
            expect(written).not.toContain('backup:888:Messages');
            expect(written).not.toContain('backup:888:Photos');

            // 其它模块数据完好，新模块可读
            const rows = await db.getRows('888');
            expect(rows.map(r => r.module).sort()).toEqual(['Boards', 'Messages', 'Photos', 'Videos']);
            expect(countBackupData(rows.find(r => r.module === 'Messages')!.data)).toBe(62);
        });

        it('setRows 原子覆盖：清理本次不含的旧模块，且不产生中间空窗', async () => {
            const area = memoryKvArea();
            const db = new BackupDb(area);
            await db.setRows('999', bigRows);
            // 覆盖为仅含 Messages —— Photos/Boards 的行键应被清理
            await db.setRows('999', [bigRows[0]!]);
            const rows = await db.getRows('999');
            expect(rows.map(r => r.module)).toEqual(['Messages']);
            const all = await area.get(null);
            expect(Object.keys(all).filter(k => k.startsWith('backup:999:')).sort())
                .toEqual(['backup:999:Messages']);
        });

        it('uin 索引缺失时自愈重建（老数据只有 backup_meta:* 无索引键）', async () => {
            const seed = memoryKvArea();
            const seedDb = new BackupDb(seed);
            await seedDb.setRows('1334122472', bigRows);
            const snapshot = await seed.get(null);
            delete snapshot['backup_uins']; // 模拟升级前写入的数据：没有索引键

            const area = memoryKvArea(snapshot);
            const db = new BackupDb(area);
            const meta = await db.getMeta();
            expect(Object.keys(meta)).toEqual(['1334122472']);
            // 重建后索引已落盘
            expect((await area.get('backup_uins'))['backup_uins']).toEqual(['1334122472']);
        });

        it('全量导入场景：整体覆盖后数组模块计数与来源一致', async () => {
            const area = memoryKvArea();
            const db = new BackupDb(area);
            // 先有一份旧数据（含一个后续不再存在的模块）
            await db.setRows('1334122472', [
                { module: 'Diaries', data: Array(2).fill({ d: 1 }), time: 1 },
            ]);
            // 全量导入覆盖（ToolsPanel 不再先 removeRows，直接 setRows）
            await db.setRows('1334122472', bigRows);
            const rows = await db.getRows('1334122472');
            expect(rows.find(r => r.module === 'Diaries')).toBeUndefined();
            expect(countBackupData(rows.find(r => r.module === 'Messages')!.data)).toBe(62);
            expect(countBackupData(rows.find(r => r.module === 'Photos')!.data)).toBe(19);
            expect(countBackupData(rows.find(r => r.module === 'Boards')!.data)).toBe(79);
        });
    });

    describe('Vue 响应式（Proxy）数据写入 storage', () => {
        it('对照组：Proxy 数组直接交给 chrome.storage 会被变形成对象（证明模拟器能复现缺陷）', async () => {
            const area = chromeLikeKvArea();
            const proxyArray = new Proxy([{ a: 1 }, { a: 2 }], {});
            // JS 层看它就是数组，所以业务代码毫无察觉
            expect(Array.isArray(proxyArray)).toBe(true);

            await area.set({ probe: { data: proxyArray } });
            const back = (await area.get('probe')).probe as { data: unknown };
            expect(Array.isArray(back.data)).toBe(false);
            expect(back.data).toEqual({ 0: { a: 1 }, 1: { a: 2 } });
            // 变形后既无 total 也无 items/list，计数直接归零——正是「数组模块全 0」的现象
            expect(countBackupData(back.data)).toBe(0);
        });

        it('setRows 写入 Proxy 数组后，读回仍是数组且计数正确（含嵌套 Proxy 数组）', async () => {
            const area = chromeLikeKvArea();
            const db = new BackupDb(area);
            // 模拟 Vue reactive：外层数组是 Proxy，元素内部还有 Proxy 数组（相册的 photoList）
            const messages = new Proxy(Array.from({ length: 62 }, (_, i) => ({ i })), {});
            const photos = new Proxy(
                [{ name: 'a', photoList: new Proxy([{ p: 1 }, { p: 2 }], {}) }],
                {},
            );
            const boards = new Proxy({ items: new Proxy([{ b: 1 }], {}), total: 79 }, {});

            await db.setRows('1334122472', [
                { module: 'Messages', data: messages, time: 1 },
                { module: 'Photos', data: photos, time: 1 },
                { module: 'Boards', data: boards, time: 1 },
            ]);

            const rows = await db.getRows('1334122472');
            const dataOf = (m: string) => rows.find(r => r.module === m)!.data;

            expect(Array.isArray(dataOf('Messages'))).toBe(true);
            expect(countBackupData(dataOf('Messages'))).toBe(62);
            // 嵌套数组也必须保持数组：只用 toRaw() 解一层会在这里失败
            const firstAlbum = (dataOf('Photos') as { photoList: unknown }[])[0]!;
            expect(Array.isArray(firstAlbum.photoList)).toBe(true);
            expect(countBackupData(dataOf('Photos'))).toBe(1);
            // 对象形态模块保持原有语义（total 优先）
            expect(countBackupData(dataOf('Boards'))).toBe(79);

            // meta 索引里的 count 同样要正确（表格下拉与刷新都依赖它）
            const meta = await db.getMeta();
            const countOfModule = (m: string) => meta['1334122472']!.find(x => x.module === m)!.count;
            expect(countOfModule('Messages')).toBe(62);
            expect(countOfModule('Boards')).toBe(79);
        });

        it('putRow 写入 Proxy 数组同样不变形（采集引擎增量写入路径）', async () => {
            const area = chromeLikeKvArea();
            const db = new BackupDb(area);
            const data = new Proxy(Array.from({ length: 8 }, (_, i) => ({ i })), {});

            await db.putRow('1334122472', { module: 'Blogs', data, time: 1 });

            const row = await db.getRow('1334122472', 'Blogs');
            expect(Array.isArray(row!.data)).toBe(true);
            expect(countBackupData(row!.data)).toBe(8);
        });
    });
});
