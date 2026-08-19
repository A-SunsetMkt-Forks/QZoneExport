import { computed, type Ref } from 'vue';
import { routeQuery, routeName, navigate } from '../router';
import { visitorUsers } from './content';

/**
 * 统一的「按浏览者过滤」能力。
 *
 * 互动面板的「我/TA 浏览过」卡片跳转时携带 ?visitor=UIN，
 * 模块页接入本 composable 后，进入即自动只显示该 UIN 浏览过的条目清单。
 *
 * @param items 模块页已加载的条目列表（相册页传 albums，其余传对应 list）
 */
export function useVisitorFilter(items: Ref<Record<string, any>[]>) {
    const visitorUin = computed(() => routeQuery.value.visitor || '');
    const hasVisitor = computed(() => !!visitorUin.value);

    /** 传给 ListPage 的 :filter 谓词；无 visitor 参数时放行全部条目 */
    const filter = computed(() => (item: Record<string, any>) => {
        if (!visitorUin.value) return true;
        return visitorUsers(item).some((v) => String(v.uin) === visitorUin.value);
    });

    /** 尽力从条目浏览者名单里提取该 UIN 对应的昵称（仅用于提示条展示，取不到则回退 UIN） */
    const visitorName = computed(() => {
        if (!visitorUin.value) return '';
        for (const item of items.value) {
            const v = visitorUsers(item).find((x) => String(x.uin) === visitorUin.value);
            if (v?.name) return v.name;
        }
        return '';
    });

    /** 清除筛选：回到当前模块页（不带 visitor 参数） */
    function clearVisitor(): void {
        navigate(routeName.value);
    }

    return { visitorUin, hasVisitor, filter, visitorName, clearVisitor };
}
