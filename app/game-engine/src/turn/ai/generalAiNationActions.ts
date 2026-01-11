import type { City } from '@sammo-ts/logic';

import type { GeneralAI } from './generalAi.js';
import { asRecord, calcCityDevRatio, joinYearMonth, parseYearMonth, readMetaNumber } from './aiUtils.js';
import { isNeighbor, searchAllDistanceByCityList } from './distance.js';

const pickWeightedCandidate = (ai: GeneralAI, list: Array<[ReturnType<GeneralAI['buildNationCandidate']>, number]>) => {
    const items = list.filter(([item]) => Boolean(item)) as Array<
        [ReturnType<GeneralAI['buildNationCandidate']>, number]
    >;
    if (items.length === 0) {
        return null;
    }
    const picked = ai.rng.choiceUsingWeightPair(items);
    return picked ?? null;
};

const pickRandomCityId = (ai: GeneralAI, cities: Record<number, City>): number | null => {
    const ids = Object.keys(cities).map((key) => Number(key));
    if (ids.length === 0) {
        return null;
    }
    return ai.rng.choice(ids);
};

const resolveCityPopRatio = (city: City): number => {
    if (city.populationMax <= 0) {
        return 0;
    }
    return city.population / city.populationMax;
};

const resolveLastAssignment = (general: GeneralAI['general'], yearMonth: number): boolean => {
    const last = readMetaNumber(asRecord(general.meta), 'last발령', 0);
    return last >= yearMonth;
};

const selectRecruitableCity = (ai: GeneralAI, minPop: number): Record<number, number> => {
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

const buildAssignmentCandidate = (ai: GeneralAI, destGeneralId: number, destCityId: number, reason: string) =>
    ai.buildNationCandidate('che_발령', { destGeneralId, destCityId }, reason);

const buildSeizureCandidate = (ai: GeneralAI, destGeneralId: number, amount: number, isGold: boolean, reason: string) =>
    ai.buildNationCandidate('che_몰수', { destGeneralID: destGeneralId, amount, isGold }, reason);

const buildAwardCandidate = (ai: GeneralAI, destGeneralId: number, amount: number, isGold: boolean, reason: string) =>
    ai.buildNationCandidate('che_포상', { destGeneralId, amount, isGold }, reason);

const resolveAwardAmount = (ai: GeneralAI, current: number, target: number): number | null => {
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

const resolveNationIncome = (ai: GeneralAI): number => {
    const cities = Object.values(ai.supplyCities);
    if (cities.length === 0) {
        return 0;
    }
    return cities.reduce((sum, city) => sum + city.population / 100 + city.agriculture / 100 + city.commerce / 100, 0);
};

const pickFrontCityWeight = (ai: GeneralAI): Record<number, number> => {
    const candidates: Record<number, number> = {};
    for (const city of Object.values(ai.frontCities)) {
        candidates[city.id] = city.important;
    }
    return candidates;
};

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

        let targetCityId: number | null = null;
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
        const reserved = ai.getReservedTurn(general.id);
        if (reserved.action !== 'che_징병') {
            return false;
        }
        return true;
    });

    if (candidates.length === 0) {
        return null;
    }

    const destCityCandidates = selectRecruitableCity(ai, ai.nationPolicy.minNpcRecruitCityPopulation);
    if (Object.keys(destCityCandidates).length === 0) {
        return null;
    }

    const destCityId = Number(ai.rng.choiceUsingWeight(destCityCandidates));
    if (!Number.isFinite(destCityId)) {
        return null;
    }
    const destGeneral = ai.rng.choice(candidates);
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
        return true;
    });

    if (candidates.length === 0) {
        return null;
    }

    const picked = ai.rng.choice(candidates);
    const minPop = picked.stats.leadership * 100 + ai.aiConst.minAvailableRecruitPop;
    const destCityCandidates = selectRecruitableCity(ai, minPop);
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
    const lostCandidates = Object.values(ai.lostGenerals).filter((general) => general.npcState < 2);
    if (lostCandidates.length === 0) {
        return null;
    }
    const destCityId = pickRandomCityId(ai, ai.frontCities) ?? pickRandomCityId(ai, ai.supplyCities);
    if (destCityId === null) {
        return null;
    }
    const destGeneral = ai.rng.choice(lostCandidates);
    return buildAssignmentCandidate(ai, destGeneral.id, destCityId, '유저장구출발령');
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
        return true;
    });

    if (candidates.length === 0) {
        return null;
    }

    const cityCandidates = pickFrontCityWeight(ai);
    const destCityId = Number(ai.rng.choiceUsingWeight(cityCandidates));
    if (!Number.isFinite(destCityId)) {
        return null;
    }
    const destGeneral = ai.rng.choice(candidates);
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

