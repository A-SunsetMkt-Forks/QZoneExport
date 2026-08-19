<script setup lang="ts">
import { computed } from 'vue';
import { NTag } from 'naive-ui';
import { assetUrl } from '../../data/sources';
import { formatTime } from '../../data/format';
import { favoriteReason, favoriteTypeLabel, imageUrl } from '../../data/content';
import { formatText } from '../../data/richText';
import { hasUserLink } from '../../data/backupConfig';
import MediaGrid from '../MediaGrid.vue';
import type { MediaItem } from '../../data/media';

/**
 * 单条收藏
 * 收藏的内容类型较杂（说说/日志/分享/照片/网页/文字），正文字段随类型不同，
 * 取值优先级参照旧模板 src/templates/favorites.html；
 * 抽出来供收藏列表页与个人中心的那年今日共用。
 */
const props = defineProps<{ item: Record<string, any> }>();

/** 收藏的说说（type=5）与分享（type=7）媒体走九宫格，与说说/分享列表一致 */
const isNineGrid = computed(() => {
    const type = Number(props.item.type);
    return type === 5 || type === 7;
});

/** 正文：说说取详情内容，其余取摘要 */
function contentOf(item: Record<string, any>): string {
    if (Number(item.type) === 5 && item.shuoshuo_info?.detail_shuoshuo_info?.content) {
        return item.shuoshuo_info.detail_shuoshuo_info.content;
    }
    return item.abstract || item.desp || '';
}

/**
 * 原内容链接（需联网）
 * 日志类收藏旧页会把标题链到原日志，靠 blog_info 的 owner_uin + id 拼地址。
 */
function sourceLink(item: Record<string, any>): string {
    if (!hasUserLink.value) {
        return '';
    }
    const blog = item.blog_info;
    if (blog?.owner_uin && blog?.id) {
        return `https://user.qzone.qq.com/${blog.owner_uin}/blog/${blog.id}`;
    }
    return item.url || '';
}

/** 收藏里的媒体：图片，以及带 play_url 的外部视频（旧页同样只能跳原站） */
function mediasOf(item: Record<string, any>): MediaItem[] {
    const medias: MediaItem[] = [];
    for (const video of item.custom_videos || item.videos || []) {
        const poster = assetUrl(video.custom_pre_filepath || video.preview_img);
        if (video.play_url) {
            medias.push({ type: 'video', src: poster, poster, link: video.play_url });
            continue;
        }
        const src = assetUrl(video.custom_filepath || video.url);
        if (src) {
            medias.push({ type: 'video', src, poster });
        }
    }
    const images = item.custom_origin_images || item.custom_images || item.images || [];
    for (const image of images) {
        const src = imageUrl(image);
        if (src) {
            medias.push({ type: 'image', src });
        }
    }
    return medias;
}
</script>

<template>
    <div class="card-item">
        <div class="item-head">
            <n-tag size="small" :bordered="false" type="warning">{{ favoriteTypeLabel(props.item) }}</n-tag>
            <span class="item-time">
                {{ formatTime(props.item.custom_create_time || props.item.create_time) }}
            </span>
        </div>

        <div
            v-if="favoriteReason(props.item)"
            class="item-text"
            v-html="formatText(favoriteReason(props.item))"
        />

        <div class="source">
            <a
                v-if="props.item.title && sourceLink(props.item)"
                class="source-title"
                :href="sourceLink(props.item)"
                target="_blank"
                rel="noreferrer"
            >{{ props.item.title }}</a>
            <div v-else-if="props.item.title" class="source-title">{{ props.item.title }}</div>
            <div v-if="contentOf(props.item)" class="item-text" v-html="formatText(contentOf(props.item))" />
            <media-grid :medias="mediasOf(props.item)" :nine-grid="isNineGrid" />
        </div>
    </div>
</template>

<style scoped>
.item-head {
    display: flex;
    align-items: center;
    gap: 10px;
}
.item-time {
    color: var(--text-muted);
    font-size: 12px;
}
.item-text {
    margin: 6px 0 0;
    font-family: inherit;
    line-height: 1.7;
    white-space: pre-wrap;
    word-break: break-word;
}
/* 被收藏的内容作为引用块 */
.source {
    margin-top: 8px;
    padding: 8px 10px;
    background: var(--bg-toolbar);
    border-left: 3px solid var(--border-dashed);
}
.source-title {
    font-weight: 600;
    word-break: break-word;
}
</style>
