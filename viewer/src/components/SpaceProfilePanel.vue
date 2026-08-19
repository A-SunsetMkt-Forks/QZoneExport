<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { buildSpaceProfileRows } from '../data/spaceProfile';

const props = defineProps<{
    /** 个人档原始对象（Common/json/user.js 的 window.userInfo），字段缺失时整段不渲染 */
    user: Record<string, any> | null;
}>();

/** 空间资料渲染行；空数组时不渲染面板 */
const rows = computed(() => buildSpaceProfileRows(props.user));

// ── 隐私模式：隐藏资料值（标签保留，值以掩码显示，不可选中复制）──
const STORAGE_KEY = 'qze_space_profile_private';
const hidden = ref(false);

function loadHidden(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
        return false; // file:// 下 localStorage 可能受限，忽略即可
    }
}
function persistHidden(value: boolean): void {
    try {
        if (value) localStorage.setItem(STORAGE_KEY, '1');
        else localStorage.removeItem(STORAGE_KEY);
    } catch {
        /* file:// 下 localStorage 可能受限，忽略即可 */
    }
}

onMounted(() => {
    hidden.value = loadHidden();
});

function toggleHidden(): void {
    hidden.value = !hidden.value;
    persistHidden(hidden.value);
}
</script>

<template>
    <div v-if="rows.length" class="space-profile">
        <div class="section-title-sm">
            <span class="sp-icon">👤</span> 空间资料
            <button
                class="privacy-toggle"
                type="button"
                :aria-label="hidden ? '显示资料隐私信息' : '隐藏资料隐私信息'"
                :title="hidden ? '显示资料隐私信息' : '隐藏资料隐私信息'"
                @click="toggleHidden"
            >
                <svg
                    v-if="!hidden"
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                </svg>
                <svg
                    v-else
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
            </button>
        </div>
        <dl class="profile-grid">
            <template v-for="row in rows" :key="row.label">
                <div
                    class="profile-item"
                    :class="{ 'profile-item-wide': row.label === '个性签名' }"
                >
                    <dt class="profile-label">{{ row.label }}</dt>
                    <dd class="profile-value" :class="{ masked: hidden }">
                        {{ hidden ? '•••••' : row.value }}
                    </dd>
                </div>
            </template>
        </dl>
    </div>
</template>

<style scoped>
.space-profile {
    margin-bottom: 20px;
}
.section-title-sm {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 10px;
}
.sp-icon {
    font-size: 15px;
}
/* 眼睛按钮：与主题切换按钮同风格，紧贴「空间资料」标题文字右侧 */
.privacy-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border-light, var(--border-card));
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.2s, color 0.2s, border-color 0.2s;
}
.privacy-toggle:hover {
    background: var(--bg-toolbar, transparent);
    color: var(--accent, #2080f0);
    border-color: var(--accent, #2080f0);
}
/* 两列网格：每格 = 标签(小字灰) + 值(主色)；个性签名跨整行 */
.profile-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 18px;
    margin: 0;
    padding: 14px 18px;
    background: var(--bg-primary);
    border: 1px solid var(--border-card);
    border-radius: 8px;
    box-sizing: border-box;
}
.profile-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
}
.profile-item-wide {
    grid-column: 1 / -1;
}
.profile-label {
    flex: none;
    font-size: 12px;
    color: var(--text-muted);
    /* 固定宽度，让多行的「值」左对齐 */
    min-width: 48px;
}
.profile-value {
    margin: 0;
    font-size: 13px;
    color: var(--text-primary);
    font-weight: 500;
    word-break: break-word;
}
/* 隐私模式：值以掩码呈现，且不可选中复制 */
.profile-value.masked {
    color: var(--text-muted);
    letter-spacing: 2px;
    user-select: none;
}

/* 平板及以下：单列，避免两列挤压 */
@media (max-width: 780px) {
    .profile-grid {
        grid-template-columns: minmax(0, 1fr);
        gap: 8px 0;
    }
}
/* 手机：标签与值上下排布更紧凑 */
@media (max-width: 580px) {
    .profile-grid {
        padding: 12px 14px;
    }
    .profile-item {
        flex-direction: column;
        gap: 1px;
    }
    .profile-label {
        min-width: 0;
    }
}
</style>
