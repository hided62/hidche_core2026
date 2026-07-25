import type { GeneralAI } from '../core.js';
import { findCrewTypeById, getTechCost } from '@sammo-ts/logic/world/unitSet.js';
import type { TurnGeneral } from '../../../types.js';
import { asRecord, readMetaNumber, readRequiredMetaNumber } from '../../aiUtils.js';
import { buildAwardCandidate, buildSeizureCandidate, pickWeightedCandidate } from './helpers.js';

type ResourceName = 'gold' | 'rice';

const clampLegacy = (value: number, min: number | null, max: number | null): number => {
    if (min !== null && max !== null && max < min) {
        return min;
    }
    return Math.max(min ?? -Infinity, Math.min(max ?? Infinity, value));
};

const getFullLeadership = (general: TurnGeneral): number =>
    readMetaNumber(asRecord(general.meta), 'fullLeadership', general.stats.leadership);

const getCrewGoldCost = (ai: GeneralAI, general: TurnGeneral, multiplier: number): number => {
    const crewType = findCrewTypeById(ai.unitSet, general.crewTypeId ?? ai.commandEnv.defaultCrewTypeId);
    const tech = readMetaNumber(asRecord(ai.nation?.meta), 'tech', 0);
    return (crewType?.cost ?? 0) * getTechCost(tech) * getFullLeadership(general) * multiplier;
};

const sortedByResource = (generals: Record<number, TurnGeneral>, resource: ResourceName, descending = false) =>
    Object.values(generals).sort((lhs, rhs) =>
        descending ? rhs[resource] - lhs[resource] : lhs[resource] - rhs[resource]
    );

const canUseGeneral = (general: TurnGeneral): boolean =>
    readRequiredMetaNumber(asRecord(general.meta), 'killturn', `generalId=${general.id}`) > 5;

