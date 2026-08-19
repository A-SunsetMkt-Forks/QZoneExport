import { describe, expect, it } from 'vitest';
import { Requester, type RetryConfig, serializeParams } from '../core/qzone-api/request';
import { REST_URLS } from '../core/qzone-api/urls';

const baseConfig: RetryConfig = {
    listRetryCount: 2,
    listRetrySleep: 1,
    waitCount: 1,
    waitTime: 3600,
    RestSleepUrls: ['MESSAGES_LIST_URL'],
};

/** 构造响应序列的fetch桩 */
function fetchStub(responses: Array<{ status?: number; body: string } | Error>) {
    const calls: string[] = [];
    const fn = (async (url: any) => {
        calls.push(String(url));
        const next = responses.shift();
        if (!next) {
            throw new Error('no more responses');
        }
        if (next instanceof Error) {
            throw next;
        }
        return new Response(next.body, { status: next.status || 200 });
    }) as typeof fetch;
    return { fn, calls };
}

function makeRequester(responses: Array<{ status?: number; body: string } | Error>, sleeps: number[] = []) {
    const { fn, calls } = fetchStub(responses);
    const requester = new Requester({
        config: () => baseConfig,
        fetchFn: fn,
        sleepFn: async (ms) => {
            sleeps.push(ms);
        },
    });
    return { requester, calls, sleeps };
}

