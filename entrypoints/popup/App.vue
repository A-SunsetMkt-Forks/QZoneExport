<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import {
    NAlert,
    NButton,
    NCheckbox,
    NCheckboxGroup,
    NConfigProvider,
    NDivider,
    NSpin,
    zhCN,
    dateZhCN,
} from 'naive-ui';
import { blueThemeOverrides } from '../../core/shared/naive-theme';
import { sendMessage, getActiveTabUrl, type AlbumItem, type UinData } from './messaging';
import GuideOverlay, { type GuideStep } from './GuideOverlay.vue';
import AnnouncementBanner from './AnnouncementBanner.vue';
import {
    MODULES,
    PRIVATE_MODULES,
    DEFAULT_MEDIA_MODE,
    DEFAULT_DOWNLOAD_TYPE,
    defaultDownloadTypeFor,
    DEFAULT_EXPORT_TYPE,
    mediaSummaryText,
} from '../../core/shared/backup-options';
import { describeCategory } from '../../core/shared/errors';

/** 首次使用引导（只讲「如何发起第一次备份」，看过后记 localStorage 不再弹） */
const GUIDE_FLAG = 'QZoneExport_GuideSeen';
const showGuide = ref(false);
const GUIDE_STEPS: GuideStep[] = [
    {
        title: '欢迎使用 QQ 空间导出助手',
        body: '只需三步就能完成一次备份。花半分钟跟着看一遍，之后不会再弹出。',
    },
    {
        title: '第一步：选择要备份的内容',
        body: '勾选说说、相册、好友等模块（默认全选）。备份别人空间时，对方的私密模块（日记/好友/收藏）会自动置灰。',
        target: '.guide-modules',
    },
    {
        title: '第二步：开始备份',
        body: '关闭本引导后，点面板底部的「开始备份」即可。备份期间请保持当前 QQ 空间页面不关闭、不刷新，也不要新开空间页面，直到完成。',
    },
];

function finishGuide(): void {
    showGuide.value = false;
    try {
        localStorage.setItem(GUIDE_FLAG, '1');
    } catch {
        // localStorage 不可用时忽略，最多下次再弹一次
    }
}

/** 已登录并处于某个空间页的 URL 特征（与 background 按钮显示规则一致）：
 *  https://user.qzone.qq.com/{QQ号}  或  https://{QQ号}.qzone.qq.com/ */
const QZONE_SPACE_RE = /^https:\/\/user\.qzone\.qq\.com\/\d+/;
const QZONE_SUB_RE = /^https:\/\/\d+\.qzone\.qq\.com\//;

/** 可备份模块（值与内容脚本约定一致）—— 已在 core/shared/backup-options.ts 统一维护，popup/qzone-hint/options 三处共用 */

const loading = ref(true);
const errorMsg = ref('');
/** 页面状态：checking=检测中，notQzone=不在QQ空间，notLoggedIn=未登录，ready=就绪 */
const pageState = ref<'checking' | 'notQzone' | 'notLoggedIn' | 'ready'>('checking');
const owner = ref<UinData['Owner'] | null>(null);
const target = ref<UinData['Target'] | null>(null);
const isOwner = ref(true);
const checked = ref<string[]>(MODULES.map((m) => m.value));
const albums = ref<AlbumItem[]>([]);
const selectedAlbumIds = ref<string[]>([]);
const albumDropdownOpen = ref(false);
const albumFilter = ref('');
const albumSearchRef = ref<HTMLInputElement | null>(null);
const diariesEncrypted = ref(false);
// 初值用共享默认值，避免首次安装（sync 无配置）时 popup 与配置页默认值对不上
const downloadType = ref(defaultDownloadTypeFor(import.meta.env.FIREFOX));
const mediaMode = ref(DEFAULT_MEDIA_MODE);
const exportText = ref(DEFAULT_EXPORT_TYPE);
const starting = ref(false);
const started = ref(false);
/** 无访问权限（-4009）标志：任一初始化接口返回无权限即置位，整窗禁用开始按钮并提示 */
const noPermission = ref(false);
/** 项目统一权限文案（与 errors.ts 的 permission 分类一致） */
const permissionText = describeCategory('permission');

const userTypeText = computed(() => (isOwner.value ? '自己的空间' : '他人的空间'));

