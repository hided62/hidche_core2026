import type { GeneralAI } from '../../core.js';
import { joinYearMonth } from '../../../aiUtils.js';
import {
    buildAssignmentCandidate,
    pickRandomCityId,
    pickWeightedCandidate,
    resolveCityPopRatio,
    resolveLastAssignment,
} from '../helpers.js';

export const do부대전방발령 = (ai: GeneralAI) => {
    if (!ai.nation || !ai.map) {
        return null;
    }
    if (!ai.nation.capitalCityId) {
        return null;
    }
    if (Object.keys(ai.frontCities).length === 0) {
        return null;
    }

    ai.calcWarRoute();
    const yearMonth = joinYearMonth(ai.world.currentYear, ai.world.currentMonth);

    const troopCandidates: Array<[ReturnType<GeneralAI['buildNationCandidate']>, number]> = [];

    for (const leader of Object.values(ai.troopLeaders)) {
        if (!ai.nationPolicy.combatForce[leader.id]) {
            continue;
        }
        if (ai.frontCities[leader.cityId]) {
            continue;
        }
        if (resolveLastAssignment(leader, yearMonth)) {
            continue;
        }

        const force = ai.nationPolicy.combatForce[leader.id];
        let [fromCityId, toCityId] = force;

        let targetCityId: number | null;
        if (!ai.warRoute || !ai.warRoute[fromCityId] || ai.warRoute[fromCityId][toCityId] === undefined) {
            targetCityId = pickRandomCityId(ai, ai.frontCities);
        } else {
            if (!ai.supplyCities[fromCityId]) {
                toCityId = fromCityId;
                fromCityId = ai.nation.capitalCityId ?? fromCityId;
            }
            targetCityId = fromCityId;
            while (targetCityId !== null && !ai.frontCities[targetCityId]) {
                const current = targetCityId;
                const distance = ai.warRoute[current]?.[toCityId];
                if (distance === undefined) {
                    targetCityId = pickRandomCityId(ai, ai.frontCities);
                    break;
                }
                const connections: number[] = ai.map.cities.find((city) => city.id === current)?.connections ?? [];
                const nextCandidates: number[] = connections.filter((nextCityId: number) => {
                    const nextDistance = ai.warRoute?.[nextCityId]?.[toCityId];
                    return nextDistance !== undefined && nextDistance <= distance;
                });
                if (nextCandidates.length === 0) {
                    targetCityId = pickRandomCityId(ai, ai.frontCities);
                    break;
                }
                targetCityId = ai.rng.choice(nextCandidates);
            }
        }

        if (targetCityId === null) {
            continue;
        }
        troopCandidates.push([buildAssignmentCandidate(ai, leader.id, targetCityId, '부대전방발령'), 1]);
    }

    return pickWeightedCandidate(ai, troopCandidates);
};

export const do부대후방발령 = (ai: GeneralAI) => {
    if (!ai.nation || !ai.nation.capitalCityId) {
        return null;
    }
    if (Object.keys(ai.frontCities).length === 0) {
        return null;
    }
    if (Object.keys(ai.supplyCities).length <= 1) {
        return null;
    }

    const yearMonth = joinYearMonth(ai.world.currentYear, ai.world.currentMonth);
    const troopCandidates = Object.values(ai.troopLeaders).filter((leader) => {
        if (!ai.nationPolicy.supportForce.includes(leader.id)) {
            return false;
        }
        if (resolveLastAssignment(leader, yearMonth)) {
            return false;
        }
        const city = ai.supplyCities[leader.cityId];
        if (!city) {
            return true;
        }
        if (resolveCityPopRatio(city) >= ai.nationPolicy.safeRecruitCityPopulationRatio) {
            return false;
        }
        return true;
    });

    if (troopCandidates.length === 0) {
        return null;
    }

    const cityCandidates: Record<number, number> = {};
    for (const city of Object.values(ai.backupCities)) {
        const ratio = resolveCityPopRatio(city);
        if (ratio >= ai.nationPolicy.safeRecruitCityPopulationRatio) {
            cityCandidates[city.id] = ratio;
        }
    }
    if (Object.keys(cityCandidates).length === 0) {
        for (const city of Object.values(ai.supplyCities)) {
            const ratio = resolveCityPopRatio(city);
            if (ratio >= ai.nationPolicy.safeRecruitCityPopulationRatio) {
                cityCandidates[city.id] = ratio;
            }
        }
    }
    if (Object.keys(cityCandidates).length === 0) {
        return null;
    }

    const destCityId = Number(ai.rng.choiceUsingWeight(cityCandidates));
    if (!Number.isFinite(destCityId)) {
        return null;
    }
    const leader = ai.rng.choice(troopCandidates);
    return buildAssignmentCandidate(ai, leader.id, destCityId, '부대후방발령');
};

export const do부대구출발령 = (ai: GeneralAI) => {
    if (!ai.nation || !ai.nation.capitalCityId) {
        return null;
    }
    if (Object.keys(ai.frontCities).length === 0) {
        return null;
    }
    const yearMonth = joinYearMonth(ai.world.currentYear, ai.world.currentMonth);

    const troopCandidates = Object.values(ai.troopLeaders).filter((leader) => {
        if (ai.nationPolicy.supportForce.includes(leader.id)) {
            return false;
        }
        if (ai.nationPolicy.combatForce[leader.id]) {
            return false;
        }
        if (resolveLastAssignment(leader, yearMonth)) {
            return false;
        }
        return !ai.supplyCities[leader.cityId];
    });

    if (troopCandidates.length === 0) {
        return null;
    }

    const destCityId = pickRandomCityId(ai, ai.frontCities);
    if (destCityId === null) {
        return null;
    }
    const leader = ai.rng.choice(troopCandidates);
    return buildAssignmentCandidate(ai, leader.id, destCityId, '부대구출발령');
};
