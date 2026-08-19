/**
 * 备份历史数据存储（chrome.storage.local 分键方案）。
 *
 * v3.2 关键修复（2026-08-09，选项 B）：
 *  早年实现将某个 QQ 全部模块完整 data 数组作为一个巨型 `Backedup` 单键反复读改写，
 *  累积 100MB+ 时写操作会阻塞浏览器存储子系统、重启即卡死。根因是「单键巨型对象」，
 *  而非 chrome.storage.local 的 10MB 配额（本项目已声明 unlimitedStorage 权限，配额已被忽略）。
 *
 *  正确解法：按 `uin::module` 分键写入 chrome.storage.local，每个键只承载单个模块的增量行。
 *  chrome.storage.local 是扩展作用域、跨 content / background / Options 共享，
 *  因此 content script 直接写入，Options 页也能读到同一份，无需经 background 代理。
 *
 * v3.3 重构（2026-08-09）——「分键」名存实亡问题 + 统一按新键规则读：
 *  1) 此前所有读路径都走 `area.get(null)`（读整个 storage），再按前缀过滤。这会把**所有模块的
 *     完整 data** 一次性反序列化进内存，等于把分键又合成回一个巨型对象，分键的收益被完全抵消；
 *     `putRow` 更是「读全量 + 写全量」，引擎每保存一个模块都要搬运该 QQ 的所有数据（写放大 O(n²)）。
 *     现改为：`backup_meta:<uin>` 充当**索引**（模块清单 + time + count），读行时按索引精确 get
 *     指定键；`backup_uins` 索引所有 QQ 号，避免为列出 QQ 号而全量扫描。
 *  2) 删除 `getRows` / `getMeta` 中对遗留单键 `Backedup` 的**读兜底**。遗留数据在安装/更新时由
 *     `migrateFromLegacy()` 一次性迁移到新键并删除旧键，读路径只认新键规则。此前的读兜底不仅重复，
 *     还自造了坑——迁移逻辑必须额外绕开它（否则会把遗留数据本身误判为「已存在的新键」而跳过迁移），
 *     且让「是否读到旧数据」取决于 SW 迁移时序，制造了难以复现的偶发不一致。
 *
 * 注意（形态兼容 ≠ 键规则兼容）：迁移只改**键**不改 **value 形态**，且当前引擎本身就对不同模块
 * 产出不同形态（数组 / `{items,total}` / `{list,total}`），因此 `countBackupData` 的多形态兼容
 * 是本质需求，不属于「遗留键兼容」，不能随本次重构一并删除。详见该函数注释。
 *
 * v3.4 修复（2026-08-09）——写入前必须 `toPlain`，否则数组被静默存成 `{"0":…}`：
 *  症状：Options 导入后刷新，8 个数组模块计数全为 0，而留言板 / 访客（对象形态）却完全正常。
 *  根因：Chrome 把 JS 值转成 `base::Value` 时，判定数组用的是 C++ 层 `v8::Value::IsArray()`，
 *  它只认 `JSArray`、**不穿透 Proxy**；而 JS 规范的 `Array.isArray()` 穿透 Proxy。Vue 的
 *  reactive 数据正是 Proxy，于是 reactive **数组**掉进「普通对象」分支被存成 `{"0":…,"1":…}`，
 *  读回来 `countBackupData` 既找不到 total 也找不到 items/list → 归零；而 reactive **对象**
 *  （`{items,total}`）属性原样保留 → 看起来正常。这也解释了「导入那一刻表格对、一刷新就崩」：
 *  前者渲染的是内存里的真数组，后者渲染的是 storage 里已变形的对象。
 *
 *  该规约项目里本就存在（见 `core/shared/config.ts:saveConfig` 与 `core/shared/plain.ts`），
 *  只是 BackupDb 这条后加的写入路径漏用了。故**统一在存储层收口**：`putRow` / `setRows` 一律
 *  先 `toPlain`，调用方无需关心。注意单测的内存 KvArea 与 Node 复现都不会触发 V8 的这条路径，
 *  必须用模拟「IsArray 不穿透 Proxy」的 KvArea 才能复现（见 tests/clients-store.test.ts）。
 */

import { toPlain } from '../shared/plain';

/** 单模块备份行（与旧版 Backedup[uin] 数组元素结构一致） */
export interface ModuleBackupRow {
    module: string;
    data: unknown;
    time: number;
}

