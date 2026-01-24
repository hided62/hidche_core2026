import type { GeneralAI } from '../core.js';
import { valueFit } from '../../aiUtils.js';
import { pickWeightedCandidate, resolveCityTrust, t무장, t지장, t통솔장 } from './helpers.js';

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
