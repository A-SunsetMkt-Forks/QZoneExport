/**
 * Aria2Driver 轮询容错回归测试（F12）：
 *  - tellStatus 持续 reject（RPC 连接中断）时，连续失败计数超阈值应自清理定时器
 *    并标记任务 interrupted，避免定时器/GID 永久泄漏。
 */
import { describe, it, expect } from 'vitest';
import { Aria2Driver } from '../core/downloader/drivers/aria2';

describe('Aria2Driver 轮询容错（F12）', () => {
    it('tellStatus 连续失败超阈值时清除定时器并标记 interrupted', async () => {
        const driver = new Aria2Driver({ host: 'http://127.0.0.1:6800/jsonrpc' });
        // 让 addUri 返回固定 gid；让 tellStatus（aria2.tellStatus）持续 reject 模拟 RPC 连接中断
        (driver as any).call = async (method: string) => {
            if (method === 'aria2.addUri') return 'gid-xyz';
            throw new Error('connection refused');
        };
        const states: string[] = [];
        const result = await driver.submit(
            { url: 'http://example.com/a.jpg', name: 'a.jpg' } as any,
            { onProgress: () => {}, onState: (s: string) => states.push(s) } as any,
        );
        expect(result.trackerId).toBe('gid-xyz');

        // 轮询间隔 1s，阈值 5 次连续失败 => 约 5s 后触发自清理
        await new Promise((r) => setTimeout(r, 5600));
        expect(states).toContain('interrupted');
        // 定时器应被清理，GID 不再残留
        const timers = (driver as any)._timers as Map<string, ReturnType<typeof setInterval>> | undefined;
        expect(timers?.has('gid-xyz')).toBe(false);
    }, 10000);

    it('tellStatus 成功时正常推进，不触发中断兜底', async () => {
        const driver = new Aria2Driver({ host: 'http://127.0.0.1:6800/jsonrpc' });
        let calls = 0;
        (driver as any).call = async (method: string) => {
            if (method === 'aria2.addUri') return 'gid-ok';
            calls++;
            // 前两次返回进行中，第三次返回完成
            if (calls < 3) return { totalLength: '100', completedLength: String(calls * 40), status: 'active' };
            return { totalLength: '100', completedLength: '100', status: 'complete' };
        };
        const states: string[] = [];
        await driver.submit(
            { url: 'http://example.com/b.jpg', name: 'b.jpg' } as any,
            { onProgress: () => {}, onState: (s: string) => states.push(s) } as any,
        );
        await new Promise((r) => setTimeout(r, 3300));
        expect(states).toContain('complete');
        expect(states).not.toContain('interrupted');
    }, 10000);
});
