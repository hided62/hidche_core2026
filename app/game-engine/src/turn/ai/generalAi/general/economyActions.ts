import { findCrewTypeById, getTechCost } from '@sammo-ts/logic/world/unitSet.js';

import type { GeneralAI } from '../core.js';
import { asRecord, readMetaNumber, valueFit } from '../../aiUtils.js';

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