/** 轻量备份元数据（供 options 页面使用，不含 data 大字段） */
export interface ModuleMeta {
    module: string;
    time: number;
    /** 该模块已备份条目数（由 countBackupData 统一计算） */
    count: number;
}

/** 按 QQ 号聚合的元数据 { uin: ModuleMeta[] } */
export type BackedupMeta = Record<string, ModuleMeta[]>;

/** 旧版 chrome.storage.local 中的 Backedup 形状 */
export type LegacyBackedup = Record<string, ModuleBackupRow[]>;

/** 键值存储区抽象（chrome.storage.local 的最小公共面，便于单测注入内存实现） */
export interface KvArea {
    get(keys: string | string[] | null): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
}

/**
 * 采集引擎所需的最小读写面：只按模块粒度读写。
 * 引擎跑在 content script，直接读写共享的 storage.local；
 * 全量 getRows/setRows 仍提供但仅在 Options 本地调用，不过消息通道。
 */
export interface BackupHistoryStore {
    /** 读取单个模块行 */
    getRow(uin: number | string, module: string): Promise<ModuleBackupRow | undefined>;
    /** 增量写入单个模块行（不影响其它模块） */
    putRow(uin: number | string, row: ModuleBackupRow): Promise<void>;
}

export interface BackupStore extends BackupHistoryStore {
    /** 读取指定QQ的全部模块行 */
    getRows(uin: number | string): Promise<ModuleBackupRow[]>;
    /** 覆盖写入指定QQ的全部模块行 */
    setRows(uin: number | string, rows: ModuleBackupRow[]): Promise<void>;
    /** 轻量元数据（不含 data 大字段） */
    getMeta(): Promise<BackedupMeta>;
    /** 已备份QQ号清单 */
    listUins(): Promise<string[]>;
    /** 删除指定QQ的备份历史 */
    removeRows(uin: number | string): Promise<void>;
    /** 迁移旧版单键 Backedup → 分键，返回迁移的 QQ 号清单 */
    migrateFromLegacy(): Promise<string[]>;
}

/** 行键前缀：backup:<uin>:<module> */
const ROW_PREFIX = 'backup:';
/** 元数据（兼索引）键前缀：backup_meta:<uin> */
const META_PREFIX = 'backup_meta:';
/** QQ 号索引键：string[]，避免为列出 QQ 号而全量扫描 storage */
const UINS_KEY = 'backup_uins';
/** 旧版遗留单键 */
const LEGACY_KEY = 'Backedup';
/** Options 备份管理页「上次选中的 QQ」（刷新/重载后据此默认选中，避免导入别的 QQ 后重载回退到旧 QQ） */
const LAST_UIN_KEY = 'backup_last_uin';

function rowKey(uin: number | string, module: string): string {
    return `${ROW_PREFIX}${uin}:${module}`;
}
function metaKey(uin: number | string): string {
    return `${META_PREFIX}${uin}`;
}

/**
 * 统一计数：兼容「数组」与「对象形态」两种 data 形状。
 *
 * 这**不是**遗留键兼容，而是当前数据模型的真实差异，原因有二：
 *  1) 当前采集引擎对不同模块本就产出不同形态——留言板为 `{authorInfo,items,total}`、
 *     访客为 `{items,total,totalPage}`，其余模块为纯数组；
 *  2) 遗留数据迁移只改**键**不改 **value 形态**，V2 写入的 `{list,total}` 会原样存活在新键中。
 * 因此读取侧必须能对三种形态都数出数量，否则这些模块会显示 0。
 *
 * 优先级：数组 → 长度；对象 → 优先 total（留言板/访客等模块的 total 即导出 JSON 里的
 * 「已备份数量」，与用户预期一致），再退 items / list 长度。
 */
export function countBackupData(data: unknown): number {
    if (Array.isArray(data)) return data.length;
    if (data && typeof data === 'object') {
        const o = data as Record<string, unknown>;
        // 优先 total：与导出 JSON 的 total 对齐（访客/留言板等以此为准展示）
        if (typeof o.total === 'number' && o.total > 0) return o.total;
        if (Array.isArray(o.items)) return o.items.length;
        if (Array.isArray(o.list)) return o.list.length;
        if (typeof o.total === 'number') return o.total;
    }
    return 0;
}

