import { describe, expect, it } from 'vitest';

import type { TurnCommandEnv, TurnSchedule, UnitSetDefinition } from '@sammo-ts/logic';
import { asRecord } from '@sammo-ts/common';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { AutorunNationPolicy } from '../src/turn/ai/policies.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { applyNpcPolicyMutation } from '../src/turn/npcPolicyMutation.js';

const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };
const general: TurnGeneral = {
    id: 1,
    userId: 'owner-1',
    name: 'NPC군주',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 75, strength: 40, intelligence: 70 },
    turnTime: new Date('0185-01-01T00:00:00Z'),
    recentWarTime: null,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    penalty: {},
    officerLevel: 12,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 1100,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 2,
};

const snapshot: TurnWorldSnapshot = {
    generals: [general],
    cities: [
        {
            id: 1,
            name: '허창',
            nationId: 1,
            level: 7,
            state: 0,
            population: 100_000,
            populationMax: 200_000,
            agriculture: 1_000,
            agricultureMax: 2_000,
            commerce: 1_000,
            commerceMax: 2_000,
            security: 1_000,
            securityMax: 2_000,
            supplyState: 1,
            frontState: 0,
            defence: 1_000,
            defenceMax: 2_000,
            wall: 1_000,
            wallMax: 2_000,
            meta: {},
        },
    ],
    nations: [
        {
            id: 1,
            name: '위',
            color: '#777777',
            capitalCityId: 1,
            chiefGeneralId: 1,
            gold: 10_000,
            rice: 20_000,
            power: 0,
            level: 3,
            typeCode: 'che_법가',
            meta: { tech: 3_000, preserved: 'yes', _updatedAt: '2026-01-01T00:00:00.000Z' },
        },
    ],
    troops: [{ id: 101, nationId: 1, name: '선봉부대' }],
    diplomacy: [],
    events: [],
    initialEvents: [],
    scenarioConfig: {
        stat: { total: 300, min: 10, max: 80, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 65 },
        iconPath: '',
        map: {},
        const: {},
        environment: { mapName: 'test', unitSet: 'basic' },
    },
    scenarioMeta: {
        title: 'test',
        startYear: 180,
        life: null,
        fiction: null,
        history: [],
        ignoreDefaultEvents: false,
    },
    map: {
        id: 'test',
        name: 'test',
        cities: [],
        defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
    },
};

const state: TurnWorldState = {
    id: 1,
    currentYear: 185,
    currentMonth: 1,
    tickSeconds: 600,
    lastTurnTime: new Date('0185-01-01T00:00:00Z'),
    meta: { killturn: 24 },
};

const commandEnv: TurnCommandEnv = {
    baseGold: 1_000,
    baseRice: 1_000,
    develCost: 18,
    maxResourceActionAmount: 10_000,
    minAvailableRecruitPop: 30_000,
    trainDelta: 5,
    atmosDelta: 5,
    maxTrainByCommand: 100,
    maxAtmosByCommand: 100,
    sabotageDefaultProb: 0.5,
    sabotageProbCoefByStat: 0.01,
    sabotageDefenceCoefByGeneralCount: 0.01,
    sabotageDamageMin: 1,
    sabotageDamageMax: 10,
    defaultCrewTypeId: 1100,
    maxGeneral: 100,
    defaultNpcGold: 1_000,
    defaultNpcRice: 1_000,
    defaultSpecialDomestic: null,
    defaultSpecialWar: null,
    openingPartYear: 3,
    initialNationGenLimit: 10,
    maxTechLevel: 10,
    techLevelIncYear: 5,
    initialAllowedTechLevel: 1,
};

