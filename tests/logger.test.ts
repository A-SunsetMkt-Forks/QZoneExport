import { describe, expect, it } from 'vitest';
import { Logger } from '../core/shared/logger';

/** 不镜像到 console，避免测试输出噪声 */
function makeLogger(options = {}) {
    return new Logger({ mirror: false, ...options });
}

describe('Logger 分级与缓冲', () => {
    it('按级别记录并可取回', () => {
        const log = makeLogger();
        log.debug('d');
        log.info('i');
        log.warn('w');
        log.error('e');
        expect(log.size).toBe(4);
        expect(log.getEntries().map((x) => x.level)).toEqual(['debug', 'info', 'warn', 'error']);
    });

    it('minLevel 过滤低级别日志', () => {
        const log = makeLogger({ minLevel: 'warn' });
        log.debug('d');
        log.info('i');
        log.warn('w');
        log.error('e');
        expect(log.size).toBe(2);
        expect(log.getEntries().map((x) => x.message)).toEqual(['w', 'e']);
    });

    it('filter 按最低级别筛选已记录项', () => {
        const log = makeLogger();
        log.info('i');
        log.warn('w');
        log.error('e');
        expect(log.filter('warn').map((x) => x.message)).toEqual(['w', 'e']);
    });

    it('环形缓冲超上限丢弃最旧', () => {
        const log = makeLogger({ capacity: 3 });
        log.info('1');
        log.info('2');
        log.info('3');
        log.info('4');
        expect(log.size).toBe(3);
        expect(log.getEntries().map((x) => x.message)).toEqual(['2', '3', '4']);
    });

    it('setModule 给后续日志打模块标记', () => {
        const log = makeLogger();
        log.info('无模块');
        log.setModule('Messages');
        log.warn('有模块');
        log.setModule(undefined);
        log.info('又无模块');
        const entries = log.getEntries();
        expect(entries[0]!.module).toBeUndefined();
        expect(entries[1]!.module).toBe('Messages');
        expect(entries[2]!.module).toBeUndefined();
    });

    it('clear 清空缓冲', () => {
        const log = makeLogger();
        log.info('x');
        log.clear();
        expect(log.size).toBe(0);
        expect(log.export()).toBe('');
    });
});

describe('Logger 导出格式', () => {
    it('导出含时间/级别/模块/消息，附加参数安全序列化', () => {
        // 固定时钟：2026-01-02 03:04:05 本地时间
        const fixed = new Date(2026, 0, 2, 3, 4, 5).getTime();
        const log = makeLogger({ now: () => fixed });
        log.setModule('Photos');
        log.warn('获取相册列表异常', { code: -3000, message: '失败' });
        const line = log.export();
        expect(line).toContain('[03:04:05]');
        expect(line).toContain('[WARN]');
        expect(line).toContain('[Photos]');
        expect(line).toContain('获取相册列表异常');
        // 对象附加参数被 JSON 序列化
        expect(line).toContain('{"code":-3000,"message":"失败"}');
    });

    it('Error 附加参数取 message/stack，不抛异常', () => {
        const log = makeLogger();
        log.error('请求异常', new Error('boom'));
        expect(log.export()).toContain('boom');
    });

    it('循环引用对象不导致导出抛错', () => {
        const log = makeLogger();
        const circular: any = { a: 1 };
        circular.self = circular;
        log.warn('循环', circular);
        expect(() => log.export()).not.toThrow();
    });
});

describe('Logger console 镜像', () => {
    it('mirror 开启时按级别调用对应 console 方法', () => {
        const calls: string[] = [];
        const fakeConsole = {
            warn: () => calls.push('warn'),
            error: () => calls.push('error'),
            info: () => calls.push('info'),
            log: () => calls.push('log'),
            debug: () => calls.push('debug'),
        };
        const log = new Logger({ mirror: true }, fakeConsole);
        log.warn('w');
        log.error('e');
        log.info('i');
        expect(calls).toEqual(['warn', 'error', 'info']);
    });

    it('mirror 关闭时不触碰 console', () => {
        const calls: string[] = [];
        const fakeConsole = { warn: () => calls.push('warn'), error: () => calls.push('error') };
        const log = new Logger({ mirror: false }, fakeConsole);
        log.warn('w');
        log.error('e');
        expect(calls).toEqual([]);
    });
});
