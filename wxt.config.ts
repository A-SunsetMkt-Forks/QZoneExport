import { defineConfig } from 'wxt';

/**
 * v3 全面 TS 化（Phase 8+）：
 * - 采集引擎：core/collector/modules/* (TS) — 10 个模块全部重写
 * - 下载管理：core/downloader/manager.ts (TS) — 替代旧 download-manager.js
 * - 备份编排：entrypoints/engine-bridge.content.ts (TS) — 替代旧 content.js
 * - 进度面板：entrypoints/backup-panel.content.ts (TS, Shadow DOM)
 * - 旧 JS 全局 polyfill (utils.js/config.js) 已移除，日期格式化改用 core/shared/format.ts
 * - vendor: aria2.js (纯 JSON-RPC 客户端，无 Chrome 专有依赖)
 */
export default defineConfig({
    srcDir: '.',
    entrypointsDir: 'entrypoints',
    publicDir: 'public',
    outDir: '.output',
    // 输出子目录名（默认 {{browser}}-mv{{manifestVersion}}，即 chrome-mv3），统一改为项目名
    outDirTemplate: 'QZoneExport',
    modules: ['@wxt-dev/module-vue'],
    manifest: {
        name: 'QQ空间导出助手',
        description:
            'QQ空间导出助手，用于导出备份QQ空间的说说、日志、日记、相册、视频、留言、好友、收藏、分享、访客为文件，便于迁移与保存',
        homepage_url: 'https://github.com/ShunCai/QZoneExport',
        icons: {
            128: 'img/icon.png',
        },
        action: {
            default_icon: 'img/icon.png',
            default_title: 'QQ空间导出助手',
            default_popup: 'popup.html',
        },
        // 注意：options_ui / default_popup 等由对应入口自动生成并覆盖此处，
        // 若需调整（如 open_in_tab），请改入口 HTML 的 <meta name="manifest.*">
        content_scripts: [
            {
                matches: ['https://*.qzone.qq.com/*'],
                js: [
                    'vendor/aria2/aria2.js',
                ],
            },
        ],
        web_accessible_resources: [
            {
                // viewer/* 为备份查看器产物，备份时由内容脚本读取并写入备份目录，
                // 故必须对 qzone 页面可访问
                resources: ['vendor/*', 'viewer/*', 'img/*', 'remote-config.json'],
                matches: ['https://*.qzone.qq.com/*'],
            },
        ],
        permissions: [
            'activeTab',
            'alarms',
            'cookies',
            'notifications',
            'storage',
            'unlimitedStorage',
            'downloads',
            'clipboardWrite',
            'declarativeNetRequest',
        ],
        host_permissions: ['<all_urls>'],
    },
});
