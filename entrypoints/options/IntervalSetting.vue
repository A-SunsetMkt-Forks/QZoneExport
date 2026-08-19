<script setup lang="ts">
import { NFormItem, NInputNumber } from 'naive-ui';

/** 绑定 {min,max} 随机间隔秒数对象 */
defineProps<{ seconds: { min: number; max: number }; label?: string; disabled?: boolean }>();
</script>

<template>
    <n-form-item :label="label || '查询间隔'">
        <n-input-number v-model:value="seconds.min" :min="0" :disabled="disabled" style="width: 110px;" />
        <span class="sep">~</span>
        <n-input-number v-model:value="seconds.max" :min="0" :disabled="disabled" style="width: 110px;" />
        <span class="hint">秒（每次请求的随机间隔，过快易被风控）</span>
    </n-form-item>
</template>

<style scoped>
.sep {
    margin: 0 8px;
}
</style>
