/**
 * QZone API 响应类型定义
 *
 * QZone 大部分接口返回 JSONP 格式，剥壳后结构与 standardREST 接口一致：
 * `{ code, message, data, ... }`
 */


/** QZone API 统一响应封装（JSONP 剥壳后或 standardREST 返回值） */
export interface QzoneApiResponse<T = unknown> {
    /** 业务状态码，0 表示成功 */
    code: number;
    /** 错误或提示信息 */
    message?: string;
    /** 业务数据负载 */
    data?: T;
    /** 部分接口额外返回 debug/verbose 字段 */
    subcode?: number;
    /** 旧版分页相关的总量字段（部分接口返回） */
    total?: number;
    /** 允许额外字段（接口间差异较大） */
    [key: string]: unknown;
}

/** 无 data 负载的简单响应（仅 code + message） */
export type QzoneSimpleResponse = QzoneApiResponse<never>;

/** 带 data 负载的通用响应 */
export type QzoneDataResponse<T> = QzoneApiResponse<T>;

/**
 * 分页列表响应负载
 * 多数列表接口返回 { list: T[], hasMore?, next?, total?... }
 */
export interface PaginatedList<T> {
    list?: T[];
    hasMore?: boolean;
    next?: string | number;
    total?: number;
    /** 部分接口在 data 层直接展开数组，不做 {list} 包装 */
    [key: string]: unknown;
}

/** 分页列表 API 响应 */
export type QzonePaginatedResponse<T> = QzoneApiResponse<PaginatedList<T>>;

/**
 * 发布者的部分信息（说说/日志/相册/留言中的 owner 片段）
 * 各接口返回字段差异大，此处仅声明常用字段
 */
export interface QzoneUserInfo {
    uin?: number;
    nickname?: string;
    name?: string;
    avatar?: string;
    [key: string]: unknown;
}
