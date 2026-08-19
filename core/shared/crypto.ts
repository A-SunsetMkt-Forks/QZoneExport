/**
 * 加密/哈希/随机数工具
 * 移值自 api.js，从 core/shared/utils.ts 拆分。
 */

/** 计算 g_tk（QQ 空间 CSRF Token） */
export function calcGtk(skey: string): number {
    let hash = 5381;
    for (let i = 0, len = skey.length; i < len; ++i) {
        hash += (hash << 5) + skey.charCodeAt(i);
    }
    return hash & 2147483647;
}

/** 字符串确定性哈希（cyrb53），用于由 URL 生成稳定文件名 */
export function hashString(str: string): string {
    str = String(str || '');
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    return hash.toString(36);
}

/** 生成简单 UID */
export function newSimpleUid(len?: number, radix?: number): string {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('');
    const uuid: string[] = [];
    radix = radix || chars.length;
    if (len) {
        for (let i = 0; i < len; i++) uuid[i] = chars[0 | (Math.random() * radix)]!;
    } else {
        uuid[8] = uuid[13] = uuid[18] = uuid[23] = '-';
        uuid[14] = '4';
        for (let i = 0; i < 36; i++) {
            if (!uuid[i]) {
                const r = 0 | (Math.random() * 16);
                uuid[i] = chars[i == 19 ? (r & 0x3) | 0x8 : r]!;
            }
        }
    }
    return uuid.join('');
}

/** 随机秒数 */
export function randomSeconds(min: number, max: number): number {
    const range = max - min;
    return min + Math.round(Math.random() * range);
}
