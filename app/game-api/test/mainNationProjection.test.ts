import { describe, expect, it } from 'vitest';

import {
    resolveImpossibleStrategicCommands,
    resolveMainNationTech,
    splitNationTraitInfo,
} from '../src/services/mainNationProjection.js';

describe('main nation projection', () => {
    it('splits the Ref nation-type advantages and disadvantages without changing their order', () => {
        expect(splitNationTraitInfo('농상↑ 민심↑ 쌀수입↓')).toEqual({
            pros: '농상↑ 민심↑',
            cons: '쌀수입↓',
        });
    });

    it('uses the scenario-relative Ref technology grade and limit', () => {
        expect(
            resolveMainNationTech({
                tech: 3_999,
                currentYear: 190,
                worldConfig: {
                    const: { maxTechLevel: 12, initialAllowedTechLevel: 1, techLevelIncYear: 5 },
                },
                worldMeta: { scenarioMeta: { startYear: 180 } },
            })
        ).toEqual({ level: 3, limited: true });
    });

    it('returns only strategic commands whose Ref-compatible cooldown is still active', () => {
        expect(
            resolveImpossibleStrategicCommands(
                {
                    next_execute_수몰: 190 * 12 + 4,
                    next_execute_허보: 190 * 12 + 2,
                },
                190,
                4
            )
        ).toEqual([{ name: '수몰', remainingTurns: 1, availableYear: 190, availableMonth: 5 }]);
    });
});
