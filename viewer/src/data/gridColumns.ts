import { onBeforeUnmount, ref, watch, type Ref } from 'vue';

/**
 * 按「固定项宽 + 间距」监听容器宽度并推算网格列数。
 *
 * 媒体网格用 `repeat(auto-fill, 160px)`，屏宽不同每行列数就不同；
 * 配合分页让每页条数取列数的整数倍，可保证最后一行铺满（不会出现缺几张的空位）。
 *
 * @param container 网格容器（或其外层包裹元素）的 ref
 * @param itemWidth 单项宽度，与 grid-template-columns 的固定值一致（默认 160）
 * @param gap 网格间距（默认 8）
 */
export function useGridColumns(container: Ref<HTMLElement | null>, itemWidth = 160, gap = 8): Ref<number> {
    const columns = ref(1);
    let observer: ResizeObserver | null = null;

    const compute = (el: HTMLElement) => {
        const width = el.clientWidth;
        if (width <= 0) {
            return;
        }
        // auto-fill 列数：floor((宽 + 间距) / (项宽 + 间距))
        columns.value = Math.max(1, Math.floor((width + gap) / (itemWidth + gap)));
    };

    // 容器在列表外壳的插槽里，挂载后才出现，故用 watch 而非 onMounted 直接取
    watch(container, (el) => {
        observer?.disconnect();
        observer = null;
        if (!el) {
            return;
        }
        compute(el);
        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(() => compute(el));
            observer.observe(el);
        }
    }, { immediate: true, flush: 'post' });

    onBeforeUnmount(() => observer?.disconnect());

    return columns;
}
