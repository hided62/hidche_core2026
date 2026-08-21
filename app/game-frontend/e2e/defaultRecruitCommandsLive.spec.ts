import { randomUUID } from 'node:crypto';

import { expect, test, type Browser, type Page } from '@playwright/test';
import { encryptGameSessionToken } from '../../../packages/common/dist/auth/gameToken.js';
import { createTurnDaemonRuntime, seedScenarioToDatabase } from '../../game-engine/dist/index.js';
import { createGamePostgresConnector } from '../../../packages/infra/dist/index.js';

const databaseUrl = process.env.DEFAULT_RECRUIT_COMMANDS_LIVE_DATABASE_URL;
const redisUrl = process.env.DEFAULT_RECRUIT_COMMANDS_LIVE_REDIS_URL;
const gameTokenSecret = process.env.DEFAULT_RECRUIT_COMMANDS_LIVE_GAME_SECRET;
const profile = process.env.PLAYWRIGHT_GAME_PROFILE ?? 'default_recruit_commands_live_integration:2';
const scenarioId = Number(process.env.PLAYWRIGHT_SCENARIO ?? '2');
const hasLiveFixture = Boolean(databaseUrl && redisUrl && gameTokenSecret);
const recruiterId = 7_751;
const recipientId = 7_752;
const followerId = 7_753;
const fixtureNationId = 9_917;
const recruiterUserId = 'default-recruit-live-recruiter';
const recipientUserId = 'default-recruit-live-recipient';
const followerUserId = 'default-recruit-live-follower';
const fixtureNow = new Date('2099-08-01T00:00:00.000Z');
const dueAt = new Date('2099-08-01T00:01:00.000Z');
const runThrough = new Date('2099-08-01T00:02:00.000Z');

const installSession = async (page: Page, userId: string, displayName: string): Promise<void> => {
    const issuedAt = new Date();
    const token = encryptGameSessionToken(
        {
            version: 1,
            profile,
            issuedAt: issuedAt.toISOString(),
            expiresAt: new Date(issuedAt.getTime() + 3_600_000).toISOString(),
            sessionId: `default-recruit-live-${randomUUID()}`,
            user: {
                id: userId,
                username: userId,
                displayName,
                roles: ['user'],
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
        ({ gameToken, gameProfile }) => {
            localStorage.setItem('sammo-game-token', gameToken);
            localStorage.setItem('sammo-game-profile', gameProfile);
        },
        { gameToken: token, gameProfile: profile }
    );
};

const newPage = async (browser: Browser, userId: string, displayName: string): Promise<Page> => {
    const context = await browser.newContext({
        viewport: { width: 1365, height: 1000 },
        deviceScaleFactor: 1,
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
    });
    const page = await context.newPage();
    await installSession(page, userId, displayName);
    await page.route('**/image/**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#777"/></svg>',
        })
    );
    return page;
};

const reserveFirstTurn = async (page: Page, commandName: string, targetName: string): Promise<void> => {
    await page.goto('.');
    const commandPanel = page.locator('[data-main-target="commands"]');
    await expect(commandPanel).toBeVisible();
    await commandPanel.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const picker = page.getByTestId('command-picker');
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: '인사', exact: true }).click();
    await picker.getByRole('button', { name: commandName, exact: true }).click();
    const targetOption = picker.locator('select option').filter({ hasText: targetName });
    await expect(targetOption).toHaveCount(1);
    const targetValue = await targetOption.getAttribute('value');
    if (!targetValue) throw new Error(`Missing target value for ${targetName}.`);
    await picker.locator('select').selectOption(targetValue);
    await picker.getByRole('button', { name: '입력', exact: true }).click();
    await expect(picker).toBeHidden();
};

