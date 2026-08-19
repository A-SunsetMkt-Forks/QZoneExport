<script setup lang="ts">
import { computed } from 'vue';
import MediaGrid from '../MediaGrid.vue';
import { videoMediaOf, type MediaItem } from '../../data/media';

/**
 * 单个视频条目
 * 视频列表本身是整片封面网格（不分页），这里给个人中心的那年今日用：
 * 只渲染一个封面，点开即在大图查看器里带评论播放。
 */
const props = defineProps<{ item: Record<string, any> }>();

const medias = computed<MediaItem[]>(() => [videoMediaOf(props.item)]);
</script>

<template>
    <div class="card-item">
        <media-grid :medias="medias" />
    </div>
</template>
