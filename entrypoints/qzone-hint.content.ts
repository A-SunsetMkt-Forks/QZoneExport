import '../core/shared/polyfill';
import { defineContentScript } from 'wxt/utils/define-content-script';
import {
    MODULES,
    DEFAULT_MEDIA_MODE,
    defaultDownloadTypeFor,
    DEFAULT_EXPORT_TYPE,
    mediaSummaryText,
    readLaunchFlow,
    writeLaunchFlow,
    incrementPinHintDismiss,
    isModulePrivate,
    getPrivateModuleLabels,
    PIN_HINT_AUTO_STOP_THRESHOLD,
    type LaunchPopupBehavior,
} from '../core/shared/backup-options';
import { describeCategory } from '../core/shared/errors';

/**
 * 页面内提示（新版三态机引导）
 *
 * 两个功能共用同一个 Shadow DOM 悬浮容器：
 * 1. 备份确认弹窗（默认态 ask_on_first_visit 弹）
 * 2. 固定图标引导（用户选了「下次不弹出」 → show_pin_hint_only 弹）
 * 3. 公告通知（优先级最低：从 remote-config.json 拉未读公告）
 *
 * 优先级：备份确认弹窗 > 固定图标引导 > 公告。同一时刻最多只显示一个，避免骚扰。
 * Shadow DOM 完全隔离样式，避免与 QQ 空间自身的重样式相互污染。
 */

/* ==================== URL / 环境 检测 ==================== */

const SPACE_RE = /^https:\/\/user\.qzone\.qq\.com\/\d+/;
const SUB_RE = /^https:\/\/\d+\.qzone\.qq\.com\//;

/** 当前是否是「已登录 & 定位到具体空间」的页面（与 popup/background 判断一致） */
function isSpacePage(): boolean {
    return SPACE_RE.test(location.href) || SUB_RE.test(location.href);
}

/* ==================== 通用 Shadow DOM 样式片段 ==================== */

const SHARED_STYLES = `
    @keyframes qz-pop { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
    @keyframes qz-bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
`;

/** 在页面 body 末尾挂载一个新的 Shadow DOM 宿主，返回 shadow 根和卡片挂载点（实际卡片 DOM 放在一个 div 容器里，避免直接操作 shadowRoot） */
function mountShadowHost(id: string, layout: 'top-right' | 'center' = 'top-right', topPx: number = 24): { host: HTMLElement; shadow: HTMLElement } {
    const host = document.createElement('div');
    host.id = id;
    host.style.cssText = `position:fixed;top:0;right:0;z-index:2147483647;pointer-events:none;`;
    const shadowRoot = host.attachShadow({ mode: 'open' });

    // 绝对定位的卡片容器，相对视口，不参与页面布局
    const anchor = document.createElement('div');
    if (layout === 'center') {
        anchor.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;pointer-events:auto;`;
    } else {
        anchor.style.cssText = `position:fixed;top:${topPx}px;right:24px;z-index:2147483647;pointer-events:auto;`;
    }
    shadowRoot.appendChild(anchor);

    if (document.body) document.body.appendChild(host);
    else window.addEventListener('DOMContentLoaded', () => document.body.appendChild(host), { once: true });
    return { host, shadow: anchor };
}

/* ==================== 1. 备份确认弹窗（默认态） ==================== */

interface BackupLaunchContext {
    exportTypes: string[];
    selectedAlbumIds: string[];
    /** 相册枚举（相册选择用，与 popup sendMessage 返回的形状一致） */
    albumList: AlbumItem[];
    /** 当前用户是空间主人还是访客（他人模式下，私有模块置灰） */
    isOwner: boolean;
    /** 显示的「我的空间 / 他的空间 ID」文案 */
    scopeText: string;
    /** 空间主人 uin：用于「日记独立密码」告警里跳转到私密日志设置页 */
    ownerUin: string;
    /** 读取用户配置的导出摘要（若失败则用默认兜底） */
    summary: { mediaText: string; downloadType: string; mediaMode: string; exportText: string };
    /** 勾选了「☐ 下次不弹出」复选框的临时状态 */
    optOutChecked: boolean;
}

/** popup / hint 共用的相册条目形状 */
interface AlbumItem {
    id: string;
    name: string;
    className: string;
    total: number;
}

/** 兜底默认摘要（配置拉取失败时显示），全部由 COMMON_DEFAULTS 派生，不再手写文案 */
const isFirefox = import.meta.env.FIREFOX;
const DEFAULT_SUMMARY: BackupLaunchContext['summary'] = {
    mediaText: mediaSummaryText(DEFAULT_MEDIA_MODE, defaultDownloadTypeFor(isFirefox)),
    downloadType: defaultDownloadTypeFor(isFirefox),
    mediaMode: DEFAULT_MEDIA_MODE,
    exportText: DEFAULT_EXPORT_TYPE,
};

/** 从 storage.local 读取 PreExportTypes（记住上次勾选的模块） */
async function readPreExportTypes(): Promise<string[]> {
    try {
        const data = await chrome.storage.local.get({ PreExportTypes: [] as string[] });
        return Array.isArray(data.PreExportTypes) && data.PreExportTypes.length > 0 ? data.PreExportTypes : MODULES.map(m => m.value);
    } catch {
        return MODULES.map(m => m.value);
    }
}

/** 读取当前的导出配置摘要（仅显示文案，不影响实际值，由 popup 的实际 startBackup 逻辑决定最终值） */
async function readExportSummary(): Promise<BackupLaunchContext['summary']> {
    try {
        const sync = await chrome.storage.sync.get(['Common']);
        const Common = (sync.Common as any) ?? {};
        const rawDt = Common.downloadType ?? defaultDownloadTypeFor(isFirefox);
        // Firefox 形态 B：直写目录(Disk)不可用，历史/Chrome 配置归一化为 Browser
        const downloadType = isFirefox && rawDt === 'Disk' ? 'Browser' : rawDt;
        const mediaMode = Common.mediaMode ?? DEFAULT_MEDIA_MODE;
        return {
            mediaText: mediaSummaryText(mediaMode, downloadType),
            downloadType,
            mediaMode,
            exportText: Common.exportType ?? DEFAULT_EXPORT_TYPE,
        };
    } catch {
        return DEFAULT_SUMMARY;
    }
}

/** content → background 发消息，获取 Owner/Target Uin 数据（判断他人模式 & 范围文案） */
async function fetchUinData(): Promise<{ isOwner: boolean; scopeText: string; ownerUin: string }> {
    try {
        const resp = await chrome.runtime.sendMessage({ from: 'content', type: 'content_init_uin' });
        if (resp?.ok && resp.data) {
            const Owner = resp.data.Owner as any;
            const Target = resp.data.Target as any;
            const isOwner = String(Owner?.uin) === String(Target?.uin);
            const scopeText = isOwner ? '自己的空间' : `${Target?.nickname || Target?.uin || 'TA'} 的空间`;
            return { isOwner, scopeText, ownerUin: String(Owner?.uin ?? '') };
        }
    } catch { /* 忽略，走兜底 */ }
    // 正则中的 \/ 为避免字面量提前结束而必需，非多余转义
    // eslint-disable-next-line no-useless-escape
    const m = location.href.match(/qq\.com[\/:]\/(\d+)/);
    return { isOwner: true, scopeText: m ? `空间 #${m[1]}` : '当前空间', ownerUin: m?.[1] ?? '' };
}

/** content → background 发消息，触发备份开始（background 会向当前 tab 转发 from:'popup' 的 startBackup 消息，完全兼容旧 content.js 引擎） */
async function triggerStartBackup(ctx: BackupLaunchContext): Promise<{ ok: boolean; message?: string }> {
    try {
        // 构造 popup 兼容的 albums 数组（包含 id/name/className/total，旧 content.js startBackup 逻辑直接写 QZone.Common.AlbumSelect = albums）
        const selectedAlbums = ctx.albumList.filter((a) => ctx.selectedAlbumIds.includes(a.id));
        const resp = await chrome.runtime.sendMessage({
            from: 'content',
            type: 'content_start_backup',
            exportType: [...ctx.exportTypes],
            albums: selectedAlbums,
        });
        return resp && resp.ok ? { ok: true } : { ok: false, message: resp?.message || '备份启动失败' };
    } catch (e) {
        return { ok: false, message: String(e) };
    }
}

/**
 * 内容脚本向同标签页的旧 content.js / engine-bridge.content.ts 发 port 消息
 * 完全复用 popup/messaging.ts 的契约：chrome.tabs.connect(tabId, {name:'popup'}) + { from:'popup', subject, ... }
 * content script 本身就在当前标签页，所以取当前 tabId（用 history.length 兼容方式并不对）——
 * 但 MV3 content scripts 不能直接访问 chrome.tabs.query，因此改由 background 桥接：
 *   1) content → runtime.sendMessage({ type: 'content_port_message', message }) 把消息交给 background
 *   2) background 调用 chrome.tabs.connect(sender.tab.id) + postMessage + onMessage 等响应
 *   3) background 把 port.onMessage 首个响应返回给 content
 * 这样 content script 无需 chrome.tabs 权限，和 popup 走完全相同的 subject 通道。
 */
function sendPortMessage<T = unknown>(
    subject: string,
    extra: Record<string, unknown> = {},
    timeoutMs = 10000,
): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`port 消息「${subject}」超时（${timeoutMs}ms）`));
        }, timeoutMs);
        try {
            chrome.runtime.sendMessage(
                {
                    from: 'content',
                    type: 'content_port_message',
                    subject,
                    extra,
                },
                (resp: any) => {
                    clearTimeout(timer);
                    const err = (chrome.runtime as any).lastError;
                    if (err) {
                        console.error('[QZ-DIAG] sendPortMessage runtime error:', subject, err.message);
                        reject(new Error(err.message || 'chrome.runtime 通信失败'));
                        return;
                    }
                    if (resp && resp.ok) {
                        console.log('[QZ-DIAG] sendPortMessage ok:', subject, Array.isArray(resp.data) ? `array(${resp.data.length})` : JSON.stringify(resp.data).slice(0, 160));
                        resolve(resp.data as T);
                    } else {
                        console.warn('[QZ-DIAG] sendPortMessage fail:', subject, resp?.message);
                        reject(new Error(resp?.message || `port 消息「${subject}」失败`));
                    }
                },
            );
        } catch (e) {
            clearTimeout(timer);
            reject(e);
        }
    });
}

