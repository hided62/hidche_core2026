import { describe, expect, it } from 'vitest';

import {
    ALL_MERGED_INHERITANCE_KEYS,
    computeActiveInheritancePoint,
    computeInheritanceSettlementBreakdown,
} from '../src/inheritance/pointCalculation.js';

describe('Ref inheritance point calculation', () => {
    const general = {
        meta: {
            inherit_lived_month: 12,
            max_domestic_critical: 20,
            inherit_active_action: 0.5,
            belong: 7,
            max_belong: 9,
            rank_warnum: 3,
            firenum: 2,
            dex1: 1_275_978,
            dex2: 100,
            event100_allstar: { granted: { dex2: 40 } },
            betwin: 2,
            betgold: 2_000,
            betwingold: 1_000,
        },
        inheritancePoints: {
            max_domestic_critical: 80,
            unifier: 250,
            tournament: 50,
        },
    };

    it('keeps all ten Ref sources distinct', () => {
        expect(ALL_MERGED_INHERITANCE_KEYS).toEqual([
            'lived_month',
            'max_domestic_critical',
            'active_action',
            'unifier',
            'tournament',
            'max_belong',
            'combat',
            'sabotage',
            'dex',
            'betting',
        ]);
        expect(
            Object.fromEntries(
                ALL_MERGED_INHERITANCE_KEYS.map((key) => [key, computeActiveInheritancePoint(general, key)])
            )
        ).toEqual({
            lived_month: 12,
            max_domestic_critical: 80,
            active_action: 1.5,
            unifier: 250,
            tournament: 50,
            max_belong: 90,
            combat: 15,
            sabotage: 40,
            dex: 1_276.036,
            betting: 5,
        });
    });

    it('pays only Ref rebirth-enabled sources and retains the three delayed sources', () => {
        const settlement = computeInheritanceSettlementBreakdown(general, true);

        expect(settlement.earned).toEqual({
            lived_month: 12,
            max_domestic_critical: 0,
            active_action: 1.5,
            unifier: 0,
            tournament: 50,
            max_belong: 0,
            combat: 15,
            sabotage: 40,
            dex: 638.018,
            betting: 5,
        });
        expect(settlement.retained).toEqual({
            max_domestic_critical: 80,
            unifier: 250,
            max_belong: 90,
        });
        expect(settlement.totalEarned).toBeCloseTo(761.518, 8);
    });

    it('uses the current domestic streak only as a live upgrade candidate for the stored maximum', () => {
        expect(
            computeActiveInheritancePoint(
                {
                    meta: { max_domestic_critical: 120 },
                    inheritancePoints: { max_domestic_critical: 80 },
                },
                'max_domestic_critical'
            )
        ).toBe(120);
        expect(
            computeActiveInheritancePoint(
                {
                    meta: { max_domestic_critical: 0 },
                    inheritancePoints: { max_domestic_critical: 80 },
                },
                'max_domestic_critical'
            )
        ).toBe(80);
    });
});
