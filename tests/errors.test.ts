import { describe, expect, it } from 'vitest';
import { classifyError, classifyCode, describeCategory } from '../core/shared/errors';

describe('classifyError 错误归类', () => {
    it('取消错误（按 name 或 message）', () => {
        const err = new Error('备份已取消');
        err.name = 'CancelledError';
        expect(classifyError(err).category).toBe('cancelled');
        expect(classifyError(new Error('备份已取消')).category).toBe('cancelled');
    });

    it('超时（AbortError 或 接口请求超时 文案）', () => {
        const abort = new Error('aborted');
        abort.name = 'AbortError';
        expect(classifyError(abort).category).toBe('timeout');
        expect(classifyError(new Error('接口请求超时（30秒）')).category).toBe('timeout');
    });

    it('限流：使用人数过多', () => {
        expect(classifyError(new Error('使用人数过多，请稍后再试')).category).toBe('rateLimit');
    });

    it('未登录归 auth，无权限归 permission', () => {
        expect(classifyError(new Error('未登录')).category).toBe('auth');
        expect(classifyError(new Error('无权限访问该相册')).category).toBe('permission');
    });

    it('网络类：fetch 失败 / net:: / 中文网络', () => {
        expect(classifyError(new Error('Failed to fetch')).category).toBe('network');
        expect(classifyError(new Error('net::ERR_CONNECTION_RESET')).category).toBe('network');
        expect(classifyError(new Error('网络异常')).category).toBe('network');
    });

    it('HTTP 状态：401/403→auth，5xx→network，其余→business', () => {
        expect(classifyError(new Error('HTTP 401')).category).toBe('auth');
        expect(classifyError(new Error('HTTP 403')).category).toBe('auth');
        expect(classifyError(new Error('HTTP 502')).category).toBe('network');
        expect(classifyError(new Error('HTTP 400')).category).toBe('business');
    });

    it('业务码形式归 business，未知归 unknown', () => {
        expect(classifyError(new Error('code=-3000')).category).toBe('business');
        expect(classifyError(new Error('稀奇古怪的东西')).category).toBe('unknown');
    });

    it('非 Error 输入不抛异常', () => {
        expect(classifyError(undefined).category).toBe('unknown');
        expect(classifyError('请求超时了').category).toBe('timeout');
        expect(classifyError({ message: '未登录' }).category).toBe('auth');
    });

    it('携带用户可读说明与原始信息', () => {
        const result = classifyError(new Error('未登录'));
        expect(result.raw).toBe('未登录');
        expect(result.userMessage).toBe(describeCategory('auth'));
    });

    it('F7: 优先按结构化 code 归类，不受 message 文案影响', () => {
        // message 不含任何已知关键字，但业务码 -3000 应归 auth
        const err = new Error('系统繁忙，请稍后再试');
        (err as unknown as { code: number }).code = -3000;
        expect(classifyError(err).category).toBe('auth');

        // 即使 message 命中其它关键字（使用人数过多），code 仍优先
        const err2 = new Error('使用人数过多，请稍后再试');
        (err2 as unknown as { code: number }).code = -4009;
        expect(classifyError(err2).category).toBe('permission');
    });

    it('F7: code 缺失时仍退回 message 匹配', () => {
        expect(classifyError(new Error('使用人数过多，请稍后再试')).category).toBe('rateLimit');
    });
});

describe('classifyCode 业务码归类', () => {
    it('QZone 常见码', () => {
        expect(classifyCode(-4009)).toBe('permission');
        expect(classifyCode(-3000)).toBe('auth');
        expect(classifyCode(-10000)).toBe('rateLimit');
        expect(classifyCode(-99999, '使用人数过多')).toBe('rateLimit');
        expect(classifyCode(-12345)).toBe('business');
    });
});
