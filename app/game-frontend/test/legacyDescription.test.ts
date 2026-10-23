import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { splitLegacyLineBreaks } from '../src/utils/legacyDescription.ts';

void describe('legacy catalog description line breaks', () => {
    void it('accepts catalog br variants and platform newlines', () => {
        assert.deepEqual(splitLegacyLineBreaks('가<br>나<BR/>다<br />라\r\n마\n바\r사'), [
            '가',
            '나',
            '다',
            '라',
            '마',
            '바',
            '사',
        ]);
    });

    void it('preserves empty lines, whitespace, and unformatted descriptions', () => {
        assert.deepEqual(splitLegacyLineBreaks(''), ['']);
        assert.deepEqual(splitLegacyLineBreaks(' 일반 설명 '), [' 일반 설명 ']);
        assert.deepEqual(splitLegacyLineBreaks('<br>첫 줄<br><br>끝 줄\n'), ['', '첫 줄', '', '끝 줄', '']);
    });

    void it('leaves other markup, attributes, and entities as literal text', () => {
        const text = '<img src=x onerror="alert(1)"><b>문구</b>&lt;br&gt;<br onclick="alert(1)">';
        assert.deepEqual(splitLegacyLineBreaks(text), [text]);
    });
});
