<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue';
import { NDataTable, NEmpty, NInput, NRadioButton, NRadioGroup, NSelect, NSpin, NTag, type DataTableColumns } from 'naive-ui';
import { loadList } from '../data/sources';
import { getModulePref, savePref, type ShowType } from '../data/displayPrefs';
import { formatTime, timeValue } from '../data/format';
import { formatSummary } from '../data/richText';
import { collectInteractiveUsers, type InteractiveUser } from '../data/interactive';
import {
    friendCommonCount,
    friendDisplayName,
    friendNick,
    messageUrl,
} from '../data/content';
import ThatYearToday from '../components/ThatYearToday.vue';
import FriendItem from '../components/items/FriendItem.vue';
import UserAvatar from '../components/UserAvatar.vue';

/**
 * 好友列表（数据来自 Friends/json/friends.js）
 * 字段与旧表格页一致（src/export/js/friends.js）：备注、分组、特别关心、访问权限、
 * 好友关系、相识时间、亲密度、共同好友/群组
 */
const loading = ref(true);
const list = ref<Record<string, any>[]>([]);
const keyword = ref('');
/** 筛选值：'' 全部；'group:xxx' QQ 分组；'special:xxx' 特殊分组 */
const group = ref('');
/** '0' 表格 · '1' 列表（好友为卡片视图，列表即卡片流） */
const showType = ref<ShowType>('1');
const sortField = ref(getModulePref('friends').sortField || 'default');
const sortDir = ref<'desc' | 'asc'>(getModulePref('friends').sortDir);

// 展示方式（表格/列表）变更后按模块持久化
watch(showType, (value) => savePref('friends', { showType: value }));
// 排序字段/方向变更后持久化（与其他列表一致的排序记忆）
watch(sortField, (value) => savePref('friends', { sortField: value }));
watch(sortDir, (value) => savePref('friends', { sortDir: value }));

const SORT_FIELD_OPTIONS = [
    { label: '默认', value: 'default' },
    { label: '相识时间', value: 'time' },
    { label: '亲密度', value: 'intimacy' },
    { label: '共同好友', value: 'common' },
];
const SORT_DIR_OPTIONS = [
    { label: '降序', value: 'desc' },
    { label: '升序', value: 'asc' },
];

/**
 * 好友昵称与备注
 * 昵称就是 nick（不是 name，旧页的表格页同样取该字段），备注就是 remark；
 * 两列各显各自的真实值、不互相回退，否则看不出谁有备注、谁只有昵称。
 * 两者都可能带表情 token，需富文本转换后才能看。（取值实现在 data/content.ts）
 */
function remarkOf(row: Record<string, any>): string {
    return row.remark || '';
}

onMounted(async () => {
    list.value = await loadList('friends');
    showType.value = getModulePref('friends').showType;
    loading.value = false;
    // 互动用户要扫全部模块，量可能大，放到好友渲染之后再算，不阻塞首屏
    try {
        const users = await collectInteractiveUsers();
        const friendUins = new Set(list.value.map((item) => String(item.uin)));
        interactiveUins.value = new Set(users.map((user) => user.uin));
        // 空间过客：在互动用户里、但不是好友（他们不在 friends 列表里，单独保存）
        passerby.value = users.filter((user) => !friendUins.has(user.uin));
    } catch (error) {
        console.warn('收集互动用户失败', error);
    }
});

/**
 * 互动用户（uin 集合）与空间过客
 * null 表示尚未算完，此时互动/潜水/过客三个分组暂不可选
 */
const interactiveUins = ref<Set<string> | null>(null);
const passerby = ref<InteractiveUser[]>([]);

/**
 * 特殊分组
 * 旧页把这些做成了列表页的特殊分组（见 src/export/js/friends.js 的 getSpecialGroup），
 * 这里归到同一个筛选下拉里。只保留仅依赖好友数据本身的那些；
 * 互动/潜水/过客需要汇总全部模块的互动用户，成本高，暂未迁移。
 */
