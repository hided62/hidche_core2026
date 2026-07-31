import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { encryptGameSessionToken } from '../../../packages/common/dist/auth/gameToken.js';
import { createTurnDaemonRuntime, seedScenarioToDatabase } from '../../game-engine/dist/index.js';
import { createGamePostgresConnector } from '../../../packages/infra/dist/index.js';

const databaseUrl = process.env.DIE_ON_PRESTART_LIVE_DATABASE_URL;
const redisUrl = process.env.DIE_ON_PRESTART_LIVE_REDIS_URL;
const gameTokenSecret = process.env.DIE_ON_PRESTART_LIVE_GAME_SECRET;
const profile = process.env.PLAYWRIGHT_GAME_PROFILE ?? 'die_on_prestart_live_integration:2';
const archiveServerId = 'die_prestart:2';
const scenarioId = Number(process.env.PLAYWRIGHT_SCENARIO ?? '2');
const userId = 'die-prestart-live-user';
const generalId = 991_741;
const memberId = 991_742;
const hasLiveFixture = Boolean(databaseUrl && redisUrl && gameTokenSecret);

const installSession = async (page: Page): Promise<void> => {
    const now = new Date();
    const gameToken = encryptGameSessionToken(
        {
            version: 1,
            profile,
            issuedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
            sessionId: `die-prestart-live-${randomUUID()}`,
            user: {
                id: userId,
                username: 'die-prestart-live',
                displayName: '실삭제사용자',
                roles: ['user'],
                legacyMemberNo: 7_741,
                canUseGeneralPicture: false,
            },
            sanctions: {},
            identity: {
                kakaoVerified: true,
                canCreateGeneral: true,
                requiresKakaoVerification: false,
                graceEndsAt: null,
            },
        },
        gameTokenSecret!
    );
    await page.addInitScript(
        ({ token, gameProfile }) => {
            if (location.pathname.startsWith('/che/')) {
                window.localStorage.setItem('sammo-game-token', token);
                window.localStorage.setItem('sammo-game-profile', gameProfile);
            }
        },
        { token: gameToken, gameProfile: profile }
    );
};