/** 他人模式下不可备份的模块名称，用于解释为何置灰 */
const privateModuleNames = computed(() => MODULES
    .filter((item) => PRIVATE_MODULES.includes(item.value))
    .map((item) => item.label)
    .join('、'));

/** 当前模式下可选的模块（他人模式下私有模块不可选） */
const availableModules = computed(() => MODULES.filter((item) => !isDisabled(item.value)));
const allChecked = computed(() => availableModules.value.length > 0
    && availableModules.value.every((item) => checked.value.includes(item.value)));
/** 部分选中时全选框展示为半选态 */
const partChecked = computed(() => !allChecked.value && checked.value.length > 0);

function toggleAll(value: boolean): void {
    checked.value = value ? availableModules.value.map((item) => item.value) : [];
    checkDiaries();
}

/** 媒体处理方式 */
const mediaText = computed(() => mediaSummaryText(mediaMode.value, downloadType.value));

/** 相册按分类分组，与备份确认弹窗完全一致（过滤、分组、全部/前3个tag显示） */
const albumGroups = computed(() => {
    const groups = new Map<string, AlbumItem[]>();
    const filter = albumFilter.value.trim().toLowerCase();
    for (const album of albums.value) {
        if (filter && !album.name.toLowerCase().includes(filter)) continue;
        const key = album.className || '未分类';
        const list = groups.get(key) || [];
        list.push(album);
        groups.set(key, list);
    }
    return Array.from(groups.entries()).map(([name, list]) => ({ name, list }));
});

/** 触发栏显示：全部相册(n) / 前3个tag + +N */
const albumTriggerTags = computed(() => {
    if (!albums.value.length) {
        return { kind: 'placeholder' as const, text: '（未加载到相册数据，启动后自动枚举全部）' };
    }
    if (selectedAlbumIds.value.length === albums.value.length) {
        return { kind: 'all' as const, count: albums.value.length };
    }
    if (selectedAlbumIds.value.length === 0) {
        return { kind: 'placeholder' as const, text: '未选择任何相册' };
    }
    const idToAlbum = new Map(albums.value.map(a => [a.id, a]));
    const first = selectedAlbumIds.value
        .slice(0, 3)
        .map(id => idToAlbum.get(id))
        .filter((x): x is AlbumItem => !!x)
        .map(a => a.name);
    const more = selectedAlbumIds.value.length - first.length;
    return { kind: 'selected' as const, first, more };
});

function toggleAlbumDropdown(): void {
    albumDropdownOpen.value = !albumDropdownOpen.value;
    if (albumDropdownOpen.value) {
        albumFilter.value = '';
        nextTick(() => {
            if (albumSearchRef.value) albumSearchRef.value.focus();
        });
    }
}

/** 点页面其它地方关掉相册下拉框（与 qzone-hint 的 document click 处理一致） */
function onDocClickAlbum(e: MouseEvent): void {
    if (!albumDropdownOpen.value) return;
    const t = e.target as Node | null;
    const container = document.querySelector<HTMLElement>('[data-album-select-root]');
    if (container && t && container.contains(t)) return;
    albumDropdownOpen.value = false;
}

function toggleAlbum(id: string, on: boolean): void {
    if (on) {
        if (!selectedAlbumIds.value.includes(id)) selectedAlbumIds.value.push(id);
    } else {
        selectedAlbumIds.value = selectedAlbumIds.value.filter(x => x !== id);
    }
}

function toggleAllAlbums(): void {
    if (selectedAlbumIds.value.length === albums.value.length) {
        selectedAlbumIds.value = [];
    } else {
        selectedAlbumIds.value = albums.value.map(a => a.id);
    }
}

const showAlbumSelect = computed(() => checked.value.includes('Photos'));

/** 他人模式下禁用私有模块 */
function isDisabled(moduleValue: string): boolean {
    return !isOwner.value && PRIVATE_MODULES.includes(moduleValue);
}

function openOptions(tab = 'Common'): void {
    // 显式指向设置页并直达对应 tab；不用 openOptionsPage，它依赖扩展加载时的 manifest，
    // 扩展未重新加载时会跳到旧的设置页路径
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html#' + tab) });
}

/** 打开/前往 QQ 空间（未登录时会跳转登录页） */
function openQzone(): void {
    chrome.tabs.create({ url: 'https://user.qzone.qq.com/' });
}

