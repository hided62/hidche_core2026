import type { GeneralAI } from '../core.js';
import { asRecord, readMetaNumber } from '../../aiUtils.js';
import { buildAwardCandidate, buildSeizureCandidate, pickWeightedCandidate, resolveAwardAmount } from './helpers.js';

export const do유저장긴급포상 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation) {
        return null;
    }
    const candidates: Array<[ReturnType<GeneralAI['buildNationCandidate']>, number]> = [];
    const resourceMap: Array<['gold' | 'rice', number]> = [
        ['gold', ai.nationPolicy.reqHumanWarUrgentGold],
        ['rice', ai.nationPolicy.reqHumanWarUrgentRice],
    ];

    for (const [resKey, required] of resourceMap) {
        if (nation[resKey] < ai.nationPolicy.reqNationGold && resKey === 'gold') {
            continue;
        }
        if (nation[resKey] < ai.nationPolicy.reqNationRice && resKey === 'rice') {
            continue;
        }
        for (const general of Object.values(ai.userWarGenerals)) {
            const amount = resolveAwardAmount(ai, general[resKey], required);
            if (!amount) {
                continue;
            }
            candidates.push([buildAwardCandidate(ai, general.id, amount, resKey === 'gold', '유저장긴급포상'), amount]);
        }
    }

    return pickWeightedCandidate(ai, candidates);
};

export const do유저장포상 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation) {
        return null;
    }
    const candidates: Array<[ReturnType<GeneralAI['buildNationCandidate']>, number]> = [];
    const resourceMap: Array<['gold' | 'rice', number]> = [
        ['gold', ai.nationPolicy.reqHumanWarRecommandGold],
        ['rice', ai.nationPolicy.reqHumanWarRecommandRice],
    ];

    for (const [resKey, required] of resourceMap) {
        if (nation[resKey] < ai.nationPolicy.reqNationGold && resKey === 'gold') {
            continue;
        }
        if (nation[resKey] < ai.nationPolicy.reqNationRice && resKey === 'rice') {
            continue;
        }
        for (const general of Object.values(ai.userWarGenerals)) {
            const amount = resolveAwardAmount(ai, general[resKey], required);
            if (!amount) {
                continue;
            }
            candidates.push([buildAwardCandidate(ai, general.id, amount, resKey === 'gold', '유저장포상'), amount]);
        }
    }

    return pickWeightedCandidate(ai, candidates);
};

export const doNPC긴급포상 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation) {
        return null;
    }
    const candidates: Array<[ReturnType<GeneralAI['buildNationCandidate']>, number]> = [];
    const resourceMap: Array<['gold' | 'rice', number]> = [
        ['gold', ai.nationPolicy.reqNpcWarGold / 2],
        ['rice', ai.nationPolicy.reqNpcWarRice / 2],
    ];

    for (const [resKey, required] of resourceMap) {
        if (nation[resKey] < ai.nationPolicy.reqNationGold && resKey === 'gold') {
            continue;
        }
        if (nation[resKey] < ai.nationPolicy.reqNationRice && resKey === 'rice') {
            continue;
        }
        for (const general of Object.values(ai.npcWarGenerals)) {
            const killturn = readMetaNumber(asRecord(general.meta), 'killturn', 999);
            if (killturn <= 5) {
                continue;
            }
            const amount = resolveAwardAmount(ai, general[resKey], required);
            if (!amount) {
                continue;
            }
            candidates.push([buildAwardCandidate(ai, general.id, amount, resKey === 'gold', 'NPC긴급포상'), amount]);
        }
    }

    return pickWeightedCandidate(ai, candidates);
};

export const doNPC포상 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation) {
        return null;
    }
    const candidates: Array<[ReturnType<GeneralAI['buildNationCandidate']>, number]> = [];
    const resourceMap: Array<['gold' | 'rice', number, number]> = [
        ['gold', ai.nationPolicy.reqNpcWarGold, ai.nationPolicy.reqNpcDevelGold],
        ['rice', ai.nationPolicy.reqNpcWarRice, ai.nationPolicy.reqNpcDevelRice],
    ];

    for (const [resKey, warReq, devReq] of resourceMap) {
        if (nation[resKey] < ai.nationPolicy.reqNationGold && resKey === 'gold') {
            continue;
        }
        if (nation[resKey] < ai.nationPolicy.reqNationRice && resKey === 'rice') {
            continue;
        }
        for (const general of Object.values(ai.npcWarGenerals)) {
            const killturn = readMetaNumber(asRecord(general.meta), 'killturn', 999);
            if (killturn <= 5) {
                continue;
            }
            const amount = resolveAwardAmount(ai, general[resKey], warReq);
            if (!amount) {
                continue;
            }
            candidates.push([buildAwardCandidate(ai, general.id, amount, resKey === 'gold', 'NPC포상'), amount]);
        }
        for (const general of Object.values(ai.npcCivilGenerals)) {
            const killturn = readMetaNumber(asRecord(general.meta), 'killturn', 999);
            if (killturn <= 5) {
                continue;
            }
            const amount = resolveAwardAmount(ai, general[resKey], devReq);
            if (!amount) {
                continue;
            }
            candidates.push([buildAwardCandidate(ai, general.id, amount, resKey === 'gold', 'NPC포상'), amount]);
        }
    }

    return pickWeightedCandidate(ai, candidates);
};

export const doNPC몰수 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation) {
        return null;
    }
    const candidates: Array<[ReturnType<GeneralAI['buildNationCandidate']>, number]> = [];
    const resourceMap: Array<['gold' | 'rice', number, number]> = [
        ['gold', ai.nationPolicy.reqNpcWarGold, ai.nationPolicy.reqNpcDevelGold],
        ['rice', ai.nationPolicy.reqNpcWarRice, ai.nationPolicy.reqNpcDevelRice],
    ];

    for (const [resKey, warReq, devReq] of resourceMap) {
        const nationLimit = resKey === 'gold' ? ai.nationPolicy.reqNationGold : ai.nationPolicy.reqNationRice;
        const nationEnough = nation[resKey] >= nationLimit;

        for (const general of Object.values(ai.npcCivilGenerals)) {
            if (general[resKey] <= devReq * 1.5) {
                continue;
            }
            const amount = Math.min(general[resKey] - devReq * 1.2, ai.maxResourceActionAmount);
            if (amount < ai.nationPolicy.minimumResourceActionAmount) {
                continue;
            }
            candidates.push([buildSeizureCandidate(ai, general.id, amount, resKey === 'gold', 'NPC몰수'), amount]);
        }

        if (!nationEnough) {
            for (const general of Object.values(ai.npcWarGenerals)) {
                const minRes = nation[resKey] < nationLimit * 0.5 ? warReq * 2 : warReq;
                if (general[resKey] <= minRes) {
                    continue;
                }
                const amount = Math.min(general[resKey] - minRes, ai.maxResourceActionAmount);
                if (amount < ai.nationPolicy.minimumResourceActionAmount) {
                    continue;
                }
                candidates.push([
                    buildSeizureCandidate(ai, general.id, amount, resKey === 'gold', 'NPC몰수'),
                    amount,
                ]);
            }
        }
    }

    return pickWeightedCandidate(ai, candidates);
};
