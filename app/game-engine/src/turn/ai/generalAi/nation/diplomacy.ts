import type { GeneralAI } from '../core.js';
import { asRecord, joinYearMonth, parseYearMonth, readMetaNumber } from '../../aiUtils.js';
import { isNeighbor } from '../../distance.js';
import { resolveNationIncome } from './helpers.js';

export const do불가침제의 = (ai: GeneralAI) => {
    if (!ai.nation || ai.general.officerLevel < 12) {
        return null;
    }
    if (!ai.worldRef) {
        return null;
    }
    const meta = asRecord(ai.nation.meta);
    const recvAssist = Array.isArray(meta.recv_assist) ? meta.recv_assist : [];
    const respAssist = asRecord(meta.resp_assist);
    const respAssistTry = asRecord(meta.resp_assist_try);
    const yearMonth = joinYearMonth(ai.world.currentYear, ai.world.currentMonth);

    const candidateList: Record<number, number> = {};
    for (const entry of recvAssist) {
        if (!Array.isArray(entry) || entry.length < 2) {
            continue;
        }
        const destNationId = Number(entry[0]);
        const amount = Number(entry[1]);
        if (!Number.isFinite(destNationId) || !Number.isFinite(amount)) {
            continue;
        }
        const respEntry = asRecord(respAssist[`n${destNationId}`]);
        const respAmount = readMetaNumber(respEntry, '1', 0);
        const remain = amount - respAmount;
        if (remain <= 0) {
            continue;
        }
        if (ai.warTargetNation[destNationId]) {
            continue;
        }
        const lastTry = readMetaNumber(asRecord(respAssistTry[`n${destNationId}`]), '1', 0);
        if (lastTry >= yearMonth - 8) {
            continue;
        }
        candidateList[destNationId] = remain;
    }

    if (Object.keys(candidateList).length === 0) {
        return null;
    }

    const income = resolveNationIncome(ai);
    if (income <= 0) {
        return null;
    }

    const sorted = Object.entries(candidateList).sort((a, b) => b[1] - a[1]);
    let destNationId: number | null = null;
    let diplomatMonth = 0;
    for (const [idRaw, amount] of sorted) {
        if (amount * 4 < income) {
            break;
        }
        destNationId = Number(idRaw);
        diplomatMonth = (24 * amount) / income;
        break;
    }

    if (!destNationId) {
        return null;
    }

    const [targetYear, targetMonth] = parseYearMonth(Math.floor(yearMonth + diplomatMonth));
    return ai.buildNationCandidate(
        'che_불가침제의',
        { destNationId, year: targetYear, month: targetMonth },
        '불가침제의'
    );
};

export const do선전포고 = (ai: GeneralAI) => {
    if (!ai.nation || ai.general.officerLevel < 12) {
        return null;
    }
    if (ai.dipState !== 0) {
        return null;
    }
    if (ai.attackable) {
        return null;
    }
    if (!ai.nation.capitalCityId) {
        return null;
    }
    if (Object.keys(ai.frontCities).length > 0) {
        return null;
    }
    if (!ai.map || !ai.worldRef) {
        return null;
    }

    const avgResources = Object.values({
        ...ai.npcWarGenerals,
        ...ai.npcCivilGenerals,
        ...ai.userWarGenerals,
        ...ai.userCivilGenerals,
    });
    if (avgResources.length === 0) {
        return null;
    }

    let avgGold = ai.nation.gold;
    let avgRice = ai.nation.rice;
    for (const general of avgResources) {
        const scale = general.npcState < 2 ? 0.5 : 1;
        avgGold += general.gold * scale;
        avgRice += general.rice * scale;
    }
    avgGold /= avgResources.length;
    avgRice /= avgResources.length;

    const trialProp =
        avgGold / Math.max(ai.nationPolicy.reqNpcWarGold * 1.5, 2000) +
        avgRice / Math.max(ai.nationPolicy.reqNpcWarRice * 1.5, 2000);
    const devRate = ai.calcNationDevelopedRate();
    const chance = Math.pow((trialProp + (devRate.pop + devRate.all) / 2) / 4, 6);
    if (!ai.rng.nextBool(chance)) {
        return null;
    }

    const currentNationId = ai.nation.id;
    const cities = ai.worldRef.listCities();
    const neighbors = ai.worldRef.listNations().filter((nation) => {
        if (nation.id <= 0 || nation.id === currentNationId) {
            return false;
        }
        return isNeighbor(ai.map!, cities, currentNationId, nation.id, true);
    });
    if (neighbors.length === 0) {
        return null;
    }

    const weight: Record<number, number> = {};
    for (const nation of neighbors) {
        weight[nation.id] = 1 / Math.sqrt(nation.power + 1);
    }

    const destNationId = Number(ai.rng.choiceUsingWeight(weight));
    if (!Number.isFinite(destNationId)) {
        return null;
    }
    return ai.buildNationCandidate('che_선전포고', { destNationId }, '선전포고');
};
