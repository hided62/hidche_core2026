import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { City, MapDefinition } from '@sammo-ts/logic';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createRaiseDisasterHandler } from '../src/turn/monthlyDisasterAction.js';
import { createMonthlyEventHandler } from '../src/turn/monthlyEventHandler.js';
import type { TurnEvent, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const cityId = 990_042;

const map: MapDefinition = {
    id: 'monthly-disaster-persistence',
    name: 'monthly-disaster-persistence',
    cities: [],
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
};

const city: City = {
    id: cityId,
    name: '재난저장검증도시',
    nationId: 0,
    level: 1,
    state: 0,
    population: 1_000,
    populationMax: 2_000,
    agriculture: 500,
    agricultureMax: 1_000,
    commerce: 500,
    commerceMax: 1_000,
    security: 0,
    securityMax: 100,
    supplyState: 1,
    frontState: 0,
    defence: 100,
    defenceMax: 1_000,
    wall: 100,
    wallMax: 1_000,
    conflict: {},
    meta: { trust: 99.5, trade: 100, region: 1 },
};
const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [['RaiseDisaster']],
    meta: {},
};

integration('monthly disaster database persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.city.deleteMany({ where: { id: cityId } });
    });

    afterAll(async () => {
        await db.city.deleteMany({ where: { id: cityId } });
        await closeDb?.();
    });

    it('preserves fractional trust while writing integer damage and the disaster state', async () => {
        await db.city.create({
            data: {
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
                trust: 99.5,
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
        const row = await db.worldState.create({
            data: {
                scenarioCode: 'monthly-disaster-persistence',
                currentYear: 192,
                currentMonth: 12,
                tickSeconds: 600,
                config: {},
                meta: { hiddenSeed: 'disaster-test-6' },
            },
        });
        const state: TurnWorldState = {
            id: row.id,
            currentYear: 192,
            currentMonth: 12,
            tickSeconds: 600,
            lastTurnTime: new Date('2026-07-25T00:10:00.000Z'),
            meta: { hiddenSeed: 'disaster-test-6' },
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
            cities: [city],
            nations: [],
            troops: [],
            diplomacy: [],
            events: [event],
            initialEvents: [],
        };
        let world: InMemoryTurnWorld | null = null;
        const raiseDisaster = createRaiseDisasterHandler({ getWorld: () => world });
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: createMonthlyEventHandler({
                getWorld: () => world,
                startYear: 190,
                actions: new Map([['RaiseDisaster', raiseDisaster]]),
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
            await world.advanceMonth(new Date('0193-01-01T00:00:00.000Z'));
            await dbHooks.hooks.flushChanges?.(checkpoint);

            const persisted = await db.city.findUniqueOrThrow({ where: { id: cityId } });
            expect(persisted).toMatchObject({
                population: 800,
                agriculture: 400,
                commerce: 400,
                defence: 80,
                wall: 80,
                meta: { state: 3 },
            });
            expect(persisted.trust).toBeCloseTo(79.6);
        } finally {
            await dbHooks.close();
            await db.worldState.delete({ where: { id: row.id } });
        }
    });
});
