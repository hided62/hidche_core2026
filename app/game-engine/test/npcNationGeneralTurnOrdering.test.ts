import { describe, expect, it } from 'vitest';
import type { TurnSchedule, UnitSetDefinition } from '@sammo-ts/logic';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnTestHarness } from './helpers/turnTestHarness.js';

const turnTime = new Date('0190-01-01T00:00:00Z');

const TEST_MAP = {
    id: 'nation_general_turn_order',
    name: '사령 장수턴 순서 맵',
    cities: [
        {
            id: 1,
            name: '아군성',
            level: 1,
            region: 1,
            position: { x: 10, y: 10 },
            connections: [2],
            max: {
                population: 20_000,
                agriculture: 2_000,
                commerce: 2_000,
                security: 2_000,
                defence: 1_000,
                wall: 1_000,
            },
            initial: {
                population: 10_000,
                agriculture: 1_000,
                commerce: 1_000,
                security: 1_000,
                defence: 500,
                wall: 500,
            },
        },
        {
            id: 2,
            name: '적군성',
            level: 1,
            region: 2,
            position: { x: 20, y: 10 },
            connections: [1],
            max: {
                population: 20_000,
                agriculture: 2_000,
                commerce: 2_000,
                security: 2_000,
                defence: 1_000,
                wall: 1_000,
            },
            initial: {
                population: 10_000,
                agriculture: 1_000,
                commerce: 1_000,
                security: 1_000,
                defence: 500,
                wall: 500,
            },
        },
    ],
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
} as const;

const UNIT_SET: UnitSetDefinition = {
    id: 'nation_general_turn_order_unit',
    name: '사령 장수턴 순서 병종',
    defaultCrewTypeId: 1100,
    crewTypes: [
        {
            id: 1100,
            armType: 1,
            name: '보병',
            attack: 10,
            defence: 10,
            speed: 10,
            avoid: 0,
            magicCoef: 0,
            cost: 10,
            rice: 1,
            requirements: [],
            attackCoef: {},
            defenceCoef: {},
            info: [],
            initSkillTrigger: null,
            phaseSkillTrigger: null,
        },
    ],
};

const createGeneral = (id: number, nationId: number, cityId: number, officerLevel: number): TurnGeneral => ({
    id,
    name: `NPC_${id}`,
    nationId,
    cityId,
    troopId: 0,
    stats: { leadership: 75, strength: 70, intelligence: 40 },
    turnTime: id === 1 ? turnTime : new Date('0191-01-01T00:00:00Z'),
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 800 },
    officerLevel,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 2_000,
    rice: 2_000,
    crew: 2_000,
    crewTypeId: 1100,
    train: 80,
    atmos: 80,
    age: 30,
    npcState: 2,
});

describe('NPC 사령턴과 장수턴 실행 순서', () => {
    it('필사즉생 실행 결과를 반영한 뒤 같은 장수의 자율 출병을 선택한다', async () => {
        const generals = [createGeneral(1, 1, 1, 12), createGeneral(2, 2, 2, 12)];
        const snapshot: TurnWorldSnapshot = {
            generals,
            cities: [
                {
                    id: 1,
                    name: '아군성',
                    nationId: 1,
                    level: 1,
                    state: 0,
                    population: 10_000,
                    populationMax: 20_000,
                    agriculture: 1_000,
                    agricultureMax: 2_000,
                    commerce: 1_000,
                    commerceMax: 2_000,
                    security: 1_000,
                    securityMax: 2_000,
                    supplyState: 1,
                    frontState: 3,
                    defence: 500,
                    defenceMax: 1_000,
                    wall: 500,
                    wallMax: 1_000,
                    meta: { trust: 100 },
                },
                {
                    id: 2,
                    name: '적군성',
                    nationId: 2,
                    level: 1,
                    state: 0,
                    population: 10_000,
                    populationMax: 20_000,
                    agriculture: 1_000,
                    agricultureMax: 2_000,
                    commerce: 1_000,
                    commerceMax: 2_000,
                    security: 1_000,
                    securityMax: 2_000,
                    supplyState: 1,
                    frontState: 3,
                    defence: 500,
                    defenceMax: 1_000,
                    wall: 500,
                    wallMax: 1_000,
                    meta: { trust: 100 },
                },
            ],
            nations: [
                {
                    id: 1,
                    name: '아군',
                    color: '#aa0000',
                    capitalCityId: 1,
                    chiefGeneralId: 1,
                    gold: 50_000,
                    rice: 50_000,
                    power: 0,
                    level: 1,
                    typeCode: 'npc',
                    meta: {
                        strategic_cmd_limit: 0,
                        turn_last_12: { command: '필사즉생', term: 2 },
                        npc_general_policy: { priority: ['출병', '전투준비'] },
                    },
                },
                {
                    id: 2,
                    name: '적군',
                    color: '#0000aa',
                    capitalCityId: 2,
                    chiefGeneralId: 2,
                    gold: 50_000,
                    rice: 50_000,
                    power: 0,
                    level: 1,
                    typeCode: 'npc',
                    meta: {},
                },
            ],
            troops: [],
            diplomacy: [
                { fromNationId: 1, toNationId: 2, state: 0, term: 0, dead: 0, meta: {} },
                { fromNationId: 2, toNationId: 1, state: 0, term: 0, dead: 0, meta: {} },
            ],
            events: [],
            initialEvents: [],
            map: TEST_MAP as any,
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {
                    openingPartYear: 3,
                    develCost: 10,
                    baseGold: 1_000,
                    baseRice: 1_000,
                    maxResourceActionAmount: 10_000,
                    minAvailableRecruitPop: 0,
                },
                environment: { mapName: TEST_MAP.id, unitSet: UNIT_SET.id },
            },
            scenarioMeta: { startYear: 180 } as any,
            unitSet: UNIT_SET,
        };
        const state: TurnWorldState = {
            id: 1,
            currentYear: 190,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: turnTime,
            meta: { seed: 1, initYear: 180, initMonth: 1 },
        };
        const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };
        const resolved: Array<{ kind: string; generalId: number; actionKey: string }> = [];
        const { reservedTurnStore, runOneTick, world } = await createTurnTestHarness({
            snapshot,
            state,
            schedule,
            map: TEST_MAP as any,
            onActionResolved: ({ kind, generalId, actionKey }) => resolved.push({ kind, generalId, actionKey }),
        });
        reservedTurnStore.getNationTurns(1, 12)[0] = { action: 'che_필사즉생', args: {} };

        await runOneTick();

        expect(
            resolved.filter((entry) => entry.generalId === 1).map(({ kind, actionKey }) => [kind, actionKey])
        ).toEqual([
            ['nation', 'che_필사즉생'],
            ['general', 'che_출병'],
        ]);
        expect(world.getGeneralById(1)!.train).toBeGreaterThanOrEqual(100);
        expect(world.getGeneralById(1)!.atmos).toBeGreaterThanOrEqual(100);
    });
});
