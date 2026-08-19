/**
 * 把可能带 Vue 响应式代理的数据深层转为普通数据
 *
 * 为什么必须转：Vue 的 reactive/ref 返回的是 Proxy，跨"边界"传递时不被识别为原生类型——
 * - chrome.storage.sync.set：Chrome 的 V8→base::Value 转换按对象内部类型判断是否为数组，
 *   Proxy 不是 JS_ARRAY，数组会被静默存成 { "0": ... } 这样的对象，读回来再 join 就报错；
 * - postMessage：结构化克隆遇到 Proxy 直接抛 DataCloneError。
 *
 * 函数不可序列化，一并剔除。
 */
export function toPlain<T = any>(value: any): T {
    if (value instanceof Map) {
        return new Map([...value].map(([key, item]) => [key, toPlain(item)])) as unknown as T;
    }
    if (Array.isArray(value)) {
        return value.map((item) => toPlain(item)) as unknown as T;
    }
    if (value && typeof value === 'object') {
        const out: Record<string, any> = {};
        for (const key of Object.keys(value)) {
            if (typeof value[key] === 'function') {
                continue;
            }
            out[key] = toPlain(value[key]);
        }
        return out as T;
    }
    return (typeof value === 'function' ? undefined : value) as T;
}
