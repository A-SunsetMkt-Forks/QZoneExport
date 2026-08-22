/**
 * Aria2 下载器（替代旧 common.js downloadByAria2）
 * 通过 Aria2 JSON-RPC（HTTP）提交下载，进度由 Aria2 主动通知或轮询获取。
 * 配置来自 options（aria2Host / aria2Token / aria2Dir）。
 */

import type { DownloadDriver, DownloadRequest, ProgressReporter } from './types';

export interface Aria2Config {
    host: string; // 如 http://127.0.0.1:6800/jsonrpc
    token?: string;
    dir?: string;
}

export class Aria2Driver implements DownloadDriver {
    readonly type = 'aria2' as const;
    private readonly config: Aria2Config;

    constructor(config: Aria2Config) {
        this.config = config;
    }

    private async call(method: string, params: unknown[]): Promise<any> {
        const body: Record<string, unknown> = {
            jsonrpc: '2.0',
            id: 'qzone-export',
            method,
            params: this.config.token ? [`token:${this.config.token}`, ...params] : params,
        };
        // Aria2 RPC 经 background service worker 代理：content script (qzone.qq.com HTTPS)
        // 直接 fetch HTTP 非 localhost 地址会被 Mixed Content 拦截。background 持有
        // host_permissions ['<all_urls>']，可无限制发起任意协议请求。
        try {
            const resp = await chrome.runtime.sendMessage({
                from: 'content',
                type: 'aria2_rpc',
                host: this.config.host,
                body: JSON.stringify(body),
            });
            if (!resp?.ok) {
                throw new Error(resp?.error || `Aria2 RPC HTTP ${resp?.status || 'unknown'}`);
            }
            if (resp.data?.error) {
                throw new Error(`Aria2 error: ${resp.data.error.message || JSON.stringify(resp.data.error)}`);
            }
            return resp.data?.result;
        } catch (e) {
            // 如果 background 不可达（如 SW 休眠），回退直连
            if ((e as Error).message?.includes('Could not establish connection')
                || (e as Error).message?.includes('Extension context invalidated')) {
                const resp = await fetch(this.config.host, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                if (!resp.ok) throw new Error(`Aria2 RPC HTTP ${resp.status}`, { cause: e });
                const json: any = await resp.json();
                if (json.error) throw new Error(`Aria2 error: ${json.error.message || JSON.stringify(json.error)}`, { cause: e });
                return json.result;
            }
            throw e;
        }
    }

    async submit(req: DownloadRequest, reporter: ProgressReporter): Promise<{ trackerId?: string; error?: string }> {
        try {
            const options: Record<string, unknown> = {};
            if (this.config.dir) {
                options.dir = this.config.dir.replace(/\/$/, '');
            }
            const dirParts: string[] = [];
            if (req.rootFolderName) dirParts.push(req.rootFolderName.replace(/\/$/, ''));
            if (req.dir) dirParts.push(req.dir.replace(/\/$/, ''));
            if (dirParts.length) {
                const sub = dirParts.join('/').replace(/\\/g, '/');
                options.dir = options.dir ? options.dir + '/' + sub : sub;
            }
            if (req.name) {
                options.out = req.name;
            }
            // V2 兼容：QQ 空间媒体服务器要求 Referer 校验，缺失返回 403/拒绝下载。
            // Motrix Next 的原生 RPC 路径严格按调用方传入参数创建任务，不会自动注入
            // User-Agent / Referer / Cookie → 全走「顶层选项 + header 数组」双保险策略。
            options.referer = 'https://user.qzone.qq.com/';
            let ua = '';
            try {
                ua = (typeof navigator !== 'undefined' && navigator.userAgent)
                    || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
            } catch { /* no navigator, skip */ }
            if (ua) options['user-agent'] = ua;
            let ck = '';
            try { ck = document?.cookie || ''; } catch { /* not in content script */ }
            if (ck) options['cookie'] = ck;
            const headers: string[] = [];
            if (ua) headers.push(`User-Agent: ${ua}`);
            headers.push('Referer: https://user.qzone.qq.com/');
            if (ck) headers.push(`Cookie: ${ck}`);
            options.header = headers;
            const gid: string = await this.call('aria2.addUri', [[req.url], options]);
            // 轻量轮询进度（Aria2 未启用 onDownloadComplete 推送时的兜底）
            let consecutiveFail = 0; // 跨 tick 累计：RPC 连接中断时持续 reject，用于自清理定时器
            const timer = setInterval(async () => {
                try {
                    const status: any = await this.call('aria2.tellStatus', [gid, ['totalLength', 'completedLength', 'status']]);
                    consecutiveFail = 0; // 成功即重置计数
                    const total = Number(status.totalLength) || 0;
                    const completed = Number(status.completedLength) || 0;
                    // 始终上报进度：即便 totalLength 尚未就绪（如流媒体不回报 Content-Length、
                    // aria2 延迟回报），也更新已下载字节，让管理器基于字节变化自算速度并显示
                    // 「下载中」。原 `if (total > 0)` 守卫会导致总大小未知时完全不刷新，表现为
                    // 速度/进度/总大小三者皆无。
                    reporter.onProgress?.(completed, total);
                    if (status.status === 'complete') {
                        clearInterval(timer);
                        reporter.onState?.('complete');
                    } else if (status.status === 'error' || status.status === 'removed') {
                        clearInterval(timer);
                        reporter.onState?.('interrupted', status.errorMessage || 'aria2 错误');
                    }
                } catch {
                    // F12: RPC 连接中断时 tellStatus 持续 reject，catch 吞掉会导致定时器永久
                    // 空转且 GID 定时器泄漏。累计连续失败超阈值即自清理，避免泄漏。
                    consecutiveFail++;
                    if (consecutiveFail >= 5) {
                        clearInterval(timer);
                        const timers = (this as any)._timers as Map<string, ReturnType<typeof setInterval>> | undefined;
                        timers?.delete(gid);
                        reporter.onState?.('interrupted', 'aria2 连接中断，轮询失败');
                    }
                }
            }, 1000);
            // 防止 timer 永不清理：DM 完成时负责 clear
            (this as any)._timers = (this as any)._timers || new Map<string, ReturnType<typeof setInterval>>();
            (this as any)._timers.set(gid, timer);
            return { trackerId: gid };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    async pause(trackerId: number | string): Promise<void> {
        await this.call('aria2.pause', [String(trackerId)]);
    }

    async resume(trackerId: number | string): Promise<void> {
        await this.call('aria2.unpause', [String(trackerId)]);
    }

    async cancel(trackerId: number | string): Promise<void> {
        await this.call('aria2.remove', [String(trackerId)]);
        const timers = (this as any)._timers as Map<string, ReturnType<typeof setInterval>> | undefined;
        const t = timers?.get(String(trackerId));
        if (t) {
            clearInterval(t);
            timers?.delete(String(trackerId));
        }
    }
}
