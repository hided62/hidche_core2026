import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const generalId = 991_815;
const scenarioCode = 'general-access-score-reset-persistence';

integration('general access score reset persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const cleanup = async () => {
        await db.generalAccessLog.deleteMany({ where: { generalId } });
        await db.general.deleteMany({ where: { id: generalId } });
        await db.worldState.deleteMany({ where: { scenarioCode } });
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await cleanup();
    });

    afterAll(async () => {
        await cleanup();
        await closeDb?.();
    });

    it('commits the own-turn reset marker in the same world flush', async () => {
        const turnTime = new Date('2026-08-15T00:10:00.000Z');
        await db.general.create({
            data: {
                id: generalId,
                userId: 'access-reset-persistence-user',
                name: '접속점수초기화장수',
                turnTime,
            },
        });
        await db.generalAccessLog.create({
            data: {
                generalId,
                userId: 'access-reset-persistence-user',
                lastRefresh: new Date('2026-08-15T00:09:59.000Z'),
                refresh: 120,
                refreshTotal: 500,
                refreshScore: 351,
                refreshScoreTotal: 999,
            },
        });
        const row = await db.worldState.create({
            data: {
                scenarioCode,
                currentYear: 200,
                currentMonth: 1,
                tickSeconds: 600,
                config: {},
                meta: {},
            },
        });
        const state: TurnWorldState = {
            id: row.id,
            currentYear: 200,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('2026-08-15T00:00:00.000Z'),
            meta: {},
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
                nations: [],
                troops: [],
                diplomacy: [],
                events: [],
                initialEvents: [],
            },
            { schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] } }
        );
        world.markGeneralAccessScoreReset(generalId);
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);

        try {
            await hooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 1,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            expect(await db.generalAccessLog.findUniqueOrThrow({ where: { generalId } })).toMatchObject({
                refresh: 120,
                refreshTotal: 500,
                refreshScore: 0,
                refreshScoreTotal: 999,
            });
            expect(world.peekDirtyState().accessScoreResetGeneralIds).toEqual([]);
        } finally {
            await hooks.close();
        }
    });
});
