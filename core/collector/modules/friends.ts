import { friendList, sortFriendList, friendshipTime, specialCareList, zoneAccess } from '../../qzone-api/clients';
import { sortBy, toJson } from '../../shared/utils';
import type { CollectContext, ModuleCollector } from '../pipeline';
import { type AvatarTaskRegistry, writeModuleOutputs } from './helpers';
import type { CollectorEnv } from './types';
import { LIMITS } from '../../shared/constants';
import { runPool } from '../../downloader/pool';
import * as XLSX from 'xlsx';

/**
 * 好友采集器
 * 移植自 src/js/modules/friends.js 的 API.Friends.export 全流程（HTML/Excel/MD渲染除外）
 * 单次接口获取全部好友，无分页；增量按uin去重并标记已删除好友
 */

/** 好友条目 */
export interface FriendItem {
    uin: number;
    nick?: string;
    name?: string;
    remark?: string;
    groupid?: number;
    groupSortNo?: number;
    groupName?: string;
    isMe?: boolean;
    addFriendTime?: number;
    isFriend?: number;
    intimacyScore?: number;
    common?: Record<string, unknown>;
    access?: boolean;
    care?: boolean;
    deleted?: boolean;
    [key: string]: any;
}

/* ==================== 好友 Excel 导出（V2 API.Friends.exportToExcel 移植，默认常驻产出） ==================== */

