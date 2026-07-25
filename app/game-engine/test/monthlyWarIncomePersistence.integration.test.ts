import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { City, Nation } from '@sammo-ts/logic';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createProcessWarIncomeHandler } from '../src/turn/monthlyWarIncomeAction.js';
import type { TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const nationId = 990_081;
const cityIds = [990_081, 990_082] as const;

const nation: Nation = {
    id: nationId,
    name: '전쟁수입저장국',
    color: '#777777',
    capitalCityId: cityIds[0],
    chiefGeneralId: null,
    gold: 1_000,
    rice: 1_000,
    power: 0,
    level: 1,
    typeCode: 'che_중립',
    meta: {},
};

const buildCity = (id: number, supplyState: number, dead: number): City => ({
    id,
    name: `전쟁수입저장도시${id}`,
    nationId,
    level: 1,
    state: 0,
    population: 1_000,
    populationMax: 2_000,
    agriculture: 100,
    agricultureMax: 200,
    commerce: 100,
    commerceMax: 200,
    security: 100,
    securityMax: 200,
    supplyState,
    frontState: 0,
    defence: 100,
    defenceMax: 200,
    wall: 100,
    wallMax: 200,
    conflict: {},
    meta: { trust: 50, trade: 100, region: 1, dead },
});

integration('monthly war income database persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.city.deleteMany({ where: { id: { in: [...cityIds] } } });
        await db.nation.deleteMany({ where: { id: nationId } });
    });

    afterAll(async () => {
        await db.city.deleteMany({ where: { id: { in: [...cityIds] } } });
        await db.nation.deleteMany({ where: { id: nationId } });
        await closeDb?.();
    });

    it('persists supplied-city income before recovering every city casualty pool', async () => {
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
        const cities = [buildCity(cityIds[0], 1, 101), buildCity(cityIds[1], 0, 999)];
        await db.city.createMany({
            data: cities.map((city) => ({
                id: city.id,
                name: city.name,
                level: city.level,
                nationId: city.nationId,
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
                trust: 50,
                trade: 100,
                defence: city.defence,
                defenceMax: city.defenceMax,
                wall: city.wall,
                wallMax: city.wallMax,
                region: 1,
                conflict: {},
                meta: { dead: city.meta.dead },
            })),
        });
        const row = await db.worldState.create({
            data: {
                scenarioCode: 'monthly-war-income-persistence',
                currentYear: 193,
                currentMonth: 1,
                tickSeconds: 600,
                config: {},
                meta: {},
            },
        });
        const state: TurnWorldState = {
            id: row.id,
            currentYear: 193,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('2026-07-25T00:10:00.000Z'),
            meta: {},
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: 'test', unitSet: 'default' },
            },
            map: {
                id: 'test',
                name: 'test',
                cities: [],
                defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
            },
            generals: [],
            cities,
            nations: [nation],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
        };
        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        });
        const dbHooks = await createDatabaseTurnHooks(databaseUrl!, world);

        try {
            const handler = createProcessWarIncomeHandler({ getWorld: () => world });
            await handler(
                [],
                {
                    year: 193,
                    month: 1,
                    startyear: 190,
                    currentEventID: 1,
                    turnTime: state.lastTurnTime,
                },
                { id: 1, targetCode: 'pre_month', priority: 0, condition: true, action: [], meta: {} }
            );
            await dbHooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            expect(await db.nation.findUniqueOrThrow({ where: { id: nationId } })).toMatchObject({
                gold: 1_010,
                rice: 1_000,
            });
            expect(await db.city.findUniqueOrThrow({ where: { id: cityIds[0] } })).toMatchObject({
                population: 1_020,
                meta: { dead: 0 },
            });
            expect(await db.city.findUniqueOrThrow({ where: { id: cityIds[1] } })).toMatchObject({
                population: 1_200,
                meta: { dead: 0 },
            });
        } finally {
            await dbHooks.close();
            await db.worldState.delete({ where: { id: row.id } });
        }
    });
});
