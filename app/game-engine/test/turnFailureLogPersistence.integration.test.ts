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

integration('turn persistence connection acquisition', () => {
    let connector: ReturnType<typeof createGamePostgresConnector>;
    let hooks: DatabaseTurnHooks;
    const fixtureWorldId = worldId + 10;

    beforeAll(async () => {
        connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        await connector.prisma.worldState.create({
            data: {
                id: fixtureWorldId,
                scenarioCode: 'transaction-acquisition',
                currentYear: state.currentYear,
                currentMonth: state.currentMonth,
                tickSeconds: state.tickSeconds,
                clockBaseTime: turnTime,
                clockWallAnchor: turnTime,
                clockMode: 'manual',
                clockPhase: 'MANUAL',
                clockTick: 0n,
                lastTurnTick: 0n,
            },
        });
        hooks = await createDatabaseTurnHooks(
            databaseUrl!,
            new InMemoryTurnWorld({ ...state, id: fixtureWorldId }, snapshot, { schedule }),
            { transactionTimeoutMs: 1_000 }
        );
    });

    afterAll(async () => {
        await hooks?.close();
        await connector?.prisma.worldState.deleteMany({ where: { id: fixtureWorldId } });
        await connector?.disconnect();
    });

    const occupyPool = async () => {
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const started: Promise<void>[] = [];
        const blockers = Array.from({ length: connector.getPoolStats().max }, () => {
            let markStarted!: () => void;
            started.push(new Promise<void>((resolve) => (markStarted = resolve)));
            return connector.prisma.$transaction(
                async (tx) => {
                    await tx.$queryRaw`SELECT 1`;
                    markStarted();
                    await held;
                },
                { maxWait: 10_000, timeout: 20_000 }
            );
        });
        // Attach handlers immediately so a setup failure cannot leak transactions.
        const settled = Promise.allSettled(blockers);
        try {
            await Promise.all(started);
        } catch (error) {
            release();
            await settled;
            throw error;
        }
        return { release, settled };
    };

    it('waits beyond Prisma default without spending the callback execution budget', async () => {
        const held = await occupyPool();
        const sync = hooks.synchronizeClockAuthority();
        // Observe the result immediately; the old 2-second default rejects here.
        const outcome = sync.then(
            (value) => ({ ok: true, value }),
            (error: unknown) => ({ ok: false, error })
        );
        try {
            const deadline = Date.now() + 1_000;
            while (!connector.getPoolStats().waiting && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            expect(connector.getPoolStats().waiting).toBeGreaterThan(0);
            await new Promise((resolve) => setTimeout(resolve, 2_500));
            held.release();
            expect(await outcome).toMatchObject({ ok: true });
        } finally {
            held.release();
            await held.settled;
            await outcome;
        }
    }, 15_000);

    it('still rejects sustained connection exhaustion at the finite acquisition limit', async () => {
        const held = await occupyPool();
        try {
            await expect(hooks.synchronizeClockAuthority()).rejects.toMatchObject({ code: 'P2028' });
        } finally {
            held.release();
            await held.settled;
        }
        // Timed-out acquisition must not prevent the next normal operation.
        await expect(hooks.synchronizeClockAuthority()).resolves.toBeTypeOf('boolean');
    }, 15_000);
});