describe('Requester 重试语义', () => {
    it('成功直接返回原文', async () => {
        const { requester } = makeRequester([{ body: '{"code":0,"ok":1}' }]);
        expect(await requester.get('https://x.com/api')).toBe('{"code":0,"ok":1}');
    });

    it('业务code异常时重试，重试后成功', async () => {
        const { requester, calls, sleeps } = makeRequester([
            { body: '{"code":-3000,"message":"未登录"}' },
            { body: '{"code":0}' },
        ]);
        expect(await requester.get('https://x.com/api')).toBe('{"code":0}');
        expect(calls.length).toBe(2);
        expect(sleeps).toEqual([1000]);
    });

    it('code=-4009 权限问题不重试，视为成功', async () => {
        const { requester, calls } = makeRequester([{ body: '{"code":-4009}' }]);
        expect(await requester.get('https://x.com/api')).toBe('{"code":-4009}');
        expect(calls.length).toBe(1);
    });

    it('非JSON响应视为成功返回原文', async () => {
        const { requester } = makeRequester([{ body: '<html>detail</html>' }]);
        expect(await requester.get('https://x.com/api')).toBe('<html>detail</html>');
    });

    it('重试次数用完抛出异常', async () => {
        const { requester, calls } = makeRequester([
            new Error('net1'),
            new Error('net2'),
            new Error('net3'),
        ]);
        await expect(requester.get('https://x.com/api')).rejects.toThrow('net3');
        // 首次 + listRetryCount(2) 次重试
        expect(calls.length).toBe(3);
    });

    it('使用人数过多且命中RestSleepUrls时切换长间隔重试', async () => {
        const { requester, sleeps } = makeRequester([
            { body: '{"code":-10000,"message":"使用人数过多，请稍后再试"}' },
            { body: '{"code":0}' },
        ]);
        await requester.get(REST_URLS.MESSAGES_LIST_URL, { uin: 1 });
        // 切换为长间隔重试，但单页睡眠被夹到上限 60s（防止 waitTime 过大冻结备份）
        expect(sleeps).toEqual([60 * 1000]);
    });

    it('使用人数过多但未命中RestSleepUrls时保持普通重试', async () => {
        const { requester, sleeps } = makeRequester([
            { body: '{"code":-10000,"message":"使用人数过多，请稍后再试"}' },
            { body: '{"code":0}' },
        ]);
        await requester.get(REST_URLS.BLOGS_LIST_URL, { uin: 1 });
        expect(sleeps).toEqual([1000]);
    });

    it('getJson剥壳解析', async () => {
        const { requester } = makeRequester([{ body: '_Callback({"code":0,"data":{"total":9}});' }]);
        const data = await requester.getJson('https://x.com/api', undefined, /^_Callback\(/);
        expect(data.data.total).toBe(9);
    });
});

describe('响应编码处理', () => {
    /** GBK 编码的「日志标题」字节（日=0xC8D5 志=0xD6BE 标=0xB1EA 题=0xCCE2） */
    const gbkBytes = new Uint8Array([0xc8, 0xd5, 0xd6, 0xbe, 0xb1, 0xea, 0xcc, 0xe2]);

    /** 用指定字节与响应头构造请求器 */
    function makeBinaryRequester(bytes: Uint8Array, contentType?: string) {
        const fn = (async () =>
            new Response(bytes.buffer as ArrayBuffer, {
                status: 200,
                headers: contentType ? { 'content-type': contentType } : {},
            })) as unknown as typeof fetch;
        return new Requester({ config: () => baseConfig, fetchFn: fn, sleepFn: async () => {} });
    }

    it('显式指定 charset 时按该编码解码（日志详情为 gb2312）', async () => {
        const requester = makeBinaryRequester(gbkBytes);
        const text = await requester.get('https://x.com/blog', undefined, { charset: 'gb2312' });
        expect(text).toBe('日志标题');
    });

    it('未指定时从响应头 charset 探测', async () => {
        const requester = makeBinaryRequester(gbkBytes, 'text/html; charset=gbk');
        const text = await requester.get('https://x.com/blog');
        expect(text).toBe('日志标题');
    });

    it('响应头无 charset 时从 HTML meta 探测', async () => {
        const prefix = new TextEncoder().encode('<html><head><meta charset="gb2312"><title>');
        const bytes = new Uint8Array(prefix.length + gbkBytes.length);
        bytes.set(prefix, 0);
        bytes.set(gbkBytes, prefix.length);
        const requester = makeBinaryRequester(bytes, 'text/html');
        const text = await requester.get('https://x.com/blog');
        expect(text.endsWith('日志标题')).toBe(true);
    });

    it('UTF-8 响应不受影响，不支持的编码回退 UTF-8', async () => {
        const utf8 = new TextEncoder().encode('说说内容');
        const okRequester = makeBinaryRequester(utf8, 'application/json; charset=utf-8');
        expect(await okRequester.get('https://x.com/api')).toBe('说说内容');

        const badRequester = makeBinaryRequester(utf8, 'text/html; charset=not-a-charset');
        expect(await badRequester.get('https://x.com/api')).toBe('说说内容');
    });
});

describe('serializeParams', () => {
    it('编码并跳过undefined', () => {
        expect(serializeParams({ a: 1, b: 'x y', c: undefined })).toBe('a=1&b=x%20y');
    });
});

describe('接口请求超时', () => {
    /** 构造一个尊重 abort 信号的挂起请求：不中止就永远不 resolve */
    function hangingFetch(onCall?: (signal?: AbortSignal) => void) {
        return (async (_url: any, init: any) => {
            onCall && onCall(init?.signal);
            return await new Promise<Response>((_resolve, reject) => {
                const signal: AbortSignal | undefined = init?.signal;
                if (signal) {
                    signal.addEventListener('abort', () => {
                        // fetch 被 AbortController 中止时抛出 name='AbortError'
                        reject(new DOMException('The operation was aborted', 'AbortError'));
                    });
                }
            });
        }) as unknown as typeof fetch;
    }

    it('超时后当可重试错误，重试用完抛出超时信息', async () => {
        const requester = new Requester({
            // 0.01 秒 = 10ms 真实计时，不重试（listRetryCount:0）方便直接断言
            config: () => ({ ...baseConfig, listRetryCount: 0, requestTimeout: 0.01 }),
            fetchFn: hangingFetch(),
            sleepFn: async () => {},
        });
        await expect(requester.get('https://x.com/api')).rejects.toThrow('请求超时');
    });

    it('超时会触发重试，重试成功则返回', async () => {
        const sleeps: number[] = [];
        let call = 0;
        // 第一次挂起（会被超时中止），第二次直接成功
        const fetchFn = (async (_url: any, init: any) => {
            call++;
            if (call === 1) {
                return await new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () =>
                        reject(new DOMException('aborted', 'AbortError')),
                    );
                });
            }
            return new Response('{"code":0}');
        }) as unknown as typeof fetch;
        const requester = new Requester({
            config: () => ({ ...baseConfig, listRetryCount: 2, requestTimeout: 0.01 }),
            fetchFn,
            sleepFn: async (ms) => {
                sleeps.push(ms);
            },
        });
        expect(await requester.get('https://x.com/api')).toBe('{"code":0}');
        expect(call).toBe(2);
        expect(sleeps).toEqual([1000]);
    });

    it('requestTimeout 为 0 时不传 signal（不限时，保持旧行为）', async () => {
        let seenSignal: AbortSignal | undefined | 'unset' = 'unset';
        const fetchFn = (async (_url: any, init: any) => {
            seenSignal = init?.signal;
            return new Response('{"code":0}');
        }) as unknown as typeof fetch;
        const requester = new Requester({
            config: () => ({ ...baseConfig, requestTimeout: 0 }),
            fetchFn,
            sleepFn: async () => {},
        });
        await requester.get('https://x.com/api');
        expect(seenSignal).toBeUndefined();
    });
});
