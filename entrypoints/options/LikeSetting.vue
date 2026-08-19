<script setup lang="ts">
import { computed } from 'vue';
import { NFormItem, NSwitch } from 'naive-ui';
import IntervalSetting from './IntervalSetting.vue';

/**
 * 点赞列表配置（多个模块结构一致，故抽为共享组件）
 * note 用于补充模块特有的限制说明
 */
const props = defineProps<{ like: Record<string, any>; note?: string }>();

/** 是否继承公共（默认继承） */
const inheriting = computed(() => props.like.inherit !== false);
function setInherit(v: boolean): void {
    props.like.inherit = v ? undefined : false;
}
</script>

<template>
    <n-form-item label="点赞">
        <n-switch :value="inheriting" @update:value="setInherit" />
        <span class="hint">开启时沿用「通用默认」的点赞设置；关闭后可单独配置本模块</span>
    </n-form-item>
    <template v-if="!inheriting">
        <n-form-item label="点赞列表">
            <n-switch v-model:value="like.isGet" />
            <span class="hint">仅备份类型为 HTML 时写入{{ note ? '；' + note : '' }}</span>
        </n-form-item>
        <interval-setting v-if="like.isGet" :seconds="like.randomSeconds" label="点赞间隔" />
    </template>
</template>
