import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import type { City, Nation } from '@sammo-ts/logic';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createChangeCityHandler } from '../src/turn/monthlyChangeCityAction.js';
import { createProvideNpcTroopLeaderHandler } from '../src/turn/monthlyProvideNpcTroopLeaderAction.js';
import { createMonthlyEventHandler } from '../src/turn/monthlyEventHandler.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';
import type { TurnEvent, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const nationId = 990_091;
const cityId = 990_091;
const generalId = 990_091;

const city: City = {
    id: cityId,
    name: '부대장지원도시',
    nationId,
    level: 4,
    state: 0,
    population: 1_001,
    populationMax: 2_000,
    agriculture: 501,
    agricultureMax: 1_000,
    commerce: 499,
    commerceMax: 1_000,
    security: 99,
    securityMax: 1_000,
    supplyState: 1,
    frontState: 0,
    defence: 101,
    defenceMax: 1_000,
    wall: 50,
    wallMax: 1_000,
    meta: { trust: 40, trade: 100 },
};

const nation: Nation = {
    id: nationId,
    name: '지원국',
    color: '#777777',
    capitalCityId: cityId,
    chiefGeneralId: null,
    gold: 0,
    rice: 0,
    power: 0,
    level: 2,
    typeCode: 'che_중립',
    meta: {},
};

const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [['ProvideNPCTroopLeader'], ['ChangeCity', 'all', { pop_max: '+100', pop: '50%', trust: 80, trade: 105 }]],
    meta: {},
};

integration('monthly NPC support database persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const clean = async () => {
        await db.generalTurn.deleteMany({ where: { generalId } });
        await db.rankData.deleteMany({ where: { generalId } });
        await db.troop.deleteMany({ where: { troopLeaderId: generalId } });
        await db.general.deleteMany({ where: { id: generalId } });
        await db.nation.deleteMany({ where: { id: nationId } });
        await db.city.deleteMany({ where: { id: cityId } });
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await clean();
    });

    afterAll(async () => {
        await clean();
        await closeDb?.();
    });

    it('commits the changed city, leader, troop, ranks, assembly turns, and world sequence', async () => {
        await db.city.create({
            data: {
                id: city.id,
                name: city.name,
                nationId: 0,
                level: city.level,
                supplyState: city.supplyState,
                frontState: city.frontState,
                population: city.population,
                populationMax: city.populationMax,
                agriculture: city.agriculture,
                agricultureMax: city.agricultureMax,
                commerce: city.commerce,
                commerceMax: city.commerceMax,
                security: city.security,
                securityMax: city.securityMax,
                trust: 40,
                trade: 100,
                defence: city.defence,
                defenceMax: city.defenceMax,
                wall: city.wall,
                wallMax: city.wallMax,
                region: 1,
                conflict: {},
                meta: {},
            },
        });
        await db.nation.create({
            data: {
                id: nation.id,
                name: nation.name,
                color: nation.color,
                capitalCityId: nation.capitalCityId,
                chiefGeneralId: null,
                gold: nation.gold,
                rice: nation.rice,
                tech: 0,
                level: nation.level,
                typeCode: nation.typeCode,
                meta: {},
            },
        });
        await db.city.update({ where: { id: cityId }, data: { nationId } });
        const stateRow = await db.worldState.create({
            data: {
                scenarioCode: 'monthly-npc-support-persistence',
                currentYear: 199,
                currentMonth: 12,
                tickSeconds: 600,
                config: {},
                meta: {
                    hiddenSeed: 'monthly-npc-support-persistence',
                    lastGeneralId: generalId - 1,
                    lastNPCTroopLeaderID: 40,
                },
            },
        });
        const state: TurnWorldState = {
            id: stateRow.id,
            currentYear: 199,
            currentMonth: 12,
            tickSeconds: 600,
            lastTurnTime: new Date('0199-12-01T00:00:00.000Z'),
            meta: {
                hiddenSeed: 'monthly-npc-support-persistence',
                lastGeneralId: generalId - 1,
                lastNPCTroopLeaderID: 40,
            },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 165, min: 15, max: 80, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 65 },
                iconPath: '.',
                map: {},
                const: {},
                environment: { mapName: 'test', unitSet: 'default' },
            },
            map: { id: 'test', name: 'test', cities: [] },
            generals: [],
            cities: [city],
            nations: [nation],
            troops: [],
            diplomacy: [],
            events: [event],
            initialEvents: [],
        };
        const reservedTurns = new InMemoryReservedTurnStore(db, {
            maxGeneralTurns: 30,
            maxNationTurns: 12,
        });
        let world: InMemoryTurnWorld | null = null;
        const provide = createProvideNpcTroopLeaderHandler({
            getWorld: () => world,
            reservedTurns,
            env: buildCommandEnv(snapshot.scenarioConfig),
        });
        const changeCity = createChangeCityHandler({ getWorld: () => world });
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: createMonthlyEventHandler({
                getWorld: () => world,
                startYear: 190,
                actions: new Map([
                    ['ProvideNPCTroopLeader', provide],
                    ['ChangeCity', changeCity],
                ]),
            }),
        });
        const dbHooks = await createDatabaseTurnHooks(databaseUrl!, world, { reservedTurns });

        try {
            await world.advanceMonth(new Date('0200-01-01T00:00:00.000Z'));
            await dbHooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            expect(await db.city.findUniqueOrThrow({ where: { id: cityId } })).toMatchObject({
                populationMax: 2_100,
                population: 1_050,
                trust: 80,
                trade: 105,
            });
            expect(await db.general.findUniqueOrThrow({ where: { id: generalId } })).toMatchObject({
                name: '㉥부대장  41',
                nationId,
                cityId,
                troopId: generalId,
                leadership: 10,
                strength: 10,
                intel: 10,
                experience: 2_000,
                dedication: 2_000,
                npcState: 5,
                affinity: 999,
                meta: expect.objectContaining({ killturn: 70 }),
            });
            expect(await db.troop.findUniqueOrThrow({ where: { troopLeaderId: generalId } })).toMatchObject({
                nationId,
                name: '㉥부대장  41',
            });
            const turns = await db.generalTurn.findMany({ where: { generalId } });
            expect(turns).toHaveLength(30);
            expect(new Set(turns.map((turn) => turn.actionCode))).toEqual(new Set(['che_집합']));
            expect(await db.rankData.count({ where: { generalId } })).toBe(44);
            expect((await db.worldState.findUniqueOrThrow({ where: { id: stateRow.id } })).meta).toMatchObject({
                lastNPCTroopLeaderID: 41,
            });
        } finally {
            await dbHooks.close();
            await db.worldState.deleteMany({ where: { id: stateRow.id } });
        }
    });
});
