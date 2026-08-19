import type { GlobalThemeOverrides } from 'naive-ui';

/**
 * 全局蓝色主题覆盖。
 * naive-ui 默认 primaryColor 为品牌绿（#18a058），项目整体已从绿白配色改为蓝白配色，
 * 故在三个 <n-config-provider>（配置页 / popup / 查看器）统一注入此覆盖，
 * 使 n-button type="primary"、n-switch、n-menu 选中态、n-tag、n-radio 等全部走蓝色。
 */
export const blueThemeOverrides: GlobalThemeOverrides = {
    common: {
        primaryColor: '#2080f0',
        primaryColorHover: '#409eff',
        primaryColorPressed: '#1366d6',
        primaryColorSuppl: '#409eff',
    },
};
