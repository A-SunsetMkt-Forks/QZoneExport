import { describe, it, expect } from 'vitest';
import {
    buildSpaceProfileRows,
    mapSex,
    mapConstellation,
    mapBloodType,
    mapMarriage,
    stripBBCode,
    isProfilePlaceholder,
} from '../viewer/src/data/spaceProfile';

describe('buildSpaceProfileRows', () => {
    it('空档案返回空数组', () => {
        expect(buildSpaceProfileRows(null)).toEqual([]);
        expect(buildSpaceProfileRows(undefined)).toEqual([]);
        expect(buildSpaceProfileRows({})).toEqual([]);
    });

    it('按真实 user.js 字段渲染性别/星座/所在地/家乡/签名', () => {
        const rows = buildSpaceProfileRows({
            sex: 2,
            birthday: '06-20',
            constellation: 2,
            bloodtype: 0,
            marriage: 1,
            country: '中国',
            province: '广东',
            city: '茂名',
            hco: '中国',
            hp: '广东',
            hc: '湛江',
            company: '还没有',
            signature: '[url=http://qzone.qq.com][ft=#ff0000,,楷体_GB2312][I]传说对着流星可以许愿[/I][/ft][/url]',
        });
        const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
        expect(map['性别']).toBe('女');
        expect(map['生日']).toBe('06-20');
        expect(map['星座']).toBe('双鱼座');
        // bloodtype:0 未填 → 跳过
        expect(map['血型']).toBeUndefined();
        expect(map['婚姻']).toBe('单身');
        expect(map['所在地']).toBe('中国 广东 茂名');
        expect(map['家乡']).toBe('中国 广东 湛江');
        // company:"还没有" 原样显示（QQ 未填占位原文）
        expect(map['公司']).toBe('还没有');
        // 签名 BBcode 清洗为纯文本
        expect(map['个性签名']).toBe('传说对着流星可以许愿');
    });

    it('家乡与所在地相同则不重复显示', () => {
        const rows = buildSpaceProfileRows({
            country: '中国',
            province: '广东',
            city: '茂名',
            hco: '中国',
            hp: '广东',
            hc: '茂名',
        });
        const labels = rows.map((r) => r.label);
        expect(labels).toContain('所在地');
        expect(labels).not.toContain('家乡');
    });

    it('血型其他(5)与婚姻未知(>3)的边界', () => {
        const rows = buildSpaceProfileRows({ bloodtype: 5, marriage: 9 });
        const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
        expect(map['血型']).toBe('其他');
        // marriage:9 无权威编码 → 跳过
        expect(map['婚姻']).toBeUndefined();
    });

    it('生日 0-0 视为未填跳过', () => {
        const rows = buildSpaceProfileRows({ birthday: '0-0' });
        expect(rows.find((r) => r.label === '生日')).toBeUndefined();
    });
});

describe('映射与清洗函数', () => {
    it('mapSex', () => {
        expect(mapSex(1)).toBe('男');
        expect(mapSex(2)).toBe('女');
        expect(mapSex(0)).toBeUndefined();
        expect(mapSex(3)).toBeUndefined();
    });
    it('mapConstellation', () => {
        expect(mapConstellation(1)).toBe('水瓶座');
        expect(mapConstellation(5)).toBe('双子座');
        expect(mapConstellation(12)).toBe('摩羯座');
        expect(mapConstellation(0)).toBeUndefined();
    });
    it('mapBloodType', () => {
        expect(mapBloodType(1)).toBe('A 型');
        expect(mapBloodType(3)).toBe('O 型');
        expect(mapBloodType(5)).toBe('其他');
        expect(mapBloodType(0)).toBeUndefined();
    });
    it('mapMarriage', () => {
        expect(mapMarriage(1)).toBe('单身');
        expect(mapMarriage(2)).toBe('已婚');
        expect(mapMarriage(3)).toBe('恋爱中');
        expect(mapMarriage(4)).toBeUndefined();
    });
    it('stripBBCode 去除标签并清理空白', () => {
        expect(stripBBCode('[url=x][ft=#f][I]十指[/I][/ft][/url]')).toBe('十指');
        expect(stripBBCode('  [I]  你好  [/I]  ')).toBe('你好');
    });
    it('isProfilePlaceholder', () => {
        // 「还没有」是 QQ 未填占位原文，按用户要求不算占位
        expect(isProfilePlaceholder('还没有')).toBe(false);
        expect(isProfilePlaceholder('保密')).toBe(true);
        expect(isProfilePlaceholder('')).toBe(true);
        expect(isProfilePlaceholder(undefined)).toBe(true);
        expect(isProfilePlaceholder('腾讯')).toBe(false);
    });
});
