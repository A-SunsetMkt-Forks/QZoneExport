/**
 * 极简 hash 路由
 *
 * 备份包用 file:// 打开，history 路由无法工作，只能用 hash；
 * 需求只有「切页 + 带参数」，故不引入 vue-router，避免查看器多背一个依赖。
 */
import { computed, ref } from 'vue';

/** 当前路由：#/messages、#/album?id=xxx */
const raw = ref(location.hash.replace(/^#\/?/, ''));

window.addEventListener('hashchange', () => {
    raw.value = location.hash.replace(/^#\/?/, '');
});

/** 页面名（默认首页） */
export const routeName = computed(() => (raw.value.split('?')[0] || 'home'));

/** 查询参数 */
export const routeQuery = computed(() => {
    const query = raw.value.split('?')[1] || '';
    return Object.fromEntries(new URLSearchParams(query).entries());
});

/**
 * 过滤查询参数里的空值：值为 undefined / null / 空串 的参数不拼进 URL。
 * 避免各页把未填的参数（如他人空间场景下的 qq=undefined）写进地址栏。
 */
function buildQuery(query?: Record<string, string>): string {
    if (!query) return '';
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && String(v) !== '') out[k] = String(v);
    }
    return Object.keys(out).length ? '?' + new URLSearchParams(out).toString() : '';
}

/** 跳转 */
export function navigate(name: string, query?: Record<string, string>): void {
    location.hash = '#/' + name + buildQuery(query);
}

/**
 * 在新标签页打开查看器内页面（不覆盖当前页）。
 * 备份查看器以 file:// 打开、hash 路由，直接改 location.hash 只会替换当前页；
 * 这里基于当前 URL 去掉 hash 部分后拼出目标 #/hash 再用 window.open('_blank') 打开。
 */
export function openInNewTab(name: string, query?: Record<string, string>): void {
    const base = location.href.split('#')[0];
    window.open(base + '#/' + name + buildQuery(query), '_blank', 'noopener');
}
