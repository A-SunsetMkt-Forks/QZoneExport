import { openDB, type IDBPDatabase } from 'idb';

/**
 * 扩展统一IndexedDB
 * v1：曾用 `backedup` store 存备份历史（替代 chrome.storage.local 的 Backedup 单键），
 *     后整体迁至 chrome.storage.local 分键 BackupDb，该 store 已移除。
 * v2：checkpoint（单次备份断点）、staging（采集数据暂存）、tasks（下载任务清单）
 * v3：tasks 由「单 key 存一个大数组」改为「以 task.id 为 key 逐条存储 + uin 索引」，
 *     避免每次单任务更新都重写整个任务数组（媒体任务成千上万时的性能瓶颈）。
 */
export const DB_NAME = 'qzone-export';
export const DB_VERSION = 3;

export const STORE_CHECKPOINT = 'checkpoint';
export const STORE_STAGING = 'staging';
export const STORE_TASKS = 'tasks';

/** tasks 库的索引名：按 uin 查询 */
export const INDEX_TASKS_UIN = 'uin';

export function openQzoneDb(): Promise<IDBPDatabase> {
    return openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_CHECKPOINT)) {
                db.createObjectStore(STORE_CHECKPOINT);
            }
            if (!db.objectStoreNames.contains(STORE_STAGING)) {
                db.createObjectStore(STORE_STAGING);
            }
            if (db.objectStoreNames.contains(STORE_TASKS)) {
                // 旧版本 tasks 是单 key 大数组模型，无法增量存储，直接重建为任务级存储
                db.deleteObjectStore(STORE_TASKS);
            }
            const tasksStore = db.createObjectStore(STORE_TASKS, { keyPath: 'id' });
            tasksStore.createIndex(INDEX_TASKS_UIN, 'uin', { unique: false });
        },
    });
}
