import type { City } from '@sammo-ts/logic';

import type { GeneralAI } from '../core.js';
import { asRecord, readMetaNumber } from '../../aiUtils.js';

export const ACTION_REST = '휴식';

export const t무장 = 1;
export const t지장 = 2;
export const t통솔장 = 4;

export const resolveCityTrust = (city: City): number => readMetaNumber(asRecord(city.meta), 'trust', 0);

export const pickWeightedCandidate = (
    ai: GeneralAI,
    list: Array<[ReturnType<GeneralAI['buildGeneralCandidate']>, number]>
) => {
    const items = list.filter(([item]) => Boolean(item)) as Array<
        [ReturnType<GeneralAI['buildGeneralCandidate']>, number]
    >;
    if (items.length === 0) {
        return null;
    }
    const picked = ai.rng.choiceUsingWeightPair(items);
    return picked ?? null;
};