export const do유저장긴급포상 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation) {
        return null;
    }
    const candidates: Array<[ReturnType<GeneralAI['buildNationCandidate']>, number]> = [];
    const resourceMap: Array<[ResourceName, number]> = [
        ['gold', ai.nationPolicy.reqHumanWarUrgentGold],
        ['rice', ai.nationPolicy.reqHumanWarUrgentRice],
    ];

    for (const [resKey, minimum] of resourceMap) {
        const generals = sortedByResource(ai.userWarGenerals, resKey);
        for (const [index, general] of generals.entries()) {
            if (general[resKey] >= minimum) {
                break;
            }
            if (!canUseGeneral(general)) {
                continue;
            }
            let required = getCrewGoldCost(ai, general, 3 * 1.1);
            if (ai.world.currentYear > ai.startYear + 3) {
                required = Math.max(required, minimum);
            }
            const enough = required * 1.1;
            if (general[resKey] >= required) {
                continue;
            }
            let amount = Math.sqrt((enough - general[resKey]) * nation[resKey]);
            amount = clampLegacy(amount, null, enough - general[resKey]);
            if (amount < ai.nationPolicy.minimumResourceActionAmount || nation[resKey] < amount / 2) {
                continue;
            }
            amount = clampLegacy(amount, 100, ai.maxResourceActionAmount);
            candidates.push([
                buildAwardCandidate(ai, general.id, amount, resKey === 'gold', '유저장긴급포상'),
                generals.length - index,
            ]);
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
    const resourceMap: Array<[ResourceName, number, number, number]> = [
        [
            'gold',
            ai.nationPolicy.reqNationGold,
            ai.nationPolicy.reqHumanWarRecommandGold,
            ai.nationPolicy.reqHumanDevelGold,
        ],
        [
            'rice',
            ai.nationPolicy.reqNationRice,
            ai.nationPolicy.reqHumanWarRecommandRice,
            ai.nationPolicy.reqHumanDevelRice,
        ],
    ];

    for (const [resKey, nationMinimum, warMinimum, civilMinimum] of resourceMap) {
        if (nation[resKey] < nationMinimum) {
            continue;
        }
        const generals = sortedByResource(ai.userGenerals, resKey);
        for (const [index, general] of generals.entries()) {
            if (general[resKey] >= warMinimum) {
                break;
            }
            if (!canUseGeneral(general)) {
                continue;
            }
            let enough: number;
            if (ai.userWarGenerals[general.id]) {
                let required = getCrewGoldCost(ai, general, 6 * 1.1);
                if (ai.world.currentYear > ai.startYear + 3) {
                    required = Math.max(required, warMinimum);
                }
                enough = required * 1.2;
            } else {
                enough = civilMinimum * 1.2;
            }
            if (general[resKey] >= enough) {
                continue;
            }
            let amount = Math.sqrt((enough - general[resKey]) * nation[resKey]);
            amount = clampLegacy(amount, nation[resKey] - nationMinimum, enough - general[resKey]);
            if (amount < ai.nationPolicy.minimumResourceActionAmount || nation[resKey] < amount / 2) {
                continue;
            }
            amount = clampLegacy(amount, 100, ai.maxResourceActionAmount);
            candidates.push([
                buildAwardCandidate(ai, general.id, amount, resKey === 'gold', '유저장포상'),
                generals.length - index,
            ]);
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
    const resourceMap: Array<[ResourceName, number, number]> = [
        ['gold', ai.nationPolicy.reqNationGold, ai.nationPolicy.reqNpcWarGold / 2],
        ['rice', ai.nationPolicy.reqNationRice, ai.nationPolicy.reqNpcWarRice / 2],
    ];

    for (const [resKey, nationMinimum, minimum] of resourceMap) {
        if (nation[resKey] < nationMinimum) {
            continue;
        }
        const generals = sortedByResource(ai.npcWarGenerals, resKey);
        for (const [index, general] of generals.entries()) {
            if (general[resKey] >= minimum) {
                break;
            }
            if (!canUseGeneral(general)) {
                continue;
            }
            let required = getCrewGoldCost(ai, general, 1.5);
            if (ai.world.currentYear > ai.startYear + 5) {
                required = Math.max(required, minimum);
            }
            const enough = required * 1.2;
            if (general[resKey] >= required) {
                continue;
            }
            let amount = Math.sqrt((enough - general[resKey]) * nation[resKey]);
            amount = clampLegacy(amount, nation[resKey] - nationMinimum * 0.9, enough - general[resKey]);
            if (amount < ai.nationPolicy.minimumResourceActionAmount || nation[resKey] < amount / 2) {
                continue;
            }
            amount = clampLegacy(amount, 100, ai.maxResourceActionAmount);
            candidates.push([
                buildAwardCandidate(ai, general.id, amount, resKey === 'gold', 'NPC긴급포상'),
                generals.length - index,
            ]);
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
    const resourceMap: Array<[ResourceName, number, number, number]> = [
        ['gold', ai.nationPolicy.reqNationGold, ai.nationPolicy.reqNpcWarGold, ai.nationPolicy.reqNpcDevelGold],
        ['rice', ai.nationPolicy.reqNationRice, ai.nationPolicy.reqNpcWarRice, ai.nationPolicy.reqNpcDevelRice],
    ];

    for (const [resKey, nationMinimum, warMinimum, civilMinimum] of resourceMap) {
        if (nation[resKey] < nationMinimum) {
            continue;
        }
        const warGenerals = sortedByResource(ai.npcWarGenerals, resKey);
        const civilGenerals = sortedByResource(ai.npcCivilGenerals, resKey);
        const weightBase = Math.max(warGenerals.length, civilGenerals.length);
        for (const [index, general] of warGenerals.entries()) {
            if (general[resKey] >= warMinimum) {
                break;
            }
            if (!canUseGeneral(general)) {
                continue;
            }
            let required = getCrewGoldCost(ai, general, 3 * 1.1);
            if (ai.world.currentYear > ai.startYear + 5) {
                required = Math.max(required, warMinimum);
            }
            const enough = required * 1.5;
            if (general[resKey] >= required) {
                continue;
            }
            let amount = Math.sqrt((enough - general[resKey]) * nation[resKey]);
            amount = clampLegacy(amount, nation[resKey] - nationMinimum, enough - general[resKey]);
            if (nation[resKey] < amount / 2) {
                continue;
            }
            amount = clampLegacy(amount, 100, ai.maxResourceActionAmount);
            candidates.push([
                buildAwardCandidate(ai, general.id, amount, resKey === 'gold', 'NPC포상'),
                weightBase - index,
            ]);
        }
        for (const [index, general] of civilGenerals.entries()) {
            if (general[resKey] >= civilMinimum) {
                break;
            }
            if (!canUseGeneral(general)) {
                continue;
            }
            let amount = civilMinimum * 1.5 - general[resKey];
            if (amount < ai.nationPolicy.minimumResourceActionAmount) {
                continue;
            }
            amount = clampLegacy(amount, 100, ai.maxResourceActionAmount);
            candidates.push([
                buildAwardCandidate(ai, general.id, amount, resKey === 'gold', 'NPC포상'),
                weightBase - index,
            ]);
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
    const resourceMap: Array<[ResourceName, number, number, number]> = [
        ['gold', ai.nationPolicy.reqNationGold, ai.nationPolicy.reqNpcWarGold, ai.nationPolicy.reqNpcDevelGold],
        ['rice', ai.nationPolicy.reqNationRice, ai.nationPolicy.reqNpcWarRice, ai.nationPolicy.reqNpcDevelRice],
    ];

    for (const [resKey, nationMinimum, warMinimum, civilMinimum] of resourceMap) {
        for (const general of sortedByResource(ai.npcCivilGenerals, resKey, true)) {
            if (general[resKey] <= civilMinimum * 1.5) {
                break;
            }
            const amount = clampLegacy(general[resKey] - civilMinimum * 1.2, 100, ai.maxResourceActionAmount);
            if (amount < ai.nationPolicy.minimumResourceActionAmount) {
                break;
            }
            candidates.push([buildSeizureCandidate(ai, general.id, amount, resKey === 'gold', 'NPC몰수'), amount]);
        }

        const nationDelta = nationMinimum * 1.5 - nation[resKey];
        if (nationDelta < 0) {
            continue;
        }
        const takeSmallAmount = nation[resKey] >= nationMinimum;
        for (const general of sortedByResource(ai.npcWarGenerals, resKey, true)) {
            if (general[resKey] <= warMinimum * (takeSmallAmount ? 2 : 1)) {
                break;
            }
            let amount: number;
            if (takeSmallAmount) {
                const maxAmount = general[resKey] - warMinimum;
                const minAmount = general[resKey] - warMinimum * 2;
                amount = clampLegacy(Math.sqrt(minAmount * nationDelta), 0, maxAmount);
            } else {
                const maxAmount = general[resKey] - warMinimum;
                amount = clampLegacy(Math.sqrt(maxAmount * nationDelta), 0, maxAmount);
            }
            if (amount < 100 || amount < ai.nationPolicy.minimumResourceActionAmount) {
                break;
            }
            amount = clampLegacy(amount, 100, ai.maxResourceActionAmount);
            candidates.push([buildSeizureCandidate(ai, general.id, amount, resKey === 'gold', 'NPC몰수'), amount]);
        }
    }

    return pickWeightedCandidate(ai, candidates);
};
