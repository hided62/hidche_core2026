import { describe, expect, it } from 'vitest';

import { resolveJoinSpecialityAges } from '../src/router/join/index.js';

describe('join speciality ages', () => {
    it('uses the legacy retirement formula outside custom scenarios', () => {
        expect(
            resolveJoinSpecialityAges({
                retirementYear: 80,
                age: 20,
                relativeYear: 0,
                scenarioId: 910,
            })
        ).toEqual({ domestic: 25, war: 30 });
        expect(
            resolveJoinSpecialityAges({
                retirementYear: 80,
                age: 30,
                relativeYear: 4,
                scenarioId: 910,
            })
        ).toEqual({ domestic: 33, war: 36 });
    });

    it('forces both speciality ages to age plus three for scenario 1000 and above', () => {
        expect(
            resolveJoinSpecialityAges({
                retirementYear: 80,
                age: 26,
                relativeYear: 7,
                scenarioId: 2220,
            })
        ).toEqual({ domestic: 29, war: 29 });
    });
});
