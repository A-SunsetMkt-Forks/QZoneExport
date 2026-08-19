/**
 * Aria2 下载进度回归测试。
 *
 * 背景：用户反馈「正在下载的媒体没有速度、进度和总大小」。根因有两处：
 *  1) Aria2Driver 轮询里有 `if (total > 0)` 守卫——aria2 的 totalLength 在下载初期
 *     （或响应无 Content-Length 的流式资源）为 0，守卫导致 onProgress 完全不触发，
 *     管理器拿不到任何字节采样点 → 速度/进度/总大小三者皆空。
 *  2) 管理器 onProgress 直接用驱动传来的 total 覆盖 totalBytes，total=0 时会把
 *     已探明的总大小抹掉。
 */
import { describe, it, expect } from 'vitest';
import { Aria2Driver } from '../core/downloader/drivers/aria2';
import { DownloadManager } from '../core/downloader/manager';
import type { DownloadDriver, DownloadRequest, ProgressReporter } from '../core/downloader/drivers/types';

describe('Aria2Driver 进度上报', () => {
    it('totalLength 尚未就绪（为 0）时仍应上报已下载字节', async () => {
        const driver = new Aria2Driver({ host: 'http://127.0.0.1:6800/jsonrpc' });
        let polls = 0;
        (driver as any).call = async (method: string) => {
            if (method === 'aria2.addUri') return 'gid-nolen';
            polls++;
            // 模拟流式资源：aria2 始终不回报 totalLength，但已下载字节在增长
            return { totalLength: '0', completedLength: String(polls * 2048), status: 'active' };
        };
        const frames: Array<[number, number]> = [];
        await driver.submit(
            { url: 'http://example.com/live.mp4', name: 'live.mp4' } as any,
            { onProgress: (d: number, t: number) => frames.push([d, t]), onState: () => {} } as any,
        );
        await new Promise((r) => setTimeout(r, 2300));
        (driver as any)._timers?.forEach((t: any) => clearInterval(t));

        expect(frames.length).toBeGreaterThanOrEqual(2);
        // 关键断言：总大小未知也要上报，且已下载字节确实在增长
        expect(frames[0]![1]).toBe(0);
        expect(frames[1]![0]).toBeGreaterThan(frames[0]![0]);
    }, 10000);
});

/** 可手动触发 reporter 的假驱动，便于在管理器层验证进度合成逻辑 */
function makeManualDriver(sink: { reporter?: ProgressReporter }) {
    const driver: DownloadDriver & { type: 'aria2' } = {
        type: 'aria2',
        async submit(_req: DownloadRequest, reporter: ProgressReporter) {
            sink.reporter = reporter;
            return { trackerId: 'gid-manual' };
        },
        async pause() {},
        async resume() {},
        async cancel() {},
    };
    return driver;
}

describe('DownloadManager 进度合成', () => {
    it('驱动持续回报字节时应算出速度（即便总大小未知）', async () => {
        const sink: { reporter?: ProgressReporter } = {};
        const dm = new DownloadManager({});
        (dm as any).drivers.aria2 = makeManualDriver(sink);
        dm.upsert({ id: 'p1', module: 'Videos', url: 'http://x/a.mp4', name: 'a.mp4', trackerType: 'aria2', _src: 'test' });
        await dm.submitTask('p1');

        sink.reporter!.onProgress!(1024, 0);
        await new Promise((r) => setTimeout(r, 300));
        sink.reporter!.onProgress!(4096, 0);

        const t = dm.tasksSorted().find((x) => x.id === 'p1')!;
        expect(t.state).toBe('in_progress');
        expect(t.downloadedBytes).toBe(4096);
        expect(t.speedBps).toBeGreaterThan(0);
    });

    it('总大小只升不降：驱动回报 total=0 不应抹掉已探明的总大小', async () => {
        const sink: { reporter?: ProgressReporter } = {};
        const dm = new DownloadManager({});
        (dm as any).drivers.aria2 = makeManualDriver(sink);
        dm.upsert({ id: 'p2', module: 'Videos', url: 'http://x/b.mp4', name: 'b.mp4', trackerType: 'aria2', _src: 'test' });
        await dm.submitTask('p2');

        sink.reporter!.onProgress!(1024, 8192); // 总大小已探明
        sink.reporter!.onProgress!(2048, 0);    // 后续一帧总大小又变未知

        const t = dm.tasksSorted().find((x) => x.id === 'p2')!;
        expect(t.totalBytes).toBe(8192);
        expect(t.downloadedBytes).toBe(2048);
    });
});
