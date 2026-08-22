/**
 * 主体对齐进度配置与计算（选项 A：按主体个数评估采集进度）
 *
 * 背景：旧进度 = 遍历 `st.phases` 把各 phase 的 total 相加作分母、done 相加作分子。
 * 这导致两类倒退：
 *   1) 分母被 photos/媒体等海量 phase 稀释——「10 相册完成 9 个」只显示 ≈87% 而非 90%；
 *   2) phase.total 中途由未知(-1)突变到位造成百分比塌缩 / 假 100%。
 *
 * 修复：进度按「主体个数」评估。
 *   - 每个模块定义 `countPhases`：仅收录「主体对齐」的阶段（total 即主体数、done 随主体
 *     顺序单调增长）。排除 export/download，以及 Photos 的 photos/photo-*（累计相片数，
 *     非相册数，会稀释分母）。
 *   - 已完成主体数 = 已启动的 countPhase 的 done 的最小值（cap 到主体总数）。
 *     取「最小值」而非「枚举 done」：仅当所有已启动明细 phase（评论/赞/访问量…）都收完才到
 *     100%，评论还在跑就不显 100%。
 *     取「已启动」而非「全部」：明细按序启动，未启动的 phase 不参与，进度条跟随枚举推进，
 *     不会在明细尚未开始时卡在 0%。
 *
 * 采集层改造版：collector 对主体对齐阶段显式 report({ subject:{done,total} })，此处直接读
 *   st.subject 取 min-over-started；仅当 resume 旧 checkpoint（ModState 无 subject 字段）时才
 *   回退到下面的 st.phases 推断。
 */
import type { ModState } from './context';

/** 模块主体对齐进度 */
export interface SubjectProgress {
    /** 已完成主体数（枚举 + 其绑定明细均收完） */
    done: number;
    /** 主体总数（枚举总数）；-1 表示未知（接口未返回 total） */
    total: number;
    /** 主体完成度百分比 0-100（total 已知时）；indeterminate 时恒为 0 */
    pct: number;
    /** 主体总数未知：进度无法确定，UI 应显示「采集中」而非假百分比 */
    indeterminate: boolean;
}

/**
 * 各模块的主体对齐阶段清单（值为 phase 名）。
 * 逐页内联后，明细阶段不再上报 subject，仅列表枚举阶段为进度源。
 * Photos 例外：albums 即相册列表，album-* 明细 phase 不再上报 subject。
 * Friends 例外：friendship/zone-access 为顺序累进，无列表翻页。
 */
export const SUBJECT_CONFIG: Record<string, string[]> = {
    Messages: ['list'],
    // Blogs/Diaries：主体进度 = min(list 枚举, contents 正文获取)。
    // 「获取正文」是 list 之后的独立重活（尤其断点续传：list 已 100% 但正文重跑），
    // 若只数 list，列表达 100% 就会假显示 100% 而正文还在拉（见 module-bars 回归用例）。
    Blogs: ['list', 'contents'],
    Diaries: ['list', 'contents'],
    Boards: ['list'],
    Photos: ['albums'],
    Videos: ['list'],
    Favorites: ['list'],
    Shares: ['list'],
    Visitors: ['list'],
    // Friends：互动(互动信息)与权限(空间访问权限)顺序执行，collector 合并上报同一 body 阶段
    // （总=2×新好友数、done 单调递增），单阶段不走 min-over-started，阶段切换时进度不倒退。
    Friends: ['friendship'],
};

/**
 * 计算模块主体对齐进度。
 * - 模块不在 SUBJECT_CONFIG，或尚无任何 countPhase 启动 → 返回 null（调用方回退旧 sum 公式）。
 * - 主体总数未知(-1) → indeterminate=true、pct=0（UI 显示「采集中」，绝不假 100%）。
 */
export function computeSubjectProgress(mod: string, st: ModState): SubjectProgress | null {
    const countPhases = SUBJECT_CONFIG[mod];
    if (!countPhases) return null;

    // 优先读采集层显式上报的 subject（字面采集层改造：collector 对主体阶段 report({subject})）
    const subjectMap = st.subject;
    if (subjectMap) {
        const started = countPhases.filter((p) => subjectMap[p]);
        if (started.length > 0) {
            let total = -1;
            for (const p of started) {
                const s = subjectMap[p];
                if (!s) continue;
                const t = s.total || 0;
                if (t > 0) total = Math.max(total, t);
            }
            let minDone = Infinity;
            for (const p of started) {
                const s = subjectMap[p];
                if (!s) continue;
                minDone = Math.min(minDone, s.done || 0);
            }
            if (minDone === Infinity) minDone = 0;
            if (total <= 0) {
                if (total === 0) return { done: 0, total: 0, pct: 100, indeterminate: false };
                // 主体总数未知：显示「采集中」，绝不假 100%
                return { done: minDone, total: -1, pct: 0, indeterminate: true };
            }
            const done = Math.min(minDone, total);
            return { done, total, pct: Math.round((done / total) * 100), indeterminate: false };
        }
    }

    // 兼容回退：resume 旧 checkpoint 无 subject 数据，用 st.phases 推断
    if (!st.phases) return null;
    const started = countPhases.filter((p) => st.phases![p]);
    if (started.length === 0) return null;

    let total = -1;
    for (const p of started) {
        const ph = st.phases[p];
        if (!ph) continue;
        const t = ph.total || 0;
        if (t > 0) total = Math.max(total, t);
    }
    let minDone = Infinity;
    for (const p of started) {
        const ph = st.phases[p];
        if (!ph) continue;
        minDone = Math.min(minDone, ph.done || 0);
    }
    if (minDone === Infinity) minDone = 0;

    if (total <= 0) {
        if (total === 0) return { done: 0, total: 0, pct: 100, indeterminate: false };
        // 主体总数未知：无法给出百分比，标记 indeterminate（不假 100%）
        return { done: minDone, total: -1, pct: 0, indeterminate: true };
    }
    const done = Math.min(minDone, total);
    return { done, total, pct: Math.round((done / total) * 100), indeterminate: false };
}