test.describe('pre-start deletion through live PostgreSQL, Redis, API, daemon, and Chromium', () => {
    test.skip(!hasLiveFixture, 'live pre-start deletion token, Redis, and database are required');

    let db: ReturnType<typeof createGamePostgresConnector>['prisma'];
    let closeDb: (() => Promise<void>) | undefined;
    let runtime: Awaited<ReturnType<typeof createTurnDaemonRuntime>> | undefined;
    let daemonLoop: Promise<void> | undefined;

    test.beforeAll(async () => {
        const schema = new URL(databaseUrl!).searchParams.get('schema');
        if (!schema?.endsWith('die_on_prestart_live_integration')) {
            throw new Error(`Refusing non-dedicated schema: ${schema ?? '(missing)'}`);
        }
        const previousSeed = process.env.INTEGRATION_WORLD_SEED;
        process.env.INTEGRATION_WORLD_SEED = 'die-on-prestart-live-seed';
        try {
            await seedScenarioToDatabase({
                scenarioId,
                databaseUrl: databaseUrl!,
                now: new Date('2099-07-31T12:00:00.000Z'),
                installOptions: {
                    turnTermMinutes: 5,
                    npcMode: 0,
                    showImgLevel: 3,
                    serverId: profile,
                    season: 1,
                },
            });
        } finally {
            if (previousSeed === undefined) {
                delete process.env.INTEGRATION_WORLD_SEED;
            } else {
                process.env.INTEGRATION_WORLD_SEED = previousSeed;
            }
        }

        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.inputEvent.deleteMany();
        await db.logEntry.deleteMany();
        const worldState = await db.worldState.findFirstOrThrow();
        await db.worldState.update({
            where: { id: worldState.id },
            data: {
                meta: {
                    ...(worldState.meta as Record<string, unknown>),
                    serverId: archiveServerId,
                },
            },
        });
        await db.oldGeneral.deleteMany({ where: { serverId: archiveServerId, generalNo: generalId } });
        await db.inheritanceResult.deleteMany({ where: { serverId: archiveServerId, owner: userId } });
        await db.inheritanceLog.deleteMany({ where: { userId } });
        await db.inheritancePoint.deleteMany({ where: { userId } });
        await db.selectPoolEntry.deleteMany({ where: { uniqueName: '실삭제풀' } });
        await db.general.deleteMany({ where: { id: { in: [generalId, memberId] } } });

        const city = await db.city.findFirstOrThrow({ orderBy: { id: 'asc' } });
        const availableAt = new Date(Date.now() - 60_000);
        await db.general.createMany({
            data: [
                {
                    id: generalId,
                    userId,
                    name: '실삭제장수',
                    nationId: 0,
                    cityId: city.id,
                    troopId: generalId,
                    npcState: 0,
                    leadership: 70,
                    strength: 60,
                    intel: 50,
                    turnTime: new Date('2099-07-31T12:05:00.000Z'),
                    meta: {
                        killturn: 6,
                        prestart_delete_after: availableAt.toISOString(),
                        inheritRandomUnique: true,
                        inheritSpecificSpecialWar: true,
                    },
                    penalty: {},
                },
                {
                    id: memberId,
                    userId: null,
                    name: '실삭제부대원',
                    nationId: 0,
                    cityId: city.id,
                    troopId: generalId,
                    npcState: 2,
                    leadership: 50,
                    strength: 50,
                    intel: 50,
                    turnTime: new Date('2099-07-31T12:05:00.000Z'),
                    meta: { killturn: 6 },
                    penalty: {},
                },
            ],
        });
        await db.troop.create({
            data: { troopLeaderId: generalId, nationId: 0, name: '실삭제부대' },
        });
        await db.generalAccessLog.create({
            data: { generalId, userId, lastRefresh: new Date(availableAt.getTime() - 10 * 60_000) },
        });
        await db.generalTurn.create({
            data: { generalId, turnIdx: 0, actionCode: '휴식', arg: {} },
        });
        await db.generalTurnRevision.create({
            data: { generalId, revision: 1 },
        });
        await db.rankData.create({
            data: { generalId, nationId: 0, type: 'warnum', value: 1 },
        });
        await db.selectPoolEntry.create({
            data: {
                uniqueName: '실삭제풀',
                ownerUserId: userId,
                generalId,
                reservedUntil: new Date(Date.now() + 3_600_000),
                info: {},
            },
        });
        await db.inheritancePoint.create({
            data: { userId, key: 'previous', value: 100 },
        });

        runtime = await createTurnDaemonRuntime({
            profile,
            databaseUrl: databaseUrl!,
            enableDatabaseFlush: true,
            enableLeaseHeartbeat: false,
            leaseOwnerId: 'die-on-prestart-live-daemon',
        });
        daemonLoop = runtime.lifecycle.start();
    });

    test.afterAll(async () => {
        if (runtime) {
            await runtime.lifecycle.stop('pre-start deletion live complete');
            await daemonLoop;
            await runtime.close();
        }
        await closeDb?.();
    });

    test('deletes the owned general and its lifecycle state from the actual UI', async ({ page }, testInfo) => {
        const dialogs: string[] = [];
        await installSession(page);
        await page.route('**/image/game/**', (route) =>
            route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from('') })
        );
        await page.route('**/gateway/**', (route) =>
            route.fulfill({
                status: 200,
                contentType: 'text/html',
                body: '<!doctype html><html><body>gateway</body></html>',
            })
        );
        page.on('dialog', async (dialog) => {
            dialogs.push(`${dialog.type()}:${dialog.message()}`);
            await dialog.accept();
        });

        await page.setViewportSize({ width: 1000, height: 900 });
        await page.goto('my-page');
        const actionLine = page.locator('.action-line').filter({ hasText: '가오픈 기간 내 장수 삭제' });
        const deleteButton = actionLine.getByRole('button', { name: '장수 삭제' });
        await expect(actionLine).toContainText('가오픈 기간 내 장수 삭제');
        await expect(deleteButton).toBeVisible();
        await expect(deleteButton).toHaveCSS('width', '160px');
        await expect(deleteButton).toHaveCSS('height', '30px');
        await expect(deleteButton).toHaveCSS('background-color', 'rgb(34, 85, 0)');
        await deleteButton.click();

        await page.waitForURL(/\/gateway\/$/u);
        await expect(page.locator('body')).toHaveText('gateway');
        expect(dialogs).toEqual(['confirm:정말로 삭제하시겠습니까?']);
        const event = await db.inputEvent.findFirstOrThrow({
            where: { actorUserId: userId, eventType: 'dieOnPrestart' },
            orderBy: { createdAt: 'desc' },
        });
        const requestPrefix = `general:dieOnPrestart:${userId}:`;
        expect(event.requestId.startsWith(requestPrefix)).toBe(true);
        const clientRequestId = event.requestId.slice(requestPrefix.length);
        expect(clientRequestId).toMatch(/^[0-9a-f-]{36}$/iu);

        await expect(db.general.findUnique({ where: { id: generalId } })).resolves.toBeNull();
        await expect(db.general.findUniqueOrThrow({ where: { id: memberId } })).resolves.toMatchObject({
            troopId: 0,
        });
        await expect(db.troop.findUnique({ where: { troopLeaderId: generalId } })).resolves.toBeNull();
        await expect(db.generalAccessLog.findUnique({ where: { generalId } })).resolves.toBeNull();
        await expect(db.generalTurn.count({ where: { generalId } })).resolves.toBe(0);
        await expect(db.generalTurnRevision.findUnique({ where: { generalId } })).resolves.toBeNull();
        await expect(db.rankData.count({ where: { generalId } })).resolves.toBe(0);
        await expect(
            db.selectPoolEntry.findUniqueOrThrow({ where: { uniqueName: '실삭제풀' } })
        ).resolves.toMatchObject({
            ownerUserId: null,
            generalId: null,
            reservedUntil: null,
        });
        const archived = await db.oldGeneral.findUniqueOrThrow({
            where: { by_no: { serverId: archiveServerId, generalNo: generalId } },
        });
        const archivedData = archived.data as { troopId?: number; meta?: Record<string, unknown> };
        expect(archivedData.troopId).toBe(0);
        expect(archivedData.meta).not.toHaveProperty('inheritRandomUnique');
        expect(archivedData.meta).not.toHaveProperty('inheritSpecificSpecialWar');
        await expect(
            db.inheritancePoint.findUniqueOrThrow({ where: { userId_key: { userId, key: 'previous' } } })
        ).resolves.toMatchObject({ value: 7_105 });
        const inheritanceResult = await db.inheritanceResult.findFirstOrThrow({
            where: { serverId: archiveServerId, owner: userId },
        });
        expect(inheritanceResult).toMatchObject({ generalId });
        expect(inheritanceResult.value).toMatchObject({
            previous: 100,
            refund: 7_000,
            combat: 5,
        });
        expect(
            (
                await db.inheritanceLog.findMany({
                    where: { userId },
                    orderBy: { id: 'asc' },
                    select: { text: true },
                })
            ).map((entry: { text: string }) => entry.text)
        ).toEqual([
            '사망으로 랜덤 유니크 구입 3000 포인트 반환',
            '사망으로 전투 특기 지정 4000 포인트 반환',
            '사망 정산: 7,105 포인트',
        ]);
        await expect(
            db.logEntry.findFirstOrThrow({
                where: {
                    scope: 'SYSTEM',
                    category: 'SUMMARY',
                    text: { contains: '<Y>실삭제장수</>가 홀연히 모습을 <R>감추었습니다</>' },
                },
            })
        ).resolves.toBeDefined();
        expect(event).toMatchObject({
            status: 'SUCCEEDED',
            attempts: 1,
            actorUserId: userId,
        });
        expect(
            await page.evaluate(() => ({
                gameToken: localStorage.getItem('sammo-game-token'),
                gameProfile: localStorage.getItem('sammo-game-profile'),
            }))
        ).toEqual({
            gameToken: null,
            gameProfile: profile,
        });
        await page.screenshot({
            path: testInfo.outputPath('die-on-prestart-live-success.png'),
            fullPage: true,
        });
    });
});
