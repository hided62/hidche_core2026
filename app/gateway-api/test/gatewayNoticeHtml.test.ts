import { describe, expect, it } from 'vitest';

import { purifyGatewayNoticeHtml } from '../src/security/gatewayNoticeHtml.js';

describe('purifyGatewayNoticeHtml', () => {
    it('keeps the small inline formatting set used by Ref gateway notices', () => {
        const source =
            '<b>점검</b><br><span style="color:#ff6600;font-size:1.2em;font-weight:bold">20시</span> ' +
            '<font color="yellow" size="2" face="sans-serif">안내</font> ' +
            '<a href="https://example.test/notice" target="_blank">상세</a>';
        const clean = purifyGatewayNoticeHtml(source);

        expect(clean).toContain('<b>점검</b><br />');
        expect(clean).toContain('style="color:#ff6600;font-size:1.2em;font-weight:bold"');
        expect(clean).toContain('<font color="yellow" size="2" face="sans-serif">안내</font>');
        expect(clean).toContain('rel="noopener noreferrer nofollow"');
        expect(purifyGatewayNoticeHtml(clean)).toBe(clean);
    });

    it('removes executable tags, handlers, unsafe URLs and CSS while keeping their plain text', () => {
        const source =
            '<script>globalThis.__noticeXss=1</script>' +
            '<img src=x onerror="globalThis.__noticeXss=2">' +
            '<svg onload="globalThis.__noticeXss=3"><text>SVG</text></svg>' +
            '<span onclick="globalThis.__noticeXss=4" style="color:red;background:url(javascript:x)">문구</span>' +
            '<font color="expression" style="color:blue;background:url(javascript:y)">폰트</font>' +
            '<a href="javascript:globalThis.__noticeXss=5">링크</a>';
        const clean = purifyGatewayNoticeHtml(source);

        expect(clean).not.toMatch(/script|<img|<svg|onerror|onload|onclick|javascript:|background/i);
        expect(clean).toContain('<span style="color:red">문구</span>');
        expect(clean).toContain('<font style="color:blue">폰트</font>');
        expect(clean).toContain('<a>링크</a>');
    });

    it('normalizes empty values', () => {
        expect(purifyGatewayNoticeHtml(undefined)).toBe('');
        expect(purifyGatewayNoticeHtml(null)).toBe('');
        expect(purifyGatewayNoticeHtml('')).toBe('');
    });
});
