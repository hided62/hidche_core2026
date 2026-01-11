import type { City } from '@sammo-ts/logic';
import { findCrewTypeById, getTechCost, isCrewTypeAvailable } from '@sammo-ts/logic/world/unitSet.js';
import { searchDistance } from '@sammo-ts/logic/world/distance.js';

import type { GeneralAI } from './generalAi.js';
import { asRecord, readMetaNumber, roundTo, valueFit } from './aiUtils.js';

const ACTION_REST = '휴식';

const t무장 = 1;
const t지장 = 2;
const t통솔장 = 4;

const resolveCityTrust = (city: City): number => readMetaNumber(asRecord(city.meta), 'trust', 0);

const pickWeightedCandidate = (
    ai: GeneralAI,
    list: Array<[ReturnType<GeneralAI['buildGeneralCandidate']>, number]>
) => {
    const items = list.filter(([item]) => Boolean(item)) as Array<
        [ReturnType<GeneralAI['buildGeneralCandidate']>, number]
    >;
    if (items.length === 0) {
        return null;
    }
    const picked = ai.rng.choiceUsingWeightPair(items);
    return picked ?? null;
};

export const do일반내정 = (ai: GeneralAI) => {
    const city = ai.city;
    const nation = ai.nation;
    if (!city || !nation) {
        return null;
    }

    if (nation.rice < ai.aiConst.baseRice && ai.rng.nextBool(0.3)) {
        return null;
    }

    const develRate = ai.calcCityDevelRate(city);
    const isSpringSummer = ai.world.currentMonth <= 6;
    const cmdList: Array<[ReturnType<GeneralAI['buildGeneralCandidate']>, number]> = [];

    if (ai.genType & t통솔장) {
        if (develRate.trust[0] < 0.98) {
            cmdList.push([
                ai.buildGeneralCandidate('che_주민선정', {}, '일반내정'),
                (ai.general.stats.leadership / valueFit(develRate.trust[0] / 2 - 0.2, 0.001)) * 2,
            ]);
        }
        if (develRate.pop[0] < 0.8) {
            cmdList.push([
                ai.buildGeneralCandidate('che_정착장려', {}, '일반내정'),
                ai.general.stats.leadership / valueFit(develRate.pop[0], 0.001),
            ]);
        } else if (develRate.pop[0] < 0.99) {
            cmdList.push([
                ai.buildGeneralCandidate('che_정착장려', {}, '일반내정'),
                ai.general.stats.leadership / valueFit(develRate.pop[0] / 4, 0.001),
            ]);
        }
    }

    if (ai.genType & t무장) {
        if (develRate.def[0] < 1) {
            cmdList.push([
                ai.buildGeneralCandidate('che_수비강화', {}, '일반내정'),
                ai.general.stats.strength / valueFit(develRate.def[0], 0.001),
            ]);
        }
        if (develRate.wall[0] < 1) {
            cmdList.push([
                ai.buildGeneralCandidate('che_성벽보수', {}, '일반내정'),
                ai.general.stats.strength / valueFit(develRate.wall[0], 0.001),
            ]);
        }
        if (develRate.secu[0] < 0.9) {
            cmdList.push([
                ai.buildGeneralCandidate('che_치안강화', {}, '일반내정'),
                ai.general.stats.strength / valueFit(develRate.secu[0] / 0.8, 0.001, 1),
            ]);
        } else if (develRate.secu[0] < 1) {
            cmdList.push([
                ai.buildGeneralCandidate('che_치안강화', {}, '일반내정'),
                ai.general.stats.strength / 2 / valueFit(develRate.secu[0], 0.001),
            ]);
        }
    }

    if (ai.genType & t지장) {
        cmdList.push([ai.buildGeneralCandidate('che_기술연구', {}, '일반내정'), ai.general.stats.intelligence]);
        if (develRate.agri[0] < 1) {
            cmdList.push([
                ai.buildGeneralCandidate('che_농지개간', {}, '일반내정'),
                ((isSpringSummer ? 1.2 : 0.8) * ai.general.stats.intelligence) / valueFit(develRate.agri[0], 0.001, 1),
            ]);
        }
        if (develRate.comm[0] < 1) {
            cmdList.push([
                ai.buildGeneralCandidate('che_상업투자', {}, '일반내정'),
                ((isSpringSummer ? 0.8 : 1.2) * ai.general.stats.intelligence) / valueFit(develRate.comm[0], 0.001, 1),
            ]);
        }
    }

    return pickWeightedCandidate(ai, cmdList);
};

