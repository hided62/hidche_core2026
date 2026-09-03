import { randomUUID } from 'node:crypto';

import {
    createGamePostgresConnector,
    createRedisConnector,
    resolveRedisConfigFromEnv,
    type GamePrismaClient,
    type RedisConnector,
} from '@sammo-ts/infra';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    DeferredGeneralAccessWorker,
    enqueueDeferredGeneralAccess,
    getDeferredGeneralAccessLimit,
} from '../src/services/deferredGeneralAccess.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const liveIntegration = describe.skipIf(!databaseUrl || !process.env.REDIS_URL);

liveIntegration('deferred general access with PostgreSQL and Redis', () => {
    const runId = randomUUID();
    const profile = `deferred-access-${runId}`;
    const userId = `deferred-user-${runId}`;
    const scenarioCode = `deferred-scenario-${runId}`;
    const batchId = `deferred-batch-${runId}`;
    const generalId = 9_981_000 + Math.floor(Math.random() * 900);
    const now = new Date('2026-08-17T03:05:00.000Z');
    const nextAccessAt = new Date('2026-08-17T03:10:00.000Z');
    const auth: GameSessionTokenPayload = {
        version: 1,
        profile,
        issuedAt: '2026-08-17T03:00:00.000Z',
        expiresAt: '2026-08-18T03:00:00.000Z',
        sessionId: `deferred-session-${runId}`,
        user: {
            id: userId,
            username: userId,
            displayName: userId,
            roles: [],
        },
        sanctions: {},
    };
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;
    let redis: RedisConnector;
    let worldStateId: number;

    beforeAll(async () => {
        const dbConnector = createGamePostgresConnector({ url: databaseUrl! });
        await dbConnector.connect();
        db = dbConnector.prisma;
        closeDb = () => dbConnector.disconnect();
        redis = createRedisConnector(resolveRedisConfigFromEnv());
        await redis.connect();
        const world = await db.worldState.create({
            data: {
                scenarioCode,
                currentYear: 200,
                currentMonth: 1,
                tickSeconds: 600,
                config: {},
                meta: {
                    lastTurnTime: '2026-08-17T03:00:00.000Z',
                    refreshLimit: 1,
                },
            },
        });
        worldStateId = world.id;
        await db.general.create({
            data: {
                id: generalId,
                userId,
                name: '지연접속검증',
                turnTime: nextAccessAt,
            },
        });
    });

    afterAll(async () => {
        if (redis) {
            const keys: string[] = [];
            for await (const page of redis.client.scanIterator({
                MATCH: `sammo:game:general-access:*:${profile}*`,
                COUNT: 100,
            })) {
                keys.push(...page);
            }
            if (keys.length > 0) await redis.client.del(keys);
            await redis.disconnect();
        }
        if (db) {
            await db.generalAccessBatch.deleteMany({ where: { id: batchId } });
            await db.generalAccessLog.deleteMany({ where: { generalId } });
            await db.general.deleteMany({ where: { id: generalId } });
            await db.worldState.deleteMany({ where: { id: worldStateId } });
            await closeDb?.();
        }
    });

    it('aggregates Redis increments, flushes once, and installs a lazy limit marker', async () => {
        const workerDb = {
            worldState: {
                findFirst: () =>
                    db.worldState.findUniqueOrThrow({
                        where: { id: worldStateId },
                        select: {
                            id: true,
                            currentYear: true,
                            currentMonth: true,
                            tickSeconds: true,
                            meta: true,
                        },
                    }),
            },
            $transaction: db.$transaction.bind(db),
            $queryRaw: db.$queryRaw.bind(db),
            $executeRaw: db.$executeRaw.bind(db),
        };
        const worker = new DeferredGeneralAccessWorker(
            workerDb as never,
            redis.client,
            profile,
            { get: async () => 'RUNNING' },
            { now: () => now, createBatchId: () => batchId }
        );

        await enqueueDeferredGeneralAccess(redis.client, profile, auth, generalId, 1, now);
        await enqueueDeferredGeneralAccess(redis.client, profile, auth, generalId, 1, now);
        await expect(db.generalAccessLog.findUnique({ where: { generalId } })).resolves.toBeNull();

        await worker.flushOnce();
        await expect(db.generalAccessLog.findUniqueOrThrow({ where: { generalId } })).resolves.toMatchObject({
            userId,
            refresh: 2,
            refreshTotal: 2,
            refreshScore: 2,
            refreshScoreTotal: 2,
        });
        await expect(
            db.trafficPeriod.findUniqueOrThrow({
                where: {
                    worldStateId_year_month: {
                        worldStateId,
                        year: 200,
                        month: 1,
                    },
                },
            })
        ).resolves.toMatchObject({ refresh: 2, online: 1 });
        await expect(getDeferredGeneralAccessLimit(redis.client, profile, auth, now)).resolves.toEqual({
            nextAccessAt,
        });

        await worker.flushOnce();
        await expect(db.generalAccessLog.findUniqueOrThrow({ where: { generalId } })).resolves.toMatchObject({
            refreshTotal: 2,
        });
    });
});
