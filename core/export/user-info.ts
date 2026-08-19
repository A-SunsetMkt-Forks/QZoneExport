import type { QzoneContext } from '../qzone-api/context';
import type { Requester } from '../qzone-api/request';
import { userInfos } from '../qzone-api/clients';

export interface TargetUserInfo {
    nickname?: string;
    avatar?: string;
    spaceName?: string;
    desc?: string;
    uin?: number | string;
    [key: string]: unknown;
}

/**
 * 等价旧版 API.Common.initUserInfo 的核心请求：拉取被备份空间主人的真实资料
 * （昵称/头像/空间名/简介等）。
 *
 * 该调用在 v3 重构时被整段丢失——`window['QZone_Common_Target']` 一直是空壳，
 * 导致 `Common/json/user.js` 个人档写入空对象（无昵称/头像）。这里复用 v3 已移植的
 * `userInfos(ctx)` 接口补全它。
 *
 * 接口异常或返回无 data 时返回空对象（不抛出），由调用方兜底填充，
 * 确保备份收尾流程不被打断。
 */
export async function fetchTargetUserInfo(ctx: QzoneContext, requester: Requester): Promise<TargetUserInfo> {
    try {
        const api = userInfos(ctx);
        const json = await requester.getJson<{ code?: number; data?: TargetUserInfo }>(
            api.url,
            api.params,
            /^_Callback\(/,
        );
        return (json && json.data) || {};
    } catch (e) {
        console.error('[user-info] 获取目标用户信息失败，个人档将缺少昵称/头像', e);
        return {};
    }
}

/**
 * 把拉取到的资料合并进备份流程使用的 Target/Owner 全局对象，
 * 并补全 uin（来自 ctx，保证即使接口未返回 uin 也能拿到目标QQ）。
 *
 * 对应旧版：`Object.assign(QZone.Common.Target, userInfo)` 之后再写 `target.uin`。
 */
export function mergeTargetUserInfo(
    target: Record<string, unknown>,
    owner: Record<string, unknown>,
    info: Record<string, unknown>,
    ctx: { targetUin: number; ownerUin?: number },
): void {
    Object.assign(target, info);
    target.uin = ctx.targetUin;
    owner.uin = ctx.ownerUin;
}