export const do긴급내정 = (ai: GeneralAI) => {
    const city = ai.city;
    if (!city) {
        return null;
    }
    if (ai.dipState === 0) {
        return null;
    }
    const trust = resolveCityTrust(city);
    if (trust < 70 && ai.rng.nextBool(ai.general.stats.leadership / ai.aiConst.chiefStatMin)) {
        return ai.buildGeneralCandidate('che_주민선정', {}, '긴급내정');
    }
    if (
        city.population < ai.nationPolicy.minNpcRecruitCityPopulation &&
        ai.rng.nextBool(ai.general.stats.leadership / ai.aiConst.chiefStatMin / 2)
    ) {
        return ai.buildGeneralCandidate('che_정착장려', {}, '긴급내정');
    }
    return null;
};

export const do전쟁내정 = (ai: GeneralAI) => {
    const city = ai.city;
    const nation = ai.nation;
    if (!city || !nation) {
        return null;
    }
    if (ai.dipState === 0) {
        return null;
    }
    if (nation.rice < ai.aiConst.baseRice && ai.rng.nextBool(0.3)) {
        return null;
    }
    if (ai.rng.nextBool(0.3)) {
        return null;
    }
    const develRate = ai.calcCityDevelRate(city);
    const isSpringSummer = ai.world.currentMonth <= 6;
    const cmdList: Array<[ReturnType<GeneralAI['buildGeneralCandidate']>, number]> = [];

    if (ai.genType & t통솔장) {
        if (develRate.trust[0] < 0.98) {
            cmdList.push([
                ai.buildGeneralCandidate('che_주민선정', {}, '전쟁내정'),
                (ai.general.stats.leadership / valueFit(develRate.trust[0] / 2 - 0.2, 0.001)) * 2,
            ]);
        }
        if (develRate.pop[0] < 0.8) {
            const weight =
                city.frontState > 0
                    ? ai.general.stats.leadership / valueFit(develRate.pop[0], 0.001)
                    : ai.general.stats.leadership / valueFit(develRate.pop[0], 0.001) / 2;
            cmdList.push([ai.buildGeneralCandidate('che_정착장려', {}, '전쟁내정'), weight]);
        }
    }

    if (ai.genType & t무장) {
        if (develRate.def[0] < 0.5) {
            cmdList.push([
                ai.buildGeneralCandidate('che_수비강화', {}, '전쟁내정'),
                ai.general.stats.strength / valueFit(develRate.def[0], 0.001) / 2,
            ]);
        }
        if (develRate.wall[0] < 0.5) {
            cmdList.push([
                ai.buildGeneralCandidate('che_성벽보수', {}, '전쟁내정'),
                ai.general.stats.strength / valueFit(develRate.wall[0], 0.001) / 2,
            ]);
        }
        if (develRate.secu[0] < 0.5) {
            cmdList.push([
                ai.buildGeneralCandidate('che_치안강화', {}, '전쟁내정'),
                ai.general.stats.strength / valueFit(develRate.secu[0] / 0.8, 0.001, 1) / 4,
            ]);
        }
    }

    if (ai.genType & t지장) {
        cmdList.push([ai.buildGeneralCandidate('che_기술연구', {}, '전쟁내정'), ai.general.stats.intelligence]);
        if (develRate.agri[0] < 0.5) {
            const weight =
                city.frontState > 0
                    ? ((isSpringSummer ? 1.2 : 0.8) * ai.general.stats.intelligence) /
                      4 /
                      valueFit(develRate.agri[0], 0.001, 1)
                    : ((isSpringSummer ? 1.2 : 0.8) * ai.general.stats.intelligence) /
                      2 /
                      valueFit(develRate.agri[0], 0.001, 1);
            cmdList.push([ai.buildGeneralCandidate('che_농지개간', {}, '전쟁내정'), weight]);
        }
        if (develRate.comm[0] < 0.5) {
            const weight =
                city.frontState > 0
                    ? ((isSpringSummer ? 0.8 : 1.2) * ai.general.stats.intelligence) /
                      4 /
                      valueFit(develRate.comm[0], 0.001, 1)
                    : ((isSpringSummer ? 0.8 : 1.2) * ai.general.stats.intelligence) /
                      2 /
                      valueFit(develRate.comm[0], 0.001, 1);
            cmdList.push([ai.buildGeneralCandidate('che_상업투자', {}, '전쟁내정'), weight]);
        }
    }

    return pickWeightedCandidate(ai, cmdList);
};