export const doNPC후방발령 = (ai: GeneralAI) => {
    if (!ai.nation || !ai.nation.capitalCityId) {
        return null;
    }
    if (Object.keys(ai.frontCities).length === 0) {
        return null;
    }
    if (ai.dipState !== 4) {
        return null;
    }

    const candidates = Object.values(ai.npcWarGenerals).filter((general) => {
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
        return true;
    });

    if (candidates.length === 0) {
        return null;
    }

    const picked = ai.rng.choice(candidates);
    const minPop = picked.stats.leadership * 100 + ai.aiConst.minAvailableRecruitPop;
    const destCityCandidates = selectRecruitableCity(ai, minPop);
    if (Object.keys(destCityCandidates).length === 0) {
        return null;
    }

    const destCityId = Number(ai.rng.choiceUsingWeight(destCityCandidates));
    if (!Number.isFinite(destCityId)) {
        return null;
    }
    return buildAssignmentCandidate(ai, picked.id, destCityId, 'NPC후방발령');
};

export const doNPC구출발령 = (ai: GeneralAI) => {
    if (!ai.nation || !ai.nation.capitalCityId) {
        return null;
    }
    const lostCandidates = Object.values(ai.lostGenerals).filter(
        (general) => general.npcState >= 2 && general.npcState !== 5
    );
    if (lostCandidates.length === 0) {
        return null;
    }
    const destCityId = pickRandomCityId(ai, ai.supplyCities);
    if (destCityId === null) {
        return null;
    }
    const destGeneral = ai.rng.choice(lostCandidates);
    return buildAssignmentCandidate(ai, destGeneral.id, destCityId, 'NPC구출발령');
};

export const doNPC전방발령 = (ai: GeneralAI) => {
    if (!ai.nation || !ai.nation.capitalCityId) {
        return null;
    }
    if (Object.keys(ai.frontCities).length === 0) {
        return null;
    }
    if ([0, 1].includes(ai.dipState)) {
        return null;
    }

    const candidates = Object.values(ai.npcWarGenerals).filter((general) => {
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

    const cityCandidates = pickFrontCityWeight(ai);
    const destCityId = Number(ai.rng.choiceUsingWeight(cityCandidates));
    if (!Number.isFinite(destCityId)) {
        return null;
    }
    const destGeneral = ai.rng.choice(candidates);
    return buildAssignmentCandidate(ai, destGeneral.id, destCityId, 'NPC전방발령');
};

export const doNPC내정발령 = (ai: GeneralAI) => {
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

    const npcGenerals = [0, 1].includes(ai.dipState)
        ? [...Object.values(ai.npcWarGenerals), ...Object.values(ai.npcCivilGenerals)]
        : Object.values(ai.npcCivilGenerals);

    const generalCandidates = npcGenerals.filter((general) => {
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

    return buildAssignmentCandidate(ai, destGeneral.id, destCityId, 'NPC내정발령');
};

export const do유저장긴급포상 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation) {
        return null;
    }
    const candidates: Array<[ReturnType<GeneralAI['buildNationCandidate']>, number]> = [];
    const resourceMap: Array<['gold' | 'rice', number]> = [
        ['gold', ai.nationPolicy.reqHumanWarUrgentGold],
        ['rice', ai.nationPolicy.reqHumanWarUrgentRice],
    ];

    for (const [resKey, required] of resourceMap) {
        if (nation[resKey] < ai.nationPolicy.reqNationGold && resKey === 'gold') {
            continue;
        }
        if (nation[resKey] < ai.nationPolicy.reqNationRice && resKey === 'rice') {
            continue;
        }
        for (const general of Object.values(ai.userWarGenerals)) {
            const amount = resolveAwardAmount(ai, general[resKey], required);
            if (!amount) {
                continue;
            }
            candidates.push([buildAwardCandidate(ai, general.id, amount, resKey === 'gold', '유저장긴급포상'), amount]);
        }
    }

    return pickWeightedCandidate(ai, candidates);
};

export const do유저장포상 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation) {
        return null;
    }
    const candidates: Array<[ReturnType<GeneralAI['buildNationCandidate']>, number]> = [];
    const resourceMap: Array<['gold' | 'rice', number]> = [
        ['gold', ai.nationPolicy.reqHumanWarRecommandGold],
        ['rice', ai.nationPolicy.reqHumanWarRecommandRice],
    ];

    for (const [resKey, required] of resourceMap) {
        if (nation[resKey] < ai.nationPolicy.reqNationGold && resKey === 'gold') {
            continue;
        }
        if (nation[resKey] < ai.nationPolicy.reqNationRice && resKey === 'rice') {
            continue;
        }
        for (const general of Object.values(ai.userWarGenerals)) {
            const amount = resolveAwardAmount(ai, general[resKey], required);
            if (!amount) {
                continue;
            }
            candidates.push([buildAwardCandidate(ai, general.id, amount, resKey === 'gold', '유저장포상'), amount]);
        }
    }

    return pickWeightedCandidate(ai, candidates);
};

