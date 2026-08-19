import { favoriteList } from '../../qzone-api/clients';
import { formatDate, sortBy, toJson } from '../../shared/utils';
import { isFullBackup, isNewItem, unionBackedUpItems, type IncrementItem } from '../increment';
import type { CollectContext, ModuleCollector } from '../pipeline';
import { AvatarTaskRegistry, buildOldItemFilter, collectPagedList, MediaTaskRegistry, writeModuleOutputs } from './helpers';
import { addVideoTasks } from './video-tasks';
import type { CollectorEnv } from './types';

/**
 * 收藏采集器
 * 移植自 src/js/modules/favorites.js 的 API.Favorites.export 全流程（HTML/MD渲染除外）
 */

/** 收藏条目 */
export interface FavoriteItem extends IncrementItem {
    type?: number;
    title?: string;
    abstract?: string;
    create_time?: number;
    img_list?: any[];
    origin_img_list?: any[];
    album_info?: any;
    blog_info?: any;
    photo_list?: any[];
    shuoshuo_info?: any;
    share_info?: any;
    url_info?: any;
    custom_create_time?: string;
    custom_uin?: number;
    custom_name?: string;
    custom_abstract?: string;
    custom_images?: any[];
    custom_origin_images?: any[];
    custom_videos?: any[];
    custom_audios?: any[];
    [key: string]: any;
}

/** 收藏模块下载相对目录 */
const MODULE_DIR = 'Favorites/images';

/** 收藏类型名（移植自 api.js Favorites.getType L4186-4199） */
export function getFavoriteType(innerType?: number): string {
    const favType: Record<number, string> = {
        0: '全部',
        1: '网页',
        2: '照片',
        3: '日志',
        4: '照片',
        5: '说说',
        6: '文字',
        7: '分享',
        8: '未知',
    };
    return favType[innerType as number] || '未知';
}

/**
 * 转换收藏数据（移植自 api.js Favorites.convert L4246-4346）
 * @param ownerUin 登录QQ
 * @param targetNickname 备份目标昵称
 */
export function convertFavorites(data: FavoriteItem[], ownerUin: number, targetNickname?: string): FavoriteItem[] {
    if (!data) {
        return data;
    }
    for (const temp of data) {
        temp.custom_create_time = formatDate(temp.create_time as number);
        temp.custom_uin = ownerUin;
        temp.custom_name = targetNickname;
        temp.custom_abstract = temp.abstract || '';
        temp.album_info = temp.album_info || {};
        temp.blog_info = temp.blog_info || {};
        temp.photo_list = temp.photo_list || [];
        temp.shuoshuo_info = temp.shuoshuo_info || {};
        temp.share_info = temp.share_info || {};
        temp.url_info = temp.url_info || {};
        // 源信息（处理完成后移除）
        const sourceInfo: { video_list: any[]; music_list: any[] } = { video_list: [], music_list: [] };
        // 多媒体-配图
        temp.custom_images = temp.img_list || [];
        temp.custom_origin_images = temp.origin_img_list || [];
        temp.custom_videos = [];
        temp.custom_audios = [];
        switch (temp.type) {
            case 1:
                // 网页
                sourceInfo.video_list = temp.url_info.video_list || [];
                sourceInfo.music_list = temp.url_info.music_list || [];
                break;
            case 2:
                // 相片类型无需处理多媒体
                break;
            case 3:
                // 日志
                sourceInfo.video_list = temp.blog_info.video_list || [];
                sourceInfo.music_list = temp.blog_info.music_list || [];
                break;
            case 4:
                // 照片或相册
                sourceInfo.video_list = temp.album_info.video_list || [];
                sourceInfo.music_list = temp.album_info.music_list || [];
                break;
            case 5:
                // 说说
                sourceInfo.video_list = temp.shuoshuo_info.video_list || [];
                sourceInfo.music_list = temp.shuoshuo_info.music_list || [];
                temp.shuoshuo_info.detail_shuoshuo_info = temp.shuoshuo_info.detail_shuoshuo_info || {};
                break;
            case 6:
                // 文本类型无需处理多媒体
                break;
            case 7:
                // 分享
                temp.share_info.reason = String(temp.share_info.reason || '').split('||')[0];
                sourceInfo.video_list = temp.share_info.video_list || [];
                sourceInfo.music_list = temp.share_info.music_list || [];
                break;
            default:
                break;
        }
        // 原始配图（接口返回的是URL字符串数组，统一转对象）
        for (let index = 0; index < temp.custom_origin_images.length; index++) {
            temp.custom_origin_images[index] = { url: temp.custom_origin_images[index] };
        }
        // 缩略配图
        for (let index = 0; index < temp.custom_images.length; index++) {
            const url = temp.custom_images[index];
            temp.custom_images[index] = { url };
            if (temp.type === 1) {
                temp.custom_origin_images[index] = { url };
            }
        }
        // 视频与歌曲
        for (const video of sourceInfo.video_list) {
            temp.custom_videos.push(video.video_info);
        }
        for (const music of sourceInfo.music_list) {
            temp.custom_audios.push(music.music_info);
        }
    }
    return data;
}

