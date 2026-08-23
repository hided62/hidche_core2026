import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { LiteHashDRBG, RandUtil } from '@sammo-ts/common';

import { buildSelectPoolSeed, claimWeightedSelectionCandidates } from '@sammo-ts/game-engine/turn/selectPoolService.js';

interface PoolResource {
    data: Array<[string, number, number, number, string, [number, number, number, number, number], 0 | 1, string]>;
}

const loadWeightedRows = async (): Promise<Array<[{ id: number }, number]>> => {
    const filePath = path.resolve(import.meta.dirname, '../../../resources/general-pool/SPoolUnderU30.json');
    const resource = JSON.parse(await fs.readFile(filePath, 'utf8')) as PoolResource;
    return resource.data.map((row, index) => [{ id: index + 1 }, row[5].reduce((sum, value) => sum + value, 0)]);
};

const drawVector = async (hiddenSeed: string): Promise<{ selected: number[]; draws: number[] }> => {
    const weighted = await loadWeightedRows();
    const nowTick = 72_000_000;
    const draws: number[] = [];
    const selected = await claimWeightedSelectionCandidates({
        weighted,
        rng: new RandUtil(new LiteHashDRBG(buildSelectPoolSeed(hiddenSeed, 42, nowTick))),
        count: 14,
        claim: async () => true,
        onDraw: (candidate) => draws.push(candidate.id),
    });
    return { selected: selected.map((candidate) => candidate.id), draws };
};

describe('select pool Ref RNG parity', () => {
    it('uses the legacy seed serialization and fixed UnderS30 draw vector', async () => {
        const nowTick = 72_000_000;
        expect(buildSelectPoolSeed('vector-hidden', 42, nowTick)).toBe(
            'str(13,vector-hidden)|str(10,selectPool)|int(42)|int(72000000)'
        );

        await expect(drawVector('vector-hidden')).resolves.toEqual({
            selected: [1547, 199, 1266, 756, 1741, 1435, 303, 753, 214, 576, 387, 388, 394, 252],
            draws: [1547, 199, 1266, 756, 1741, 1435, 303, 753, 214, 576, 387, 388, 394, 252],
        });
    });

    it('consumes duplicate draws without removing the candidate from the weighted pool', async () => {
        await expect(drawVector('vector-hidden-2')).resolves.toEqual({
            selected: [1632, 543, 640, 1351, 691, 966, 1110, 1358, 224, 936, 262, 109, 852, 456],
            draws: [1632, 543, 640, 1351, 691, 966, 1110, 1358, 224, 936, 262, 109, 966, 852, 456],
        });
    });
});
