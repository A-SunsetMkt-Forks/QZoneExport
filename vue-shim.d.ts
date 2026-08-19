/**
 * Vue 单文件组件类型声明
 * WXT 的 vite 构建能直接处理 .vue，但独立 tsc（npm run compile）需要此 shim 才能解析 .vue 导入
 */
declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
    export default component;
}
