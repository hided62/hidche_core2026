import type { GeneralAI } from '../core.js';
import { valueFit } from '../../aiUtils.js';
import { pickWeightedCandidate } from './helpers.js';

export const do전투준비 = (ai: GeneralAI) => {
    if ([0, 1].includes(ai.dipState)) {
        return null;
    }
    const cmdList: Array<[ReturnType<GeneralAI['buildGeneralCandidate']>, number]> = [];
    if (ai.general.train < ai.nationPolicy.properWarTrainAtmos) {
        cmdList.push([
            ai.buildGeneralCandidate('che_훈련', {}, '전투준비'),
            ai.commandEnv.maxTrainByCommand / valueFit(ai.general.train, 1),
        ]);
    }
    if (ai.general.atmos < ai.nationPolicy.properWarTrainAtmos) {
        cmdList.push([
            ai.buildGeneralCandidate('che_사기진작', {}, '전투준비'),
            ai.commandEnv.maxAtmosByCommand / valueFit(ai.general.atmos, 1),
        ]);
    }
    return pickWeightedCandidate(ai, cmdList);
};

export const do소집해제 = (ai: GeneralAI) => {
    if (ai.attackable) {
        return null;
    }
    if (ai.dipState !== 0) {
        return null;
    }
    if (ai.general.crew === 0) {
        return null;
    }
    if (ai.rng.nextBool(0.75)) {
        return null;
    }
    return ai.buildGeneralCandidate('che_소집해제', {}, '소집해제');
};

export const do출병 = (ai: GeneralAI) => {
    const city = ai.city;
    const nation = ai.nation;
    if (!city || !nation || !ai.map || !ai.worldRef) {
        return null;
    }
    if (!ai.attackable || ai.dipState !== 4) {
        return null;
    }
    if (nation.rice < ai.aiConst.baseRice && ai.general.npcState >= 2 && ai.rng.nextBool(0.7)) {
        return null;
    }
    if (ai.general.train < Math.min(100, ai.nationPolicy.properWarTrainAtmos)) {
        return null;
    }
    if (ai.general.atmos < Math.min(100, ai.nationPolicy.properWarTrainAtmos)) {
        return null;
    }
    if (ai.general.crew < Math.min((ai.general.stats.leadership - 2) * 100, ai.nationPolicy.minWarCrew)) {
        return null;
    }
    if (city.frontState <= 1) {
        return null;
    }

    const attackableNations = Object.entries(ai.warTargetNation)
        .filter(([, state]) => state !== 1)
        .map(([id]) => Number(id));
    if (attackableNations.length === 0) {
        attackableNations.push(0);
    }
    const neighbors = ai.map.cities.find((c) => c.id === city.id)?.connections ?? [];
    const attackableCities = neighbors.filter((cityId) => {
        const destCity = ai.worldRef?.getCityById(cityId);
        return destCity ? attackableNations.includes(destCity.nationId) : false;
    });
    if (attackableCities.length === 0) {
        return null;
    }
    return ai.buildGeneralCandidate('che_출병', { destCityId: ai.rng.choice(attackableCities) }, '출병');
};