export const doNPC긴급포상 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation) {
        return null;
    }
    const candidates: Array<[ReturnType<GeneralAI['buildNationCandidate']>, number]> = [];
    const resourceMap: Array<['gold' | 'rice', number]> = [
        ['gold', ai.nationPolicy.reqNpcWarGold / 2],
        ['rice', ai.nationPolicy.reqNpcWarRice / 2],
    ];

    for (const [resKey, required] of resourceMap) {
        if (nation[resKey] < ai.nationPolicy.reqNationGold && resKey === 'gold') {
            continue;
        }
        if (nation[resKey] < ai.nationPolicy.reqNationRice && resKey === 'rice') {
            continue;
        }
        for (const general of Object.values(ai.npcWarGenerals)) {
            const killturn = readMetaNumber(asRecord(general.meta), 'killturn', 999);
            if (killturn <= 5) {
                continue;
            }
            const amount = resolveAwardAmount(ai, general[resKey], required);
            if (!amount) {
                continue;
            }
            candidates.push([buildAwardCandidate(ai, general.id, amount, resKey === 'gold', 'NPC긴급포상'), amount]);
        }
    }

    return pickWeightedCandidate(ai, candidates);
};

export const doNPC포상 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation) {
        return null;
    }
    const candidates: Array<[ReturnType<GeneralAI['buildNationCandidate']>, number]> = [];
    const resourceMap: Array<['gold' | 'rice', number, number]> = [
        ['gold', ai.nationPolicy.reqNpcWarGold, ai.nationPolicy.reqNpcDevelGold],
        ['rice', ai.nationPolicy.reqNpcWarRice, ai.nationPolicy.reqNpcDevelRice],
    ];

    for (const [resKey, warReq, devReq] of resourceMap) {
        if (nation[resKey] < ai.nationPolicy.reqNationGold && resKey === 'gold') {
            continue;
        }
        if (nation[resKey] < ai.nationPolicy.reqNationRice && resKey === 'rice') {
            continue;
        }
        for (const general of Object.values(ai.npcWarGenerals)) {
            const killturn = readMetaNumber(asRecord(general.meta), 'killturn', 999);
            if (killturn <= 5) {
                continue;
            }
            const amount = resolveAwardAmount(ai, general[resKey], warReq);
            if (!amount) {
                continue;
            }
            candidates.push([buildAwardCandidate(ai, general.id, amount, resKey === 'gold', 'NPC포상'), amount]);
        }
        for (const general of Object.values(ai.npcCivilGenerals)) {
            const killturn = readMetaNumber(asRecord(general.meta), 'killturn', 999);
            if (killturn <= 5) {
                continue;
            }
            const amount = resolveAwardAmount(ai, general[resKey], devReq);
            if (!amount) {
                continue;
            }
            candidates.push([buildAwardCandidate(ai, general.id, amount, resKey === 'gold', 'NPC포상'), amount]);
        }
    }

    return pickWeightedCandidate(ai, candidates);
};

