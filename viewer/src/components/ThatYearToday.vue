<script setup lang="ts">
import { computed } from 'vue';
import { NCollapse, NCollapseItem, NTag } from 'naive-ui';
import { formatTime } from '../data/format';
import { thatYearToday } from '../data/thatYearToday';

/**
 * 模块内的那年今日
 *
 * 与个人中心的全站聚合同源，但只算当前模块。每条回忆通过作用域插槽（#item）交给调用方渲染，
 * 调用方复用列表页同款的条目组件，保证与列表完全一致的展示效果——不再另写一份单行摘要，
 * 避免两套渲染长歪。
 * 与旧版一样按打开当天现算，不看备份时的 hasThatYearToday 开关。
 */
const props = defineProps<{
    items: Record<string, any>[];
    /** 取记录时间 */
    timeOf: (item: Record<string, any>) => any;
}>();

/** 作用域插槽：调用方拿到单条原始数据，用列表同款条目组件渲染 */
defineSlots<{
    item(props: { item: Record<string, any> }): any;
}>();

const groups = computed(() => thatYearToday(props.items, props.timeOf));
const total = computed(() => groups.value.reduce((sum, group) => sum + group.items.length, 0));
</script>

<template>
    <!-- 无往年记录时整块不渲染：空模块里显示「今天没有往年的记录」纯属噪音 -->
    <div v-if="total > 0" class="year-block">
        <n-collapse :default-expanded-names="[]">
            <n-collapse-item :title="`那年今日（${total}）`" name="year">
                <div v-for="group in groups" :key="group.year" class="year">
                    <div class="year-title">{{ group.year }} 年</div>
                    <div v-for="(item, index) in group.items" :key="index" class="memory">
                        <n-tag class="memory-time" size="tiny" :bordered="false">
                            {{ formatTime(props.timeOf(item)).slice(5, 16) }}
                        </n-tag>
                        <div class="memory-body">
                            <slot name="item" :item="item" />
                        </div>
                    </div>
                </div>
            </n-collapse-item>
        </n-collapse>
    </div>
</template>

<style scoped>
.year-block {
    margin-bottom: 14px;
    padding: 6px 14px;
    background: var(--bg-page);
    border-left: 3px solid #2080f0;
    border-radius: 2px;
}
.empty {
    margin: 4px 0;
    font-size: 13px;
    color: var(--text-muted);
}

.year + .year {
    margin-top: 10px;
}

.year-title {
    margin-bottom: 4px;
    font-size: 13px;
    color: var(--text-secondary);
}

/* 一条回忆：左侧时间标签，右侧是调用方提供的完整条目卡片 */
.memory {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 4px 0;
}

.memory-time {
    flex: none;
    margin-top: 12px;
}

.memory-body {
    flex: 1;
    min-width: 0;
}

/* 条目卡片在面板里改成白底，与面板的浅绿底分开 */
.memory-body :deep(.card-item) {
    margin-bottom: 0;
    background: var(--bg-primary);
}
</style>
