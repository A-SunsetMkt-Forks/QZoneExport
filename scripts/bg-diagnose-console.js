// QZoneExport 卡死排查 —— background Service Worker 版
// 运行位置：chrome://extensions → QZoneExport → 「Service Worker / 背景页」→ 检查 → Console
// 粘贴整段执行即可。
(async () => {
    const KEEPALIVE_ALARM = 'qzone-backup-keepalive';

    console.log('【background 诊断】');

    // 1) keepalive alarm 残留（上次备份崩溃/强关会留下，导致 SW 永不休眠）
    let alarms = [];
    try { alarms = await chrome.alarms.getAll(); } catch (_) { /* 忽略 */ }
    const ka = alarms.find(a => a.name === KEEPALIVE_ALARM);
    console.log('alarm 列表:', alarms.map(a => `${a.name}@${a.periodInMinutes}min`));
    console.log('keepalive 残留?:', ka
        ? `是（每 ${ka.periodInMinutes} 分钟唤醒一次 → SW 永不休眠，内存常驻）`
        : '否');

    // 2) SW 被唤醒频率（storage.session 跨唤醒累加，短时暴涨=持续被唤醒）
    const { __sw_wakeups: prev } = await chrome.storage.session.get('__sw_wakeups');
    const n = (typeof prev === 'number' ? prev : 0) + 1;
    await chrome.storage.session.set({ __sw_wakeups: n });
    console.log('SW 累计唤醒次数:', n, '（数字很大=被频繁唤醒，alarm 残留或事件风暴）');

    // 3) JS 堆（仅 Chrome 有 performance.memory）
    const mem = (typeof performance !== 'undefined' && (performance as any).memory) ? (performance as any).memory : null;
    if (mem) {
        console.log('JS 堆:', `已用 ${(mem.usedJSHeapSize / 1048576).toFixed(1)}MB / 上限 ${(mem.jsHeapSizeLimit / 1048576).toFixed(1)}MB`);
    } else {
        console.log('JS 堆: 当前环境不支持 performance.memory');
    }

    // 4) 一键清理残留 alarm（立即缓解卡死）
    if (ka) {
        await chrome.alarms.clear(KEEPALIVE_ALARM);
        console.log('✅ 已清理残留 keepalive alarm，SW 将恢复可休眠');
    } else {
        console.log('→ 未见 keepalive 残留，卡死源可能在 content script / QQ 空间页面侧，请改用页面版诊断脚本（scripts/idb-diagnose-console.js）');
    }
})();
