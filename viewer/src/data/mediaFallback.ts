import { assetUrl } from './sources';

/**
 * 图片 / 视频加载失败时的「最终兜底」占位图
 *
 * 媒体（相片、视频）可能因为网络问题下载失败，或服务器返回 404 导致文件缺失；
 * 直接暴露浏览器的「破图」图标体验很差，故统一换成这张明确传达「该资源不存在」
 * 的占位图。
 *
 * 注意：头像有独立的兜底逻辑（UserAvatar 失败即隐藏），此处排除，
 * 避免把头像缺失误标成「媒体不存在」。
 */
export const MEDIA_MISSING = assetUrl('Common/images/media_missing.png');

/** 该元素是否应走媒体兜底（仅图片 / 视频，且排除头像） */
function isMediaTarget(el: EventTarget | null): el is HTMLImageElement | HTMLVideoElement {
    if (!(el instanceof HTMLImageElement) && !(el instanceof HTMLVideoElement)) {
        return false;
    }
    // 头像：UserAvatar 内部已处理（回退在线地址或隐藏），不在此覆盖
    if (el.closest('.avatar')) {
        return false;
    }
    // 表情：emoticonImg 自带「本地→在线→占位图」三级兜底（外链模式下本地缺失要能取到在线图），
    // 若此处提前用占位图覆盖会停在占位图、取不到在线表情，故排除。
    if (el.closest('.emoticon')) {
        return false;
    }
    return true;
}

/**
 * 资源加载失败的全局统一兜底
 *
 * 使用方式：在 document 上以 capture 阶段注册 error 监听器即可覆盖全站所有图片/视频：
 *   document.addEventListener('error', onMediaError, true);
 *
 * 为什么用 capture 而非冒泡？
 *   <img> / <video> 的 load/error 事件不冒泡（bubbles=false），但可在捕获阶段于祖先拦截；
 *   挂在 document 上的 capture 监听能捕获包括 PhotoSwipe 动态追加到 body 的 DOM 在内的全部媒体元素。
 *
 * 防循环机制：
 *   对已替换过一次的元素打 dataset 标记；占位图自身若也加载失败则直接跳过。
 */
export function onMediaError(event: Event): void {
    const el = event.target;
    if (!isMediaTarget(el)) {
        return;
    }
    // 已应用过一次兜底的元素不再重复触发（防止对占位图自身循环）
    if (el.dataset.mediaFallback === '1') {
        return;
    }
    el.dataset.mediaFallback = '1';
    if (el instanceof HTMLImageElement) {
        el.onerror = null;
        el.src = MEDIA_MISSING;
    } else {
        // <video> 无可用源时：将 poster 设为占位图作为封面，避免黑屏/破片
        el.onerror = null;
        el.poster = MEDIA_MISSING;
    }
}
