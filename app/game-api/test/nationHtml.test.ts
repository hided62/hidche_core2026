import { describe, expect, it } from 'vitest';

import { purifyNationHtml } from '../src/security/nationHtml.js';

describe('nation HTML purification', () => {
    it('removes executable markup and unsafe URL/CSS vectors', () => {
        const dirty = [
            '<script>globalThis.__nationXss = true</script>',
            '<img src="javascript:alert(1)" onerror="globalThis.__nationXss = true">',
            '<img src="jav&#x09;ascript:alert(1)" srcset="data:image/svg+xml,attack 2x">',
            '<a href="javascript:alert(2)" onclick="alert(3)">unsafe link</a>',
            '<p style="background-image:url(javascript:alert(4));color:#fff" onmouseover="alert(5)">notice</p>',
            '<iframe src="https://attacker.example/embed/1" onload="alert(6)"></iframe>',
            '<iframe src="//www.youtube.com.evil.example/embed/1" srcdoc="<script>alert(7)</script>"></iframe>',
            '<svg><a xlink:href="javascript:alert(8)">svg</a></svg>',
        ].join('');

        const clean = purifyNationHtml(dirty);

        expect(clean).not.toMatch(/script|onerror|onclick|onmouseover|onload|javascript:|background-image|attacker/i);
        expect(clean).not.toContain('<img');
        expect(clean).toContain('<a>unsafe link</a>');
        expect(clean).toContain('<p style="color:#fff">notice</p>');
        expect(clean).toContain('<iframe></iframe>');
    });

    it('does not throw on malformed escaped filenames and preserves the raw basename as alt text', () => {
        expect(purifyNationHtml('<img src="/image/%E0%A4%A">')).toBe('<img src="/image/%E0%A4%A" alt="%E0%A4%A" />');
        expect(purifyNationHtml('<img src="/image/a%20b.png"><img src="/image/a.png?x/y"><img src="x" alt="">')).toBe(
            '<img src="/image/a%20b.png" alt="a%20b.png" /><img src="/image/a.png?x/y" alt="y" /><img src="x" alt="" />'
        );
    });

    it('matches Ref iframe whitespace and case handling', () => {
        expect(
            purifyNationHtml(
                [
                    '<iframe src=" https://www.youtube.com/embed/x "></iframe>',
                    '<iframe src="https://WWW.YouTube.COM/embed/x"></iframe>',
                    '<iframe src="https://www.youtube.com/Embed/x"></iframe>',
                ].join('')
            )
        ).toBe('<iframe src="https://www.youtube.com/embed/x"></iframe><iframe></iframe><iframe></iframe>');
    });

    it('preserves Ref-compatible formatting, data-flip, images, and safe video embeds', () => {
        const source = [
            '<div class="notice" data-flip="horizontal" style="text-align:center;color:#00ffff">',
            '<strong>북벌</strong><br>',
            '<a href="https://example.com/path" target="_blank">계획</a>',
            '<img src="/image/icons/default.jpg" srcset="javascript:alert(1) 2x, /image/icons/default.jpg 1x" alt="장수" width="64" height="64">',
            '<iframe src="//www.youtube-nocookie.com/embed/abc123" width="560" height="315" allowfullscreen></iframe>',
            '<iframe src="https://player.vimeo.com/video/1234" title="video"></iframe>',
            '</div>',
        ].join('');

        const clean = purifyNationHtml(source);

        expect(clean).toContain('class="notice"');
        expect(clean).toContain('data-flip="horizontal"');
        expect(clean).toContain('style="text-align:center;color:#00ffff"');
        expect(clean).toContain('<strong>북벌</strong><br />');
        expect(clean).toContain('href="https://example.com/path"');
        expect(clean).not.toContain('target="_blank"');
        expect(clean).toContain('src="/image/icons/default.jpg"');
        expect(clean).toContain('alt="장수"');
        expect(clean).toContain('srcset="/image/icons/default.jpg 1x"');
        expect(clean).toContain('//www.youtube-nocookie.com/embed/abc123');
        expect(clean).toContain('https://player.vimeo.com/video/1234');
    });

    it('preserves the Tiptap font, color, background, alignment, rule, and uploaded image contract', () => {
        const source = [
            '<p style="text-align:center">',
            '<span style="font-family:Pretendard, sans-serif;font-size:22px;color:#123456;background-color:#fedcba">방침</span>',
            '</p><hr><img class="custom-image-align-right" src="https://sam-image.hided.net/uploads/core2026/0123456789abcdef0123456789abcdef.webp" alt="방침.png">',
        ].join('');

        const clean = purifyNationHtml(source);

        expect(clean).toContain('style="text-align:center"');
        expect(clean).toContain(
            'style="font-family:Pretendard, sans-serif;font-size:22px;color:#123456;background-color:#fedcba"'
        );
        expect(clean).toContain('<hr />');
        expect(clean).toContain('class="custom-image-align-right"');
        expect(clean).toContain(
            'src="https://sam-image.hided.net/uploads/core2026/0123456789abcdef0123456789abcdef.webp"'
        );
    });

    it('is idempotent for already-purified stored values', () => {
        const first = purifyNationHtml('<p style="color:red"><b>방침</b></p>');
        expect(purifyNationHtml(first)).toBe(first);
    });
});
