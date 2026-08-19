import PhotoSwipe from 'photoswipe';
import 'photoswipe/style.css';

/**
 * 通用大图查看（PhotoSwipe）
 *
 * 给「正文 HTML（v-html 渲染）」与「评论区配图」提供点击看大图的能力，复用 Messages
 * 媒体网格（MediaGrid）同一套 PhotoSwipe 实例（MIT，随产物打包，无 CDN）。
 *
 * 与 MediaGrid 的区别：这里不挂逐图评论面板，仅做图片浏览——正文 / 评论配图没有
 * 逐图独立的评论数据，也不需要右侧面板占位（否则图片会被面板遮住）。
 */

export interface LightboxImage {
    src: string;
    /** 缩略图（可选，默认用 src 本身） */
    thumb?: string;
}

const sizeCache = new Map<string, { width: number; height: number }>();

/** 实测图片宽高：PhotoSwipe 需要尺寸才能正确缩放；读不到时给常见比例兜底 */
function measure(src: string): Promise<{ width: number; height: number }> {
    const cached = sizeCache.get(src);
    if (cached) {
        return Promise.resolve(cached);
    }
    return new Promise((resolve) => {
        const image = new Image();
        image.addEventListener('load', () => {
            const size = { width: image.naturalWidth || 1200, height: image.naturalHeight || 900 };
            sizeCache.set(src, size);
            resolve(size);
        });
        image.addEventListener('error', () => resolve({ width: 1200, height: 900 }));
        image.src = src;
    });
}

/**
 * 打开大图查看
 * @param images 图片列表（同一组里点击任一张都能左右切换）
 * @param startIndex 默认打开第几张（点击的那张）
 */
export async function openImageLightbox(images: LightboxImage[], startIndex = 0): Promise<void> {
    if (!images.length) {
        return;
    }
    const dataSource = await Promise.all(
        images.map(async (img) => {
            const size = await measure(img.src);
            return { src: img.src, width: size.width, height: size.height };
        }),
    );
    const pswp = new PhotoSwipe({
        dataSource,
        index: Math.max(0, Math.min(startIndex, images.length - 1)),
        bgOpacity: 0.92,
        showHideAnimationType: 'fade',
    });
    pswp.init();
}
