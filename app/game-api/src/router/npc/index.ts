import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asRecord, isRecord } from '@sammo-ts/common';
import { findCrewTypeById, getTechCost } from '@sammo-ts/logic/world/unitSet.js';
import {
    DEFAULT_GENERAL_PRIORITY,
    DEFAULT_NATION_POLICY,
    DEFAULT_NATION_PRIORITY,
    type NationPolicy,
} from '@sammo-ts/game-engine/turn/npcPolicyMutation.js';

import { accessEngineAuthedInputProcedure, authedProcedure, router } from '../../trpc.js';
import { loadUnitSetDefinitionByName } from '@sammo-ts/game-engine/scenario/unitSetLoader.js';
import type { GameApiContext } from '../../context.js';
import { getMyGeneral } from '../shared/general.js';
import { resolveSecretPermission } from '../shared/secretPermission.js';

type SetterInfo = {
    setter: string | null;
    date: string | null;
};

const NATION_POLICY_KEYS = new Set<keyof NationPolicy>(Object.keys(DEFAULT_NATION_POLICY) as Array<keyof NationPolicy>);

const INTEGER_POLICY_KEYS = [
    'reqNationGold',
    'reqNationRice',
    'reqHumanWarUrgentGold',
    'reqHumanWarUrgentRice',
    'reqHumanWarRecommandGold',
    'reqHumanWarRecommandRice',
    'reqHumanDevelGold',
    'reqHumanDevelRice',
    'reqNPCWarGold',
    'reqNPCWarRice',
    'reqNPCDevelGold',
    'reqNPCDevelRice',
    'minimumResourceActionAmount',
    'maximumResourceActionAmount',
    'minNPCWarLeadership',
    'minWarCrew',
    'minNPCRecruitCityPopulation',
    'properWarTrainAtmos',
    'cureThreshold',
] as const;

const FLOAT_POLICY_KEYS = ['safeRecruitCityPopulationRatio'] as const;

type NumericPolicyKey = (typeof INTEGER_POLICY_KEYS)[number];
type FloatPolicyKey = (typeof FLOAT_POLICY_KEYS)[number];

const readNumber = (value: unknown, fallback = 0): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
};

const roundTo = (value: number, digits = 0): number => {
    if (!Number.isFinite(value)) {
        return 0;
    }
    const factor = Math.pow(10, Math.abs(digits));
    if (digits >= 0) {
        return Math.round(value * factor) / factor;
    }
    return Math.round(value / factor) * factor;
};

const clonePolicy = (policy: NationPolicy): NationPolicy => ({
    ...policy,
    CombatForce: { ...policy.CombatForce },
    SupportForce: [...policy.SupportForce],
    DevelopForce: [...policy.DevelopForce],
});

const resolveNumberFromKeys = (source: Record<string, unknown>, keys: string[], fallback: number): number => {
    for (const key of keys) {
        const value = readNumber(source[key], Number.NaN);
        if (Number.isFinite(value)) {
            return value;
        }
    }
    return fallback;
};

const resolveUnitSetName = (config: Record<string, unknown>, fallback: string): string => {
    const environment = asRecord(config.environment ?? config.map);
    const unitSet = environment.unitSet;
    if (typeof unitSet === 'string' && unitSet.trim().length > 0) {
        return unitSet;
    }
    return fallback;
};

const resolveScenarioStat = (config: Record<string, unknown>): { max: number; npcMax: number } => {
    const stat = asRecord(config.stat);
    return {
        max: readNumber(stat.max, 0),
        npcMax: readNumber(stat.npcMax ?? stat.npc_max, 0),
    };
};

const resolveCommandEnv = (
    config: Record<string, unknown>
): { develCost: number; defaultCrewTypeId: number; maxTechLevel: number } => {
    const constValues = asRecord(config.const ?? config.consts);
    return {
        develCost: resolveNumberFromKeys(constValues, ['develCost', 'develcost', 'develrate'], 0),
        defaultCrewTypeId: resolveNumberFromKeys(constValues, ['defaultCrewTypeId'], 0),
        maxTechLevel: resolveNumberFromKeys(constValues, ['maxTechLevel'], 12),
    };
};

