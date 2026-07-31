import { describe, expect, it } from 'vitest';

import { formatLegacyLogHtml } from '../src/logging/formatLegacyLogHtml.js';

describe('formatLegacyLogHtml', () => {
    it('converts legacy colors and preserves intentional emphasis and line breaks', () => {
        expect(formatLegacyLogHtml('<R><b>위험</b></><br><Y1>작게</><1>작게만</>')).toBe(
            '<span style="color: red;"><b>위험</b></span><br><span style="color: yellow;font-size: 0.9em;">작게</span><span style="font-size: 0.9em;">작게만</span>'
        );
        expect(formatLegacyLogHtml('<R>색상</>', { colorize: false })).toBe('색상');
    });

    it('escapes executable and unknown markup instead of passing it to v-html', () => {
        const dirty = [
            '<script>globalThis.__logXss=1</script>',
            '<img src=x onerror="globalThis.__logXss=2">',
            '<svg><a href="javascript:alert(1)">SVG</a></svg>',
            '<span class="name" onclick="alert(2)">이름</span>',
            '<a href="javascript:alert(3)">링크</a>',
        ].join('');
        const clean = formatLegacyLogHtml(dirty);

        expect(clean).toContain('&lt;script&gt;globalThis.__logXss=1&lt;/script&gt;');
        expect(clean).toContain('&lt;img src=x onerror="globalThis.__logXss=2"&gt;');
        expect(clean).toContain('&lt;span class="name" onclick="alert(2)"&gt;이름</span>');
        expect(clean).not.toMatch(/<script|<img|<svg|<a /i);
    });

    it('rebuilds only the classed markup emitted by battle and tournament logs', () => {
        const source =
            '<div class="small_war_log"><span class="me"><span class="name">장수</span></span>' +
            '<span class="war_type war_type_attack">→</span><span class="ev_highlight">강조</span>' +
            "<span class='ev_failed'>실패</span><span class='ev_notice'>주의</span></div>";
        expect(formatLegacyLogHtml(source)).toBe(
            '<div class="small_war_log"><span class="me"><span class="name">장수</span></span>' +
                '<span class="war_type war_type_attack">→</span><span class="ev_highlight">강조</span>' +
                '<span class="ev_failed">실패</span><span class="ev_notice">주의</span></div>'
        );
        expect(formatLegacyLogHtml('<span class="unknown">미허용</span>')).toBe(
            '&lt;span class="unknown"&gt;미허용</span>'
        );
    });

    it('keeps the fixed hex color form emitted by flag-change logs but rejects other inline CSS', () => {
        expect(formatLegacyLogHtml("<span style='color:#FF6347;'><b>국기</b></span>")).toBe(
            '<span style="color: #FF6347;"><b>국기</b></span>'
        );
        expect(formatLegacyLogHtml("<span style='color:red;background:url(javascript:x)'>오염</span>")).toBe(
            "&lt;span style='color:red;background:url(javascript:x)'&gt;오염</span>"
        );
    });

    it('escapes dynamic text and incomplete tags', () => {
        expect(formatLegacyLogHtml('A&B <img src=x')).toBe('A&amp;B &lt;img src=x');
        expect(formatLegacyLogHtml('&#60;script&#62;')).toBe('&amp;#60;script&amp;#62;');
    });
});
