<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { NButton } from 'naive-ui';

/**
 * 首次使用分步引导浮层
 *
 * 用「聚光灯」方式：半透明遮罩压暗整个 popup，被引导的元素通过抬高 z-index + 高亮环
 * 浮到遮罩之上，配合一张分步说明卡片。只在首次打开时展示（由调用方按 localStorage 控制）。
 * target 是 popup 内的 CSS 选择器，缺省则只居中显示卡片（如欢迎步）。
 */
export interface GuideStep {
    title: string;
    body: string;
    /** 高亮目标（popup 内的 CSS 选择器，可选） */
    target?: string;
}

const props = defineProps<{ steps: GuideStep[] }>();
const emit = defineEmits<{ finish: [] }>();

const index = ref(0);
const current = computed(() => props.steps[index.value]);
const isLast = computed(() => index.value >= props.steps.length - 1);

/** 当前高亮的元素，切步/卸载时需还原 */
let highlighted: Element | null = null;

function clearHighlight(): void {
    if (highlighted) {
        highlighted.classList.remove('guide-highlight');
        highlighted = null;
    }
}

function applyHighlight(): void {
    clearHighlight();
    const selector = current.value?.target;
    if (!selector) {
        return;
    }
    const el = document.querySelector(selector);
    if (el) {
        el.classList.add('guide-highlight');
        highlighted = el;
        el.scrollIntoView({ block: 'nearest' });
    }
}

watch(index, () => nextTick(applyHighlight));
onMounted(() => nextTick(applyHighlight));
onBeforeUnmount(clearHighlight);

function next(): void {
    if (isLast.value) {
        finish();
    } else {
        index.value++;
    }
}

function prev(): void {
    if (index.value > 0) {
        index.value--;
    }
}

function finish(): void {
    clearHighlight();
    emit('finish');
}
</script>

<template>
    <div class="guide-mask">
        <div class="guide-card">
            <div class="guide-step">第 {{ index + 1 }} / {{ steps.length }} 步</div>
            <div class="guide-title">{{ current.title }}</div>
            <p class="guide-body">{{ current.body }}</p>
            <div class="guide-actions">
                <n-button size="small" text @click="finish">跳过引导</n-button>
                <div class="guide-nav">
                    <n-button v-if="index > 0" size="small" @click="prev">上一步</n-button>
                    <n-button size="small" type="primary" @click="next">
                        {{ isLast ? '我知道了' : '下一步' }}
                    </n-button>
                </div>
            </div>
        </div>
    </div>
</template>

<!-- 高亮环作用在 popup 内的其它元素上，必须是非 scoped 全局样式 -->
<style>
.guide-highlight {
    position: relative;
    z-index: 10001;
    border-radius: 6px;
    /* 白底 + 绿环，使元素从压暗的遮罩上「浮」出来 */
    box-shadow: 0 0 0 4px #fff, 0 0 0 6px #2080f0, 0 4px 16px rgba(0, 0, 0, 0.25);
    background: #fff;
}
</style>

<style scoped>
.guide-mask {
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 12px;
    box-sizing: border-box;
}
.guide-card {
    z-index: 10002;
    width: 100%;
    max-width: 420px;
    padding: 14px 16px;
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3);
}
.guide-step {
    font-size: 12px;
    color: #2080f0;
    font-weight: 600;
}
.guide-title {
    margin: 4px 0 6px;
    font-size: 15px;
    font-weight: 600;
}
.guide-body {
    margin: 0;
    font-size: 13px;
    line-height: 1.7;
    color: #555;
}
.guide-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 14px;
}
.guide-nav {
    display: flex;
    gap: 8px;
}
</style>