/**
 * 检测私密日志是否开启独立密码
 * 该探测要发真实请求，结果缓存下来，避免每次勾选变化都重复请求
 */
let diariesProbe: boolean | null = null;
async function checkDiaries(): Promise<void> {
    if (!checked.value.includes('Diaries')) {
        diariesEncrypted.value = false;
        return;
    }
    if (diariesProbe !== null) {
        diariesEncrypted.value = diariesProbe;
        return;
    }
    try {
        const data = await sendMessage<{ code?: number }>({ subject: 'initDiaries' });
        if (data && data.code === -4009) {
            // 接口返回 -4009 无权限：整窗禁用开始按钮
            noPermission.value = true;
            diariesEncrypted.value = false;
            return;
        }
        diariesProbe = data?.code === -50000;
    } catch {
        diariesProbe = false;
    }
    diariesEncrypted.value = checked.value.includes('Diaries') && !!diariesProbe;
}

function openDiariesClose(): void {
    if (owner.value) {
        chrome.tabs.create({
            url: `https://user.qzone.qq.com/${owner.value.uin}/blog?catalog=private`,
        });
    }
}

/** 开始备份 */
async function startBackup(): Promise<void> {
    starting.value = true;
    try {
        const selectedAlbums = albums.value.filter((a) => selectedAlbumIds.value.includes(a.id));
        await sendMessage({
            subject: 'startBackup',
            exportType: [...checked.value],
            albums: selectedAlbums,
            isOwner: isOwner.value,
        });
        // 记住本次选择的备份类型
        chrome.storage.local.set({ PreExportTypes: [...checked.value] });
        started.value = true;
    } catch (error) {
        errorMsg.value = (error as Error).message || '开始备份失败';
    } finally {
        starting.value = false;
    }
}

onMounted(async () => {
    document.addEventListener('click', onDocClickAlbum, true);
    // 先校验当前标签页是否为已登录的 QQ 空间页面
    const tabUrl = await getActiveTabUrl();
    if (!/qzone\.qq\.com/.test(tabUrl)) {
        pageState.value = 'notQzone';
        loading.value = false;
        return;
    }
    if (!QZONE_SPACE_RE.test(tabUrl) && !QZONE_SUB_RE.test(tabUrl)) {
        // 在 QQ 空间域但未定位到具体空间（通常是未登录或在登录页）
        pageState.value = 'notLoggedIn';
        loading.value = false;
        return;
    }
    pageState.value = 'ready';

    // 恢复上次选中的备份类型
    try {
        const data = await chrome.storage.local.get({ PreExportTypes: [] as string[] });
        if (Array.isArray(data.PreExportTypes) && data.PreExportTypes.length > 0) {
            checked.value = data.PreExportTypes;
        }
    } catch {
        // 忽略，使用默认全选
    }

    try {
        const uin = await sendMessage<UinData>({ subject: 'initUin' });
        owner.value = uin.Owner;
        target.value = uin.Target;
        isOwner.value = String(uin.Owner.uin) === String(uin.Target.uin);

        // 他人模式下移除已选中的私有模块
        if (!isOwner.value) {
            checked.value = checked.value.filter((v) => !PRIVATE_MODULES.includes(v));
        }

        // 助手配置（文案导出 / 媒体策略与下载器）
        try {
            const config = await sendMessage<{ Common: { downloadType: string; mediaMode?: string; exportType?: string } }>({
                subject: 'initConfig',
            });
            let dt = config?.Common?.downloadType || DEFAULT_DOWNLOAD_TYPE;
            if (dt === 'File') {
                dt = 'Browser'; // File（助手内部）模式已淘汰，历史配置归一化
            }
            if (import.meta.env.FIREFOX && dt === 'Disk') {
                dt = 'Browser'; // Firefox 形态 B：直写目录不可用
            }
            downloadType.value = dt;
            mediaMode.value = config?.Common?.mediaMode || DEFAULT_MEDIA_MODE;
            exportText.value = config?.Common?.exportType || DEFAULT_EXPORT_TYPE;
        } catch {
            // 配置读取失败不阻断
        }

        // 探测私密日志不阻断渲染：它要等真实请求，让 popup 先显示出来，提示到了再追加
        checkDiaries();

        // 相册列表
        try {
            const list = await sendMessage<AlbumItem[] | { code?: number; error?: string }>({ subject: 'getAlbumList' });
            if (list && typeof list === 'object' && !Array.isArray(list)) {
                // 接口返回错误包装（非数组），如 -4009 无权限
                const code = (list as { code?: number }).code;
                const text = (list as { error?: string }).error || '';
                if (code === -4009 || /code[=:]-?4009|无权限|没有权限/i.test(text)) {
                    noPermission.value = true;
                }
                albums.value = [];
            } else if (Array.isArray(list)) {
                albums.value = list;
                selectedAlbumIds.value = albums.value.map((a) => a.id); // 默认全选
            } else {
                albums.value = [];
            }
        } catch {
            // 相册获取失败不阻断
        }
    } catch (error) {
        errorMsg.value = (error as Error).message || '初始化失败';
    } finally {
        loading.value = false;
        // 就绪后首次展示引导（需等模块/汇总/按钮渲染出来才能高亮）
        try {
            if (pageState.value === 'ready' && owner.value && localStorage.getItem(GUIDE_FLAG) !== '1') {
                await nextTick();
                showGuide.value = true;
                // 一旦展示就算“已提示过”：无论用户是点引导按钮、直接开始备份还是关掉 popup，
                // 都不再重弹（旧逻辑只在点“我知道了/跳过”时写标记，绕过按钮退出会导致下次重弹）
                try {
                    localStorage.setItem(GUIDE_FLAG, '1');
                } catch {
                    // localStorage 不可用时忽略
                }
            }
        } catch {
            // localStorage 不可用时不弹引导
        }
    }
});