export class FavoritesCollector implements ModuleCollector {
    readonly module = 'Favorites';

    constructor(
        private readonly env: CollectorEnv,
        /** 备份目标昵称（转换数据时写入 custom_name） */
        private readonly targetNickname?: string,
        private readonly avatars?: AvatarTaskRegistry,
    ) {}

    async restore(_ctx: CollectContext): Promise<void> {
        const env = this.env;
        const items = await env.loadStaging<FavoriteItem[]>(this.module);
        if (!items || items.length === 0) {
            env.logger.warn('收藏 staging 丢失，回退全量采集');
            return this.collect(_ctx);
        }
        env.logger.info('收藏续传恢复：从 staging 加载 ' + items.length + ' 条');
        await env.report('export', 0, 1);
        await writeModuleOutputs(env, {
            module: 'Favorites',
            globalName: 'favorites',
            data: items,
            jsonJsPath: 'Favorites/json/favorites.js',
            jsonFilePath: 'Favorites/json/favorites.json',
        });
        await env.report('export', 1, 1);
    }

    async collect(_ctx: CollectContext): Promise<void> {
        const env = this.env;
        const cfg = env.config.Favorites;
        let items = await this.runCollection(_ctx, false);

        // 导出数据文件
        await env.report('export', 0, 1);
        await writeModuleOutputs(env, {
            module: 'Favorites',
            globalName: 'favorites',
            data: items,
            jsonJsPath: 'Favorites/json/favorites.js',
            jsonFilePath: 'Favorites/json/favorites.json',
            markdown: true,
        });
        await env.report('export', 1, 1);
    }

