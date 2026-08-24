import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { normalizeArchivedGeneral, type ArchivedJsonValue } from '@sammo-ts/common';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import { LogCategory, LogScope } from '@sammo-ts/logic';

import { cancelGame } from '../src/scenario/gameCancellation.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const serverId = 'che_game_cancellation_fixture';
const userId = 'game-cancellation-user';
const generalId = 9_851;
const openedAt = new Date('2026-08-18T00:00:00.000Z');
const cancelledAt = new Date('2026-08-18T01:00:00.000Z');

integration('game cancellation transaction', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const cleanup = async (): Promise<void> => {
        await db.gameCancellation.deleteMany({ where: { serverId } });
        await db.gameInheritanceBaseline.deleteMany({ where: { serverId } });
        await db.unificationFinalization.deleteMany({ where: { serverId } });
        await db.yearbookHistory.deleteMany({ where: { profileName: serverId } });
        await db.emperor.deleteMany({ where: { serverId } });
        await db.oldGeneral.deleteMany({ where: { serverId } });
        await db.oldNation.deleteMany({ where: { serverId } });
        await db.hallOfFame.deleteMany({ where: { serverId } });
        await db.inheritanceResult.deleteMany({ where: { serverId } });
        await db.inheritanceLog.deleteMany({ where: { userId } });
        await db.inheritancePoint.deleteMany({ where: { userId } });
        await db.gameHistory.deleteMany({ where: { serverId } });
        await db.logEntry.deleteMany({ where: { generalId } });
        await db.rankData.deleteMany({ where: { generalId } });
        await db.general.deleteMany({ where: { id: generalId } });
        await db.worldState.deleteMany({ where: { scenarioCode: 'game-cancellation-fixture' } });
    };

    const seed = async (): Promise<void> => {
        await db.worldState.create({
            data: {
                scenarioCode: 'game-cancellation-fixture',
                currentYear: 190,
                currentMonth: 7,
                tickSeconds: 600,
                meta: { serverId, season: 7, isUnited: 0 },
            },
        });
        await db.gameHistory.create({
            data: {
                serverId,
                date: openedAt,
                season: 7,
                scenario: 1010,
                scenarioName: '취소 테스트',
                status: 'OPEN',
                env: { meta: { serverId, season: 7 } },
            },
        });
        await db.general.create({
            data: {
                id: generalId,
                userId,
                name: '취소장수',
                turnTime: openedAt,
                meta: { inherit_spent_dyn: 4_500, dex1: 1, dex2: 1, dex3: 1, dex4: 1, dex5: 1 },
            },
        });
        await db.rankData.createMany({
            data: [
                { generalId, nationId: 0, type: 'inherit_spent_dyn', value: 4_500 },
                { generalId, nationId: 0, type: 'warnum', value: 10 },
                { generalId, nationId: 0, type: 'killnum', value: 6 },
                { generalId, nationId: 0, type: 'deathnum', value: 4 },
                { generalId, nationId: 0, type: 'firenum', value: 2 },
                { generalId, nationId: 0, type: 'killcrew', value: 1_000 },
                { generalId, nationId: 0, type: 'deathcrew', value: 500 },
            ],
        });
        await db.logEntry.createMany({
            data: [
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId,
                    year: 190,
                    month: 7,
                    text: '보존하지 않을 개인 기록',
                },
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.BATTLE_DETAIL,
                    generalId,
                    year: 190,
                    month: 7,
                    text: '보존하지 않을 전투 기록',
                },
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.BATTLE_BRIEF,
                    generalId,
                    year: 190,
                    month: 7,
                    text: '보존할 전투 결과',
                },
            ],
        });
        await db.inheritancePoint.createMany({
            data: [
                { userId, key: 'previous', value: 7_000 },
                { userId, key: 'max_domestic_critical', value: 200 },
            ],
        });
        await db.gameInheritanceBaseline.create({
            data: { serverId, userId, openingPoint: 10_000, source: 'OPENING' },
        });
        await db.inheritanceLog.create({
            data: {
                userId,
                serverId,
                year: 190,
                month: 7,
                text: '신규/복귀 생성으로 포인트 1500 지급',
                createdAt: new Date('2026-08-18T00:30:00.000Z'),
            },
        });
        await db.oldGeneral.create({
            data: {
                serverId,
                generalNo: generalId - 1,
                owner: userId,
                name: '사망장수',
                lastYearMonth: 19006,
                turnTime: openedAt,
                data: { meta: { inherit_spent_dyn: 0 } },
            },
        });
        await db.hallOfFame.create({
            data: { serverId, season: 7, scenario: 1010, generalNo: generalId, type: 'warnum', value: 10 },
        });
        await db.oldNation.create({ data: { serverId, nation: 1, sourceId: 1 } });
        await db.emperor.create({ data: { serverId, name: '취소 황제' } });
        await db.yearbookHistory.create({
            data: { profileName: serverId, year: 190, month: 7, map: {}, nations: {} },
        });
        await db.unificationFinalization.create({
            data: {
                generationKey: `${serverId}:fixture`,
                serverId,
                profileName: 'che',
                winnerNation: 1,
                year: 190,
                month: 7,
                completedAt: cancelledAt,
            },
        });
        await db.inheritanceResult.create({
            data: {
                serverId,
                owner: userId,
                generalId,
                year: 190,
                month: 7,
                value: { refund: 0 },
            },
        });
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
    });

    beforeEach(async () => {
        await cleanup();
        await seed();
    });

    afterAll(async () => {
        await cleanup();
        await closeDb?.();
    });

    it('rolls back a late failure, then refunds spending and retains selected earnings exactly once', async () => {
        const request = {
            cancellationId: 'game-cancellation-retain-fixture',
            databaseUrl: databaseUrl!,
            cancelledBy: 'admin',
            reason: '잘못 연 게임 취소',
            historyMode: 'RETAIN_ABANDONED' as const,
            generalMode: 'RETAIN' as const,
            earnedPointRetentionPercent: 40,
            cancelledAt,
        };

        await expect(cancelGame({ ...request, cancelledBy: 'admin\0invalid' })).rejects.toThrow();
        await expect(db.gameHistory.findUniqueOrThrow({ where: { serverId } })).resolves.toMatchObject({
            status: 'OPEN',
        });
        await expect(
            db.inheritancePoint.findUniqueOrThrow({ where: { userId_key: { userId, key: 'previous' } } })
        ).resolves.toMatchObject({ value: 7_000 });
        await expect(db.hallOfFame.count({ where: { serverId } })).resolves.toBe(1);
        await expect(db.gameCancellation.count({ where: { serverId } })).resolves.toBe(0);

        const result = await cancelGame(request);
        expect(result).toMatchObject({
            participantCount: 1,
            preservedGeneralCount: 2,
            alreadyApplied: false,
            settlements: {
                [userId]: {
                    openingPoint: 10_000,
                    currentPoint: 7_000,
                    earnedPoint: 1_790.005,
                    retainedEarnedPoint: 716,
                    finalPoint: 10_716,
                    baselineSource: 'OPENING',
                },
            },
        });
        await expect(
            db.inheritancePoint.findMany({ where: { userId }, orderBy: { key: 'asc' } })
        ).resolves.toMatchObject([{ key: 'previous', value: 10_716 }]);
        await expect(db.gameHistory.findUniqueOrThrow({ where: { serverId } })).resolves.toMatchObject({
            status: 'ABANDONED',
            winnerNation: null,
        });
        const archived = await db.oldGeneral.findMany({ where: { serverId }, orderBy: { generalNo: 'asc' } });
        expect(archived).toHaveLength(2);
        expect(archived.every((row) => JSON.stringify(row.data).includes(request.cancellationId))).toBe(true);
        const activeArchive = archived.find((row) => row.generalNo === generalId)!;
        const snapshot = normalizeArchivedGeneral(activeArchive.data as ArchivedJsonValue, activeArchive.name).snapshot;
        expect(snapshot).toMatchObject({
            mastery: { infantry: 1, archery: 1, cavalry: 1, special: 1, siege: 1 },
            battle: {
                battles: 10,
                wins: 6,
                losses: 4,
                fireSuccesses: 2,
                killedCrew: 1_000,
                lostCrew: 500,
            },
            records: { battleResult: ['보존할 전투 결과'] },
            availability: { battleResultLogs: true, battleDetailLogs: false },
        });
        expect(JSON.stringify(activeArchive.data)).not.toContain('보존하지 않을 개인 기록');
        expect(JSON.stringify(activeArchive.data)).not.toContain('보존하지 않을 전투 기록');
        await expect(db.hallOfFame.count({ where: { serverId } })).resolves.toBe(0);
        await expect(db.oldNation.count({ where: { serverId } })).resolves.toBe(0);
        await expect(db.emperor.count({ where: { serverId } })).resolves.toBe(0);
        await expect(db.yearbookHistory.count({ where: { profileName: serverId } })).resolves.toBe(0);
        await expect(db.unificationFinalization.count({ where: { serverId } })).resolves.toBe(0);
        await expect(db.inheritanceResult.count({ where: { serverId } })).resolves.toBe(0);
        await expect(db.worldState.findFirstOrThrow()).resolves.toMatchObject({
            meta: expect.objectContaining({ isCancelled: 1, cancellationId: request.cancellationId }),
        });

        await expect(cancelGame(request)).resolves.toMatchObject({ alreadyApplied: true });
        await expect(
            db.inheritanceLog.count({ where: { userId, text: { startsWith: '취소 게임 정산:' } } })
        ).resolves.toBe(1);
    });

    it('physically deletes the numbered history row and past-play general archive on request', async () => {
        const result = await cancelGame({
            cancellationId: 'game-cancellation-delete-fixture',
            databaseUrl: databaseUrl!,
            cancelledBy: 'admin',
            reason: '기수와 장수 기록 삭제',
            historyMode: 'DELETE',
            generalMode: 'DELETE',
            earnedPointRetentionPercent: 0,
            cancelledAt,
        });

        expect(result).toMatchObject({ participantCount: 1, preservedGeneralCount: 0, alreadyApplied: false });
        await expect(db.gameHistory.findUnique({ where: { serverId } })).resolves.toBeNull();
        await expect(db.oldGeneral.count({ where: { serverId } })).resolves.toBe(0);
        await expect(db.gameCancellation.findUnique({ where: { serverId } })).resolves.toMatchObject({
            originalSeason: 7,
            historyMode: 'DELETE',
            generalMode: 'DELETE',
        });
    });

    it('keeps a native inheritance log inside the cancellation boundary under a KST session', async () => {
        const text = '신규/복귀 생성으로 포인트 1500 지급';
        await db.inheritanceLog.deleteMany({ where: { userId, text } });
        const [session] = await db.$queryRaw<Array<{ timeZone: string }>>`
            SELECT current_setting('TIMEZONE') AS "timeZone"
        `;
        expect(session?.timeZone).toBe('Asia/Seoul');

        const createdAfter = Date.now();
        const log = await db.inheritanceLog.create({
            data: { userId, serverId, year: 190, month: 7, text },
        });
        const createdBefore = Date.now();
        expect(log.createdAt.getTime()).toBeGreaterThanOrEqual(createdAfter);
        expect(log.createdAt.getTime()).toBeLessThanOrEqual(createdBefore);

        const result = await cancelGame({
            cancellationId: 'game-cancellation-kst-default-fixture',
            databaseUrl: databaseUrl!,
            cancelledBy: 'admin',
            reason: 'KST 기본값 경계 검증',
            historyMode: 'RETAIN_ABANDONED',
            generalMode: 'RETAIN',
            earnedPointRetentionPercent: 40,
            cancelledAt: new Date(createdBefore + 1_000),
        });
        expect(result.settlements[userId]).toMatchObject({
            earnedPoint: 1_790.005,
            retainedEarnedPoint: 716,
            finalPoint: 10_716,
        });
    });
});
