import type { GeneralAI } from '../core.js';
import { GeneralActionPipeline } from '@sammo-ts/logic/actionModules/general.js';
import { findCrewTypeById, getTechCost } from '@sammo-ts/logic/world/unitSet.js';
import type { TurnGeneral } from '../../../types.js';
import { asRecord, readMetaNumber, readRequiredMetaNumber } from '../../aiUtils.js';
import { buildAwardCandidate, buildSeizureCandidate } from './helpers.js';

type ResourceName = 'gold' | 'rice';
type ResourceCandidate = [{ destGeneralId: number; amount: number; isGold: boolean }, number];

const pickResourceCandidate = (
    ai: GeneralAI,
    action: 'award' | 'seizure',
    candidates: ResourceCandidate[],
    reason: string
) => {
    if (candidates.length === 0) {
        return null;
    }
    // Ref chooses the raw argument tuple first and only then checks the
    // command's full constraints.  The draw is therefore observable even
    // when the selected command is rejected.  Building/filtering every
    // command before the draw shifts the shared nation/general AI stream.
    const selected = ai.rng.choiceUsingWeightPair(candidates);
    if ((process.env.CORE_AI_TRACE_GENERAL_IDS?.split(',') ?? []).includes(String(ai.general.id))) {
        process.stdout.write(
            `AI_REWARD_SELECTION_TRACE ${JSON.stringify({
                engine: 'core',
                actor: ai.general.id,
                reason,
                candidates,
                selected,
            })}\n`
        );
    }
    return action === 'award'
        ? buildAwardCandidate(ai, selected.destGeneralId, selected.amount, selected.isGold, reason)
        : buildSeizureCandidate(ai, selected.destGeneralId, selected.amount, selected.isGold, reason);
};

const clampLegacy = (value: number, min: number | null, max: number | null): number => {
    if (min !== null && max !== null && max < min) {
        return min;
    }
    return Math.max(min ?? -Infinity, Math.min(max ?? Infinity, value));
};

const getFullLeadership = (ai: GeneralAI, general: TurnGeneral): number => {
    const modules = ai.commandEnv.generalActionModules;
    if (modules && modules.length > 0) {
        const pipeline = new GeneralActionPipeline(modules);
        const adjusted = pipeline.onCalcStat(
            {
                general,
                nation: ai.nation,
                ...(ai.worldRef
                    ? {
                          worldView: {
                              listGenerals: () => ai.worldRef!.listGenerals(),
                              listGeneralsByCity: (cityId: number) =>
                                  ai.worldRef!.listGenerals().filter((candidate) => candidate.cityId === cityId),
                              listNations: () => ai.worldRef!.listNations(),
                          },
                      }
                    : {}),
                time: {
                    year: ai.world.currentYear,
                    month: ai.world.currentMonth,
                    startYear: ai.startYear,
                },
            },
            'leadership',
            general.stats.leadership
        );
        const maxStat = ai.commandEnv.maxStatLevel ?? ai.scenarioConfig.stat.max;
        return Math.trunc(Math.max(0, Math.min(Number(adjusted), maxStat)));
    }
    const nationLevel = ai.nation?.level ?? 0;
    const officerBonus = general.officerLevel === 12 ? nationLevel * 2 : general.officerLevel >= 5 ? nationLevel : 0;
    const maxStat = ai.commandEnv.maxStatLevel ?? ai.scenarioConfig.stat.max;
    return Math.max(0, Math.min(general.stats.leadership + officerBonus, maxStat));
};

