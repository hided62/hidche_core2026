import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { City, MapDefinition } from '@sammo-ts/logic';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createMonthlyEventHandler, createRandomizeCityTradeRateHandler } from '../src/turn/monthlyEventHandler.js';
import type { TurnEvent, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const cityId = 990_041;
const cityIds = Array.from({ length: 6 }, (_, index) => cityId + index);

const map: MapDefinition = {
    id: 'monthly-trade-persistence',
    name: 'monthly-trade-persistence',
    cities: [],
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
};

const city: City = {
    id: cityId,
    name: '시세검증도시',
    nationId: 0,
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
    supplyState: 1,
    frontState: 0,
    defence: 100,
    defenceMax: 200,
    wall: 100,
    wallMax: 200,
    conflict: {},
    meta: { trust: 50, trade: 100, region: 1 },
};
const cities = [1, 4, 5, 6, 7, 8].map((level, index): City => ({
    ...city,
    id: cityIds[index]!,
    name: `시세검증도시${level}`,
    level,
    meta: { ...city.meta },
}));
const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [['RandomizeCityTradeRate']],
    meta: {},
};

integration('monthly city trade persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.city.deleteMany({ where: { id: { in: cityIds } } });
    });

    afterAll(async () => {
        await db.city.deleteMany({ where: { id: { in: cityIds } } });
        await closeDb?.();
    });

    it('writes both the legacy null state and a randomized numeric rate', async () => {
        await db.city.createMany({
            data: cities.map((entry) => ({
                id: entry.id,
                name: entry.name,
                level: entry.level,
                nationId: entry.nationId,
                supplyState: entry.supplyState,
                frontState: entry.frontState,
                population: entry.population,
                populationMax: entry.populationMax,
                agriculture: entry.agriculture,
                agricultureMax: entry.agricultureMax,
                commerce: entry.commerce,
                commerceMax: entry.commerceMax,
                security: entry.security,
                securityMax: entry.securityMax,
                trust: 50,
                trade: 100,
                defence: entry.defence,
                defenceMax: entry.defenceMax,
                wall: entry.wall,
                wallMax: entry.wallMax,
                region: 1,
                conflict: {},
                meta: {},
            })),
        });
        const row = await db.worldState.create({
            data: {
                scenarioCode: 'monthly-trade-persistence',
                currentYear: 189,
                currentMonth: 12,
                tickSeconds: 600,
                config: {},
                meta: { hiddenSeed: 'monthly-event-test-seed' },
            },
        });
        const state: TurnWorldState = {
            id: row.id,
            currentYear: 189,
            currentMonth: 12,
            tickSeconds: 600,
            lastTurnTime: new Date('2026-07-25T00:10:00.000Z'),
            meta: { hiddenSeed: 'monthly-event-test-seed' },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: map.id, unitSet: 'default' },
            },
            map,
            generals: [],
            cities,
            nations: [],
            troops: [],
            diplomacy: [],
            events: [event],
            initialEvents: [],
        };
        let world: InMemoryTurnWorld | null = null;
        const randomize = createRandomizeCityTradeRateHandler({ getWorld: () => world });
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: createMonthlyEventHandler({
                getWorld: () => world,
                startYear: 189,
                actions: new Map([['RandomizeCityTradeRate', randomize]]),
            }),
        });
        const dbHooks = await createDatabaseTurnHooks(databaseUrl!, world);
        const checkpoint = {
            lastTurnTime: state.lastTurnTime.toISOString(),
            processedGenerals: 0,
            processedTurns: 1,
            durationMs: 0,
            partial: false,
        };

        try {
            await world.advanceMonth(new Date('0190-01-01T00:00:00.000Z'));
            await dbHooks.hooks.flushChanges?.(checkpoint);
            expect(
                (
                    await db.city.findMany({
                        where: { id: { in: cityIds } },
                        orderBy: { id: 'asc' },
                        select: { trade: true },
                    })
                ).map((entry) => entry.trade)
            ).toEqual([null, null, 101, 100, 105, 102]);
        } finally {
            await dbHooks.close();
            await db.worldState.delete({ where: { id: row.id } });
        }
    });
});
