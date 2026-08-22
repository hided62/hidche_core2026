import type { GeneralAI } from '../../core.js';
import { asRecord, readMetaNumber } from '../../../aiUtils.js';
import {
    buildAssignmentCandidate,
    isGeneralTurnBefore,
    pickFrontCityWeight,
    pickRandomCityId,
    resolveCityPopRatio,
    selectSafeRearCity,
    selectUserRecruitmentRearCity,
} from '../helpers.js';

export const do부대유저장후방발령 = (ai: GeneralAI) => {
    if (Object.keys(ai.frontCities).length === 0) {
        return null;
    }
    if (ai.dipState !== 4) {
        return null;
    }

    const candidates = Object.values(ai.userWarGenerals).filter((general) => {
        if (general.id === ai.general.id) {
            return false;
        }
        if (!ai.frontCities[general.cityId]) {
            return false;
        }
        if (!ai.nationCities[general.cityId]) {
            return false;
        }
        const troopLeaderId = general.troopId;
        if (!troopLeaderId || !ai.troopLeaders[troopLeaderId]) {
            return false;
        }
        if (troopLeaderId === general.id) {
            return false;
        }
        const troopLeader = ai.troopLeaders[troopLeaderId];
        if (troopLeader.cityId !== general.cityId) {
            return false;
        }
        if (!ai.supplyCities[troopLeader.cityId]) {
            return false;
        }
        const city = ai.nationCities[general.cityId];
        if (resolveCityPopRatio(city) >= ai.nationPolicy.safeRecruitCityPopulationRatio) {
            return false;
        }
        if (general.crew >= ai.nationPolicy.minWarCrew) {
            return false;
        }
        if (ai.calculateRecruitPopulationScore(general) <= 1) {
            return false;
        }
        if (!isGeneralTurnBefore(general, troopLeader)) {
            return false;
        }
        const reserved = ai.getFirstReservedGeneralTurn(general.id);
        if (reserved.action !== 'che_징병') {
            return false;
        }
        return true;
    });

    if (candidates.length === 0) {
        return null;
    }

    const destCityCandidates = selectSafeRearCity(ai);
    if (Object.keys(destCityCandidates).length === 0) {
        return null;
    }

    // Ref chooses the user first, then the destination city. Both consume the
    // shared nation AI RNG even when a later command constraint rejects it.
    const destGeneral = ai.rng.choice(candidates);
    const destCityId = Number(ai.rng.choiceUsingWeight(destCityCandidates));
    if (!Number.isFinite(destCityId)) {
        return null;
    }
    return buildAssignmentCandidate(ai, destGeneral.id, destCityId, '부대유저장후방발령');
};

export const do유저장후방발령 = (ai: GeneralAI) => {
    if (!ai.nation || !ai.nation.capitalCityId) {
        return null;
    }
    if (ai.dipState !== 4) {
        return null;
    }
    if (Object.keys(ai.supplyCities).length <= 1) {
        return null;
    }

    const candidates = Object.values(ai.userWarGenerals).filter((general) => {
        if (general.id === ai.general.id) {
            return false;
        }
        if (!ai.supplyCities[general.cityId]) {
            return false;
        }
        if (general.troopId) {
            return false;
        }
        const city = ai.supplyCities[general.cityId];
        if (resolveCityPopRatio(city) >= ai.nationPolicy.safeRecruitCityPopulationRatio) {
            return false;
        }
        if (general.crew >= ai.nationPolicy.minWarCrew) {
            return false;
        }
        if (ai.calculateRecruitPopulationScore(general) <= 1) {
            return false;
        }
        return true;
    });

    if (candidates.length === 0) {
        return null;
    }

    const picked = ai.rng.choice(candidates);
    const minPop = ai.resolveGeneralAiStats(picked).fullLeadership * 100 + ai.aiConst.minAvailableRecruitPop;
    const destCityCandidates = selectUserRecruitmentRearCity(ai, minPop);
    if (Object.keys(destCityCandidates).length === 0) {
        return null;
    }

    const destCityId = Number(ai.rng.choiceUsingWeight(destCityCandidates));
    if (!Number.isFinite(destCityId)) {
        return null;
    }
    return buildAssignmentCandidate(ai, picked.id, destCityId, '유저장후방발령');
};

