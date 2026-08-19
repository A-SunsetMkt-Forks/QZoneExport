# QQ空间导出助手 (QZoneExport)

QQ空间导出助手是一个浏览器扩展（Chrome / Edge 等 Chromium 内核浏览器，Manifest V3），用于一键备份 QQ 空间的说说、日志、日记、相册、视频、留言、好友、收藏、分享、访客等数据为本地文件，便于迁移与长期保存。

> 当前版本 **v3.0**。v3 在保留 v2 旧逻辑（`legacy/`）的基础上，将采集引擎、下载管理、备份编排、进度面板等核心模块全面重写为 TypeScript，并引入独立的 Vue3 备份查看器（`viewer/`）。

> 📖 用户文档（使用帮助 / 安装 / 配置 / 常见问题）见项目 [Wiki](https://github.com/ShunCai/QZoneExport/wiki)；版本变化见 [更新说明（v3）](./docs/release-notes-v3.md)。
> 📦 在线安装：Chrome 应用商店 / Edge 加载项 / 360 应用市场（地址见扩展内「关于」页）；离线包见 [Releases](https://github.com/ShunCai/QZoneExport/releases)。

---

## 技术栈

| 领域 | 技术 |
| --- | --- |
| 扩展框架 | [WXT](https://wxt.dev/)（MV3，TypeScript SDK 化构建） |
| 语言 | TypeScript 5.9（严格模式）+ 少量遗留 JS（`legacy/`） |
| 前端 UI（popup / options） | Vue 3.5 + Naive UI + Pinia 4 |
| 前端 UI（备份进度面板） | 纯 TypeScript + Shadow DOM（`entrypoints/backup-panel`，**非 Vue**） |
| 查看器图表 | ECharts 6（足迹地图） |
| 查看器大图 | PhotoSwipe 5（图片 / 视频混合画廊） |
| 存储 | `idb`（IndexedDB 封装）+ `chrome.storage` + `chrome.cookies` |
| 压缩 | `@zip.js/zip.js` |
| 内容解析 | `json5` |
| 构建工具 | WXT + Vite 7（查看器使用独立的 `viewer/vite.config.ts` 构建） |
| 测试 | Vitest 3（happy-dom / fake-indexeddb） |
| 代码质量 | ESLint 9 + Prettier 3 |

---

## 目录结构

```
QZoneExport/
├── core/                      # 核心 TS 逻辑（与扩展运行时无关，可单测）
│   ├── collector/             # 采集引擎
│   │   ├── modules/           # 各数据类型采集模块
│   │   │   ├── messages.ts    # 说说
│   │   │   ├── boards.ts      # 留言板
│   │   │   ├── blogs.ts       # 日志
│   │   │   ├── diaries.ts     # 日记
│   │   │   ├── shares.ts      # 分享
│   │   │   ├── photos.ts      # 相册 / 相片
│   │   │   ├── videos.ts      # 视频
│   │   │   ├── friends.ts     # 好友
│   │   │   ├── visitors.ts    # 访客
│   │   │   ├── favorites.ts   # 收藏
│   │   │   ├── helpers.ts     # 媒体登记 / 表情下载 / 后缀解析等公共能力
│   │   │   └── engine.ts      # 采集调度引擎
│   │   ├── pipeline.ts        # 备份编排流水线
│   │   ├── increment.ts       # 增量备份
│   │   ├── events.ts / checkpoint.ts
│   ├── downloader/            # 下载管理
│   │   ├── drivers/           # 下载驱动：browser(浏览器原生) / aria2 / disk(本地磁盘)
│   │   ├── manager.ts         # 下载编排（并发 / 重试 / 进度 / 卡死看门狗）
│   │   ├── task-queue.ts      # 任务队列
│   │   ├── pool.ts            # 并发池
│   │   └── m3u8-merger.ts     # 视频 TS 合并
│   ├── qzone-api/             # QQ空间接口客户端（clients / request / urls / context / types）
│   ├── store/                 # 持久化层（db / storage / backup-db）
│   ├── shared/                # 通用工具（config / utils / logger / errors / format / crypto / url / messages ...）
│   ├── archive/               # 压缩打包（zip-writer / zip-fallback）
│   ├── export/                # 导出编排（site / user-info）
│   ├── fs/                    # 文件系统抽象（disk-fs / writer）
│   ├── net/                   # 网络层（suffix 等）
│   └── ext/                   # 扩展 API 封装（keepalive 等）
├── entrypoints/               # WXT 入口
│   ├── background.ts          # Service Worker 后台（下载调度、消息中枢、下载重命名预设）
│   ├── engine-bridge.content.ts   # 注入 qzone 页面的采集桥接（替代旧 content.js）
│   ├── backup-panel.content.ts     # Shadow DOM 进度面板入口（纯 TS，非 Vue）
│   ├── backup-panel/          # 进度面板 TS 模块（template / api / dm / context / styles / utils ...）
│   ├── legacy-bridge.content.ts   # 旧版脚本桥接
│   ├── qzone-hint.content.ts      # 页面提示
│   ├── popup/  options/       # Vue3 + Naive UI 的弹窗与设置页（*.vue）
│   └── welcome.html           # 欢迎页
├── legacy/                    # v2 旧版逻辑（原样打包执行，与 SW 共享作用域）
│   └── background.js
├── viewer/                    # 备份查看器（Vue3，独立 Vite 构建，产物打入扩展）
│   ├── src/                   # 查看器源码（*.vue / *.ts）
│   ├── map-vendor/            # 地图数据（坐标转换 UMD）
│   ├── index.html / vite.config.ts / tsconfig.json
├── public/                    # 静态资源（含 viewer 构建产物，随扩展打包）
├── scripts/                   # 构建辅助脚本（生成查看器 mock 等）
├── shell/                     # PowerShell 辅助脚本（如 M3U8 合并）
├── tests/                     # Vitest 单元测试（*.test.ts）
├── wxt.config.ts              # WXT 构建与 manifest 配置
├── vitest.config.ts           # 测试配置
└── tsconfig.json
```

---

## 环境要求

- Node.js ≥ 20（建议 LTS）
- 包管理器：npm（项目使用 `package-lock.json`）

---

## 安装

```bash
# 安装依赖（postinstall 会自动执行 wxt prepare 生成 .wxt 配置）
npm install
```

---

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 WXT 开发模式（热重载，输出到 `.output/QZoneExport`） |
| `npm run dev:viewer` | 单独启动查看器开发服务器（需先生成 mock 数据） |
| `npm run build` | 先构建查看器，再构建扩展生产包 |
| `npm run zip` | 构建并打包为可发布的 zip |
| `npm run build:viewer` | 仅构建查看器（输出到 `public/viewer/`） |
| `npm run compile` | TypeScript 类型检查（`tsc --noEmit`） |
| `npm run compile:viewer` | 查看器类型检查（`vue-tsc`） |
| `npm run test` | 运行 Vitest 单元测试（`vitest run`） |
| `npm run lint` | ESLint 检查 |
| `npm run format` | Prettier 格式化 |

### 本地加载扩展

1. 执行 `npm run build`（或 `npm run dev`）。
2. 打开 Chrome `chrome://extensions`，开启「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择构建输出目录 `.output/QZoneExport`（生产）或对应的 dev 目录。

---

## 主要功能

- **全类型备份**：说说、日志、日记、相册/相片、视频、留言、好友、收藏、分享、访客，含评论 / 点赞 / 最近访问等关联数据。
- **QQ 表情图片备份**：内容中的 `[em]eXXX[/em]` 表情占位符在采集阶段被解析并下载到 `Common/images/eXXX.gif`（固定文件名、跨模块去重），查看器离线也能正确渲染表情，不复依赖在线 CDN。
- **多下载驱动**：浏览器原生下载、aria2、本地磁盘等，支持并发控制与失败重试。
- **增量备份**：基于已备份数据跳过重复项，仅采集新增内容。
- **断点续传**：下载任务持久化，异常中断后可继续。
- **富媒体大图查看**：备份查看器基于 PhotoSwipe 提供图片与视频混合画廊，支持图文 / 视频交叉浏览；视频大图的播放控件不会被底部缩略图条遮挡。
- **离线查看器**：打包生成的备份包含独立 Vue3 查看器（`viewer/`），双击 `index.html` 即可在 `file://` 下离线浏览，含足迹地图（ECharts）。
- **配置灵活**：备份范围、下载方式、分类目录、冲突策略、媒体类型探测等均可在 options 页配置。

---

## 配置说明

### 扩展 Manifest（`wxt.config.ts`）

构建时由 `wxt.config.ts` 的 `manifest` 字段生成。关键权限：

- `downloads`：浏览器原生下载管理（`chrome.downloads.download` / `cancel` / `erase` / `pause` / `resume` / `search` / `onCreated` / `onChanged` 等）。
- `storage` / `unlimitedStorage`：配置与备份数据持久化。
- `cookies`：读取 QQ空间登录态。
- `declarativeNetRequest` / `offscreen`：网络与离屏处理。
- `host_permissions: ['<all_urls>']`：访问 QQ空间及 CDN 资源。

> `content_scripts` 注入 `vendor/aria2/aria2.js` 及 `css/content.css`（旧版全局 polyfill `utils.js` / `config.js` 与 `filer.min.js` 已在 v3 移除）。查看器产物 `viewer/*` 通过 `web_accessible_resources` 对 qzone 页面可访问，备份时由内容脚本写入备份目录。

### 备份配置（`core/shared/backup-options.ts`）

备份范围、下载驱动类型、并发数、目录命名规则、文件名清洗策略、媒体类型自动探测开关等核心选项在此定义，并由 options 页持久化到 `chrome.storage`。

### 下载重命名（重要）

浏览器原生下载（`chrome.downloads.download`）的 `filename` 仅为「建议名」，会被响应头 `Content-Disposition` 覆盖；且 `onDeterminingFilename` 事件中的 `item.filename` 只有 basename（目录已被剥离）。

本项目在 `entrypoints/background.ts` 维护一张「下载强制重命名预登记表」`DLPresetNames`（挂到 Service Worker 全局，与 `legacy/background.js` 共享作用域）。发起下载**之前**按 `url → 相对路径` 登记，由 `legacy/background.js` 中唯一的 `onDeterminingFilename` 监听器消费并 `suggest` 出完整相对路径。各路径段在 `core/downloader/drivers/browser.ts` 的 `buildRelativePath()` 中逐段清洗，避免 `:`、`?`、`|`、尾部空格等导致整次下载回退到默认名与根目录。

> 健壮性：预登记表同时以「原始 URL」与「去参 URL（`?` 之后部分剥离）」双向注册 / 查找，并命中后清理全部等价键，规避 Chrome 在 `onDeterminingFilename` 上报的 `item.url` 与注册 URL 不一致（重定向 / 去参）导致预设丢失、文件偶发落到备份根目录的问题。

### 媒体类型探测与命名一致（#2）

`core/collector/modules/helpers.ts` 的 `resolveMediaSuffix(url, env)` 统一解析落盘文件的后缀：开启自动探测时优先取 MIME 真实类型，探测失败回退 URL 扩展名，最后兜底 `.jpg`。所有采集模块统一调用，保证「类型探测 / 落盘命名 / 引用地址」三者一致，避免「落盘为 A.png 但引用为 A.gif」「部分图片缺扩展名」等问题。

### 查看器构建约束（`viewer/vite.config.ts`）

查看器产物写入 `public/viewer/`，随扩展打包并在备份时拷入备份包。其为 `file://` 直接打开而构建：

- `base: './'`：相对路径，避免指向磁盘根。
- 产物为 IIFE 单文件（`index.js` / `index.css`），无 hash、无 crossorigin，保证固定拷贝清单可用。
- 禁止任何 CDN 外链，资源内联或随产物拷贝。

---

## 测试

单元测试位于 `tests/`，使用 Vitest + happy-dom + fake-indexeddb：

```bash
npm run test                              # 运行全部
npx vitest run tests/collectors.test.ts   # 运行单个
```

---

## 设计文档与分析

- [备份进度面板 & 媒体下载管理 · 系统性故障分析报告](./backup-progress-panel-analysis.md)：覆盖 7 个维度、F1–F14 故障点与具体修复方案，含 F9(P0) 进度通道断裂致媒体下载冻死、F11 卡死超时兜底、F6/F7/F8/F12 错误健壮性与 UI 反馈等。

---

## 许可证

Apache-2.0。仅供个人学习研究与数据备份之用。

> 用户向的使用文档、隐私政策与版本变化，见项目 [Wiki](https://github.com/ShunCai/QZoneExport/wiki) 与 [更新说明（v3）](./docs/release-notes-v3.md)。
