import { searchDistance } from '@sammo-ts/logic/world/distance.js';

import type { GeneralAI } from '../core.js';
import { asRecord, readMetaNumber, valueFit } from '../../aiUtils.js';
import { ACTION_REST } from './helpers.js';

export const do국가선택 = (ai: GeneralAI) => {
    if (!ai.worldRef) {
        return null;
    }
    if (ai.general.npcState === 9) {
        const ruler = ai.worldRef
            .listGenerals()
            .find((general) => general.officerLevel === 12 && general.npcState === 9);
        if (ruler) {
            return ai.buildGeneralCandidate('che_임관', { destNationId: ruler.nationId }, '국가선택');
        }
    }

    if (ai.rng.nextBool(0.3)) {
        return ai.buildGeneralCandidate('che_랜덤임관', {}, '국가선택');
    }

    if (ai.rng.nextBool(0.2) && ai.map) {
        const neighbors = ai.map.cities.find((c) => c.id === ai.general.cityId)?.connections ?? [];
        if (neighbors.length === 0) {
            return null;
        }
        return ai.buildGeneralCandidate('che_이동', { destCityId: ai.rng.choice(neighbors) }, '국가선택');
    }

    return null;
};

export const do중립 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation || ai.general.nationId === 0) {
        const search = ai.buildGeneralCandidate('che_인재탐색', {}, '중립');
        if (search && !ai.rng.nextBool(0.8)) {
            return search;
        }
        return ai.buildGeneralCandidate('che_견문', {}, '중립');
    }

    let candidates = ['che_물자조달', 'che_인재탐색'];
    if (nation.gold < ai.nationPolicy.reqNationGold || nation.rice < ai.nationPolicy.reqNationRice) {
        candidates = ['che_물자조달'];
    }

    for (const key of candidates) {
        const cmd = ai.buildGeneralCandidate(key, {}, '중립');
        if (cmd) {
            return cmd;
        }
    }
    return ai.buildGeneralCandidate(ACTION_REST, {}, '중립');
};

export const do거병 = (ai: GeneralAI) => {
    if (readMetaNumber(asRecord(ai.general.meta), 'makelimit', 0)) {
        return null;
    }
    if (ai.general.npcState > 2) {
        return null;
    }
    if (!ai.generalPolicy.can('건국')) {
        return null;
    }
    const city = ai.city;
    if (!city || !ai.map || !ai.worldRef) {
        return null;
    }
    if ((city.level < 5 || 6 < city.level) && ai.rng.nextBool(0.5)) {
        return null;
    }

    const occupied = new Set(
        ai.worldRef
            .listCities()
            .filter((c) => c.nationId !== 0)
            .map((c) => c.id)
    );
    for (const general of ai.worldRef.listGenerals()) {
        if (general.officerLevel === 12 && general.nationId === 0) {
            occupied.add(general.cityId);
        }
    }

    let availableNearCity = false;
    const nearby = searchDistance(ai.map, ai.general.cityId, 3);
    for (const [targetCityId, dist] of Object.entries(nearby)) {
        const cityId = Number(targetCityId);
        if (!Number.isFinite(cityId)) {
            continue;
        }
        if (occupied.has(cityId)) {
            continue;
        }
        const target = ai.worldRef.getCityById(cityId);
        if (!target || target.level < 5 || target.level > 6) {
            continue;
        }
        if (dist === 3 && ai.rng.nextBool()) {
            continue;
        }
        availableNearCity = true;
        break;
    }
    if (!availableNearCity) {
        return null;
    }

    const prop = (ai.rng.nextFloat1() * (ai.aiConst.defaultStatNpcMax + ai.aiConst.chiefStatMin)) / 2;
    const ratio = (ai.general.stats.leadership + ai.general.stats.strength + ai.general.stats.intelligence) / 3;
    if (prop >= ratio) {
        return null;
    }

    const relYear = Math.max(0, ai.world.currentYear - ai.startYear);
    const more = valueFit(3 - relYear, 1, 3);
    if (!ai.rng.nextBool(0.0075 * more)) {
        return null;
    }

    return ai.buildGeneralCandidate('che_거병', {}, '거병');
};

export const do건국 = (ai: GeneralAI) => {
    const mapName = ai.scenarioConfig.environment.mapName ?? 'sammo';
    const prefix = mapName.endsWith('_') ? mapName : `${mapName}_`;
    const nationType =
        ai.aiConst.availableNationTypes.length > 0
            ? (ai.rng.choice(ai.aiConst.availableNationTypes) as string)
            : `${prefix}def`;
    const colorType = ai.rng.nextRangeInt(0, 34);
    const nationName = ai.general.name;

    return ai.buildGeneralCandidate('che_건국', { nationName, nationType, colorType }, '건국');
};

export const do방랑군이동 = (ai: GeneralAI) => {
    const city = ai.city;
    if (!city || !ai.map || !ai.worldRef) {
        return null;
    }
    const occupied = new Set(
        ai.worldRef
            .listCities()
            .filter((c) => c.nationId !== 0)
            .map((c) => c.id)
    );
    for (const general of ai.worldRef.listGenerals()) {
        if (general.officerLevel === 12 && general.nationId === 0) {
            occupied.add(general.cityId);
        }
    }

    const nearby = searchDistance(ai.map, city.id, 4);
    const candidates: Array<[number, number]> = [];
    for (const [cityIdRaw, dist] of Object.entries(nearby)) {
        const cityId = Number(cityIdRaw);
        if (!Number.isFinite(cityId) || occupied.has(cityId)) {
            continue;
        }
        const target = ai.worldRef.getCityById(cityId);
        if (!target || target.level < 5 || target.level > 6) {
            continue;
        }
        candidates.push([cityId, 1 / Math.pow(2, dist)]);
    }
    if (candidates.length === 0) {
        return null;
    }
    const destCityId = ai.rng.choiceUsingWeightPair(candidates);
    if (destCityId === city.id) {
        return ai.buildGeneralCandidate('che_인재탐색', {}, '방랑군이동');
    }
    return ai.buildGeneralCandidate('che_이동', { destCityId }, '방랑군이동');
};
