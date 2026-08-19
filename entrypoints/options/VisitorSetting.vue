<script setup lang="ts">
import { computed } from 'vue';
import { NFormItem, NSwitch } from 'naive-ui';
import IntervalSetting from './IntervalSetting.vue';

/** 内容访客配置（多个模块结构一致，故抽为共享组件） */
const props = defineProps<{ visitor: Record<string, any> }>();

/** 是否继承公共（默认继承） */
const inheriting = computed(() => props.visitor.inherit !== false);
function setInherit(v: boolean): void {
    props.visitor.inherit = v ? undefined : false;
}
</script>

<template>
    <n-form-item label="内容访客">
        <n-switch :value="inheriting" @update:value="setInherit" />
        <span class="hint">开启时沿用「通用默认」的内容访客设置；关闭后可单独配置本模块</span>
    </n-form-item>
    <template v-if="!inheriting">
        <n-form-item label="内容访客列表">
            <n-switch v-model:value="visitor.isGet" />
            <span class="hint">嵌入各内容条目的访客记录（区别于「访客」模块的空间访客列表），仅 HTML 时写入；理论上仅最近 1000 条（需开通黄钻）</span>
        </n-form-item>
        <interval-setting v-if="visitor.isGet" :seconds="visitor.randomSeconds" label="内容访客间隔" />
    </template>
</template>
