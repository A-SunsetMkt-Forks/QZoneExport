<script setup lang="ts">
import { computed } from 'vue';
import { NFormItem, NSwitch, NInputNumber } from 'naive-ui';
import IntervalSetting from './IntervalSetting.vue';

/**
 * 评论配置（全模块统一：isGet 是否获取评论）
 * 开启后拉取全部评论；关闭则跳过全量翻页——部分模块（说说/日志/日记/分享）列表自带少量首页评论，仍可能保留。
 */
const props = defineProps<{
    comments: Record<string, any>;
    min?: number;
    max?: number;
}>();

/** 是否继承公共（默认继承） */
const inheriting = computed(() => props.comments.inherit !== false);
function setInherit(v: boolean): void {
    props.comments.inherit = v ? undefined : false;
}
const enabled = computed(() => props.comments.isGet);
</script>

<template>
    <n-form-item label="评论">
        <n-switch :value="inheriting" @update:value="setInherit" />
        <span class="hint">开启时沿用「通用默认」的评论设置；关闭后可单独配置本模块</span>
    </n-form-item>
    <template v-if="!inheriting">
        <n-form-item label="获取评论">
            <n-switch v-model:value="comments.isGet" />
            <span class="hint">开启后拉取全部评论；部分模块（说说/日志/日记/分享）列表自带少量首页评论，关闭时仍可能保留</span>
        </n-form-item>
        <interval-setting v-if="enabled" :seconds="comments.randomSeconds" label="评论间隔" />
        <n-form-item label="评论每页">
            <n-input-number v-model:value="comments.pageSize" :min="min ?? 1" :max="max ?? 100" style="width: 160px;" />
        </n-form-item>
    </template>
</template>