const ENGINE_NOT_READY_RE = /引擎尚未就绪|尚未就绪|连接断开|超时/;

/**
 * 直接调用同页采集引擎（window.__QZ_ENGINE__）。
 *
 * 关键修复（360 极速浏览器 X / Chromium 132 等旧内核报
 * “The message port closed before a response was received”）：
 * qzone-hint 与 engine-bridge 同为注入到同一 QQ 空间页面的 content script，
 * 二者共享同一个 window 对象，因此完全可以直接调用引擎方法，
 * 不必经由 background service worker 桥接（background → chrome.tabs.connect → engine-bridge）。
 * 旧桥接在异步等待引擎响应期间依赖 SW 的 Promise 保活；在部分对 SW 生命周期处理更激进的
 * 旧内核上，SW 会在等待期间被终止，导致 qzone-hint 侧的消息通道被关闭、收到上述报错；
 * 而较新的 Chrome / Edge 内核对 Promise 保活更可靠，所以一直正常。
 * 改为直接调用 window 引擎后，彻底绕开 SW，跨内核稳定兼容，且少一跳更快。
 *
 * 仅在 __QZ_ENGINE__ 尚未挂载（弹窗早于 engine-bridge 的 document_idle 加载）或
 * 引擎持续返回“未就绪”时退避重试；全部失败才回退旧 background 桥接（兼容极端环境）。
 */