onBeforeUnmount(() => {
    document.removeEventListener('click', onDocClickAlbum, true);
});
</script>

<template>
    <n-config-provider :locale="zhCN" :date-locale="dateZhCN" :theme-overrides="blueThemeOverrides">
        <div class="popup" :style="{ minHeight: showAlbumSelect ? '540px' : undefined }">
            <h3 class="title">QQ空间导出助手</h3>

            <announcement-banner />

            <n-alert v-if="errorMsg" type="warning" :show-icon="true" class="mb">
                {{ errorMsg }}
            </n-alert>

            <!-- 不在 QQ 空间页面 -->
            <template v-if="pageState === 'notQzone'">
                <n-alert type="info" :show-icon="true" class="mb">
                    请先在浏览器中打开并登录 QQ 空间，再使用本助手。
                </n-alert>
                <div class="actions">
                    <n-button type="primary" @click="openQzone">打开 QQ 空间</n-button>
                </div>
            </template>

            <!-- 在 QQ 空间域但未登录 -->
            <template v-else-if="pageState === 'notLoggedIn'">
                <n-alert type="warning" :show-icon="true" class="mb">
                    检测到尚未登录 QQ 空间，请先登录后再使用本助手。
                </n-alert>
                <div class="actions">
                    <n-button type="primary" @click="openQzone">前往登录</n-button>
                </div>
            </template>

            <div v-else-if="loading" class="loading-center">
                <n-spin size="large" />
            </div>

            <template v-else-if="owner">
                <div class="info">
                    <p>登录QQ：<b>{{ owner.uin }}</b></p>
                    <p>备份QQ：<b>{{ target?.uin }}</b></p>
                    <p>备份对象：<b>{{ userTypeText }}</b></p>
                </div>

                <n-alert v-if="noPermission" type="warning" :show-icon="true" class="permission-tip">
                    🔒 {{ permissionText }}
                </n-alert>
                <n-alert v-else-if="!isOwner" type="info" :show-icon="true" class="mode-tip">
                    当前停留在 <b>{{ target?.uin }}</b> 的空间，将备份你能看到的内容（能浏览就能备份）。
                    {{ privateModuleNames }}属于对方的私密数据，无法备份；要备份自己的空间，请先打开自己的空间主页。
                </n-alert>
                <p v-else class="mode-hint">
                    想备份别人的空间？先打开对方的空间主页（能正常浏览即说明有访问权限），再点开本助手。
                </p>
                <n-divider class="divider" />

                <div class="modules-head guide-modules">
                    <n-checkbox
                        :checked="allChecked"
                        :indeterminate="partChecked"
                        @update:checked="toggleAll"
                    >全选</n-checkbox>
                    <span class="count">已选 {{ checked.length }} / {{ availableModules.length }} 个模块</span>
                </div>

                <n-checkbox-group v-model:value="checked" @update:value="checkDiaries">
                    <div class="modules">
                        <n-checkbox
                            v-for="m in MODULES"
                            :key="m.value"
                            :value="m.value"
                            :label="m.label"
                            :disabled="isDisabled(m.value)"
                        />
                    </div>
                </n-checkbox-group>

                <div v-if="showAlbumSelect" class="album" data-album-select-root>
                    <div class="album-label">相册（默认全选）</div>
                    <div class="album-select">
                        <div class="album-trigger" @click.stop="toggleAlbumDropdown">
                            <template v-if="albumTriggerTags.kind === 'placeholder'">
                                <span class="placeholder">{{ albumTriggerTags.text }}</span>
                            </template>
                            <template v-else-if="albumTriggerTags.kind === 'all'">
                                <div class="album-tags"><span class="album-tag">全部相册（{{ albumTriggerTags.count }}）</span></div>
                            </template>
                            <template v-else>
                                <div class="album-tags">
                                    <span v-for="(name, i) in albumTriggerTags.first" :key="i" class="album-tag">{{ name }}</span>
                                    <span v-if="albumTriggerTags.more > 0" class="tag-more">+{{ albumTriggerTags.more }}</span>
                                </div>
                            </template>
                            <span class="caret" :style="{ transform: albumDropdownOpen ? 'rotate(180deg)' : undefined }">▾</span>
                        </div>
                        <div v-if="albumDropdownOpen" class="album-dropdown" @click.stop>
                            <input
                                ref="albumSearchRef"
                                v-model="albumFilter"
                                class="album-search"
                                placeholder="搜索相册名称…"
                            />
                            <label
                                class="album-option album-all"
                                :style="{ borderBottom: '1px solid var(--n-border-color, #e5e7eb)', fontWeight: 600 }"
                            >
                                <input
                                    type="checkbox"
                                    :checked="selectedAlbumIds.length === albums.length && albums.length > 0"
                                    :indeterminate="selectedAlbumIds.length > 0 && selectedAlbumIds.length < albums.length"
                                    @change="toggleAllAlbums"
                                />
                                <span>全选（{{ albums.length }} 个相册）</span>
                            </label>
                            <template v-if="!albumGroups.length">
                                <div class="album-empty">没有匹配的相册</div>
                            </template>
                            <template v-else>
                                <template v-for="g in albumGroups" :key="g.name">
                                    <div class="album-group">{{ g.name }}（{{ g.list.length }}）</div>
                                    <label
                                        v-for="a in g.list"
                                        :key="a.id"
                                        class="album-option"
                                    >
                                        <input
                                            type="checkbox"
                                            :checked="selectedAlbumIds.includes(a.id)"
                                            @change="(e: Event) => toggleAlbum(a.id, (e.target as HTMLInputElement).checked)"
                                        />
                                        <span>{{ a.name }}（{{ a.total }}）</span>
                                    </label>
                                </template>
                            </template>
                        </div>
                    </div>
                </div>

                <n-alert v-if="diariesEncrypted" type="warning" :show-icon="true" class="mt">
                    日记已开启「独立密码」，不关闭将无法备份日记，
                    <a href="javascript:void(0)" @click="openDiariesClose">点此前往关闭</a>
                </n-alert>

                <div class="summary guide-summary">
                    <div class="summary-items">
                        <span>文案导出格式：<b>{{ exportText }}</b></span>
                        <span>媒体下载方式：<b>{{ mediaText }}</b></span>
                    </div>
                    <a href="javascript:void(0)" @click="openOptions()">修改设置</a>
                </div>
                <p class="recommend-hint">
                    💡 小贴士：日常备份可在「设置」页把备份范围设为「上次之后」（增量），只采集新增内容，更快更省。
                </p>
                <p v-if="downloadType === 'Browser' && mediaMode !== 'Link'" class="browser-hint">
                    ⚠️ 请确认已关闭浏览器「下载前询问每个文件的保存位置」，否则每个文件都需手动确认。
                </p>

                <div class="actions guide-start">
                    <n-button
                        type="primary"
                        size="large"
                        :loading="starting"
                        :disabled="checked.length === 0 || started || noPermission"
                        @click="startBackup"
                    >
                        {{ started ? '已开始备份' : '开始备份' }}
                    </n-button>
                </div>
            </template>
        </div>

        <!-- 首次使用分步引导（仅就绪状态下首次弹出） -->
        <guide-overlay v-if="showGuide" :steps="GUIDE_STEPS" @finish="finishGuide" />
    </n-config-provider>
