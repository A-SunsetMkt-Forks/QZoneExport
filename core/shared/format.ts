/**
 * 格式化工具（文件名清洗、日期解析/格式化、数字补零）
 * 移值自 api.js，从 core/shared/utils.ts 拆分。
 */

/** 替换文件名特殊符号 */
export function filenameValidate(name: string): string {
    return name.replace(/'|#|~|&| |!|\\|\/|:|\?|"|<|>|\*|\|/g, '_');
}

/** 按长度给数字前面补 0 */
export function prefixNumber(num: number, length: number): string {
    return (Array(length).join('0') + num).slice(-length);
}

/** 格式化日期值（yyyy-MM-dd hh:mm:ss 语义） */
export function formatDateValue(date: Date, fmt: string): string {
    const o: Record<string, number> = {
        'M+': date.getMonth() + 1, 'd+': date.getDate(),
        'h+': date.getHours(), 'm+': date.getMinutes(), 's+': date.getSeconds(),
        'q+': Math.floor((date.getMonth() + 3) / 3), S: date.getMilliseconds(),
    };
    const yearMatch = /(y+)/.exec(fmt);
    if (yearMatch) {
        fmt = fmt.replace(yearMatch[1]!, String(date.getFullYear()).substring(4 - yearMatch[1]!.length));
    }
    for (const k in o) {
        const match = new RegExp('(' + k + ')').exec(fmt);
        if (match) {
            const val = '' + o[k];
            fmt = fmt.replace(match[1]!, match[1]!.length === 1 ? val : ('00' + val).substring(val.length));
        }
    }
    return fmt;
}

/** 格式化秒级时间戳 */
export function formatDate(time: number | string, fmt?: string): string {
    if (typeof time !== 'number' || !Number.isInteger(time)) return String(time);
    return formatDateValue(new Date(time * 1000), fmt || 'yyyy-MM-dd hh:mm:ss');
}

/** 解析中文相对时间文本（今天/昨天/前天/x年x月x日） */
export function toDate(time: string): Date {
    const now = new Date();
    if (time.indexOf('今天') > -1) time = time.replace('今天', formatDateValue(now, 'yyyy-MM-dd'));
    else if (time.indexOf('昨天') > -1) time = time.replace('昨天', formatDateValue(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1), 'yyyy-MM-dd'));
    else if (time.indexOf('前天') > -1) time = time.replace('前天', formatDateValue(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2), 'yyyy-MM-dd'));
    else if (time.indexOf('年') == -1) time = now.getFullYear() + '-' + time.replace('月', '-').replace('日', '');
    else time = time.replace('年', '-').replace('月', '-').replace('日', '');
    return new Date(time);
}

/** 解析时间（秒级时间戳或时间字符串），使用位数判断区分秒/毫秒 */
export function parseDate(time: number | string): Date {
    if (typeof time === 'number' && Number.isFinite(time)) {
        // 13 位以上为毫秒，10 位为秒（1972-2286 区间）；其余按毫秒处理
        if (time > 1e12) return new Date(time);
        return new Date(time * 1000);
    }
    return new Date(time);
}
