/**
 * Service Worker 保活（备份期间防休眠）
 * chrome.alarms 周期性唤醒 SW，配合备份状态标记使用：
 * 备份开始时 start()，结束/取消时 stop()；SW 被杀后 alarm 会重新唤醒它。
 *
 * 浏览器差异（Firefox 迁移 T6）：
 * - Chrome 120+ 允许最小 periodInMinutes = 0.5（30 秒）；
 * - Firefox MV3 的 alarms 最小周期约 1 分钟，传 <1 会被规整甚至静默失效，
 *   故按 `import.meta.env.FIREFOX` 显式区分周期（tree-shaking：FF 构建不含 Chrome 分支）。
 * - 走 firefox-mv3 路线，SW 回收较 Chrome 温和，保留 alarms 保活即可，不禁用。
 *   （仅当改走 firefox-mv2 才需 `if (import.meta.env.FIREFOX) return;` 禁用。）
 */

export const KEEPALIVE_ALARM = 'qzone-backup-keepalive';

/** 开始保活（幂等） */
export async function startKeepAlive(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.alarms) {
        return;
    }
    // FF alarms 最小周期约 1 分钟；Chrome 120+ 支持 0.5。编译期分支，Chrome 构建剔除 FF 分支。
    const periodInMinutes = import.meta.env.FIREFOX ? 1 : 0.5;
    await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes });
}

/** 停止保活 */
export async function stopKeepAlive(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.alarms) {
        return;
    }
    await chrome.alarms.clear(KEEPALIVE_ALARM);
}

/**
 * 注册alarm监听（SW顶层调用一次）
 * @param onAlive 每次唤醒的回调（如检查未完成任务、推进队列）
 */
export function registerKeepAlive(onAlive?: () => void): void {
    if (typeof chrome === 'undefined' || !chrome.alarms) {
        return;
    }
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name !== KEEPALIVE_ALARM) {
            return;
        }
        // 触发即完成唤醒使命；回调可用于恢复任务
        onAlive && onAlive();
    });
}
