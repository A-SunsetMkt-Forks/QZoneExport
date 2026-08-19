<script setup lang="ts">
import { computed } from 'vue';
import { navigate } from '../../router';
import { photoMediaOf, type MediaItem } from '../../data/media';
import MediaGrid from '../MediaGrid.vue';

/**
 * 一批相片（那年今日专用）
 *
 * 相片往往一次批量上传几十张，逐张列出会把面板刷满，所以按清单要求：
 * 最多显示 9 张（类似说说的九宫格），标题按相片的既有规范写成
 * 「在某相册上传了 N 张相片」。
 */
const props = defineProps<{
    album: Record<string, any>;
    photos: Record<string, any>[];
}>();

/** 最多九张，超出的只在标题里体现数量 */
const LIMIT = 9;

const medias = computed<MediaItem[]>(() => props.photos
    .slice(0, LIMIT)
    .map((photo) => photoMediaOf(photo))
    .filter((media) => !!media.src));

const albumName = computed(() => String(props.album?.name || '相册'));
</script>

<template>
    <div class="card-item">
        <div class="item-head">
            <a class="album-link" @click="navigate('albums', { id: String(props.album?.id || '') })">
                {{ albumName }}
            </a>
            <span class="item-desc">上传了 {{ props.photos.length }} 张相片</span>
            <span v-if="props.photos.length > LIMIT" class="item-more">
                （仅显示前 {{ LIMIT }} 张）
            </span>
        </div>
        <media-grid :medias="medias" />
    </div>
</template>

<style scoped>
.item-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
}
.album-link {
    color: #2080f0;
    font-weight: 600;
    cursor: pointer;
}
.item-desc {
    color: var(--text-secondary);
    font-size: 13px;
}
.item-more {
    color: var(--text-subtle);
    font-size: 12px;
}
</style>
