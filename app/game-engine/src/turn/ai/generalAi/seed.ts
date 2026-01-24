import type { TurnWorldState } from '../../types.js';
import { asRecord } from '../aiUtils.js';

export const buildSeedBase = (world: TurnWorldState): string => {
    const meta = asRecord(world.meta);
    const rawSeed = meta.hiddenSeed ?? meta.seed ?? world.id;
    return String(rawSeed);
};
