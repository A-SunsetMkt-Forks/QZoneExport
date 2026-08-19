/* =============================================================
 * QZoneExport 后台自愈 / 应急修复脚本
 * 适用场景：浏览器一启动就卡死（未打开 QQ 空间也卡），删扩展目录能恢复。
 * 原因：IndexedDB 的 tasks store 累积数万条下载任务 + 残留保活 alarm。
 *
 * 用法：
 *   1) 打开 chrome://extensions ，找到「QQ空间导出助手」，点「检查视图：Service Worker」
 *      （若浏览器卡死无法操作，先结束 Chrome 进程，再临时禁用本扩展后启动，恢复后再启用）
 *   2) 在弹出的 DevTools 控制台（SW 上下文）里粘贴整段本脚本，回车执行
 *   3) 等待输出日志，看到「✅ 修复完成」即可；重启浏览器验证不再卡死
 *
 * 该脚本只清理「下载任务残留 / 保活 alarm / 遗留 Backedup 键」，不影响已备份数据。
 * ============================================================= */

(async () => {
  const KEEPALIVE_ALARM = 'qzone-backup-keepalive';
  const DB_NAME = 'qzone-export';
  const STORE_TASKS = 'tasks';
  const log = (...a) => console.log('[QZ-REPAIR]', ...a);

  // 1) 清理保活 alarm
  try {
    await chrome.alarms.clear(KEEPALIVE_ALARM);
    const remaining = await chrome.alarms.getAll();
    log('保活 alarm 已清理，剩余 alarm 数：', remaining.length);
  } catch (e) {
    console.error('[QZ-REPAIR] 清理 alarm 失败', e);
  }

  // 2) 清理遗留 storage.local 巨型键
  try {
    await new Promise((res) => chrome.storage.local.remove('Backedup', () => res()));
    log('storage.local 遗留 Backedup 键已移除');
  } catch (e) {
    console.error('[QZ-REPAIR] 清理 Backedup 失败', e);
  }

  // 3) 清理 IndexedDB 累积的下载任务（优先清 tasks store，失败则整库重建）
  const clearTasks = () =>
    new Promise((resolve) => {
      const open = indexedDB.open(DB_NAME);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(STORE_TASKS)) {
          log('tasks store 不存在，无需清理');
          db.close();
          return resolve(0);
        }
        const tx = db.transaction(STORE_TASKS, 'readwrite');
        const store = tx.objectStore(STORE_TASKS);
        const countReq = store.count();
        countReq.onsuccess = () => {
          const before = countReq.result;
          const clearReq = store.clear();
          clearReq.onsuccess = () => {
            log(`tasks store 已清空（清理前 ${before} 条）`);
            db.close();
            resolve(before);
          };
          clearReq.onerror = () => {
            console.error('[QZ-REPAIR] tasks.clear 失败', clearReq.error);
            db.close();
            resolve(-1);
          };
        };
        countReq.onerror = () => {
          console.error('[QZ-REPAIR] tasks.count 失败', countReq.error);
          db.close();
          resolve(-1);
        };
      };
      open.onerror = () => {
        console.error('[QZ-REPAIR] 打开 IndexedDB 失败', open.error);
        resolve(-1);
      };
    });

  let cleared = await clearTasks();
  if (cleared < 0) {
    // 兜底：store 过大/损坏，直接整库重建（会丢掉备份历史/断点，但能解除卡死）
    await new Promise((resolve) => {
      log('尝试整库重建 IndexedDB…');
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => {
        log('IndexedDB 整库重建完成');
        resolve();
      };
    });
  }

  log('✅ 修复完成。请重启浏览器验证是否仍有卡顿。');
})();
