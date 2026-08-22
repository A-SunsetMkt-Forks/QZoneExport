import '../core/shared/polyfill';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { createPanel } from './backup-panel/api';

/**
 * 备份进度面板（Shadow DOM，MV3）
 *
 * 三 Tab 结构：概览 / 媒体 / 日志 / 支持作者。
 * 向下兼容旧版 content.js 的 window.__QZ_BACKUP_PANEL__ API。
 *
 * 模块拆分：
 *   backup-panel/types.ts      — 类型定义
 *   backup-panel/constants.ts  — 阶段名、过滤词、状态标签
 *   backup-panel/utils.ts      — 格式化 / 转义
 *   backup-panel/styles.ts     — Shadow DOM 样式
 *   backup-panel/template.ts   — HTML 模板
 *   backup-panel/context.ts    — 渲染上下文 & LiveTask
 *   backup-panel/renderers/    — 各 Tab 渲染器
 *   backup-panel/api.ts        — createPanel 工厂 + BackupPanelAPI 实现
 */

export default defineContentScript({
    matches: ['https://*.qzone.qq.com/*'],
    main() {
        const { host } = createPanel();
        document.documentElement.appendChild(host);
    },
});
