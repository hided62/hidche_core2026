import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { encryptGameSessionToken } from '@sammo-ts/common/auth/gameToken';
import {
    createGamePostgresConnector,
    type GamePrisma,
    type GamePrismaClient,
} from '@sammo-ts/infra';

const gameTokenSecret = process.env.SELECT_POOL_LIVE_GAME_SECRET;
const databaseUrl = process.env.SELECT_POOL_LIVE_DATABASE_URL;
const userId = process.env.SELECT_POOL_LIVE_USER_ID;
const profile = process.env.PLAYWRIGHT_GAME_PROFILE ?? 'hwe:903';
const hasLiveFixture = Boolean(gameTokenSecret && databaseUrl && userId);
const workspaceRoot =
    process.env.SAMMO_WORKSPACE_ROOT ??
    path.resolve(import.meta.dirname, '../../../../../sam_rebuild');
const defaultIcon = path.resolve(
    process.env.SELECT_POOL_LIVE_DEFAULT_ICON ??
        path.join(workspaceRoot, 'image/icons/default.jpg')
);
const walnutTexture = path.join(workspaceRoot, 'image/game/back_walnut.jpg');
const greenTexture = path.join(workspaceRoot, 'image/game/back_green.jpg');
const fixtureNationIds = [990_901, 990_902, 990_903];

interface AssetTracker {
    userIconRequests: number;
}

