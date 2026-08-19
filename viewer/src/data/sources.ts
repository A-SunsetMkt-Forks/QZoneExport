/**
 * 备份数据加载
 *
 * 备份包里的数据是「JS 挂全局变量」的形式（`window.messages = [...]`，见
 * src/js/modules/common.js 的 writeJsonToJs），这是为了规避 file:// 下 fetch 本地
 * JSON 的跨域限制。查看器沿用同一套数据文件，因此加载方式只能是注入 <script>：
 * file:// 下 fetch/XHR 会被浏览器直接拒绝，而 <script> 不受此限制。
 */

/**
 * 备份根目录相对查看器页面的位置
 * 查看器位于备份根目录的 index.html（与数据目录同级），故生产模式用 './'；
 * 开发时读 viewer/mock 下的样例数据（结构与真实备份一致）。
 */
export const DATA_BASE = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV ? './mock/' : './';

/** 数据源定义：备份内的文件路径 + 它挂载的全局变量名
 *
 * 注意：全局变量名必须与采集端 `writeJsonToJs(全局名, ...)` 的第一个参数逐字对应
 * （见 src/js/modules/*.js），不能按模块名猜：留言为 boardInfo、访客为 visitorInfo、
 * 助手配置为 QZone_Config，且留言/访客是带 items 的对象而非数组。
 */
const DATA_SOURCES = {
    user: { file: 'Common/json/user.js', global: 'userInfo' },
    config: { file: 'Common/json/config.js', global: 'QZone_Config' },
    messages: { file: 'Messages/json/messages.js', global: 'messages' },
    blogs: { file: 'Blogs/json/blogs.js', global: 'blogs' },
    diaries: { file: 'Diaries/json/diaries.js', global: 'diaries' },
    albums: { file: 'Albums/json/albums.js', global: 'albums' },
    videos: { file: 'Videos/json/videos.js', global: 'videos' },
    boards: { file: 'Boards/json/boards.js', global: 'boardInfo' },
    friends: { file: 'Friends/json/friends.js', global: 'friends' },
    favorites: { file: 'Favorites/json/favorites.js', global: 'favorites' },
    shares: { file: 'Shares/json/shares.js', global: 'shares' },
    visitors: { file: 'Visitors/json/visitors.js', global: 'visitorInfo' },
} as const;

export type DataKey = keyof typeof DATA_SOURCES;

/** 各数据源对应的备份目录名（用于修复旧格式媒体路径） */
const MODULE_DIRS: Record<DataKey, string> = {
    user: 'Common',
    config: 'Common',
    messages: 'Messages',
    blogs: 'Blogs',
    diaries: 'Diaries',
    albums: 'Albums',
    videos: 'Videos',
    boards: 'Boards',
    friends: 'Friends',
    favorites: 'Favorites',
    shares: 'Shares',
    visitors: 'Visitors',
};

/** 备份根目录下的顶层目录：路径以这些开头说明已是根相对（新格式），无需修复 */
const TOP_LEVEL_DIRS = ['Common', 'Messages', 'Blogs', 'Diaries', 'Albums', 'Videos', 'Boards', 'Friends', 'Favorites', 'Shares', 'Visitors'];

/** 路径是否已为根相对（以备份顶层目录开头），用于区分新格式与旧模块相对格式 */
export function isRootRelativePath(path: string): boolean {
    return TOP_LEVEL_DIRS.includes(path.split('/')[0] ?? '');
}

/** 媒体路径字段：旧采集器只往这些字段写「模块相对」路径 */
const MEDIA_PATH_KEYS = new Set(['custom_filepath', 'custom_pre_filepath']);

/**
 * 把可能为「模块相对」的媒体路径归一为根相对（历史备份兼容）
 *
 * 旧备份把部分媒体路径记为模块相对（如 images/xxx，文件实际在 {module}/images/下，
 * 因旧查看器页面位于模块目录内）。新查看器在备份根目录，需给这类路径补上模块名。
 * 规则：URL / data: / / 开头的绝对路径原样返回；以顶层目录开头（新格式）原样返回；
 * 其余视为旧格式模块相对，补上模块名。
 */
