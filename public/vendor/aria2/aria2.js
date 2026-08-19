/**
 * Aria2 JSON-RPC 轻量客户端（兼容 sonnyp/aria2.js 的常用子集）
 * - 支持 HTTP POST JSON-RPC 与 WebSocket 订阅
 * - 用法：const aria2 = new Aria2({ host: 'localhost', port: 6800, token: 'xxx', secure: false });
 * - 挂载到 window.Aria2，供 content / background / offscreen 直接使用
 *
 * 为什么不直接用 sonnyp/aria2.js npm 包：
 *   1. MV3 content_scripts 走 WXT publicDir 静态拷贝，不方便 import ES 模块
 *   2. 我们只用到 addUri / tellStatus / pause / unpause / removeDownloadResult 以及
 *      onDownloadStart/Pause/Stop/Complete 事件，500 行手写足够，体积小可控
 *
 * @author QZoneExport
 */
(function (global) {
    'use strict';

    const DEFAULT_OPTS = {
        host: 'localhost',
        port: 6800,
        secure: false,
        path: '/jsonrpc',
        token: '',
        timeout: 10_000,
    };

    function buildHttpUrl(opts) {
        const scheme = opts.secure ? 'https' : 'http';
        return `${scheme}://${opts.host}:${opts.port}${opts.path}`;
    }
    function buildWsUrl(opts) {
        const scheme = opts.secure ? 'wss' : 'ws';
        return `${scheme}://${opts.host}:${opts.port}${opts.path}`;
    }
    function uid() {
        return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    }

    class Aria2 {
        constructor(options = {}) {
            this.opts = Object.assign({}, DEFAULT_OPTS, options);
            this._ws = null;
            this._wsOpen = false;
            this._pending = new Map(); // requestId -> { resolve, reject, timer }
            this._listeners = new Map(); // eventName -> Set<fn>
            this._msgId = 0;
        }

        /* ========== HTTP JSON-RPC ========== */

        /**
         * 通用方法调用（HTTP POST）
         * @param {string} method 方法名（自动拼 "aria2." 前缀，如 "addUri" → "aria2.addUri"）
         * @param  {...any} params
         * @returns {Promise<any>}
         */
        async call(method, ...params) {
            const realMethod = /^aria2\./.test(method) ? method : `aria2.${method}`;
            const reqId = ++this._msgId;
            const body = {
                jsonrpc: '2.0',
                id: String(reqId),
                method: realMethod,
                params: this.opts.token ? [`token:${this.opts.token}`, ...params] : params,
            };
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.opts.timeout);
            let res;
            try {
                res = await fetch(buildHttpUrl(this.opts), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: controller.signal,
                });
            } finally {
                clearTimeout(timer);
            }
            if (!res.ok) {
                throw new Error(`Aria2 HTTP ${res.status}: ${res.statusText}`);
            }
            const json = await res.json();
            if (json.error) {
                const err = new Error(json.error.message || String(json.error));
                err.code = json.error.code;
                throw err;
            }
            return json.result;
        }

        /* 常用便捷方法（签名对齐 aria2.js） */
        addUri(uris, options = {}, position = null) {
            const urisArr = Array.isArray(uris) ? uris : [uris];
            const args = [urisArr];
            if (Object.keys(options).length > 0) args.push(options);
            if (position != null) args.push(position);
            return this.call('addUri', ...args);
        }
        tellStatus(gid, keys = null) {
            const args = [gid];
            if (keys) args.push(keys);
            return this.call('tellStatus', ...args);
        }
        tellActive() { return this.call('tellActive'); }
        tellWaiting(offset = 0, num = 1000) { return this.call('tellWaiting', offset, num); }
        tellStopped(offset = 0, num = 1000) { return this.call('tellStopped', offset, num); }
        pause(gid) { return this.call('pause', gid); }
        pauseAll() { return this.call('pauseAll'); }
        unpause(gid) { return this.call('unpause', gid); }
        unpauseAll() { return this.call('unpauseAll'); }
        remove(gid) { return this.call('remove', gid); }
        removeDownloadResult(gid) { return this.call('removeDownloadResult', gid); }
        forceRemove(gid) { return this.call('forceRemove', gid); }
        getVersion() { return this.call('getVersion'); }
        getGlobalStat() { return this.call('getGlobalStat'); }

        /* ========== WebSocket 事件订阅 ========== */

        async openWebSocket() {
            if (this._ws && (this._wsOpen || this._ws.readyState === WebSocket.CONNECTING)) {
                return;
            }
            return new Promise((resolve, reject) => {
                let settled = false;
                try {
                    this._ws = new WebSocket(buildWsUrl(this.opts));
                } catch (e) {
                    reject(e);
                    return;
                }
                const timer = setTimeout(() => {
                    if (!settled) {
                        settled = true;
                        reject(new Error('Aria2 WebSocket 连接超时'));
                    }
                }, this.opts.timeout);

                this._ws.onopen = () => {
                    this._wsOpen = true;
                    if (!settled) { settled = true; clearTimeout(timer); resolve(); }
                };
                this._ws.onerror = (e) => {
                    if (!settled) { settled = true; clearTimeout(timer); reject(e); }
                    this._emit('ws-error', e);
                };
                this._ws.onclose = () => {
                    this._wsOpen = false;
                    this._ws = null;
                    for (const { reject } of this._pending.values()) {
                        reject(new Error('Aria2 WebSocket 已关闭'));
                    }
                    this._pending.clear();
                    this._emit('ws-close');
                };
                this._ws.onmessage = (ev) => this._onWsMessage(ev);
            });
        }

        closeWebSocket() {
            if (this._ws) {
                try { this._ws.close(); } catch (_) { /* ignore */ }
                this._ws = null;
                this._wsOpen = false;
            }
        }

        /** 通过 WebSocket 发送请求（相比 HTTP 更稳更快，连接建立后优先用） */
        callWs(method, ...params) {
            if (!this._ws || !this._wsOpen) {
                // 退化为 HTTP
                return this.call(method, ...params);
            }
            const realMethod = /^aria2\./.test(method) ? method : `aria2.${method}`;
            const reqId = uid();
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    this._pending.delete(reqId);
                    reject(new Error(`Aria2 WS 超时: ${realMethod}`));
                }, this.opts.timeout);
                this._pending.set(reqId, { resolve, reject, timer });
                try {
                    this._ws.send(JSON.stringify({
                        jsonrpc: '2.0',
                        id: reqId,
                        method: realMethod,
                        params: this.opts.token ? [`token:${this.opts.token}`, ...params] : params,
                    }));
                } catch (e) {
                    this._pending.delete(reqId);
                    clearTimeout(timer);
                    reject(e);
                }
            });
        }

        _onWsMessage(ev) {
            let msg;
            try { msg = JSON.parse(ev.data); }
            catch { return; }
            // 1) 对应用户请求：id 存在
            if (msg.id && this._pending.has(msg.id)) {
                const { resolve, reject, timer } = this._pending.get(msg.id);
                this._pending.delete(msg.id);
                clearTimeout(timer);
                if (msg.error) {
                    const err = new Error(msg.error.message || String(msg.error));
                    err.code = msg.error.code;
                    reject(err);
                } else {
                    resolve(msg.result);
                }
                return;
            }
            // 2) 服务端推送事件：method 以 "aria2.on" 开头，params[0].gid
            if (msg.method && /^aria2\.on/.test(msg.method)) {
                const eventName = msg.method.replace('aria2.', '');
                const gid = msg.params && msg.params[0] && msg.params[0].gid;
                this._emit(eventName, gid, msg.params && msg.params[0]);
                return;
            }
        }

        /* ========== 事件 ========== */
        on(eventName, fn) {
            if (!this._listeners.has(eventName)) this._listeners.set(eventName, new Set());
            this._listeners.get(eventName).add(fn);
            return () => this.off(eventName, fn);
        }
        off(eventName, fn) {
            if (!this._listeners.has(eventName)) return;
            this._listeners.get(eventName).delete(fn);
        }
        once(eventName, fn) {
            const off = this.on(eventName, (...args) => {
                off();
                fn(...args);
            });
            return off;
        }
        _emit(eventName, ...args) {
            const set = this._listeners.get(eventName);
            if (!set) return;
            for (const fn of set) {
                try { fn(...args); }
                catch (e) { console.error('[Aria2] listener error:', eventName, e); }
            }
        }
    }

    // 兼容 Node（测试用）与浏览器（挂 window）
    if (typeof module !== 'undefined' && module.exports) module.exports = Aria2;
    else global.Aria2 = Aria2;
})(typeof window !== 'undefined' ? window : globalThis);
