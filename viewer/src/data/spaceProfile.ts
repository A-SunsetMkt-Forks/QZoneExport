/**
 * QQ 空间个人档「空间资料」字段映射
 *
 * 与 `core/export/markdown/index.ts` 的 buildSpaceProfileLines 同源：
 * 枚举取值（sex/constellation/bloodtype/marriage）与占位值黑名单均依据
 * 真实导出的 user.js + QQ 个人档编码文档核实，确保 HTML 查看器与 Markdown 导出
 * 输出口径一致。
 *
 * 输入为 Common/json/user.js 中的原始档案对象（window.userInfo），
 * 输出为可直接渲染的「标签:值」行；无实际意义的字段（未填写占位、默认占位值）一律跳过。
 */

export interface ProfileRow {
    /** 字段中文标签，如「性别」「星座」 */
    label: string;
    /** 已映射/清洗后的展示值 */
    value: string;
}

/** 去除 QQ 空间签名的 BBcode 标签（[url=][ft=][I] 等），仅保留纯文本 */
export function stripBBCode(s: string): string {
    return s
        .replace(/\[[/]?[a-zA-Z][^\]]*\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** sex：1=男 2=女 */
export function mapSex(v: unknown): string | undefined {
    if (v === 1) return '男';
    if (v === 2) return '女';
    return undefined;
}

/** constellation：1=水瓶座 … 12=摩羯座（0=未填跳过） */
export function mapConstellation(v: unknown): string | undefined {
    const map = ['', '水瓶座', '双鱼座', '白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座', '天秤座', '天蝎座', '射手座', '摩羯座'];
    const n = Number(v);
    return n >= 1 && n <= 12 ? map[n] : undefined;
}

/** bloodtype：1=A 型 2=B 型 3=O 型 4=AB 型 5=其他（QQ 编码 1~5，0=未填跳过） */
export function mapBloodType(v: unknown): string | undefined {
    const map = ['', 'A 型', 'B 型', 'O 型', 'AB 型', '其他'];
    const n = Number(v);
    return n >= 1 && n <= 5 ? map[n] : undefined;
}

/**
 * marriage：1=单身 2=已婚 3=恋爱中（QQ 个人档「感情状况」通用数字编码）。
 * 仅 1~3 有广泛佐证，其余取值（离异/分居等）跳过，避免臆测。
 */
export function mapMarriage(v: unknown): string | undefined {
    const map = ['', '单身', '已婚', '恋爱中'];
    const n = Number(v);
    return n >= 1 && n <= 3 ? map[n] : undefined;
}

/** 拼接「国家 省 市」，自动跳过空字段 */
export function joinLocation(c: unknown, p: unknown, ci: unknown): string {
    return [c, p, ci]
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter(Boolean)
        .join(' ');
}

/** QQ 个人档里表示「未填写」的占位文案，渲染时应跳过（注意：QQ 未填公司时显示的原文是「还没有」，按用户要求原样保留，不在跳过名单） */
const PROFILE_PLACEHOLDERS = new Set(['无', '暂无', '保密', '未填写', '不公开', '（未填写）', '（空）']);
/** 判断字段是否为「未填写」占位（空串或已知占位文案） */
export function isProfilePlaceholder(v: unknown): boolean {
    if (typeof v !== 'string') return v === undefined || v === null;
    const s = v.trim();
    return s === '' || PROFILE_PLACEHOLDERS.has(s);
}

/**
 * 由原始 user.js 档案生成「空间资料」的渲染行。
 * 仅输出有实际意义的字段；无效值（如 age=124/birthyear=1901 这类默认占位）一律跳过。
 * 昵称/QQ/空间名由左侧栏与开篇说明呈现，此处只补充其余档案字段，避免重复。
 * @param profile 原始 user.js 对象（可为空）
 * @returns 渲染行；无可用字段时返回空数组
 */
export function buildSpaceProfileRows(profile?: Record<string, unknown> | null): ProfileRow[] {
    if (!profile) return [];
    const get = (k: string): unknown => profile[k];
    const rows: ProfileRow[] = [];

    const sex = mapSex(get('sex'));
    if (sex) rows.push({ label: '性别', value: sex });

    const birthday = typeof get('birthday') === 'string' ? (get('birthday') as string).trim() : '';
    if (birthday && birthday !== '0-0') rows.push({ label: '生日', value: birthday });

    const constellation = mapConstellation(get('constellation'));
    if (constellation) rows.push({ label: '星座', value: constellation });

    const blood = mapBloodType(get('bloodtype'));
    if (blood) rows.push({ label: '血型', value: blood });

    const marriage = mapMarriage(get('marriage'));
    if (marriage) rows.push({ label: '婚姻', value: marriage });

    const loc = joinLocation(get('country'), get('province'), get('city'));
    if (loc) rows.push({ label: '所在地', value: loc });

    const home = joinLocation(get('hco'), get('hp'), get('hc'));
    if (home && home !== loc) rows.push({ label: '家乡', value: home });

    const company = typeof get('company') === 'string' ? (get('company') as string).trim() : '';
    if (company && !isProfilePlaceholder(company)) {
        const cloc = joinLocation(get('cco'), get('cp'), get('cc'));
        rows.push({ label: '公司', value: cloc ? `${company}（${cloc}）` : company });
    }

    const rawSig = typeof get('signature') === 'string' ? (get('signature') as string) : '';
    const sig = stripBBCode(rawSig);
    if (sig) rows.push({ label: '个性签名', value: sig });

    return rows;
}