async function callEngine<T = unknown>(
    engineMethod: 'getAlbumList' | 'probeDiaries',
    portSubject: 'getAlbumList' | 'initDiaries',
    { attempts = 8, interval = 700 }: { attempts?: number; interval?: number } = {},
): Promise<T | { error?: string; code?: number }> {
    let last: { error?: string; code?: number } = { error: '采集引擎尚未就绪' };
    for (let i = 0; i < attempts; i++) {
        const engine = (window as unknown as Record<string, unknown>)['__QZ_ENGINE__'] as
            | Record<string, (...a: unknown[]) => Promise<unknown>>
            | undefined;
        if (engine && typeof engine[engineMethod] === 'function') {
            try {
                const data = await (engine[engineMethod] as () => Promise<unknown>)();
                const asObj = data as { error?: string; code?: number } | null;
                // 引擎已挂载但返回“未就绪”（{code:-1} 或 error 命中未就绪正则）→ 退避重试
                if (asObj && (asObj.code === -1 || (typeof asObj.error === 'string' && ENGINE_NOT_READY_RE.test(asObj.error)))) {
                    last = asObj;
                    if (i < attempts - 1) { await new Promise((r) => setTimeout(r, interval)); continue; }
                    return asObj;
                }
                return data as T;
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                last = { error: msg };
                // 真实接口失败（非未就绪）不重试，直接透传错误
                if (!ENGINE_NOT_READY_RE.test(msg)) return { error: msg };
                if (i < attempts - 1) { await new Promise((r) => setTimeout(r, interval)); continue; }
                return { error: msg };
            }
        }
        // 引擎尚未挂载：退避重试
        if (i < attempts - 1) { await new Promise((r) => setTimeout(r, interval)); }
    }
    // 全部重试仍不可用：回退旧 background 桥接（兼容 engine-bridge 完全未注入的极端环境）
    try {
        return await sendPortMessage<T>(portSubject);
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
}

/** 打开设置页的「公共」Tab：内容脚本无 chrome.tabs 权限，交由 background 创建 tab */
function openOptionsForCustomize(): void {
    try {
        chrome.runtime.sendMessage({ from: 'content', type: 'content_open_options', hash: 'Common' }, () => {
            // 忽略 lastError：openOptionsPage 已在 background 里做兜底
            void (chrome.runtime as any).lastError;
        });
    } catch {
        try { chrome.runtime.openOptionsPage(); } catch { /* ignore */ }
    }
}

/** 打开外部链接：内容脚本无 chrome.tabs 权限，且直接 window.open 易被页面 CSP / 弹窗策略拦截，交由 background 创建 tab */
function openExternalUrl(url: string): void {
    try {
        chrome.runtime.sendMessage({ from: 'content', type: 'content_open_url', url }, () => {
            // 忽略 lastError：background 已做兜底
            void (chrome.runtime as any).lastError;
        });
    } catch {
        try { window.open(url, '_blank', 'noopener'); } catch { /* ignore */ }
    }
}

/** 把「下次不弹出」的勾选写入 storage：切换 show_pin_hint_only 态 */
async function persistOptOutIfChecked(ctx: BackupLaunchContext): Promise<void> {
    if (!ctx.optOutChecked) return;
    try {
        await writeLaunchFlow({
            behavior: 'show_pin_hint_only',
            optedOutAt: Date.now(),
            lastOptOutCheckbox: true,
        });
    } catch { /* ignore */ }
}

/** 构建备份确认弹窗 Shadow DOM（页面居中显示） */
function buildBackupLaunchCard(host: HTMLElement): HTMLElement {
    const ctx: BackupLaunchContext = {
        exportTypes: MODULES.map(m => m.value),
        selectedAlbumIds: [],
        albumList: [],
        isOwner: true,
        scopeText: '当前空间',
        ownerUin: '',
        summary: { ...DEFAULT_SUMMARY },
        optOutChecked: false,
    };
    const shadow = host;
    shadow.innerHTML = '';

    /** 初始化就绪标志：异步读取模块/配置/相册期间为 false，按钮禁用且显示「正在准备…」；
     *  全部就绪后才置 true 并解锁「开始备份」。避免未加载完就点开始触发异常备份。 */
    let ready = false;
    /** 无访问权限（-4009）标志：任一初始化接口返回无权限即置位，整窗禁用开始按钮并提示 */
    let noPermission = false;

    /** 判定接口返回是否为无权限：-4009 或文案含无权限类关键词 */
    function isPermissionDenied(code: number | undefined, text: string): boolean {
        if (code === -4009) return true;
        return /code[=:]-?4009|无权限|没有权限|permission denied/i.test(text);
    }

    /** 标记无权限：禁用开始按钮 + 在「欢迎回来」下方显示项目统一权限文案 */
    function setNoPermission(): void {
        if (noPermission) return;
        noPermission = true;
        permNote.textContent = '🔒 ' + describeCategory('permission');
        permNote.style.display = 'block';
        refreshModulesSummary();
    }

    const style = document.createElement('style');
    style.textContent = `
        ${SHARED_STYLES}
        @keyframes qz-spin { to { transform: rotate(360deg); } }
        .mask {
            position: fixed;
            inset: 0;
            background: rgba(15, 23, 42, 0.45);
            backdrop-filter: blur(1px);
            z-index: 0;
            pointer-events: auto;
        }
        .card {
            position: relative;
            width: 460px;
            max-width: calc(100vw - 32px);
            max-height: calc(100vh - 32px);
            overflow: auto;
            padding: 18px 20px 16px;
            box-sizing: border-box;
            font-family: system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
            background: #fff;
            border-radius: 14px;
            border-top: 3px solid #2080f0;
            box-shadow: 0 24px 72px rgba(15, 23, 42, 0.35), 0 6px 20px rgba(15, 23, 42, 0.18);
            animation: qz-pop .25s ease;
            z-index: 1;
            color: #222;
        }
        .head { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
        .title { font-size:16px; font-weight:700; color:#2080f0; display:flex; align-items:center; gap:8px; }
        .close {
            width:26px;height:26px;border:none;background:#f5f5f5;border-radius:50%;
            font-size:15px;color:#888;cursor:pointer;line-height:26px;text-align:center;
        }
        .close:hover { background:#efefef; color:#444; }
        .welcome { font-size:13px; color:#555; margin:0 0 14px; line-height:1.7; min-height: 22px; }
        .welcome b { color:#222; }
        .modules {
            position: relative;
            padding: 10px 12px 12px;
            background: #fafbfc;
            border: 1px solid #eef0f3;
            border-radius: 8px;
            margin-bottom: 12px;
            min-height: 64px;
        }
        .modules.skeleton::after {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 8px;
            background: linear-gradient(90deg, #f3f4f6 0%, #e5e7eb 50%, #f3f4f6 100%);
            background-size: 200% 100%;
            animation: qz-sweep 1.2s ease-in-out infinite;
            pointer-events: none;
        }
        @keyframes qz-sweep {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }
        .modules-head {
            display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;
            font-size: 12px;
        }
        .modules-head label {
            display:flex; align-items:center; gap:6px; cursor:pointer; user-select:none;
            font-weight: 600; color:#111;
        }
        .modules-head label input[type=checkbox] { width:14px; height:14px; accent-color:#2080f0; }
        .modules-head .count { color:#6b7280; }
        .modules-grid {
            display:grid; grid-template-columns: repeat(5, 1fr); gap: 12px 8px;
        }
        .modules-grid label {
            display:flex; align-items:center; gap:6px; cursor:pointer; user-select:none;
            font-size:12px; color:#111;
        }
        .modules-grid label input[type=checkbox] {
            width:13px; height:13px; accent-color:#2080f0; flex:none;
        }
        .modules-grid label.disabled {
            color:#9ca3af; cursor:not-allowed;
        }
        .modules-grid label.disabled input {
            accent-color:#d1d5db;
        }
        .album-wrap {
            position: relative;
            min-height: 44px;
            margin-bottom: 12px;
        }
        .album-label {
            font-size:12px; color:#374151; margin: 0 2px 6px; font-weight:600;
        }
        .album-select {
            position: relative;
        }
        .album-trigger {
            display:flex; align-items:center; justify-content:space-between;
            min-height: 36px; padding: 6px 10px;
            background:#fff; border:1px solid #d9d9d9; border-radius:6px;
            font-size:12px; color:#333; cursor:pointer;
        }
        .album-trigger:hover { border-color:#2080f0; }
        .album-trigger .placeholder { color:#9ca3af; }
        .album-trigger .caret { color:#9ca3af; font-size:11px; margin-left:8px; }
        .album-dropdown {
            position: absolute; left:0; right:0; top: calc(100% + 4px); z-index: 10;
            background:#fff; border:1px solid #e5e7eb; border-radius:6px;
            box-shadow: 0 10px 30px rgba(15,23,42,0.18);
            max-height: 260px; overflow: auto; padding:4px 0;
        }
        .album-search {
            margin: 4px 8px 6px;
            display: block; width: calc(100% - 20px); padding:6px 8px;
            border:1px solid #e5e7eb; border-radius:4px; font-size:12px;
            outline: none;
        }
        .album-search:focus { border-color:#2080f0; }
        .album-group {
            padding: 4px 8px 2px;
            font-size:11px; color:#6b7280; font-weight:600;
            background:#f9fafb;
        }
        .album-option {
            display:flex; align-items:center; gap:6px;
            padding:5px 10px 5px 14px; cursor:pointer; font-size:12px; color:#111;
        }
        .album-option:hover { background:#f0f6ff; }
        .album-option input[type=checkbox] {
            width:13px; height:13px; accent-color:#2080f0; flex:none;
        }
        .album-tags {
            display:flex; flex-wrap:wrap; gap:4px; max-width: calc(100% - 20px);
        }
        .album-tag {
            background:#f0f6ff; color:#166534; border:1px solid #bfdbfe;
            padding:1px 6px 2px; border-radius:4px; font-size:11px;
            max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        }
        .tag-more {
            background:#f3f4f6; color:#374151; border:1px solid #d1d5db;
            padding:1px 6px 2px; border-radius:4px; font-size:11px;
        }
        .extra {
            background:#fafbfc; border:1px solid #eef0f3; border-radius:6px;
            padding:8px 10px; font-size:12px; line-height:1.7; color:#555; margin-bottom:12px;
            min-height: 32px;
            position: relative;
        }
        .extra b { color:#222; font-weight:600; }
        .note {
            background:#fff7ed; border:1px solid #fed7aa; border-radius:6px;
            padding:8px 10px; font-size:12px; line-height:1.65; color:#9a3412; margin-bottom:12px;
        }
        /* 日记「独立密码」告警：沿用 note 的琥珀底色，内嵌可点击的跳转链接 */
        .note-warn a {
            color:#b45309; font-weight:600; text-decoration:underline; cursor:pointer;
        }
        .note-warn a:hover { color:#92400e; }
        /* 浏览器下载器提示（与 popup 的 .browser-hint 对齐） */
        .browser-hint {
            margin: 5px 0 0;
            font-size: 11px;
            color: #e6a23c;
            line-height: 1.5;
        }
        .opt-out {
            display:flex; align-items:center; gap:8px; margin:0 0 16px;
            font-size:12px; color:#4b5563; user-select:none; cursor:pointer;
            padding: 6px 2px;
        }
        .opt-out input {
            width:15px; height:15px; cursor:pointer; flex: none; accent-color: #2080f0;
        }
        .actions {
            display:flex; flex-wrap:wrap; gap:10px; align-items:center;
            justify-content:center;  /* 按钮左右居中 */
        }
        .btn {
            display:inline-flex; align-items:center; justify-content:center; gap:6px;
            padding:9px 16px; border-radius:7px; font-size:13px; font-weight:600;
            cursor:pointer; border:1px solid transparent; white-space:nowrap;
        }
        .btn:disabled { opacity:0.5; cursor:not-allowed; }
        .btn-primary { background:#2080f0; color:#fff; }
        .btn-primary:hover:not(:disabled) { background:#1366d6; }
        .btn-default { background:#fff; color:#374151; border-color:#d1d5db; }
        .btn-default:hover:not(:disabled) { background:#f9fafb; border-color:#9ca3af; }
        .dismiss-wrap {
            display:flex; align-items:center; justify-content:center;
            margin-top: 12px;
        }
        .dismiss-link {
            font-size:12px; color:#6b7280; text-decoration:underline; cursor:pointer;
            text-align:center;
        }
        .dismiss-link:hover { color:#374151; }
        .err {
            margin-top:10px; padding:6px 10px; border-radius:6px; font-size:12px; line-height:1.6;
            background:#fef2f2; color:#b91c1c; display:none;
        }
        .err.show { display:block; }
        .spinner {
            display:inline-block;
            width:12px; height:12px; border-radius:50%;
            border:2px solid #bfdbfe; border-top-color:#1d6fd4;
            animation: qz-spin 0.8s linear infinite;
            vertical-align: -2px;
            margin-right: 6px;
        }
        .divider {
            height:1px; background:#eef0f3; margin: 10px 0;
        }
    `;
    shadow.appendChild(style);

    // 点击遮罩：与「稍后再说」等效，不强制弹窗阻塞，但保留清晰的主按钮
    const mask = document.createElement('div');
    mask.className = 'mask';
    shadow.appendChild(mask);

    const card = document.createElement('div');
    card.className = 'card';
    shadow.appendChild(card);

    /* ----- Header ----- */
    const head = document.createElement('div');
    head.className = 'head';
    const title = document.createElement('div');
    title.className = 'title';
    title.innerHTML = '<span>🟢</span><span>QQ空间导出助手 · 一键备份确认</span>';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'close';
    closeBtn.title = '稍后再说';
    closeBtn.textContent = '×';
    head.append(title, closeBtn);
    card.appendChild(head);

    /* ----- Welcome line（稍后填充 scopeText） ----- */
    const welcome = document.createElement('p');
    welcome.className = 'welcome';
    welcome.innerHTML = '<span class="spinner"></span>正在识别当前空间信息…';
    card.appendChild(welcome);

    /* ----- 无访问权限提示（显示在「欢迎回来」正下方，与 popup 的 permission-tip 对齐） ----- */
    const permNote = document.createElement('div');
    permNote.className = 'note';
    permNote.style.display = 'none';
    card.appendChild(permNote);

    /* ----- Module checkbox row（初次加载骨架屏） ----- */
    const modules = document.createElement('div');
    modules.className = 'modules skeleton';
    const modulesHead = document.createElement('div');
    modulesHead.className = 'modules-head';
    const allLabel = document.createElement('label');
    const allCheckbox = document.createElement('input');
    allCheckbox.type = 'checkbox';
    const allText = document.createElement('span');
    allText.textContent = '全选';
    allLabel.append(allCheckbox, allText);
    const countSpan = document.createElement('span');
    countSpan.className = 'count';
    countSpan.textContent = '加载中…';
    modulesHead.append(allLabel, countSpan);
    modules.appendChild(modulesHead);
    const modulesGrid = document.createElement('div');
    modulesGrid.className = 'modules-grid';
    modules.appendChild(modulesGrid);
    card.appendChild(modules);

    /* ----- Album selector (显示与否取决于 Photos 是否勾选，骨架屏默认不显示） ----- */
    const albumWrap = document.createElement('div');
    albumWrap.className = 'album-wrap';
    albumWrap.style.display = 'none';
    const albumLabel = document.createElement('div');
    albumLabel.className = 'album-label';
    albumLabel.textContent = '相册（默认全选）';
    const albumSelect = document.createElement('div');
    albumSelect.className = 'album-select';
    const albumTrigger = document.createElement('div');
    albumTrigger.className = 'album-trigger';
    albumTrigger.innerHTML = '<span class="placeholder">正在加载相册列表…</span><span class="caret">▾</span>';
    const albumDropdown = document.createElement('div');
    albumDropdown.className = 'album-dropdown';
    albumDropdown.style.display = 'none';
    /** 下拉内的相册列表容器（搜索框常驻，输入时仅此容器重建，保住焦点） */
    let albumListEl: HTMLDivElement;
    // 阻止下拉内部点击（勾选/搜索/全选）冒泡到 document 的关闭监听器，
    // 否则勾选时 change→redraw 会先销毁 checkbox，click 冒泡到此见 target 已脱离文档树、
    // albumSelect.contains(detached) 返回 false 而误关下拉；与 popup 的 @click.stop 一致
    albumDropdown.addEventListener('click', (e) => e.stopPropagation());
    albumSelect.append(albumTrigger, albumDropdown);
    albumWrap.append(albumLabel, albumSelect);
    card.appendChild(albumWrap);

    /** 重新渲染相册 trigger 的标签（最多 3 个 + more），避免触发栏溢出 */
    function renderAlbumTrigger(): void {
        const box = albumTrigger.querySelector(':scope > span.placeholder, :scope > .album-tags');
        if (box) box.remove();
        if (!ctx.albumList.length) {
            const ph = document.createElement('span');
            ph.className = 'placeholder';
            ph.textContent = '（未加载到相册数据，启动后自动枚举全部）';
            albumTrigger.prepend(ph);
            return;
        }
        const tags = document.createElement('div');
        tags.className = 'album-tags';
        if (ctx.selectedAlbumIds.length === ctx.albumList.length) {
            const all = document.createElement('span');
            all.className = 'album-tag';
            all.textContent = `全部相册（${ctx.albumList.length}）`;
            tags.appendChild(all);
        } else if (ctx.selectedAlbumIds.length === 0) {
            const ph = document.createElement('span');
            ph.className = 'placeholder';
            ph.textContent = '未选择任何相册';
            tags.appendChild(ph);
        } else {
            const first3 = ctx.selectedAlbumIds.slice(0, 3);
            const idToAlbum = new Map(ctx.albumList.map(a => [a.id, a]));
            first3.forEach((id) => {
                const a = idToAlbum.get(id);
                if (!a) return;
                const tag = document.createElement('span');
                tag.className = 'album-tag';
                tag.textContent = a.name;
                tags.appendChild(tag);
            });
            if (ctx.selectedAlbumIds.length > 3) {
                const more = document.createElement('span');
                more.className = 'tag-more';
                more.textContent = `+${ctx.selectedAlbumIds.length - 3}`;
                tags.appendChild(more);
            }
        }
        albumTrigger.prepend(tags);
    }

    /** 重绘相册下拉框。搜索框只建一次；输入时仅重建下方列表（保留搜索框焦点，否则每次按键丢焦点） */
    function redrawAlbumDropdown(filter = ''): void {
        albumDropdown.innerHTML = '';
        if (!ctx.albumList.length) {
            const empty = document.createElement('div');
            empty.style.cssText = 'padding: 10px 12px; color:#9ca3af; font-size:12px;';
            empty.textContent = '暂无相册数据（启动后自动全部备份）';
            albumDropdown.appendChild(empty);
            return;
        }
        const search = document.createElement('input');
        search.className = 'album-search';
        search.placeholder = '搜索相册名称…';
        search.value = filter;
        albumDropdown.appendChild(search);

        albumListEl = document.createElement('div');
        albumDropdown.appendChild(albumListEl);
        renderAlbumList('');

        search.addEventListener('input', () => renderAlbumList(search.value.trim()));
    }

    /** 只重建相册列表（全选行 + 分组行），不动搜索框，避免输入时丢失焦点 */
    function renderAlbumList(filter: string): void {
        albumListEl.innerHTML = '';
        // 全选/取消全选：位于搜索框下方、相册列表上方
        // 始终作用于全部相册（不受搜索筛选影响），让用户可以一键取消全选再单独勾选
        const allRow = document.createElement('label');
        allRow.className = 'album-option';
        allRow.style.cssText = 'border-bottom:1px solid #e5e7eb; font-weight:600;';
        const allCb = document.createElement('input');
        allCb.type = 'checkbox';
        const allCount = ctx.albumList.length;
        allCb.checked = ctx.selectedAlbumIds.length >= allCount && allCount > 0;
        allCb.indeterminate = ctx.selectedAlbumIds.length > 0 && ctx.selectedAlbumIds.length < allCount;
        allCb.addEventListener('change', () => {
            if (allCb.checked) {
                ctx.selectedAlbumIds = ctx.albumList.map(a => a.id);
            } else {
                ctx.selectedAlbumIds = [];
            }
            renderAlbumTrigger();
            // 全选/取消全选作用于全部相册，清空搜索关键字避免列表与关键字不匹配
            const s = albumDropdown.querySelector<HTMLInputElement>('.album-search');
            if (s) s.value = '';
            renderAlbumList('');
        });
        const allSpan = document.createElement('span');
        allSpan.textContent = `全选（${allCount} 个相册）`;
        allRow.append(allCb, allSpan);
        albumListEl.appendChild(allRow);

        const groups = new Map<string, AlbumItem[]>();
        for (const a of ctx.albumList) {
            if (filter && !a.name.toLowerCase().includes(filter.toLowerCase())) continue;
            const key = a.className || '未分类';
            const arr = groups.get(key) || [];
            arr.push(a);
            groups.set(key, arr);
        }
        if (groups.size === 0) {
            const no = document.createElement('div');
            no.style.cssText = 'padding: 8px 12px; color:#9ca3af; font-size:12px;';
            no.textContent = '没有匹配的相册';
            albumListEl.appendChild(no);
            return;
        }
        for (const [groupName, list] of groups.entries()) {
            const g = document.createElement('div');
            g.className = 'album-group';
            g.textContent = `${groupName}（${list.length}）`;
            albumListEl.appendChild(g);
            const idSet = new Set(ctx.selectedAlbumIds);
            list.forEach((a) => {
                const row = document.createElement('label');
                row.className = 'album-option';
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = idSet.has(a.id);
                cb.addEventListener('change', () => {
                    if (cb.checked) {
                        if (!idSet.has(a.id)) {
                            ctx.selectedAlbumIds.push(a.id);
                        }
                    } else {
                        ctx.selectedAlbumIds = ctx.selectedAlbumIds.filter(x => x !== a.id);
                    }
                    renderAlbumTrigger();
                });
                const text = document.createElement('span');
                text.textContent = `${a.name}（${a.total}）`;
                row.append(cb, text);
                albumListEl.appendChild(row);
            });
        }
    }

    albumTrigger.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const shown = albumDropdown.style.display !== 'none';
        albumDropdown.style.display = shown ? 'none' : 'block';
        if (!shown) {
            redrawAlbumDropdown('');
            const input = albumDropdown.querySelector<HTMLInputElement>('.album-search');
            if (input) setTimeout(() => input.focus(), 0);
        }
    });
    // 点击外部或切换时关闭 dropdown
    document.addEventListener('click', (e) => {
        if (!albumSelect.contains(e.target as Node)) {
            albumDropdown.style.display = 'none';
        }
    });

    /* ----- Extra summary（导出/媒体方式） ----- */
    const extra = document.createElement('div');
    extra.className = 'extra';
    extra.innerHTML = '<span class="spinner"></span>正在读取备份配置…';
    card.appendChild(extra);

    /* ----- 他人模式 提示（仅非主人显示） ----- */
    const note = document.createElement('div');
    note.className = 'note';
    note.style.display = 'none';
    card.appendChild(note);

    /* ----- 日记「独立密码」告警（与 popup 的 n-alert 对齐） ----- */
    const diaryNote = document.createElement('div');
    diaryNote.className = 'note note-warn';
    diaryNote.style.display = 'none';
    card.appendChild(diaryNote);

    /* ----- 「下次不弹出」复选框 ----- */
    const label = document.createElement('label');
    label.className = 'opt-out';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const optOutText = document.createTextNode(' 下次不弹出备份确认，我自行点击助手图标进行备份');
    checkbox.addEventListener('change', () => {
        ctx.optOutChecked = checkbox.checked;
        // 双向持久化：取消勾选也要写回 lastOptOutCheckbox，否则刷新会沿用旧的 true 又把钩自动打上
        writeLaunchFlow({ lastOptOutCheckbox: checkbox.checked }).catch(() => { /* ignore */ });
    });
    label.append(checkbox, optOutText);
    card.appendChild(label);

    /* ----- Action buttons（左右居中；dismiss 下面单独一行居中） ----- */
    const actions = document.createElement('div');
    actions.className = 'actions';
    const btnPrimary = document.createElement('button');
    btnPrimary.type = 'button';
    btnPrimary.className = 'btn btn-primary';
    // 初始处于「正在准备…」禁用态：异步读取模块/配置/相册期间不允许点开始，
    // 全部就绪后再解锁（见下方初始化完成处）。否则未加载完就点开始会触发异常备份。
    btnPrimary.disabled = true;
    btnPrimary.innerHTML = '<span class="spinner"></span><span>正在准备…</span>';
    const btnCustom = document.createElement('button');
    btnCustom.type = 'button';
    btnCustom.className = 'btn btn-default';
    btnCustom.innerHTML = '<span>⚙️</span><span>修改设置</span>';
    actions.append(btnPrimary, btnCustom);
    card.appendChild(actions);

    const dismissWrap = document.createElement('div');
    dismissWrap.className = 'dismiss-wrap';
    const dismiss = document.createElement('div');
    dismiss.className = 'dismiss-link';
    dismiss.textContent = '❌ 稍后再说';
    dismissWrap.appendChild(dismiss);
    card.appendChild(dismissWrap);

    const errBox = document.createElement('div');
    errBox.className = 'err';
    card.appendChild(errBox);

    /**
     * 探测私密日记是否开启「独立密码」，逻辑与 popup 的 checkDiaries 完全一致：
     * initDiaries 返回 code === -50000 即代表已开启独立密码，此时日记无法备份。
     *
     * 之前本弹窗完全没做这个检测（只有 popup 有），所以勾选「日记」时不会出现告警。
     * 探测要发真实请求，结果缓存到 diariesProbe，避免每次勾选变化都重复请求。
     */
    let diariesProbe: boolean | null = null;
    let diariesProbing = false;

    function renderDiaryWarn(encrypted: boolean): void {
        if (!encrypted) {
            diaryNote.style.display = 'none';
            diaryNote.innerHTML = '';
            return;
        }
        diaryNote.style.display = 'block';
        diaryNote.innerHTML = '⚠️ 日记已开启「独立密码」，不关闭将无法备份日记，'
            + '<a href="javascript:void(0)" data-act="close-diary-pwd">点此前往关闭</a>';
    }

    // 事件委托：跳转到私密日志设置页。
    // 内容脚本没有 chrome.tabs 权限，且直接 window.open 在 QQ 空间页面上会被 CSP / 弹窗策略拦截，
    // 因此改为通过 background 用 chrome.tabs.create 打开（与「修改设置」按钮机制一致）。
    diaryNote.addEventListener('click', (e) => {
        const el = e.target as HTMLElement | null;
        if (!el || el.dataset.act !== 'close-diary-pwd') return;
        const uin = ctx.ownerUin;
        if (!uin) return;
        openExternalUrl(`https://user.qzone.qq.com/${uin}/blog?catalog=private`);
    });

    async function checkDiaries(): Promise<void> {
        if (!ctx.exportTypes.includes('Diaries')) {
            renderDiaryWarn(false);
            return;
        }
        if (diariesProbe !== null) {
            renderDiaryWarn(diariesProbe);
            return;
        }
        if (diariesProbing) return;
        diariesProbing = true;
        try {
            // 直接调用同页引擎（window.__QZ_ENGINE__.probeDiaries），
            // callEngine 内部已对「引擎未挂载 / 未就绪」做退避重试；返回真实响应或 { error }。
            let data: { code?: number; error?: string } | null = null;
            try {
                data = await callEngine<{ code?: number; error?: string }>('probeDiaries', 'initDiaries');
            } catch {
                data = null;
            }
            console.log('[QZ-DIAG] initDiaries probe', JSON.stringify(data).slice(0, 120));
            // code === -50000 表示已开启独立密码；-1 表示始终没探到（引擎不可用），按未加密处理不打扰用户
            diariesProbe = data?.code === -50000;
            // 接口返回 -4009 无权限：整窗禁用开始按钮
            if (data?.code === -4009) {
                setNoPermission();
                diariesProbe = false;
            }
        } catch {
            diariesProbe = false;
        } finally {
            diariesProbing = false;
        }
        // 探测期间用户可能已取消勾选日记，这里要再判断一次当前勾选态
        renderDiaryWarn(ctx.exportTypes.includes('Diaries') && !!diariesProbe);
    }

    /** 计算「可选中」模块（他人模式下私有模块不可选），并刷新全选框 / 计数 */
    function refreshModulesSummary(): void {
        const available = MODULES.filter(m => !(isModulePrivate(m.value) && !ctx.isOwner));
        const checked = available.filter(m => ctx.exportTypes.includes(m.value));
        const allOn = checked.length > 0 && checked.length === available.length;
        const partOn = !allOn && checked.length > 0;
        allCheckbox.checked = allOn;
        // native 半选态
        (allCheckbox as HTMLInputElement).indeterminate = partOn;
        countSpan.textContent = `已选 ${checked.length} / ${available.length} 个模块`;

        // 相册选择显隐：Photos 勾中且处于「可选中」列表时才显示
        const showAlbum = ctx.exportTypes.includes('Photos')
            && MODULES.some(m => m.value === 'Photos' && !(isModulePrivate(m.value) && !ctx.isOwner));
        albumWrap.style.display = showAlbum ? '' : 'none';
        renderAlbumTrigger();

        // 主按钮：至少勾一个「可选中」模块才允许开始。
        // 用 checked 而非 ctx.exportTypes，避免他人空间下残留的置灰私有模块
        // 造成「已选 0 / N」却仍可点击开始的矛盾状态
        btnPrimary.disabled = !ready || noPermission || checked.length === 0;

        // 日记勾选态变化 → 探测/隐藏「独立密码」告警（不 await，不阻塞 UI 刷新）
        void checkDiaries();
    }

    /** 全选/反选（仅作用于可选中模块） */
    allCheckbox.addEventListener('change', () => {
        const on = allCheckbox.checked;
        const available = MODULES.filter(m => !(isModulePrivate(m.value) && !ctx.isOwner)).map(m => m.value);
        if (on) {
            ctx.exportTypes = Array.from(new Set([...ctx.exportTypes, ...available]));
        } else {
            ctx.exportTypes = ctx.exportTypes.filter(v => !available.includes(v));
        }
        // 重绘模块勾选框
        modulesGrid.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((cb) => {
            const v = cb.value;
            // dataset.disabled 是字符串 '1' / '0'，'0' 也是 truthy，必须显式比较，
            // 否则全选/取消全选后会把所有模块一并置灰，导致无法再单独勾选
            const disabled = cb.dataset.disabled === '1';
            cb.disabled = disabled;
            cb.indeterminate = false;
            // 置灰模块不参与全选，勾选态始终跟随 exportTypes
            cb.checked = !disabled && ctx.exportTypes.includes(v);
        });
        refreshModulesSummary();
        // 记住本次选择的备份类型
        chrome.storage.local.set({ PreExportTypes: [...ctx.exportTypes] }).catch(() => { /* ignore */ });
    });

    /* ----- 填充动态数据 ----- */
    (async () => {
        const [{ isOwner, scopeText, ownerUin }, summary, lastTypes, launch] = await Promise.all([
            fetchUinData(),
            readExportSummary(),
            readPreExportTypes(),
            readLaunchFlow().catch(() => null),
        ]);
        ctx.isOwner = isOwner;
        ctx.scopeText = scopeText;
        ctx.ownerUin = ownerUin;
        ctx.summary = summary;
        ctx.exportTypes = lastTypes.filter(v => MODULES.some(m => m.value === v));
        if (ctx.exportTypes.length === 0) ctx.exportTypes = MODULES.map(m => m.value);

        // 他人模式下剔除私有模块
        if (!ctx.isOwner) {
            ctx.exportTypes = ctx.exportTypes.filter(v => !isModulePrivate(v));
        }

        welcome.innerHTML = ctx.isOwner
            ? '👋 欢迎回来！检测到你已进入 <b>本人空间</b>'
            : `👋 欢迎回来！检测到你已进入 <b>他人空间</b>`;

        // 移除骨架屏，渲染真实模块 checkbox 网格（5 列，对齐 popup 的 modules grid）
        modules.classList.remove('skeleton');
        modulesGrid.innerHTML = '';
        for (const m of MODULES) {
            const lab = document.createElement('label');
            const disabled = !ctx.isOwner && isModulePrivate(m.value);
            if (disabled) lab.className = 'disabled';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = m.value;
            cb.dataset.disabled = disabled ? '1' : '0';
            cb.checked = ctx.exportTypes.includes(m.value);
            cb.disabled = disabled;
            const txt = document.createElement('span');
            txt.textContent = m.label;
            if (disabled) txt.title = '他人空间私有模块，无法备份';
            lab.append(cb, txt);
            cb.addEventListener('change', () => {
                const v = cb.value;
                if (cb.checked) {
                    if (!ctx.exportTypes.includes(v)) ctx.exportTypes.push(v);
                } else {
                    ctx.exportTypes = ctx.exportTypes.filter(x => x !== v);
                }
                refreshModulesSummary();
                chrome.storage.local.set({ PreExportTypes: [...ctx.exportTypes] }).catch(() => { /* ignore */ });
            });
            modulesGrid.appendChild(lab);
        }

        // 拉取相册列表（允许失败，失败时按「全部」处理，与 popup 一致）
        // 用带重试版本：弹窗比采集引擎先加载，首次往往拿到「引擎尚未就绪」
        try {
            const list = await callEngine<any[] | { code?: number; error?: string }>('getAlbumList', 'getAlbumList');
            console.log('[QZ-DIAG] getAlbumList raw:', list ? (Array.isArray(list) ? `array(${list.length})` : JSON.stringify(list).slice(0, 200)) : 'null');
            if (!Array.isArray(list) && list && typeof list === 'object') {
                if (list.error) {
                    const code = list.code;
                    const text = list.error;
                    if (isPermissionDenied(code, text)) {
                        // 相册接口无权限：整窗禁用开始按钮。不抛错、也不提前 return，
                        // 让下方收尾逻辑（移除骨架屏、解锁按钮文案、他人模式提示）照常执行，
                        // 否则「正在准备… / 正在读取配置」的加载态会卡死。
                        setNoPermission();
                        ctx.albumList = [];
                        ctx.selectedAlbumIds = [];
                    }
                    // 引擎侧已明确报错：保持「全部」兜底，同时把原因显示出来便于排查
                    throw new Error(list.error);
                }
            }
            if (Array.isArray(list)) {
                const normalized: AlbumItem[] = list
                    .filter((x: any) => x && typeof x.id !== 'undefined' && x.id !== null)
                    .map((x: any) => ({
                        id: String(x.id),
                        name: String(x.name ?? '未命名相册'),
                        className: String(x.className ?? '未分类'),
                        total: Number(x.total) || 0,
                    }));
                ctx.albumList = normalized;
                // 默认全选，与 popup 一致
                ctx.selectedAlbumIds = normalized.map(a => a.id);
            }
        } catch (err) {
            // 相册加载失败（非权限类）：兜底为「全部」，按钮置灰状态由 refreshModulesSummary 控制
            console.warn('[QZoneExport] 相册清单加载失败，已按「全部相册」处理', err);
            ctx.albumList = [];
            ctx.selectedAlbumIds = [];
        }

        // 导出 / 媒体摘要（浏览器下载器 + 非外链模式时，在框内追加提示语）
        const showBrowserHint =
            summary.downloadType === 'Browser' && summary.mediaMode !== 'Link';
        extra.innerHTML =
            `📝 <b>文案导出格式：</b>${summary.exportText}<br/>` +
            `🖼️ <b>媒体下载方式：</b>${summary.mediaText}` +
            (showBrowserHint
                ? `<p class="browser-hint">⚠️ 请确认已关闭浏览器「下载前询问每个文件的保存位置」，否则每个文件都需手动确认。</p>`
                : '');

        // 初始化完成：解锁「开始备份」并恢复文案（之前处于「正在准备…」禁用态）
        ready = true;
        btnPrimary.innerHTML = '<span>🚀</span><span>开始备份</span>';
        refreshModulesSummary();

        // 他人模式 → 私有模块置灰说明（无权限时已被 permNote 取代，二者互斥不重复）
        if (!ctx.isOwner && !noPermission) {
            const names = getPrivateModuleLabels().join('、');
            note.style.display = 'block';
            note.innerHTML = `🔒 检测到这是 <b>${scopeText}</b>，私有模块（${names}）已自动置灰，无法备份。`;
        }

        // 读取上次的 optOutChecked 默认勾选状态（仅 UI 恢复，不影响逻辑）
        try {
            checkbox.checked = !!(launch && launch.lastOptOutCheckbox);
            ctx.optOutChecked = checkbox.checked;
        } catch { /* ignore */ }
    })().catch((e) => {
        // 任何初始化失败，都先把骨架屏移除，避免页面一直停留在 loading 遮罩
        modules.classList.remove('skeleton');
        modulesGrid.innerHTML = '';
        welcome.textContent = '⚠️ 读取配置失败，仍可手动备份';
        extra.textContent = '无法读取当前配置，将使用上次备份的默认设置。';
        // 即便初始化失败也解锁按钮（允许用户手动备份），并恢复文案
        ready = true;
        btnPrimary.innerHTML = '<span>🚀</span><span>开始备份</span>';
        refreshModulesSummary();
    });

    /* ----- 关闭（统一处理：写 optOutCheckbox → 移除） ----- */
    async function closeCard(): Promise<void> {
        try { await persistOptOutIfChecked(ctx); } catch { /* ignore */ }
        host.remove();
    }

    closeBtn.addEventListener('click', closeCard);
    dismiss.addEventListener('click', closeCard);
    mask.addEventListener('click', closeCard);

    /* ----- 修改设置 → 打开 options 的 Common 页（模块批量开关 + 弹窗行为设置等） ----- */
    btnCustom.addEventListener('click', async () => {
        // 先把当前勾选的模块写入 PreExportTypes，用户打开 options 改完回来也能保留
        chrome.storage.local.set({ PreExportTypes: [...ctx.exportTypes] }).catch(() => { /* ignore */ });
        await persistOptOutIfChecked(ctx);
        openOptionsForCustomize();
        closeCard();
    });

    /* ----- 开始备份 → 调用 background 桥接 ----- */
    btnPrimary.addEventListener('click', async () => {
        if (noPermission) return; // 无权限时按钮本就 disabled，双保险
        btnPrimary.disabled = true;
        btnCustom.disabled = true;
        errBox.classList.remove('show');
        const result = await triggerStartBackup(ctx);
        if (result.ok) {
            await closeCard();
        } else {
            btnPrimary.disabled = false;
            btnCustom.disabled = false;
            errBox.textContent = `❌ ${result.message || '备份启动失败，请点击扩展图标手动备份'}`;
            errBox.classList.add('show');
            refreshModulesSummary(); // 可能因为模块为空导致按钮要变灰
        }
    });

    return host;
}

