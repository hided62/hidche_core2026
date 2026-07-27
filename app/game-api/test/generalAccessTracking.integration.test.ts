import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { upsertGeneralAccess } from '../src/services/generalAccess.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const generalId = 9_980_071;
const secondGeneralId = generalId + 1;
const rollbackGeneralId = generalId + 2;
const scenarioCode = `traffic-period-${generalId}`;

integration('general access tracking persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;
    let worldStateId: number;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.generalAccessLog.deleteMany({
            where: { generalId: { in: [generalId, secondGeneralId, rollbackGeneralId] } },
        });
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
    });

    afterAll(async () => {
        await db.generalAccessLog.deleteMany({
            where: { generalId: { in: [generalId, secondGeneralId, rollbackGeneralId] } },
        });
        await db.worldState.deleteMany({ where: { id: worldStateId } });
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
});
