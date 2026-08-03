import type { GeneralAI } from '../core.js';
import { asRecord, readMetaNumber, readRequiredMetaNumber } from '../../aiUtils.js';
import { t통솔장 } from './helpers.js';

export const do후방워프 = (ai: GeneralAI) => {
    const city = ai.city;
    if (!city || !ai.nation || !ai.map) {
        return null;
    }
    if ([0, 1].includes(ai.dipState)) {
        return null;
    }
    if (!ai.generalPolicy.can('징병')) {
        return null;
    }
    if (!(ai.genType & t통솔장)) {
        return null;
    }
    if (ai.general.crew >= ai.nationPolicy.minWarCrew) {
        return null;
    }

    // Ref uses getLeadership(false): item/officer bonuses included, injury ignored.
    const fullLeadership = readMetaNumber(asRecord(ai.general.meta), 'fullLeadership', ai.general.stats.leadership);
    let minRecruitPop = fullLeadership * 100 + ai.aiConst.minAvailableRecruitPop;
    if (!ai.generalPolicy.can('한계징병')) {
        minRecruitPop = Math.max(
            minRecruitPop,
            fullLeadership * 100 + ai.nationPolicy.minNpcRecruitCityPopulation
        );
    }

    if (ai.generalPolicy.can('한계징병')) {
        if (city.population >= minRecruitPop) {
            return null;
        }
    } else if (
        city.population / city.populationMax >= ai.nationPolicy.safeRecruitCityPopulationRatio &&
        city.population >= ai.nationPolicy.minNpcRecruitCityPopulation &&
        city.population >= minRecruitPop
    ) {
        return null;
    }

    ai.categorizeNationCities();

    const recruitable: Record<number, number> = {};
    for (const candidate of Object.values(ai.backupCities)) {
        if (candidate.id === city.id) {
            continue;
        }
        if (candidate.population / candidate.populationMax < ai.nationPolicy.safeRecruitCityPopulationRatio) {
            continue;
        }
        if (candidate.population < ai.nationPolicy.minNpcRecruitCityPopulation) {
            continue;
        }
        if (candidate.population < minRecruitPop) {
            continue;
        }
        recruitable[candidate.id] = candidate.population / candidate.populationMax;
    }
    if (Object.keys(recruitable).length === 0) {
        for (const candidate of Object.values(ai.supplyCities)) {
            if (candidate.id === city.id) {
                continue;
            }
            if (candidate.population < ai.nationPolicy.minNpcRecruitCityPopulation) {
                continue;
            }
            if (candidate.population <= minRecruitPop) {
                continue;
            }
            if (candidate.population / candidate.populationMax < ai.nationPolicy.safeRecruitCityPopulationRatio) {
                continue;
            }
            recruitable[candidate.id] =
                candidate.frontState > 0
                    ? candidate.population / candidate.populationMax / 2
                    : candidate.population / candidate.populationMax;
        }
    }
    if (Object.keys(recruitable).length === 0) {
        return null;
    }

    if ((process.env.CORE_AI_TRACE_GENERAL_IDS?.split(',') ?? []).includes(String(ai.general.id))) {
        process.stdout.write(
            `AI_WARP_TRACE ${JSON.stringify({ generalId: ai.general.id, kind: 'rear', fullLeadership, minRecruitPop, recruitable })}\n`
        );
    }

    return ai.buildGeneralCandidate(
        'che_NPC능동',
        { optionText: '순간이동', destCityId: ai.rng.choiceUsingWeight(recruitable) },
        '후방워프'
    );
};

export const do전방워프 = (ai: GeneralAI) => {
    const city = ai.city;
    if (!city || !ai.nation || !ai.map) {
        return null;
    }
    if (!ai.attackable || [0, 1].includes(ai.dipState)) {
        return null;
    }
    if (!(ai.genType & t통솔장)) {
        return null;
    }
    if (ai.general.crew < ai.nationPolicy.minWarCrew) {
        return null;
    }
    if (city.frontState > 0) {
        return null;
    }

    ai.categorizeNationCities();
    ai.categorizeNationGeneral();
    const candidateCities: Record<number, number> = {};
    for (const frontCity of Object.values(ai.frontCities)) {
        if (frontCity.supplyState <= 0) {
            continue;
        }
        candidateCities[frontCity.id] = frontCity.important;
    }
    if (Object.keys(candidateCities).length === 0) {
        return null;
    }

    return ai.buildGeneralCandidate(
        'che_NPC능동',
        { optionText: '순간이동', destCityId: ai.rng.choiceUsingWeight(candidateCities) },
        '전방워프'
    );
};

export const do내정워프 = (ai: GeneralAI) => {
    const city = ai.city;
    if (!city || !ai.nation || !ai.map) {
        return null;
    }
    if (ai.genType & t통솔장 && [2, 3, 4].includes(ai.dipState)) {
        return null;
    }
    if (ai.rng.nextBool(0.6)) {
        return null;
    }

    const develRate = ai.calcCityDevelRate(city);
    let warpProp = 1;
    let availableTypeCnt = 0;
    for (const [key, [value, type]] of Object.entries(develRate)) {
        if (!(ai.genType & type)) {
            continue;
        }
        warpProp *= value;
        availableTypeCnt += 1;
        void key;
    }
    if (availableTypeCnt === 0) {
        return null;
    }
    if (!ai.rng.nextBool(warpProp)) {
        return null;
    }

    ai.categorizeNationCities();
    const candidateCities: Record<number, number> = {};
    for (const candidate of Object.values(ai.supplyCities)) {
        if (candidate.id === city.id) {
            continue;
        }
        let realDevelRate = 0.0001;
        for (const [_, [value, type]] of Object.entries(ai.calcCityDevelRate(candidate))) {
            if (!(ai.genType & type)) {
                continue;
            }
            realDevelRate += value;
        }
        realDevelRate /= availableTypeCnt;
        if (realDevelRate >= 0.95) {
            continue;
        }
        candidateCities[candidate.id] =
            1 / (realDevelRate * Math.sqrt((candidate.generals ? Object.keys(candidate.generals).length : 0) + 1));
    }
    if (Object.keys(candidateCities).length === 0) {
        return null;
    }

    return ai.buildGeneralCandidate(
        'che_NPC능동',
        { optionText: '순간이동', destCityId: ai.rng.choiceUsingWeight(candidateCities) },
        '내정워프'
    );
};

export const do귀환 = (ai: GeneralAI) => {
    const city = ai.city;
    if (!city) {
        return null;
    }
    if (city.nationId === ai.general.nationId && city.supplyState > 0) {
        return null;
    }
    return ai.buildGeneralCandidate('che_귀환', {}, '귀환');
};

export const do집합 = (ai: GeneralAI) => {
    if (ai.general.npcState === 5) {
        const killturn = readRequiredMetaNumber(asRecord(ai.general.meta), 'killturn', `generalId=${ai.general.id}`);
        const nextKillturn = ((killturn + ai.rng.nextRangeInt(2, 4)) % 5) + 70;
        ai.general.meta = { ...ai.general.meta, killturn: nextKillturn };
    }
    return ai.buildGeneralCandidate('che_집합', {}, '집합');
};
