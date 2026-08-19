import { getItemField, parseDate, unionItems } from '../shared/utils';

/**
 * 增量备份配置（对应 QZone_Config 各模块的同名字段）
 */
export interface IncrementConfig {
    /** 是否继承 Common.Increment 公共配置（默认 true）；false 时本模块使用下方自身字段 */
    IncrementInherit?: boolean;
    /** Full 全量 / LastTime 上次备份 / Custom 自定义时间 */
    IncrementType: 'Full' | 'LastTime' | 'Custom' | string;
    /** 增量时间（yyyy-MM-dd hh:mm:ss） */
    IncrementTime: string;
    /** 增量比较字段（由 INCREMENT_FIELD_BY_MODULE 常量映射注入，不再存于配置） */
    IncrementField: string;
}

/**
 * 各模块增量比较字段（移植自 config.js MODULE_DEFAULTS 的 IncrementField）。
 * 该字段是技术常量、不随用户配置变化，原写死在各模块配置里；现抽为常量映射，
 * 由 resolveConfig 统一注入，避免冗余存储与漂移。
 */
export const INCREMENT_FIELD_BY_MODULE: Record<string, string> = {
    Messages: 'created_time',
    Blogs: 'pubTime',
    Diaries: 'pubtime',
    Boards: 'pubtime',
    Favorites: 'create_time',
    Visitors: 'time',
    Videos: 'uploadTime',
    Shares: 'shareTime',
    Photos: 'uploadTime',
};

/** 默认增量时间（与 config.js Default_IncrementTime 对齐；增量时间戳兜底，不早于 QQ 空间上线） */
export const DEFAULT_INCREMENT_TIME = '2005-06-06 00:00:00';

/** 可增量的条目（isNewItem 由增量流程打标） */
export interface IncrementItem {
    isNewItem?: boolean;
    [key: string]: unknown;
}

/** 是否全量备份 */
export function isFullBackup(moduleConfig: IncrementConfig): boolean {
    return moduleConfig.IncrementType === 'Full';
}

/** 是否上次备份 */
export function isLast(moduleConfig: IncrementConfig): boolean {
    return moduleConfig.IncrementType === 'LastTime';
}

/** 是否自定义备份 */
export function isCustom(moduleConfig: IncrementConfig): boolean {
    return moduleConfig.IncrementType === 'Custom';
}

/** 是否是新备份数据（移植自 modules/common.js isNewItem） */
export function isNewItem(item: IncrementItem): boolean {
    if (item.isNewItem === undefined) {
        return true;
    }
    return item.isNewItem;
}

/**
 * 数据是否包含上次备份的位置
 * 移植自 modules/common.js isPreBackupPos（L688-710），含原判断表达式
 */
export function isPreBackupPos(newItems: IncrementItem[], moduleConfig: IncrementConfig): boolean {
    if (newItems.length == 0) {
        return false;
    }
    if (isFullBackup(moduleConfig)) {
        return false;
    }
    const field = moduleConfig.IncrementField;
    const incRaw = moduleConfig.IncrementTime;
    const incrementTime = parseDate(incRaw).getTime();
    // 按字段名（不区分大小写）读取，兼容 uploadTime/uploadtime、pubTime/pubtime 等接口字段差异
    const firstRaw = getItemField<number | string>(newItems[0] as Record<string, any>, field);
    const lastRaw = getItemField<number | string>(newItems[newItems.length - 1] as Record<string, any>, field);
    const firstTime = parseDate(firstRaw as number | string).getTime();
    const lastTime = parseDate(lastRaw as number | string).getTime();
    // 列表从新到旧：firstTime 最新、lastTime 最旧。停止翻页判定（沿用旧版 common.js 语义）：
    //  - firstTime <= incrementTime：最新一条已早于/等于增量时间 → 已翻过增量点，停止；
    //  - incrementTime >= lastTime（即 lastTime <= incrementTime）：最旧一条仍晚于增量时间 → 整页都在增量点之后，尚未翻到，继续翻页；
    // 注：原"情况三（增量点落在本页中间）= (firstTime<=inc && inc>=lastTime)"是前两者的子集（恒被覆盖），为冗余表达式，已删除。
    return firstTime <= incrementTime || incrementTime >= lastTime;
}

/**
 * 移除已备份数据中不符合条件的数据（原地修改并返回）
 * 移植自 modules/common.js removeOldItems（L728-752）
 */
export function removeOldItems<T extends IncrementItem>(oldItems: T[] | undefined, moduleConfig: IncrementConfig): T[] {
    if (isFullBackup(moduleConfig) || oldItems === undefined) {
        // 选择全量备份时，直接返回空数组，当作没有历史数据处理
        return [];
    }
    const incrementTime = parseDate(moduleConfig.IncrementTime).getTime();
    const field = moduleConfig.IncrementField;
    // items中的数据是从新到旧的，直接倒序判断时间
    for (let i = oldItems.length - 1; i >= 0; i--) {
        const item = oldItems[i]!;
        const time = parseDate(getItemField<number | string>(item as Record<string, any>, field) as number | string).getTime();
        if (time > incrementTime) {
            // 如果集合中的元素存在大于增量备份时间的，则移除
            oldItems.splice(i, 1);
            continue;
        }
        // 旧数据标识
        item.isNewItem = false;
    }
    return oldItems;
}

/**
 * 移除新数据中不符合条件的数据（原地修改并返回）
 * 移植自 modules/common.js removeNewItems（L759-781）
 */
export function removeNewItems<T extends IncrementItem>(newItems: T[], moduleConfig: IncrementConfig): T[] {
    if (isFullBackup(moduleConfig)) {
        return newItems;
    }
    const incrementTime = parseDate(moduleConfig.IncrementTime).getTime();
    const field = moduleConfig.IncrementField;
    for (let i = newItems.length - 1; i >= 0; i--) {
        const item = newItems[i]!;
        const time = parseDate(getItemField<number | string>(item as Record<string, any>, field) as number | string).getTime();
        // 边界语义（与 removeOldItems 对齐、沿用旧版 common.js）：仅 time < incrementTime 才算「旧数据」移出；
        // time === incrementTime 的条目归属「新」（isNewItem=true），确保边界条目被纳入新备份、不丢失。
        // 代价：恰好等于增量时间的条目在多次增量运行间可能偶发 isNewItem 翻转（true/false），
        // 翻转仅导致该条目评论/点赞被冗余重抓一次（覆盖式、无副作用），优于将其整条丢弃。
        if (time < incrementTime) {
            // 如果集合中的元素存在小于增量备份时间的，则移除
            newItems.splice(i, 1);
            continue;
        }
        // 新数据标识
        item.isNewItem = true;
    }
    return newItems;
}

/**
 * 合并已备份数据
 * 移植自 modules/common.js unionBackedUpItems（L789-802）
 */
export function unionBackedUpItems<T extends IncrementItem>(
    moduleConfig: IncrementConfig,
    oldItems: T[] | undefined,
    newItems: T[],
): T[] {
    if (!oldItems || oldItems.length === 0) {
        // 如果已备份数据为空，直接返回新数据
        return newItems;
    }
    oldItems = removeOldItems(oldItems, moduleConfig);
    newItems = removeNewItems(newItems, moduleConfig);
    // 合并新老数据（新数据在前）
    return unionItems(newItems, oldItems);
}
