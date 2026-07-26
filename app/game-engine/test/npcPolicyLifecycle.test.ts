import { describe, expect, it } from 'vitest';

import type { TurnCommandEnv, TurnSchedule, UnitSetDefinition } from '@sammo-ts/logic';
import { asRecord } from '@sammo-ts/common';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { AutorunNationPolicy } from '../src/turn/ai/policies.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';

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
    troops: [],
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
    it('applies one CAS-protected metadata command and the next AI instance consumes it without scheduler changes', async () => {
        const world = new InMemoryTurnWorld(state, snapshot, { schedule });
        const handler = createTurnDaemonCommandHandler({ world });
        const updates = {
            npc_nation_policy: {
                values: { reqNationGold: 4_321 },
                priority: ['천도'],
                valueSetter: '정책담당',
            },
        };

        await expect(
            handler.handle({
                type: 'setNationMeta',
                nationId: 1,
                updates,
                expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
            })
        ).resolves.toMatchObject({ type: 'setNationMeta', ok: true, nationId: 1 });

        const nation = world.getNationById(1)!;
        expect(nation.meta).toMatchObject({ preserved: 'yes', npc_nation_policy: updates.npc_nation_policy });
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
        expect(policy.reqNpcWarGold).toBe(3_900);
        expect(policy.reqNpcWarRice).toBe(3_900);

        await expect(
            handler.handle({
                type: 'setNationMeta',
                nationId: 1,
                updates: { npc_nation_policy: { values: { reqNationGold: 9_999 } } },
                expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
            })
        ).resolves.toMatchObject({ type: 'setNationMeta', ok: false, reason: 'CONFLICT' });
        expect(asRecord(asRecord(world.getNationById(1)?.meta).npc_nation_policy).values).toEqual({
            reqNationGold: 4_321,
        });
        expect(world.getState()).toMatchObject({ currentYear: 185, currentMonth: 1, tickSeconds: 600 });
    });
});
