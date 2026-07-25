import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Nation } from '@sammo-ts/logic';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createScoutBlockHandler } from '../src/turn/monthlyScoutBlockAction.js';
import type { TurnEvent, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const nationIds = [990_081, 990_082] as const;

const buildNation = (id: number): Nation => ({
    id,
    name: `임관정책국${id}`,
    color: '#777777',
    capitalCityId: null,
    chiefGeneralId: null,
    gold: 0,
    rice: 0,
    power: 0,
    level: 2,
    typeCode: 'che_중립',
    meta: { scout: 0 },
});

const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [],
    meta: {},
};

integration('monthly scout block persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.nation.deleteMany({ where: { id: { in: [...nationIds] } } });
    });

    afterAll(async () => {
        await db.nation.deleteMany({ where: { id: { in: [...nationIds] } } });
        await closeDb?.();
    });

    it('persists every nation scout flag and the global policy lock in one flush', async () => {
        const nations = nationIds.map(buildNation);
        await db.nation.createMany({
            data: nations.map((nation) => ({
                id: nation.id,
                name: nation.name,
                color: nation.color,
                level: nation.level,
                typeCode: nation.typeCode,
                meta: nation.meta,
            })),
        });
        const row = await db.worldState.create({
            data: {
                scenarioCode: 'monthly-scout-block-persistence',
                currentYear: 200,
                currentMonth: 1,
                tickSeconds: 600,
                config: {},
                meta: { block_change_scout: false },
            },
        });
        const state: TurnWorldState = {
            id: row.id,
            currentYear: 200,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('2026-07-25T00:00:00.000Z'),
            meta: { block_change_scout: false },
        };
        const scenarioConfig: TurnWorldSnapshot['scenarioConfig'] = {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
            iconPath: '.',
            map: {},
            const: {},
            environment: { mapName: 'test', unitSet: 'default' },
        };
        const world = new InMemoryTurnWorld(
            state,
            {
                scenarioConfig,
                map: { id: 'test', name: 'test', cities: [] },
                generals: [],
                cities: [],
                nations,
                troops: [],
                diplomacy: [],
                events: [event],
                initialEvents: [],
            },
            { schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] } }
        );
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);

        try {
            await createScoutBlockHandler({ actionName: 'BlockScoutAction', getWorld: () => world })(
                [true],
                {
                    year: 200,
                    month: 1,
                    startyear: 190,
                    currentEventID: 1,
                    turnTime: state.lastTurnTime,
                },
                event
            );
            await hooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            expect(
                (await db.nation.findMany({ where: { id: { in: [...nationIds] } }, orderBy: { id: 'asc' } })).map(
                    (nation) => nation.meta
                )
            ).toEqual([{ scout: 1 }, { scout: 1 }]);
            expect(await db.worldState.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
                meta: { block_change_scout: true },
            });
        } finally {
            await hooks.close();
            await db.worldState.delete({ where: { id: row.id } });
        }
    });
});