const getCrewGoldCost = (ai: GeneralAI, general: TurnGeneral, baseMultiplier: number, finalMultiplier = 1): number => {
    const crewType = findCrewTypeById(ai.unitSet, general.crewTypeId ?? ai.commandEnv.defaultCrewTypeId);
    const tech = readMetaNumber(asRecord(ai.nation?.meta), 'tech', 0);
    // Ref evaluates costWithTech() first, including its `/ 100`, and then
    // applies `* 100 * baseMultiplier * finalMultiplier` from GeneralAI.
    // Keeping that operation order is observable at exact resource boundaries
    // (for example 3036 versus 3036.0000000000005).
    return (
        (((crewType?.cost ?? 0) * getTechCost(tech) * getFullLeadership(ai, general)) / 100) *
        100 *
        baseMultiplier *
        finalMultiplier
    );
};

const sortByResource = (generals: TurnGeneral[], resource: ResourceName, descending = false) =>
    generals.sort((lhs, rhs) => (descending ? rhs[resource] - lhs[resource] : lhs[resource] - rhs[resource]));

const canUseGeneral = (general: TurnGeneral): boolean =>
    readRequiredMetaNumber(asRecord(general.meta), 'killturn', `generalId=${general.id}`) > 5;

export const do유저장긴급포상 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation) {
        return null;
    }
    const candidates: ResourceCandidate[] = [];
    const resourceMap: Array<[ResourceName, number]> = [
        ['gold', ai.nationPolicy.reqHumanWarUrgentGold],
        ['rice', ai.nationPolicy.reqHumanWarUrgentRice],
    ];
    const userWarGenerals = Object.values(ai.userWarGenerals);

    for (const [resKey, minimum] of resourceMap) {
        const generals = sortByResource(userWarGenerals, resKey);
        for (const [index, general] of generals.entries()) {
            if (general[resKey] >= minimum) {
                break;
            }
            if (!canUseGeneral(general)) {
                continue;
            }
            let required = getCrewGoldCost(ai, general, 3, 1.1);
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
                { destGeneralId: general.id, amount, isGold: resKey === 'gold' },
                generals.length - index,
            ]);
        }
    }

    return pickResourceCandidate(ai, 'award', candidates, '유저장긴급포상');
};

export const do유저장포상 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation) {
        return null;
    }
    const candidates: ResourceCandidate[] = [];
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
    const userGenerals = Object.values(ai.userGenerals);

    for (const [resKey, nationMinimum, warMinimum, civilMinimum] of resourceMap) {
        if (nation[resKey] < nationMinimum) {
            continue;
        }
        const generals = sortByResource(userGenerals, resKey);
        for (const [index, general] of generals.entries()) {
            if (general[resKey] >= warMinimum) {
                break;
            }
            if (!canUseGeneral(general)) {
                continue;
            }
            let enough: number;
            if (ai.userWarGenerals[general.id]) {
                let required = getCrewGoldCost(ai, general, 6, 1.1);
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
                { destGeneralId: general.id, amount, isGold: resKey === 'gold' },
                generals.length - index,
            ]);
        }
    }

    return pickResourceCandidate(ai, 'award', candidates, '유저장포상');
};

export const doNPC긴급포상 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation) {
        return null;
    }
    const candidates: ResourceCandidate[] = [];
    const resourceMap: Array<[ResourceName, number, number]> = [
        ['gold', ai.nationPolicy.reqNationGold, ai.nationPolicy.reqNpcWarGold / 2],
        ['rice', ai.nationPolicy.reqNationRice, ai.nationPolicy.reqNpcWarRice / 2],
    ];
    const npcWarGenerals = Object.values(ai.npcWarGenerals);

    for (const [resKey, nationMinimum, minimum] of resourceMap) {
        if (nation[resKey] < nationMinimum) {
            continue;
        }
        const generals = sortByResource(npcWarGenerals, resKey);
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
                { destGeneralId: general.id, amount, isGold: resKey === 'gold' },
                generals.length - index,
            ]);
        }
    }

    return pickResourceCandidate(ai, 'award', candidates, 'NPC긴급포상');
};

