<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import {
    NAlert, NButton, NEmpty, NInput, NRadioButton, NRadioGroup, NSelect, NSpin, NTag,
} from 'naive-ui';
import { loadList } from '../data/sources';
import { formatTime, monthOf, timeValue } from '../data/format';
import { imageUrl, videoPoster } from '../data/content';
import { photoUrl, photoTimeOf } from '../data/media';
import { navigate } from '../router';
import { useTheme } from '../composables/useTheme';

/**
 * 足迹面板
 *
 * 五模块：概览统计条 / 筛选检索栏 / 足迹时间线列表（主体）/ 地图（概览）/ 空·错状态。
 * 地图实现沿用旧统计页：ECharts 平面地图 + 打卡散点 + 途径省份热力图，依赖从备份的
 * Common/vendor 下按需加载（不打开本页就不付这 ~2MB 代价）。
 *
 * 依赖是传统脚本（地图数据依赖全局 echarts 的 UMD 包），只能用 <script> 注入，故全局量以 declare 引用。
 */
declare const echarts: any;
declare const coordtransform: any;
declare const MAP_CONFIG_CHINA: any;
declare const MAP_CONFIG_WORLD: any;
declare const SHOW_NAME_ON_WORLD: any;

const { isDark } = useTheme();

const chartEl = ref<HTMLElement | null>(null);
const chart = shallowRef<any>(null);
const loading = ref(true);
const error = ref('');
/** 'china' 中国地图 · 'world' 世界地图（取值即 registerMap 的地图名） */
const mapType = ref<'china' | 'world'>('china');

interface Footprint {
    /** 唯一键（统一字段名，值来源不同）：说说=message.tid；相片=相片实体键 picKey/lloc/sloc（无则「相册 id+名称」）。注意相片没有稳定的 id 字段，严禁用 photo.id。 */
    tid: string;
    /** 数据来源：说说 / 相片 */
    source: 'messages' | 'photos';
    /** 相片来源时所属相册 id（跳相册详情用） */
    albumId?: string;
    name: string;
    posX: number;
    posY: number;
    time: any;
    /** 纯文本摘要（去 [表情] 标记，截断展示） */
    summary: string;
    /** 纯文本全文（展开用） */
    content: string;
    /** 首图/视频封面 URL（无则空串） */
    thumb: string;
}
const footprints = ref<Footprint[]>([]);
const footprintCount = ref(0);
const regionCount = ref(0);
const earliest = ref<number | null>(null);
const latest = ref<number | null>(null);
const spanYears = ref(0);
/** 展开全文的 tid 集合 */
const expandedIds = ref<Set<string>>(new Set());

// —— 筛选/排序状态 ——
const keyword = ref('');
const regionFilter = ref('');
const typeFilter = ref<'' | 'messages' | 'photos'>('');
const sortDir = ref<'desc' | 'asc'>('desc');

/** 依赖脚本只加载一次 */
const loadedScripts = new Set<string>();
function loadScript(src: string): Promise<void> {
    if (loadedScripts.has(src)) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.addEventListener('load', () => {
            loadedScripts.add(src);
            resolve();
        });
        script.addEventListener('error', () => reject(new Error('加载失败：' + src)));
        document.head.appendChild(script);
    });
}

