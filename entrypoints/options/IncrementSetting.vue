<script setup lang="ts">
import { computed } from 'vue';
import { NAlert, NDatePicker, NFormItem, NSelect, NSwitch } from 'naive-ui';

/** 绑定某模块配置对象，读写其 IncrementType / IncrementTime（IncrementTime 为字符串） */
const props = defineProps<{ module: Record<string, any> }>();

const INCREMENT_OPTIONS = [
    { label: '全部数据', value: 'Full' },
    { label: '上次之后', value: 'LastTime' },
    { label: '指定时间', value: 'Custom' },
];

/** 是否继承公共（默认继承） */
const inheriting = computed(() => props.module.IncrementInherit !== false);
function setInherit(v: boolean): void {
    props.module.IncrementInherit = v ? undefined : false;
}
</script>

<template>
    <n-form-item label="增量备份">
        <n-switch :value="inheriting" @update:value="setInherit" />
        <span class="hint">开启时沿用「通用默认」的增量设置；关闭后可单独配置本模块</span>
    </n-form-item>
    <template v-if="!inheriting">
        <n-form-item label="备份范围">
            <n-select v-model:value="module.IncrementType" :options="INCREMENT_OPTIONS" style="width: 160px;" />
            <span class="hint">全部数据：完整备份；上次之后：仅采集上次备份后新增的内容；指定时间：采集该时间点之后的内容</span>
        </n-form-item>
        <n-form-item v-if="module.IncrementType === 'Custom'" label="起始时间">
            <n-date-picker
                v-model:formatted-value="module.IncrementTime"
                value-format="yyyy-MM-dd HH:mm:ss"
                type="datetime"
                style="width: 220px;"
            />
            <span class="hint">仅采集该时间之后发布的内容</span>
        </n-form-item>
        <n-alert v-if="module.IncrementType !== 'Full'" type="warning" :show-icon="true" class="block-alert">
            非全量模式只采集新增内容，上次备份的文件必须保留并与本次产物合并才能得到完整备份；若上次备份已删除，需重新做一次「全部数据」备份。
        </n-alert>
    </template>
</template>
