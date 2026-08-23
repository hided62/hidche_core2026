import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Nation } from '@sammo-ts/logic';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createMonthlyEventHandler } from '../src/turn/monthlyEventHandler.js';
import { createScoutBlockHandler } from '../src/turn/monthlyScoutBlockAction.js';
import type { TurnEvent, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const nationIds = [990_081, 990_082] as const;
const neutralNationId = 0;

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
    action: [['BlockScoutAction', true]],
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
        await db.diplomacy.deleteMany({
            where: {
                OR: [{ srcNationId: { in: [...nationIds] } }, { destNationId: { in: [...nationIds] } }],
            },
        });
        await db.nation.deleteMany({ where: { id: { in: [neutralNationId, ...nationIds] } } });
    });

    afterAll(async () => {
        await db.diplomacy.deleteMany({
            where: {
                OR: [{ srcNationId: { in: [...nationIds] } }, { destNationId: { in: [...nationIds] } }],
            },
        });
        await db.nation.deleteMany({ where: { id: { in: [neutralNationId, ...nationIds] } } });
        await closeDb?.();
    });

    it('persists every nation scout flag and the global policy lock in one flush', async () => {
        const neutralNation = { ...buildNation(neutralNationId), name: '재야', level: 0 };
        const nations = [neutralNation, ...nationIds.map(buildNation)];
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
                currentYear: 199,
                currentMonth: 12,
                tickSeconds: 600,
                config: {},
                meta: { block_change_scout: false },
            },
        });
        const state: TurnWorldState = {
            id: row.id,
            currentYear: 199,
            currentMonth: 12,
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
        let world: InMemoryTurnWorld | null = null;
        const handler = createScoutBlockHandler({
            actionName: 'BlockScoutAction',
            getWorld: () => world,
        });
        world = new InMemoryTurnWorld(
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
            {
                schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
                calendarHandler: createMonthlyEventHandler({
                    getWorld: () => world,
                    startYear: 190,
                    actions: new Map([['BlockScoutAction', handler]]),
                }),
            }
        );
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);

        try {
            await world.advanceMonth(new Date('0200-01-01T00:00:00.000Z'));
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
            ).toEqual([
                { power: 0, scout: 1 },
                { power: 0, scout: 1 },
            ]);
            expect(await db.nation.findUniqueOrThrow({ where: { id: neutralNationId } })).toMatchObject({
                meta: { scout: 0 },
            });
            expect(await db.worldState.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
                meta: { block_change_scout: true },
            });
        } finally {
            await hooks.close();
            await db.worldState.delete({ where: { id: row.id } });
        }
    });
});
