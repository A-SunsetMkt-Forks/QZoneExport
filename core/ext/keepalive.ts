/**
 * Service Worker 保活（备份期间防休眠）
 * chrome.alarms 最小周期30秒（Chrome 120+），配合备份状态标记使用：
 * 备份开始时 start()，结束/取消时 stop()；SW被杀后 alarm 会重新唤醒它
 */

export const KEEPALIVE_ALARM = 'qzone-backup-keepalive';

/** 开始保活（幂等） */
export async function startKeepAlive(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.alarms) {
        return;
    }
    await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
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