const YEAR_MS = 365 * 24 * 3600 * 1000;
const SPECIAL_GROUPS: { value: string; label: string }[] = [
    { value: 'care', label: '特别关心' },
    { value: 'access', label: '无权访问' },
    { value: 'oneway', label: '单向好友' },
    { value: 'deleted', label: '已删好友' },
    { value: 'new', label: '新的好友' },
    { value: 'year5', label: '五年好友' },
    { value: 'year10', label: '十年老友' },
    { value: 'year20', label: '廿年旧友' },
    { value: 'first', label: '首个好友' },
    { value: 'latest', label: '最新好友' },
    { value: 'intimacy', label: '互动好友' },
    { value: 'diving', label: '潜水好友' },
];

/** 首个/最新好友靠相识时间的极值识别，不统计相识时间为 0 的 */
const extremes = computed(() => {
    let first: Record<string, any> | null = null;
    let latest: Record<string, any> | null = null;
    for (const item of list.value) {
        const time = timeValue(item.addFriendTime);
        if (!time) {
            continue;
        }
        if (!first || time < timeValue(first.addFriendTime)) {
            first = item;
        }
        if (!latest || time > timeValue(latest.addFriendTime)) {
            latest = item;
        }
    }
    return { first, latest };
});

function matchSpecial(key: string, item: Record<string, any>): boolean {
    const time = timeValue(item.addFriendTime);
    switch (key) {
        case 'care':
            return !!item.care;
        case 'access':
            return item.access === false || item.access === 0;
        case 'oneway':
            // 接口用 2 表示单向，早期数据里也出现过 0
            return item.isFriend === 2 || item.isFriend === 0;
        case 'deleted':
            return !!item.deleted;
        case 'new':
            return !!time && Date.now() - time <= 30 * 24 * 3600 * 1000;
        case 'year5':
            return !!time && Date.now() - time >= 5 * YEAR_MS;
        case 'year10':
            return !!time && Date.now() - time >= 10 * YEAR_MS;
        case 'year20':
            return !!time && Date.now() - time >= 20 * YEAR_MS;
        case 'first':
            return !!extremes.value.first && extremes.value.first === item;
        case 'latest':
            return !!extremes.value.latest && extremes.value.latest === item;
        case 'intimacy':
            // 是好友且在互动用户里
            return !!interactiveUins.value && interactiveUins.value.has(String(item.uin));
        case 'diving':
            // 是好友但从不在互动用户里（互动数据未算完时不归入，避免误判）
            return !!interactiveUins.value && !interactiveUins.value.has(String(item.uin));
        default:
            return true;
    }
}

const groupOptions = computed(() => {
    const groups = new Set<string>();
    for (const item of list.value) {
        groups.add(item.groupName || '未分组');
    }
    // 空分组不列出来，选了也只是一片空白
    const specials = SPECIAL_GROUPS
        .map((special) => ({
            ...special,
            total: list.value.filter((item) => matchSpecial(special.value, item)).length,
        }))
        .filter((special) => special.total > 0)
        .map((special) => ({ label: `${special.label}（${special.total}）`, value: 'special:' + special.value }));

    // 空间过客不是好友集合的子集，单独追加
    if (passerby.value.length > 0) {
        specials.push({ label: `空间过客（${passerby.value.length}）`, value: 'special:passerby' });
    }

    return [
        { label: '全部好友', value: '' },
        {
            type: 'group',
            key: 'qq',
            label: 'QQ 分组',
            children: [...groups].map((name) => ({ label: name, value: 'group:' + name })),
        },
        { type: 'group', key: 'special', label: '特殊分组', children: specials },
    ];
});

/** 选中「空间过客」时展示的是非好友的互动用户，其余情况都是好友列表 */
const baseList = computed<Record<string, any>[]>(() => (
    group.value === 'special:passerby' ? (passerby.value as Record<string, any>[]) : list.value
));

