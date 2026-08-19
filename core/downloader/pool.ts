/**
 * Promise并发池
 * 替代 background.js downloadByBrowser 的1秒轮询等待（L126）与
 * modules/common.js 的 _.chunk 分批串行模式：固定worker数持续消费，无空转
 */
export interface PoolOptions {
    /** 并发数（<=0 视为1） */
    concurrency: number;
    /** 每个任务完成后的间隔毫秒（对应旧版 downloadSleep 语义，默认0） */
    intervalMs?: number;
    /** 可注入的等待实现（测试免等待） */
    sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 并发执行任务集合，逐个回调结果（不因单任务失败中断整体）
 */
export async function runPool<T, R>(
    items: T[],
    worker: (item: T, index: number) => Promise<R>,
    options: PoolOptions,
    onSettled?: (item: T, index: number, result: { ok: true; value: R } | { ok: false; error: unknown }) => void,
): Promise<void> {
    const concurrency = Math.max(1, options.concurrency);
    const sleepFn = options.sleepFn || defaultSleep;
    let cursor = 0;

    const runWorker = async (): Promise<void> => {
        while (cursor < items.length) {
            const index = cursor++;
            const item = items[index]!;
            try {
                const value = await worker(item, index);
                onSettled && onSettled(item, index, { ok: true, value });
            } catch (error) {
                onSettled && onSettled(item, index, { ok: false, error });
            }
            if (options.intervalMs) {
                await sleepFn(options.intervalMs);
            }
        }
    };

    const workers: Promise<void>[] = [];
    for (let i = 0; i < concurrency; i++) {
        workers.push(runWorker());
    }
    await Promise.all(workers);
}

/**
 * 指数退避重试
 * @param fn 任务
 * @param retries 重试次数
 * @param baseDelayMs 基础间隔（第n次重试等待 baseDelayMs * 2^(n-1)）
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    retries: number,
    baseDelayMs: number,
    sleepFn: (ms: number) => Promise<void> = defaultSleep,
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < retries) {
                await sleepFn(baseDelayMs * Math.pow(2, attempt));
            }
        }
    }
    throw lastError;
}
