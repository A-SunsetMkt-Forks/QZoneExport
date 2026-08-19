<template>
    <!--
        用户链接：hasUserLink 开启时渲染可点击的 <a>，关闭时退化为 <span> 纯文本。
        通过单根 <component> 切换标签，保证父级 class（如 item-name / visited-card）稳定落到根元素。
    -->
    <component
        :is="resolvedHref ? 'a' : 'span'"
        :href="resolvedHref || undefined"
        :target="resolvedHref ? '_blank' : undefined"
        rel="noreferrer"
    >
        <slot />
    </component>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { hasUserLink } from '../data/backupConfig';
import { userUrl } from '../data/content';

const props = defineProps<{
    /** 空间用户 uin（与 href 二选一）；传入则链接指向其空间主页 */
    uin?: string | number | null;
    /** 原始链接（如收藏原日志地址）；优先级高于 uin */
    href?: string;
}>();

const resolvedHref = computed(() => {
    if (!hasUserLink.value) {
        return undefined;
    }
    if (props.href) {
        return props.href;
    }
    if (props.uin != null && props.uin !== '') {
        return userUrl(props.uin);
    }
    return undefined;
});
</script>