const filtered = computed(() => baseList.value.filter((item) => {
    // passerby 的数据源已是过客列表，无需再走特殊分组谓词
    if (group.value.startsWith('special:') && group.value !== 'special:passerby'
        && !matchSpecial(group.value.slice(8), item)) {
        return false;
    }
    if (group.value.startsWith('group:') && (item.groupName || '未分组') !== group.value.slice(6)) {
        return false;
    }
    const word = keyword.value.trim().toLowerCase();
    if (!word) {
        return true;
    }
    return [item.name, item.remark, item.uin]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(word);
}));
/** 默认不排：备份里的顺序跟 QQ 分组一致，直接重排反而找不到人 */
const sorted = computed(() => {
    if (sortField.value === 'default') {
        return filtered.value;
    }
    const valueOf = (item: Record<string, any>): number => {
        if (sortField.value === 'intimacy') {
            return Number(item.intimacyScore || 0);
        }
        if (sortField.value === 'common') {
            return friendCommonCount(item);
        }
        return timeValue(item.addFriendTime);
    };
    return [...filtered.value].sort((a, b) => {
        const diff = valueOf(a) - valueOf(b);
        return sortDir.value === 'desc' ? -diff : diff;
    });
});

/** 是否单向好友：isFriend 为 0/false 时表示对方已不是好友 */
function friendState(row: Record<string, any>): string {
    // 空间过客本就不是好友（无 isFriend 字段），单独标出，不能默认当成互为好友
    if (group.value === 'special:passerby') {
        return '非好友';
    }
    if (row.deleted) {
        return '已删除';
    }
    return row.isFriend === 0 || row.isFriend === false ? '单向好友' : '互为好友';
}

/*
 * 共同好友数取 friendCommonCount（data/content.ts）：
 * common.friend 存的是好友对象数组（见 api.js 的 getCommonFriend），展示的是个数，
 * 直接把数组交给表格会渲染成 [object Object]。
 */

/**
 * 共同群组名称
 * common.group 的元素是 { name } 对象（旧页 getCommonGroup 同样取 name），
 * 但旧版会把该字段回写成字符串数组，所以两种形态都要兼容。
 */
function commonGroupNames(row: Record<string, any>): string {
    const groups = row.common?.group;
    if (!Array.isArray(groups)) {
        return groups ? String(groups) : '';
    }
    return groups
        .map((item) => (item && typeof item === 'object' ? item.name || item.groupName || '' : item))
        .filter(Boolean)
        .join('，');
}

const columns: DataTableColumns<Record<string, any>> = [
    { title: '', key: 'avatar', width: 52, render: (row) => h(UserAvatar, { uin: row.uin, size: 32, link: false }) },
    { title: 'QQ', key: 'uin', width: 110 },
    {
        title: '昵称',
        key: 'nick',
        ellipsis: { tooltip: true },
        // 昵称里可能带表情 token，需富文本渲染
        render: (row) => h('span', { innerHTML: formatSummary(friendNick(row)) }),
    },
    {
        title: '备注',
        key: 'remark',
        ellipsis: { tooltip: true },
        render: (row) => h('span', { innerHTML: formatSummary(remarkOf(row)) }),
    },
    { title: '分组', key: 'groupName', width: 120, render: (row) => row.groupName || '未分组' },
    {
        title: '特别关心',
        key: 'care',
        width: 90,
        align: 'center',
        render: (row) => (row.care ? h(NTag, { size: 'small', type: 'warning', bordered: false }, { default: () => '关心' }) : ''),
    },
    {
        title: '好友关系',
        key: 'isFriend',
        width: 100,
        align: 'center',
        render: (row) => friendState(row),
    },
    {
        title: '相识时间',
        key: 'addFriendTime',
        width: 170,
        render: (row) => formatTime(row.addFriendTime),
    },
    {
        title: '亲密度',
        key: 'intimacyScore',
        width: 90,
        align: 'center',
        sorter: (a, b) => Number(a.intimacyScore || 0) - Number(b.intimacyScore || 0),
        render: (row) => row.intimacyScore || 0,
    },
    {
        title: '共同好友',
        key: 'commonFriend',
        width: 100,
        align: 'center',
        sorter: (a, b) => friendCommonCount(a) - friendCommonCount(b),
        render: (row) => friendCommonCount(row),
    },
    {
        title: '共同群组',
        key: 'commonGroup',
        ellipsis: { tooltip: true },
        render: (row) => commonGroupNames(row),
    },
    {
        // 旧表格页的「QQ通讯」列：点一下就能拉起 QQ 聊天窗口
        title: '聊天',
        key: 'message',
        width: 80,
        align: 'center',
        render: (row) => (row.uin
            ? h('a', { href: messageUrl(row.uin), title: '发起 QQ 聊天', class: 'chat-link' }, '聊天')
            : ''),
    },
];
</script>