export const do금쌀구매 = (ai: GeneralAI) => {
    const city = ai.city;
    if (!city) {
        return null;
    }

    const trade = readMetaNumber(asRecord(city.meta), 'trade', 0);
    if (trade === 0 && !ai.generalPolicy.can('상인무시')) {
        return null;
    }

    const kill = readMetaNumber(asRecord(ai.general.meta), 'killcrew', 50000) + 50000;
    const death = readMetaNumber(asRecord(ai.general.meta), 'deathcrew', 50000) + 50000;
    const deathRate = death / kill;

    const absGold = ai.general.gold;
    const absRice = ai.general.rice;
    const relGold = absGold;
    const relRice = absRice * deathRate;

    const baseDevelCost = ai.commandEnv.develCost * 12;
    if (absGold + absRice < baseDevelCost * 2) {
        return null;
    }

    const crewType = findCrewTypeById(ai.unitSet, ai.general.crewTypeId ?? ai.commandEnv.defaultCrewTypeId);
    const tech = readMetaNumber(asRecord(ai.nation?.meta ?? {}), 'tech', 0);
    const fullLeadership = ai.general.stats.leadership;
    const crewAmount = fullLeadership * 100;
    const goldCost = crewType ? (crewType.cost * getTechCost(tech) * crewAmount) / 100 : 0;
    const riceCost = crewAmount / 100;

    if ((relGold + relRice) * 1.5 <= goldCost + riceCost) {
        return null;
    }

    if (ai.general.npcState < 2 && relGold >= goldCost * 3 && relRice >= riceCost * 3) {
        return null;
    }

    let tryBuying = false;
    if (ai.generalPolicy.can('상인무시')) {
        if (relRice * 1.5 < relGold && relRice < riceCost * 2) {
            tryBuying = true;
        } else if (relRice * 2 < relGold) {
            tryBuying = true;
        }
    } else if (relRice * 2 < relGold && relRice < riceCost * 3) {
        tryBuying = true;
    }

    if (tryBuying) {
        const amount = valueFit(Math.floor((relGold - relRice) / (1 + deathRate)), 100, ai.maxResourceActionAmount);
        if (amount >= ai.nationPolicy.minimumResourceActionAmount) {
            return ai.buildGeneralCandidate('che_군량매매', { buyRice: true, amount }, '금쌀구매');
        }
    }

    let trySelling = false;
    if (ai.generalPolicy.can('상인무시')) {
        if (relGold * 1.5 < relRice && relGold < goldCost * 2) {
            trySelling = true;
        } else if (relGold * 2 < relRice) {
            trySelling = true;
        }
    } else if (relGold * 2 < relRice && relGold < goldCost * 3) {
        trySelling = true;
    }

    if (trySelling) {
        const amount = valueFit(Math.floor((relRice - relGold) / (1 + deathRate)), 100, ai.maxResourceActionAmount);
        if (amount >= ai.nationPolicy.minimumResourceActionAmount) {
            return ai.buildGeneralCandidate('che_군량매매', { buyRice: false, amount }, '금쌀구매');
        }
    }

    return null;
};

