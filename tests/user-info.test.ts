import { describe, it, expect } from 'vitest';
import { fetchTargetUserInfo, mergeTargetUserInfo } from '../core/export/user-info';

const fakeCtx = { targetUin: 123456, ownerUin: 654321 } as any;

/** 用给定返回值构造一个最小 Requester mock */
function mockRequester(returnValue: unknown) {
    return { getJson: async () => returnValue } as any;
}

describe('fetchTargetUserInfo', () => {
    it('返回接口 data 中的真实资料（昵称/头像/空间名）', async () => {
        const requester = mockRequester({
            code: 0,
            data: { nickname: '小明', avatar: 'http://a/b.jpg', spaceName: '阿明的空间' },
        });
        const r = await fetchTargetUserInfo(fakeCtx, requester);
        expect(r.nickname).toBe('小明');
        expect(r.avatar).toBe('http://a/b.jpg');
        expect(r.spaceName).toBe('阿明的空间');
    });

    it('接口抛错时返回空对象且不抛出，保证备份收尾不中断', async () => {
        const requester = { getJson: async () => { throw new Error('network'); } } as any;
        const r = await fetchTargetUserInfo(fakeCtx, requester);
        expect(r).toEqual({});
    });

    it('接口返回无 data 时返回空对象', async () => {
        const requester = mockRequester({ code: -1 });
        const r = await fetchTargetUserInfo(fakeCtx, requester);
        expect(r).toEqual({});
    });
});

describe('mergeTargetUserInfo', () => {
    it('合并资料并补全 target/owner 的 uin', () => {
        const target: Record<string, unknown> = {};
        const owner: Record<string, unknown> = {};
        mergeTargetUserInfo(target, owner, { nickname: '小明', avatar: 'http://a/b.jpg' }, fakeCtx);
        expect(target.nickname).toBe('小明');
        expect(target.avatar).toBe('http://a/b.jpg');
        expect(target.uin).toBe(123456);
        expect(owner.uin).toBe(654321);
    });

    it('info 为空时仍补全 uin（接口失败的兜底）', () => {
        const target: Record<string, unknown> = {};
        const owner: Record<string, unknown> = {};
        mergeTargetUserInfo(target, owner, {}, fakeCtx);
        expect(target.uin).toBe(123456);
        expect(owner.uin).toBe(654321);
        expect(Object.keys(target)).toEqual(['uin']);
    });

    it('不为空对象时保留既有字段并覆盖 info（与旧版 Object.assign 语义一致）', () => {
        const target: Record<string, unknown> = { uin: 999 };
        const owner: Record<string, unknown> = {};
        mergeTargetUserInfo(target, owner, { uin: 111, nickname: '新昵称' }, fakeCtx);
        // ctx.targetUin 优先，info 的同名字段被 ctx 覆盖
        expect(target.uin).toBe(123456);
        expect(target.nickname).toBe('新昵称');
    });
});
