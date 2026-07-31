import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { encryptGameSessionToken } from '../../../packages/common/dist/auth/gameToken.js';
import { createTurnDaemonRuntime, seedScenarioToDatabase } from '../../game-engine/dist/index.js';
import { createGamePostgresConnector } from '../../../packages/infra/dist/index.js';

const databaseUrl = process.env.JOIN_LIVE_DATABASE_URL;
const gameTokenSecret = process.env.JOIN_LIVE_GAME_SECRET;
const profile = process.env.PLAYWRIGHT_GAME_PROFILE ?? 'create_general_integration:2';
const userId = 'join-general-live-user';
const hasLiveFixture = Boolean(databaseUrl && gameTokenSecret);

const installSession = async (page: Page): Promise<void> => {
    const now = new Date();
    const gameToken = encryptGameSessionToken(
        {
            version: 1,
            profile,
            issuedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
            sessionId: `join-live-${randomUUID()}`,
            user: {
                id: userId,
                username: 'join-live-user',
                displayName: '브라우저생성',
                roles: ['user'],
                legacyMemberNo: 7_700,
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
            window.localStorage.setItem('sammo-game-token', token);
            window.localStorage.setItem('sammo-game-profile', gameProfile);
        },
        { token: gameToken, gameProfile: profile }
    );
};

test.describe('generic general creation through live PostgreSQL, Redis, API, and Chromium', () => {
    test.skip(!hasLiveFixture, 'live join token and database are required');

    let db: ReturnType<typeof createGamePostgresConnector>['prisma'];
    let closeDb: (() => Promise<void>) | undefined;
    let runtime: Awaited<ReturnType<typeof createTurnDaemonRuntime>> | undefined;
    let daemonLoop: Promise<void> | undefined;

    test.beforeAll(async () => {
        const schema = new URL(databaseUrl!).searchParams.get('schema');
        if (schema !== 'create_general_integration') {
            throw new Error(`Refusing to mutate non-dedicated schema: ${schema ?? '(missing)'}`);
        }
        await seedScenarioToDatabase({
            scenarioId: 2,
            databaseUrl: databaseUrl!,
            now: new Date('2099-07-30T12:00:00.000Z'),
            installOptions: {
                turnTermMinutes: 5,
                npcMode: 0,
                showImgLevel: 3,
                serverId: profile,
                season: 1,
            },
        });
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.inputEvent.deleteMany();
        runtime = await createTurnDaemonRuntime({
            profile,
            databaseUrl: databaseUrl!,
            enableDatabaseFlush: true,
            enableLeaseHeartbeat: false,
            leaseOwnerId: 'join-general-live-daemon',
        });
        daemonLoop = runtime.lifecycle.start();
    });

    test.afterAll(async () => {
        if (runtime) {
            await runtime.lifecycle.stop('join general live complete');
            await daemonLoop;
            await runtime.close();
        }
        await closeDb?.();
    });

    test('keeps the request id across an accepted timeout and creates exactly once', async ({ page }, testInfo) => {
        const requestIds: string[] = [];
        let injectTimeout = true;
        await installSession(page);
        await page.route('**/trpc/join.createGeneral?batch=1', async (route) => {
            const findClientRequestId = (value: unknown): string | undefined => {
                if (!value || typeof value !== 'object') return undefined;
                if ('clientRequestId' in value && typeof value.clientRequestId === 'string') {
                    return value.clientRequestId;
                }
                for (const nested of Object.values(value)) {
                    const found = findClientRequestId(nested);
                    if (found) return found;
                }
                return undefined;
            };
            const clientRequestId = findClientRequestId(route.request().postDataJSON());
            expect(clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
            requestIds.push(clientRequestId!);
            if (!injectTimeout) {
                await route.continue();
                return;
            }
            injectTimeout = false;
            const accepted = await route.fetch();
            expect(accepted.ok()).toBe(true);
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([
                    {
                        error: {
                            message:
                                '장수 생성 요청은 접수됐지만 처리 결과를 아직 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.',
                            code: -32008,
                            data: {
                                code: 'TIMEOUT',
                                httpStatus: 408,
                                path: 'join.createGeneral',
                            },
                        },
                    },
                ]),
            });
        });

        await page.setViewportSize({ width: 1200, height: 900 });
        await page.goto('join');
        await expect(page.getByRole('heading', { name: '장수 생성/빙의' })).toBeVisible();
        const createButton = page.locator('.form-actions').getByRole('button', {
            name: '장수 생성',
            exact: true,
        });
        await expect(createButton).toBeEnabled();
        await expect(page.getByText('은둔', { exact: true })).toHaveCount(0);

        const geometry = await page.locator('.join-page').evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                width: rect.width,
                minHeight: style.minHeight,
                padding: style.padding,
            };
        });
        expect(geometry).toEqual({
            width: 1200,
            minHeight: '900px',
            padding: '24px',
        });
        await createButton.focus();
        await expect(createButton).toBeFocused();
        await page.screenshot({
            path: testInfo.outputPath('join-general-focused.png'),
            fullPage: true,
        });

        await createButton.click();
        await expect(page.locator('.join-error')).toContainText('같은 요청으로 다시 시도해 주세요.');
        await expect.poll(() => db.general.count({ where: { userId } })).toBe(1);
        const storedPending = await page.evaluate(() =>
            window.sessionStorage.getItem('sammo-join-create-pending-action')
        );
        expect(storedPending).toContain(requestIds[0]);

        await createButton.click();
        await expect(page).toHaveURL(/\/hwe\/$/);
        expect(requestIds).toHaveLength(2);
        expect(requestIds[1]).toBe(requestIds[0]);
        await expect.poll(() => db.general.count({ where: { userId } })).toBe(1);
        const created = await db.general.findFirstOrThrow({ where: { userId } });
        expect(created).toMatchObject({
            name: '브라우저생성',
            picture: 'default.jpg',
        });
        const event = await db.inputEvent.findFirstOrThrow({
            where: { actorUserId: userId, eventType: 'joinCreateGeneral' },
        });
        expect(event).toMatchObject({ status: 'SUCCEEDED', attempts: 1 });
        expect(await page.evaluate(() => window.sessionStorage.getItem('sammo-join-create-pending-action'))).toBeNull();
    });
});
