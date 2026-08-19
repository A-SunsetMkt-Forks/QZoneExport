/**
 * popup 与内容脚本(content.js)的通信封装
 * 严格复用旧 popup.js 的契约：chrome.tabs.connect({name:'popup'}) + {from,subject,...}
 * 内容脚本仅在 https://*.qzone.qq.com/* 注入，非该页时连接无响应
 */

export interface OwnerInfo {
    uin: string | number;
    nickname?: string;
    name?: string;
}

export interface UinData {
    Owner: OwnerInfo;
    Target: OwnerInfo;
}

export interface AlbumItem {
    id: string;
    name: string;
    className: string;
    total: number;
}

/** 获取当前活动标签页 id */
function getCurrentTabId(): Promise<number | null> {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            resolve(tabs.length ? (tabs[0]!.id ?? null) : null);
        });
    });
}

/** 获取当前活动标签页 URL（需 host 权限，已声明 <all_urls>） */
export function getActiveTabUrl(): Promise<string> {
    return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            resolve(tabs.length ? (tabs[0]!.url ?? '') : '');
        });
    });
}

/**
 * 向内容脚本发送一条消息并等待其响应（一次性）
 * @param message 消息体（会自动补 from:'popup'）
 * @param timeoutMs 超时毫秒，超时视为不在 QQ 空间页面
 */
export function sendMessage<T = unknown>(
    message: Record<string, unknown>,
    timeoutMs = 10000,
): Promise<T> {
    return new Promise((resolve, reject) => {
        getCurrentTabId().then((tabId) => {
            if (tabId == null) {
                reject(new Error('未找到活动标签页'));
                return;
            }
            let settled = false;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    reject(new Error('内容脚本无响应（请在 QQ 空间页面打开）'));
                }
            }, timeoutMs);
            try {
                const port = chrome.tabs.connect(tabId, { name: 'popup' });
                port.onMessage.addListener((response: T) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    clearTimeout(timer);
                    resolve(response);
                });
                port.onDisconnect.addListener(() => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        reject(new Error('内容脚本连接断开（请在 QQ 空间页面打开）'));
                    }
                });
                port.postMessage({ from: 'popup', ...message });
            } catch (error) {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    reject(error);
                }
            }
        }).catch(reject);
    });
}