export const doNPC몰수 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation) {
        return null;
    }
    const candidates: Array<[ReturnType<GeneralAI['buildNationCandidate']>, number]> = [];
    const resourceMap: Array<['gold' | 'rice', number, number]> = [
        ['gold', ai.nationPolicy.reqNpcWarGold, ai.nationPolicy.reqNpcDevelGold],
        ['rice', ai.nationPolicy.reqNpcWarRice, ai.nationPolicy.reqNpcDevelRice],
    ];

    for (const [resKey, warReq, devReq] of resourceMap) {
        const nationLimit = resKey === 'gold' ? ai.nationPolicy.reqNationGold : ai.nationPolicy.reqNationRice;
        const nationEnough = nation[resKey] >= nationLimit;

        for (const general of Object.values(ai.npcCivilGenerals)) {
            if (general[resKey] <= devReq * 1.5) {
                continue;
            }
            const amount = Math.min(general[resKey] - devReq * 1.2, ai.maxResourceActionAmount);
            if (amount < ai.nationPolicy.minimumResourceActionAmount) {
                continue;
            }
            candidates.push([buildSeizureCandidate(ai, general.id, amount, resKey === 'gold', 'NPC몰수'), amount]);
        }

        if (!nationEnough) {
            for (const general of Object.values(ai.npcWarGenerals)) {
                const minRes = nation[resKey] < nationLimit * 0.5 ? warReq * 2 : warReq;
                if (general[resKey] <= minRes) {
                    continue;
                }
                const amount = Math.min(general[resKey] - minRes, ai.maxResourceActionAmount);
                if (amount < ai.nationPolicy.minimumResourceActionAmount) {
                    continue;
                }
                candidates.push([buildSeizureCandidate(ai, general.id, amount, resKey === 'gold', 'NPC몰수'), amount]);
            }
        }
    }

    return pickWeightedCandidate(ai, candidates);
};

export const do불가침제의 = (ai: GeneralAI) => {
    if (!ai.nation || ai.general.officerLevel < 12) {
        return null;
    }
    if (!ai.worldRef) {
        return null;
    }
    const meta = asRecord(ai.nation.meta);
    const recvAssist = Array.isArray(meta.recv_assist) ? meta.recv_assist : [];
    const respAssist = asRecord(meta.resp_assist);
    const respAssistTry = asRecord(meta.resp_assist_try);
    const yearMonth = joinYearMonth(ai.world.currentYear, ai.world.currentMonth);

    const candidateList: Record<number, number> = {};
    for (const entry of recvAssist) {
        if (!Array.isArray(entry) || entry.length < 2) {
            continue;
        }
        const destNationId = Number(entry[0]);
        const amount = Number(entry[1]);
        if (!Number.isFinite(destNationId) || !Number.isFinite(amount)) {
            continue;
        }
        const respEntry = asRecord(respAssist[`n${destNationId}`]);
        const respAmount = readMetaNumber(respEntry, '1', 0);
        const remain = amount - respAmount;
        if (remain <= 0) {
            continue;
        }
        if (ai.warTargetNation[destNationId]) {
            continue;
        }
        const lastTry = readMetaNumber(asRecord(respAssistTry[`n${destNationId}`]), '1', 0);
        if (lastTry >= yearMonth - 8) {
            continue;
        }
        candidateList[destNationId] = remain;
    }

    if (Object.keys(candidateList).length === 0) {
        return null;
    }

    const income = resolveNationIncome(ai);
    if (income <= 0) {
        return null;
    }

    const sorted = Object.entries(candidateList).sort((a, b) => b[1] - a[1]);
    let destNationId: number | null = null;
    let diplomatMonth = 0;
    for (const [idRaw, amount] of sorted) {
        if (amount * 4 < income) {
            break;
        }
        destNationId = Number(idRaw);
        diplomatMonth = (24 * amount) / income;
        break;
    }

    if (!destNationId) {
        return null;
    }

    const [targetYear, targetMonth] = parseYearMonth(Math.floor(yearMonth + diplomatMonth));
    return ai.buildNationCandidate(
        'che_불가침제의',
        { destNationId, year: targetYear, month: targetMonth },
        '불가침제의'
    );
};