/* ==================== 2. 固定图标引导（show_pin_hint_only 态） ==================== */

/** 构建「请固定助手图标 📌」引导卡片（替代原 buildHint） */
function buildPinHintCard(host: HTMLElement, dismissCount: number): { host: HTMLElement; onClose: () => Promise<void> } {
    const shadow = host;
    shadow.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = `
        ${SHARED_STYLES}
        .card {
            width: 320px;
            max-width: calc(100vw - 48px);
            padding: 14px 16px;
            box-sizing: border-box;
            font-family: system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
            background: #fff;
            border-radius: 12px;
            border-top: 3px solid #2080f0;
            box-shadow: 0 12px 40px rgba(0,0,0,0.22);
            animation: qz-pop .25s ease;
        }
        .arrow {
            position: fixed;
            top: 14px;
            right: 128px;
            width: 0; height: 0;
            border-left: 9px solid transparent;
            border-right: 9px solid transparent;
            border-bottom: 10px solid #2080f0;
            animation: qz-bounce 1s ease-in-out infinite;
        }
        .head { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
        .title { font-size:14px; font-weight:700; color:#2080f0; display:flex; align-items:center; gap:8px; }
        .close {
            width:22px;height:22px;border:none;background:none;border-radius:4px;
            font-size:16px;color:#999;cursor:pointer;line-height:22px;text-align:center;
        }
        .close:hover { background:#f3f4f6; color:#333; }
        .body { font-size:13px; line-height:1.7; color:#555; margin:0 0 10px; }
        .body b { color:#222; }
        .count { font-size:11px; color:#9ca3af; margin:0 0 8px; }
        .actions { display:flex; flex-wrap:wrap; gap:8px; }
        .btn {
            padding:5px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;
            border:1px solid transparent;
        }
        .btn-primary { background:#2080f0; color:#fff; }
        .btn-primary:hover { background:#1366d6; }
        .btn-default { background:#fff; color:#374151; border-color:#d1d5db; }
        .btn-default:hover { background:#f9fafb; }
    `;
    shadow.appendChild(style);

    // 箭头：固定在 shadow 宿主上，相对视口
    const arrow = document.createElement('div');
    arrow.className = 'arrow';
    shadow.appendChild(arrow);

    const card = document.createElement('div');
    card.className = 'card';
    shadow.appendChild(card);

    const head = document.createElement('div');
    head.className = 'head';
    const title = document.createElement('div');
    title.className = 'title';
    title.innerHTML = '<span>📌</span><span>一键备份更快捷</span>';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close';
    closeBtn.textContent = '×';
    head.append(title, closeBtn);
    card.appendChild(head);

    const body = document.createElement('p');
    body.className = 'body';
    body.innerHTML = `你已关闭自动备份弹窗。<br>为了下次启动备份更快：<br>点浏览器右上角的 <b>🧩 拼图图标</b> → 在弹出列表中找到「QQ空间导出助手」→ 点击右侧 <b>📌 图钉</b>，即可把它固定到工具栏，之后一键直达备份面板。`;
    card.appendChild(body);

    if (dismissCount > 0) {
        const count = document.createElement('p');
        count.className = 'count';
        count.textContent = `已提示 ${dismissCount} 次，再关 ${Math.max(0, PIN_HINT_AUTO_STOP_THRESHOLD - dismissCount)} 次将自动不再提示`;
        card.appendChild(count);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';
    const btnFixed = document.createElement('button');
    btnFixed.className = 'btn btn-primary';
    btnFixed.textContent = '我已经固定好了（不再提示）';
    const btnOK = document.createElement('button');
    btnOK.className = 'btn btn-default';
    btnOK.textContent = '我知道了（关闭本次）';
    actions.append(btnFixed, btnOK);
    card.appendChild(actions);

    // 关闭计数（写 storage，达到阈值后自动升级为永不弹窗）
    const closeAll = async (markPermanent: boolean): Promise<void> => {
        try {
            if (markPermanent) {
                await writeLaunchFlow({ behavior: 'never_auto_popup' });
            } else {
                await incrementPinHintDismiss();
            }
        } catch { /* ignore */ }
        host.remove();
    };

    closeBtn.addEventListener('click', () => closeAll(false));
    btnOK.addEventListener('click', () => closeAll(false));
    btnFixed.addEventListener('click', () => closeAll(true));

    return { host, onClose: () => closeAll(false) };
}

/* ==================== 3. 公告通知（完全保留原有实现，仅加与三态机的优先级协调） ==================== */

const ANNOUNCEMENTS_URL = 'https://cdn.jsdelivr.net/gh/ShunCai/QZoneExport@main/public/remote-config.json';
const ANN_CACHE_KEY = 'QZoneExport_AnnouncementCache';
const ANN_DISMISSED_KEY = 'QZoneExport_DismissedAnnouncements';
const ANN_CACHE_TTL = 12 * 60 * 60 * 1000;

interface Announcement {
    id: string;
    level: 'info' | 'warning' | 'error';
    title: string;
    content: string;
    minVersion?: string;
    maxVersion?: string;
    dismissable?: boolean;
    publishedAt?: string;
}

async function fetchAnnouncements(): Promise<Announcement[]> {
    try {
        const cached = await chrome.storage.local.get([ANN_CACHE_KEY]);
        const cache = cached[ANN_CACHE_KEY] as { data: Announcement[]; ts: number } | undefined;
        if (cache && Date.now() - cache.ts < ANN_CACHE_TTL) return cache.data;

        let list: Announcement[] = [];
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3000);
            const res = await fetch(ANNOUNCEMENTS_URL, { signal: controller.signal });
            clearTimeout(timer);
            if (res.ok) {
                const json = await res.json();
                list = Array.isArray(json.announcements) ? json.announcements : [];
            }
        } catch {
            try {
                const resp = await chrome.runtime.sendMessage({ from: 'content', type: 'fetchAnnouncements' });
                if (resp?.ok && Array.isArray(resp.data)) list = resp.data;
            } catch { return cache?.data || []; }
        }
        await chrome.storage.local.set({ [ANN_CACHE_KEY]: { data: list, ts: Date.now() } });
        return list;
    } catch {
        try {
            const cached = await chrome.storage.local.get([ANN_CACHE_KEY]);
            return (cached[ANN_CACHE_KEY] as { data: Announcement[] } | undefined)?.data || [];
        } catch { return []; }
    }
}

