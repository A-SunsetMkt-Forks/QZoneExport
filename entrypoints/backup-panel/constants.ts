/**
 * 备份面板常量（阶段名、错误提示、状态标签等）
 */

export const PHASE_NAMES: Record<string, string> = {
    list: '获取列表', contents: '获取正文', 'full-content': '获取全文',
    'more-images': '获取更多图片', comments: '获取评论', likes: '获取点赞',
    visitors: '获取最近访问', friendship: '获取互动信息', 'zone-access': '获取空间权限',
    albums: '获取相册列表', 'album-comments': '获取相册评论',
    'album-visitors': '获取相册访客', 'album-likes': '获取相册点赞',
    photos: '获取相片列表', 'photo-infos': '获取相片详情',
    'photo-comments': '获取相片评论', 'photo-likes': '获取相片点赞',
    media: '整理图片视频', location: '处理坐标数据', export: '生成备份文件', download: '下载媒体',
};

export const CATEGORY_TIPS: Record<string, string> = {
    network: '网络连接异常，请检查网络后重试',
    timeout: '网络请求超时，可能网络较慢或空间响应缓慢',
    auth: '登录状态已失效，请重新登录 QQ 空间后再备份',
    permission: '没有访问权限，该内容可能已加密或仅主人可见',
    rateLimit: '操作过于频繁，QQ 空间提示稍后再试',
    business: '数据返回异常',
    parse: '响应内容解析失败',
    unknown: '发生未知错误',
};

export const TRACKER_LABEL: Record<string, string> = {
    disk: '直写目录', browser: '浏览器', aria2: 'Aria2', none: '未知',
};

/**
 * 统一状态词汇表。所有全局提示面位（header chip / module badge / media state-chip /
 * completion banner / progress note）共用此表，不再在各渲染器中零散硬编码。
 *
 * 完整词汇：
 *   pending      — 待下载（排队中）
 *   in_progress  — 下载中 / 进行中
 *   paused       — 已暂停
 *   complete     — 成功
 *   interrupted  — 失败
 *   error        — 异常（仅全局异常 / 主状态行，不用于单任务 state-chip）
 */
export const STATE_LABEL: Record<string, string> = {
    pending: '待下载', in_progress: '下载中', paused: '已暂停',
    complete: '成功', interrupted: '失败', error: '异常',
};

export const STATE_COLOR: Record<string, string> = {
    pending: '#64748b', in_progress: '#1ca5fc', paused: '#f59e0b',
    complete: '#2080f0', interrupted: '#e53e3e', error: '#e53e3e',
};

/**
 * 模块级状态标签（模块进度条旁的徽标）。
 * 虽与任务状态有语义重叠，但模块的「待开始|进行中|成功|失败」比任务语义更宽泛，
 * 因此单独维护映射，确保与 STATE_LABEL 色系一致但文案独立。
 */
export const MODULE_STATUS_LABEL: Record<string, string> = {
    idle: '未开始', active: '进行中', done: '成功', fail: '失败',
    /** 采集已完成、主体进度 100%，但媒体文件仍在后台下载中（进度条保持 done 样式不动） */
    downloading: '媒体下载中',
    /** 用户在备份弹窗未勾选该模块（概览仍完整展示全部模块，便于一眼看清本次范围） */
    unselected: '未选择',
    /** 他人空间下私有模块无权限备份（日记 / 好友 / 收藏） */
    noperm: '无权限',
};
