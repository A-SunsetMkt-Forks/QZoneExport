import { ref } from 'vue';

const STORAGE_KEY = 'qzone_viewer_theme';
type Theme = 'light' | 'dark';

/** 模块级单例：当前是否为暗色模式 */
const isDark = ref(false);
/** 是否已初始化（避免 init() 重复执行） */
let _initialized = false;

function readStored(): Theme | null {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === 'dark' || v === 'light') return v;
    } catch { /* localStorage 不可用 */ }
    return null;
}

function writeStored(theme: Theme): void {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* noop */ }
}

function applyHtmlClass(dark: boolean): void {
    document.documentElement.classList.toggle('dark', dark);
}

export function useTheme() {
    if (!_initialized) {
        _initialized = true;
        const stored = readStored();
        isDark.value = stored === 'dark';
        applyHtmlClass(isDark.value);
    }

    function toggle(): void {
        isDark.value = !isDark.value;
        writeStored(isDark.value ? 'dark' : 'light');
        applyHtmlClass(isDark.value);
    }

    return { isDark, toggle };
}