function filterAnnouncements(list: Announcement[], dismissed: string[]): Announcement[] {
    const version = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest)
        ? chrome.runtime.getManifest().version || '0.0.0'
        : '0.0.0';
    return list.filter((ann) => {
        if (dismissed.includes(ann.id)) return false;
        if (ann.minVersion && version < ann.minVersion) return false;
        if (ann.maxVersion && version > ann.maxVersion) return false;
        return true;
    });
}

const LEVEL_COLORS: Record<string, string> = {
    info: '#3b6fd4',
    warning: '#d97706',
    error: '#dc2626',
};

function buildAnnouncementCard(host: HTMLElement, ann: Announcement, onClose: () => void, onDismiss: () => void): HTMLElement {
    const shadow = host;
    shadow.innerHTML = '';
    const color = LEVEL_COLORS[ann.level] || LEVEL_COLORS.info;
    const style = document.createElement('style');
    style.textContent = `
        ${SHARED_STYLES}
        .card {
            width: 320px;
            max-width: calc(100vw - 48px);
            padding: 14px 16px;
            box-sizing: border-box;
            font-family: system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
            background: #fff;
            border-radius: 10px;
            border-top: 3px solid ${color};
            box-shadow: 0 8px 28px rgba(0,0,0,0.22);
            animation: qz-pop .25s ease;
        }
        .head { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
        .title { font-size:14px; font-weight:700; color:${color}; }
        .close {
            width:22px;height:22px;border:none;background:none;border-radius:4px;
            font-size:16px;color:#999;cursor:pointer;line-height:22px;text-align:center;
        }
        .close:hover { background:#f3f4f6; color:#333; }
        .body { font-size:13px; line-height:1.7; color:#555; margin:0; word-break:break-word; }
    `;
    shadow.appendChild(style);
    const card = document.createElement('div');
    card.className = 'card';
    const head = document.createElement('div');
    head.className = 'head';
    const titleEl = document.createElement('div');
    titleEl.className = 'title';
    titleEl.textContent = ann.title;
    head.appendChild(titleEl);
    if (ann.dismissable !== false) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'close';
        closeBtn.type = 'button';
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => { onDismiss(); onClose(); });
        head.appendChild(closeBtn);
    }
    const bodyEl = document.createElement('p');
    bodyEl.className = 'body';
    bodyEl.textContent = ann.content;
    card.append(head, bodyEl);
    shadow.appendChild(card);

    if (ann.dismissable !== false) {
        setTimeout(onClose, 15000);
    }
    return host;
}

