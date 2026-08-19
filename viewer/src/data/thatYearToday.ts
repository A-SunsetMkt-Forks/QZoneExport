/**
 * 那年今日
 *
 * 与旧版行为一致：不是备份时算好的，而是打开页面时按「当前日期」实时算
 * （旧实现见 src/export/js/common.js 的 getOldYearData），因此同一份备份在不同日期
 * 打开会看到不同的回忆。规则：取月日与今天相同、且不是今年的记录，按年份倒序分组。
 */
import { formatTime } from './format';

export interface YearGroup<T = any> {
    year: string;
    items: T[];
}

/**
 * @param items 模块数据
 * @param timeOf 取记录时间的字段
 */
export function thatYearToday<T>(items: T[], timeOf: (item: T) => any): YearGroup<T>[] {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const today = pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    const thisYear = String(now.getFullYear());

    const groups = new Map<string, T[]>();
    for (const item of items) {
        const text = formatTime(timeOf(item));
        if (!text || text.slice(5, 10) !== today) {
            continue;
        }
        const year = text.slice(0, 4);
        if (year === thisYear) {
            // 今年的不算「那年」
            continue;
        }
        const list = groups.get(year) || [];
        list.push(item);
        groups.set(year, list);
    }
    return [...groups.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([year, list]) => ({ year, items: list }));
}
