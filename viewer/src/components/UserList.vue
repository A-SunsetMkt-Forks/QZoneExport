<script setup lang="ts">
import { NEmpty, NTag } from 'naive-ui';
import UserAvatar from './UserAvatar.vue';
import UserLink from './UserLink.vue';

/** 用户列表（点赞名单、最近访问名单共用） */
const props = defineProps<{
    users: { uin?: string | number; name?: string; isFriend?: boolean }[];
    emptyText?: string;
}>();
</script>

<template>
    <n-empty v-if="props.users.length === 0" :description="props.emptyText || '没有记录'" />
    <div v-else class="user-list">
        <user-link
            v-for="(user, index) in props.users"
            :key="index"
            class="user"
            :uin="user.uin"
        >
            <user-avatar :uin="user.uin" :size="40" :link="false" />
            <div class="meta">
                <div class="name">{{ user.name || user.uin }}</div>
                <div class="uin">{{ user.uin }}</div>
            </div>
            <n-tag :type="user.isFriend ? 'success' : 'default'" size="small">
                {{ user.isFriend ? '好友' : '路人' }}
            </n-tag>
        </user-link>
    </div>
</template>

<style scoped>
.user-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.user {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border: 1px solid var(--border-light);
    border-radius: 4px;
    color: inherit;
    text-decoration: none;
}

.user:hover {
    background: var(--bg-toolbar);
}

.meta {
    flex: 1;
    min-width: 0;
}

.name {
    font-size: 14px;
}

.uin {
    font-size: 12px;
    color: var(--text-muted);
}
</style>
