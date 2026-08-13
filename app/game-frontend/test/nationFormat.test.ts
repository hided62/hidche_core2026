import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatNationLevelText, formatOfficerLevelText } from '../src/utils/nationFormat.ts';

void describe('nationFormat Ref labels', () => {
    void it('uses the Ref nation-level and nation-dependent office names', () => {
        assert.equal(formatNationLevelText(0), '방랑군');
        assert.equal(formatNationLevelText(3), '주자사');
        assert.equal(formatNationLevelText(7), '황제');
        assert.equal(formatOfficerLevelText(9, 3), '간의대부');
        assert.equal(formatOfficerLevelText(5, 3), '-');
        assert.equal(formatOfficerLevelText(5), '제3모사');
    });

    void it('does not expose unknown numeric levels', () => {
        assert.equal(formatNationLevelText(99), '-');
        assert.equal(formatOfficerLevelText(99), '-');
    });
});