const applyPolicyValues = (base: NationPolicy, values: Record<string, unknown>): NationPolicy => {
    const next = clonePolicy(base);
    for (const [key, rawValue] of Object.entries(values)) {
        if (!NATION_POLICY_KEYS.has(key as keyof NationPolicy)) {
            continue;
        }
        const numericKey = key as NumericPolicyKey;
        if (INTEGER_POLICY_KEYS.includes(numericKey)) {
            const value = readNumber(rawValue, next[numericKey]);
            if (Number.isFinite(value)) {
                const safe = Math.max(0, Math.floor(value));
                switch (key) {
                    case 'reqNationGold':
                        next.reqNationGold = safe;
                        break;
                    case 'reqNationRice':
                        next.reqNationRice = safe;
                        break;
                    case 'reqHumanWarUrgentGold':
                        next.reqHumanWarUrgentGold = safe;
                        break;
                    case 'reqHumanWarUrgentRice':
                        next.reqHumanWarUrgentRice = safe;
                        break;
                    case 'reqHumanWarRecommandGold':
                        next.reqHumanWarRecommandGold = safe;
                        break;
                    case 'reqHumanWarRecommandRice':
                        next.reqHumanWarRecommandRice = safe;
                        break;
                    case 'reqHumanDevelGold':
                        next.reqHumanDevelGold = safe;
                        break;
                    case 'reqHumanDevelRice':
                        next.reqHumanDevelRice = safe;
                        break;
                    case 'reqNPCWarGold':
                        next.reqNPCWarGold = safe;
                        break;
                    case 'reqNPCWarRice':
                        next.reqNPCWarRice = safe;
                        break;
                    case 'reqNPCDevelGold':
                        next.reqNPCDevelGold = safe;
                        break;
                    case 'reqNPCDevelRice':
                        next.reqNPCDevelRice = safe;
                        break;
                    case 'minimumResourceActionAmount':
                        next.minimumResourceActionAmount = safe;
                        break;
                    case 'maximumResourceActionAmount':
                        next.maximumResourceActionAmount = safe;
                        break;
                    case 'minNPCWarLeadership':
                        next.minNPCWarLeadership = safe;
                        break;
                    case 'minWarCrew':
                        next.minWarCrew = safe;
                        break;
                    case 'minNPCRecruitCityPopulation':
                        next.minNPCRecruitCityPopulation = safe;
                        break;
                    case 'properWarTrainAtmos':
                        next.properWarTrainAtmos = safe;
                        break;
                    case 'cureThreshold':
                        next.cureThreshold = safe;
                        break;
                    default:
                        break;
                }
            }
            continue;
        }
        const floatKey = key as FloatPolicyKey;
        if (FLOAT_POLICY_KEYS.includes(floatKey)) {
            const value = readNumber(rawValue, next.safeRecruitCityPopulationRatio);
            next.safeRecruitCityPopulationRatio = value;
            continue;
        }
        if (key === 'CombatForce' && isRecord(rawValue)) {
            const nextValue: Record<number, [number, number]> = {};
            for (const [rawKey, rawEntry] of Object.entries(rawValue)) {
                if (!Array.isArray(rawEntry) || rawEntry.length < 2) {
                    continue;
                }
                const leaderId = Number(rawKey);
                const fromCity = Number(rawEntry[0]);
                const toCity = Number(rawEntry[1]);
                if (!Number.isFinite(leaderId) || !Number.isFinite(fromCity) || !Number.isFinite(toCity)) {
                    continue;
                }
                nextValue[leaderId] = [fromCity, toCity];
            }
            next.CombatForce = nextValue;
            continue;
        }
        if (key === 'SupportForce' && Array.isArray(rawValue)) {
            next.SupportForce = rawValue.filter((entry): entry is number => typeof entry === 'number');
        }
        if (key === 'DevelopForce' && Array.isArray(rawValue)) {
            next.DevelopForce = rawValue.filter((entry): entry is number => typeof entry === 'number');
        }
    }
    return next;
};