export const doNPC포상 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation) {
        return null;
    }
    const candidates: ResourceCandidate[] = [];
    const resourceMap: Array<[ResourceName, number, number, number]> = [
        ['gold', ai.nationPolicy.reqNationGold, ai.nationPolicy.reqNpcWarGold, ai.nationPolicy.reqNpcDevelGold],
        ['rice', ai.nationPolicy.reqNationRice, ai.nationPolicy.reqNpcWarRice, ai.nationPolicy.reqNpcDevelRice],
    ];
    const npcWarGenerals = Object.values(ai.npcWarGenerals);
    const npcCivilGenerals = Object.values(ai.npcCivilGenerals);

    for (const [resKey, nationMinimum, warMinimum, civilMinimum] of resourceMap) {
        if (nation[resKey] < nationMinimum) {
            continue;
        }
        const warGenerals = sortByResource(npcWarGenerals, resKey);
        const civilGenerals = sortByResource(npcCivilGenerals, resKey);
        const weightBase = Math.max(warGenerals.length, civilGenerals.length);
        for (const [index, general] of warGenerals.entries()) {
            if (general[resKey] >= warMinimum) {
                break;
            }
            if (!canUseGeneral(general)) {
                continue;
            }
            let required = getCrewGoldCost(ai, general, 3, 1.1);
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
            if ((process.env.CORE_AI_TRACE_GENERAL_IDS?.split(',') ?? []).includes(String(ai.general.id))) {
                process.stdout.write(
                    `AI_REWARD_TRACE ${JSON.stringify({
                        engine: 'core',
                        actor: ai.general.id,
                        target: general.id,
                        resource: resKey,
                        nationResource: nation[resKey],
                        targetResource: general[resKey],
                        required,
                        enough,
                        maxResourceActionAmount: ai.maxResourceActionAmount,
                        amount,
                    })}\n`
                );
            }
            candidates.push([{ destGeneralId: general.id, amount, isGold: resKey === 'gold' }, weightBase - index]);
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
            candidates.push([{ destGeneralId: general.id, amount, isGold: resKey === 'gold' }, weightBase - index]);
        }
    }

    return pickResourceCandidate(ai, 'award', candidates, 'NPC포상');
};

export const doNPC몰수 = (ai: GeneralAI) => {
    const nation = ai.nation;
    if (!nation) {
        return null;
    }
    const candidates: ResourceCandidate[] = [];
    const resourceMap: Array<[ResourceName, number, number, number]> = [
        ['gold', ai.nationPolicy.reqNationGold, ai.nationPolicy.reqNpcWarGold, ai.nationPolicy.reqNpcDevelGold],
        ['rice', ai.nationPolicy.reqNationRice, ai.nationPolicy.reqNpcWarRice, ai.nationPolicy.reqNpcDevelRice],
    ];
    const npcWarGenerals = Object.values(ai.npcWarGenerals);
    const npcCivilGenerals = Object.values(ai.npcCivilGenerals);

    for (const [resKey, nationMinimum, warMinimum, civilMinimum] of resourceMap) {
        for (const general of sortByResource(npcCivilGenerals, resKey, true)) {
            if (general[resKey] <= civilMinimum * 1.5) {
                break;
            }
            const amount = clampLegacy(general[resKey] - civilMinimum * 1.2, 100, ai.maxResourceActionAmount);
            if (amount < ai.nationPolicy.minimumResourceActionAmount) {
                break;
            }
            candidates.push([{ destGeneralId: general.id, amount, isGold: resKey === 'gold' }, amount]);
        }

        const nationDelta = nationMinimum * 1.5 - nation[resKey];
        if (nationDelta < 0) {
            continue;
        }
        const takeSmallAmount = nation[resKey] >= nationMinimum;
        for (const general of sortByResource(npcWarGenerals, resKey, true)) {
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
            candidates.push([{ destGeneralId: general.id, amount, isGold: resKey === 'gold' }, amount]);
        }
    }

    return pickResourceCandidate(ai, 'seizure', candidates, 'NPC몰수');
};
