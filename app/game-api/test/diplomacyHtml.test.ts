import { describe, expect, it } from 'vitest';

import { purifyDiplomacyHtml } from '../src/security/diplomacyHtml.js';

describe('diplomacy HTML purification', () => {
    it('removes executable markup, unsafe URLs, SVG, MathML, styles, and event handlers', () => {
        const dirty = [
            '<script>globalThis.__diplomacyXss=1</script>',
            '<img src="javascript:alert(1)" onerror="globalThis.__diplomacyXss=2">',
            '<img src="mailto:attacker@example.com">',
            '<a href="jav&#x09;ascript:alert(2)" onclick="alert(3)" style="color:red">위험 링크</a>',
            '<svg><a xlink:href="javascript:alert(4)">SVG</a></svg>',
            '<math><mtext><img src=x onerror="alert(5)"></mtext></math>',
            '<p class="unsafe" style="background:url(javascript:alert(6))">안전 본문</p>',
        ].join('');

        const clean = purifyDiplomacyHtml(dirty);

        expect(clean).toBe('<a>위험 링크</a><a>SVG</a><img src="x" /><p>안전 본문</p>');
        expect(clean).not.toMatch(/script|onerror|onclick|javascript:|style=|class=|<svg|<math/i);
    });

    it('preserves only the formatting emitted by the diplomacy editors', () => {
        const source = [
            '<h2>외교 제안</h2>',
            '<p><strong>굵게</strong> <em>기울임</em> <u>밑줄</u> <s>취소</s></p>',
            '<blockquote><p>인용</p></blockquote>',
            '<ul><li><p>항목</p></li></ul>',
            '<ol><li><p>번호</p></li></ol>',
            '<a href="https://example.com/path" target="_blank" rel="anything">링크</a>',
            '<img src="/che/api/uploads/diplomacy.png" alt="문서" width="320" height="200">',
        ].join('');

        expect(purifyDiplomacyHtml(source)).toBe(
            [
                '<h2>외교 제안</h2>',
                '<p><strong>굵게</strong> <em>기울임</em> <u>밑줄</u> <s>취소</s></p>',
                '<blockquote><p>인용</p></blockquote>',
                '<ul><li><p>항목</p></li></ul>',
                '<ol><li><p>번호</p></li></ol>',
                '<a href="https://example.com/path" target="_blank" rel="noopener noreferrer nofollow">링크</a>',
                '<img src="/che/api/uploads/diplomacy.png" alt="문서" width="320" height="200" />',
            ].join('')
        );
    });

    it('is idempotent and removes protocol-relative external resources', () => {
        const first = purifyDiplomacyHtml(
            '<p>본문</p><a href="//attacker.example/a">링크</a><img src="//attacker.example/a.png">'
        );
        expect(first).toBe('<p>본문</p><a>링크</a>');
        expect(purifyDiplomacyHtml(first)).toBe(first);
    });
});