const installSession = async (page: Page, tracker?: AssetTracker): Promise<void> => {
    const now = new Date();
    const gameToken = encryptGameSessionToken(
        {
            version: 1,
            profile,
            issuedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
            sessionId: `select-pool-live-${randomUUID()}`,
            user: {
                id: userId!,
                username: 'select-pool-live',
                displayName: '선택실사용자',
                roles: ['user'],
                legacyMemberNo: 42,
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
            if (!window.localStorage.getItem('sammo-game-token')) {
                window.localStorage.setItem('sammo-game-token', token);
            }
            window.localStorage.setItem('sammo-game-profile', gameProfile);
        },
        { token: gameToken, gameProfile: profile }
    );
    await page.addInitScript(() => {
        const values = [1, 0];
        Object.defineProperty(window.crypto, 'getRandomValues', {
            configurable: true,
            value: <T extends ArrayBufferView | null>(array: T): T => {
                if (array && (array as Uint32Array).length > 0) {
                    (array as Uint32Array)[0] = values.shift() ?? 0;
                }
                return array;
            },
        });
    });
    await page.route('**/image/icons/**', (route) =>
        route.fulfill({ path: defaultIcon, contentType: 'image/jpeg' })
    );
    await page.route('**/gateway/api/user-icons/**', (route) => {
        if (tracker) {
            tracker.userIconRequests += 1;
        }
        return route.fulfill({ status: 404, body: '' });
    });
    await page.route('**/image/game/back_walnut.jpg', (route) =>
        route.fulfill({ path: walnutTexture, contentType: 'image/jpeg' })
    );
    await page.route('**/image/game/back_green.jpg', (route) =>
        route.fulfill({ path: greenTexture, contentType: 'image/jpeg' })
    );
};

const waitForPool = async (page: Page): Promise<void> => {
    await expect(page.locator('.card-holder > .general-card')).toHaveCount(14);
    await page.evaluate(async () => {
        await document.fonts.ready;
    });
};

test.describe('scenario 903 live selection pool', () => {
    test.skip(!hasLiveFixture, 'live selection-pool token and database are required');

    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    test.beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
    });

    test.afterAll(async () => {
        await closeDb?.();
    });

    test('renders Ref-width desktop/mobile cards, tooltip, focus, and expiration states', async ({
        page,
    }, testInfo) => {
        await page.clock.install({ time: new Date() });
        const assetTracker: AssetTracker = { userIconRequests: 0 };
        await installSession(page, assetTracker);
        await page.setViewportSize({ width: 1200, height: 900 });
        await page.goto('select-general');
        await waitForPool(page);
        await expect(page.locator('.server-info-table')).toContainText(
            '현재 : 180年 1月 (5분 턴 서버)'
        );
        await expect(page.locator('.server-info-table')).toContainText(
            '등록 장수 : 유저 0 / 500 명'
        );
        await expect(page.locator('.invitation-table')).toContainText('임관 권유 메시지');

        const geometry = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>('.select-pool-page')!;
            const cards = Array.from(
                document.querySelectorAll<HTMLElement>('.card-holder > .general-card')
            );
            const images = Array.from(
                document.querySelectorAll<HTMLImageElement>('.card-holder .portrait img')
            );
            const selectionBody = document.querySelector<HTMLElement>('.selection-body')!;
            const createSection = document.querySelector<HTMLElement>('.create-section')!;
            const createBody = document.querySelector<HTMLElement>('.create-body')!;
            const pageTitle = document.querySelector<HTMLElement>('.page-title')!;
            const serverInfoTable =
                document.querySelector<HTMLElement>('.server-info-table')!;
            const invitationTable =
                document.querySelector<HTMLElement>('.invitation-table')!;
            const footerBack = document.querySelector<HTMLElement>('.footer-back')!;
            const footerBanner = document.querySelector<HTMLElement>('.footer-banner')!;
            const firstButton = document.querySelector<HTMLElement>(
                '.card-holder .select-button'
            )!;
            return {
                root: root.getBoundingClientRect().toJSON(),
                pageTitle: pageTitle.getBoundingClientRect().toJSON(),
                serverInfoTable: serverInfoTable.getBoundingClientRect().toJSON(),
                invitationTable: invitationTable.getBoundingClientRect().toJSON(),
                cards: cards.map((card) => card.getBoundingClientRect().toJSON()),
                images: images.map((image) => ({
                    rect: image.getBoundingClientRect().toJSON(),
                    naturalWidth: image.naturalWidth,
                    naturalHeight: image.naturalHeight,
                    objectFit: getComputedStyle(image).objectFit,
                })),
                selectionBody: selectionBody.getBoundingClientRect().toJSON(),
                createSection: createSection.getBoundingClientRect().toJSON(),
                createBody: createBody.getBoundingClientRect().toJSON(),
                footerBack: footerBack.getBoundingClientRect().toJSON(),
                footerBanner: footerBanner.getBoundingClientRect().toJSON(),
                firstButton: firstButton.getBoundingClientRect().toJSON(),
                rootStyle: {
                    fontFamily: getComputedStyle(root).fontFamily,
                    fontSize: getComputedStyle(root).fontSize,
                    lineHeight: getComputedStyle(root).lineHeight,
                    backgroundImage: getComputedStyle(root).backgroundImage,
                },
                scrollWidth: document.documentElement.scrollWidth,
            };
        });
        expect(geometry.root).toMatchObject({ x: 100, y: 8, width: 1000 });
        expect(geometry.pageTitle).toMatchObject({ x: 100, y: 8, width: 1000 });
        expect(Math.abs(geometry.pageTitle.height - 42.1875)).toBeLessThan(0.6);
        expect(Math.abs(geometry.serverInfoTable.y - 50.1875)).toBeLessThan(0.6);
        expect(Math.abs(geometry.serverInfoTable.height - 40.375)).toBeLessThan(0.6);
        expect(Math.abs(geometry.invitationTable.x - 553)).toBeLessThan(0.6);
        expect(Math.abs(geometry.invitationTable.y - 90.5625)).toBeLessThan(0.6);
        expect(geometry.invitationTable.width).toBe(94);
        expect(Math.abs(geometry.invitationTable.height - 20.1875)).toBeLessThan(0.1);
        expect(geometry.rootStyle).toMatchObject({
            fontSize: '14px',
            lineHeight: '18.2px',
        });
        expect(geometry.rootStyle.fontFamily).toContain('Pretendard');
        expect(geometry.rootStyle.backgroundImage).toContain('back_walnut.jpg');
        expect(geometry.cards.every((card) => card.width === 127)).toBe(true);
        expect(new Set(geometry.cards.map((card) => card.y)).size).toBe(2);
        const shortestCard = Math.min(...geometry.cards.map((card) => card.height));
        expect(Math.abs(shortestCard - 254.875)).toBeLessThan(0.6);
        expect(
            geometry.images.every(
                (image, index) =>
                    image.rect.width === 64 &&
                    image.rect.height === 64 &&
                    Math.abs(
                        image.rect.x -
                            (geometry.cards[index]!.x +
                                (geometry.cards[index]!.width - image.rect.width) / 2)
                    ) < 0.1
            )
        ).toBe(true);
        expect(
            geometry.images.every(
                (image) => image.naturalWidth > 0 && image.naturalHeight > 0
            )
        ).toBe(true);
        expect(geometry.images.every((image) => image.objectFit === 'fill')).toBe(true);
        const fallbackImages = page.locator(
            '.card-holder .portrait img[data-fallback-applied="true"]'
        );
        await expect(fallbackImages).not.toHaveCount(0);
        expect(assetTracker.userIconRequests).toBe(await fallbackImages.count());
        expect(Math.abs(geometry.selectionBody.y - 130.9375)).toBeLessThan(0.6);
        expect(Math.abs(geometry.createSection.height - 87.375)).toBeLessThan(0.6);
        expect(geometry.firstButton.height).toBe(19);
        expect(geometry.footerBanner.height).toBeCloseTo(20.1875, 3);
        await expect(page.locator('.invitation-table tbody tr')).toHaveCount(0);
        await expect(page.locator('.footer-banner')).toContainText(
            '삼국지 모의전투 HiDCHe core2026'
        );
        await expect(page.locator('.footer-banner a')).toHaveText('Credit');

        const firstTrait = page.locator('.card-holder .trait-tooltip').first();
        await firstTrait.hover();
        await expect(firstTrait.getByRole('tooltip')).toBeVisible();
        await page.screenshot({
            path: testInfo.outputPath('select-general-desktop-hover.png'),
            fullPage: true,
        });

        const firstButton = page.locator('.card-holder .select-button').first();
        await firstButton.focus();
        await expect(firstButton).toHaveCSS('outline-style', 'auto');
        await expect(firstButton).toHaveCSS('outline-width', '1px');
        await firstButton.hover();
        await expect(firstButton).toHaveCSS('background-color', 'rgb(25, 25, 25)');

        await page.setViewportSize({ width: 500, height: 900 });
        await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
            .toBeGreaterThanOrEqual(1008);
        await page.screenshot({
            path: testInfo.outputPath('select-general-mobile.png'),
            fullPage: true,
        });

        const validText = await page.locator('.selection-body small span').textContent();
        expect(validText).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
        const displayedExpiry = new Date(`${validText!.replace(' ', 'T')}+09:00`).getTime();
        const delta = Math.max(displayedExpiry - Date.now(), 0);
        await page.clock.fastForward(delta);
        await expect(page.locator('.expired-text')).toHaveCount(0);
        await page.clock.fastForward(2_000);
        await expect(page.locator('.expired-text')).toHaveText('- 만료 -');
    });

    test('shuffles non-neutral invitation nations with Ref-style row content and colors', async ({
        page,
    }) => {
        await db.nation.deleteMany({ where: { id: { in: fixtureNationIds } } });
        await db.nation.createMany({
            data: [
                {
                    id: fixtureNationIds[0]!,
                    name: '테스트국A',
                    color: '#330000',
                    level: 1,
                    meta: { infoText: 'A 권유' },
                },
                {
                    id: fixtureNationIds[1]!,
                    name: '테스트국B',
                    color: '#FFFF00',
                    level: 1,
                    meta: { infoText: 'B 권유' },
                },
                {
                    id: fixtureNationIds[2]!,
                    name: '테스트국C',
                    color: '#000080',
                    level: 1,
                    meta: { infoText: 'C 권유' },
                },
            ],
        });
        try {
            await installSession(page);
            await page.setViewportSize({ width: 1200, height: 900 });
            await page.goto('select-general');
            await waitForPool(page);

            const rows = page.locator('.invitation-table tbody tr');
            await expect(rows.locator('.invitation-nation')).toHaveText([
                '테스트국C',
                '테스트국A',
                '테스트국B',
            ]);
            await expect(rows.locator('.invitation-message')).toHaveText([
                'C 권유',
                'A 권유',
                'B 권유',
            ]);
            await expect(rows.nth(0)).toHaveCSS('background-color', 'rgb(0, 0, 128)');
            await expect(rows.nth(1)).toHaveCSS('background-color', 'rgb(51, 0, 0)');
            await expect(rows.nth(2)).toHaveCSS('background-color', 'rgb(255, 255, 0)');
            await expect(rows.nth(0)).toHaveCSS('color', 'rgb(255, 255, 255)');
            await expect(rows.nth(2)).toHaveCSS('color', 'rgb(0, 0, 0)');
            const invitationGeometry = await page.locator('.invitation-table').evaluate((table) => {
                const rect = table.getBoundingClientRect();
                return { x: rect.x, width: rect.width };
            });
            expect(invitationGeometry).toEqual({ x: 100, width: 1000 });
        } finally {
            await db.nation.deleteMany({ where: { id: { in: fixtureNationIds } } });
        }
    });

    test('creates, rejects cooldown, exposes MyPage action, and reselects through the live API', async ({
        page,
    }) => {
        const dialogs: string[] = [];
        const createClientRequestIds: string[] = [];
        let injectCreateTimeout = true;
        page.on('dialog', async (dialog) => {
            dialogs.push(dialog.message());
            await dialog.accept();
        });
        await page.route('**/trpc/join.selectPoolGeneral?batch=1', async (route) => {
            const findClientRequestId = (value: unknown): string | undefined => {
                if (!value || typeof value !== 'object') return undefined;
                if (
                    'clientRequestId' in value &&
                    typeof value.clientRequestId === 'string'
                ) {
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
            createClientRequestIds.push(clientRequestId!);
            if (!injectCreateTimeout) {
                await route.continue();
                return;
            }
            injectCreateTimeout = false;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([
                    {
                        error: {
                            message:
                                '장수 선택 요청은 접수됐지만 처리 결과를 아직 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.',
                            code: -32008,
                            data: {
                                code: 'TIMEOUT',
                                httpStatus: 408,
                                path: 'join.selectPoolGeneral',
                            },
                        },
                    },
                ]),
            });
        });
        const assetTracker: AssetTracker = { userIconRequests: 0 };
        await installSession(page, assetTracker);
        await page.setViewportSize({ width: 1200, height: 900 });
        await page.goto('select-general');
        await waitForPool(page);

        const candidateCards = page.locator('.card-holder > .general-card');
        const fallbackCard = candidateCards
            .filter({ has: page.locator('img[data-fallback-applied="true"]') })
            .first();
        await expect(fallbackCard).toBeVisible();
        const initialName = await fallbackCard.locator('h4').first().textContent();
        const userIconRequestsBeforePreview = assetTracker.userIconRequests;
        await fallbackCard.locator('.select-button').click();
        await expect(page.locator('.selected-card')).toHaveCount(1);
        await expect(
            page.locator('.selected-card img[data-fallback-applied="true"]')
        ).toBeVisible();
        expect(assetTracker.userIconRequests).toBeGreaterThan(userIconRequestsBeforePreview);
        await page.locator('.custom-form select').selectOption('che_안전');
        await page.getByRole('button', { name: '다시입력' }).click();
        await expect(page.locator('.custom-form select')).toHaveValue('Random');
        await expect(page.locator('.selected-card')).toHaveCount(1);
        await page.locator('.custom-form select').selectOption('che_안전');
        await page.locator('#build-general').click();
        await expect.poll(() => dialogs).toContain(
            '실패했습니다: 장수 선택 요청은 접수됐지만 처리 결과를 아직 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.'
        );
        await waitForPool(page);
        const retryCard = page
            .locator('.card-holder > .general-card')
            .filter({ has: page.locator('h4', { hasText: initialName?.trim() ?? '' }) })
            .first();
        await retryCard.locator('.select-button').click();
        await page.locator('.custom-form select').selectOption('che_안전');
        await page.locator('#build-general').click();
        await expect(page).toHaveURL(/\/hwe\/$/);
        expect(dialogs.filter((message) => message === '이 장수로 생성할까요?')).toHaveLength(2);
        await expect.poll(() => dialogs).toContain('선택한 장수로 생성했습니다.');
        expect(createClientRequestIds).toHaveLength(2);
        expect(createClientRequestIds[1]).toBe(createClientRequestIds[0]);

        const created = await db.general.findFirstOrThrow({ where: { userId } });
        expect(created.name).toBe(initialName?.trim());
        expect(created.personalCode).toBe('che_안전');
        expect(created.specialCode).toMatch(/^che_event_/);
        const createEvent = await db.inputEvent.findFirstOrThrow({
            where: { actorUserId: userId, eventType: 'selectPoolCreate' },
            orderBy: { sequence: 'desc' },
        });
        expect(createEvent).toMatchObject({ status: 'SUCCEEDED', attempts: 1 });
        expect(createEvent.requestId).toMatch(
            new RegExp(`^select-pool:${userId}:[0-9a-f-]{36}:create$`)
        );
        expect(
            await page.evaluate(() =>
                window.sessionStorage.getItem('sammo-select-pool-pending-action')
            )
        ).toBeNull();

        await page.goto('my-page');
        const actionLink = page.locator('.select-general-link');
        await expect(actionLink).toBeVisible();
        await expect(actionLink.locator('..')).toContainText(
            /다른 장수 선택\s*\(\d{4}-\d{2}-\d{2}/
        );
        await expect(actionLink).toHaveCSS('width', '160px');
        await expect(actionLink).toHaveCSS('height', '30px');

        dialogs.length = 0;
        await page.goto('select-general');
        await expect.poll(() => dialogs).toContain('실패했습니다: 아직 다시 고를 수 없습니다');
        await expect(page.locator('.error-text')).toHaveText('아직 다시 고를 수 없습니다');

        const availableAt = '2026-07-29T00:00:00.000Z';
        const cooldownRequestId = `select-pool-live-cooldown-${randomUUID()}`;
        await db.inputEvent.create({
            data: {
                requestId: cooldownRequestId,
                target: 'ENGINE',
                eventType: 'patchGeneral',
                payload: {
                    type: 'patchGeneral',
                    requestId: cooldownRequestId,
                    generalId: created.id,
                    patch: {
                        meta: {
                            next_change: availableAt,
                            nextChangeAt: availableAt,
                        },
                    },
                } as GamePrisma.InputJsonValue,
            },
        });
        await expect
            .poll(
                async () =>
                    (
                        await db.inputEvent.findUniqueOrThrow({
                            where: { requestId: cooldownRequestId },
                        })
                    ).status
            )
            .toBe('SUCCEEDED');

        dialogs.length = 0;
        await page.reload();
        await waitForPool(page);
        const cards = page.locator('.card-holder > .general-card');
        const names = await cards.locator('h4').allTextContents();
        const targetIndex = names.findIndex((name) => name.trim() !== created.name);
        expect(targetIndex).toBeGreaterThanOrEqual(0);
        const targetName = names[targetIndex]!.trim();
        await cards.nth(targetIndex).locator('.select-button').click();
        await expect(page).toHaveURL(/\/hwe\/$/);
        await expect.poll(() => dialogs).toContain(`이 장수를 선택할까요? : ${targetName}`);
        await expect.poll(() => dialogs).toContain('선택한 장수로 변경했습니다.');

        await expect
            .poll(async () => (await db.general.findUniqueOrThrow({ where: { id: created.id } })).name)
            .toBe(targetName);
        const reselectEvent = await db.inputEvent.findFirstOrThrow({
            where: { actorUserId: userId, eventType: 'selectPoolReselect' },
            orderBy: { sequence: 'desc' },
        });
        expect(reselectEvent).toMatchObject({ status: 'SUCCEEDED', attempts: 1 });
        expect(reselectEvent.requestId).toMatch(
            new RegExp(`^select-pool:${userId}:[0-9a-f-]{36}:reselect$`)
        );
        expect(
            await page.evaluate(() =>
                window.sessionStorage.getItem('sammo-select-pool-pending-action')
            )
        ).toBeNull();
    });
});
