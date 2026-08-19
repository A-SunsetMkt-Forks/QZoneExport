/**
 * 代词语工具：按「被查看空间主人」的性别（user.sex，1=男 2=女）返回第三人称代词。
 * 性别未知（缺失/其它取值）时回退中性「TA」，避免出现错误的性别称呼。
 * 用于把界面文案里的「TA（空间主人）」自动替换成「他/她」。
 */
export function heShe(sex?: number | string): string {
    const n = Number(sex);
    if (n === 1) return '他';
    if (n === 2) return '她';
    return 'TA';
}