import { describe, expect, it } from 'vitest';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createReservedTurnHandler } from '../src/turn/reservedTurnHandler.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import type { TurnSchedule } from '@sammo-ts/logic';

const buildGeneral = (id: number): TurnGeneral => ({
    id,
    name: `General_${id}`,
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    turnTime: new Date('0180-01-01T00:00:00Z'),
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    officerLevel: 1,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 1000,
    rice: 1000,
    crew: 100,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
});

describe('unique lottery on general commands', () => {
    it('awards a unique item for eligible commands', async () => {
        const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };
        const generals = [buildGeneral(1)];
        const snapshot: TurnWorldSnapshot = {
            generals: generals as any,
            cities: [
                {
                    id: 1,
                    name: 'City_1',
                    nationId: 1,
                    viewName: 'City_1',
                    agriculture: 100,
                    agricultureMax: 2000,
                    commerce: 100,
                    commerceMax: 2000,
                    security: 100,
                    securityMax: 100,
                    def: 100,
                    defMax: 100,
                    wall: 100,
                    wallMax: 100,
                    pop: 10000,
                    popMax: 50000,
                    trust: 50,
                    supplyState: 1,
                    frontState: 0,
                    tradepoint: 0,
                    level: 1,
                    meta: {},
                },
            ] as any,
            nations: [
                {
                    id: 1,
                    name: 'TestNation',
                    color: '#FF0000',
                    capitalCityId: 1,
                    chiefGeneralId: 1,
                    gold: 10000,
                    rice: 10000,
                    power: 0,
                    level: 1,
                    typeCode: 'che_def',
                    meta: {},
                },
            ] as any,
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
            map: {
                id: 'test_map',
                name: 'TestMap',
                cities: [
                    {
                        id: 1,
                        name: 'City_1',
                        level: 1,
                        region: 1,
                        position: { x: 0, y: 0 },
                        connections: [],
                        max: {} as any,
                        initial: {} as any,
                    },
                ],
                defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
            } as any,
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {
                    allItems: {
                        weapon: {
                            che_무기_12_칠성검: 1,
                        },
                    },
                    maxUniqueItemLimit: [[-1, 1]],
                    uniqueTrialCoef: 10,
                    maxUniqueTrialProb: 10,
                    minMonthToAllowInheritItem: 0,
                },
                environment: { mapName: 'test_map', unitSet: 'default' },
            },
            scenarioMeta: {
                startYear: 180,
            } as any,
            unitSet: {} as any,
        };

        const state: TurnWorldState = {
            id: 1,
            currentYear: 180,
            currentMonth: 1,
            tickSeconds: 3600,
            lastTurnTime: new Date('0180-01-01T00:00:00Z'),
            meta: {
                hiddenSeed: 'seed',
                scenarioId: 200,
                initYear: 180,
                initMonth: 1,
                scenarioMeta: { startYear: 180 },
            },
        };

        const world = new InMemoryTurnWorld(state, snapshot, { schedule });
        const reservedTurns = new InMemoryReservedTurnStore(
            {
                generalTurn: { findMany: async () => [] },
                nationTurn: { findMany: async () => [] },
            } as any,
            { maxGeneralTurns: 30, maxNationTurns: 12 }
        );
        reservedTurns.getGeneralTurns(1)[0] = { action: 'che_훈련', args: {} };

        const handler = await createReservedTurnHandler({
            reservedTurns,
            scenarioConfig: snapshot.scenarioConfig,
            scenarioMeta: snapshot.scenarioMeta,
            map: snapshot.map,
            unitSet: snapshot.unitSet,
            getWorld: () => world,
        });

        const result = handler.execute({
            general: world.getGeneralById(1)!,
            city: world.getCityById(1)!,
            nation: world.getNationById(1)!,
            world: world.getState(),
            schedule,
        });

        expect(result.general?.role.items.weapon).toBe('che_무기_12_칠성검');
        const logTexts = (result.logs ?? []).map((entry) => entry.text);
        expect(logTexts.some((text) => text.includes('【아이템】'))).toBe(true);
    });

    it('does not award a unique item reserved by an active auction', async () => {
        const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };
        const generals = [buildGeneral(1)];
        const snapshot: TurnWorldSnapshot = {
            generals: generals as any,
            cities: [
                {
                    id: 1,
                    name: 'City_1',
                    nationId: 1,
                    viewName: 'City_1',
                    agriculture: 100,
                    agricultureMax: 2000,
                    commerce: 100,
                    commerceMax: 2000,
                    security: 100,
                    securityMax: 100,
                    def: 100,
                    defMax: 100,
                    wall: 100,
                    wallMax: 100,
                    pop: 10000,
                    popMax: 50000,
                    trust: 50,
                    supplyState: 1,
                    frontState: 0,
                    tradepoint: 0,
                    level: 1,
                    meta: {},
                },
            ] as any,
            nations: [
                {
                    id: 1,
                    name: 'TestNation',
                    color: '#FF0000',
                    capitalCityId: 1,
                    chiefGeneralId: 1,
                    gold: 10000,
                    rice: 10000,
                    power: 0,
                    level: 1,
                    typeCode: 'che_def',
                    meta: {},
                },
            ] as any,
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
            map: {
                id: 'test_map',
                name: 'TestMap',
                cities: [
                    {
                        id: 1,
                        name: 'City_1',
                        level: 1,
                        region: 1,
                        position: { x: 0, y: 0 },
                        connections: [],
                        max: {} as any,
                        initial: {} as any,
                    },
                ],
                defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
            } as any,
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {
                    allItems: {
                        weapon: {
                            che_무기_12_칠성검: 1,
                        },
                    },
                    maxUniqueItemLimit: [[-1, 1]],
                    uniqueTrialCoef: 10,
                    maxUniqueTrialProb: 10,
                    minMonthToAllowInheritItem: 0,
                },
                environment: { mapName: 'test_map', unitSet: 'default' },
            },
            scenarioMeta: {
                startYear: 180,
            } as any,
            unitSet: {} as any,
        };
        const state: TurnWorldState = {
            id: 1,
            currentYear: 180,
            currentMonth: 1,
            tickSeconds: 3600,
            lastTurnTime: new Date('0180-01-01T00:00:00Z'),
            meta: {
                hiddenSeed: 'seed',
                scenarioId: 200,
                initYear: 180,
                initMonth: 1,
                scenarioMeta: { startYear: 180 },
            },
        };
        const world = new InMemoryTurnWorld(state, snapshot, { schedule });
        const reservedTurns = new InMemoryReservedTurnStore(
            {
                generalTurn: { findMany: async () => [] },
                nationTurn: { findMany: async () => [] },
            } as any,
            { maxGeneralTurns: 30, maxNationTurns: 12 }
        );
        reservedTurns.getGeneralTurns(1)[0] = { action: 'che_훈련', args: {} };
        const handler = await createReservedTurnHandler({
            reservedTurns,
            scenarioConfig: snapshot.scenarioConfig,
            scenarioMeta: snapshot.scenarioMeta,
            map: snapshot.map,
            unitSet: snapshot.unitSet,
            getWorld: () => world,
            getAdditionalOccupiedUniqueItemKeys: () => ['che_무기_12_칠성검'],
        });

        const result = handler.execute({
            general: world.getGeneralById(1)!,
            city: world.getCityById(1)!,
            nation: world.getNationById(1)!,
            world: world.getState(),
            schedule,
        });

        expect(result.general?.role.items.weapon).toBeNull();
        expect((result.logs ?? []).some((entry) => entry.text.includes('【아이템】'))).toBe(false);
    });
});