test.describe('default recruitment commands through live PostgreSQL, Redis, API, daemon, and Chromium', () => {
    test.skip(!hasLiveFixture, 'dedicated PostgreSQL, Redis, and a game token secret are required');

    let db: ReturnType<typeof createGamePostgresConnector>['prisma'];
    let closeDb: (() => Promise<void>) | undefined;
    let runtime: Awaited<ReturnType<typeof createTurnDaemonRuntime>> | undefined;
    let daemonLoop: Promise<void> | undefined;
    let nationId = 0;
    let nationName = '';
    let capitalCityId = 0;

    test.beforeAll(async () => {
        const schema = new URL(databaseUrl!).searchParams.get('schema');
        const profileId = profile.split(':', 1)[0] ?? '';
        if (schema !== profileId || !schema.endsWith('default_recruit_commands_live_integration')) {
            throw new Error(`Refusing mismatched or non-dedicated schema: ${schema ?? '(missing)'} != ${profileId}`);
        }
        const previousSeed = process.env.INTEGRATION_WORLD_SEED;
        process.env.INTEGRATION_WORLD_SEED = 'default-recruit-commands-live-seed';
        try {
            await seedScenarioToDatabase({
                scenarioId,
                databaseUrl: databaseUrl!,
                now: fixtureNow,
                gameClockMode: 'manual',
                installOptions: {
                    turnTermMinutes: 5,
                    joinMode: 'full',
                    npcMode: 0,
                    showImgLevel: 3,
                    serverId: profile,
                    season: 1,
                },
            });
        } finally {
            if (previousSeed === undefined) delete process.env.INTEGRATION_WORLD_SEED;
            else process.env.INTEGRATION_WORLD_SEED = previousSeed;
        }

        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.inputEvent.deleteMany();
        await db.message.deleteMany();
        await db.generalTurn.deleteMany({ where: { generalId: { in: [recruiterId, recipientId, followerId] } } });
        await db.generalTurnRevision.deleteMany({
            where: { generalId: { in: [recruiterId, recipientId, followerId] } },
        });
        await db.general.deleteMany({ where: { id: { in: [recruiterId, recipientId, followerId] } } });
        await db.general.updateMany({
            data: { turnTime: new Date('2199-01-01T00:00:00.000Z'), turnTick: null },
        });

        const capitalCity = await db.city.findFirstOrThrow({ orderBy: { id: 'asc' } });
        nationId = fixtureNationId;
        nationName = '실등용국';
        capitalCityId = capitalCity.id;
        await db.nation.upsert({
            where: { id: fixtureNationId },
            create: {
                id: fixtureNationId,
                name: nationName,
                color: '#225500',
                capitalCityId,
                level: 1,
                meta: { gennum: 0, scout: 0 },
            },
            update: { name: nationName, capitalCityId, level: 1, meta: { gennum: 0, scout: 0 } },
        });
        await db.city.update({
            where: { id: capitalCityId },
            data: { nationId, supplyState: 1 },
        });

        const baseGeneral = {
            cityId: capitalCityId,
            troopId: 0,
            npcState: 0,
            leadership: 70,
            strength: 60,
            intel: 50,
            officerLevel: 0,
            experience: 100,
            dedication: 100,
            gold: 10_000,
            rice: 10_000,
            turnTime: dueAt,
            turnTick: null,
            meta: { killturn: 960, belong: 1 },
            penalty: {},
        } as const;
        await db.general.createMany({
            data: [
                {
                    ...baseGeneral,
                    id: recruiterId,
                    userId: recruiterUserId,
                    name: '실등용제안자',
                    nationId,
                    officerLevel: 1,
                },
                {
                    ...baseGeneral,
                    id: recipientId,
                    userId: recipientUserId,
                    name: '실등용수신자',
                    nationId: 0,
                },
                {
                    ...baseGeneral,
                    id: followerId,
                    userId: followerUserId,
                    name: '실대상임관자',
                    nationId: 0,
                },
            ],
        });
        await db.generalTurn.createMany({
            data: [recruiterId, recipientId, followerId].map((generalId) => ({
                generalId,
                turnIdx: 0,
                actionCode: '휴식',
                arg: {},
            })),
        });
        await db.generalTurnRevision.createMany({
            data: [recruiterId, recipientId, followerId].map((generalId) => ({ generalId, revision: 1 })),
        });
    });

    test.afterAll(async () => {
        if (runtime) {
            await runtime.lifecycle.stop('default recruit commands live complete');
            await daemonLoop;
            await runtime.close();
        }
        await closeDb?.();
    });

    test('shows both commands, delivers the recruitment letter, and appoints on acceptance', async ({
        browser,
    }, testInfo) => {
        const recruiterPage = await newPage(browser, recruiterUserId, '실등용제안자');
        await reserveFirstTurn(recruiterPage, '등용', '실등용수신자');
        await expect(
            db.generalTurn.findUniqueOrThrow({
                where: { generalId_turnIdx: { generalId: recruiterId, turnIdx: 0 } },
            })
        ).resolves.toMatchObject({
            actionCode: 'che_등용',
            arg: { destGeneralId: recipientId },
        });

        const followerPage = await newPage(browser, followerUserId, '실대상임관자');
        await reserveFirstTurn(followerPage, '장수를 따라 임관', '실등용제안자');
        await expect(
            db.generalTurn.findUniqueOrThrow({
                where: { generalId_turnIdx: { generalId: followerId, turnIdx: 0 } },
            })
        ).resolves.toMatchObject({
            actionCode: 'che_장수대상임관',
            arg: { destGeneralID: recruiterId },
        });

        runtime = await createTurnDaemonRuntime({
            profile,
            databaseUrl: databaseUrl!,
            redisUrl: redisUrl!,
            enableDatabaseFlush: true,
            enableLeaseHeartbeat: false,
            exclusiveFastForward: true,
            leaseOwnerId: 'default-recruit-commands-live-daemon',
        });
        daemonLoop = runtime.lifecycle.start();
        await expect.poll(() => runtime?.lifecycle.getStatus().lastTurnTime).toBeTruthy();
        runtime.lifecycle.requestRun('manual', runThrough);
        await expect
            .poll(() => {
                const status = runtime?.lifecycle.getStatus();
                return status?.lastError ?? status?.lastRunAt ?? null;
            })
            .not.toBeNull();
        expect(runtime.lifecycle.getStatus().lastError).toBeUndefined();

        await expect
            .poll(() => db.general.findUniqueOrThrow({ where: { id: followerId } }))
            .toMatchObject({
                nationId,
                cityId: capitalCityId,
                officerLevel: 1,
            });
        await expect
            .poll(() =>
                db.message.findFirst({
                    where: { mailbox: recipientId, type: 'private' },
                    orderBy: { id: 'desc' },
                })
            )
            .not.toBeNull();
        const storedMessage = await db.message.findFirstOrThrow({
            where: { mailbox: recipientId, type: 'private' },
            orderBy: { id: 'desc' },
        });
        expect(storedMessage.message).toMatchObject({
            src: { generalId: recruiterId, nationId },
            dest: { generalId: recipientId, nationId: 0 },
            option: { action: 'scout' },
        });
        const recipientPage = await newPage(browser, recipientUserId, '실등용수신자');
        const dialogs: string[] = [];
        recipientPage.on('dialog', async (dialog) => {
            dialogs.push(dialog.message());
            await dialog.accept();
        });
        await recipientPage.goto('.');
        await expect(recipientPage.getByRole('heading', { name: '전장 현황' })).toBeVisible();
        const letter = recipientPage.locator('.PrivateTalk .msg-plate').filter({ hasText: '망명 권유 서신' });
        await expect(letter).toHaveCount(1);
        await expect(letter).toHaveAttribute('data-id', String(storedMessage.id));
        const accept = letter.getByRole('button', { name: '수락', exact: true });
        await expect(accept).toBeEnabled();
        await accept.click();

        await expect
            .poll(() => db.general.findUniqueOrThrow({ where: { id: recipientId } }))
            .toMatchObject({
                nationId,
                cityId: capitalCityId,
                officerLevel: 1,
            });
        expect(dialogs).toEqual(['수락하시겠습니까?']);
        const invalidated = await db.message.findUniqueOrThrow({ where: { id: storedMessage.id } });
        expect(invalidated.validUntil.getTime()).toBeLessThan(storedMessage.validUntil.getTime());
        await expect(
            db.inputEvent.findFirstOrThrow({
                where: { actorUserId: recipientUserId, eventType: 'messageRespond' },
                orderBy: { createdAt: 'desc' },
            })
        ).resolves.toMatchObject({ status: 'SUCCEEDED', attempts: 1, target: 'ENGINE' });
        await expect(
            db.message.findFirst({
                where: {
                    mailbox: recipientId,
                    id: { not: storedMessage.id },
                },
                orderBy: { id: 'desc' },
            })
        ).resolves.toMatchObject({
            message: expect.objectContaining({ text: `${nationName}으로 등용 제의 수락` }),
        });

        await recruiterPage.screenshot({ path: testInfo.outputPath('recruit-command-reserved.png'), fullPage: true });
        await followerPage.screenshot({ path: testInfo.outputPath('follow-appointment-complete.png'), fullPage: true });
        await recipientPage.screenshot({ path: testInfo.outputPath('recruitment-accepted.png'), fullPage: true });
    });
});
