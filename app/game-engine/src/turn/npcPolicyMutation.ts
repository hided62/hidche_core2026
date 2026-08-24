import { createHash } from 'node:crypto';

import {
    asRecord,
    formatServerDateTime,
    isRecord,
    type TurnDaemonCommand,
    type TurnDaemonCommandResult,
} from '@sammo-ts/common';
import { resolveTroopSecretPermission } from '@sammo-ts/logic';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';

export type NationPolicy = {
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

export const DEFAULT_NATION_PRIORITY = [
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

export const DEFAULT_GENERAL_PRIORITY = [
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

export const DEFAULT_NATION_POLICY: NationPolicy = {
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
] as const satisfies ReadonlyArray<keyof NationPolicy>;

const FLOAT_POLICY_KEYS = ['safeRecruitCityPopulationRatio'] as const satisfies ReadonlyArray<keyof NationPolicy>;
const INTEGER_POLICY_KEY_SET = new Set<string>(INTEGER_POLICY_KEYS);
const FLOAT_POLICY_KEY_SET = new Set<string>(FLOAT_POLICY_KEYS);

type SetNpcPolicyCommand = Extract<TurnDaemonCommand, { type: 'setNpcPolicy' }>;
type SetNpcPolicyResult = Extract<TurnDaemonCommandResult, { type: 'setNpcPolicy' }>;

const reject = (
    code: Extract<SetNpcPolicyResult, { ok: false }>['code'],
    reason: string,
    extra: Pick<Extract<SetNpcPolicyResult, { ok: false }>, 'nationId' | 'currentUpdatedAt'> = {}
): SetNpcPolicyResult => ({ type: 'setNpcPolicy', ok: false, code, reason, ...extra });

const buildRevision = (acceptedAt: Date, requestId: string): string => {
    const suffix = createHash('sha256').update(requestId).digest('hex').slice(0, 16);
    return `${acceptedAt.toISOString()}#${suffix}`;
};

const validateGeneralPriority = (priority: readonly string[]): string | null => {
    const mustHave = new Set(['출병', '일반내정']);
    const orderMap = new Map<string, number>();

    for (const item of priority) {
        if (!DEFAULT_GENERAL_PRIORITY.includes(item as (typeof DEFAULT_GENERAL_PRIORITY)[number])) {
            return `${item}은 올바른 명령이 아닙니다.`;
        }
        mustHave.delete(item);
        // Ref uses the count of distinct keys at each assignment. Updating an
        // existing key therefore advances it after the currently known keys.
        orderMap.set(item, orderMap.size);
    }

    const sortieIndex = orderMap.get('출병');
    const domesticIndex = orderMap.get('일반내정');
    if (sortieIndex !== undefined && domesticIndex !== undefined && sortieIndex > domesticIndex) {
        return '출병 명령은 일반내정 명령보다 먼저여야 합니다.';
    }
    if (mustHave.size > 0) {
        return `${mustHave.values().next().value}은 항상 사용해야 합니다.`;
    }
    return null;
};

const applyNationPolicyValues = (
    world: InMemoryTurnWorld,
    nationId: number,
    currentValues: Record<string, unknown>,
    values: Record<string, unknown>
): { values?: Record<string, unknown>; error?: string } => {
    if (Object.keys(values).length === 0) {
        return { error: '올바른 입력이 아닙니다.' };
    }

    for (const key of Object.keys(values)) {
        if (!NATION_POLICY_KEYS.has(key as keyof NationPolicy)) {
            return { error: `${key}는 올바른 정책값이 아닙니다.` };
        }
    }

    // Ref persists only the supplied delta on top of the existing nation
    // overrides. Materialising defaults here would freeze later server-policy
    // changes and is not equivalent to j_set_npc_control.php.
    const nextValues = { ...currentValues };
    for (const key of INTEGER_POLICY_KEYS) {
        if (!Object.hasOwn(values, key)) {
            continue;
        }
        const value = values[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
            return { error: `${key}는 올바른 값이 아닙니다.` };
        }
        nextValues[key] = Math.max(0, value);
    }
    for (const key of FLOAT_POLICY_KEYS) {
        if (!Object.hasOwn(values, key)) {
            continue;
        }
        const value = values[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return { error: `${key}는 올바른 값이 아닙니다.` };
        }
        // Ref clamps negative integers but deliberately leaves floating-point
        // ratios unchanged.
        nextValues[key] = value;
    }

    const troopIds = new Set(
        world
            .listTroops()
            .filter((troop) => troop.nationId === nationId)
            .map((troop) => troop.id)
    );
    const assigned = new Set<number>();

    if (Object.hasOwn(values, 'CombatForce')) {
        const rawCombat = values.CombatForce;
        if (!isRecord(rawCombat)) {
            return { error: 'CombatForce는 올바른 정책값이 아닙니다.' };
        }
        for (const [rawLeaderId, rawTarget] of Object.entries(rawCombat)) {
            const leaderId = Number(rawLeaderId);
            if (!Number.isSafeInteger(leaderId) || !troopIds.has(leaderId)) {
                return { error: `${rawLeaderId}는 국가의 부대가 아닙니다.` };
            }
            if (assigned.has(leaderId)) {
                return { error: `부대(${leaderId})는 하나의 역할만 지정할 수 있습니다.` };
            }
            if (!Array.isArray(rawTarget) || rawTarget.length !== 2) {
                return { error: `${leaderId}의 입력양식이 올바르지 않습니다.` };
            }
            // Ref j_set_npc_control.php accidentally destructures the complete
            // troop-role cache instead of this rawTarget. Positive troop IDs
            // therefore leave indexes 0/1 undefined and every non-empty
            // CombatForce is rejected with this observable empty-city error.
            // Preserve that legacy bug until a separately approved contract
            // change fixes Ref and Core together.
            return { error: `${leaderId}의 도시 , 가 올바른 도시 번호가 아닙니다.` };
        }
        nextValues.CombatForce = {};
    }

    for (const key of ['SupportForce', 'DevelopForce'] as const) {
        if (!Object.hasOwn(values, key)) {
            continue;
        }
        const rawList = values[key];
        if (!Array.isArray(rawList)) {
            return { error: `${key}는 올바른 정책값이 아닙니다.` };
        }
        const list: number[] = [];
        for (const rawLeaderId of rawList) {
            const leaderId = Number(rawLeaderId);
            if (!Number.isSafeInteger(leaderId) || !troopIds.has(leaderId)) {
                return { error: `${String(rawLeaderId)}는 국가의 부대가 아닙니다.` };
            }
            if (assigned.has(leaderId)) {
                return { error: `부대(${leaderId})는 하나의 역할만 지정할 수 있습니다.` };
            }
            assigned.add(leaderId);
            list.push(leaderId);
        }
        nextValues[key] = list;
    }

    // Numeric keys have already been handled. The three role keys are handled
    // above, leaving no accepted policy key unprocessed.
    for (const [key, value] of Object.entries(values)) {
        if (
            !INTEGER_POLICY_KEY_SET.has(key) &&
            !FLOAT_POLICY_KEY_SET.has(key) &&
            !['CombatForce', 'SupportForce', 'DevelopForce'].includes(key)
        ) {
            nextValues[key] = value;
        }
    }
    return { values: nextValues };
};

export const applyNpcPolicyMutation = (options: {
    world: InMemoryTurnWorld;
    command: SetNpcPolicyCommand;
    acceptedAt: Date;
}): SetNpcPolicyResult => {
    const { world, command, acceptedAt } = options;
    const actor = world.getGeneralById(command.generalId);
    if (!actor) {
        return reject('NOT_FOUND', '장수 정보를 찾을 수 없습니다.');
    }
    if (actor.userId !== command.userId) {
        return reject('FORBIDDEN', '인증된 사용자와 장수의 소유자가 일치하지 않습니다.');
    }
    if (actor.nationId <= 0 || actor.nationId !== command.nationId) {
        return reject('PRECONDITION_FAILED', '국가에 소속되어있지 않거나 소속 국가가 변경되었습니다.');
    }

    const nation = world.getNationById(command.nationId);
    if (!nation) {
        return reject('NOT_FOUND', '국가 정보를 찾을 수 없습니다.', { nationId: command.nationId });
    }
    if (resolveTroopSecretPermission(actor, nation.meta, true) < 3) {
        return reject('FORBIDDEN', '권한이 부족합니다. 군주, 외교권자, 조언자가 아닙니다.', {
            nationId: command.nationId,
        });
    }

    const nationMeta = asRecord(nation.meta);
    const currentUpdatedAt =
        typeof nationMeta._npcPolicyUpdatedAt === 'string'
            ? nationMeta._npcPolicyUpdatedAt
            : typeof nationMeta._updatedAt === 'string'
              ? nationMeta._updatedAt
              : null;
    if (command.expectedUpdatedAt !== currentUpdatedAt) {
        return reject('CONFLICT', '다른 사용자가 정책을 변경했습니다. 재시도하거나 현재 상태로 갱신해주세요.', {
            nationId: command.nationId,
            currentUpdatedAt,
        });
    }

    const gameNow = formatServerDateTime(world.getGameNow(acceptedAt));
    let updates: Record<string, unknown>;
    if (command.mutation.kind === 'nationPolicy') {
        const policyRoot = asRecord(nationMeta.npc_nation_policy);
        const applied = applyNationPolicyValues(
            world,
            command.nationId,
            asRecord(policyRoot.values),
            command.mutation.values
        );
        if (!applied.values) {
            return reject('BAD_REQUEST', applied.error ?? '올바른 입력이 아닙니다.', { nationId: command.nationId });
        }
        updates = {
            npc_nation_policy: {
                ...policyRoot,
                values: applied.values,
                valueSetter: actor.name,
                valueSetTime: gameNow,
            },
        };
    } else if (command.mutation.kind === 'nationPriority') {
        if (command.mutation.priority.length === 0) {
            return reject('BAD_REQUEST', '올바른 입력이 아닙니다.', { nationId: command.nationId });
        }
        for (const item of command.mutation.priority) {
            if (!DEFAULT_NATION_PRIORITY.includes(item as (typeof DEFAULT_NATION_PRIORITY)[number])) {
                return reject('BAD_REQUEST', `${item}은 올바른 명령이 아닙니다.`, { nationId: command.nationId });
            }
        }
        const policyRoot = asRecord(nationMeta.npc_nation_policy);
        updates = {
            npc_nation_policy: {
                ...policyRoot,
                priority: [...command.mutation.priority],
                prioritySetter: actor.name,
                prioritySetTime: gameNow,
            },
        };
    } else {
        const validationError = validateGeneralPriority(command.mutation.priority);
        if (validationError) {
            return reject('BAD_REQUEST', validationError, { nationId: command.nationId });
        }
        const policyRoot = asRecord(nationMeta.npc_general_policy);
        updates = {
            npc_general_policy: {
                ...policyRoot,
                priority: [...command.mutation.priority],
                prioritySetter: actor.name,
                prioritySetTime: gameNow,
            },
        };
    }

    // input_event timestamps have millisecond precision, so two independent
    // accepted commands can share the same time. Include the durable request
    // identity to keep the strict CAS token unique.
    const updatedAt = buildRevision(acceptedAt, command.requestId ?? `${command.type}:${command.generalId}`);
    world.updateNation(command.nationId, {
        meta: {
            ...nation.meta,
            ...updates,
            // Keep the policy CAS independent from notice/tax/scout settings.
            // The legacy shared _updatedAt remains a one-time migration fallback.
            _npcPolicyUpdatedAt: updatedAt,
        },
    });
    return { type: 'setNpcPolicy', ok: true, nationId: command.nationId, updatedAt };
};
