import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    buildNeutralResourceAuctionPlan,
    type NeutralAuctionPlanInput,
    type NeutralResourceAuctionPlan,
} from '../src/auction/neutral.js';

const refRoot = process.env.SAMMO_REF_ROOT;
const oraclePath = fileURLToPath(new URL('../../../tools/legacy-oracles/neutral-auction.php', import.meta.url));

const runLegacyOracle = (input: NeutralAuctionPlanInput): NeutralResourceAuctionPlan[] => {
    if (!refRoot) {
        throw new Error('SAMMO_REF_ROOT is required');
    }
    const result = spawnSync('php', [oraclePath, refRoot, JSON.stringify(input)], {
        encoding: 'utf8',
    });
    if (result.status !== 0) {
        throw new Error(result.stderr || `legacy oracle exited with ${result.status}`);
    }
    return JSON.parse(result.stdout) as NeutralResourceAuctionPlan[];
};

const fixtures: Array<{ input: NeutralAuctionPlanInput; expectedTypes: string[] }> = [
    {
        expectedTypes: ['BUY_RICE'],
        input: {
            hiddenSeed: 'merchant-11',
            seedYear: 180,
            seedMonth: 1,
            nationCount: 3,
            consumeTournamentRoll: false,
            averageGold: 5_432,
            averageRice: 7_654,
            buyRiceAuctionCount: 0,
            sellRiceAuctionCount: 0,
        },
    },
    {
        expectedTypes: ['BUY_RICE', 'SELL_RICE'],
        input: {
            hiddenSeed: 'tournament-35',
            seedYear: 191,
            seedMonth: 12,
            nationCount: 8,
            consumeTournamentRoll: true,
            averageGold: 25_000,
            averageRice: 500,
            buyRiceAuctionCount: 2,
            sellRiceAuctionCount: 4,
        },
    },
    {
        expectedTypes: [],
        input: {
            hiddenSeed: 'merchant-32',
            seedYear: 203,
            seedMonth: 7,
            nationCount: 3,
            consumeTournamentRoll: false,
            averageGold: 5_432,
            averageRice: 7_654,
            buyRiceAuctionCount: 0,
            sellRiceAuctionCount: 0,
        },
    },
];

describe.skipIf(!refRoot)('neutral auction legacy PHP differential', () => {
    for (const [index, fixture] of fixtures.entries()) {
        it(`matches legacy RNG timing and amounts for fixture ${index + 1}`, () => {
            const actual = buildNeutralResourceAuctionPlan(fixture.input);
            expect(actual).toEqual(runLegacyOracle(fixture.input));
            expect(actual.map((plan) => plan.auctionType)).toEqual(fixture.expectedTypes);
        });
    }

    it('matches a seed, month, count, tournament, and average-resource matrix', () => {
        let generatedAuctions = 0;
        const generatedTypes = new Set<string>();
        for (let index = 0; index < 96; index += 1) {
            const input: NeutralAuctionPlanInput = {
                hiddenSeed: `neutral-matrix-${index}`,
                seedYear: 180 + (index % 17),
                seedMonth: (index % 12) + 1,
                nationCount: index % 11,
                consumeTournamentRoll: index % 2 === 0,
                averageGold: 500 + ((index * 1_337) % 25_000),
                averageRice: 500 + ((index * 2_111) % 25_000),
                buyRiceAuctionCount: index % 9,
                sellRiceAuctionCount: index % 13,
            };
            const actual = buildNeutralResourceAuctionPlan(input);
            expect(actual, `matrix fixture ${index}`).toEqual(runLegacyOracle(input));
            generatedAuctions += actual.length;
            for (const plan of actual) {
                generatedTypes.add(plan.auctionType);
            }
        }
        expect(generatedAuctions).toBeGreaterThan(0);
        expect(generatedTypes).toEqual(new Set(['BUY_RICE', 'SELL_RICE']));
    });
});
