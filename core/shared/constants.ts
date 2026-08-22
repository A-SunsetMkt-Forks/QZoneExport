/**
 * 项目级共享常量（超时、间隔、容量限制等）
 *
 * 将散落在各文件中的魔法数字集中管理，修改时只需改一处。
 */

/* ===== 时间（毫秒） ===== */

export const TIMING = {
    /** 采集引擎心跳间隔（ms） */
    HEARTBEAT_INTERVAL: 5 * 60 * 1000,
    /** MIME 探测请求超时（ms）。与 Common.autoFileSuffixTimeOut 默认 5s 对齐；detectSuffix 显式透传配置值，此为兜底默认 */
    MIME_PROBE_TIMEOUT: 5000,
    /** 浏览器下载 track 清理延迟（ms） */
    BROWSER_DL_CLEANUP_DELAY: 30000,
    /** background port 消息超时（ms） */
    PORT_MESSAGE_TIMEOUT: 10000,
    /** 备份启动超时（ms） */
    BACKUP_START_TIMEOUT: 12000,
    /** 模块内批次间暂停间隔（ms） */
    BATCH_INTERVAL: 500,
    /** 状态变更事件防抖间隔（ms） */
    STATS_DEBOUNCE: 120,
} as const;

/* ===== 容量/并发限制 ===== */

export const LIMITS = {
    /** 日志缓冲区最大条目数 */
    LOG_BUFFER_SIZE: 4000,
    /** url.cn 短链解包最大并发数 */
    UNWRAP_URL_CONCURRENCY: 6,
    /** 条目级明细（评论/点赞/访客）采集最大并发数，避免单页条目裸 Promise.all 打爆接口与浏览器 */
    ITEM_DETAIL_CONCURRENCY: 15,
    /** 文件后缀 MIME 探测最大并发数（对图片 CDN 发 GET 读 content-type，限流阈值远高于 QQ 空间 API） */
    SUFFIX_PROBE_CONCURRENCY: 10,
    /** url.cn 短链解析结果缓存上限（超出按插入顺序淘汰最旧，避免长期运行内存无限增长） */
    URL_CN_CACHE_SIZE: 2000,
} as const;