export const do징병 = (ai: GeneralAI) => {
    const city = ai.city;
    const nation = ai.nation;
    if (!city || !nation || !ai.unitSet || !ai.map) {
        return null;
    }
    if ([0, 1].includes(ai.dipState)) {
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

export const doNPC헌납 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation) {
        return null;
    }
    const resourceMap: Array<['rice' | 'gold', number, number, number]> = [
        ['rice', ai.nationPolicy.reqNationRice, ai.nationPolicy.reqNpcWarRice, ai.nationPolicy.reqNpcDevelRice],
        ['gold', ai.nationPolicy.reqNationGold, ai.nationPolicy.reqNpcWarGold, ai.nationPolicy.reqNpcDevelGold],
    ];
    const args: Array<[Record<string, unknown>, number]> = [];

    for (const [resKey, reqNation, reqNpcWar, reqNpcDevel] of resourceMap) {
        const genRes = ai.general[resKey];
        let reqRes = reqNpcDevel;

        if (ai.genType & t통솔장) {
            reqRes = reqNpcWar;
        } else {
            if (genRes >= reqNpcWar && reqNpcWar > reqNpcDevel + 1000) {
                const amount = genRes - reqNpcDevel;
                args.push([{ isGold: resKey === 'gold', amount }, amount]);
                continue;
            }
            if (genRes >= reqNpcDevel * 5 && genRes >= 5000) {
                const amount = genRes - reqNpcDevel;
                args.push([{ isGold: resKey === 'gold', amount }, amount]);
                continue;
            }
        }

        if (nation[resKey] >= reqNation) {
            continue;
        }
        if (
            resKey === 'rice' &&
            nation[resKey] <= ai.aiConst.minNationalRice / 2 &&
            genRes >= ai.aiConst.minNationalRice / 2
        ) {
            const amount = genRes < ai.aiConst.minNationalRice ? genRes : genRes / 2;
            args.push([{ isGold: false, amount }, amount]);
        }
        if (genRes < reqRes * 1.5) {
            continue;
        }
        if (reqRes > 0 && !ai.rng.nextBool(genRes / reqRes - 0.5)) {
            continue;
        }
        const amount = genRes - reqRes;
        if (amount < ai.nationPolicy.minimumResourceActionAmount) {
            continue;
        }
        args.push([{ isGold: resKey === 'gold', amount }, amount]);
    }

    if (args.length === 0) {
        return null;
    }

    return ai.buildGeneralCandidate('che_헌납', ai.rng.choiceUsingWeightPair(args), 'NPC헌납');
};

export const do후방워프 = (ai: GeneralAI) => {
    const city = ai.city;
    if (!city || !ai.nation || !ai.map) {
        return null;
    }
    if ([0, 1].includes(ai.dipState)) {
        return null;
    }
    if (!(ai.genType & t통솔장)) {
        return null;
    }
    if (ai.general.crew >= ai.nationPolicy.minWarCrew) {
        return null;
    }

    let minRecruitPop = ai.general.stats.leadership * 100 + ai.aiConst.minAvailableRecruitPop;
    if (!ai.generalPolicy.can('한계징병')) {
        minRecruitPop = Math.max(
            minRecruitPop,
            ai.general.stats.leadership * 100 + ai.nationPolicy.minNpcRecruitCityPopulation
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
    ai.categorizeNationGeneral();
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

export const do집합 = (ai: GeneralAI) => ai.buildGeneralCandidate('che_집합', {}, '집합');

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
        const nations = ai.worldRef.listNations().filter((nation) => nation.id > 0);
        if (nations.length === 0) {
            return null;
        }
        const destNation = ai.rng.choice(nations);
        return ai.buildGeneralCandidate('che_임관', { destNationId: destNation.id }, '국가선택');
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

export const doNPC사망대비 = (ai: GeneralAI) => {
    const killturn = readMetaNumber(asRecord(ai.general.meta), 'killturn', 999);
    if (killturn > 5) {
        return null;
    }

    if (ai.general.nationId === 0) {
        const search = ai.buildGeneralCandidate('che_인재탐색', {}, 'NPC사망대비');
        if (search && !ai.rng.nextBool()) {
            return search;
        }
        return ai.buildGeneralCandidate('che_견문', {}, 'NPC사망대비');
    }

    if (ai.general.gold + ai.general.rice === 0) {
        return ai.buildGeneralCandidate('che_물자조달', {}, 'NPC사망대비');
    }

    if (ai.general.gold >= ai.general.rice) {
        return ai.buildGeneralCandidate(
            'che_헌납',
            { isGold: true, amount: ai.aiConst.maxResourceActionAmount },
            'NPC사망대비'
        );
    }
    return ai.buildGeneralCandidate(
        'che_헌납',
        { isGold: false, amount: ai.aiConst.maxResourceActionAmount },
        'NPC사망대비'
    );
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

export const generalActionHandlers: Record<
    string,
    (ai: GeneralAI) => ReturnType<GeneralAI['buildGeneralCandidate']> | null
> = {
    NPC사망대비: doNPC사망대비,
    귀환: do귀환,
    금쌀구매: do금쌀구매,
    출병: do출병,
    긴급내정: do긴급내정,
    전투준비: do전투준비,
    전방워프: do전방워프,
    NPC헌납: doNPC헌납,
    징병: do징병,
    후방워프: do후방워프,
    전쟁내정: do전쟁내정,
    소집해제: do소집해제,
    일반내정: do일반내정,
    내정워프: do내정워프,
    국가선택: do국가선택,
    중립: do중립,
    집합: do집합,
    거병: do거병,
    건국: do건국,
    방랑군이동: do방랑군이동,
};