    /**
     * 列表采集（含页级可靠性记账 + 运行内补偿）。
     * compensateOnly=true 时跳过正常枚举，只重采 ledger 中 failed/missing 页（手动重试用）。
     * 返回完整条目（staging 已采页 + 本次/补偿采集页）。
     */
    private async collectList(ctx: CollectContext, compensateOnly: boolean): Promise<FavoriteItem[]> {
        const env = this.env;
        const cfg = env.config.Favorites;
        const registry = new MediaTaskRegistry(env, this.module);
        const oldItems = (await env.getOldData<FavoriteItem[]>(this.module)) || [];
        const isNewFilter = isFullBackup(cfg) ? () => true : buildOldItemFilter(oldItems);
        const stagedFavs = (await env.loadStaging<FavoriteItem[]>(this.module)) || [];
        const startPage = stagedFavs.length > 0 ? Math.ceil(stagedFavs.length / cfg.pageSize) : 0;
        return collectPagedList<FavoriteItem>({
            env,
            moduleCfg: cfg,
            oldItems,
            phase: 'list',
            startPage: compensateOnly ? 0 : startPage,
            initialItems: stagedFavs.length > 0 ? stagedFavs : undefined,
            afterPage: async (allItems, pageIndex, pageItems, pageOffset) => {
                // pageItems 已是本页精确子集（helpers 按 pageMap 槽位给出），不再用 slice(pi*pageSize) 反推
                const actuallyNew = pageItems.filter(isNewFilter);
                if (actuallyNew.length > 0) {
                    await this.addMediaToTasks(actuallyNew, registry);
                }
                // 每页落盘 staging，供断点续传恢复（收藏列表主体）
                await env.saveStaging(this.module, allItems);
            },
            fetchPage: async (pageIndex) => {
                const call = favoriteList(env.ctx, env.config, pageIndex);
                const text = await env.requester.get(call.url, call.params);
                const res = toJson<any>(text, /^_Callback\(/);
                if (res.code && res.code != 0) {
                    env.logger.warn('获取一页的收藏列表异常 | code=' + res.code, res.msg || '');
                }
                const data = res.data || {};
                const list = convertFavorites(data.fav_list || [], env.ctx.ownerUin, this.targetNickname);
                return { items: list, total: data.total_num || 0 };
            },
            // 无 ledger 时跳过页级记账（测试环境 ctx 未注入 ledger 时 recordPage 不应崩溃）
            reliability: ctx.ledger ? { ledger: ctx.ledger, uin: String(ctx.uin), module: this.module, batchId: ctx.batchId } : undefined,
            compensateOnly,
        });
    }

    /** 列表采集 + 合并/排序/落盘（runCollection 的统一后处理；retry 复用） */
    private async runCollection(ctx: CollectContext, compensateOnly: boolean): Promise<FavoriteItem[]> {
        const env = this.env;
        const cfg = env.config.Favorites;
        const oldItems = (await env.getOldData<FavoriteItem[]>(this.module)) || [];
        let items = await this.collectList(ctx, compensateOnly);
        items = unionBackedUpItems(cfg, oldItems, items);
        items = sortBy(items, cfg.IncrementField, true);
        await env.saveStaging(this.module, items);
        return items;
    }

    /** 断点补偿：仅重采 ledger 中 failed/missing 页，完成后重新合并/导出 */
    async retryFailedPages(ctx: CollectContext): Promise<void> {
        const env = this.env;
        const cfg = env.config.Favorites;
        const items = await this.runCollection(ctx, true);
        await env.report('export', 0, 1);
        await writeModuleOutputs(env, {
            module: 'Favorites',
            globalName: 'favorites',
            data: items,
            jsonJsPath: 'Favorites/json/favorites.js',
            jsonFilePath: 'Favorites/json/favorites.json',
            markdown: true,
        });
        await env.report('export', 1, 1);
    }

    /**
     * 添加多媒体下载任务（移植自 favorites.js addMediaToTasks L432-466）
     */
    private async addMediaToTasks(items: FavoriteItem[], registry: MediaTaskRegistry): Promise<void> {
        const env = this.env;
        for (const item of items) {
            if (!isNewItem(item)) {
                // 已备份数据计为已成功处理
                continue;
            }

            // 下载缩略配图与原始配图
            for (const image of item.custom_images || []) {
                await registry.add(image, image.url, MODULE_DIR, item);
            }
            for (const image of item.custom_origin_images || []) {
                await registry.add(image, image.url, MODULE_DIR, item);
            }

            // 下载视频预览图及视频
            await addVideoTasks(env, registry, item.custom_videos, MODULE_DIR, item);

            // 下载音乐预览图
            for (const audio of item.custom_audios || []) {
                await registry.add(audio, audio.preview_img, MODULE_DIR, item);
            }

            // 收藏正文/标题里的 QQ 表情（[em]e123[/em] → Common/images/e123.gif）
            // 与 MD/查看器对收藏内容的转换保持一致，缺了则离线备份看不了表情图
            await registry.addEmoticons([item.custom_abstract, item.title], item);
        }
        await env.report('media', items.length, items.length, undefined, undefined, { done: items.length, total: items.length });
    }
}