const buildZeroPolicy = async (
    policy: NationPolicy,
    options: {
        statMax: number;
        statNpcMax: number;
        nationTech: number;
        develCost: number;
        defaultCrewTypeId: number;
        maxTechLevel: number;
        unitSetName: string;
    }
): Promise<NationPolicy> => {
    const { statMax, statNpcMax, nationTech, develCost, defaultCrewTypeId, maxTechLevel, unitSetName } = options;
    const unitSet = await loadUnitSetDefinitionByName(unitSetName);
    const crewType = findCrewTypeById(unitSet, defaultCrewTypeId || unitSet.defaultCrewTypeId || 0);
    const techCost = getTechCost(nationTech, maxTechLevel);
    const next = clonePolicy(policy);

    if (next.reqNPCDevelGold === 0) {
        next.reqNPCDevelGold = develCost * 30;
    }

    if (next.reqNPCWarGold === 0 || next.reqNPCWarRice === 0) {
        const baseGold = crewType ? crewType.cost * techCost * statNpcMax : 0;
        const baseRice = crewType ? crewType.rice * techCost * statNpcMax : 0;
        if (next.reqNPCWarGold === 0) {
            next.reqNPCWarGold = roundTo(baseGold * 4, -2);
        }
        if (next.reqNPCWarRice === 0) {
            next.reqNPCWarRice = roundTo(baseRice * 4, -2);
        }
    }

    if (next.reqHumanWarUrgentGold === 0 || next.reqHumanWarUrgentRice === 0) {
        const baseGold = crewType ? crewType.cost * techCost * statMax : 0;
        const baseRice = crewType ? crewType.rice * techCost * statMax : 0;
        if (next.reqHumanWarUrgentGold === 0) {
            next.reqHumanWarUrgentGold = roundTo(baseGold * 6, -2);
        }
        if (next.reqHumanWarUrgentRice === 0) {
            next.reqHumanWarUrgentRice = roundTo(baseRice * 6, -2);
        }
    }

    if (next.reqHumanWarRecommandGold === 0) {
        next.reqHumanWarRecommandGold = roundTo(next.reqHumanWarUrgentGold * 2, -2);
    }
    if (next.reqHumanWarRecommandRice === 0) {
        next.reqHumanWarRecommandRice = roundTo(next.reqHumanWarUrgentRice * 2, -2);
    }

    return next;
};

const normalizePriority = (raw: unknown, fallback: string[]): string[] => {
    if (!Array.isArray(raw)) {
        return [...fallback];
    }
    const filtered = raw.filter((item): item is string => typeof item === 'string');
    return filtered.length > 0 ? filtered : [...fallback];
};

const resolveSetterInfo = (policy: Record<string, unknown>, kind: 'value' | 'priority'): SetterInfo => {
    if (kind === 'value') {
        return {
            setter: typeof policy.valueSetter === 'string' ? policy.valueSetter : null,
            date: typeof policy.valueSetTime === 'string' ? policy.valueSetTime : null,
        };
    }
    return {
        setter: typeof policy.prioritySetter === 'string' ? policy.prioritySetter : null,
        date: typeof policy.prioritySetTime === 'string' ? policy.prioritySetTime : null,
    };
};

const requestNpcPolicyMutation = async (
    ctx: Pick<GameApiContext, 'auth' | 'db' | 'requestId' | 'turnDaemon'>,
    endpoint: 'setNationPolicy' | 'setNationPriority' | 'setGeneralPriority',
    mutation:
        | { kind: 'nationPolicy'; values: Record<string, unknown> }
        | { kind: 'nationPriority'; priority: string[] }
        | { kind: 'generalPriority'; priority: string[] }
): Promise<{ ok: true }> => {
    if (!ctx.auth) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
    }
    const general = await getMyGeneral(ctx);
    if (general.nationId <= 0) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '국가에 소속되어있지 않습니다.' });
    }
    const nation = await ctx.db.nation.findUnique({
        where: { id: general.nationId },
        select: { id: true, meta: true },
    });
    if (!nation) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '국가 정보를 찾을 수 없습니다.' });
    }
    const nationMeta = asRecord(nation.meta);
    const expectedUpdatedAt =
        typeof nationMeta._npcPolicyUpdatedAt === 'string'
            ? nationMeta._npcPolicyUpdatedAt
            : typeof nationMeta._updatedAt === 'string'
              ? nationMeta._updatedAt
              : null;
    const result = await ctx.turnDaemon.requestCommand({
        type: 'setNpcPolicy',
        ...(ctx.requestId ? { requestId: `${ctx.requestId}:npc.${endpoint}:engine:0:setNpcPolicy` } : {}),
        userId: ctx.auth.user.id,
        generalId: general.id,
        nationId: nation.id,
        expectedUpdatedAt,
        mutation,
    });
    if (!result || result.type !== 'setNpcPolicy') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
    }
    if (!result.ok) {
        throw new TRPCError({ code: result.code, message: result.reason });
    }
    return { ok: true };
};