/** 说说正文转纯文本（去 [表情]/[图片] 等 token 标记），用于列表预览 */
function plainText(message: Record<string, any>): string {
    return String(message.content || '')
        .replace(/\[[^\]]+\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** 取说说的首张图/视频封面（复用 content.ts 的取图逻辑，与说说卡片一致） */
function firstThumb(message: Record<string, any>): string {
    const img = message.custom_images?.[0];
    if (img) {
        return imageUrl(img.is_video && img.video_info ? img.video_info : img);
    }
    const vid = message.custom_videos?.[0];
    if (vid) {
        return videoPoster(vid);
    }
    const magic = message.custom_magics?.[0];
    if (magic) {
        return imageUrl(magic);
    }
    return '';
}

/**
 * 收集带坐标的足迹
 * 来源一：说说（message.lbs）——位置为发说说时选择的地点
 * 来源二：相册相片（album.photoList 下 photo.custom_lbs || photo.lbs || photo.shootGeo）——
 *        位置为上传/拍摄地点，时间取拍摄优先、兜底上传（photoTimeOf）
 * 两者跳原文入口不同：说说→#/messages?id，相片→#/albums?id（所在相册）
 */
async function collectFootprints(): Promise<Footprint[]> {
    const items: Footprint[] = [];

    // 1) 说说
    const messages = await loadList<Record<string, any>>('messages');
    for (const message of messages) {
        if (message.rt_tid) {
            continue;
        }
        const lbs = message.lbs;
        if (!lbs || !lbs.pos_x || !lbs.pos_y) {
            continue;
        }
        const text = plainText(message);
        items.push({
            tid: String(message.tid),
            source: 'messages',
            name: lbs.idname || lbs.name || '未知地点',
            posX: Number(lbs.pos_x),
            posY: Number(lbs.pos_y),
            time: message.created_time || message.custom_create_time,
            summary: text.slice(0, 80),
            content: text,
            thumb: firstThumb(message),
        });
    }

    // 2) 相册相片（位置优先级 custom_lbs → lbs → shootGeo）
    const albums = await loadList<Record<string, any>>('albums');
    // 跨相册去重：同一张相片可能同时属于多个相册（如「我的照片」+ 命名相册），需按相片实体唯一键去重。
    // 注意：相片的唯一键是 picKey / lloc / sloc（见 core/collector/modules/photos.ts 的 getImageKey），
    // PhotoItem 并没有稳定的 id 字段——之前误用 photo.id 实际恒为 undefined，导致去重全部失效、
    // 跨相册同名相片被重复渲染。
    const seenPhotoKeys = new Set<string>();
    for (const album of albums) {
        const photoList: Record<string, any>[] = album.photoList || [];
        for (const photo of photoList) {
            const lbs = photo.custom_lbs || photo.lbs || photo.shootGeo;
            if (!lbs || !lbs.pos_x || !lbs.pos_y) {
                continue;
            }
            // 实体身份键：优先 picKey → lloc → sloc；三者皆无再退化为「相册+名称」
            const photoKey = photo.picKey != null
                ? String(photo.picKey)
                : (photo.lloc != null
                    ? String(photo.lloc)
                    : (photo.sloc != null
                        ? String(photo.sloc)
                        : `album:${album.id}:${photo.name || ''}`));
            if (seenPhotoKeys.has(photoKey)) {
                continue;
            }
            seenPhotoKeys.add(photoKey);
            const caption = photo.desc || photo.name || '照片';
            items.push({
                tid: photoKey,
                source: 'photos',
                albumId: String(album.id),
                name: lbs.idname || lbs.name || '未知地点',
                posX: Number(lbs.pos_x),
                posY: Number(lbs.pos_y),
                time: photoTimeOf(photo),
                summary: '📷 ' + caption,
                content: caption,
                thumb: photoUrl(photo),
            });
        }
    }

    return items;
}

/** 射线法判断点是否落在多边形内（旧页同款算法，用于把坐标归到省份/国家） */
function inPolygon(point: [number, number], polygon: number[][]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i++) {
        const [sx, sy] = polygon[i];
        const [tx, ty] = polygon[j];
        if ((sx === point[0] && sy === point[1]) || (tx === point[0] && ty === point[1])) {
            return true;
        }
        if ((sy < point[1] && ty >= point[1]) || (sy >= point[1] && ty < point[1])) {
            const x = sx + (point[1] - sy) * (tx - sx) / (ty - sy);
            if (x === point[0]) {
                return true;
            }
            if (x > point[0]) {
                inside = !inside;
            }
        }
    }
    return inside;
}

/** 统计每个区域（省/国家）内的打卡数量（geoJson 区域名经 nameMap 重映射） */
function countByRegion(points: Footprint[], nameMap: Record<string, string>): { name: string; value: number }[] {
    const geoJson = echarts.getMap(mapType.value)?.geoJson;
    if (!geoJson) {
        return [];
    }
    const result: { name: string; value: number }[] = [];
    for (const feature of geoJson.features || []) {
        const name = feature.properties?.name;
        if (!name) {
            continue;
        }
        const rings: number[][][] = feature.geometry?.type === 'MultiPolygon'
            ? (feature.geometry.coordinates || []).flatMap((item: number[][][]) => item)
            : (feature.geometry?.coordinates || []);
        let count = 0;
        for (const point of points) {
            if (rings.some((ring) => inPolygon([point.posX, point.posY], ring))) {
                count++;
            }
        }
        result.push({ name: nameMap?.[name] || name, value: count });
    }
    return result;
}

/** 由足迹计算概览统计（途经地区数用 distinct 地点名，不依赖地图数据，故可早于渲染显示） */
function computeStats(items: Footprint[]): void {
    footprintCount.value = items.length;
    regionCount.value = new Set(items.map((item) => item.name)).size;
    if (items.length === 0) {
        earliest.value = null;
        latest.value = null;
        spanYears.value = 0;
        return;
    }
    const times = items.map((item) => timeValue(item.time)).filter(Boolean).sort((a, b) => a - b);
    earliest.value = times[0]!;
    latest.value = times[times.length - 1]!;
    const y0 = new Date(times[0]!).getFullYear();
    const y1 = new Date(times[times.length - 1]!).getFullYear();
    spanYears.value = y1 - y0 + 1;
}

// —— 筛选 + 排序 + 分组 ——
const filtered = computed(() => {
    const word = keyword.value.trim().toLowerCase();
    return footprints.value.filter((item) => {
        if (typeFilter.value && item.source !== typeFilter.value) {
            return false;
        }
        if (regionFilter.value && item.name !== regionFilter.value) {
            return false;
        }
        if (word && !`${item.name} ${item.content}`.toLowerCase().includes(word)) {
            return false;
        }
        return true;
    });
});

const sorted = computed(() => {
    const arr = [...filtered.value];
    arr.sort((a, b) => {
        const diff = timeValue(a.time) - timeValue(b.time);
        return sortDir.value === 'desc' ? -diff : diff;
    });
    return arr;
});

/** 按「年月」分组（倒序：新的年月在前），组内顺序由 sorted 决定 */
const grouped = computed(() => {
    const map = new Map<string, Footprint[]>();
    for (const item of sorted.value) {
        const month = monthOf(item.time);
        if (!map.has(month)) {
            map.set(month, []);
        }
        map.get(month)!.push(item);
    }
    // 分组顺序必须跟随 sortDir：倒序(默认) newest 在前，正序 oldest 在前。
    // 旧实现硬编码 b[0].localeCompare(a[0])（恒倒序），导致点「时间↑」时月份分组不翻转、
    // 仅组内顺序变，整体看起来「排序没生效」。
    const groupCmp = sortDir.value === 'asc'
        ? (a: [string, Footprint[]], b: [string, Footprint[]]) => a[0].localeCompare(b[0])
        : (a: [string, Footprint[]], b: [string, Footprint[]]) => b[0].localeCompare(a[0]);
    return [...map.entries()]
        .sort(groupCmp)
        .map(([month, items]) => ({ month, items }));
});

/** 地区筛选下拉：数据里实际出现的地点（去重排序） */
const regionOptions = computed(() => {
    const names = [...new Set(footprints.value.map((item) => item.name))].sort();
    return [{ label: '全部地点', value: '' }].concat(names.map((name) => ({ label: name, value: name })));
});

/** 类型筛选下拉：说说 / 相片（仅这两类带坐标） */
const typeOptions = [
    { label: '全部类型', value: '' },
    { label: '说说', value: 'messages' },
    { label: '相片', value: 'photos' },
];

/**
 * 地图散点数据：跟随「类型 + 地区」筛选（不含关键词，避免输入时频繁重绘）。
 * 列表 filtered 额外叠加关键词，故两者在输入搜索时可能不一致（地图属概览）。
 */
const mapPoints = computed(() => {
    return footprints.value.filter((item) => {
        if (typeFilter.value && item.source !== typeFilter.value) {
            return false;
        }
        if (regionFilter.value && item.name !== regionFilter.value) {
            return false;
        }
        return true;
    });
});

function isExpanded(tid: string): boolean {
    return expandedIds.value.has(tid);
}
function toggleExpand(tid: string): void {
    const next = new Set(expandedIds.value);
    if (next.has(tid)) {
        next.delete(tid);
    } else {
        next.add(tid);
    }
    expandedIds.value = next;
}
/** 点击卡片/散点：跳原文（说说→#/messages?id，相片→#/albums?id 所在相册） */
function openDetail(fp: Footprint): void {
    if (fp.source === 'photos' && fp.albumId) {
        navigate('albums', { id: fp.albumId, from: 'map' });
    } else {
        navigate('messages', { id: fp.tid, from: 'map' });
    }
}

const pointIndexById = new Map<string, number>();

/**
 * 渲染地图
 *
 * 必须确保容器已有宽高：echarts 6 在 0×0 容器上会于 geo 坐标系内部抛
 * TypeError: Cannot read properties of null (reading '0')（resizeGeo → legacyCopyOverallTrans），
 * 而不是像 echarts 5 那样只告警。
 */
async function render(): Promise<void> {
    const el = chartEl.value;
    if (!el) {
        return;
    }
    const points = mapPoints.value;
    // 无足迹：不初始化图表，避免 0×0 容器抛错（页面已显式占位）
    if (points.length === 0) {
        chart.value?.dispose();
        chart.value = null;
        return;
    }
    if (!el.clientWidth || !el.clientHeight) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    chart.value?.dispose();
    const fallbackSize = (!el.clientWidth || !el.clientHeight) ? { width: 900, height: 520 } : undefined;
    chart.value = echarts.init(el, undefined, fallbackSize);

    const nameMap = mapType.value === 'world'
        ? (typeof MAP_CONFIG_WORLD === 'undefined' ? {} : MAP_CONFIG_WORLD.KEY_TO_NAME)
        : (typeof MAP_CONFIG_CHINA === 'undefined' ? {} : MAP_CONFIG_CHINA.KEY_TO_NAME);
    const showNameOnWorld = typeof SHOW_NAME_ON_WORLD === 'undefined' ? null : SHOW_NAME_ON_WORLD;

    // 国内地图用的是腾讯的火星坐标系（GCJ02），世界地图需转成 WGS84，否则整体偏移
    const plotted = mapType.value === 'world'
        ? points.map((item) => {
            const [posX, posY] = coordtransform.gcj02towgs84(item.posX, item.posY);
            return { ...item, posX, posY };
        })
        : points;

    const regions = countByRegion(plotted, nameMap);
    pointIndexById.clear();
    plotted.forEach((item, index) => pointIndexById.set(item.tid, index));

    chart.value.setOption({
        tooltip: { trigger: 'item', confine: true },
        toolbox: {
            show: true,
            feature: { saveAsImage: { title: '截图分享' }, restore: {} },
        },
        visualMap: [{
            type: 'continuous',
            min: 0,
            max: Math.max(plotted.length, 1),
            text: ['常驻', '逗留'],
            calculable: true,
            seriesIndex: 1,
            inRange: { color: ['lightskyblue', 'yellow', 'orangered'] },
        }],
        geo: [{
            map: mapType.value,
            roam: true,
            zoom: mapType.value === 'world' ? 1 : 1.5,
            scaleLimit: { min: 1 },
            center: mapType.value === 'world' ? [5, 18] : [106.278179, 35.46637],
            ...(isDark.value ? {
                itemStyle: { areaColor: '#1a1a24', borderColor: '#3a3a4a' },
                emphasis: {
                    itemStyle: { areaColor: '#2a2a3a' },
                    label: { show: true, color: '#e0e0e0', formatter: (params: any) => params.name },
                },
            } : {}),
            label: {
                show: true,
                color: isDark.value ? '#aaa' : undefined,
                formatter: (params: any) => {
                    if (mapType.value === 'world' && showNameOnWorld
                        && !Object.prototype.hasOwnProperty.call(showNameOnWorld.NAME_TO_KEY, params.name)) {
                        return '';
                    }
                    return params.name;
                },
            },
            emphasis: { label: { show: true, formatter: (params: any) => params.name } },
            regions: [{ name: '南海诸岛', itemStyle: { opacity: 0 }, label: { show: false } }],
            nameMap,
        }],
        series: [
            {
                name: '打卡足迹',
                type: 'scatter',
                coordinateSystem: 'geo',
                geoIndex: 0,
                symbolSize: 8,
                itemStyle: { color: isDark.value ? '#409eff' : '#007bff' },
                tooltip: {
                    formatter: (params: any) => {
                        const item: Footprint = params.data.item;
                        const lines = [`我的足迹：<b>${item.name}</b>`];
                        if (item.time) {
                            lines.push(`打卡时间：${formatTime(item.time)}`);
                        }
                        if (item.summary) {
                            lines.push(`${item.source === 'photos' ? '相片' : '说说'}：${item.summary}`);
                        }
                        return lines.join('<br>');
                    },
                },
                data: plotted.map((item) => ({ name: item.name, value: [item.posX, item.posY], item })),
            },
            {
                name: '途径区域',
                type: 'map',
                geoIndex: 0,
                tooltip: {
                    formatter: (params: any) => {
                        if (!params.value || params.value < 1) {
                            return `还没去过 <b>${params.name}</b>`;
                        }
                        return `途径：<b>${params.name}</b><br>足迹：<b>${params.value}</b> 处`;
                    },
                },
                data: regions,
            },
        ],
    });

    // 点击散点 → 跳原文（与左栏列表互为入口）
    chart.value.on('click', (params: any) => {
        const item: Footprint | undefined = params?.data?.item;
        if (item?.tid) {
            openDetail(item);
        }
    });
}

/** 列表 hover / 选中时，让地图对应散点高亮并弹 tip（tid → dataIndex） */
function focusOnMap(tid: string): void {
    const idx = pointIndexById.get(tid);
    if (idx == null || !chart.value) {
        return;
    }
    chart.value.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: idx });
    chart.value.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: idx });
}

