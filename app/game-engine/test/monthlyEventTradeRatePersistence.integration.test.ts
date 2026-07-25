import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { City, MapDefinition } from '@sammo-ts/logic';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const cityId = 990_041;

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

integration('monthly city trade persistence', () => {
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

    it('writes both the legacy null state and a randomized numeric rate', async () => {
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
                trust: 50,
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
                scenarioCode: 'monthly-trade-persistence',
                currentYear: 190,
                currentMonth: 1,
                tickSeconds: 600,
                config: {},
                meta: {},
            },
        });
        const state: TurnWorldState = {
            id: row.id,
            currentYear: 190,
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
                environment: { mapName: map.id, unitSet: 'default' },
            },
            map,
            generals: [],
            cities: [city],
            nations: [],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
        };
        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
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
            const { trade: _trade, ...metaWithoutTrade } = city.meta;
            world.updateCity(city.id, { meta: metaWithoutTrade });
            await dbHooks.hooks.flushChanges?.(checkpoint);
            expect((await db.city.findUniqueOrThrow({ where: { id: cityId } })).trade).toBeNull();

            world.updateCity(city.id, { meta: { ...metaWithoutTrade, trade: 103 } });
            await dbHooks.hooks.flushChanges?.(checkpoint);
            expect((await db.city.findUniqueOrThrow({ where: { id: cityId } })).trade).toBe(103);
        } finally {
            await dbHooks.close();
            await db.worldState.delete({ where: { id: row.id } });
        }
    });
});