export const npcRouter = router({
    getPolicy: authedProcedure.query(async ({ ctx }) => {
        const general = await getMyGeneral(ctx);
        if (general.nationId <= 0) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Nation membership required.' });
        }

        const [nation, worldState] = await Promise.all([
            ctx.db.nation.findUnique({
                where: { id: general.nationId },
                select: {
                    id: true,
                    name: true,
                    level: true,
                    tech: true,
                    meta: true,
                },
            }),
            ctx.db.worldState.findFirst(),
        ]);

        if (!nation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
        }
        if (!worldState) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'World state is not initialized.' });
        }

        const permissionLevel = resolveSecretPermission(
            {
                nationId: general.nationId,
                officerLevel: general.officerLevel,
                meta: general.meta,
                penalty: general.penalty,
            },
            nation.meta
        );
        if (permissionLevel < 1) {
            throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
        }

        const worldMeta = asRecord(worldState.meta);
        const worldNationPolicy = asRecord(worldMeta.npc_nation_policy);
        const worldGeneralPolicy = asRecord(worldMeta.npc_general_policy);

        const nationMeta = asRecord(nation.meta);
        const nationPolicyRoot = asRecord(nationMeta.npc_nation_policy);
        const nationGeneralPolicyRoot = asRecord(nationMeta.npc_general_policy);

        const defaultNationPolicy = applyPolicyValues(DEFAULT_NATION_POLICY, asRecord(worldNationPolicy.values));
        const currentNationPolicy = applyPolicyValues(defaultNationPolicy, asRecord(nationPolicyRoot.values));

        const defaultNationPriority = normalizePriority(worldNationPolicy.priority, [...DEFAULT_NATION_PRIORITY]);
        const currentNationPriority = normalizePriority(nationPolicyRoot.priority, defaultNationPriority);

        const defaultGeneralPriority = normalizePriority(worldGeneralPolicy.priority, [...DEFAULT_GENERAL_PRIORITY]);
        const currentGeneralPriority = normalizePriority(nationGeneralPolicyRoot.priority, defaultGeneralPriority);

        const config = asRecord(worldState.config);
        const stat = resolveScenarioStat(config);
        const env = resolveCommandEnv(config);
        const unitSetName = resolveUnitSetName(config, 'che');
        const nationTech = readNumber(nation.tech, 0);

        const zeroPolicy = await buildZeroPolicy(DEFAULT_NATION_POLICY, {
            statMax: stat.max,
            statNpcMax: stat.npcMax,
            nationTech,
            develCost: env.develCost,
            defaultCrewTypeId: env.defaultCrewTypeId,
            maxTechLevel: env.maxTechLevel,
            unitSetName,
        });

        return {
            nationId: nation.id,
            nationName: nation.name,
            nationLevel: nation.level,
            defaultNationPolicy,
            currentNationPolicy,
            zeroPolicy,
            defaultNationPriority,
            currentNationPriority,
            availableNationPriorityItems: [...DEFAULT_NATION_PRIORITY],
            defaultGeneralActionPriority: defaultGeneralPriority,
            currentGeneralActionPriority: currentGeneralPriority,
            availableGeneralActionPriorityItems: [...DEFAULT_GENERAL_PRIORITY],
            lastSetters: {
                policy: resolveSetterInfo(nationPolicyRoot, 'value'),
                nation: resolveSetterInfo(nationPolicyRoot, 'priority'),
                general: resolveSetterInfo(nationGeneralPolicyRoot, 'priority'),
            },
            defaultStatMax: stat.max,
            defaultStatNpcMax: stat.npcMax,
            permissionLevel,
        };
    }),
    setNationPolicy: accessEngineAuthedInputProcedure(z.record(z.string(), z.unknown())).mutation(({ ctx, input }) =>
        requestNpcPolicyMutation(ctx, 'setNationPolicy', { kind: 'nationPolicy', values: input })
    ),
    setNationPriority: accessEngineAuthedInputProcedure(z.array(z.string())).mutation(({ ctx, input }) =>
        requestNpcPolicyMutation(ctx, 'setNationPriority', { kind: 'nationPriority', priority: input })
    ),
    setGeneralPriority: accessEngineAuthedInputProcedure(z.array(z.string())).mutation(({ ctx, input }) =>
        requestNpcPolicyMutation(ctx, 'setGeneralPriority', { kind: 'generalPriority', priority: input })
    ),
});
