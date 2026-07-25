import {
    findCrewTypeById,
    getCrewTypePickScore,
    getTechCost,
    isCrewTypeAvailable,
} from '@sammo-ts/logic/world/unitSet.js';
import { buildWarConfig } from '@sammo-ts/logic/actions/turn/actionContextHelpers.js';
import type { CrewTypeDefinition, General, WarArmTypes } from '@sammo-ts/logic';

import type { GeneralAI } from '../core.js';
import { asRecord, readMetaNumber, roundTo } from '../../aiUtils.js';
import { t통솔장 } from './helpers.js';

export const buildRecruitArmTypeWeights = (general: General, armTypes: WarArmTypes): Array<[number, number]> => {
    const meta = asRecord(general.meta);
    const fullStrength = readMetaNumber(meta, 'fullStrength', general.stats.strength);
    const fullIntelligence = readMetaNumber(meta, 'fullIntelligence', general.stats.intelligence);
    const weights: Array<[number, number]> = [];

    if (fullStrength > fullIntelligence * 0.9) {
        for (const armType of [armTypes.footman, armTypes.archer, armTypes.cavalry]) {
            if (armType === undefined) {
                continue;
            }
            weights.push([armType, Math.sqrt(readMetaNumber(meta, `dex${armType}`, 0) + 500) * fullStrength]);
        }
    }
    if (fullIntelligence > fullStrength * 0.9 && armTypes.wizard !== undefined) {
        weights.push([
            armTypes.wizard,
            Math.sqrt(readMetaNumber(meta, `dex${armTypes.wizard}`, 0) + 500) * fullIntelligence * 3,
        ]);
    }
    return weights;
};

const getRequiredTech = (crewType: CrewTypeDefinition): number | null => {
    const requirement = crewType.requirements.find((entry) => entry.type === 'ReqTech');
    return requirement?.type === 'ReqTech' && typeof requirement.tech === 'number' ? requirement.tech : null;
};

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
    const warConfig = buildWarConfig(ai.scenarioConfig, ai.unitSet);
    const forcedArmType = readMetaNumber(asRecord(ai.general.meta), 'armType', 0);
    const armType =
        forcedArmType > 0
            ? forcedArmType
            : ai.rng.choiceUsingWeightPair(buildRecruitArmTypeWeights(ai.general, warConfig.armTypes));

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
    let picked = ai.rng.choiceUsingWeightPair(
        candidates.map((crew) => [crew, getCrewTypePickScore(crew, tech, warConfig.armPerPhase)])
    );
    if (ai.generalPolicy.can('고급병종')) {
        const currentCrewType = findCrewTypeById(ai.unitSet, ai.general.crewTypeId);
        if (
            currentCrewType &&
            isCrewTypeAvailable(ai.unitSet, currentCrewType.id, {
                general: ai.general,
                nation,
                map: ai.map,
                cities: ai.worldRef?.listCities() ?? [],
                currentYear: ai.world.currentYear,
                startYear: ai.startYear,
            })
        ) {
            const requiredTech = getRequiredTech(currentCrewType);
            if (
                requiredTech !== null &&
                (requiredTech >= 2000 || (currentCrewType.armType !== armType && requiredTech >= 1000))
            ) {
                picked = currentCrewType;
            }
        }
    }
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