</template>

<style scoped>
.popup {
    width: 460px;
    padding: 14px 16px;
    box-sizing: border-box;
    font-size: 13px;
    display: flex;
    flex-direction: column;
}
.title {
    margin: 0 0 8px;
}
.info p {
    margin: 4px 0;
}
.info b {
    color: #d03050;
    font-style: italic;
}
.divider {
    margin: 10px 0;
}
/* 可备份模块：每行 5 个 */
.modules {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 12px 8px;
    margin-top: 4px;
}
/* 加载中居中显示转圈 */
.loading-center {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 140px;
}
.album {
    margin-top: 10px;
}
.album-label {
    font-size: 12px;
    color: #374151;
    margin: 0 2px 6px;
    font-weight: 600;
}
.album-select {
    position: relative;
}
.album-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 36px;
    padding: 6px 10px;
    background: #fff;
    border: 1px solid #d9d9d9;
    border-radius: 6px;
    font-size: 12px;
    color: #333;
    cursor: pointer;
    transition: border-color .2s;
}
.album-trigger:hover {
    border-color: #2080f0;
}
.album-trigger .placeholder {
    color: #9ca3af;
}
.album-trigger .caret {
    color: #9ca3af;
    font-size: 11px;
    margin-left: 8px;
    transition: transform .2s;
}
.album-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-width: calc(100% - 20px);
}
.album-tag {
    background: #f0f6ff;
    color: #166534;
    border: 1px solid #bfdbfe;
    padding: 1px 6px 2px;
    border-radius: 4px;
    font-size: 11px;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tag-more {
    background: #f3f4f6;
    color: #374151;
    border: 1px solid #d1d5db;
    padding: 1px 6px 2px;
    border-radius: 4px;
    font-size: 11px;
}
.album-dropdown {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    z-index: 50;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
    max-height: 260px;
    overflow: auto;
    padding: 4px 0;
}
.album-search {
    display: block;
    width: calc(100% - 20px);
    margin: 4px 8px 6px;
    padding: 6px 8px;
    border: 1px solid #e5e7eb;
    border-radius: 4px;
    font-size: 12px;
    outline: none;
}
.album-search:focus {
    border-color: #2080f0;
}
.album-group {
    padding: 4px 8px 2px;
    font-size: 11px;
    color: #6b7280;
    font-weight: 600;
    background: #f9fafb;
}
.album-option {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px 5px 14px;
    cursor: pointer;
    font-size: 12px;
    color: #111;
}
.album-option:hover {
    background: #f0f6ff;
}
.album-option input[type="checkbox"] {
    width: 13px;
    height: 13px;
    accent-color: #2080f0;
    flex: none;
}
.album-empty {
    padding: 8px 12px;
    color: #9ca3af;
    font-size: 12px;
}
.mb {
    margin-bottom: 10px;
}
.mt {
    margin-top: 10px;
}
/* 备份对象说明 */
.mode-tip {
    margin-top: 8px;
}
.mode-hint {
    margin: 6px 0 0;
    color: #999;
    font-size: 12px;
    line-height: 1.5;
}
/* 模块选择头部：全选与已选数量 */
.modules-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
}
.count {
    color: #999;
    font-size: 12px;
}
.summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 12px;
    padding: 8px 10px;
    background: #f4f7f6;
    border-left: 3px solid #2080f0;
    border-radius: 2px;
}
.summary-items {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: #666;
}
.summary-items b {
    color: #333;
}
.browser-hint {
    margin: 6px 0 0;
    font-size: 11px;
    color: #e6a23c;
    line-height: 1.5;
}
/* 增量备份小贴士提示 */
.recommend-hint {
    margin: 6px 0 0;
    font-size: 11px;
    color: #1559b0;
    line-height: 1.5;
}
/* 按钮区弹性填充剩余空白并上下左右居中 */
.actions {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 16px;
}
</style>