function onResize(): void {
    chart.value?.resize();
}

onMounted(async () => {
    let stage = '加载地图依赖';
    try {
        await loadScript('./Common/vendor/echarts.min.js');
        await Promise.all([
            loadScript('./Common/vendor/coordtransform.min.js'),
            loadScript('./Common/vendor/maps/config.js'),
        ]);
        await Promise.all([
            loadScript('./Common/vendor/maps/china.js'),
            loadScript('./Common/vendor/maps/world.js'),
        ]);

        stage = '读取足迹位置';
        const items = await collectFootprints();
        footprints.value = items;
        computeStats(items);
        loading.value = false;

        stage = '渲染地图';
        await new Promise((resolve) => requestAnimationFrame(resolve));
        await render();
        window.addEventListener('resize', onResize);
    } catch (err) {
        loading.value = false;
        console.error('足迹地图失败（' + stage + '）', err);
        error.value = stage + '失败：' + ((err as Error).message || '未知错误');
    }
});

onBeforeUnmount(() => {
    window.removeEventListener('resize', onResize);
    chart.value?.dispose();
});

watch(mapType, async () => {
    if (loading.value || error.value) {
        return;
    }
    try {
        await render();
    } catch (err) {
        console.error('切换地图失败', err);
        error.value = '切换地图失败：' + ((err as Error).message || '未知错误');
    }
});

