// 统计 QZoneExport 扩展 IndexedDB（库名 qzone-export，当前版本 3）各 store 条目数
// 用途：排查「浏览器卡死」—— 早期根因是 tasks store 累积成千上万条媒体任务未清理。
// 运行方式：打开扩展的 DevTools（background 页 / 任意扩展页面）→ Console → 粘贴整段执行。
// 说明：indexedDB.open 不指定版本，仅打开已存在的库，避免误触发 upgrade 重建结构。

(async () => {
    const DB_NAME = 'qzone-export';
    const STORE_TASKS = 'tasks';

    const openReq = indexedDB.open(DB_NAME);
    const db = await new Promise((resolve, reject) => {
        openReq.onsuccess = () => resolve(openReq.result);
        openReq.onerror = () => reject(openReq.error);
        openReq.onupgradeneeded = (e) => {
            // 若本地库版本与当前代码 DB_VERSION 不一致会触发升级，这里主动中止以防误改结构
            e.target.transaction.abort();
            reject(new Error('版本不匹配：不指定版本打开却触发了 upgrade，已中止（请改用本机实际版本号）'));
        };
    });

    const storeNames = Array.from(db.objectStoreNames);
    console.log(`DB: ${db.name}  version: ${db.version}`);
    console.log('objectStores:', storeNames.join(', '));

    // 1) 各 store 总条目数
    const counts = {};
    await Promise.all(storeNames.map((name) => new Promise((resolve) => {
        const tx = db.transaction(name, 'readonly');
        const req = tx.objectStore(name).count();
        req.onsuccess = () => { counts[name] = req.result; resolve(); };
        req.onerror = () => { counts[name] = 'err:' + req.error; resolve(); };
    })));
    console.log('\n【各 store 条目数】');
    console.table(counts);

    // 2) tasks 按 uin 与 state 分组（卡死主因：媒体任务累积）
    if (storeNames.includes(STORE_TASKS)) {
        const tx = db.transaction(STORE_TASKS, 'readonly');
        const all = await new Promise((resolve) => {
            const r = tx.objectStore(STORE_TASKS).getAll();
            r.onsuccess = () => resolve(r.result || []);
            r.onerror = () => resolve([]);
        });
        const byUin = {};
        const byState = {};
        for (const t of all) {
            const u = (t && t.uin) ?? '(未知)';
            const s = (t && t.state) ?? '(未知)';
            byUin[u] = (byUin[u] || 0) + 1;
            byState[s] = (byState[s] || 0) + 1;
        }
        console.log(`\n【tasks 总计】${all.length}`);
        console.log('按 uin:'); console.table(byUin);
        console.log('按 state:'); console.table(byState);
    }

    db.close();
    console.log('\n完成。如 tasks 数量过大（成千上万），即为卡死元凶。');
})();
