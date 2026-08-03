import { searchDistance, searchDistanceEntries } from '@sammo-ts/logic/world/distance.js';

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
        const affinity = ai.general.affinity ?? readMetaNumber(asRecord(ai.general.meta), 'affinity', 0);
        if (affinity === 999) {
            return null;
        }
        if (ai.world.currentYear < ai.startYear + 3) {
            // Ref queries the nation table, which has no synthetic neutral row.
            const nations = ai.worldRef.listNations().filter((nation) => nation.id > 0);
            const nationCount = nations.length;
            const notFullNationCount = nations.filter((nation) => {
                const count = ai.worldRef!.listGenerals().filter((general) => general.nationId === nation.id).length;
                return count < ai.commandEnv.initialNationGenLimit;
            }).length;
            if (nationCount === 0 || notFullNationCount === 0) {
                return null;
            }
            const rejectProbability = Math.pow(1 / (nationCount + 1) / Math.pow(notFullNationCount, 3), 1 / 4);
            if (ai.rng.nextBool(rejectProbability)) {
                return null;
            }
        } else if (ai.rng.nextBool()) {
            return null;
        }
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

    const picked = ai.buildGeneralCandidate(ai.rng.choice(candidates), {}, '중립');
    if (picked) {
        return picked;
    }
    const supply = ai.buildGeneralCandidate('che_물자조달', {}, '중립');
    if (supply) {
        return supply;
    }
    return ai.buildGeneralCandidate('che_견문', {}, '중립') ?? ai.buildGeneralCandidate(ACTION_REST, {}, '중립');
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
        // Ref joins through city and checks city.nation=0. A ruler of a newly
        // raised wandering nation therefore still occupies its neutral city.
        if (general.officerLevel === 12 && ai.worldRef.getCityById(general.cityId)?.nationId === 0) {
            occupied.add(general.cityId);
        }
    }

    let availableNearCity = false;
    const nearby = searchDistanceEntries(ai.map, ai.general.cityId, 3);
    for (const [cityId, dist] of nearby) {
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
    const generalMeta = asRecord(ai.general.meta);
    const ratio =
        (readMetaNumber(generalMeta, 'fullLeadership', ai.general.stats.leadership) +
            readMetaNumber(generalMeta, 'fullStrength', ai.general.stats.strength) +
            readMetaNumber(generalMeta, 'fullIntelligence', ai.general.stats.intelligence)) /
        3;
    if (prop >= ratio) {
        return null;
    }

    const initYear = readMetaNumber(asRecord(ai.world.meta), 'initYear', ai.startYear);
    const more = valueFit(3 - ai.world.currentYear + initYear, 1, 3);
    if (!ai.rng.nextBool(0.0075 * more)) {
        return null;
    }

    return ai.buildGeneralCandidate('che_거병', {}, '거병');
};

export const do건국 = (ai: GeneralAI) => {
    const nationType =
        ai.aiConst.availableNationTypes.length > 0
            ? (ai.rng.choice(ai.aiConst.availableNationTypes) as string)
            : 'che_도적';
    const colorType = ai.rng.nextRangeInt(0, 32);
    // Ref stores the NPC display prefix in general.name and removes it here.
    // Core's installed scenario rows keep the prefix in npcState instead.
    const characters = Array.from(ai.general.name);
    const nationName = `㉿${characters[0] === 'ⓝ' ? characters.slice(1).join('') : ai.general.name}`;

    const result = ai.buildGeneralCandidate('che_건국', { nationName, nationType, colorType }, '건국');
    if (result) {
        const nextMeta = { ...ai.general.meta };
        delete nextMeta.movingTargetCityID;
        ai.general.meta = nextMeta;
    }
    return result;
};

export const do해산 = (ai: GeneralAI) => {
    const result = ai.buildGeneralCandidate('che_해산', {}, '해산');
    if (result) {
        const nextMeta = { ...ai.general.meta };
        delete nextMeta.movingTargetCityID;
        ai.general.meta = nextMeta;
    }
    return result;
};

export const do선양 = (ai: GeneralAI) => {
    if (!ai.worldRef) {
        return null;
    }
    const candidates = ai.worldRef
        .listGenerals()
        .filter((general) => general.nationId === ai.general.nationId && general.npcState !== 5);
    if (candidates.length === 0) {
        return null;
    }
    return ai.buildGeneralCandidate('che_선양', { destGeneralID: ai.rng.choice(candidates).id }, '선양');
};

export const do방랑군이동 = (ai: GeneralAI) => {
    const city = ai.city;
    if (!city || !ai.map || !ai.worldRef) {
        return null;
    }
    const rulers = ai.worldRef.listGenerals().filter((general) => general.officerLevel === 12);
    if (rulers.filter((general) => general.cityId === city.id).length <= 1 && [5, 6].includes(city.level)) {
        return null;
    }
    const lordCities = rulers
        .filter((general) => ai.worldRef!.getCityById(general.cityId)?.nationId === 0)
        .map((general) => general.cityId);

    const occupied = new Set(
        ai.worldRef
            .listCities()
            .filter((candidate) => candidate.nationId !== 0)
            .map((candidate) => candidate.id)
    );
    for (const cityId of lordCities) {
        occupied.add(cityId);
    }

    let movingTargetCityId = readMetaNumber(asRecord(ai.general.meta), 'movingTargetCityID', 0) || null;
    if (movingTargetCityId === city.id || (movingTargetCityId !== null && occupied.has(movingTargetCityId))) {
        movingTargetCityId = null;
    }

    if (movingTargetCityId === null) {
        const nearby = searchDistanceEntries(ai.map, city.id, 4);
        const candidates: Array<[number, number]> = [];
        for (const [cityId, dist] of nearby) {
            if (occupied.has(cityId)) {
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
        movingTargetCityId = ai.rng.choiceUsingWeightPair(candidates);
        ai.general.meta = { ...ai.general.meta, movingTargetCityID: movingTargetCityId };
    }

    if (movingTargetCityId === city.id) {
        return ai.buildGeneralCandidate('che_인재탐색', {}, '방랑군이동');
    }

    const distanceMap = searchDistance(ai.map, movingTargetCityId, 99);
    const targetDistance = distanceMap[city.id];
    if (targetDistance === undefined) {
        return null;
    }
    const neighbors = ai.map.cities.find((candidate) => candidate.id === city.id)?.connections ?? [];
    const nextCandidates: Array<[number, number]> = [];
    for (const nextCityId of neighbors) {
        const nextCity = ai.worldRef.getCityById(nextCityId);
        if (nextCity && [5, 6].includes(nextCity.level) && !occupied.has(nextCityId)) {
            nextCandidates.push([nextCityId, 10]);
        }
        if (distanceMap[nextCityId] !== undefined && distanceMap[nextCityId] + 1 === targetDistance) {
            nextCandidates.push([nextCityId, 1]);
        }
    }
    if (nextCandidates.length === 0) {
        return null;
    }
    return ai.buildGeneralCandidate(
        'che_이동',
        { destCityId: ai.rng.choiceUsingWeightPair(nextCandidates) },
        '방랑군이동'
    );
};
