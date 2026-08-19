/**
 * JSON/JSONP 解析工具
 * 移值自 api.js，从 core/shared/utils.ts 拆分。
 */

import JSON5 from 'json5';

/** JSONP 剥壳并解析 JSON */
export function toJson<T = any>(json: string, jsonpKey?: RegExp): T {
    json = json.trim();

    if (jsonpKey && json.match(jsonpKey)) {
        json = json.replace(jsonpKey, '');
        if (json.endsWith(';')) json = json.substring(0, json.length - 1).trim();
        if (json.endsWith(')')) json = json.substring(0, json.length - 1).trim();
    } else {
        const callbackMatch = /^[^({]{0,50}?callback\s*\(/i.exec(json);
        if (callbackMatch) {
            json = json.substring(callbackMatch.index + callbackMatch[0].length);
            if (json.endsWith(';')) json = json.substring(0, json.length - 1).trim();
            if (json.endsWith(')')) json = json.substring(0, json.length - 1).trim();
        }
    }

    try {
        return JSON.parse(json);
    } catch {
        try {
            return JSON.parse(json.replace(/\\(?!["\\/bfnrtu])/g, '\\\\'));
        } catch (retryError) {
            try {
                return JSON5.parse<T>(json);
            } catch {
                throw retryError;
            }
        }
    }
}
