/**
 * dnr-auto 纯函数单测：Disk 失败自动识别「疑似 Referer 缺失」并生成 DNR 规则。
 */
import { describe, it, expect } from 'vitest';
import { extractHost, looksLikeRefererMissing, buildRefererRule, buildHttpsUpgradeRule, HTTPS_UPGRADE_RULE_ID } from '../core/downloader/dnr-auto';

describe('dnr-auto 纯函数', () => {
    it('extractHost 仅接受 http/https，拒绝非 http(s) 协议', () => {
        // 任意域名（含非 QQ 系）都可被提取——不再做域名白名单限制
        expect(extractHost('https://shp.qpic.cn/abc.jpg')).toBe('shp.qpic.cn');
        expect(extractHost('http://qpic.cn/x')).toBe('qpic.cn');
        expect(extractHost('https://cdn.example.org/path/img.png')).toBe('cdn.example.org');
        expect(extractHost('https://third-party-image-host.com/a.jpg')).toBe('third-party-image-host.com');
        // 非 http(s) 协议一律返回 null，避免给无意义/危险 URL 注册 Referer 规则
        expect(extractHost('data:image/png;base64,AAAA')).toBeNull();
        expect(extractHost('blob:https://qzone.qq.com/uuid')).toBeNull();
        expect(extractHost('javascript:void(0)')).toBeNull();
        expect(extractHost('')).toBeNull();
    });

    it('looksLikeRefererMissing 识别 403/401/CORS/fetch/network', () => {
        expect(looksLikeRefererMissing('HTTP 403 Forbidden')).toBe(true);
        expect(looksLikeRefererMissing('HTTP 401 Unauthorized')).toBe(true);
        expect(looksLikeRefererMissing('Failed to fetch')).toBe(true);
        expect(looksLikeRefererMissing('CORS error')).toBe(true);
        expect(looksLikeRefererMissing('NetworkError when attempting to fetch')).toBe(true);
        expect(looksLikeRefererMissing('HTTP 404 Not Found')).toBe(false);
        expect(looksLikeRefererMissing('some other error')).toBe(false);
        expect(looksLikeRefererMissing('')).toBe(false);
    });

    it('buildRefererRule 结构正确', () => {
        const r = buildRefererRule('shp.qpic.cn', 5001) as any;
        expect(r.id).toBe(5001);
        expect(r.action.type).toBe('modifyHeaders');
        expect(r.action.requestHeaders[0].header).toBe('Referer');
        expect(r.action.requestHeaders[0].value).toBe('https://user.qzone.qq.com/');
        expect(r.condition.urlFilter).toBe('||shp.qpic.cn^');
        expect(r.condition.resourceTypes).toContain('xmlhttprequest');
    });

    it('buildHttpsUpgradeRule 把站外 http xhrequest 升级为 https（解决老 CDN 302 到 http 被拦）', () => {
        const r = buildHttpsUpgradeRule() as any;
        expect(r.id).toBe(HTTPS_UPGRADE_RULE_ID);
        expect(r.id).toBe(2000);
        expect(r.action.type).toBe('redirect');
        // 正则把 http://host/path 重写为 https://host/path
        expect(r.action.redirect.regexSubstitution).toBe('https://\\1');
        expect(r.condition.regexFilter).toBe('^http://(.*)$');
        // 仅作用于 qzone 页发起的站外 xmlhttprequest（媒体下载通道），不影响站内
        expect(r.condition.initiatorDomains).toContain('qzone.qq.com');
        expect(r.condition.excludedRequestDomains).toContain('qzone.qq.com');
        expect(r.condition.resourceTypes).toContain('xmlhttprequest');
        // 重定向产生的新请求仍带原 initiator，故 302 的 http Location 也会被本规则升 https
        expect(r.priority).toBe(1);
    });
});