async function showAnnouncements(): Promise<boolean> {
    const list = await fetchAnnouncements();
    if (list.length === 0) return false;

    const stored = await chrome.storage.local.get([ANN_DISMISSED_KEY]);
    const dismissed = (stored[ANN_DISMISSED_KEY] || []) as string[];
    const pending = filterAnnouncements(list, dismissed);
    if (pending.length === 0) return false;

    const sorted = [...pending].sort((a, b) => {
        const order: Record<string, number> = { error: 0, warning: 1, info: 2 };
        return (order[a.level] ?? 2) - (order[b.level] ?? 2);
    });
    const ann = sorted[0]!;
    if (document.getElementById('qz-export-announcement')) return false;

    const { shadow } = mountShadowHost('qz-export-announcement', 'top-right', 12);
    buildAnnouncementCard(shadow, ann,
        () => document.getElementById('qz-export-announcement')?.remove(),
        async () => {
            const s = await chrome.storage.local.get([ANN_DISMISSED_KEY]);
            const ids = (s[ANN_DISMISSED_KEY] || []) as string[];
            if (!ids.includes(ann.id)) {
                ids.push(ann.id);
                await chrome.storage.local.set({ [ANN_DISMISSED_KEY]: ids });
            }
        },
    );
    return true;
}

/* ==================== 主入口：三态机 + 优先级链 ==================== */

