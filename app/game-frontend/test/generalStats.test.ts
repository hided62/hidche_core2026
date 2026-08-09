import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { abilityLeadint, abilityLeadpow, abilityPowint, abilityRand } from '../src/utils/generalStats.ts';

const rules = { min: 15, max: 80, total: 165 };
const sequence = (...values: number[]) => {
    let index = 0;
    return () => values[index++] ?? values.at(-1) ?? 0.5;
};

void describe('generalStats Ref presets', () => {
    void it('normalizes the random preset to the configured total', () => {
        assert.deepEqual(abilityRand(rules, sequence(0.2, 0.4, 0.6)), [36, 55, 74]);
    });

    void it('preserves the Ref two-stat weighted distributions and min/max correction order', () => {
        assert.deepEqual(abilityLeadpow(rules, sequence(0.9, 0.8, 0.5)), [75, 75, 15]);
        assert.deepEqual(abilityLeadint(rules, sequence(0.9, 0.5, 0.8)), [75, 15, 75]);
        assert.deepEqual(abilityPowint(rules, sequence(0.5, 0.9, 0.8)), [15, 75, 75]);
    });
});