function rowToMeta(row: ModuleBackupRow): ModuleMeta {
    return { module: row.module, time: row.time, count: countBackupData(row.data) };
}

function rowsToMeta(rows: ModuleBackupRow[]): ModuleMeta[] {
    return rows.map(rowToMeta);
}

/** 默认存储区：扩展 origin 的 chrome.storage.local（KV 行为一致，仅做类型收口） */
export function defaultArea(): KvArea {
    const area = chrome.storage.local;
    return {
        get: (keys) => area.get(keys as any),
        set: (items) => area.set(items),
        remove: (keys) => area.remove(keys as any),
    };
}

export class BackupDb implements BackupStore {
    private readonly area: KvArea;

    constructor(area?: KvArea) {
        this.area = area ?? defaultArea();
    }

    // ------------------------- 索引维护 -------------------------

    /** 读取某 QQ 的元数据（即模块索引）；不存在返回 undefined */
    private async readMeta(uin: string): Promise<ModuleMeta[] | undefined> {
        const key = metaKey(uin);
        const res = await this.area.get(key);
        const value = res[key];
        return Array.isArray(value) ? (value as ModuleMeta[]) : undefined;
    }

    /**
     * 读取 QQ 号索引；索引缺失时全量扫描一次并重建（仅发生一次，之后都走索引）。
     * 这是**自愈**而非形态兼容：老数据只有 backup_meta:* 而无 backup_uins 索引键。
     */
    private async readUins(): Promise<string[]> {
        const res = await this.area.get(UINS_KEY);
        const value = res[UINS_KEY];
        if (Array.isArray(value)) return value as string[];
        const all = await this.area.get(null);
        const uins: string[] = [];
        for (const key of Object.keys(all)) {
            if (key.startsWith(META_PREFIX)) uins.push(key.slice(META_PREFIX.length));
        }
        await this.area.set({ [UINS_KEY]: uins });
        return uins;
    }

    private async addUin(uin: string): Promise<void> {
        const uins = await this.readUins();
        if (uins.includes(uin)) return;
        await this.area.set({ [UINS_KEY]: [...uins, uin] });
    }

    private async dropUin(uin: string): Promise<void> {
        const uins = await this.readUins();
        if (!uins.includes(uin)) return;
        await this.area.set({ [UINS_KEY]: uins.filter(u => u !== uin) });
    }

    // ------------------------- 读 -------------------------

    async getRow(uin: number | string, module: string): Promise<ModuleBackupRow | undefined> {
        const key = rowKey(uin, module);
        const res = await this.area.get(key);
        return res[key] as ModuleBackupRow | undefined;
    }

    /**
     * 读取该 QQ 的全部模块行。
     * 按 meta 索引精确 get 目标键，**不再 `get(null)` 全量读**——否则会把所有 QQ、所有模块的
     * 完整 data 都拉进内存。meta 与行在同一次 set 中原子写入，故 meta 缺失即视为无数据。
     */
    async getRows(uin: number | string): Promise<ModuleBackupRow[]> {
        const key = String(uin);
        const meta = await this.readMeta(key);
        if (!meta || !meta.length) return [];
        const keys = meta.map(m => rowKey(key, m.module));
        const res = await this.area.get(keys);
        const rows: ModuleBackupRow[] = [];
        for (const m of meta) {
            const row = res[rowKey(key, m.module)] as ModuleBackupRow | undefined;
            if (row) rows.push(row);
        }
        return rows;
    }

    /** 轻量元数据：只读索引与各 QQ 的 meta 键，不触碰任何 data */
    async getMeta(): Promise<BackedupMeta> {
        const uins = await this.readUins();
        if (!uins.length) return {};
        const res = await this.area.get(uins.map(metaKey));
        const result: BackedupMeta = {};
        for (const uin of uins) {
            const modules = res[metaKey(uin)] as ModuleMeta[] | undefined;
            if (modules && modules.length) result[uin] = modules;
        }
        return result;
    }

    async listUins(): Promise<string[]> {
        const meta = await this.getMeta();
        return Object.keys(meta);
    }

    // ------------------------- 写 -------------------------

