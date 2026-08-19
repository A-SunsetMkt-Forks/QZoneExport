// 清理 QZoneExport 扩展 IndexedDB（库名 qzone-export，当前版本 3）中的任务 / store 记录
// 用途：排查「浏览器卡死」复发时，手动清空累积的下载任务记录。
// 运行方式：扩展 DevTools（background / Service Worker 的「检查」→ Console）→ 粘贴整段执行。
// 说明：indexedDB.open 不指定版本，仅打开已存在的库，避免误触发 upgrade 重建结构。
//
// ⚠️ 危险操作提示：
//   - 清 tasks 只是删除「下载任务清单」，不影响已落盘的备份数据。
//   - 清 staging / checkpoint 会丢失「采集暂存 / 断点续传状态」（备份历史现存于
//     chrome.storage.local 分键 BackupDb，不在本 IndexedDB 库），仅在确认需要时使用（默认注释掉）。

(async () => {
    const DB_NAME = 'qzone-export';
    const STORE_TASKS = 'tasks';
    const INDEX_TASKS_UIN = 'uin';

    const openReq = indexedDB.open(DB_NAME);
    const db = await new Promise((resolve, reject) => {
        openReq.onsuccess = () => resolve(openReq.result);
        openReq.onerror = () => reject(openReq.error);
        openReq.onupgradeneeded = (e) => {
            e.target.transaction.abort();   // 版本不符时中止，避免误改结构
            reject(new Error('版本不匹配：不指定版本打开却触发 upgrade，已中止（请改用本机实际版本号）'));
        };
    });

    // 读取 tasks 中所有出现的 uin（去重）
    async function getAllUins() {
        return await new Promise((resolve) => {
            const tx = db.transaction(STORE_TASKS, 'readonly');
            const req = tx.store.index(INDEX_TASKS_UIN).getAllKeys(); // 返回所有 uin 值（含重复）
            req.onsuccess = () => resolve([...new Set(req.result)]);
            req.onerror = () => resolve([]);
        });
    }

    // 清空指定 uin 的全部任务
    async function clearByUin(uin) {
        const tx = db.transaction(STORE_TASKS, 'readwrite');
        const keys = await tx.store.index(INDEX_TASKS_UIN).getAllKeys(uin);
        for (const k of keys) tx.store.delete(k);
        await tx.done;
        return keys.length;
    }

    // 清空所有 uin 的任务（彻底）
    async function clearAllTasks() {
        const tx = db.transaction(STORE_TASKS, 'readwrite');
        const keys = await tx.store.getAllKeys();
        for (const k of keys) tx.store.delete(k);
        await tx.done;
        return keys.length;
    }

    // 清空任意 store（staging / checkpoint 等）
    async function clearStore(name) {
        const tx = db.transaction(name, 'readwrite');
        await tx.store.clear();
        await tx.done;
    }

    // ============ 用法示例（按需取消注释执行）============
    const uins = await getAllUins();
    console.log('tasks 中存在的 uin 列表:', uins);

    // ① 清空【指定 uin】的全部任务：
    // const n = await clearByUin(123456); console.log('已清空 uin=123456 的任务数:', n);

    // ② 清空【所有 uin】的任务（彻底清空 tasks store）：
    // const n = await clearAllTasks(); console.log('已清空全部 tasks 数:', n);

    // ③ 顺带清空其它 store（谨慎！会丢失暂存/断点续传状态，默认关闭）：
    // await clearStore('staging');
    // await clearStore('checkpoint');

    db.close();
    console.log('完成。');
})();
