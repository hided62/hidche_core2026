import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { encryptGameSessionToken } from '../../../packages/common/dist/auth/gameToken.js';
import { createTurnDaemonRuntime, seedScenarioToDatabase } from '../../game-engine/dist/index.js';
import { createGamePostgresConnector } from '../../../packages/infra/dist/index.js';

const databaseUrl = process.env.NPC_POSSESSION_LIVE_DATABASE_URL;
const redisUrl = process.env.NPC_POSSESSION_LIVE_REDIS_URL;
const gameTokenSecret = process.env.NPC_POSSESSION_LIVE_GAME_SECRET;
const profile = process.env.PLAYWRIGHT_GAME_PROFILE ?? 'npc_possession_integration:2';
const scenarioId = Number(process.env.PLAYWRIGHT_SCENARIO ?? '2');
const userId = 'npc-possession-live-user';
const hasLiveFixture = Boolean(databaseUrl && redisUrl && gameTokenSecret);

if (!Number.isSafeInteger(scenarioId) || scenarioId <= 0 || profile !== `${profile.split(':', 1)[0]}:${scenarioId}`) {
    throw new Error(`NPC possession live scenario/profile mismatch: ${profile} / ${scenarioId}`);
}

const installSession = async (page: Page): Promise<void> => {
    const now = new Date();
    const gameToken = encryptGameSessionToken(
        {
            version: 1,
            profile,
            issuedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
            sessionId: `npc-possession-live-${randomUUID()}`,
            user: {
                id: userId,
                username: 'npc-possession-live-user',
                displayName: '브라우저빙의',
                roles: ['user'],
                legacyMemberNo: 7_710,
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

test.describe('NPC possession through live PostgreSQL, Redis, API, daemon, and Chromium', () => {
    test.skip(!hasLiveFixture, 'live NPC possession token and database are required');

    let db: ReturnType<typeof createGamePostgresConnector>['prisma'];
    let closeDb: (() => Promise<void>) | undefined;
    let runtime: Awaited<ReturnType<typeof createTurnDaemonRuntime>> | undefined;
    let daemonLoop: Promise<void> | undefined;

    const startDaemon = async (): Promise<void> => {
        if (runtime) {
            return;
        }
        runtime = await createTurnDaemonRuntime({
            profile,
            databaseUrl: databaseUrl!,
            enableDatabaseFlush: true,
            enableLeaseHeartbeat: false,
            leaseOwnerId: 'npc-possession-live-daemon',
        });
        daemonLoop = runtime.lifecycle.start();
    };

    test.beforeAll(async () => {
        const schema = new URL(databaseUrl!).searchParams.get('schema');
        const profileId = profile.split(':', 1)[0] ?? '';
        if (schema !== profileId || !schema.endsWith('npc_possession_integration')) {
            throw new Error(
                `Refusing mismatched or non-dedicated schema: ${schema ?? '(missing)'} != ${profileId ?? '(missing)'}`
            );
        }
        const previousSeed = process.env.INTEGRATION_WORLD_SEED;
        process.env.INTEGRATION_WORLD_SEED = 'npc-possession-live-seed';
        try {
            await seedScenarioToDatabase({
                scenarioId,
                databaseUrl: databaseUrl!,
                now: new Date('2099-07-31T12:00:00.000Z'),
                installOptions: {
                    turnTermMinutes: 5,
                    npcMode: 1,
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
        await db.npcSelectionToken.deleteMany();
        const city = await db.city.findFirstOrThrow({ orderBy: { id: 'asc' } });
        await db.general.createMany({
            data: Array.from({ length: 12 }, (_, index) => ({
                id: index + 1,
                userId: null,
                name: `실브라우저후보${index + 1}`,
                nationId: 0,
                cityId: city.id,
                npcState: 2,
                leadership: 40 + index,
                strength: 50 + index,
                intel: 60 + index,
                turnTime: new Date('2099-07-31T12:05:00.000Z'),
                personalCode: 'che_안전',
                specialCode: 'che_인덕',
                special2Code: 'che_무쌍',
                picture: 'default.jpg',
                imageServer: 0,
                meta: { killturn: 6 },
                penalty: {},
            })),
        });
    });

    test.afterAll(async () => {
        if (runtime) {
            await runtime.lifecycle.stop('NPC possession live complete');
            await daemonLoop;
            await runtime.close();
        }
        await closeDb?.();
    });

    test('retries one pending possession after the actual daemon transport timeout', async ({ page }, testInfo) => {
        const requestIds: string[] = [];
        await installSession(page);
        await page.route('**/image/icons/**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'image/svg+xml',
                body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#777"/></svg>',
            });
        });
        page.on('request', (request) => {
            if (!request.url().includes('/trpc/join.possessGeneral?batch=1')) {
                return;
            }
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
            const clientRequestId = findClientRequestId(request.postDataJSON());
            expect(clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
            requestIds.push(clientRequestId!);
        });

        await page.setViewportSize({ width: 1024, height: 900 });
        await page.goto('join?tab=possess');
        await expect(page.getByRole('button', { name: 'NPC 빙의' })).toHaveClass(/active/);
        await expect(page.locator('.npc-card')).toHaveCount(5);
        const geometry = await page.locator('.npc-possession-section').evaluate((section) => ({
            width: section.getBoundingClientRect().width,
            cardWidths: [...section.querySelectorAll<HTMLElement>('.npc-card')].map(
                (card) => card.getBoundingClientRect().width
            ),
        }));
        expect(geometry).toEqual({
            width: 1000,
            cardWidths: [125, 125, 125, 125, 125],
        });

        const dialogs: string[] = [];
        page.on('dialog', async (dialog) => {
            dialogs.push(dialog.message());
            await dialog.accept();
        });
        const possessButton = page.locator('.npc-action').first();
        await possessButton.click();
        await expect(page.locator('.join-error')).toContainText('같은 요청으로 다시 시도해 주세요.');
        expect(await db.general.count({ where: { userId } })).toBe(0);
        const pending = await page.evaluate(() => window.sessionStorage.getItem('sammo-npc-possess-pending-action'));
        expect(pending).toContain(requestIds[0]);
        const eventRequestId = `npc-possess:${userId}:${requestIds[0]}`;
        const pendingEvent = await db.inputEvent.findUniqueOrThrow({
            where: { requestId: eventRequestId },
        });
        expect(pendingEvent).toMatchObject({
            status: 'PENDING',
            attempts: 0,
            result: null,
            error: null,
            completedAt: null,
        });
        await expect(db.npcSelectionToken.findUnique({ where: { ownerUserId: userId } })).resolves.not.toBeNull();

        await startDaemon();
        await possessButton.click();
        const successDialog = page.getByRole('alertdialog', { name: '완료' });
        await expect(successDialog).toContainText('빙의에 성공했습니다.');
        await successDialog.getByRole('button', { name: '확인' }).click();
        await expect(page).toHaveURL(/\/hwe\/$/);
        expect(requestIds).toHaveLength(2);
        expect(requestIds[1]).toBe(requestIds[0]);
        expect(await db.general.count({ where: { userId } })).toBe(1);
        await expect(db.npcSelectionToken.findUnique({ where: { ownerUserId: userId } })).resolves.toBeNull();
        expect(await page.evaluate(() => window.sessionStorage.getItem('sammo-npc-possess-pending-action'))).toBeNull();
        const event = await db.inputEvent.findUniqueOrThrow({
            where: { requestId: eventRequestId },
        });
        expect(event).toMatchObject({ status: 'SUCCEEDED', attempts: 1 });

        await page.screenshot({
            path: testInfo.outputPath('npc-possession-live-success.png'),
            fullPage: true,
        });
    });
});
