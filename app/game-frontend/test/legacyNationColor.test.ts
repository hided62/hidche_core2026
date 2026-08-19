import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    isLegacyNationColorBright,
    legacyLuminanceTextColor,
    legacyNationTextColor,
} from '../src/utils/legacyNationColor.ts';

void describe('legacy nation color contrast', () => {
    void it('matches Ref isBrightColor luminance and its strict threshold', () => {
        assert.equal(isLegacyNationColorBright('#FFFF00'), true);
        assert.equal(isLegacyNationColorBright('#008000'), false);
        assert.equal(isLegacyNationColorBright('#20B2AA'), false);
        assert.equal(isLegacyNationColorBright('#6495ED'), true);
        assert.equal(isLegacyNationColorBright('not-a-color'), false);
    });

    void it('uses black text on bright backgrounds and white text on dark backgrounds', () => {
        assert.equal(legacyLuminanceTextColor('#FFFF00'), '#000000');
        assert.equal(legacyLuminanceTextColor('#008000'), '#FFFFFF');
        assert.equal(legacyLuminanceTextColor('#A9A9A9'), '#000000');
    });

    void it('keeps the separate Ref PHP newColor palette contract', () => {
        assert.equal(legacyNationTextColor('#A9A9A9'), '#FFFFFF');
        assert.equal(legacyNationTextColor('#FFFF00'), '#000000');
    });
});
