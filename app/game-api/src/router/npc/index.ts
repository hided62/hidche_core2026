import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asRecord, isRecord } from '@sammo-ts/common';
import { findCrewTypeById, getTechCost } from '@sammo-ts/logic/world/unitSet.js';

import { accessAuthedInputProcedure, authedProcedure, router } from '../../trpc.js';
import { loadUnitSetDefinitionByName } from '../../battleSim/unitSetLoader.js';
import type { GameApiContext } from '../../context.js';
import { getMyGeneral } from '../shared/general.js';
import { resolveSecretPermission } from '../shared/secretPermission.js';

type NationPolicy = {
    reqNationGold: number;
    reqNationRice: number;
    CombatForce: Record<number, [number, number]>;
    SupportForce: number[];
    DevelopForce: number[];
    reqHumanWarUrgentGold: number;
    reqHumanWarUrgentRice: number;
    reqHumanWarRecommandGold: number;
    reqHumanWarRecommandRice: number;
    reqHumanDevelGold: number;
    reqHumanDevelRice: number;
    reqNPCWarGold: number;
    reqNPCWarRice: number;
    reqNPCDevelGold: number;
    reqNPCDevelRice: number;
    minimumResourceActionAmount: number;
    maximumResourceActionAmount: number;
    minNPCWarLeadership: number;
    minWarCrew: number;
    minNPCRecruitCityPopulation: number;
    safeRecruitCityPopulationRatio: number;
    properWarTrainAtmos: number;
    cureThreshold: number;
};

type SetterInfo = {
    setter: string | null;
    date: string | null;
};

