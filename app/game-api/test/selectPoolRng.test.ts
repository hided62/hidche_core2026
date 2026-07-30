import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { LiteHashDRBG, RandUtil } from '@sammo-ts/common';

import {
    buildSelectPoolSeed,
    claimWeightedSelectionCandidates,
} from '../src/services/selectPool.js';

interface PoolResource {
    data: Array<
        [
            string,
            number,
            number,
            number,
            string,
            [number, number, number, number, number],
            0 | 1,
            string,
        ]
    >;
}

const loadWeightedRows = async (): Promise<Array<[{ id: number }, number]>> => {
    const filePath = path.resolve(
        import.meta.dirname,
        '../../../resources/general-pool/SPoolUnderU30.json'
    );
    const resource = JSON.parse(await fs.readFile(filePath, 'utf8')) as PoolResource;
    return resource.data.map((row, index) => [
        { id: index + 1 },
        row[5].reduce((sum, value) => sum + value, 0),
    ]);
};

const drawVector = async (
    hiddenSeed: string
): Promise<{ selected: number[]; draws: number[] }> => {
    const weighted = await loadWeightedRows();
    const now = new Date('2026-07-30T03:34:56.000Z');
    const draws: number[] = [];
    const selected = await claimWeightedSelectionCandidates({
        weighted,
        rng: new RandUtil(new LiteHashDRBG(buildSelectPoolSeed(hiddenSeed, 42, now))),
        count: 14,
        claim: async () => true,
        onDraw: (candidate) => draws.push(candidate.id),
    });
    return { selected: selected.map((candidate) => candidate.id), draws };
};

describe('select pool Ref RNG parity', () => {
    it('uses the legacy seed serialization and fixed UnderS30 draw vector', async () => {
        const now = new Date('2026-07-30T03:34:56.000Z');
        expect(buildSelectPoolSeed('vector-hidden', 42, now)).toBe(
            'str(13,vector-hidden)|str(10,selectPool)|int(42)|str(19,2026-07-30 12:34:56)'
        );

        await expect(drawVector('vector-hidden')).resolves.toEqual({
            selected: [72, 1283, 110, 1659, 608, 1408, 1543, 1573, 1096, 1081, 278, 1256, 872, 1369],
            draws: [72, 1283, 110, 1659, 608, 1408, 1543, 1573, 1096, 1081, 278, 1256, 872, 1369],
        });
    });

    it('consumes duplicate draws without removing the candidate from the weighted pool', async () => {
        await expect(drawVector('vector-hidden-28')).resolves.toEqual({
            selected: [314, 865, 1485, 1382, 110, 550, 27, 368, 399, 1298, 152, 39, 189, 760],
            draws: [314, 865, 1485, 1382, 110, 550, 27, 368, 399, 1298, 27, 152, 39, 189, 760],
        });
    });
});