    /**
     * 增量写入单个模块行：只写「该模块行 + meta 索引」两个键。
     * 此前实现是 getRows + setRows（读全量再写全量），引擎每保存一个模块都会搬运该 QQ
     * 的所有模块数据，是严重的写放大；现已消除。
     */
    async putRow(uin: number | string, row: ModuleBackupRow): Promise<void> {
        const key = String(uin);
        // 先剥离可能的 Vue 响应式 Proxy 再写入与统计，详见文件头 v3.4 说明
        const safeRow = toPlain<ModuleBackupRow>(row);
        const meta = (await this.readMeta(key)) ?? [];
        const next = meta.filter(m => m.module !== safeRow.module);
        next.push(rowToMeta(safeRow));
        await this.area.set({ [rowKey(key, safeRow.module)]: safeRow, [metaKey(key)]: next });
        await this.addUin(key);
    }

    /**
     * 覆盖写入该 QQ 的全部模块行。
     * 先原子写入「新行 + 新 meta」，再删除本次不再包含的旧模块行——**不存在中间空窗**，
     * 因此调用方无需先 removeRows 再 setRows（那样会在两次操作之间产生「storage 为空」的窗口，
     * 期间任何并发读都会读到空数据）。
     */
    async setRows(uin: number | string, rows: ModuleBackupRow[]): Promise<void> {
        const key = String(uin);
        // 整批剥离 Vue 响应式 Proxy：Options 传入的 rows 来自组件的 reactive 状态，详见文件头 v3.4 说明
        const safeRows = toPlain<ModuleBackupRow[]>(rows);
        const prevMeta = (await this.readMeta(key)) ?? [];
        const stale = new Set(prevMeta.map(m => m.module));
        const items: Record<string, unknown> = {};
        for (const row of safeRows) {
            items[rowKey(key, row.module)] = row;
            stale.delete(row.module);
        }
        items[metaKey(key)] = rowsToMeta(safeRows);
        await this.area.set(items);
        if (stale.size) {
            await this.area.remove([...stale].map(m => rowKey(key, m)));
        }
        await this.addUin(key);
    }

    async removeRows(uin: number | string): Promise<void> {
        const key = String(uin);
        const meta = (await this.readMeta(key)) ?? [];
        const keys = meta.map(m => rowKey(key, m.module));
        keys.push(metaKey(key));
        await this.area.remove(keys);
        await this.dropUin(key);
    }

    // ------------------------- 上次选中的 QQ -------------------------

    /** 读取 Options「上次选中的 QQ」（用于重载后默认选中，避免导入别的 QQ 后回退旧 QQ） */
    async getLastUin(): Promise<string | undefined> {
        const res = await this.area.get(LAST_UIN_KEY);
        return (res[LAST_UIN_KEY] as string) || undefined;
    }

    /** 记录 Options「上次选中的 QQ」 */
    async saveLastUin(uin: string): Promise<void> {
        await this.area.set({ [LAST_UIN_KEY]: uin });
    }

    // ------------------------- 迁移 -------------------------

    /**
     * 迁移旧版单键 `Backedup` → 分键，并删除旧键。幂等：无遗留键时直接返回。
     *
     * 合并而非覆盖：仅补充「新键中尚不存在」的模块，避免把用户已导入/已备份的数据，
     * 被遗留的旧数据覆盖掉。判断依据直接取 meta 索引，因此无需再像旧实现那样特意
     * 绕开「getRows 的遗留兜底」——该兜底已随本次重构删除。
     */
    async migrateFromLegacy(): Promise<string[]> {
        const all = await this.area.get(LEGACY_KEY);
        const legacy = all[LEGACY_KEY] as LegacyBackedup | undefined;
        if (!legacy) return [];
        const migrated: string[] = [];
        for (const uin of Object.keys(legacy)) {
            const rows = legacy[uin];
            if (!rows || !rows.length) continue;
            const key = String(uin);
            const existing = (await this.readMeta(key)) ?? [];
            const existingModules = new Set(existing.map(m => m.module));
            const items: Record<string, unknown> = {};
            const added: ModuleMeta[] = [];
            for (const row of rows) {
                if (existingModules.has(row.module)) continue;
                items[rowKey(key, row.module)] = row;
                added.push(rowToMeta(row));
                existingModules.add(row.module);
            }
            if (added.length) {
                items[metaKey(key)] = [...existing, ...added];
                await this.area.set(items);
                await this.addUin(key);
                migrated.push(key);
            }
        }
        // 迁移完成后删除旧键（此后读路径只认新键规则）
        await this.area.remove(LEGACY_KEY);
        return migrated;
    }
}