/** 时间戳(秒) -> YYYY-MM-DD HH:mm:ss */
function formatFriendTime(ts: number): string {
    if (!ts || ts === 0) return '未知';
    const d = new Date(ts * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function showCare(f: FriendItem): string {
    return f.isMe ? '本人' : f.care ? '已关心' : '未关心';
}
function showFriendTime(f: FriendItem): string {
    if (f.isMe) return '本人';
    if (!f.addFriendTime || f.addFriendTime === 0) return '未知';
    return formatFriendTime(f.addFriendTime);
}
function showAccessType(f: FriendItem): string {
    if (f.isMe) return '本人';
    if (f.access === false) return '无';
    if (f.access === true) return '有';
    return '未知';
}
function showFriendType(f: FriendItem): string {
    if (f.isMe) return '本人';
    if (f.deleted) return '已删';
    if (f.isFriend === 2) return '单向';
    if (f.isFriend === 1) return '正常';
    return '未知';
}
function showIntimacy(f: FriendItem): string | number {
    if (f.isMe) return '本人';
    return f.intimacyScore || 0;
}
function showCommonFriend(f: FriendItem): string | number {
    if (f.isMe) return '本人';
    const arr = f.common?.friend;
    return Array.isArray(arr) ? arr.length : 0;
}
function showCommonGroup(f: FriendItem, join: string): string {
    if (f.isMe) return '本人';
    const arr = f.common?.group;
    if (!Array.isArray(arr) || arr.length === 0) return '无';
    return arr.map((g: any) => (g && typeof g === 'object' ? g.name : g)).join(join);
}
function userQzoneUrl(uin: number): string {
    return `https://user.qzone.qq.com/${uin}`;
}
function userMessageUrl(uin: number): string {
    return `tencent://message/?uin=${uin}`;
}

/** 把 SheetJS 写出的 ArrayBuffer / number[] 统一成 Uint8Array */
function toBytes(out: ArrayBuffer | number[]): Uint8Array {
    return out instanceof ArrayBuffer ? new Uint8Array(out) : new Uint8Array(out);
}

/** 导出好友到 Excel（QQ好友.xlsx），含 QQ空间 / QQ聊天 两个超链单元格 */
export async function writeFriendsExcel(env: CollectorEnv, friends: FriendItem[]): Promise<void> {
    const wsData: any[][] = [
        ['QQ', 'QQ昵称', 'QQ备注', 'QQ分组', '特别关心', '相识时间', '空间权限', '好友关系', '亲密度', '共同好友', '共同群组', 'QQ空间', 'QQ通讯'],
    ];
    for (const f of friends) {
        const qzoneLink = { t: 's', v: 'QQ空间', l: { Target: userQzoneUrl(f.uin), Tooltip: 'QQ空间' } };
        const messageLink = { t: 's', v: 'QQ聊天', l: { Target: userMessageUrl(f.uin), Tooltip: 'QQ聊天' } };
        wsData.push([
            f.uin,
            f.name ?? f.nick ?? '',
            f.remark ?? '',
            f.groupName ?? '',
            showCare(f),
            showFriendTime(f),
            showAccessType(f),
            showFriendType(f),
            showIntimacy(f),
            showCommonFriend(f),
            showCommonGroup(f, '\n'),
            qzoneLink,
            messageLink,
        ]);
    }
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'QQ好友');
    const out = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    await env.writeFile(toBytes(out), 'Friends/QQ好友.xlsx');
}

export class FriendsCollector implements ModuleCollector {
    readonly module = 'Friends';

    constructor(
        private readonly env: CollectorEnv,
        /** 头像下载登记器（跨模块共享实例） */
        private readonly avatars: AvatarTaskRegistry,
    ) {}

    async restore(_ctx: CollectContext): Promise<void> {
        const env = this.env;
        const friends = await env.loadStaging<FriendItem[]>(this.module);
        if (!friends || friends.length === 0) {
            env.logger.warn('好友 staging 丢失，回退全量采集');
            return this.collect(_ctx);
        }
        env.logger.info('好友续传恢复：从 staging 加载 ' + friends.length + ' 条');
        await env.report('export', 0, 1);
        await writeModuleOutputs(env, {
            module: 'Friends',
            globalName: 'friends',
            data: friends,
            jsonJsPath: 'Friends/json/friends.js',
            jsonFilePath: 'Friends/json/friends.json',
        });
        await writeFriendsExcel(env, friends);
        await env.report('export', 1, 1);
    }

    /** 是否为新好友（移植自 friends.js isNewItem L211-216）
     * 全量模式（IncrementType==='Full'）下所有好友都视为新，重新抓取互动信息/头像；
     * 增量模式下仅未出现在上次备份中的好友视为新。 */
    private isNewFriend(oldItems: FriendItem[], item: FriendItem): boolean {
        if (this.env.config.Friends.IncrementType === 'Full') {
            return true;
        }
        return oldItems.length === 0 || oldItems.findIndex((old) => old.uin === item.uin) === -1;
    }

    async collect(_ctx: CollectContext): Promise<void> {
        const env = this.env;
        const cfg = env.config.Friends;

        // 上次备份数据（增量识别已删除好友用）
        const oldItems = (await env.getOldData<FriendItem[]>(this.module)) || [];

        // 获取所有好友（QQ分组排序走排序接口，助手分组走普通接口）
        let friends: FriendItem[] = [];
        try {
            const call = cfg.SortType === 'QQ' ? sortFriendList(env.ctx) : friendList(env.ctx);
            const text = await env.requester.get(call.url, call.params);
            const res = toJson<any>(text, /^_Callback\(/);
            if (res.code && res.code != 0) {
                env.logger.warn('获取所有好友列表异常 | code=' + res.code, res.msg || '');
            }
            const data = res.data || {};
            friends = data.items || data.list || [];
            await env.report('list', friends.length, friends.length);

            // 初始化分组名称
            this.initGroupName(data, friends);

            // 添加QQ好友的头像下载（仅新好友）
            // 时机：列表到手即登记。头像地址只由 uin 拼出，不依赖成立时间/空间权限/特别关心
            // 这三个耗时阶段；登记即开下载，提前后可与后续采集并行。
            this.avatars.downloadAll(friends.filter((friend) => this.isNewFriend(oldItems, friend)));

            // 获取好友成立时间/亲密度/共同信息
            await this.collectFriendsTime(data, friends, oldItems);

            // 获取好友空间权限
            await this.collectZoneAccess(friends, oldItems);

            // 获取特别关心好友
            await this.collectCareFriends(friends);
        } catch (error) {
            env.logger.error('获取好友列表异常', error instanceof Error ? error.message : String(error));
        }

        // 已删除好友识别：好友名单本就是全量快照，比对上次备份零成本，始终运行
        // （与是否增量模式无关，全量备份也记录谁被删/互删）
        const deletedItems = oldItems.filter((old) => friends.findIndex((item) => item.uin === old.uin) < 0);
        const deletedUins = new Set(deletedItems.map((item) => item.uin));

        // 合并旧数据：
        //  - 增量模式（IncrementType!=='Full'）：以旧数据为基础，保留既有好友旧互动信息（避免重复抓取），仅新好友用本次抓取；
        //  - 全量模式：以本次新抓数据为基础（既有好友互动信息已重新抓取），仅补回已删除好友（带 deleted 标记，沿用旧数据）。
        // 两种模式都把已删除好友纳入输出。
        const incremental = cfg.IncrementType !== 'Full';
        const base = incremental ? oldItems : friends;
        const supplement = incremental ? friends : oldItems;
        const seen = new Set<number>();
        const merged: FriendItem[] = [];
        for (const item of base.concat(supplement)) {
            if (seen.has(item.uin)) {
                continue;
            }
            seen.add(item.uin);
            merged.push(item);
        }
        friends = merged;

        // 统一标记删除态
        for (const item of friends) {
            item.deleted = deletedUins.has(item.uin);
        }

        // 根据分组名称排序号排序
        friends = sortBy(friends, 'groupSortNo');

        // 导出数据文件
        await env.report('export', 0, 1);
        await writeModuleOutputs(env, {
            module: 'Friends',
            globalName: 'friends',
            data: friends,
            jsonJsPath: 'Friends/json/friends.js',
            jsonFilePath: 'Friends/json/friends.json',
            markdown: true,
        });
        await writeFriendsExcel(env, friends);
        await env.report('export', 1, 1);
    }

    /**
     * 基于分组信息初始化分组名称（移植自 friends.js initGroupName L113-132）
     */
    private initGroupName(data: any, friends: FriendItem[]): void {
        const groups: any[] = data.gpnames || [];
        const groupMap = new Map<number, any>();
        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            group.sortNo = i + 1;
            groupMap.set(group.gpid, group);
        }
        for (const friend of friends) {
            const group = groupMap.get(friend.groupid!) || {};
            // 排序号与分组名称
            friend.groupSortNo = group.sortNo || 0;
            friend.groupName = group.gpname || '默认分组';
        }
    }

    /**
     * 获取好友添加时间/亲密度/共同信息（移植自 friends.js getFriendsTime L137-205）
     *
     * 由逐条串行 + 每项 randomSleep 改为并发池（复用「明细采集」的并发上限
     * Common.itemDetailConcurrency）：好友数几百时，串行总耗时 ≈ N×休眠，并发后由该上限截断。
     * 限流由 requester 内置重试+指数退避兜底（429 只放缓不失败）；担心接口敏感可调低该配置。
     */
    private async collectFriendsTime(data: any, friends: FriendItem[], oldItems: FriendItem[]): Promise<void> {
        const env = this.env;
        const cfg = env.config.Friends;
        if (!cfg.Interactive) {
            return;
        }
        // 本人只打标不请求；真正需要请求的是「非本人 且 新增」的好友，先筛出来再并发
        const targets: FriendItem[] = [];
        for (const friend of friends) {
            friend.isMe = friend.uin === env.ctx.ownerUin;
            if (friend.isMe) {
                friend.addFriendTime = 0;
                friend.intimacyScore = 0;
                friend.common = {};
                continue;
            }
            if (this.isNewFriend(oldItems, friend)) targets.push(friend);
        }
        if (!targets.length) {
            return;
        }
        const concurrency = (env.config.Common as any)?.itemDetailConcurrency ?? LIMITS.ITEM_DETAIL_CONCURRENCY;
        env.logger.info(`[好友并发] 互动信息 | 待处理=${targets.length} | 上限=${concurrency}`);
        let done = 0;
        await runPool(targets, async (friend) => {
            await env.tick(); // 每个请求前响应暂停/取消
            try {
                const call = friendshipTime(env.ctx, friend.uin);
                const text = await env.requester.get(call.url, call.params);
                const res = toJson<any>(text, /^_Callback\(/);
                if (res.code && res.code != 0) {
                    env.logger.warn(`获取互动信息异常 | uin=${friend.uin} | code=${res.code}`, res.msg || '');
                }
                const infoData = res.data || {};
                // 添加时间
                friend.addFriendTime = infoData['addFriendTime'] || 0;
                // 好友类型
                friend.isFriend = infoData['isFriend'] || -1;
                // 亲密度
                friend.intimacyScore = infoData['intimacyScore'] || 0;
                // 共同信息（共同好友、共同群组）
                friend.common = infoData['common'] || {};
            } catch (error) {
                env.logger.error(`获取好友添加时间异常 | uin=${friend.uin}`, error instanceof Error ? error.message : String(error));
            }
            done += 1;
            // 全模块主体总进度 = 2 × 新好友数（互动占前一半，权限占后一半），done 单调递增，避免阶段切换时进度倒退
            await env.report('friendship', done, targets.length * 2, undefined, undefined, { done, total: targets.length * 2 });
        }, { concurrency });
    }

    /**
     * 探测单个好友的空间访问权限（cgi_userinfo_get_all，-4009=无权访问）。
     * 接口异常/其它错误码不足以定论时返回 undefined（视为未知，不把接口异常误判成可访问或无权）。
     */
    private async probeFriendAccess(env: CollectorEnv, targetUin: number): Promise<boolean | undefined> {
        try {
            const call = zoneAccess(env.ctx, targetUin);
            const text = await env.requester.get(call.url, call.params);
            const res = toJson<any>(text, /^_Callback\(/);
            if (res && typeof res.code === 'number') {
                if (res.code === -4009) return false; // 无访问权限
                if (res.code === 0) return true;      // 有访问权限
                env.logger.warn(`空间权限探测异常 | uin=${targetUin} | code=${res.code}`, res.msg || '');
            }
        } catch (error) {
            env.logger.warn(`空间权限探测失败 | uin=${targetUin}`, error instanceof Error ? error.message : String(error));
        }
        return undefined;
    }

    /**
     * 获取好友空间访问权限（移植自 friends.js getZoneAccessList L416-455）
     * 接口为 cgi_userinfo_get_all：并发会触发 501 限流，必须像旧版那样逐一串行探测；
     * 因此不复用「明细采集」的并发池，改为按顺序逐个请求。
     */
    private async collectZoneAccess(friends: FriendItem[], oldItems: FriendItem[]): Promise<void> {
        const env = this.env;
        if (!env.config.Friends.ZoneAccess) {
            return;
        }
        // 只探测「非本人 且 新增」的好友
        const targets = friends.filter((f) => !f.isMe && this.isNewFriend(oldItems, f));
        if (!targets.length) {
            return;
        }
        env.logger.info(`[好友串行] 空间权限 | 待处理=${targets.length}`);
        let done = 0;
        for (const friend of targets) {
            await env.tick();
            friend.access = await this.probeFriendAccess(env, friend.uin);
            done += 1;
            // 续在互动之后（前半段打满 targets），全模块主体总进度单调递增，避免进度倒退
            const cum = targets.length + done;
            await env.report('friendship', cum, targets.length * 2, undefined, '获取空间权限', { done: cum, total: targets.length * 2 });
        }
    }

    /**
     * 获取特别关心好友列表（移植自 friends.js getCareFriendList L462-501）
     */
    private async collectCareFriends(friends: FriendItem[]): Promise<void> {
        const env = this.env;
        if (!env.config.Friends.SpecialCare) {
            return;
        }
        try {
            const call = specialCareList(env.ctx);
            const text = await env.requester.get(call.url, call.params);
            const res = toJson<any>(text, /^_Callback\(/);
            if (res.code && res.code != 0) {
                env.logger.warn('获取特别关心好友列表异常 | code=' + res.code, res.msg || '');
            }
            const data = res.data || {};
            // 关心的好友列表
            const items: any[] = data.items_special || [];
            for (const item of items) {
                const friend = friends.find((f) => f.uin === item.uin);
                if (friend) {
                    friend.care = true;
                }
            }
        } catch (error) {
            env.logger.error('获取特别关心好友列表异常', error instanceof Error ? error.message : String(error));
        }
    }
}
