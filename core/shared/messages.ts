/**
 * 扩展运行时消息类型常量（background ↔ content ↔ panel）
 *
 * 避免各文件散落字符串字面量，拼写错误可在编译时发现。
 * 已有 CW_MESSAGE（跨世界通信）在 cross-world.ts 中定义，不在本文档重复。
 */

/** content script → background 的消息类型 */
export const BG_MSG = {
    /** 启动保活心跳 */
    KEEPALIVE_START: 'keepalive_start',
    /** 停止保活心跳 */
    KEEPALIVE_STOP: 'keepalive_stop',
    /** 拉取公告/远程配置 */
    FETCH_ANNOUNCEMENTS: 'fetchAnnouncements',
    /** 启用 DNR 规则 */
    DNR_START: 'dnr_start',
    /** 停用 DNR 规则 */
    DNR_STOP: 'dnr_stop',
    /** Disk 模式下载失败时，content 请求 background 为某 host 增量注册 Referer 规则 */
    DNR_ADD_HOST: 'dnr_add_host',
    /** 打开选项页 */
    CONTENT_OPEN_OPTIONS: 'content_open_options',
    /** content script 无 chrome.tabs 权限，委托 background 打开外部链接 */
    CONTENT_OPEN_URL: 'content_open_url',
    /** content script 通过 port 发送消息 */
    CONTENT_PORT_MESSAGE: 'content_port_message',
    /** url.cn 短链获取 HTML 并解析 */
    URL_CN_FETCH_HTML: 'urlcn_fetch_html',
    /** 发起浏览器下载（content → background），使用 v3 后缀避免旧 legacy handler 重复处理 */
    DOWNLOAD_BROWSER: 'download_browser_v3',
    /** 暂停浏览器下载 */
    DOWNLOAD_PAUSE: 'download_pause',
    /** 取消浏览器下载 */
    DOWNLOAD_CANCEL: 'download_cancel',
    /** 继续浏览器下载 */
    DOWNLOAD_RESUME: 'download_resume',
    /** 初始化/上报用户 uin */
    CONTENT_INIT_UIN: 'content_init_uin',
    /** Disk（直写目录）媒体下载的 background 代理通道（content ↔ background 的 port 名）。
     *  用于绕开 content script 在 HTTPS 页 fetch http 媒体被 Mixed Content 拦截的问题：
     *  background 持 <all_urls> 不受约束，拉取字节后经 port 分块回传，content 重建流写 DiskFS。 */
    DISK_FETCH_PROXY: 'disk_fetch_proxy',
    /** 启动备份 */
    CONTENT_START_BACKUP: 'content_start_backup',
    /** 获取 MIME 类型 */
    GET_MIME_TYPE: 'getMimeType',
} as const;

export type BgMsgType = (typeof BG_MSG)[keyof typeof BG_MSG];

/** 浏览器下载事件（background → content script） */
export const DLEvent = {
    CREATED: 'browser_dl_created',
    PROGRESS: 'browser_dl_progress',
    /** background 合并多个 downloadId 进度后批量广播（每个 downloadId 一帧） */
    PROGRESS_BATCH: 'browser_dl_progress_batch',
    COMPLETE: 'browser_dl_complete',
    ERROR: 'browser_dl_error',
    CANCEL: 'browser_dl_cancel',
} as const;

export type DLEventType = (typeof DLEvent)[keyof typeof DLEvent];
