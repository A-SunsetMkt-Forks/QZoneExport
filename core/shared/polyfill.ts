/**
 * Firefox 跨浏览器兼容 shim（迁移清单 T1）。
 *
 * 本扩展全程使用 `chrome.*` 命名空间（含后台 `sendResponse` + `return true`
 * 回调式消息处理）。Firefox 不暴露全局 `chrome`，故在此把 `chrome` 别名到
 * WXT 提供的标准化 `browser`（Firefox 下即原生 `browser`，Chrome 下即原生
 * `chrome`）。仅当 `chrome` 未定义时赋值，因此 Chrome 构建行为完全不变。
 *
 * 选用 WXT 官方跨浏览器 API（`wxt/browser`，内部 = `@wxt-dev/browser`），
 * 无需额外安装 webextension-polyfill。
 */
import { browser } from 'wxt/browser';

const globalRef = globalThis as unknown as { chrome?: unknown };
if (typeof globalRef.chrome === 'undefined') {
  globalRef.chrome = browser;
}
