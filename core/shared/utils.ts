/**
 * 共享工具函数（向后兼容 barrel）
 *
 * 原有函数已按职责拆分到子模块，此处重导出保证所有旧 import 路径不受影响：
 *   - core/shared/url.ts      URL 解析/构建/协议转换
 *   - core/shared/json.ts     JSONP 剥壳解析
 *   - core/shared/format.ts   日期/文件名格式化
 *   - core/shared/crypto.ts   哈希/随机数/g_tk
 *
 * 新增代码建议直接从子模块导入，避免单一 barrel 体积膨胀。
 */

// URL
export { unwrapQpicProxy, isUrlCnShortlink, extractRealUrlFromUrlCnHtml, unwrapImageUrlSync, toParams, toUrl, toHttp, toHttps, trimDownloadUrl, makeDownloadUrl, makeViewUrl, getFileSuffixByUrl, normalizeForDedup, getCookieValue, getCommentCount } from './url';

// JSON
export { toJson } from './json';

// Format
export { filenameValidate, prefixNumber, formatDateValue, formatDate, toDate, parseDate } from './format';

// Crypto
export { calcGtk, hashString, newSimpleUid, randomSeconds } from './crypto';

// 原地保留的小型函数
/** 合并集合（避免大数据量 concat 创建新数组的内存峰值） */
export function unionItems<T>(itemsA?: T[], itemsB?: T[]): T[] {
    if (!itemsA || itemsA.length === 0) return itemsB ? [...itemsB] : [];
    if (!itemsB || itemsB.length === 0) return itemsA;
    itemsA.push(...itemsB);
    return itemsA;
}

/** 等待指定毫秒 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 排序（原地） */
/**
 * 按字段名（不区分大小写）读取条目上的值。
 * 用于增量备份的「比较字段」——不同采集接口返回的字段大小写不一致
 * （如 uploadTime/uploadtime、pubTime/pubtime），配置里写一种写法时，
 * 仍能从条目上取到对应的时间，避免取到 undefined 导致增量停止判定失效。
 */
export function getItemField<T = unknown>(item: Record<string, any> | undefined, field: string): T | undefined {
    if (!item || !field) return undefined;
    if (Object.prototype.hasOwnProperty.call(item, field)) return item[field] as T;
    const lower = field.toLowerCase();
    for (const key of Object.keys(item)) {
        if (key.toLowerCase() === lower) return item[key] as T;
    }
    return undefined;
}

export function sortBy<T extends Record<string, any>>(items: T[], field: string, desc?: boolean): T[] {
    if (!items || items.length === 1) return items;
    const compare = (obj1: T, obj2: T): number => {
        const val1 = getItemField(obj1, field) as any;
        const val2 = getItemField(obj2, field) as any;
        if (typeof val1 === 'string' && typeof val2 === 'string') {
            return desc ? -val1.localeCompare(val2) : val1.localeCompare(val2);
        }
        if (val1 === val2) return 0;
        const isMax = val1 > val2 ? 1 : -1;
        return desc ? -isMax : isMax;
    };
    return items.sort(compare);
}

/**
 * Uint8Array → base64 字符串（无 String.fromCharCode.apply 栈溢出风险，适配大块）。
 * 用于 background 代理与 content 之间经 chrome.runtime port 回传媒体字节：
 * 实测本环境下「二进制(Uint8Array)」结构化克隆会丢数据，base64 字符串通道稳定可靠。
 */
export function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const CHUNK = 0x8000; // 32KB，避免 String.fromCharCode.apply(null, arr) 在大数组上栈溢出
    for (let i = 0; i < bytes.length; i += CHUNK) {
        const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
        binary += String.fromCharCode.apply(null, slice as unknown as number[]);
    }
    return btoa(binary);
}

/** base64 字符串 → Uint8Array（无栈溢出风险） */
export function base64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
