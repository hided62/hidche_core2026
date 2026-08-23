import { describe, expect, it } from 'vitest';

import {
    buildScenarioGeneralPoolClaimMeta,
    getScenarioGeneralPoolCandidateWeight,
    parseScenarioGeneralPoolCandidate,
    pickUniqueScenarioGeneralPoolCandidates,
    readScenarioGeneralPoolClaim,
    resolveLegacyNpcStatTypeFromFixedStats,
    type ScenarioGeneralPoolCandidate,
} from '../../../src/actions/turn/generalPool.js';

const candidate = (poolEntryId: number, name: string, weight: number): ScenarioGeneralPoolCandidate => ({
    poolEntryId,
    uniqueName: name,
    name,
    dex: [weight, 0, 0, 0, 0],
    sourceInfo: {},
});

describe('scenario general pool', () => {
    it('keeps the Ref weighted array and consumes duplicate draws before selecting a new row', () => {
        const draws = [0, 0, 0.75];
        let drawCount = 0;
        const rng = {
            nextFloat1: () => {
                const value = draws[drawCount];
                drawCount += 1;
                return value ?? 0;
            },
            nextBool: () => false,
            nextInt: () => 0,
        };

        expect(pickUniqueScenarioGeneralPoolCandidates(rng, [candidate(1, '갑', 1), candidate(2, '을', 1)], 2)).toEqual(
            [expect.objectContaining({ poolEntryId: 1 }), expect.objectContaining({ poolEntryId: 2 })]
        );
        expect(drawCount).toBe(3);
    });

    it('fails with the Ref pool-shortage message instead of using a random-name fallback', () => {
        const rng = { nextFloat1: () => 0, nextBool: () => false, nextInt: () => 0 };
        expect(() => pickUniqueScenarioGeneralPoolCandidates(rng, [candidate(1, '갑', 1)], 2)).toThrow('pool 부족');
    });

    it('keeps zero-dex centennial NPC candidates selectable with the Ref minimum weight', () => {
        const centennial = {
            ...candidate(3, '성장후보', 0),
            sourceInfo: { event100Growth: true },
        };
        let draws = 0;
        const rng = {
            nextFloat1: () => {
                draws += 1;
                return 0;
            },
            nextBool: () => false,
            nextInt: () => 0,
        };

        expect(getScenarioGeneralPoolCandidateWeight(centennial)).toBe(100_000);
        expect(pickUniqueScenarioGeneralPoolCandidates(rng, [centennial], 1)).toEqual([centennial]);
        expect(draws).toBe(1);
    });

    it('parses the U30 builder fields and round-trips the persisted claim marker', () => {
        const parsed = parseScenarioGeneralPoolCandidate({
            id: 17,
            uniqueName: '풀장수',
            info: {
                generalName: '풀장수',
                leadership: 69,
                strength: 12,
                intel: 80,
                specialDomestic: 'che_event_징병',
                dex: [1, 2, 3, 4, 5],
                imgsvr: 1,
                picture: 'pool.gif',
            },
        });
        const claimedAt = new Date('0200-05-01T00:00:00.000Z');
        const meta = { killturn: 1, ...buildScenarioGeneralPoolClaimMeta(parsed, claimedAt) };

        expect(parsed).toMatchObject({
            poolEntryId: 17,
            uniqueName: '풀장수',
            name: '풀장수',
            stats: { leadership: 69, strength: 12, intelligence: 80 },
            dex: [1, 2, 3, 4, 5],
            specialDomestic: 'che_event_징병',
            imageServer: 1,
            picture: 'pool.gif',
        });
        expect(readScenarioGeneralPoolClaim(meta)).toEqual({
            poolEntryId: 17,
            uniqueName: '풀장수',
            claimedAt: claimedAt.toISOString(),
        });
    });

    it('only consumes a stat-type draw for an ambiguous fixed-stat candidate', () => {
        let draws = 0;
        const rng = {
            nextFloat1: () => {
                draws += 1;
                return 0;
            },
            nextBool: () => false,
            nextInt: () => 0,
        };

        expect(
            resolveLegacyNpcStatTypeFromFixedStats(rng, {
                leadership: 70,
                strength: 80,
                intelligence: 10,
            })
        ).toBe('무');
        expect(draws).toBe(0);
        expect(
            resolveLegacyNpcStatTypeFromFixedStats(rng, {
                leadership: 70,
                strength: 50,
                intelligence: 50,
            })
        ).toBe('무');
        expect(draws).toBe(1);
    });
});