<template>
    <div class="page-head">
        好友
        <span v-if="!loading && list.length > 0" class="head-count">
            共 {{ list.length }} 位{{ filtered.length !== list.length ? `，筛选出 ${filtered.length} 位` : '' }}
        </span>
    </div>

    <div class="page-body">
        <div v-if="loading" class="loading">
            <n-spin size="large" />
        </div>

        <n-empty
            v-else-if="list.length === 0"
            description="暂无好友数据（本次备份可能未包含好友模块）"
            size="large"
            class="friends-empty"
        />

        <template v-else>
            <!-- 那年今日（按相识时间算）；本页不走 ListPage，故直接放在工具栏之前 -->
            <that-year-today
                :items="list"
                :time-of="(item: Record<string, any>) => item.addFriendTime"
            >
                <template #item="{ item }">
                    <friend-item :item="item" />
                </template>
            </that-year-today>

            <!-- 工具栏按职能分区：【视图】【筛选】在左，【排序+搜索】靠右 -->
            <div class="list-toolbar">
                <div class="toolbar-group">
                    <n-radio-group v-model:value="showType">
                        <n-radio-button value="1">列表</n-radio-button>
                        <n-radio-button value="0">表格</n-radio-button>
                    </n-radio-group>
                </div>
                <div class="toolbar-group">
                    <span class="toolbar-label">分组</span>
                    <n-select v-model:value="group" :options="groupOptions" style="width: 180px;" />
                </div>
                <div class="toolbar-group to-right">
                    <span class="toolbar-label">排序</span>
                    <n-select v-model:value="sortField" :options="SORT_FIELD_OPTIONS" style="width: 140px;" />
                    <n-select v-model:value="sortDir" :options="SORT_DIR_OPTIONS" :disabled="sortField === 'default'" style="width: 90px;" />
                    <n-input v-model:value="keyword" placeholder="搜索昵称、备注或 QQ" clearable style="width: 220px;" />
                </div>
            </div>
            <n-data-table
                v-if="showType === '0'"
                :columns="columns"
                :data="sorted"
                :row-key="(row) => row.uin"
                :bordered="false"
                :pagination="{ pageSize: 50 }"
                size="small"
            />
            <div v-else class="cards">
                <div v-for="item in sorted" :key="item.uin" class="friend-cell">
                    <friend-item :item="item" />
                </div>
            </div>
        </template>
    </div>
</template>

<style scoped>
/* 列表视图：多列卡片，比表格更紧凑也更像空间的好友列表 */
.cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
}
/* 单个好友卡片的样式已随渲染一起进了 items/FriendItem.vue */
.friend-cell {
    min-width: 0;
}
.head-count {
    margin-left: 10px;
    font-size: 12px;
    font-weight: normal;
    color: var(--text-muted);
}
.loading {
    display: flex;
    justify-content: center;
    padding: 40px 0;
}
/* 模块无数据：占满滚动区剩余高度，上下左右居中 */
.friends-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
}
</style>
