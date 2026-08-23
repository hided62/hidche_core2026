import {
    findCrewTypeById,
    getCrewTypePickScore,
    getTechCost,
    isCrewTypeAvailable,
} from '@sammo-ts/logic/world/unitSet.js';
import { buildWarConfig } from '@sammo-ts/logic/actions/turn/actionContextHelpers.js';
import { CommandResolver as RecruitmentCommandResolver } from '@sammo-ts/logic/actions/turn/general/che_징병.js';
import type { CrewTypeDefinition, General, WarArmTypes } from '@sammo-ts/logic';

import type { GeneralAI } from '../core.js';
import { asRecord, readMetaNumber, roundTo } from '../../aiUtils.js';
import { t무장, t지장, t통솔장 } from './helpers.js';

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
    const traceEnabled = (process.env.CORE_AI_TRACE_GENERAL_IDS?.split(',') ?? []).includes(String(ai.general.id));
    const trace = (stage: string, values: Record<string, unknown> = {}) => {
        if (traceEnabled) {
            process.stdout.write(
                `AI_RECRUIT_TRACE ${JSON.stringify({ generalId: ai.general.id, stage, ...values })}\n`
            );
        }
    };
    const city = ai.city;
    const nation = ai.nation;
    if (!city || !nation || !ai.unitSet || !ai.map) {
        trace('missing-context');
        return null;
    }
    if ([0, 1].includes(ai.dipState)) {
        trace('diplomacy', { dipState: ai.dipState });
        return null;
    }
    if (!(ai.genType & t통솔장)) {
        trace('general-type', { genType: ai.genType });
        return null;
    }
    if (ai.general.crew >= ai.nationPolicy.minWarCrew) {
        trace('existing-crew', { crew: ai.general.crew, minWarCrew: ai.nationPolicy.minWarCrew });
        return null;
    }

    const generalMeta = asRecord(ai.general.meta);
    const recruitContext = {
        general: ai.general,
        nation,
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
        maxTechLevel: ai.commandEnv.maxTechLevel,
    };
    const recruitment = new RecruitmentCommandResolver(ai.commandEnv.generalActionModules ?? [], ai.commandEnv);
    // The cached AI stat follows the scenario/global classification cap, while
    // che_징병 resolves the actual command capacity from the general's current
    // stat and modules. NPC recruitment must request that same uncapped amount;
    // otherwise a 300-leadership general can be stuck at a 100/140/255 cap.
    const fullLeadership = recruitment.resolveFullLeadership(recruitContext);
    trace('population-policy', {
        population: city.population,
        populationMax: city.populationMax,
        safeRatio: ai.nationPolicy.safeRecruitCityPopulationRatio,
        minPopulation: ai.nationPolicy.minNpcRecruitCityPopulation,
        canLimitRecruit: ai.generalPolicy.can('한계징병'),
    });
    if (!ai.generalPolicy.can('한계징병')) {
        const remainPop = city.population - ai.nationPolicy.minNpcRecruitCityPopulation - fullLeadership * 100;
        if (remainPop <= 0) {
            trace('population-floor', { remainPop, fullLeadership });
            return null;
        }
        const maxPop = city.populationMax - ai.nationPolicy.minNpcRecruitCityPopulation;
        if (
            city.population / city.populationMax < ai.nationPolicy.safeRecruitCityPopulationRatio &&
            ai.rng.nextBool(remainPop / Math.max(1, maxPop))
        ) {
            trace('population-random', { remainPop, maxPop, fullLeadership });
            return null;
        }
    }

    const tech = readMetaNumber(asRecord(nation.meta), 'tech', 0);
    const crewAmountBase = fullLeadership * 100;
    const warConfig = buildWarConfig(ai.scenarioConfig, ai.unitSet);
    let forcedArmType = readMetaNumber(asRecord(ai.general.meta), 'armType', 0);
    if (
        (forcedArmType === warConfig.armTypes.wizard && !(ai.genType & t지장)) ||
        ([warConfig.armTypes.footman, warConfig.armTypes.archer, warConfig.armTypes.cavalry].includes(forcedArmType) &&
            !(ai.genType & t무장))
    ) {
        forcedArmType = 0;
    }
    const armTypeWeights = forcedArmType > 0 ? [] : buildRecruitArmTypeWeights(ai.general, warConfig.armTypes);
    let armTypeDraw: number | null = null;
    const armType =
        forcedArmType > 0
            ? forcedArmType
            : traceEnabled
              ? (() => {
                    armTypeDraw = ai.rng.nextFloat1();
                    let cursor = armTypeDraw * armTypeWeights.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
                    for (const [candidate, weight] of armTypeWeights) {
                        if (cursor <= weight) return candidate;
                        cursor -= Math.max(0, weight);
                    }
                    return armTypeWeights.at(-1)![0];
                })()
              : ai.rng.choiceUsingWeightPair(armTypeWeights);
    trace('arm-type', { forcedArmType, armType, armTypeDraw, armTypeWeights });

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
        trace('no-crew-type', { armType });
        return null;
    }
    let picked = ai.rng.choiceUsingWeightPair(
        candidates.map((crew) => [
            crew,
            getCrewTypePickScore(crew, tech, warConfig.armPerPhase, ai.commandEnv.maxTechLevel),
        ])
    );
    trace('crew-type', {
        armType,
        candidates: candidates.map((crew) => [
            crew.id,
            getCrewTypePickScore(crew, tech, warConfig.armPerPhase, ai.commandEnv.maxTechLevel),
        ]),
        picked: picked.id,
    });
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
    // Ref asks the concrete che_징병 command for getCost() before deciding
    // whether to halve the requested crew. In particular, that command caps
    // the charge at the actually refillable amount when the selected type is
    // already equipped, then applies traits/items and legacy rounding.
    const goldCost = recruitment.getCost(recruitContext, crewTypeId, crewAmount, picked).gold;
    const killCrew = readMetaNumber(generalMeta, 'rank_killcrew', readMetaNumber(generalMeta, 'killcrew', 0));
    const deathCrew = readMetaNumber(generalMeta, 'rank_deathcrew', readMetaNumber(generalMeta, 'deathcrew', 0));
    const expectedCrewLoss = Math.floor((crewAmount * killCrew * 1.2) / Math.max(deathCrew, 1));
    let riceCost = (picked.rice * getTechCost(tech, ai.commandEnv.maxTechLevel) * expectedCrewLoss) / 100;

    const remainingGold = ai.general.gold - fullLeadership * 3;
    const remainingRice = ai.general.rice - fullLeadership * 4;
    if (remainingGold <= 0 || remainingRice <= 0) {
        trace('reserve-floor', { remainingGold, remainingRice, fullLeadership });
        return null;
    }

    if (ai.generalPolicy.can('모병') && remainingGold >= goldCost * 6) {
        const hire = ai.buildGeneralCandidate('che_모병', { crewType: crewTypeId, amount: crewAmount }, '징병');
        if (hire) {
            return hire;
        }
    }

    if (remainingGold < goldCost && remainingGold * 2 >= goldCost) {
        crewAmount *= 0.5;
        riceCost *= 0.5;
        crewAmount = roundTo(crewAmount - 49, -2);
    }

    if (!ai.generalPolicy.can('한계징병') && remainingRice * 1.1 <= riceCost) {
        trace('rice-cost', { remainingGold, remainingRice, goldCost, riceCost, crewAmount, crewTypeId });
        return null;
    }

    const result = ai.buildGeneralCandidate('che_징병', { crewType: crewTypeId, amount: crewAmount }, '징병');
    trace(result ? 'selected' : 'constraint', {
        remainingGold,
        remainingRice,
        goldCost,
        riceCost,
        crewAmount,
        crewTypeId,
    });
    return result;
};
