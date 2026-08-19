/**
 * 分级日志器（P7）
 *
 * 采集期间的诊断信息原先散落成 console.warn/error，既无法分级过滤，也无法随备份导出
 * 供用户回溯「某个相册为什么失败」。这里统一收口：
 * - 分级（debug/info/warn/error）+ 最低级别过滤
 * - 环形缓冲（超上限丢最旧，避免长时间备份把内存撑爆）
 * - 可镜像到 console（默认开，保留原来的实时可见性）
 * - 可导出为纯文本，写进备份目录供用户排查
 *
 * 域层通过 CollectorEnv.logger 使用；引擎逐模块运行时用 setModule 打标，
 * 使每条日志带上「当时在采哪个模块」。
 */

import { LIMITS } from './constants';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 级别权重，用于最低级别过滤 */
const LEVEL_WEIGHT: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

export interface LogEntry {
    /** 毫秒时间戳 */
    time: number;
    level: LogLevel;
    /** 当时正在采集的模块（引擎逐模块运行时设置，无则为空） */
    module?: string;
    message: string;
    /** 附加参数（如接口响应、异常对象、条目引用） */
    detail: unknown[];
}

export interface LoggerOptions {
    /** 低于此级别的日志忽略，默认 debug（全收） */
    minLevel?: LogLevel;
    /** 环形缓冲上限，默认 5000，超出丢弃最旧 */
    capacity?: number;
    /** 是否同时输出到 console，默认 true（测试可关） */
    mirror?: boolean;
    /** 时间源（测试可注入固定时钟） */
    now?: () => number;
    /**
     * 每条日志落盘后的钩子（不改缓冲行为）。
     * 用于把采集引擎日志桥接到其它日志汇聚点（如 DownloadManager 环形缓冲，
     * 供备份进度面板的「日志」Tab 展示，避免只有控制台能看到报错）。
     */
    onRecord?: (entry: LogEntry) => void;
}

/** console 各级别方法映射（mirror 用；debug 回落到 log） */
type ConsoleLike = Pick<Console, 'warn' | 'error'> & {
    log?: (...args: unknown[]) => void;
    info?: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
};