const updateNationMeta = async (
    ctx: Pick<GameApiContext, 'turnDaemon'>,
    nationId: number,
    updates: Record<string, unknown>,
    currentMeta: Record<string, unknown>
): Promise<void> => {
    const expectedUpdatedAt = typeof currentMeta._updatedAt === 'string' ? currentMeta._updatedAt : undefined;
    const result = await ctx.turnDaemon.requestCommand({
        type: 'setNationMeta',
        nationId,
        updates,
        expectedUpdatedAt,
    });
    if (!result || result.type !== 'setNationMeta') {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected response' });
    }
    if (!result.ok) {
        if (result.reason === 'CONFLICT') {
            throw new TRPCError({
                code: 'CONFLICT',
                message: '다른 사용자가 정책을 변경했습니다. 재시도하거나 현재 상태로 갱신해주세요.',
            });
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
    }
};

const DEFAULT_NATION_PRIORITY = [
    '불가침제의',
    '선전포고',
    '천도',
    '유저장긴급포상',
    '부대전방발령',
    '유저장구출발령',
    '유저장후방발령',
    '부대유저장후방발령',
    '유저장전방발령',
    '유저장포상',
    '부대구출발령',
    '부대후방발령',
    'NPC긴급포상',
    'NPC구출발령',
    'NPC후방발령',
    'NPC포상',
    'NPC전방발령',
    '유저장내정발령',
    'NPC내정발령',
    'NPC몰수',
] as const;

const DEFAULT_GENERAL_PRIORITY = [
    'NPC사망대비',
    '귀환',
    '금쌀구매',
    '출병',
    '긴급내정',
    '전투준비',
    '전방워프',
    'NPC헌납',
    '징병',
    '후방워프',
    '전쟁내정',
    '소집해제',
    '일반내정',
    '내정워프',
] as const;

const DEFAULT_NATION_POLICY: NationPolicy = {
    reqNationGold: 10000,
    reqNationRice: 12000,
    CombatForce: {},
    SupportForce: [],
    DevelopForce: [],
    reqHumanWarUrgentGold: 0,
    reqHumanWarUrgentRice: 0,
    reqHumanWarRecommandGold: 0,
    reqHumanWarRecommandRice: 0,
    reqHumanDevelGold: 10000,
    reqHumanDevelRice: 10000,
    reqNPCWarGold: 0,
    reqNPCWarRice: 0,
    reqNPCDevelGold: 0,
    reqNPCDevelRice: 500,
    minimumResourceActionAmount: 1000,
    maximumResourceActionAmount: 10000,
    minNPCWarLeadership: 40,
    minWarCrew: 1500,
    minNPCRecruitCityPopulation: 50000,
    safeRecruitCityPopulationRatio: 0.5,
    properWarTrainAtmos: 90,
    cureThreshold: 10,
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

const resolveCommandEnv = (config: Record<string, unknown>): { develCost: number; defaultCrewTypeId: number } => {
    const constValues = asRecord(config.const ?? config.consts);
    return {
        develCost: resolveNumberFromKeys(constValues, ['develCost', 'develcost', 'develrate'], 0),
        defaultCrewTypeId: resolveNumberFromKeys(constValues, ['defaultCrewTypeId'], 0),
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
            next.safeRecruitCityPopulationRatio = Math.max(0, value);
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
        unitSetName: string;
    }
): Promise<NationPolicy> => {
    const { statMax, statNpcMax, nationTech, develCost, defaultCrewTypeId, unitSetName } = options;
    const unitSet = await loadUnitSetDefinitionByName(unitSetName);
    const crewType = findCrewTypeById(unitSet, defaultCrewTypeId || unitSet.defaultCrewTypeId || 0);
    const techCost = getTechCost(nationTech);
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

const validateGeneralPriority = (priority: string[]): string | null => {
    const orderRequired: Array<[string, string]> = [['출병', '일반내정']];
    const mustHave = new Set(['출병', '일반내정']);
    const orderMap = new Map<string, number>();

    for (const [idx, item] of priority.entries()) {
        if (!DEFAULT_GENERAL_PRIORITY.includes(item as (typeof DEFAULT_GENERAL_PRIORITY)[number])) {
            return `${item}은 올바른 명령이 아닙니다.`;
        }
        orderMap.set(item, idx);
        mustHave.delete(item);
    }

    for (const [pre, post] of orderRequired) {
        const preIdx = orderMap.get(pre);
        const postIdx = orderMap.get(post);
        if (preIdx === undefined || postIdx === undefined) {
            continue;
        }
        if (preIdx > postIdx) {
            return `${pre} 명령은 ${post} 명령보다 먼저여야 합니다.`;
        }
    }

    if (mustHave.size > 0) {
        return `${Array.from(mustHave)[0]}은 항상 사용해야 합니다.`;
    }
    return null;
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
    setNationPolicy: accessAuthedInputProcedure(z.record(z.string(), z.unknown())).mutation(async ({ ctx, input }) => {
        const general = await getMyGeneral(ctx);
        if (general.nationId <= 0) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Nation membership required.' });
        }

        const nation = await ctx.db.nation.findUnique({
            where: { id: general.nationId },
            select: { id: true, meta: true },
        });
        if (!nation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
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
        if (permissionLevel < 3) {
            throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
        }

        const keys = Object.keys(input);
        for (const key of keys) {
            if (!NATION_POLICY_KEYS.has(key as keyof NationPolicy)) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: `${key}는 올바른 정책값이 아닙니다.` });
            }
        }

        const troopRows = await ctx.db.troop.findMany({
            where: { nationId: general.nationId },
            select: { troopLeaderId: true },
        });
        const cityRows = await ctx.db.city.findMany({ select: { id: true } });

        const troopSet = new Set(troopRows.map((row) => row.troopLeaderId));
        const citySet = new Set(cityRows.map((row) => row.id));
        const assigned = new Set<number>();

        const nationMeta = asRecord(nation.meta);
        const policyRoot = asRecord(nationMeta.npc_nation_policy);
        const nextValues = applyPolicyValues(DEFAULT_NATION_POLICY, asRecord(policyRoot.values));

        for (const key of INTEGER_POLICY_KEYS) {
            if (!(key in input)) {
                continue;
            }
            const value = input[key];
            if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: `${key}는 올바른 값이 아닙니다.` });
            }
            nextValues[key] = Math.max(0, value);
        }

        for (const key of FLOAT_POLICY_KEYS) {
            if (!(key in input)) {
                continue;
            }
            const value = input[key];
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: `${key}는 올바른 값이 아닙니다.` });
            }
            nextValues[key] = value;
        }

        if ('CombatForce' in input) {
            const rawCombat = input.CombatForce;
            if (!isRecord(rawCombat)) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: 'CombatForce는 올바른 정책값이 아닙니다.' });
            }
            const combatForce: Record<number, [number, number]> = {};
            for (const [rawKey, rawValue] of Object.entries(rawCombat)) {
                const leaderId = Number(rawKey);
                if (!Number.isFinite(leaderId)) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: `${rawKey}는 올바른 부대가 아닙니다.` });
                }
                if (!troopSet.has(leaderId)) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: `${leaderId}는 국가의 부대가 아닙니다.` });
                }
                if (assigned.has(leaderId)) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: `부대(${leaderId})는 하나의 역할만 지정할 수 있습니다.`,
                    });
                }
                if (!Array.isArray(rawValue) || rawValue.length < 2) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: `${leaderId}의 입력양식이 올바르지 않습니다.`,
                    });
                }
                const fromCity = Number(rawValue[0]);
                const toCity = Number(rawValue[1]);
                if (!citySet.has(fromCity) || !citySet.has(toCity)) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: `${leaderId}의 도시 ${fromCity}, ${toCity}가 올바른 도시 번호가 아닙니다.`,
                    });
                }
                combatForce[leaderId] = [fromCity, toCity];
                assigned.add(leaderId);
            }
            nextValues.CombatForce = combatForce;
        }

        for (const key of ['SupportForce', 'DevelopForce'] as const) {
            if (!(key in input)) {
                continue;
            }
            const rawList = input[key];
            if (!Array.isArray(rawList)) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: `${key}는 올바른 정책값이 아닙니다.` });
            }
            const list: number[] = [];
            for (const rawValue of rawList) {
                if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
                    throw new TRPCError({ code: 'BAD_REQUEST', message: `${key}는 올바른 정책값이 아닙니다.` });
                }
                if (!troopSet.has(rawValue)) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: `${rawValue}는 국가의 부대가 아닙니다.`,
                    });
                }
                if (assigned.has(rawValue)) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: `부대(${rawValue})는 하나의 역할만 지정할 수 있습니다.`,
                    });
                }
                assigned.add(rawValue);
                list.push(rawValue);
            }
            if (key === 'SupportForce') {
                nextValues.SupportForce = list;
            } else {
                nextValues.DevelopForce = list;
            }
        }

        const nextPolicyRoot = {
            ...policyRoot,
            values: nextValues,
            valueSetter: general.name,
            valueSetTime: new Date().toISOString(),
        };

        await updateNationMeta(
            ctx,
            nation.id,
            {
                npc_nation_policy: nextPolicyRoot,
            },
            nationMeta
        );

        return { ok: true };
    }),
    setNationPriority: accessAuthedInputProcedure(z.array(z.string())).mutation(async ({ ctx, input }) => {
        const general = await getMyGeneral(ctx);
        if (general.nationId <= 0) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Nation membership required.' });
        }

        const nation = await ctx.db.nation.findUnique({
            where: { id: general.nationId },
            select: { id: true, meta: true },
        });
        if (!nation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
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
        if (permissionLevel < 3) {
            throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
        }

        for (const item of input) {
            if (!DEFAULT_NATION_PRIORITY.includes(item as (typeof DEFAULT_NATION_PRIORITY)[number])) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: `${item}은 올바른 명령이 아닙니다.` });
            }
        }

        const nationMeta = asRecord(nation.meta);
        const policyRoot = asRecord(nationMeta.npc_nation_policy);
        const nextPolicyRoot = {
            ...policyRoot,
            priority: input,
            prioritySetter: general.name,
            prioritySetTime: new Date().toISOString(),
        };

        await updateNationMeta(
            ctx,
            nation.id,
            {
                npc_nation_policy: nextPolicyRoot,
            },
            nationMeta
        );

        return { ok: true };
    }),
    setGeneralPriority: accessAuthedInputProcedure(z.array(z.string())).mutation(async ({ ctx, input }) => {
        const general = await getMyGeneral(ctx);
        if (general.nationId <= 0) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Nation membership required.' });
        }

        const nation = await ctx.db.nation.findUnique({
            where: { id: general.nationId },
            select: { id: true, meta: true },
        });
        if (!nation) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Nation not found' });
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
        if (permissionLevel < 3) {
            throw new TRPCError({ code: 'FORBIDDEN', message: '권한이 부족합니다.' });
        }

        const validationError = validateGeneralPriority(input);
        if (validationError) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: validationError });
        }

        const nationMeta = asRecord(nation.meta);
        const policyRoot = asRecord(nationMeta.npc_general_policy);
        const nextPolicyRoot = {
            ...policyRoot,
            priority: input,
            prioritySetter: general.name,
            prioritySetTime: new Date().toISOString(),
        };

        await updateNationMeta(
            ctx,
            nation.id,
            {
                npc_general_policy: nextPolicyRoot,
            },
            nationMeta
        );

        return { ok: true };
    }),
});
