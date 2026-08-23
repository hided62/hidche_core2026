import { describe, expect, it } from 'vitest';
import { LiteHashDRBG, RandUtil } from '@sammo-ts/common';

import { loadGeneralPoolEntries } from '../src/scenario/generalPoolLoader.js';
import {
    buildSelectPoolSeed,
    calculateSelectionCandidateWeight,
    claimWeightedSelectionCandidates,
    type SelectPoolCandidateInfo,
} from '../src/turn/selectPoolService.js';

const toCandidate = (info: Record<string, unknown>): SelectPoolCandidateInfo => {
    const dex = info.dex;
    if (
        typeof info.uniqueName !== 'string' ||
        typeof info.generalName !== 'string' ||
        typeof info.leadership !== 'number' ||
        typeof info.strength !== 'number' ||
        typeof info.intel !== 'number' ||
        (info.specialDomestic !== null && typeof info.specialDomestic !== 'string') ||
        !Array.isArray(dex) ||
        dex.length !== 5 ||
        dex.some((value) => typeof value !== 'number') ||
        (info.imgsvr !== 0 && info.imgsvr !== 1) ||
        typeof info.picture !== 'string'
    ) {
        throw new Error('invalid SPoolUnderU100 test entry');
    }
    return {
        uniqueName: info.uniqueName,
        generalName: info.generalName,
        leadership: info.leadership,
        strength: info.strength,
        intel: info.intel,
        specialDomestic: info.specialDomestic,
        dex: dex as [number, number, number, number, number],
        imgsvr: info.imgsvr,
        picture: info.picture,
    };
};

describe('SPoolUnderU100 deterministic selection', () => {
    it('uses the Ref user/NPC weight contract including the zero-dex floor', () => {
        const candidate = toCandidate({
            uniqueName: 'A1000001',
            generalName: 'weight fixture',
            leadership: 70,
            strength: 60,
            intel: 60,
            specialDomestic: null,
            dex: [0, 0, 0, 0, 0],
            imgsvr: 0,
            picture: '0',
        });

        expect(calculateSelectionCandidateWeight('SPoolUnderU100', candidate, false)).toBe(100_000);
        expect(calculateSelectionCandidateWeight('SPoolUnderU100', candidate, true)).toBe(150_000);
    });

    it('keeps the fixed-seed 14-candidate draw stable', async () => {
        const entries = await loadGeneralPoolEntries('SPoolUnderU100');
        const rows = entries.map((entry, index) => ({ id: index + 1, ...entry }));
        const rng = new RandUtil(new LiteHashDRBG(buildSelectPoolSeed('s100-vector-hidden', 42, 72_000_000)));
        const draws: string[] = [];
        const selected = await claimWeightedSelectionCandidates({
            weighted: rows.map((row) => [
                row,
                calculateSelectionCandidateWeight('SPoolUnderU100', toCandidate(row.info), true),
            ]),
            rng,
            count: 14,
            claim: async () => true,
            onDraw: (candidate) => draws.push(candidate.uniqueName),
        });

        expect(selected.map((candidate) => candidate.uniqueName)).toEqual([
            'A1004478',
            'A1000583',
            'A1002480',
            'A1001485',
            'A1002714',
            'A1004544',
            'A1000918',
            'A1004549',
            'A1003871',
            'A1002678',
            'A1000531',
            'A1003379',
            'A1004275',
            'A1003449',
        ]);
        expect(draws).toEqual(selected.map((candidate) => candidate.uniqueName));
    });

    it('keeps duplicate draws in the RNG stream while claiming each row once', async () => {
        const candidates = [
            { id: 1, uniqueName: 'first' },
            { id: 2, uniqueName: 'second' },
        ];
        const draws: string[] = [];
        const selected = await claimWeightedSelectionCandidates({
            weighted: [
                [candidates[0]!, 3],
                [candidates[1]!, 1],
            ],
            rng: new RandUtil(new LiteHashDRBG('s100-duplicate-retry-vector')),
            count: 2,
            claim: async () => true,
            onDraw: (candidate) => draws.push(candidate.uniqueName),
        });

        expect(draws).toEqual(['first', 'first', 'first', 'first', 'first', 'first', 'first', 'second']);
        expect(selected.map((candidate) => candidate.uniqueName)).toEqual(['first', 'second']);
    });
});