watch([typeFilter, regionFilter], async () => {
    if (loading.value || error.value || !chartEl.value) {
        return;
    }
    try {
        await render();
    } catch (err) {
        console.error('筛选重绘地图失败', err);
    }
});

watch(isDark, async () => {
    if (loading.value || error.value) {
        return;
    }
    try {
        await render();
    } catch (err) {
        console.error('主题切换后重新渲染地图失败', err);
    }
});
</script>

<template>
    <div class="page-head">
        足迹地图
        <span v-if="!loading && !error" class="head-count">
            共 {{ footprintCount }} 处打卡，途经 {{ regionCount }} 个{{ mapType === 'world' ? '国家/地区' : '省/市/区' }}
        </span>
        <n-radio-group v-model:value="mapType" size="small" class="switch">
            <n-radio-button value="china">中国</n-radio-button>
            <n-radio-button value="world">世界</n-radio-button>
        </n-radio-group>
    </div>

    <div class="page-body foot-body">
        <n-spin v-if="loading" size="large" class="foot-loading" />

        <n-alert v-else-if="error" type="warning" :show-icon="true" class="foot-error">
            {{ error }}。若提示依赖缺失，可在助手设置页的「工具 → 升级已有备份」中选中本备份目录，
            补齐 viewer/vendor 下的地图依赖。
        </n-alert>

        <template v-else>
            <!-- 模块 A：概览统计条 -->
            <div class="stat-bar">
                <div class="stat-item">
                    <span class="stat-num">{{ footprintCount }}</span>
                    <span class="stat-label">处打卡</span>
                </div>
                <div class="stat-item">
                    <span class="stat-num">{{ regionCount }}</span>
                    <span class="stat-label">个地区</span>
                </div>
                <div class="stat-item">
                    <span class="stat-num">{{ earliest ? new Date(earliest).getFullYear() : '—' }}</span>
                    <span class="stat-label">最早</span>
                </div>
                <div class="stat-item">
                    <span class="stat-num">{{ latest ? new Date(latest).getFullYear() : '—' }}</span>
                    <span class="stat-label">最晚</span>
                </div>
                <div class="stat-item">
                    <span class="stat-num">{{ spanYears || '—' }}</span>
                    <span class="stat-label">跨度(年)</span>
                </div>
            </div>

            <div class="foot-layout">
                <!-- 模块 B + C：筛选栏 + 足迹时间线列表 -->
                <section class="foot-list">
                    <div class="toolbar">
                        <n-input
                            v-model:value="keyword"
                            placeholder="搜索地点 / 内容"
                            clearable
                            size="small"
                            style="width: 160px;"
                        />
                        <n-select
                            v-model:value="typeFilter"
                            :options="typeOptions"
                            size="small"
                            style="width: 110px;"
                        />
                        <n-select
                            v-model:value="regionFilter"
                            :options="regionOptions"
                            placeholder="全部地点"
                            clearable
                            size="small"
                            style="width: 150px;"
                        />
                        <n-radio-group v-model:value="sortDir" size="small">
                            <n-radio-button value="desc">时间↓</n-radio-button>
                            <n-radio-button value="asc">时间↑</n-radio-button>
                        </n-radio-group>
                    </div>

                    <div class="list-scroll">
                        <n-empty
                            v-if="filtered.length === 0"
                            description="没有符合条件的足迹"
                            class="list-empty"
                        />
                        <div v-for="group in grouped" :key="group.month" class="month-group">
                            <div class="month-label">{{ group.month }}</div>
                            <div
                                v-for="item in group.items"
                                :key="item.tid"
                                class="fp-card"
                                @click="openDetail(item)"
                                @mouseenter="focusOnMap(item.tid)"
                            >
                                <div class="fp-head">
                                    <n-tag size="small" :bordered="false" :type="item.source === 'photos' ? 'warning' : 'info'">{{ item.source === 'photos' ? '相片' : '说说' }}</n-tag>
                                    <n-tag size="small" :bordered="false" type="info">{{ item.name }}</n-tag>
                                    <span class="fp-time">{{ formatTime(item.time) }}</span>
                                </div>
                                <div class="fp-content">
                                    {{ isExpanded(item.tid) ? item.content : item.summary }}
                                    <n-button
                                        v-if="item.content.length > 80"
                                        text
                                        size="tiny"
                                        type="primary"
                                        class="fp-expand"
                                        @click.stop="toggleExpand(item.tid)"
                                    >{{ isExpanded(item.tid) ? '收起' : '展开' }}</n-button>
                                </div>
                                <img v-if="item.thumb" :src="item.thumb" class="fp-thumb" alt="" />
                            </div>
                        </div>
                    </div>
                </section>

                <!-- 模块 D：地图（概览） -->
                <section class="foot-map">
                    <div v-show="mapPoints.length > 0" ref="chartEl" class="map" />
                    <n-empty
                        v-if="mapPoints.length === 0"
                        :description="footprintCount === 0 ? '本备份没有带位置的足迹（说说选择地点、或相片带上传/拍摄地点）' : '当前筛选条件下没有足迹'"
                        class="map-empty"
                    />
                </section>
            </div>
        </template>
    </div>
