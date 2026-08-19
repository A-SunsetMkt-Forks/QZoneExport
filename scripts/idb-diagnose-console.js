/**
 * QZoneExport 浏览器卡死增强诊断脚本
 *
 * 用法：在扩展的 DevTools Console（背景页/Service Worker 或 content script 所在页面）中粘贴执行。
 * 覆盖：IndexedDB + 内存态 DownloadManager + DOM + 内存 + 主线程响应。
 *
 * 注意：
 *   - 在 QQ 空间页面的 Console 中运行（content script 共享该页面的 window）
 *   - 若在 background Service Worker 的 Console 中运行，部分 DOM/内存 API 不可用（已做兼容）
 */

(async () => {
    'use strict';

    const DB_NAME = 'qzone-export';
    const STORE_TASKS = 'tasks';
    const INDEX_TASKS_UIN = 'uin';

    /* ===== 工具函数 ===== */
    function fmt(n) { return n != null ? Number(n).toLocaleString('zh-CN') : '?'; }
    function fmtBytes(bytes) {
        if (!bytes || bytes < 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
        return bytes.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
    }
    function section(title) { console.log(`\n%c${title}`, 'color:#03a9f4;font-weight:bold;font-size:13px'); }
    function ok(label, val) { console.log(`%c  ✓ ${label}`, 'color:#4caf50', val); }
    function warn(label, val) { console.log(`%c  ⚠ ${label}`, 'color:#ff9800', val); }
    function fail(label, val) { console.log(`%c  ✗ ${label}`, 'color:#f44336', val); }

    /* ========== 1. IndexedDB 存储层 ========== */
    section('【1】IndexedDB 存储层');
    try {
        const openReq = indexedDB.open(DB_NAME);
        const db = await new Promise((resolve, reject) => {
            openReq.onsuccess = () => resolve(openReq.result);
            openReq.onerror = () => reject(openReq.error);
            openReq.onupgradeneeded = (e) => { e.target.transaction.abort(); reject(new Error('版本不匹配')); };
        });
        const storeNames = Array.from(db.objectStoreNames);
        console.log(`  DB: ${db.name} v${db.version} | stores: ${storeNames.join(', ')}`);

        const counts = {};
        await Promise.all(storeNames.map(name => new Promise(resolve => {
            const tx = db.transaction(name, 'readonly');
            const req = tx.objectStore(name).count();
            req.onsuccess = () => { counts[name] = req.result; resolve(); };
            req.onerror = () => { counts[name] = 'err'; resolve(); };
        })));
        for (const [name, c] of Object.entries(counts)) {
            const icon = c === 0 ? '✓' : (c > 1000 ? '✗' : '⚠');
            console.log(`  ${icon} ${name}: ${fmt(c)} 条`);
        }

        // tasks 按 state 分组
        if (storeNames.includes(STORE_TASKS) && counts[STORE_TASKS] > 0) {
            const tx = db.transaction(STORE_TASKS, 'readonly');
            const all = await new Promise(r => { const q = tx.store.getAll(); q.onsuccess = () => r(q.result || []); q.onerror = () => r([]); });
            const byState = {};
            for (const t of all) { const s = (t && t.state) || '(空)'; byState[s] = (byState[s] || 0) + 1; }
            console.log('  tasks 按状态:'); console.table(byState);
        } else {
            ok('tasks store 为空（clearAllGlobal 已生效）');
        }
        db.close();
    } catch (e) {
        fail('IndexedDB 检查失败', e);
    }

    /* ========== 2. 内存态 DownloadManager（核心！IndexedDB 清了但内存可能没清）========== */
    section('【2】内存态 DownloadManager（关键排查点）');
    try {
        const dm = (typeof window !== 'undefined' ? window.QZoneDownloadManager : undefined);
        if (!dm || typeof dm !== 'object') {
            warn('DownloadManager 不存在', '可能尚未开始备份，或不在正确的上下文中运行（需在 QQ 空间页面 Console）');
        } else {
            // 尝试读取内部 Map 大小（通过公开方法推断）
            const stats = typeof dm.stats === 'function' ? dm.stats() : null;
            if (stats) {
                const total = stats.total || 0;
                const level = total === 0 ? 'ok' : (total > 500 ? 'fail' : 'warn');
                const fn = level === 'ok' ? ok : (level === 'warn' ? warn : fail);
                fn(`内存态任务总数: ${fmt(total)}`, `pending=${stats.pending||0} in_progress=${stats.in_progress||0} complete=${stats.complete||0} interrupted=${stats.interrupted||0} paused=${stats.paused||0}`);
                if (total > 1000) fail('⚠️ 内存任务数过大！这是本次卡头的首要嫌疑', '即使 IndexedDB 已清，内存 Map 从不 shrink。多次备份或单次大量媒体会持续累积。');

                // globalProgress 也遍历全量任务，用于确认
                const gp = typeof dm.globalProgress === 'function' ? dm.globalProgress() : null;
                if (gp) {
                    console.log(`  globalProgress: overallPercent=${gp.overallPercent?.toFixed(1)||'?'}% | settled=${gp.settled||0}/${gp.totalTasks||0} | isSettled=${!!gp.isSettled}`);
                    console.log(`  总字节: downloaded=${fmtBytes(gp.downloadedBytes)} / total=${fmtBytes(gp.totalBytes)} | speed=${fmtBytes(gp.speedBps)}/s`);
                }
            } else {
                warn('无法读取 stats()', 'DM 存在但 stats 方法不可用');
            }

            // 日志缓冲区大小
            const logs = typeof dm.logs === 'function' ? dm.logs() : null;
            if (Array.isArray(logs)) {
                const icon = logs.length < 5000 ? '✓' : (logs.length < 10000 ? '⚠' : '✗');
                console.log(`  ${icon} 日志缓冲: ${fmt(logs.entries?.length || logs.length)} 条${logs.length > 8000 ? '（接近上限，检查是否有日志泄漏）' : ''}`);
            }
        }
    } catch (e) {
        fail('DM 检查异常', e);
    }

    /* ========== 3. DOM 节点统计（检测 DOM 泄漏/膨胀）========== */
    section('【3】DOM 节点统计');
    if (typeof document !== 'undefined') {
        try {
            const allNodes = document.querySelectorAll('*');
            const totalNodes = allNodes.length;
            const panelHost = document.querySelector('.qz-backup-host') || document.querySelector('[class*="backup-panel"]') || document.querySelector('#qz-backup-panel-root');

            ok(`页面总节点数: ${fmt(totalNodes)}`, totalNodes > 20000 ? '偏高' : '正常范围');

            if (panelHost) {
                const panelNodes = panelHost.querySelectorAll('*').length;
                const level = panelNodes > 5000 ? 'fail' : (panelNodes > 2000 ? 'warn' : 'ok');
                const fn = level === 'ok' ? ok : (level === 'warn' ? warn : fail);
                fn(`备份面板节点: ${fmt(panelNodes)}`, panelNodes > 3000 ? '面板 DOM 过大，可能有行泄漏（已完成的任务行未移除？）' : '');
            } else {
                warn('未找到备份面板 host', '面板可能未打开或选择器变了');
            }

            // 表格行数（媒体列表）
            const tbody = document.querySelector('.media-tbody, #media-tbody, tbody[data-media]');
            if (tbody) {
                const rows = tbody.querySelectorAll('tr').length;
                console.log(`  媒体表格行数: ${fmt(rows)}`);
            }

            // Shadow DOM 检测
            const shadowHosts = document.querySelectorAll('*');
            let shadowCount = 0;
            shadowHosts.forEach(el => { if (el.shadowRoot) shadowCount++; });
            if (shadowCount > 0) console.log(`  Shadow DOM hosts: ${shadowCount}`);
        } catch (e) {
            fail('DOM 统计异常', e);
        }
    } else {
        console.log('  （不可用：非 DOM 上下文）');
    }

    /* ========== 4. JavaScript 堆内存 ========== */
    section('【4】JavaScript 堆内存');
    if (typeof performance !== 'undefined' && performance.memory) {
        const m = performance.memory;
        ok(`JS 堆: ${fmtBytes(m.usedJSHeapSize)} / ${fmtBytes(m.totalJSHeapSize)} (限制 ${fmtBytes(m.jsHeapSizeLimit)})`);
        const ratio = m.usedJSHeapSize / m.jsHeapSizeLimit;
        if (ratio > 0.8) fail('堆内存使用超过 80% 极限！', '接近崩溃阈值，浏览器可能强制 GC 或直接 OOM 杀进程');
        else if (ratio > 0.5) warn('堆内存使用超过 50%', '偏高风险');
        else ok('堆内存健康', `${(ratio * 100).toFixed(1)}%`);
    } else if (typeof performance !== 'undefined') {
        warn('performance.memory 不可用', '需要在 Chrome 启动参数加 --enable-precise-memory-info 才能看到精确值');
    } else {
        console.log('  （不可用）');
    }

    /* ========== 5. 主线程响应性检测 ========== */
    section('【5】主线程响应性');
    try {
        const t0 = performance.now();
        await new Promise(r => setTimeout(r, 0));
        const t1 = performance.now();
        const macrotaskDelay = t1 - t0;

        // 微任务延迟
        const t2 = performance.now();
        await Promise.resolve();
        const t3 = performance.now();
        const microDelay = t3 - t2;

        ok(`setTimeout(0) 延迟: ${macrotaskDelay.toFixed(2)}ms`, macrotaskDelay > 100 ? '主线程严重阻塞！' : macrotaskDelay > 20 ? '有轻微阻塞' : '正常');
        ok(`Promise.resolve().then() 延迟: ${microDelay.toFixed(2)}ms`, microDelay > 50 ? '微任务队列阻塞' : '正常');

        // 连续采样检测是否周期性卡顿
        const samples = [];
        for (let i = 0; i < 5; i++) {
            const s = performance.now();
            await new Promise(r => setTimeout(r, 0));
            samples.push(performance.now() - s);
        }
        const maxSample = Math.max(...samples);
        const avgSample = samples.reduce((a, b) => a + b, 0) / samples.length;
        console.log(`  连续 5 次 setTimeout(0): avg=${avgSample.toFixed(2)}ms max=${maxSample.toFixed(2)}ms ${maxSample > 200 ? '⚠️ 有严重帧级阻塞' : ''}`);
    } catch (e) {
        fail('响应性检测异常', e);
    }

    /* ========== 6. 定时器与事件监听器粗估 ========== */
    section('【6】定时器 / 事件监听器（粗估）');
    if (typeof document !== 'undefined') {
        // 通过 getEventListenerCount 或 getEventListeners（仅 Chrome DevTools 可用）
        try {
            // 粗略估算：检查关键元素的事件监听
            const el = document.querySelector('.qz-backup-host') || document.body;
            if (el && typeof getEventListeners === 'function') {
                const listeners = getEventListeners(el);
                let total = 0;
                for (const [type, arr] of Object.entries(listeners)) {
                    if (Array.isArray(arr) && arr.length > 0) {
                        total += arr.length;
                        if (arr.length > 5) console.log(`  ${type}: ${arr.length} 个监听器`);
                    }
                }
                console.log(`  备份面板事件监听器总计约: ${total}`);
            } else {
                console.log('  （getEventListeners 不可用，仅在 DevTools Console 中可用）');
            }
        } catch (e) {
            console.log('  （事件监听器检测跳过）');
        }
    }

    /* ========== 7. 总结与建议 ========== */
    section('【7】诊断总结与建议');
    console.log('%c请将以上完整输出截图/复制发给开发者分析', 'color:#666;font-style:italic');
    console.log('%c重点关注的指标（按优先级）:', 'font-weight:bold');
    console.log('  1. 【2】内存态任务总数 — 若 >1000 且 IndexedDB=0，说明内存泄漏（dm.clear() 未调用）');
    console.log('  2. 【4】堆内存 — 若 >80% 极限，接近 OOM');
    console.log('  3. 【5】主线程延迟 — 若 setTimeout(0)>100ms，说明有同步阻塞');
    console.log('  4. 【3】面板 DOM 节点 — 若 >3000，可能有渲染泄漏');
})();
