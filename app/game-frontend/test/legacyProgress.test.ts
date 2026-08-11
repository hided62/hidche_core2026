import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEX_EX_PLUS, dexProgress, legacyExperiencePercent, ratioPercent } from '../src/utils/legacyProgress.ts';

void describe('legacy progress calculations', () => {
    void it('uses the real EX+ threshold for the full dexterity bar', () => {
        assert.equal(DEX_EX_PLUS, 1_275_975);
        assert.equal(dexProgress(1_000_000).overallPercent, (1_000_000 / 1_275_975) * 100);
        assert.equal(dexProgress(DEX_EX_PLUS).overallPercent, 100);
    });

    void it('tracks progress inside the current dexterity grade separately', () => {
        assert.deepEqual(dexProgress(350), {
            level: 1,
            name: 'F',
            color: 'navy',
            overallPercent: (350 / DEX_EX_PLUS) * 100,
            gradePercent: 0,
            nextName: 'F+',
            remaining: 1_025,
        });
        assert.equal(dexProgress(1_275_975).gradePercent, 100);
        assert.equal(dexProgress(1_275_975).nextName, null);
    });

    void it('preserves ref experience-level and guarded ratio percentages', () => {
        assert.equal(legacyExperiencePercent(55, 0), 55);
        assert.equal(legacyExperiencePercent(450, 4), 50);
        assert.equal(legacyExperiencePercent(1_210, 11), 0);
        assert.equal(legacyExperiencePercent(1_440, 11), 100);
        assert.equal(ratioPercent(10, 0), 0);
        assert.equal(ratioPercent(15, 10), 100);
    });
});