export const do유저장구출발령 = (ai: GeneralAI) => {
    if (!ai.nation || !ai.nation.capitalCityId) {
        return null;
    }
    const useFrontCities = [3, 4].includes(ai.dipState) && Object.keys(ai.frontCities).length > 2;
    const candidates = Object.values(ai.lostGenerals).flatMap((general) => {
        if (general.npcState >= 2) {
            return [];
        }
        const defenceTrain = readMetaNumber(asRecord(general.meta), 'defence_train', 80);
        if (
            general.crew >= ai.nationPolicy.minWarCrew &&
            general.train >= defenceTrain &&
            general.atmos >= defenceTrain
        ) {
            // A battle-ready user may be intentionally holding an isolated city.
            return [];
        }
        const troopLeader = general.troopId ? ai.troopLeaders[general.troopId] : undefined;
        if (troopLeader && ai.supplyCities[troopLeader.cityId] && isGeneralTurnBefore(troopLeader, general)) {
            // The mounted user can already escape with the leader's earlier turn.
            return [];
        }
        const destCityId = pickRandomCityId(ai, useFrontCities ? ai.frontCities : ai.supplyCities);
        return destCityId === null ? [] : [{ general, destCityId }];
    });
    if (candidates.length === 0) {
        return null;
    }
    // Ref consumes one city draw per eligible isolated user before choosing a
    // completed (user, city) pair.
    const picked = ai.rng.choice(candidates);
    return buildAssignmentCandidate(ai, picked.general.id, picked.destCityId, '유저장구출발령');
};

export const do유저장전방발령 = (ai: GeneralAI) => {
    if (!ai.nation || !ai.nation.capitalCityId) {
        return null;
    }
    if (Object.keys(ai.frontCities).length === 0) {
        return null;
    }
    if ([0, 1].includes(ai.dipState)) {
        return null;
    }

    const candidates = Object.values(ai.userWarGenerals).filter((general) => {
        if (general.id === ai.general.id) {
            return false;
        }
        if (ai.frontCities[general.cityId]) {
            return false;
        }
        if (!ai.nationCities[general.cityId]) {
            return false;
        }
        if (general.crew < ai.nationPolicy.minWarCrew) {
            return false;
        }
        if (general.troopId) {
            return false;
        }
        if (Math.max(general.train, general.atmos) < ai.nationPolicy.properWarTrainAtmos) {
            return false;
        }
        return true;
    });

    if (candidates.length === 0) {
        return null;
    }

    // Ref selects the prepared user before drawing the weighted front city.
    const destGeneral = ai.rng.choice(candidates);
    const destCityId = Number(ai.rng.choiceUsingWeight(pickFrontCityWeight(ai)));
    if (!Number.isFinite(destCityId)) {
        return null;
    }
    return buildAssignmentCandidate(ai, destGeneral.id, destCityId, '유저장전방발령');
};

export const do유저장내정발령 = (ai: GeneralAI) => {
    if (!ai.nation || !ai.nation.capitalCityId) {
        return null;
    }
    if (Object.keys(ai.supplyCities).length <= 1) {
        return null;
    }

    const supplyCities = Object.values(ai.supplyCities);
    const avgDev = supplyCities.reduce((sum, city) => sum + city.dev, 0) / supplyCities.length;
    if (avgDev >= 0.99) {
        return null;
    }

    const userGenerals = [0, 1].includes(ai.dipState)
        ? [...Object.values(ai.userWarGenerals), ...Object.values(ai.userCivilGenerals)]
        : Object.values(ai.userCivilGenerals);

    const generalCandidates = userGenerals.filter((general) => {
        if (general.troopId) {
            return false;
        }
        const city = ai.supplyCities[general.cityId];
        if (!city) {
            return false;
        }
        return city.dev >= 0.95;
    });

    if (generalCandidates.length === 0) {
        return null;
    }

    const cityCandidates: Record<number, number> = {};
    for (const city of supplyCities) {
        const dev = Math.min(city.dev, 0.999);
        const score = Math.pow(1 - dev, 2) / Math.sqrt((city.generals ? Object.keys(city.generals).length : 0) + 1);
        cityCandidates[city.id] = score;
    }

    const destGeneral = ai.rng.choice(generalCandidates);
    const srcCity = ai.supplyCities[destGeneral.cityId];
    const destCityId = Number(ai.rng.choiceUsingWeight(cityCandidates));
    if (!Number.isFinite(destCityId)) {
        return null;
    }
    if (srcCity && srcCity.dev <= (ai.supplyCities[destCityId]?.dev ?? 0)) {
        return null;
    }

    return buildAssignmentCandidate(ai, destGeneral.id, destCityId, '유저장내정발령');
};
