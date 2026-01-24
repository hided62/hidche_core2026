import type { City } from '@sammo-ts/logic';

import type { GeneralAI } from '../core.js';
import { asRecord, readMetaNumber } from '../../aiUtils.js';

export const pickWeightedCandidate = (ai: GeneralAI, list: Array<[ReturnType<GeneralAI['buildNationCandidate']>, number]>) => {
    const items = list.filter(([item]) => Boolean(item)) as Array<
        [ReturnType<GeneralAI['buildNationCandidate']>, number]
    >;
    if (items.length === 0) {
        return null;
    }
    const picked = ai.rng.choiceUsingWeightPair(items);
    return picked ?? null;
};

export const pickRandomCityId = (ai: GeneralAI, cities: Record<number, City>): number | null => {
    const ids = Object.keys(cities).map((key) => Number(key));
    if (ids.length === 0) {
        return null;
    }
    return ai.rng.choice(ids);
};

export const resolveCityPopRatio = (city: City): number => {
    if (city.populationMax <= 0) {
        return 0;
    }
    return city.population / city.populationMax;
};

export const resolveLastAssignment = (general: GeneralAI['general'], yearMonth: number): boolean => {
    const last = readMetaNumber(asRecord(general.meta), 'last발령', 0);
    return last >= yearMonth;
};

export const selectRecruitableCity = (ai: GeneralAI, minPop: number): Record<number, number> => {
    const candidates: Record<number, number> = {};
    for (const city of Object.values(ai.backupCities)) {
        if (city.population < minPop) {
            continue;
        }
        const ratio = resolveCityPopRatio(city);
        candidates[city.id] = ratio;
    }
    if (Object.keys(candidates).length > 0) {
        return candidates;
    }
    for (const city of Object.values(ai.supplyCities)) {
        if (city.population < minPop) {
            continue;
        }
        const ratio = resolveCityPopRatio(city);
        candidates[city.id] = ratio;
    }
    return candidates;
};

export const buildAssignmentCandidate = (ai: GeneralAI, destGeneralId: number, destCityId: number, reason: string) =>
    ai.buildNationCandidate('che_발령', { destGeneralId, destCityId }, reason);

export const buildSeizureCandidate = (ai: GeneralAI, destGeneralId: number, amount: number, isGold: boolean, reason: string) =>
    ai.buildNationCandidate('che_몰수', { destGeneralID: destGeneralId, amount, isGold }, reason);

export const buildAwardCandidate = (ai: GeneralAI, destGeneralId: number, amount: number, isGold: boolean, reason: string) =>
    ai.buildNationCandidate('che_포상', { destGeneralId, amount, isGold }, reason);

export const resolveAwardAmount = (ai: GeneralAI, current: number, target: number): number | null => {
    const diff = target - current;
    if (diff <= 0) {
        return null;
    }
    const amount = Math.min(diff, ai.maxResourceActionAmount);
    if (amount < ai.nationPolicy.minimumResourceActionAmount) {
        return null;
    }
    return amount;
};

export const resolveNationIncome = (ai: GeneralAI): number => {
    const cities = Object.values(ai.supplyCities);
    if (cities.length === 0) {
        return 0;
    }
    return cities.reduce((sum, city) => sum + city.population / 100 + city.agriculture / 100 + city.commerce / 100, 0);
};

export const pickFrontCityWeight = (ai: GeneralAI): Record<number, number> => {
    const candidates: Record<number, number> = {};
    for (const city of Object.values(ai.frontCities)) {
        candidates[city.id] = city.important;
    }
    return candidates;
};
