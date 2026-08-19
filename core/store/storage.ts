/**
 * typed chrome.storage 封装
 * 通过 KeyValueArea 接口隔离 chrome.* 依赖，便于单测注入内存实现
 */

/** 键值存储区抽象（chrome.storage.sync/local/session 的最小公共面） */
export interface KeyValueArea {
    get(keys: Record<string, unknown> | string | string[]): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
}

/** 基于 chrome.storage.* 的实现（MV3 Promise API） */
export function chromeArea(area: chrome.storage.StorageArea): KeyValueArea {
    return {
        get: (keys) => area.get(keys as any),
        set: (items) => area.set(items),
        remove: (keys) => area.remove(keys as any),
    };
}

/** 内存实现（单测用） */
export function memoryArea(initial?: Record<string, unknown>): KeyValueArea & { dump(): Record<string, unknown> } {
    const store: Record<string, unknown> = { ...(initial || {}) };
    return {
        async get(keys) {
            const result: Record<string, unknown> = {};
            if (typeof keys === 'string') {
                if (store[keys] !== undefined) result[keys] = store[keys];
            } else if (Array.isArray(keys)) {
                for (const key of keys) {
                    if (store[key] !== undefined) result[key] = store[key];
                }
            } else {
                // 对象形式：键为默认值
                for (const key of Object.keys(keys)) {
                    result[key] = store[key] !== undefined ? store[key] : keys[key];
                }
            }
            return result;
        },
        async set(items) {
            Object.assign(store, items);
        },
        async remove(keys) {
            for (const key of Array.isArray(keys) ? keys : [keys]) {
                delete store[key];
            }
        },
        dump: () => ({ ...store }),
    };
}

/**
 * 单键类型化存储
 */
export class TypedStore<T> {
    constructor(
        private readonly area: KeyValueArea,
        private readonly key: string,
        private readonly defaultValue: T,
    ) {}

    async get(): Promise<T> {
        const data = await this.area.get({ [this.key]: this.defaultValue });
        return data[this.key] as T;
    }

    async set(value: T): Promise<void> {
        await this.area.set({ [this.key]: value });
    }

    async remove(): Promise<void> {
        await this.area.remove(this.key);
    }
}
