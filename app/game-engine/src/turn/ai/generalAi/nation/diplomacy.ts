import type { GeneralAI } from '../core.js';
import { asRecord, joinYearMonth, parseYearMonth, readMetaNumber } from '../../aiUtils.js';
import { resolveDiplomacyMessageValidUntilTick } from '@sammo-ts/logic';
import { isNeighbor } from '@sammo-ts/logic/world/distance.js';
import { resolveNationIncome } from './helpers.js';

const LEGACY_RETRY_COOLDOWN_MONTHS = 8;

const readIndexedNumber = (value: unknown, index: number, fallback = 0): number => {
    const raw = Array.isArray(value) ? value[index] : asRecord(value)[String(index)];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
};

const isTechLimited = (ai: GeneralAI, tech: number): boolean => {
    const relativeYear = Math.max(0, ai.world.currentYear - ai.startYear);
    const levelIncreaseYears = ai.commandEnv.techLevelIncYear ?? 5;
    const initialAllowedLevel = ai.commandEnv.initialAllowedTechLevel ?? 1;
    const relativeMaxLevel = Math.max(
        1,
        Math.min(Math.floor(relativeYear / levelIncreaseYears) + initialAllowedLevel, ai.commandEnv.maxTechLevel)
    );
    const techLevel = Math.max(0, Math.min(Math.floor(tech / 1000), ai.commandEnv.maxTechLevel));
    return techLevel >= relativeMaxLevel;
};

export const do불가침제의 = (ai: GeneralAI) => {
    if (!ai.nation || ai.general.officerLevel < 12) {
        return null;
    }
    if (!ai.worldRef) {
        return null;
    }
    const meta = asRecord(ai.nation.meta);
    const recvAssist = Array.isArray(meta.recv_assist) ? meta.recv_assist : Object.values(asRecord(meta.recv_assist));
    const respAssist = asRecord(meta.resp_assist);
    const respAssistTry = asRecord(meta.resp_assist_try);
    const respAssistDeclined = asRecord(meta.resp_assist_declined);
    const yearMonth = joinYearMonth(ai.world.currentYear, ai.world.currentMonth);
    const currentTurnTick = ai.general.turnTick;

    const candidateList: Record<number, number> = {};
    for (const entry of recvAssist) {
        const entryRecord = asRecord(entry);
        const destNationId = Number(Array.isArray(entry) ? entry[0] : entryRecord['0']);
        const amount = Number(Array.isArray(entry) ? entry[1] : entryRecord['1']);
        if (!Number.isFinite(destNationId) || !Number.isFinite(amount)) {
            continue;
        }
        const respEntry = respAssist[`n${destNationId}`];
        const respAmount = readIndexedNumber(respEntry, 1);
        const remain = amount - respAmount;
        if (remain <= 0) {
            continue;
        }
        if (ai.warTargetNation[destNationId]) {
            continue;
        }
        const assistKey = `n${destNationId}`;
        if (Object.prototype.hasOwnProperty.call(respAssistDeclined, assistKey)) {
            continue;
        }
        const lastTryEntry = respAssistTry[assistKey];
        const proposalValidUntilTick = readIndexedNumber(lastTryEntry, 2);
        if (typeof currentTurnTick === 'number' && Number.isFinite(currentTurnTick) && proposalValidUntilTick > 0) {
            if (currentTurnTick < proposalValidUntilTick) {
                continue;
            }
        } else {
            const lastTry = readIndexedNumber(lastTryEntry, 1);
            if (lastTry >= yearMonth - LEGACY_RETRY_COOLDOWN_MONTHS) {
                continue;
            }
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
    const result = ai.buildNationCandidate(
        'che_불가침제의',
        { destNationId, year: targetYear, month: targetMonth },
        '불가침제의'
    );
    if (result) {
        const validUntilTick =
            typeof currentTurnTick === 'number'
                ? resolveDiplomacyMessageValidUntilTick(currentTurnTick, ai.world.tickSeconds)
                : null;
        const nextTry = {
            ...respAssistTry,
            [`n${destNationId}`]: [destNationId, yearMonth, ...(validUntilTick === null ? [] : [validUntilTick])],
        };
        ai.patchPersistentNationMeta({ resp_assist_try: nextTry });
    }
    return result;
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
    const currentTech = readMetaNumber(asRecord(ai.nation.meta), 'tech', 0);
    if (!isTechLimited(ai, currentTech + 1000)) {
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

    const lowTargetNations = new Set(
        ai.worldRef
            .listDiplomacy()
            .filter((entry) => entry.fromNationId !== currentNationId && (entry.state === 0 || entry.state === 1))
            .map((entry) => entry.fromNationId)
    );
    const weight: Record<number, number> = {};
    const warWeight: Record<number, number> = {};
    for (const nation of neighbors) {
        const target = lowTargetNations.has(nation.id) ? warWeight : weight;
        target[nation.id] = 1 / Math.sqrt(nation.power + 1);
    }
    if (Object.keys(weight).length === 0) {
        if (Object.keys(warWeight).length === 0 || lowTargetNations.size === 0) {
            return null;
        }
        if (ai.rng.nextBool(1 / lowTargetNations.size)) {
            return null;
        }
        Object.assign(weight, warWeight);
    }

    const destNationId = Number(ai.rng.choiceUsingWeight(weight));
    if (!Number.isFinite(destNationId)) {
        return null;
    }
    return ai.buildNationCandidate('che_선전포고', { destNationId }, '선전포고');
};
