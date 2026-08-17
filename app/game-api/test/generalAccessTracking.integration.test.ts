import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import { z } from 'zod';

import type { GameApiContext } from '../src/context.js';
import { appRouter } from '../src/router.js';
import { upsertGeneralAccess } from '../src/services/generalAccess.js';
import { flushDeferredGeneralAccessBatch } from '../src/services/deferredGeneralAccess.js';
import { accessAuthedInputProcedure, router } from '../src/trpc.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const generalId = 9_980_071;
const secondGeneralId = generalId + 1;
const rollbackGeneralId = generalId + 2;
const zeroWeightGeneralId = generalId + 3;
const endpointGeneralId = generalId + 4;
const endpointUserId = `access-endpoint-user-${endpointGeneralId}`;
const scenarioCode = `traffic-period-${generalId}`;
const endpointRequestPrefix = `access-endpoint-${endpointGeneralId}`;
const yearbookProfile = `access-profile-${endpointGeneralId}`;
const deferredBatchId = `deferred-access-${endpointGeneralId}`;

const endpointAuth = (roles = ['user']): GameSessionTokenPayload => ({
    version: 1,
    profile: `${yearbookProfile}:default`,
    issuedAt: '2026-07-26T00:00:00.000Z',
    expiresAt: '2026-07-27T00:00:00.000Z',
    sessionId: `access-session-${endpointGeneralId}`,
    user: {
        id: endpointUserId,
        username: endpointUserId,
        displayName: endpointUserId,
        roles,
    },
    sanctions: {},
});

const endpointBoundaryRouter = router({
    world: router({
        getGeneralDirectory: accessAuthedInputProcedure(z.object({ accepted: z.literal(true) })).query(() => ({
            ok: true,
        })),
    }),
    general: router({
        setMySetting: accessAuthedInputProcedure(z.object({ accepted: z.literal(true) })).mutation(() => ({
            ok: true,
        })),
    }),
    board: router({
        writeArticle: accessAuthedInputProcedure(z.object({ accepted: z.literal(true) })).mutation(() => {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'business rejected' });
        }),
    }),
});

