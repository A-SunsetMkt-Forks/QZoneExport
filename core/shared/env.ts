/**
 * 运行时环境检测工具
 *
 * 项目同时在多个环境下运行（浏览器扩展 content script / Service Worker / 测试环境），
 * 各处散落着 `(globalThis as any).chrome` / `(window as any)` 等模式。
 * 本模块提供统一的类型安全 API，消除 `any` 断言并提高可读性。
 */

/** 检查是否运行在浏览器扩展运行时环境中（content script / service worker） */
export function isExtensionEnv(): boolean {
    try {
        return typeof chrome !== 'undefined' && typeof chrome.runtime?.id === 'string';
    } catch {
        return false;
    }
}

/** 安全获取扩展 chrome API 对象（非扩展环境返回 undefined） */
export function getChrome() {
    if (typeof chrome !== 'undefined' && typeof chrome.runtime?.id === 'string') {
        return chrome;
    }
    return undefined;
}

/** 安全获取 window 对象（Worker/SSR 环境返回 undefined） */
export function getWindow(): Window | undefined {
    return typeof window !== 'undefined' ? window : undefined;
}

/** 安全获取 globalThis */
export function getGlobal(): typeof globalThis {
    return globalThis;
}