/** 安全序列化一个附加参数（不因循环引用/异常对象抛错） */
function stringifyDetail(value: unknown): string {
    if (value instanceof Error) {
        return value.stack || value.name + ': ' + value.message;
    }
    if (value === null || value === undefined) {
        return String(value);
    }
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

/** 两位补零 */
function pad2(n: number): string {
    return n < 10 ? '0' + n : String(n);
}

/** 格式化为 HH:MM:SS（导出文本用，日期意义不大，采集通常在同一天内） */
function formatClock(time: number): string {
    const d = new Date(time);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

export class Logger {
    /**
     * 环形缓冲：固定长度数组 + 写指针，避免原实现超容量时用 splice(0, n) 导致的 O(n) 搬运。
     * buffer 长度 = capacity，写满后新条目覆盖最旧条目（writePos 循环前进）。
     */
    private buffer: LogEntry[];
    private writePos = 0;
    private count = 0;
    private currentModule?: string;
    private readonly minWeight: number;
    private readonly capacity: number;
    private readonly mirror: boolean;
    private readonly now: () => number;
    private readonly onRecord?: (entry: LogEntry) => void;
    private readonly console?: ConsoleLike;

    constructor(options: LoggerOptions = {}, consoleImpl?: ConsoleLike) {
        this.minWeight = LEVEL_WEIGHT[options.minLevel || 'debug'];
        this.capacity = options.capacity && options.capacity > 0 ? options.capacity : LIMITS.LOG_BUFFER_SIZE;
        this.buffer = new Array<LogEntry>(this.capacity);
        this.mirror = options.mirror !== false;
        this.now = options.now || Date.now;
        this.onRecord = options.onRecord;
        // 允许注入 console（测试用）；默认取全局 console，无则不镜像
        this.console = consoleImpl || (typeof console !== 'undefined' ? console : undefined);
    }

    /** 设置后续日志归属的模块（引擎逐模块运行时调用） */
    setModule(module?: string): void {
        this.currentModule = module;
    }

    debug(message: string, ...detail: unknown[]): void {
        this.record('debug', message, detail);
    }

    info(message: string, ...detail: unknown[]): void {
        this.record('info', message, detail);
    }

    warn(message: string, ...detail: unknown[]): void {
        this.record('warn', message, detail);
    }

    error(message: string, ...detail: unknown[]): void {
        this.record('error', message, detail);
    }

    private record(level: LogLevel, message: string, detail: unknown[]): void {
        if (LEVEL_WEIGHT[level] < this.minWeight) {
            return;
        }
        const entry: LogEntry = { time: this.now(), level, module: this.currentModule, message, detail };
        // O(1) 环形写入：覆盖最旧位置
        this.buffer[this.writePos] = entry;
        this.writePos = (this.writePos + 1) % this.capacity;
        if (this.count < this.capacity) {
            this.count++;
        }
        if (this.mirror && this.console) {
            this.mirrorToConsole(entry);
        }
        // 桥接钩子：把日志转发到其它汇聚点（如 DM 缓冲），不放进缓冲逻辑里避免影响环形写入
        if (this.onRecord) {
            try {
                this.onRecord(entry);
            } catch {
                /* 桥接失败不影响主流程 */
            }
        }
    }

    private mirrorToConsole(entry: LogEntry): void {
        const prefix = entry.module ? '[' + entry.module + '] ' : '';
        const args = [prefix + entry.message, ...entry.detail];
        const c = this.console!;
        if (entry.level === 'error') {
            c.error(...args);
        } else if (entry.level === 'warn') {
            c.warn(...args);
        } else if (entry.level === 'info') {
            (c.info || c.log || c.warn)(...args);
        } else {
            (c.debug || c.log || c.warn)(...args);
        }
    }

    /** 按写入顺序返回当前缓冲中的日志（从最旧到最新），副本 */
    private orderedEntries(): LogEntry[] {
        if (this.count === 0) {
            return [];
        }
        const oldest = this.count < this.capacity ? 0 : this.writePos;
        const out: LogEntry[] = new Array(this.count);
        for (let i = 0; i < this.count; i++) {
            out[i] = this.buffer[(oldest + i) % this.capacity]!;
        }
        return out;
    }

    /** 当前缓冲中的日志（副本，按时间从旧到新） */
    getEntries(): LogEntry[] {
        return this.orderedEntries();
    }

    /** 按最低级别筛选（如只看 warn 及以上） */
    filter(minLevel: LogLevel): LogEntry[] {
        const weight = LEVEL_WEIGHT[minLevel];
        return this.orderedEntries().filter((e) => LEVEL_WEIGHT[e.level] >= weight);
    }

    /** 已记录条数 */
    get size(): number {
        return this.count;
    }

    /** 清空缓冲 */
    clear(): void {
        this.buffer = new Array<LogEntry>(this.capacity);
        this.writePos = 0;
        this.count = 0;
    }

    /** 导出为纯文本（每行一条），供写入备份目录 */
    export(): string {
        return this.orderedEntries().map((entry) => this.formatLine(entry)).join('\n');
    }

    /** 单条日志格式化：[时间] [级别] [模块] 消息 | 附加参数 */
    formatLine(entry: LogEntry): string {
        const parts = ['[' + formatClock(entry.time) + ']', '[' + entry.level.toUpperCase() + ']'];
        if (entry.module) {
            parts.push('[' + entry.module + ']');
        }
        parts.push(entry.message);
        let line = parts.join(' ');
        if (entry.detail.length > 0) {
            line += ' | ' + entry.detail.map(stringifyDetail).join(' ');
        }
        return line;
    }
}
