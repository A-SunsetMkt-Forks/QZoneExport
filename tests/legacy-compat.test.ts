import { describe, expect, it } from 'vitest';
import JSON5 from 'json5';

/**
 * 旧代码 MV3 兼容性回归测试
 * 覆盖去 eval 改造：JSONP 剥离 + 宽松 JSON 解析、URL 确定性哈希文件名
 */

/** 与 api.js toJson 中一致的 JSONP 函数名匹配规则 */
const CALLBACK_PATTERN = /^[^({]{0,50}?callback\s*\(/i;

/** 复现 api.js toJson 的 JSONP 剥离逻辑 */
const stripJsonp = (raw: string): string => {
    let json = raw.trim();
    const match = CALLBACK_PATTERN.exec(json);
    if (!match) {
        return json;
    }
    json = json.substring(match.index + match[0].length);
    if (json.endsWith(';')) {
        json = json.substring(0, json.length - 1).trim();
    }
    if (json.endsWith(')')) {
        json = json.substring(0, json.length - 1).trim();
    }
    return json;
};

describe('JSONP 函数名剥离', () => {
    it('剥离小写 callback( —— 原实现只认大写 Callback( 导致解析失败', () => {
        expect(stripJsonp('callback({"code":0});')).toBe('{"code":0}');
    });

    it('剥离大写与带前缀的 _Callback(', () => {
        expect(stripJsonp('_Callback({"code":0});')).toBe('{"code":0}');
        expect(stripJsonp('shine0_Callback({"code":0});')).toBe('{"code":0}');
    });

    it('不误伤内容中出现的 callback( 字符串', () => {
        const raw = '{"tip":"callback(x)"}';
        expect(stripJsonp(raw)).toBe(raw);
    });
});

describe('宽松 JSON 解析（替代 MV2 的 eval 兜底）', () => {
    it('解析分享页返回的 JS 对象字面量：无引号 key + 单引号字符串', () => {
        // 取自实测日志：JSON.parse 在此报 Expected property name or '}'
        const raw = `{
				id: 1647771312,
				type: 3,
				poster: {
					modelName: 'User',
					uin: '1334122472',
					nickname: '测试昵称'
				},
				ugcPlatform : '100',
				memo: '相片分享'
			}`;
        expect(() => JSON.parse(raw)).toThrow();

        const parsed = JSON5.parse<{ id: number; poster: { uin: string; nickname: string }; memo: string }>(raw);
        expect(parsed.id).toBe(1647771312);
        expect(parsed.poster.uin).toBe('1334122472');
        expect(parsed.poster.nickname).toBe('测试昵称');
        expect(parsed.memo).toBe('相片分享');
    });

    it('容忍尾随逗号', () => {
        expect(JSON5.parse<{ a: number }>('{a: 1,}').a).toBe(1);
    });

    it('严格 JSON 仍按原样解析', () => {
        expect(JSON5.parse<{ code: number }>('{"code":0}').code).toBe(0);
    });

    it('JSON5 不能取代 JSONP 剥离：函数调用不是数据字面量', () => {
        // JSON5 是 JSON 超集解析器，只认数据字面量；
        // _Callback({...}) 是函数调用表达式，必须先剥离外层包装
        expect(() => JSON5.parse('_Callback({"code":0});')).toThrow();
        expect(() => JSON5.parse('callback({"code":0})')).toThrow();
        // 剥离后才能解析，两者是串联关系而非替代关系
        expect(JSON5.parse<{ code: number }>(stripJsonp('_Callback({"code":0});')).code).toBe(0);
    });

    it('JSON5 不求值表达式，与旧版 eval 存在能力差距', () => {
        // 旧版 eval("({a: 1+1})") 可得 {a:2}，JSON5 仅支持字面量
        expect(() => JSON5.parse('{a: 1+1}')).toThrow();
    });
});

/** 与 api.js hashString 一致的 cyrb53 实现（用于直写盘模式基于URL生成稳定文件名） */
const hashString = (input: string): string => {
    const str = String(input || '');
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    return hash.toString(36);
};

describe('URL 确定性哈希文件名（直写盘去重基础）', () => {
    const url = 'http://photoga.photo.store.qq.com/psc?/V10x/abc/def~bo=xxx';

    it('同一URL必得同一哈希（跨备份可识别同一文件）', () => {
        expect(hashString(url)).toBe(hashString(url));
    });

    it('不同URL得不同哈希（避免误判为同一文件）', () => {
        expect(hashString(url)).not.toBe(hashString(url + '2'));
        expect(hashString('a')).not.toBe(hashString('b'));
    });

    it('输出为文件名安全的字符（仅字母数字）', () => {
        expect(hashString(url)).toMatch(/^[0-9a-z]+$/);
    });
});
