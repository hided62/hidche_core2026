import type { GeneralAI } from '../../core.js';
import { GeneralActionPipeline } from '@sammo-ts/logic/actionModules/general.js';
import { buildAssignmentCandidate, pickFrontCityWeight, pickRandomCityId, resolveCityPopRatio } from '../helpers.js';

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

    const actionPipeline = new GeneralActionPipeline(ai.commandEnv.generalActionModules ?? []);
    const actionContext = (general: GeneralAI['general']) => ({
        general,
        nation: ai.nation,
        ...(ai.worldRef
            ? {
                  worldView: {
                      listGenerals: () => ai.worldRef!.listGenerals(),
                      listGeneralsByCity: (cityId: number) =>
                          ai.worldRef!.listGenerals().filter((candidate) => candidate.cityId === cityId),
                      listNations: () => ai.worldRef!.listNations(),
                  },
              }
            : {}),
        time: {
            year: ai.world.currentYear,
            month: ai.world.currentMonth,
            startYear: ai.startYear,
        },
    });
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
        if (actionPipeline.onCalcDomestic(actionContext(general), '징집인구', 'score', 100) <= 1) {
            return false;
        }
        return true;
    });

    if (candidates.length === 0) {
        return null;
    }
    if (Object.keys(ai.supplyCities).length === 1) {
        return null;
    }

    const picked = ai.rng.choice(candidates);
    const fullLeadership = actionPipeline.onCalcStat(
        actionContext(picked),
        'leadership',
        picked.stats.leadership
    ) as number;
    const minPop = Math.max(
        fullLeadership * 100 + ai.aiConst.minAvailableRecruitPop,
        fullLeadership * 100 + ai.nationPolicy.minNpcRecruitCityPopulation
    );
    const destCityCandidates: Record<number, number> = {};
    for (const city of Object.values(ai.backupCities)) {
        const ratio = resolveCityPopRatio(city);
        if (
            city.id !== ai.city?.id &&
            city.population >= ai.nationPolicy.minNpcRecruitCityPopulation &&
            city.population >= minPop &&
            ratio >= ai.nationPolicy.safeRecruitCityPopulationRatio
        ) {
            destCityCandidates[city.id] = ratio;
        }
    }
    if (Object.keys(destCityCandidates).length === 0) {
        for (const city of Object.values(ai.supplyCities)) {
            const ratio = resolveCityPopRatio(city);
            if (
                city.id !== ai.city?.id &&
                city.population >= ai.nationPolicy.minNpcRecruitCityPopulation &&
                city.population > minPop &&
                ratio >= ai.nationPolicy.safeRecruitCityPopulationRatio
            ) {
                // Ref contains a non-assigning `pop_ratio / 2` expression for
                // front cities, so the persisted behavior keeps this weight.
                destCityCandidates[city.id] = ratio;
            }
        }
    }
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
    const candidates = lostCandidates.flatMap((general) => {
        const destCityId = pickRandomCityId(ai, ai.supplyCities);
        return destCityId === null ? [] : [{ general, destCityId }];
    });
    if (candidates.length === 0) {
        return null;
    }
    // Ref draws one destination city for every lost general, then chooses one
    // completed (general, city) pair. The unused pairs still consume RNG.
    const picked = ai.rng.choice(candidates);
    return buildAssignmentCandidate(ai, picked.general.id, picked.destCityId, 'NPC구출발령');
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

    // Ref consumes the general draw before the weighted front-city draw.
    // Reversing these two calls keeps the seed but assigns a different person.
    const destGeneral = ai.rng.choice(candidates);
    const cityCandidates = pickFrontCityWeight(ai);
    const destCityId = Number(ai.rng.choiceUsingWeight(cityCandidates));
    if (!Number.isFinite(destCityId)) {
        return null;
    }
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
