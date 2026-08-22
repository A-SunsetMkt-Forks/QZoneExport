import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import globals from 'globals';

export default tseslint.config(
    // 全局忽略：旧代码、产物、依赖
    {
        ignores: [
            'src/**',
            '.output/**',
            '.wxt/**',
            '.reference/**',
            '.workbuddy/**',
            'node_modules/**',
            'public/**',
            'releases/**',
            'shell/**',
            'scripts/**',
            'viewer/mock/**',
            'viewer/map-vendor/**',
        ],
    },

    // 基础推荐规则
    js.configs.recommended,

    // TypeScript 推荐规则（覆盖 .ts 文件）
    ...tseslint.configs.recommended.map((config) => ({
        ...config,
        files: ['**/*.ts'],
    })),

    // Vue 推荐规则（覆盖 .vue 文件）
    ...pluginVue.configs['flat/recommended'].map((config) => ({
        ...config,
        files: ['**/*.vue'],
    })),

    // Vue 文件中使用 TS 解析器解析 <script lang="ts">
    {
        files: ['**/*.vue'],
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                parser: tseslint.parser,
                sourceType: 'module',
            },
            globals: {
                ...globals.browser,
                chrome: 'readonly',
            },
        },
    },

    // TS 文件浏览器全局变量
    {
        files: ['entrypoints/**/*.ts', 'viewer/src/**/*.ts'],
        languageOptions: {
            globals: {
                ...globals.browser,
                chrome: 'readonly',
            },
        },
    },

    // 项目级规则定制
    {
        files: ['entrypoints/**/*.{ts,vue}', 'core/**/*.ts', 'viewer/src/**/*.{ts,vue}', 'tests/**/*.ts'],
        plugins: {
            '@typescript-eslint': tseslint.plugin,
            'vue': pluginVue,
        },
        rules: {
            // TS 已处理未使用变量，关闭基础规则避免重复报错
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            // any 已大规模收窄，启用 warn 发现残余
            '@typescript-eslint/no-explicit-any': 'warn',
            // 允许 require（旧模块兼容）
            '@typescript-eslint/no-require-imports': 'off',
            // Vue：允许单词组件名（App.vue 等）
            'vue/multi-word-component-names': 'off',
            // Vue：不强制属性换行风格
            'vue/max-attributes-per-line': 'off',
            // Vue：不强制单行组件
            'vue/singleline-html-element-content-newline': 'off',
            // Vue：不强制自闭合标签
            'vue/html-self-closing': 'off',
            // Vue：不强制属性排序
            'vue/attributes-order': 'off',
            // Vue：不强制 v-slot 风格
            'vue/v-slot-style': 'off',
            // Vue：模板缩进跟随项目风格（4 空格）
            'vue/html-indent': ['warn', 4],
            // Vue：script 缩进跟随项目风格
            'vue/script-indent': 'off',
            // 短路表达式是惯用写法（condition && fn()）
            '@typescript-eslint/no-unused-expressions': 'off',
            'no-unused-expressions': 'off',
            // options 页直接修改 prop 是项目既有模式（配置对象下发）
            'vue/no-mutating-props': 'off',
            // viewer 渲染备份的 HTML 内容，v-html 是预期行为
            'vue/no-v-html': 'off',
            // 不强制多行元素内容换行
            'vue/multiline-html-element-content-newline': 'off',
            // 不强制 prop 默认值
            'vue/require-default-prop': 'off',
        },
    },

    // 测试文件放宽
    {
        files: ['tests/**/*.ts'],
        rules: {
            '@typescript-eslint/no-empty-function': 'off',
        },
    },
);