const unitSet: UnitSetDefinition = {
    id: 'basic',
    name: 'basic',
    defaultCrewTypeId: 1100,
    armTypes: { 1: '보병' },
    crewTypes: [
        {
            id: 1100,
            armType: 1,
            name: '보병',
            attack: 100,
            defence: 150,
            speed: 7,
            avoid: 10,
            magicCoef: 0,
            cost: 9,
            rice: 9,
            requirements: [],
            attackCoef: {},
            defenceCoef: {},
            info: [],
            initSkillTrigger: null,
            phaseSkillTrigger: null,
            iActionList: null,
        },
    ],
};

describe('NPC policy lifecycle', () => {
    it('keeps hard-invader starting resources below the Ref-compatible NPC war funding target', () => {
        const hardInvaderNation = {
            ...snapshot.nations[0]!,
            name: 'ⓞ강족',
            meta: { ...snapshot.nations[0]!.meta, tech: 15_000 },
        };
        const hardInvaderScenario = structuredClone(snapshot.scenarioConfig);
        hardInvaderScenario.stat.npcMax = 80;
        const hardInvaderGeneral = { ...general, npcState: 9, gold: 99_999, rice: 99_999 };
        const policy = new AutorunNationPolicy({
            general: hardInvaderGeneral,
            aiOptions: null,
            nationPolicy: null,
            serverPolicy: null,
            nation: hardInvaderNation,
            env: { ...commandEnv, maxTechLevel: 12 },
            scenarioConfig: hardInvaderScenario,
            unitSet,
        });

        expect(policy.reqNpcWarGold).toBe(806_400);
        expect(policy.reqNpcWarRice).toBe(806_400);
        expect(hardInvaderGeneral.gold).toBeLessThan(policy.reqNpcWarGold);
        expect(hardInvaderGeneral.rice).toBeLessThan(policy.reqNpcWarRice);
    });

    it('applies CAS-protected semantic policy changes and the next AI instance consumes them without scheduler changes', () => {
        const world = new InMemoryTurnWorld(state, snapshot, { schedule });
        const first = applyNpcPolicyMutation({
            world,
            acceptedAt: new Date('2026-02-03T04:05:06.000Z'),
            command: {
                type: 'setNpcPolicy',
                userId: 'owner-1',
                generalId: 1,
                nationId: 1,
                requestId: 'npc-policy-values',
                expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
                mutation: { kind: 'nationPolicy', values: { reqNationGold: 4_321 } },
            },
        });
        expect(first).toMatchObject({
            type: 'setNpcPolicy',
            ok: true,
            nationId: 1,
            updatedAt: expect.stringMatching(/^2026-02-03T04:05:06\.000Z#[0-9a-f]{16}$/),
        });
        if (!first.ok) {
            throw new Error(first.reason);
        }

        world.updateNation(1, {
            meta: {
                ...world.getNationById(1)!.meta,
                _updatedAt: '2026-02-03T04:05:06.500Z#unrelated-setting',
            },
        });

        const second = applyNpcPolicyMutation({
            world,
            acceptedAt: new Date('2026-02-03T04:05:07.000Z'),
            command: {
                type: 'setNpcPolicy',
                userId: 'owner-1',
                generalId: 1,
                nationId: 1,
                requestId: 'npc-policy-priority',
                expectedUpdatedAt: first.updatedAt,
                mutation: { kind: 'nationPriority', priority: ['천도'] },
            },
        });
        expect(second).toMatchObject({
            type: 'setNpcPolicy',
            ok: true,
            nationId: 1,
            updatedAt: expect.stringMatching(/^2026-02-03T04:05:07\.000Z#[0-9a-f]{16}$/),
        });
        if (!second.ok) {
            throw new Error(second.reason);
        }

        const nation = world.getNationById(1)!;
        expect(nation.meta).toMatchObject({
            preserved: 'yes',
            npc_nation_policy: {
                values: { reqNationGold: 4_321 },
                priority: ['천도'],
                valueSetter: 'NPC군주',
                prioritySetter: 'NPC군주',
            },
        });
        const policy = new AutorunNationPolicy({
            general: world.getGeneralById(1)!,
            aiOptions: null,
            nationPolicy: asRecord(nation.meta).npc_nation_policy as Record<string, unknown>,
            serverPolicy: null,
            nation,
            env: commandEnv,
            scenarioConfig: snapshot.scenarioConfig,
            unitSet,
        });
        expect(policy.reqNationGold).toBe(4_321);
        expect(policy.priority).toEqual(['천도']);
        expect(policy.reqNpcDevelGold).toBe(540);
        expect(policy.reqNpcWarGold).toBe(391_500);
        expect(policy.reqNpcWarRice).toBe(391_500);
        expect(policy.reqHumanWarUrgentGold).toBe(626_400);
        expect(policy.reqHumanWarUrgentRice).toBe(626_400);

        const beforeConflict = structuredClone(world.getNationById(1)?.meta);
        expect(
            applyNpcPolicyMutation({
                world,
                acceptedAt: new Date('2026-02-03T04:05:08.000Z'),
                command: {
                    type: 'setNpcPolicy',
                    userId: 'owner-1',
                    generalId: 1,
                    nationId: 1,
                    expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
                    mutation: { kind: 'nationPolicy', values: { reqNationGold: 9_999 } },
                },
            })
        ).toMatchObject({
            type: 'setNpcPolicy',
            ok: false,
            code: 'CONFLICT',
            currentUpdatedAt: second.updatedAt,
        });
        expect(world.getNationById(1)?.meta).toEqual(beforeConflict);
        expect(asRecord(asRecord(world.getNationById(1)?.meta).npc_nation_policy).values).toEqual({
            reqNationGold: 4_321,
        });
        expect(world.getState()).toMatchObject({ currentYear: 185, currentMonth: 1, tickSeconds: 600 });
    });

    it('requires an exact nullable revision when policy metadata has never been versioned', () => {
        const noRevisionSnapshot = structuredClone(snapshot);
        delete noRevisionSnapshot.nations[0]!.meta._npcPolicyUpdatedAt;
        delete noRevisionSnapshot.nations[0]!.meta._updatedAt;
        const world = new InMemoryTurnWorld(state, noRevisionSnapshot, { schedule });
        const initialMeta = structuredClone(world.getNationById(1)?.meta);

        expect(
            applyNpcPolicyMutation({
                world,
                acceptedAt: new Date('2026-02-03T04:05:06.000Z'),
                command: {
                    type: 'setNpcPolicy',
                    userId: 'owner-1',
                    generalId: 1,
                    nationId: 1,
                    expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
                    mutation: { kind: 'nationPriority', priority: ['천도'] },
                },
            })
        ).toMatchObject({ type: 'setNpcPolicy', ok: false, code: 'CONFLICT', currentUpdatedAt: null });
        expect(world.getNationById(1)?.meta).toEqual(initialMeta);

        const accepted = applyNpcPolicyMutation({
            world,
            acceptedAt: new Date('2026-02-03T04:05:07.000Z'),
            command: {
                type: 'setNpcPolicy',
                requestId: 'initial-null-revision',
                userId: 'owner-1',
                generalId: 1,
                nationId: 1,
                expectedUpdatedAt: null,
                mutation: { kind: 'nationPriority', priority: ['천도'] },
            },
        });
        expect(accepted).toMatchObject({
            type: 'setNpcPolicy',
            ok: true,
            nationId: 1,
            updatedAt: expect.stringMatching(/^2026-02-03T04:05:07\.000Z#[0-9a-f]{16}$/),
        });
        if (!accepted.ok) {
            throw new Error(accepted.reason);
        }
        expect(world.getNationById(1)?.meta).toMatchObject({
            preserved: 'yes',
            _npcPolicyUpdatedAt: accepted.updatedAt,
            npc_nation_policy: { priority: ['천도'] },
        });
    });

    it('validates and merges policy intent against current ENGINE state without materialising defaults', () => {
        const world = new InMemoryTurnWorld(
            {
                ...state,
                clockBaseTime: new Date('0185-01-01T00:00:00.000Z'),
                clockTick: 0,
                clockMode: 'manual',
                clockWallAnchor: new Date('2026-01-01T00:00:00.000Z'),
                lastTurnTick: 0,
            },
            snapshot,
            { schedule }
        );
        world.updateNation(1, {
            meta: {
                ...world.getNationById(1)!.meta,
                npc_nation_policy: { values: { reqNationRice: 456 }, preserved: 'root' },
            },
        });

        const result = applyNpcPolicyMutation({
            world,
            acceptedAt: new Date('2026-02-03T04:05:06.000Z'),
            command: {
                type: 'setNpcPolicy',
                userId: 'owner-1',
                generalId: 1,
                nationId: 1,
                expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
                mutation: {
                    kind: 'nationPolicy',
                    values: {
                        reqNationGold: -100,
                        safeRecruitCityPopulationRatio: -0.5,
                        CombatForce: {},
                        SupportForce: [101],
                    },
                },
            },
        });

        expect(result).toMatchObject({
            type: 'setNpcPolicy',
            ok: true,
            nationId: 1,
            updatedAt: expect.stringMatching(/^2026-02-03T04:05:06\.000Z#[0-9a-f]{16}$/),
        });
        expect(asRecord(world.getNationById(1)?.meta).npc_nation_policy).toEqual({
            values: {
                reqNationRice: 456,
                reqNationGold: 0,
                safeRecruitCityPopulationRatio: -0.5,
                CombatForce: {},
                SupportForce: [101],
            },
            preserved: 'root',
            valueSetter: 'NPC군주',
            valueSetTime: '0185-01-01 09:00:00',
        });
    });

    it('rejects stale authority, empty input, malformed combat targets, and lost CAS inside ENGINE', () => {
        const world = new InMemoryTurnWorld(state, snapshot, { schedule });
        const baseCommand = {
            type: 'setNpcPolicy' as const,
            userId: 'owner-1',
            generalId: 1,
            nationId: 1,
            expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
        };
        const acceptedAt = new Date('2026-02-03T04:05:06.000Z');

        expect(
            applyNpcPolicyMutation({
                world,
                acceptedAt,
                command: { ...baseCommand, mutation: { kind: 'nationPolicy', values: {} } },
            })
        ).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
        expect(
            applyNpcPolicyMutation({
                world,
                acceptedAt,
                command: {
                    ...baseCommand,
                    mutation: { kind: 'nationPolicy', values: { CombatForce: { 101: [1, 1, 1] } } },
                },
            })
        ).toMatchObject({ ok: false, code: 'BAD_REQUEST', reason: '101의 입력양식이 올바르지 않습니다.' });
        expect(
            applyNpcPolicyMutation({
                world,
                acceptedAt,
                command: {
                    ...baseCommand,
                    mutation: { kind: 'nationPolicy', values: { CombatForce: { 101: [1, 1] } } },
                },
            })
        ).toMatchObject({
            ok: false,
            code: 'BAD_REQUEST',
            reason: '101의 도시 , 가 올바른 도시 번호가 아닙니다.',
        });
        expect(
            applyNpcPolicyMutation({
                world,
                acceptedAt,
                command: { ...baseCommand, mutation: { kind: 'nationPriority', priority: [] } },
            })
        ).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
        expect(
            applyNpcPolicyMutation({
                world,
                acceptedAt,
                command: {
                    ...baseCommand,
                    expectedUpdatedAt: '1999-01-01T00:00:00.000Z',
                    mutation: { kind: 'nationPriority', priority: ['천도'] },
                },
            })
        ).toMatchObject({ ok: false, code: 'CONFLICT' });

        world.updateGeneral(1, { officerLevel: 2 });
        expect(
            applyNpcPolicyMutation({
                world,
                acceptedAt,
                command: { ...baseCommand, mutation: { kind: 'nationPriority', priority: ['천도'] } },
            })
        ).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    });
});