</template>

<style scoped>
/* 容器：撑满、纵向排列统计条 + 分栏 */
.foot-body {
    display: flex;
    flex-direction: column;
    padding: 12px 16px 16px;
    overflow: hidden;
}
.foot-loading {
    align-self: center;
    margin: 40px 0;
}
.foot-error {
    margin: 16px;
}
.head-count {
    margin-left: 10px;
    font-size: 12px;
    font-weight: normal;
    color: var(--text-muted);
}
.switch {
    margin-left: 14px;
}

/* 模块 A：概览统计条 */
.stat-bar {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 10px;
    margin-bottom: 10px;
    background: var(--bg-toolbar, #f5f6f8);
    border-radius: 8px;
}
.stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 56px;
    padding: 2px 8px;
}
.stat-num {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.2;
}
.stat-label {
    font-size: 11px;
    color: var(--text-muted);
}

/* 分栏：列表 42% / 地图 58% */
.foot-layout {
    display: flex;
    gap: 12px;
    flex: 1;
    min-height: 0;
}
.foot-list {
    display: flex;
    flex-direction: column;
    width: 42%;
    min-width: 280px;
    overflow: hidden;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
}
.foot-map {
    display: flex;
    flex: 1;
    min-width: 0;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    overflow: hidden;
}

/* 模块 B：筛选栏 */
.toolbar {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border, #e5e7eb);
    background: var(--bg-primary, #fff);
}

/* 模块 C：时间线列表 */
.list-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 8px 10px;
}
.list-empty {
    padding: 30px 0;
}
.month-group {
    margin-bottom: 10px;
}
.month-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    padding: 4px 2px;
    position: sticky;
    top: 0;
    background: var(--bg-primary, #fff);
    z-index: 1;
}
.fp-card {
    padding: 8px 10px;
    margin-bottom: 8px;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
}
.fp-card:hover {
    background: var(--bg-toolbar, #f5f6f8);
    border-color: var(--border-dashed, #c9d1dc);
}
.fp-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
}
.fp-time {
    font-size: 12px;
    color: var(--text-muted);
}
.fp-content {
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-primary);
}
.fp-expand {
    margin-left: 6px;
}
.fp-thumb {
    display: block;
    max-width: 96px;
    max-height: 96px;
    margin-top: 6px;
    border-radius: 6px;
    object-fit: cover;
}

/* 模块 D：地图 */
.map {
    flex: 1;
    min-height: 420px;
    background: var(--bg-map, #c5d6e7);
}
.map-empty {
    margin: auto;
}

/* 窄屏：地图过小、交互不便，直接隐藏地图，列表撑满剩余空间 */
@media (max-width: 900px) {
    .foot-layout {
        flex-direction: column;
    }
    .foot-list {
        width: 100%;
        min-width: 0;
        max-height: none;
        flex: 1;
    }
    .foot-map {
        display: none;
    }
    .switch {
        display: none;
    }
}
</style>