export const do선전포고 = (ai: GeneralAI) => {
    if (!ai.nation || ai.general.officerLevel < 12) {
        return null;
    }
    if (ai.dipState !== 0) {
        return null;
    }
    if (ai.attackable) {
        return null;
    }
    if (!ai.nation.capitalCityId) {
        return null;
    }
    if (Object.keys(ai.frontCities).length > 0) {
        return null;
    }
    if (!ai.map || !ai.worldRef) {
        return null;
    }

    const avgResources = Object.values({
        ...ai.npcWarGenerals,
        ...ai.npcCivilGenerals,
        ...ai.userWarGenerals,
        ...ai.userCivilGenerals,
    });
    if (avgResources.length === 0) {
        return null;
    }

    let avgGold = ai.nation.gold;
    let avgRice = ai.nation.rice;
    for (const general of avgResources) {
        const scale = general.npcState < 2 ? 0.5 : 1;
        avgGold += general.gold * scale;
        avgRice += general.rice * scale;
    }
    avgGold /= avgResources.length;
    avgRice /= avgResources.length;

    const trialProp =
        avgGold / Math.max(ai.nationPolicy.reqNpcWarGold * 1.5, 2000) +
        avgRice / Math.max(ai.nationPolicy.reqNpcWarRice * 1.5, 2000);
    const devRate = ai.calcNationDevelopedRate();
    const chance = Math.pow((trialProp + (devRate.pop + devRate.all) / 2) / 4, 6);
    if (!ai.rng.nextBool(chance)) {
        return null;
    }

    const currentNationId = ai.nation.id;
    const cities = ai.worldRef.listCities();
    const neighbors = ai.worldRef.listNations().filter((nation) => {
        if (nation.id <= 0 || nation.id === currentNationId) {
            return false;
        }
        return isNeighbor(ai.map!, cities, currentNationId, nation.id, true);
    });
    if (neighbors.length === 0) {
        return null;
    }

    const weight: Record<number, number> = {};
    for (const nation of neighbors) {
        weight[nation.id] = 1 / Math.sqrt(nation.power + 1);
    }

    const destNationId = Number(ai.rng.choiceUsingWeight(weight));
    if (!Number.isFinite(destNationId)) {
        return null;
    }
    return ai.buildNationCandidate('che_선전포고', { destNationId }, '선전포고');
};

export const do천도 = (ai: GeneralAI) => {
    if (!ai.nation || !ai.nation.capitalCityId) {
        return null;
    }
    if (!ai.map) {
        return null;
    }
    const nationCities = Object.values(ai.nationCities);
    if (nationCities.length <= 1) {
        return null;
    }

    const cityIds = nationCities.map((city) => city.id);
    const distanceList = searchAllDistanceByCityList(ai.map, cityIds);
    const capitalId = ai.nation.capitalCityId;
    if (!distanceList[capitalId]) {
        return null;
    }

    let maxDistance = 0;
    for (const distances of Object.values(distanceList)) {
        const sum = Object.values(distances).reduce((acc, value) => acc + value, 0);
        maxDistance = Math.max(maxDistance, sum);
    }

    const cityScores: Record<number, number> = {};
    for (const city of nationCities) {
        const sumDistance = Object.values(distanceList[city.id] ?? {}).reduce((acc, value) => acc + value, 0);
        if (sumDistance <= 0) {
            continue;
        }
        const dev = calcCityDevRatio(city);
        cityScores[city.id] = city.population * (maxDistance / sumDistance) * Math.sqrt(dev);
    }

    const sorted = Object.entries(cityScores).sort((a, b) => b[1] - a[1]);
    const topLimit = Math.ceil(sorted.length * 0.25);
    for (let idx = 0; idx < Math.min(topLimit, sorted.length); idx += 1) {
        if (Number(sorted[idx][0]) === capitalId) {
            return null;
        }
    }

    const finalCityId = Number(sorted[0]?.[0]);
    if (!Number.isFinite(finalCityId)) {
        return null;
    }
    const dist = distanceList[capitalId]?.[finalCityId];
    if (dist === undefined) {
        return null;
    }
    let targetCityId = finalCityId;
    if (dist > 1) {
        const connections = ai.map.cities.find((city) => city.id === capitalId)?.connections ?? [];
        const candidates = connections.filter((stopId) => distanceList[stopId]?.[finalCityId] + 1 === dist);
        if (candidates.length > 0) {
            targetCityId = ai.rng.choice(candidates);
        }
    }

    return ai.buildNationCandidate('che_천도', { destCityId: targetCityId }, '천도');
};

export const nationActionHandlers: Record<
    string,
    (ai: GeneralAI) => ReturnType<GeneralAI['buildNationCandidate']> | null
> = {
    불가침제의: do불가침제의,
    선전포고: do선전포고,
    천도: do천도,
    유저장긴급포상: do유저장긴급포상,
    부대전방발령: do부대전방발령,
    유저장구출발령: do유저장구출발령,
    유저장후방발령: do유저장후방발령,
    부대유저장후방발령: do부대유저장후방발령,
    유저장전방발령: do유저장전방발령,
    유저장포상: do유저장포상,
    부대구출발령: do부대구출발령,
    부대후방발령: do부대후방발령,
    NPC긴급포상: doNPC긴급포상,
    NPC구출발령: doNPC구출발령,
    NPC후방발령: doNPC후방발령,
    NPC포상: doNPC포상,
    NPC전방발령: doNPC전방발령,
    유저장내정발령: do유저장내정발령,
    NPC내정발령: doNPC내정발령,
    NPC몰수: doNPC몰수,
};
