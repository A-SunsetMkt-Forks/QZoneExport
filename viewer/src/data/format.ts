/**
 * 备份内容的共享格式化工具
 * 备份数据里的时间字段格式不统一（秒级时间戳 / 已格式化字符串 / 毫秒），统一在此收口。
 */

/** 合法时间范围（毫秒级时间戳）：1990-01-01 ~ 2100-12-31，用于过滤 1970、2106 等异常值 */
const MIN_VALID_MS = new Date(1990, 0, 1, 0, 0, 0).getTime();
const MAX_VALID_MS = new Date(2100, 11, 31, 23, 59, 59).getTime();

/** 判断毫秒级时间戳是否在合理范围内（避免 2106 年 UINT32 溢出、1970 年默认值等异常） */
export function isValidTimestampMs(ms: number): boolean {
    return ms >= MIN_VALID_MS && ms <= MAX_VALID_MS;
}

/** 把备份里各种形态的时间统一成 yyyy-MM-dd HH:mm:ss */
export function formatTime(value?: number | string | null): string {
    if (value === undefined || value === null || value === '') {
        return '';
    }
    // 已是格式化好的字符串（采集时写入的 custom_create_time 等）
    if (typeof value === 'string' && /\d{4}-\d{2}-\d{2}/.test(value)) {
        return value;
    }
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
        return typeof value === 'string' ? value : '';
    }
    // 秒级时间戳（空间接口惯用）与毫秒级都要兼容
    const date = new Date(num < 1e11 ? num * 1000 : num);
    const pad = (item: number) => String(item).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
        + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 取时间的「yyyy年MM月」，用于按月分组 */
export function monthOf(value?: number | string | null): string {
    const text = formatTime(value);
    if (!text) {
        return '未知时间';
    }
    return text.slice(0, 4) + '年' + text.slice(5, 7) + '月';
}

/** 只取时分（列表里已知日期时只需显示时点） */
export function formatClock(value?: number | string | null): string {
    return formatTime(value).slice(11, 16);
}

/** 只取日期（yyyy-MM-dd） */
export function formatDay(value?: number | string | null): string {
    return formatTime(value).slice(0, 10);
}

/**
 * 归一化为毫秒时间戳（用于算两条记录的时间间隔）
 * 备份里除了秒/毫秒级数字，还有采集时写好的 'yyyy-MM-dd HH:mm:ss' 字符串，后者不能直接
 * 交给 Date.parse——该格式并非标准，部分浏览器会解析成 NaN，故统一拆分后自行构造。
 */
export function timeValue(value?: number | string | null): number {
    const matched = formatTime(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!matched) {
        return 0;
    }
    const [, year, month, day, hour, minute, second] = matched;
    return new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour || 0),
        Number(minute || 0),
        Number(second || 0),
    ).getTime();
}

/** 时间倒序（新的在前） */
export function timeDesc(a?: number | string | null, b?: number | string | null): number {
    return formatTime(b).localeCompare(formatTime(a));
}