/** 同一时刻只允许存在 1 个引导浮层，避免两个卡片重叠 */
const MOUNTED_IDS = [
    'qz-export-backup-launch',   // 备份确认弹窗（最高优先级）
    'qz-export-pin-hint',        // 固定图标引导
    'qz-export-announcement',    // 公告（最低优先级）
];

/** 先移除其他浮层（严格的一次一个） */
function clearOtherFloating(exceptId: string): void {
    for (const id of MOUNTED_IDS) {
        if (id !== exceptId) document.getElementById(id)?.remove();
    }
}

/** 主逻辑 */
async function main(): Promise<void> {
    if (!isSpacePage()) return;

    // 1. 读当前三态
    const launch = await readLaunchFlow();
    const behavior: LaunchPopupBehavior = launch.behavior;

    // 2. 优先级 1：弹备份确认（页面居中显示）
    if (behavior === 'ask_on_first_visit') {
        clearOtherFloating('qz-export-backup-launch');
        if (!document.getElementById('qz-export-backup-launch')) {
            const { shadow } = mountShadowHost('qz-export-backup-launch', 'center');
            buildBackupLaunchCard(shadow);
        }
        return;
    }

    // 3. 优先级 2：弹固定图标引导（右上角轻量提示，不使用遮罩）
    if (behavior === 'show_pin_hint_only') {
        clearOtherFloating('qz-export-pin-hint');
        if (!document.getElementById('qz-export-pin-hint')) {
            const { shadow } = mountShadowHost('qz-export-pin-hint', 'top-right', 12);
            buildPinHintCard(shadow, launch.pinHintDismissCount);
        }
        return;
    }

    // 4. 优先级 3：永不自动弹窗 → 仍允许公告（最低优先级，右上角轻提示）
    await showAnnouncements();
}

/* 启动：DOMContentLoaded 后立即执行（空间页加载慢时也能拿到 body） */
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => { main().catch(() => {/* ignore */}); }, { once: true });
} else {
    main().catch(() => {/* ignore */});
}

/* 兼容旧引用：保持 defineContentScript 注册（wxt 需要） */
export default defineContentScript({
    matches: [
        '*://user.qzone.qq.com/*',
        '*://*.qzone.qq.com/*',
    ],
    main() { /* 所有逻辑已经在文件顶层 main() 里执行了，这里空实现只为满足 wxt 的注册 */ },
});
