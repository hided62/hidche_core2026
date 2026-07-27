import { asNumber } from '@sammo-ts/common';

const DEFAULT_NATION_RATE = 20;

export const resolveAppliedNationRate = (meta: Record<string, unknown>): number => {
    const stagedRate = meta.rate_tmp;
    if (typeof stagedRate === 'number' && Number.isFinite(stagedRate)) {
        return stagedRate;
    }
    return asNumber(meta.rate, DEFAULT_NATION_RATE);
};
