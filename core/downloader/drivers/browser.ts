/**
 * Browser 下载器（替代旧 common.js downloadsByBrowser / API.Utils.downloadByBrowser）
 * content script 无 chrome.downloads 权限，统一委托 background 转发：
 *   - submit：background 调用 chrome.downloads.download，返回 downloadId
 *   - pause/resume/cancel：background 转发 download_pause/cancel/resume
 * 进度由 background 监听 chrome.downloads.onChanged 后广播
 *   browser_dl_created / browser_dl_progress，DM 侧直接更新任务（见 manager.ts）。
 */

import { BG_MSG } from '../../shared/messages';
import type { DownloadDriver, DownloadRequest, ProgressReporter } from './types';

function runtimeSend<T = any>(message: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
    const chromeAny = (globalThis as any).chrome;
    if (!chromeAny?.runtime?.sendMessage) {
        return Promise.reject(new Error('无 chrome.runtime 通道'));
    }
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true;
                reject(new Error('background 转发超时'));
            }
        }, timeoutMs);
        try {
            chromeAny.runtime.sendMessage(message, (resp: any) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (chromeAny.runtime?.lastError) {
                    reject(new Error(String(chromeAny.runtime.lastError?.message || 'runtime error')));
                    return;
                }
                resolve(resp as T);
            });
        } catch (e) {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(e instanceof Error ? e : new Error(String(e)));
            }
        }
    });
}

/** 把文件名清洗成下载器安全形式（等价于旧 API.Utils.illegalFilter 的精简版） */
function safeFileName(name: string): string {
    return (name || 'file')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .slice(0, 200);
}

/**
 * 清洗目录段：Windows 下含 : * ? " < > | 或以 . / 空格结尾的路径段会让
 * chrome.downloads 直接判定文件名非法 → 回退到默认名并落到下载根目录。
 */
function safeDirSegment(seg: string): string {
    return seg
        // 控制字符（\u0000-\u001f）为有意清洗项，禁用该规则
        // eslint-disable-next-line no-control-regex
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
        .replace(/^\.+$/, '_')
        .trim()
        .replace(/[. ]+$/, '')
        .slice(0, 120);
}

/** 拼出相对下载目录的完整路径（各段单独清洗，空段丢弃） */
function buildRelativePath(rootFolderName: string | undefined, dir: string | undefined, name: string): string {
    const segments: string[] = [];
    for (const part of [rootFolderName || '', dir || '']) {
        for (const seg of String(part).replace(/\\/g, '/').split('/')) {
            const safe = safeDirSegment(seg);
            if (safe) segments.push(safe);
        }
    }
    segments.push(safeFileName(name));
    return segments.join('/');
}

export class BrowserDriver implements DownloadDriver {
    readonly type = 'browser' as const;

    async submit(req: DownloadRequest, reporter: ProgressReporter): Promise<{ trackerId?: number; error?: string }> {
        const filename = buildRelativePath(req.rootFolderName, req.dir, req.name);
        try {
            const resp: any = await runtimeSend({
                from: 'content',
                type: BG_MSG.DOWNLOAD_BROWSER,
                url: req.url,
                filename,
            });
            if (resp && resp.ok && typeof resp.downloadId === 'number' && resp.downloadId > 0) {
                // chrome.downloads.download 成功返回 downloadId，即代表该下载项已处于 in_progress。
                // Chrome 的 downloads.onChanged delta 只有在进入 complete/interrupted 时才携带 state，
                // 下载途中的帧仅有 bytesReceived。若此处不主动上报状态，任务会一直停留在 pending：
                //   → 概览「正在下载（Top 3）」与媒体页签「进行中」筛选恒为空
                //   → DM.upsert 只在 state==='in_progress' 时计算速度，导致速度/ETA 恒为 0
                try { reporter.onState?.('in_progress'); } catch { /* ignore */ }
                return { trackerId: resp.downloadId };
            }
            return { error: (resp && resp.message) || '下载器未返回 downloadId' };
        } catch (e) {
            return { error: e instanceof Error ? e.message : String(e) };
        }
    }

    async pause(trackerId: number | string): Promise<void> {
        await runtimeSend({ from: 'content', type: BG_MSG.DOWNLOAD_PAUSE, downloadId: Number(trackerId) });
    }

    async resume(trackerId: number | string): Promise<void> {
        await runtimeSend({ from: 'content', type: BG_MSG.DOWNLOAD_RESUME, downloadId: Number(trackerId) });
    }

    async cancel(trackerId: number | string): Promise<void> {
        await runtimeSend({ from: 'content', type: BG_MSG.DOWNLOAD_CANCEL, downloadId: Number(trackerId) });
    }
}
