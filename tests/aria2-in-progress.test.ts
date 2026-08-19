import { describe, it, expect } from 'vitest';
import { DownloadManager } from '../core/downloader/manager';
import type { DownloadDriver, DownloadRequest, ProgressReporter } from '../core/downloader/drivers/types';

/** 模拟 Aria2：接受任务返回 gid，但下载中途 NEVER 回调 onProgress（复现 totalLength 不回报的坏场景） */
function makeSilentAria2Driver() {
    const driver: DownloadDriver & { type: 'aria2' } = {
        type: 'aria2',
        async submit(_req: DownloadRequest, _reporter: ProgressReporter) {
            return { trackerId: 'gid-fake-123' };
        },
        async pause() {},
        async resume() {},
        async cancel() {},
    };
    return driver;
}

describe('Aria2 任务 in_progress 状态兜底', () => {
    it('驱动接受任务即置 in_progress，不依赖底层回报字节进度', async () => {
        const dm = new DownloadManager({});
        (dm as any).drivers.aria2 = makeSilentAria2Driver();

        // 登记一个 aria2 任务（pending）
        const t = dm.upsert({ id: 't1', module: 'Photos', url: 'http://x/q.jpg', name: 'q.jpg', trackerType: 'aria2', _src: 'test' });
        expect(t?.state).toBe('pending');

        // 提交下载（模拟引擎调用 submitTask）
        await dm.submitTask('t1');

        const after = dm.tasksSorted().find((x) => x.id === 't1');
        expect(after).toBeTruthy();
        // 关键断言：即使 Aria2 全程不回报字节进度，任务也应处于「正在下载」
        expect(after!.state).toBe('in_progress');
        expect(after!.aria2Gid).toBe('gid-fake-123');
    });

    it('对照：若驱动未接受任务（返回 error），不应误置 in_progress', async () => {
        const dm = new DownloadManager({});
        (dm as any).drivers.aria2 = {
            type: 'aria2',
            async submit() { return { error: 'aria2 unreachable' }; },
            async pause() {}, async resume() {}, async cancel() {},
        } as any;

        dm.upsert({ id: 't2', module: 'Photos', url: 'http://x/q.jpg', name: 'q.jpg', trackerType: 'aria2', _src: 'test' });
        await dm.submitTask('t2');

        const after = dm.tasksSorted().find((x) => x.id === 't2');
        expect(after!.state).toBe('interrupted');
    });
});
