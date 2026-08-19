/**
 * 查看器侧的备份配置读取
 *
 * 背景：备份包根目录的 Common/json/config.js 挂了全局变量 QZone_Config（冻结的助手配置
 * 快照，含 Common.hasUserLink 等），但查看器此前从未读取它——用户链接在渲染层写死成
 * <a>，导致「是否生成用户链接」这个开关对查看器毫无作用。
 *
 * 这里在应用启动时加载一次配置，把 hasUserLink 暴露成响应式值，供渲染层统一门控。
 * 与展示偏好（displayPrefs.ts，存 localStorage、随看随改）不同，hasUserLink 是「备份时
 * 拍板」的单向配置，读冻结快照即可，无需可写。
 */

import { ref } from 'vue';
import { loadBackupConfig } from './sources';

/** 用户链接开关（Common.hasUserLink），默认开启以匹配导出默认值 */
const hasUserLink = ref(true);
let initialized = false;

/** 应用启动时调用一次：读取 QZone_Config 中的 hasUserLink 写入响应式值 */
export function initBackupConfig(): void {
    if (initialized) {
        return;
    }
    initialized = true;
    loadBackupConfig()
        .then((cfg) => {
            const v = cfg?.Common?.hasUserLink;
            if (typeof v === 'boolean') {
                hasUserLink.value = v;
            }
        })
        .catch(() => {
            /* 配置缺失：保持默认 true */
        });
}

export { hasUserLink };
