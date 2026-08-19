<script setup lang="ts">
import { onMounted, ref } from 'vue';

/**
 * 公告横幅（popup 顶部）
 * 读取 content script 已缓存的公告数据（chrome.storage.local），不自行发请求（popup 生命周期太短）。
 * 与页面悬浮卡片共享同一份已读记录。
 */

const ANN_CACHE_KEY = 'QZoneExport_AnnouncementCache';
const ANN_DISMISSED_KEY = 'QZoneExport_DismissedAnnouncements';

interface Announcement {
    id: string;
    level: 'info' | 'warning' | 'error';
    title: string;
    content: string;
    minVersion?: string;
    maxVersion?: string;
    dismissable?: boolean;
}

const LEVEL_COLORS = {
    info: { bg: '#eef4ff', border: '#3b6fd4', text: '#2c5aa0' },
    warning: { bg: '#fff7e6', border: '#d97706', text: '#92400e' },
    error: { bg: '#fef2f2', border: '#dc2626', text: '#991b1b' },
} as const;

const DEFAULT_COLOR = { bg: '#eef4ff', border: '#3b6fd4', text: '#2c5aa0' };

const visible = ref(false);
const announcement = ref<Announcement | null>(null);

onMounted(async () => {
    try {
        const stored = await chrome.storage.local.get([ANN_CACHE_KEY, ANN_DISMISSED_KEY]);
        let data: Announcement[] = [];

        // 优先读缓存，缓存为空时直接读本地捆绑文件（popup 是扩展页面，可直接 fetch）
        const cache = stored[ANN_CACHE_KEY] as { data: Announcement[]; ts: number } | undefined;
        if (cache && Array.isArray(cache.data) && cache.data.length > 0) {
            data = cache.data;
        } else {
            try {
                const res = await fetch(chrome.runtime.getURL('remote-config.json'));
                if (res.ok) {
                    const json = await res.json();
                    data = Array.isArray(json.announcements) ? json.announcements : [];
                    // 顺便缓存 presets（供采集器和 options 读取）
                    if (json.presets) {
                        await chrome.storage.local.set({ QZoneExport_Presets: json.presets });
                    }
                }
            } catch {
                // 本地文件不存在
            }
        }
        if (data.length === 0) return;

        const dismissed = (stored[ANN_DISMISSED_KEY] || []) as string[];
        const version = chrome.runtime.getManifest().version || '0.0.0';

        const pending = data.filter((ann) => {
            if (dismissed.includes(ann.id)) return false;
            if (ann.minVersion && version < ann.minVersion) return false;
            if (ann.maxVersion && version > ann.maxVersion) return false;
            return true;
        });
        if (pending.length === 0) return;

        // error 优先
        pending.sort((a, b) => {
            const order = { error: 0, warning: 1, info: 2 };
            return (order[a.level] ?? 2) - (order[b.level] ?? 2);
        });
        announcement.value = pending[0]!;
        visible.value = true;
    } catch {
        // 静默失败
    }
});

async function dismiss(): Promise<void> {
    visible.value = false;
    const ann = announcement.value;
    if (!ann) return;
    try {
        const s = await chrome.storage.local.get([ANN_DISMISSED_KEY]);
        const ids = (s[ANN_DISMISSED_KEY] || []) as string[];
        if (!ids.includes(ann.id)) {
            ids.push(ann.id);
            await chrome.storage.local.set({ [ANN_DISMISSED_KEY]: ids });
        }
    } catch {
        // 忽略
    }
}

function colors(): { bg: string; border: string; text: string } {
    const level = announcement.value?.level || 'info';
    return LEVEL_COLORS[level as keyof typeof LEVEL_COLORS] || DEFAULT_COLOR;
}
</script>

<template>
    <div
        v-if="visible && announcement"
        class="ann-banner"
        :style="{
            background: colors().bg,
            borderLeft: `3px solid ${colors().border}`,
            color: colors().text,
        }"
    >
        <div class="ann-body">
            <span class="ann-title">{{ announcement.title }}</span>
            <span class="ann-content">{{ announcement.content }}</span>
        </div>
        <button
            v-if="announcement.dismissable !== false"
            class="ann-close"
            type="button"
            @click="dismiss"
        >×</button>
    </div>
</template>

<style scoped>
.ann-banner {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin-bottom: 10px;
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.5;
}
.ann-body {
    flex: 1;
    min-width: 0;
}
.ann-title {
    font-weight: 600;
    margin-right: 6px;
}
.ann-content {
    word-break: break-word;
}
.ann-close {
    flex: none;
    width: 18px;
    height: 18px;
    border: none;
    background: none;
    font-size: 14px;
    line-height: 18px;
    text-align: center;
    cursor: pointer;
    color: inherit;
    opacity: 0.6;
    border-radius: 3px;
}
.ann-close:hover {
    opacity: 1;
    background: rgba(0, 0, 0, 0.06);
}
</style>
