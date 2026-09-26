import { collectPlayAudit } from './bestEffort.js';
import { createHash } from 'node:crypto';
import { asRecord } from '@sammo-ts/common';
import type { Nation } from '@sammo-ts/logic';
import type { InMemoryTurnWorld } from '../turn/inMemoryWorld.js';
import type { TurnGeneral } from '../turn/types.js';
import { DEFAULT_NATION_POLICY } from '../turn/npcPolicyDefaults.js';

export const AUDIT_POLICY_AREAS = ['NPC_VALUES', 'NPC_NATION_PRIORITY', 'NPC_GENERAL_PRIORITY', 'DEFENCE'] as const;
export type AuditPolicyArea = (typeof AUDIT_POLICY_AREAS)[number];
type PolicyData = Record<string, unknown>;
type PolicyHead = { id: string; revision: number; hash: string; serverId: string };
export interface PendingAuditPolicy {
    schemaVersion: 1;
    id: string;
    serverId: string;
    nationId: number;
    area: AuditPolicyArea;
    revision: number;
    previousId: string | null;
    source: 'BASELINE' | 'CHANGE' | 'OBSERVED_GAP';
    year: number;
    month: number;
    tick: number;
    requestId: string | null;
    ordinal: number;
    actor: {
        userId: string | null;
        generalId: number;
        name: string;
        nationId: number;
        officerLevel: number;
        npcState: number;
        permission: number;
    } | null;
    before: PolicyData | null;
    after: PolicyData;
}

const canonical = (value: unknown): string =>
    JSON.stringify(value, (_key, item: unknown) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            return Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
        }
        return item;
    });
export const auditPolicyHash = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
const pick = (source: Record<string, unknown>, keys: readonly string[]): PolicyData =>
    JSON.parse(JSON.stringify(Object.fromEntries(keys.map((key) => [key, source[key] ?? null])))) as PolicyData;

/** 설정 누락(null)은 상속을 뜻한다. AI의 개인별 보정이나 난수를 재계산하지 않는다. */
export const projectAuditPolicy = (meta: Record<string, unknown>, area: AuditPolicyArea): PolicyData => {
    const nation = asRecord(meta.npc_nation_policy);
    switch (area) {
        case 'NPC_VALUES':
            return pick(asRecord(nation.values), Object.keys(DEFAULT_NATION_POLICY));
        case 'NPC_NATION_PRIORITY':
            return pick(nation, ['priority']);
        case 'NPC_GENERAL_PRIORITY':
            return pick(asRecord(meta.npc_general_policy), ['priority']);
        case 'DEFENCE':
            return pick(meta, ['war', 'scout', 'secretlimit']);
    }
};

export const recordAuditPolicyChange = (options: {
    world: InMemoryTurnWorld;
    nation: Nation;
    area: AuditPolicyArea;
    nextMeta: Record<string, unknown>;
    actor?: TurnGeneral;
    permission?: number;
    requestId?: string;
}): { _playAuditPolicy?: Record<string, PolicyHead> } =>
    collectPlayAudit(
        options.world,
        'recordAuditPolicyChange',
        () => {
            const { world, nation, area } = options;
            const state = world.getState();
            const serverId = state.meta.serverId;
            if (typeof serverId !== 'string' || !serverId.trim()) return {};
            const rawHeads = asRecord(nation.meta._playAuditPolicy);
            const heads: Record<string, PolicyHead> = {};
            for (const key of AUDIT_POLICY_AREAS) {
                const value = asRecord(rawHeads[key]);
                if (
                    value.serverId === serverId &&
                    typeof value.id === 'string' &&
                    typeof value.revision === 'number' &&
                    Number.isSafeInteger(value.revision) &&
                    value.revision > 0 &&
                    typeof value.hash === 'string' &&
                    value.id === auditPolicyHash([serverId, nation.id, key, value.revision])
                ) {
                    heads[key] = { id: value.id, revision: value.revision, hash: value.hash, serverId };
                }
            }
            let head: PolicyHead | null = heads[area] ?? null;
            const before = projectAuditPolicy(nation.meta, area);
            const after = projectAuditPolicy(options.nextMeta, area);
            const append = (source: PendingAuditPolicy['source'], old: PolicyData | null, value: PolicyData) => {
                const revision = (head?.revision ?? 0) + 1;
                const id = auditPolicyHash([serverId, nation.id, area, revision]);
                const actor = options.actor;
                world.queueAuditPolicy({
                    schemaVersion: 1,
                    id,
                    serverId,
                    nationId: nation.id,
                    area,
                    revision,
                    previousId: head?.id ?? null,
                    source,
                    year: state.currentYear,
                    month: state.currentMonth,
                    tick: world.getGameClockState().tick,
                    requestId: source === 'CHANGE' ? (options.requestId ?? null) : null,
                    ordinal: world.nextAuditOrdinal(),
                    actor:
                        source === 'CHANGE' && actor
                            ? {
                                  userId: actor.userId ?? null,
                                  generalId: actor.id,
                                  name: actor.name,
                                  nationId: actor.nationId,
                                  officerLevel: actor.officerLevel,
                                  npcState: actor.npcState,
                                  permission: options.permission ?? 0,
                              }
                            : null,
                    before: old,
                    after: value,
                });
                head = { id, revision, hash: auditPolicyHash(value), serverId };
            };
            if (!head) append('BASELINE', null, before);
            else if (head.hash !== auditPolicyHash(before)) append('OBSERVED_GAP', null, before);
            if (auditPolicyHash(before) !== auditPolicyHash(after)) append('CHANGE', before, after);
            if (!head) throw new Error('Play audit policy baseline missing');
            return { _playAuditPolicy: { ...heads, [area]: head } };
        },
        {}
    );

export const initializeNationAuditPolicies = (world: InMemoryTurnWorld, nationId: number): void =>
    collectPlayAudit(
        world,
        'initializeNationAuditPolicies',
        () => {
            let nation = world.getNationById(nationId);
            if (!nation) return;
            for (const area of AUDIT_POLICY_AREAS) {
                const patch = recordAuditPolicyChange({ world, nation, area, nextMeta: nation.meta });
                if (
                    Object.keys(patch).length &&
                    auditPolicyHash(patch._playAuditPolicy) !== auditPolicyHash(nation.meta._playAuditPolicy ?? {})
                ) {
                    nation = world.updateNation(nation.id, { meta: { ...nation.meta, ...patch } })!;
                }
            }
        },
        undefined
    );

export const initializeAuditPolicies = (world: InMemoryTurnWorld): void => {
    for (const nation of world.listNations()) initializeNationAuditPolicies(world, nation.id);
};