export function normalizeModulePath(path: string, moduleDir: string): string {
    if (!path || /^(https?:)?\/\//.test(path) || path.startsWith('data:') || path.startsWith('/')) {
        return path;
    }
    const stripped = path.replace(/^(\.\.\/)+/, '');
    return isRootRelativePath(stripped) ? stripped : moduleDir + '/' + stripped;
}

/**
 * 修复加载数据中的旧格式媒体路径（历史备份兼容）
 *
 * 旧采集器把媒体文件下载到模块级目录（如 Messages/images/），但数据里只记
 * 模块相对路径 images/xxx（旧查看器页面位于模块目录内，相对解析正好命中）。
 * 新查看器位于备份根目录，需给这类路径补上模块名才能解析到真实文件。
 * 新采集器直接写根相对路径（Messages/images/xxx），以顶层目录开头，不受影响。
 */
function normalizeMediaPaths(node: unknown, moduleDir: string): void {
    if (Array.isArray(node)) {
        for (const item of node) {
            normalizeMediaPaths(item, moduleDir);
        }
        return;
    }
    if (!node || typeof node !== 'object') {
        return;
    }
    for (const [key, value] of Object.entries(node)) {
        if (MEDIA_PATH_KEYS.has(key) && typeof value === 'string' && value) {
            const normalized = normalizeModulePath(value, moduleDir);
            if (normalized !== value) {
                (node as Record<string, unknown>)[key] = normalized;
            }
        } else if (value && typeof value === 'object') {
            normalizeMediaPaths(value, moduleDir);
        }
    }
}

/** 已加载过的数据（含加载失败的 null，避免反复重试同一个缺失文件） */
const cache = new Map<DataKey, unknown>();

/** 注入脚本，加载失败不抛错——某个模块没备份时它的数据文件本就不存在 */
function loadScript(src: string): Promise<boolean> {
    return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = src;
        script.addEventListener('load', () => resolve(true));
        script.addEventListener('error', () => resolve(false));
        document.head.appendChild(script);
    });
}

/**
 * 读取某个模块的数据
 * @returns 数据；该模块未备份（文件不存在或变量未挂载）时返回 null
 */
export async function loadData<T = unknown>(key: DataKey): Promise<T | null> {
    if (cache.has(key)) {
        return cache.get(key) as T | null;
    }
    const source = DATA_SOURCES[key];
    const ok = await loadScript(DATA_BASE + source.file);
    const value = ok ? ((window as Record<string, any>)[source.global] ?? null) : null;
    // 历史备份兼容：旧格式媒体路径（模块相对）统一补上模块名
    if (value) {
        normalizeMediaPaths(value, MODULE_DIRS[key]);
    }
    cache.set(key, value);
    return value as T | null;
}

/** 读取列表型数据，缺失时给空数组，省去调用方逐个判空 */
export async function loadList<T = any>(key: DataKey): Promise<T[]> {
    const data = await loadData<T[]>(key);
    return Array.isArray(data) ? data : [];
}

/**
 * 读取条目列表，兼容「直接是数组」与「{ total, items } 对象」两种形态
 * 留言（boardInfo）与访客（visitorInfo）属于后者，它们除 items 外还带了主人寄语、总数等信息。
 */
export async function loadItems<T = any>(key: DataKey): Promise<T[]> {
    const data = await loadData<any>(key);
    if (Array.isArray(data)) {
        return data as T[];
    }
    return Array.isArray(data?.items) ? (data.items as T[]) : [];
}

/** 读取备份时的助手配置（列表展示方式等用它作初始值） */
export async function loadBackupConfig(): Promise<Record<string, any>> {
    const config = await loadData<Record<string, any>>('config');
    return config || {};
}

/**
 * 把备份内的相对路径转为查看器可用的地址
 * 数据里记录的媒体路径是相对备份根的（如 Messages/images/xxx.jpg），
 * 而查看器在 viewer/ 子目录下，需要补上前缀；已是完整 URL（未下载媒体、用空间外链
 * 的情况）则原样返回。
 */
export function assetUrl(path?: string | null): string {
    if (!path) {
        return '';
    }
    if (/^(https?:)?\/\//.test(path) || path.startsWith('data:')) {
        return path;
    }
    return DATA_BASE + path.replace(/^\.\//, '').replace(/^\//, '');
}