integration('general access tracking persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;
    let worldStateId: number;
    let previousCoverageVersion: number | null;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        previousCoverageVersion =
            (
                await db.readModelRevisionMeta.findUnique({
                    where: { id: 1 },
                    select: { coverageVersion: true },
                })
            )?.coverageVersion ?? null;
        await db.readModelRevisionMeta.upsert({
            where: { id: 1 },
            create: { id: 1, coverageVersion: 1 },
            update: { coverageVersion: 1 },
        });
        await db.generalAccessLog.deleteMany({
            where: {
                generalId: {
                    in: [generalId, secondGeneralId, rollbackGeneralId, zeroWeightGeneralId, endpointGeneralId],
                },
            },
        });
        await db.generalAccessBatch.deleteMany({ where: { id: deferredBatchId } });
        await db.inputEvent.deleteMany({ where: { requestId: { startsWith: endpointRequestPrefix } } });
        await db.worldState.deleteMany({ where: { scenarioCode } });
        const world = await db.worldState.create({
            data: {
                scenarioCode,
                currentYear: 185,
                currentMonth: 3,
                tickSeconds: 600,
                config: {},
                meta: {},
            },
        });
        worldStateId = world.id;
        await db.general.deleteMany({ where: { id: endpointGeneralId } });
        await db.general.create({
            data: {
                id: endpointGeneralId,
                userId: endpointUserId,
                name: '접속경계',
                turnTime: new Date('2026-07-26T03:00:00.000Z'),
            },
        });
        await db.yearbookHistory.deleteMany({ where: { profileName: yearbookProfile } });
        await db.yearbookHistory.create({
            data: {
                profileName: yearbookProfile,
                sourceId: 1,
                year: 184,
                month: 12,
                map: {
                    year: 184,
                    month: 12,
                    startYear: 180,
                    cityList: [],
                    nationList: [],
                },
                nations: [],
                globalHistory: ['기록'],
                globalAction: ['행동'],
            },
        });
    });

    afterAll(async () => {
        await db.generalAccessLog.deleteMany({
            where: {
                generalId: {
                    in: [generalId, secondGeneralId, rollbackGeneralId, zeroWeightGeneralId, endpointGeneralId],
                },
            },
        });
        await db.generalAccessBatch.deleteMany({ where: { id: deferredBatchId } });
        await db.inputEvent.deleteMany({ where: { requestId: { startsWith: endpointRequestPrefix } } });
        await db.yearbookHistory.deleteMany({ where: { profileName: yearbookProfile } });
        await db.general.deleteMany({ where: { id: endpointGeneralId } });
        await db.worldState.deleteMany({ where: { id: worldStateId } });
        if (previousCoverageVersion === null) {
            await db.readModelRevisionMeta.deleteMany({ where: { id: 1 } });
        } else {
            await db.readModelRevisionMeta.update({
                where: { id: 1 },
                data: { coverageVersion: previousCoverageVersion },
            });
        }
        await closeDb?.();
    });

    it('atomically increments one game-month bucket and opens a new bucket at the next month', async () => {
        const firstWindow = {
            worldStateId,
            year: 185,
            month: 3,
            tickSeconds: 600,
            generalId,
            userId: 'access-user-a',
            now: new Date('2026-07-26T03:05:00.000Z'),
            periodStartedAt: new Date('2026-07-26T03:00:00.000Z'),
            scoreStartedAt: new Date('2026-07-26T03:00:00.000Z'),
        };
        await upsertGeneralAccess(db, { ...firstWindow, weight: 2 });
        await Promise.all(
            Array.from({ length: 20 }, (_, index) =>
                upsertGeneralAccess(db, {
                    ...firstWindow,
                    now: new Date(firstWindow.now.getTime() + index + 1),
                    weight: 1,
                })
            )
        );

        expect(await db.generalAccessLog.findUniqueOrThrow({ where: { generalId } })).toMatchObject({
            userId: 'access-user-a',
            refresh: 22,
            refreshTotal: 22,
            refreshScore: 22,
            refreshScoreTotal: 22,
        });
        const firstPeriod = await db.trafficPeriod.findUniqueOrThrow({
            where: {
                worldStateId_year_month: {
                    worldStateId,
                    year: 185,
                    month: 3,
                },
            },
            include: { generals: { orderBy: { generalId: 'asc' } } },
        });
        expect(firstPeriod).toMatchObject({
            refresh: 22,
            online: 1,
            generals: [
                {
                    generalId,
                    userId: 'access-user-a',
                    refresh: 22,
                },
            ],
        });

        await upsertGeneralAccess(db, {
            worldStateId,
            year: 185,
            month: 4,
            tickSeconds: 600,
            generalId,
            userId: 'access-user-b',
            now: new Date('2026-07-26T03:15:00.000Z'),
            periodStartedAt: new Date('2026-07-26T03:10:00.000Z'),
            scoreStartedAt: new Date('2026-07-26T03:10:00.000Z'),
            weight: 1,
        });

        expect(await db.generalAccessLog.findUniqueOrThrow({ where: { generalId } })).toMatchObject({
            userId: 'access-user-b',
            refresh: 1,
            refreshTotal: 23,
            refreshScore: 1,
            refreshScoreTotal: 23,
        });

        await upsertGeneralAccess(db, {
            worldStateId,
            year: 185,
            month: 4,
            tickSeconds: 600,
            generalId: secondGeneralId,
            userId: 'access-user-c',
            now: new Date('2026-07-26T03:15:01.000Z'),
            periodStartedAt: new Date('2026-07-26T03:10:00.000Z'),
            scoreStartedAt: new Date('2026-07-26T03:10:00.000Z'),
            weight: 1,
        });
        await expect(
            db.trafficPeriod.findUniqueOrThrow({
                where: {
                    worldStateId_year_month: {
                        worldStateId,
                        year: 185,
                        month: 4,
                    },
                },
                include: { generals: { orderBy: { generalId: 'asc' } } },
            })
        ).resolves.toMatchObject({
            refresh: 2,
            online: 2,
            generals: [
                {
                    generalId,
                    userId: 'access-user-b',
                    refresh: 1,
                },
                {
                    generalId: secondGeneralId,
                    userId: 'access-user-c',
                    refresh: 1,
                },
            ],
        });

        await upsertGeneralAccess(db, {
            worldStateId,
            year: 185,
            month: 6,
            tickSeconds: 600,
            generalId,
            userId: 'access-user-b',
            now: new Date('2026-07-26T03:35:00.000Z'),
            periodStartedAt: new Date('2026-07-26T03:30:00.000Z'),
            scoreStartedAt: new Date('2026-07-26T03:30:00.000Z'),
            weight: 1,
        });
        await expect(
            db.trafficPeriod.findUniqueOrThrow({
                where: {
                    worldStateId_year_month: {
                        worldStateId,
                        year: 185,
                        month: 5,
                    },
                },
            })
        ).resolves.toMatchObject({
            startedAt: new Date('2026-07-26T03:20:00.000Z'),
            lastRefresh: new Date('2026-07-26T03:30:00.000Z'),
            refresh: 0,
            online: 0,
        });
    });

    it('rolls back the period and member rows when the legacy access update fails', async () => {
        await db.generalAccessLog.create({
            data: {
                generalId: rollbackGeneralId,
                userId: 'rollback-user',
                lastRefresh: new Date('2026-07-26T03:19:00.000Z'),
                refresh: 1,
                refreshTotal: 2_147_483_647,
                refreshScore: 1,
                refreshScoreTotal: 1,
            },
        });

        await expect(
            upsertGeneralAccess(db, {
                worldStateId,
                year: 186,
                month: 1,
                tickSeconds: 600,
                generalId: rollbackGeneralId,
                userId: 'rollback-user',
                now: new Date('2026-07-26T03:20:00.000Z'),
                periodStartedAt: new Date('2026-07-26T03:20:00.000Z'),
                scoreStartedAt: new Date('2026-07-26T03:20:00.000Z'),
                weight: 1,
            })
        ).rejects.toThrow();

        await expect(
            db.trafficPeriod.findUnique({
                where: {
                    worldStateId_year_month: {
                        worldStateId,
                        year: 186,
                        month: 1,
                    },
                },
            })
        ).resolves.toBeNull();
        await expect(
            db.generalAccessLog.findUniqueOrThrow({ where: { generalId: rollbackGeneralId } })
        ).resolves.toMatchObject({
            refreshTotal: 2_147_483_647,
        });
    });

    it('records weight zero membership and last refresh without changing counters', async () => {
        const now = new Date('2026-07-26T03:40:00.000Z');
        await upsertGeneralAccess(db, {
            worldStateId,
            year: 186,
            month: 2,
            tickSeconds: 600,
            generalId: zeroWeightGeneralId,
            userId: 'zero-weight-user',
            now,
            periodStartedAt: now,
            scoreStartedAt: now,
            weight: 0,
        });

        await expect(
            db.generalAccessLog.findUniqueOrThrow({ where: { generalId: zeroWeightGeneralId } })
        ).resolves.toMatchObject({
            userId: 'zero-weight-user',
            lastRefresh: now,
            refresh: 0,
            refreshTotal: 0,
            refreshScore: 0,
            refreshScoreTotal: 0,
        });
        await expect(
            db.trafficPeriod.findUniqueOrThrow({
                where: {
                    worldStateId_year_month: {
                        worldStateId,
                        year: 186,
                        month: 2,
                    },
                },
                include: { generals: true },
            })
        ).resolves.toMatchObject({
            refresh: 0,
            online: 1,
            generals: [
                {
                    generalId: zeroWeightGeneralId,
                    userId: 'zero-weight-user',
                    refresh: 0,
                    lastRefresh: now,
                },
            ],
        });
    });

    it('runs parser, access, business event, zero-weight, admin, and yearbook cache boundaries on PostgreSQL', async () => {
        const redisEval = vi.fn(async () => 1);
        const context = {
            auth: endpointAuth(),
            db,
            generalAccessTracking: true,
            requestId: endpointRequestPrefix,
            profile: {
                id: `${yearbookProfile}:default`,
                name: yearbookProfile,
                scenario: 'default',
            },
            profileStatusSource: { get: async () => 'RUNNING' as const },
            redis: {
                get: async () => null,
                set: async () => 'OK',
                eval: redisEval,
            },
        } as unknown as GameApiContext;
        const boundaryCaller = endpointBoundaryRouter.createCaller(context);

        const dashboardCaller = appRouter.createCaller(context);
        await expect(dashboardCaller.general.getFrontStatus()).resolves.toBeDefined();
        await expect(db.generalAccessLog.findUnique({ where: { generalId: endpointGeneralId } })).resolves.toBeNull();

        const initialDashboard = await dashboardCaller.dashboard.getContextBundleDelta({
            include: { context: true, commandTable: false, boardAccess: false },
            forceSnapshot: true,
        });
        expect(initialDashboard).toMatchObject({ context: { kind: 'snapshot' } });
        const initialContext = initialDashboard.context;
        if (!initialContext?.sourceRevision) {
            throw new Error('dashboard snapshot did not include its source revision');
        }
        await expect(
            db.generalAccessLog.findUnique({ where: { generalId: endpointGeneralId } })
        ).resolves.toBeNull();
        expect(redisEval).toHaveBeenCalledTimes(1);

        await flushDeferredGeneralAccessBatch(db, deferredBatchId, [
            {
                generalId: endpointGeneralId,
                userId: endpointUserId,
                weight: 1,
                lastRefresh: new Date('2026-07-26T02:55:00.000Z'),
            },
        ]);
        await expect(
            db.generalAccessLog.findUniqueOrThrow({ where: { generalId: endpointGeneralId } })
        ).resolves.toMatchObject({ refresh: 1, refreshTotal: 1 });

        await expect(
            dashboardCaller.dashboard.getContextBundleDelta({
                include: { context: true, commandTable: false, boardAccess: false },
                known: { context: initialContext.revision },
                knownSource: { context: initialContext.sourceRevision },
            })
        ).resolves.toMatchObject({ context: { kind: 'unchanged' } });
        await expect(
            db.generalAccessLog.findUniqueOrThrow({ where: { generalId: endpointGeneralId } })
        ).resolves.toMatchObject({ refresh: 1, refreshTotal: 1 });

        await db.generalAccessLog.delete({ where: { generalId: endpointGeneralId } });
        const realtimeDashboardCaller = appRouter.createCaller({ ...context, realtimeAccessGranted: true });
        await expect(
            realtimeDashboardCaller.dashboard.getContextBundleDelta({
                include: { context: true, commandTable: false, boardAccess: false },
                forceSnapshot: true,
            })
        ).resolves.toMatchObject({ context: { kind: 'snapshot' } });
        await expect(db.generalAccessLog.findUnique({ where: { generalId: endpointGeneralId } })).resolves.toBeNull();

        await expect(boundaryCaller.world.getGeneralDirectory({ accepted: false as true })).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        });
        await expect(db.generalAccessLog.findUnique({ where: { generalId: endpointGeneralId } })).resolves.toBeNull();

        const grantedBoundaryCaller = endpointBoundaryRouter.createCaller({
            ...context,
            realtimeAccessGranted: true,
        });
        await expect(grantedBoundaryCaller.world.getGeneralDirectory({ accepted: true })).resolves.toEqual({
            ok: true,
        });
        await expect(
            db.generalAccessLog.findUniqueOrThrow({ where: { generalId: endpointGeneralId } })
        ).resolves.toMatchObject({
            refresh: 2,
            refreshTotal: 2,
        });

        await expect(boundaryCaller.general.setMySetting({ accepted: true })).resolves.toEqual({ ok: true });
        await expect(
            db.generalAccessLog.findUniqueOrThrow({ where: { generalId: endpointGeneralId } })
        ).resolves.toMatchObject({
            refresh: 2,
            refreshTotal: 2,
        });

        await expect(boundaryCaller.board.writeArticle({ accepted: true })).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: 'business rejected',
        });
        await expect(
            db.generalAccessLog.findUniqueOrThrow({ where: { generalId: endpointGeneralId } })
        ).resolves.toMatchObject({
            refresh: 3,
            refreshTotal: 3,
        });

        const adminCaller = endpointBoundaryRouter.createCaller({
            ...context,
            auth: endpointAuth(['admin']),
        });
        await expect(adminCaller.world.getGeneralDirectory({ accepted: true })).resolves.toEqual({ ok: true });
        await expect(
            db.generalAccessLog.findUniqueOrThrow({ where: { generalId: endpointGeneralId } })
        ).resolves.toMatchObject({
            refresh: 3,
            refreshTotal: 3,
        });

        const yearbookCaller = appRouter.createCaller({
            ...context,
            requestId: `${endpointRequestPrefix}-yearbook`,
        });
        const first = await yearbookCaller.yearbook.getHistory({ year: 184, month: 12 });
        expect(first.notModified).toBe(false);
        await expect(
            db.generalAccessLog.findUniqueOrThrow({ where: { generalId: endpointGeneralId } })
        ).resolves.toMatchObject({
            refresh: 4,
            refreshTotal: 4,
        });

        const cached = await yearbookCaller.yearbook.getHistory({
            year: 184,
            month: 12,
            hash: first.hash,
        });
        expect(cached).toEqual({ notModified: true, hash: first.hash });
        await expect(
            db.generalAccessLog.findUniqueOrThrow({ where: { generalId: endpointGeneralId } })
        ).resolves.toMatchObject({
            refresh: 4,
            refreshTotal: 4,
        });

        await yearbookCaller.yearbook.getHistory({
            year: 184,
            month: 12,
            hash: 'stale-hash',
        });
        await expect(
            db.generalAccessLog.findUniqueOrThrow({ where: { generalId: endpointGeneralId } })
        ).resolves.toMatchObject({
            refresh: 5,
            refreshTotal: 5,
        });
    });
});
