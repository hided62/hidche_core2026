import { getTechCost, isCrewTypeAvailable } from '@sammo-ts/logic/world/unitSet.js';

import type { GeneralAI } from '../core.js';
import { asRecord, readMetaNumber, roundTo } from '../../aiUtils.js';
import { t통솔장 } from './helpers.js';

export const do징병 = (ai: GeneralAI) => {
    const city = ai.city;
    const nation = ai.nation;
    if (!city || !nation || !ai.unitSet || !ai.map) {
        return null;
    }
    if ([0, 1].includes(ai.dipState) && ai.general.npcState < 2) {
        return null;
    }
    if (!(ai.genType & t통솔장)) {
        return null;
    }
    if (ai.general.crew >= ai.nationPolicy.minWarCrew) {
        return null;
    }

    if (!ai.generalPolicy.can('한계징병')) {
        const remainPop =
            city.population - ai.nationPolicy.minNpcRecruitCityPopulation - ai.general.stats.leadership * 100;
        if (remainPop <= 0) {
            return null;
        }
        const maxPop = city.populationMax - ai.nationPolicy.minNpcRecruitCityPopulation;
        if (
            city.population / city.populationMax < ai.nationPolicy.safeRecruitCityPopulationRatio &&
            ai.rng.nextBool(remainPop / Math.max(1, maxPop))
        ) {
            return null;
        }
    }

    const tech = readMetaNumber(asRecord(nation.meta), 'tech', 0);
    const crewAmountBase = ai.general.stats.leadership * 100;
    const armType =
        readMetaNumber(asRecord(ai.general.meta), 'armType', 0) ||
        (ai.general.stats.strength >= ai.general.stats.intelligence * 0.9 ? 1 : 4);

    const candidates = (ai.unitSet?.crewTypes ?? [])
        .filter((crew) => crew.armType === armType)
        .filter((crew) =>
            isCrewTypeAvailable(ai.unitSet!, crew.id, {
                general: ai.general,
                nation,
                map: ai.map!,
                cities: ai.worldRef?.listCities() ?? [],
                currentYear: ai.world.currentYear,
                startYear: ai.startYear,
            })
        );
    if (candidates.length === 0) {
        return null;
    }
    const picked = ai.rng.choiceUsingWeightPair(candidates.map((crew) => [crew, Math.max(1, crew.cost)]));
    const crewTypeId = picked.id;

    let crewAmount = crewAmountBase;
    const goldCost = (picked.cost * getTechCost(tech) * crewAmount) / 100;
    const riceCost = crewAmount / 100;

    if (ai.general.gold <= 0 || ai.general.rice <= 0) {
        return null;
    }

    if (ai.generalPolicy.can('모병') && ai.general.gold >= goldCost * 6) {
        const hire = ai.buildGeneralCandidate('che_모병', { crewType: crewTypeId, amount: crewAmount }, '징병');
        if (hire) {
            return hire;
        }
    }

    if (ai.general.gold < goldCost && ai.general.gold * 2 >= goldCost) {
        crewAmount *= 0.5;
        crewAmount = roundTo(crewAmount - 49, -2);
    }

    if (!ai.generalPolicy.can('한계징병') && ai.general.rice * 1.1 <= riceCost) {
        return null;
    }

    return ai.buildGeneralCandidate('che_징병', { crewType: crewTypeId, amount: crewAmount }, '징병');
};
