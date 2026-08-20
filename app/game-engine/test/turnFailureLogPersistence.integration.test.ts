import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient, type InputJsonValue } from '@sammo-ts/infra';
import { LogCategory, LogFormat, LogScope, type TurnSchedule } from '@sammo-ts/logic';

import { createDatabaseTurnHooks, type DatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const worldId = 2_146_200_820;
const generalId = 2_146_200_821;
const turnTime = new Date('0190-01-01T00:00:00.000Z');
const turnRunResult = {
    lastTurnTime: turnTime.toISOString(),
    processedGenerals: 1,
    processedTurns: 1,
    durationMs: 0,
    partial: false,
} as const;

const schedule: TurnSchedule = {
    entries: [{ startMinute: 0, tickMinutes: 10 }],
};

const state: TurnWorldState = {
    id: worldId,
    currentYear: 190,
    currentMonth: 1,
    tickSeconds: 600,
    lastTurnTime: turnTime,
    meta: {},
};

const snapshot: TurnWorldSnapshot = {
    generals: [],
    cities: [],
    nations: [],
    troops: [],
    diplomacy: [],
    events: [],
    initialEvents: [],
    map: {
        id: 'turn-failure-log-persistence',
        name: '턴 실패 로그 영속화',
        cities: [],
        defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
    },
    scenarioConfig: {
        stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
        iconPath: '',
        map: {},
        const: {},
        environment: { mapName: 'che', unitSet: 'che' },
    },
    scenarioMeta: {
        title: '턴 실패 로그 영속화',
        startYear: 190,
        life: null,
        fiction: null,
        history: [],
        ignoreDefaultEvents: false,
    },
};

integration('turn failure personal-record persistence', () => {
    let db: GamePrismaClient;
    let disconnect: (() => Promise<void>) | undefined;
    let databaseHooks: DatabaseTurnHooks | undefined;

    const cleanup = async () => {
        await db.logEntry.deleteMany({ where: { generalId } });
        await db.worldState.deleteMany({ where: { id: worldId } });
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        disconnect = () => connector.disconnect();
        await cleanup();
    });

    afterAll(async () => {
        await databaseHooks?.close();
        await cleanup();
        await disconnect?.();
    });

    it('stores personal and nation-turn failure reasons under the acting general', async () => {
        await db.worldState.create({
            data: {
                id: worldId,
                scenarioCode: 'turn-failure-log-persistence',
                currentYear: state.currentYear,
                currentMonth: state.currentMonth,
                tickSeconds: state.tickSeconds,
                config: snapshot.scenarioConfig as unknown as InputJsonValue,
                meta: {},
            },
        });

        const world = new InMemoryTurnWorld(state, snapshot, { schedule });
        world.pushLog({
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            generalId,
            format: LogFormat.MONTH,
            text: '대상 도시가 아국이 아닙니다. 발령 실패.',
        });
        world.pushLog({
            scope: LogScope.GENERAL,
            category: LogCategory.ACTION,
            generalId,
            format: LogFormat.MONTH,
            text: '같은 도시입니다. 이동 실패.',
        });

        databaseHooks = await createDatabaseTurnHooks(databaseUrl!, world);
        await databaseHooks.hooks.flushChanges?.(turnRunResult);

        const records = await db.logEntry.findMany({
            where: {
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                generalId,
            },
            orderBy: { id: 'asc' },
            select: { generalId: true, text: true },
        });

        expect(records).toEqual([
            { generalId, text: '<C>●</>1월:대상 도시가 아국이 아닙니다. 발령 실패.' },
            { generalId, text: '<C>●</>1월:같은 도시입니다. 이동 실패.' },
        ]);
    });
});
