import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameProfile, gameTrpcRoute } from './gameTestPaths.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const responsiveArtifactDir = process.env.TOURNAMENT_RESPONSIVE_ARTIFACT_DIR;
const imageRoots = [
    ...(process.env.FRONTEND_PARITY_IMAGE_ROOT ? [resolve(process.env.FRONTEND_PARITY_IMAGE_ROOT, 'game')] : []),
    resolve(repositoryRoot, '../image/game'),
    resolve(repositoryRoot, '../../image/game'),
];
const iconRoots = [
    ...(process.env.FRONTEND_PARITY_IMAGE_ROOT ? [resolve(process.env.FRONTEND_PARITY_IMAGE_ROOT, 'icons')] : []),
    resolve(repositoryRoot, '../image/icons'),
    resolve(repositoryRoot, '../../image/icons'),
    resolve(repositoryRoot, '../../sam_rebuild/image/icons'),
];
const names = [
    '관우',
    '장료',
    '조운',
    '하후돈',
    '손책',
    '태사자',
    '마초',
    '황충',
    '여포',
    '전위',
    '감녕',
    '문추',
    '안량',
    '허저',
    '주태',
    '방덕',
];
const participants = names.map((name, index) => ({
    id: index + 1,
    name,
    leadership: 80,
    strength: 80,
    intel: 80,
    level: 10,
    picture: 'default.jpg',
    imageServer: 0,
    groupId: 10 + (index % 8),
    groupNo: Math.floor(index / 8),
    win: 3 - (index % 2),
    draw: index % 2,
    lose: 0,
    gl: 12 - index,
    finalRank: Math.floor(index / 8) + 1,
}));
const matches = [
    ...Array.from({ length: 8 }, (_, index) => ({
        id: index + 1,
        stage: 7,
        roundIndex: index,
        attackerId: index * 2 + 1,
        defenderId: index * 2 + 2,
        winnerId: index * 2 + 1,
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
        id: index + 9,
        stage: 8,
        roundIndex: index,
        attackerId: index * 4 + 1,
        defenderId: index * 4 + 3,
        winnerId: index * 4 + 1,
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
        id: index + 13,
        stage: 9,
        roundIndex: index,
        attackerId: index * 8 + 1,
        defenderId: index * 8 + 5,
        winnerId: index * 8 + 1,
    })),
    { id: 15, stage: 10, roundIndex: 0, attackerId: 1, defenderId: 9, winnerId: 1 },
];

const response = (data: unknown) => ({ result: { data } });
const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const readReferenceImage = async (filename: string): Promise<Buffer> => {
    for (const imageRoot of imageRoots) {
        try {
            return await readFile(resolve(imageRoot, filename));
        } catch {
            // Worktrees can be nested at different depths.
        }
    }
    throw new Error(`Reference image not found: ${filename}`);
};

const readReferenceIcon = async (filename: string): Promise<Buffer> => {
    for (const iconRoot of iconRoots) {
        try {
            return await readFile(resolve(iconRoot, filename));
        } catch {
            // Worktrees can be nested at different depths.
        }
    }
    throw new Error(`Reference icon not found: ${filename}`);
};

const persistScreenshot = async (page: Page, name: string, fallbackPath: string) => {
    if (!responsiveArtifactDir) {
        await page.screenshot({ path: fallbackPath, fullPage: true });
        return;
    }
    await mkdir(responsiveArtifactDir, { recursive: true });
    await page.screenshot({ path: resolve(responsiveArtifactDir, `${name}.webp`), fullPage: true });
};

const installFixture = async (page: Page) => {
    await page.addInitScript((profile) => {
        window.localStorage.setItem('sammo-game-token', 'ga_tournament_bracket_playwright');
        window.localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    for (const filename of ['back_walnut.jpg', 'back_green.jpg', 'back_blue.jpg']) {
        await page.route(`**/image/game/${filename}`, async (route) => {
            await route.fulfill({ status: 200, contentType: 'image/jpeg', body: await readReferenceImage(filename) });
        });
    }
    await page.route('**/icons/default.jpg', async (route) => {
        await route.fulfill({ status: 200, contentType: 'image/jpeg', body: await readReferenceIcon('default.jpg') });
    });
    await page.route(gameTrpcRoute, async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') return response({ myGeneral: { id: 1, name: names[0] } });
            if (operation === 'join.getConfig') return response({});
            if (operation === 'general.me') return response({ general: { id: 1, name: names[0] } });
            if (operation === 'tournament.getAdminStatus') return response({ ok: false });
            if (operation === 'tournament.getSnapshot') {
                return response({
                    state: {
                        stage: 0,
                        phase: 0,
                        type: 0,
                        auto: false,
                        openYear: 184,
                        openMonth: 1,
                        termSeconds: 60,
                        nextAt: '2026-08-02T00:00:00.000Z',
                        winnerId: 1,
                    },
                    participants,
                    matches,
                    betCount: 16,
                });
            }
            if (operation === 'tournament.getBettingSummary') {
                return response({
                    totals: Object.fromEntries(
                        participants.map((participant, index) => [participant.id, 100 + index * 10])
                    ),
                    myTotals: {},
                    totalAmount: 2800,
                    myAmount: 0,
                });
            }
            if (operation === 'tournament.getRankings') {
                return response(
                    [
                        ['tt', '전 력 전', '종합'],
                        ['tl', '통 솔 전', '통솔'],
                        ['ts', '일 기 토', '무력'],
                        ['ti', '설 전', '지력'],
                    ].map(([prefix, title, statLabel]) => ({
                        prefix,
                        title,
                        statLabel,
                        entries: participants.slice(0, 6).map((participant, index) => ({
                            rank: index + 1,
                            generalId: participant.id,
                            name: participant.name,
                            picture: participant.picture,
                            imageServer: participant.imageServer,
                            npcState: 0,
                            stat: 240 - index,
                            games: 10,
                            win: 7,
                            draw: 1,
                            lose: 2,
                            score: 22 - index,
                            prizes: 3,
                        })),
                    }))
                );
            }
            return response(null);
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
};

const openTournament = async (page: Page) => {
    await installFixture(page);
    await page.goto('tournament');
    await expect(page.getByLabel('토너먼트 대진표')).toBeVisible();
};

test('desktop bracket connects every real general slot to the next round', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1365, height: 900 });
    await openTournament(page);

    await expect(page.locator('.desktop-bracket-canvas .desktop-bracket-name[data-general-id]')).toHaveCount(31);
    await expect(page.locator('.desktop-bracket-canvas svg > g')).toHaveCount(15);
    await expect(
        page.locator('.desktop-bracket-canvas .desktop-bracket-name.advanced', { hasText: '관우' })
    ).toHaveCount(5);

    const geometry = await page.locator('.desktop-bracket-canvas').evaluate((canvas) => {
        const cards = [...canvas.querySelectorAll<HTMLElement>('.desktop-bracket-name')];
        const firstRound = cards.slice(0, 16).map((element) => element.getBoundingClientRect());
        const quarterFinal = cards[16]!.getBoundingClientRect();
        const icons = cards.map((element) => element.querySelector('img')!.getBoundingClientRect());
        const names = cards.map((element) =>
            element.querySelector<HTMLElement>('.general-identity-name')!.getBoundingClientRect()
        );
        const own = canvas.getBoundingClientRect();
        return {
            canvasWidth: own.width,
            minX: Math.min(...cards.map((card) => card.getBoundingClientRect().left - own.left)),
            maxX: Math.max(...cards.map((card) => card.getBoundingClientRect().right - own.left)),
            iconSizes: icons.map((icon) => [icon.width, icon.height]),
            horizontalIdentities: icons.every((icon, index) => names[index]!.left >= icon.right - 1),
            firstParentY: quarterFinal.y + quarterFinal.height / 2,
            firstPairAverageY:
                (firstRound[0]!.y + firstRound[0]!.height / 2 + firstRound[1]!.y + firstRound[1]!.height / 2) / 2,
        };
    });
    expect(geometry.canvasWidth).toBeGreaterThanOrEqual(800);
    expect(geometry.canvasWidth).toBeLessThanOrEqual(1200);
    expect(geometry.minX).toBeGreaterThanOrEqual(0);
    expect(geometry.maxX).toBeLessThanOrEqual(geometry.canvasWidth);
    expect(geometry.iconSizes.every(([width, height]) => width === 64 && height === 64)).toBe(true);
    expect(geometry.horizontalIdentities).toBe(true);
    expect(Math.abs(geometry.firstParentY - geometry.firstPairAverageY)).toBeLessThan(1);

    await persistScreenshot(page, 'tournament-desktop', testInfo.outputPath('tournament-bracket-desktop.webp'));
});

test('mobile bracket exposes every round through tabs with standard horizontal identities', async ({
    page,
}, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTournament(page);

    const bracket = page.locator('.mobile-bracket');
    await expect(bracket).toBeVisible();
    await expect(page.getByRole('tablist', { name: '토너먼트 라운드 선택' })).toBeVisible();
    await expect(bracket.locator('.mobile-bracket-name')).toHaveCount(16);
    await expect(bracket.locator('.mobile-bracket-name', { hasText: '방덕' })).toBeVisible();
    await expect(bracket.locator('.mobile-bracket-name', { hasText: '관우' })).toHaveCount(1);
    for (const [label, count] of [
        ['8강', 8],
        ['4강', 4],
        ['결승', 2],
        ['우승', 1],
    ] as const) {
        await page.getByRole('tab', { name: label }).click();
        await expect(page.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
        await expect(bracket.locator('.mobile-bracket-name')).toHaveCount(count);
        await expect(bracket.locator('.mobile-bracket-name', { hasText: '관우' })).toHaveCount(1);
    }
    await page.getByRole('tab', { name: '16강' }).click();
    const bounds = await bracket.evaluate((element) => {
        const names = [...element.querySelectorAll<HTMLElement>('.mobile-bracket-name')].map((name) =>
            name.getBoundingClientRect()
        );
        const own = element.getBoundingClientRect();
        return {
            width: own.width,
            minX: Math.min(...names.map((rect) => rect.left - own.left)),
            maxX: Math.max(...names.map((rect) => rect.right - own.left)),
        };
    });
    expect(bounds.width).toBe(390);
    expect(bounds.minX).toBeGreaterThanOrEqual(0);
    expect(bounds.maxX).toBeLessThanOrEqual(390);
    const identity = await bracket
        .locator('.mobile-bracket-name')
        .first()
        .evaluate((element) => {
            const icon = element.querySelector('img')!.getBoundingClientRect();
            const name = element.querySelector<HTMLElement>('.general-identity-name')!.getBoundingClientRect();
            return {
                iconWidth: icon.width,
                iconHeight: icon.height,
                iconRight: icon.right,
                nameLeft: name.left,
                iconTop: icon.top,
                iconBottom: icon.bottom,
                nameTop: name.top,
                nameBottom: name.bottom,
            };
        });
    expect(identity.iconWidth).toBe(64);
    expect(identity.iconHeight).toBe(64);
    expect(identity.nameLeft).toBeGreaterThanOrEqual(identity.iconRight - 1);
    expect(identity.nameTop).toBeLessThan(identity.iconBottom);
    expect(identity.nameBottom).toBeGreaterThan(identity.iconTop);
    await expect(page.getByRole('tablist', { name: '본선 조 선택' })).toBeVisible();
    await page.getByRole('tab', { name: '二조' }).first().click();
    await expect(page.getByRole('tab', { name: '二조' }).first()).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await persistScreenshot(page, 'tournament-mobile', testInfo.outputPath('tournament-bracket-mobile.webp'));
});

test('mobile betting rankings use tabs and keep dedicated icons beside general names', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installFixture(page);
    await page.goto('betting');

    await expect(page.locator('.candidate-card')).toHaveCount(16);
    await expect(page.getByRole('tablist', { name: '토너먼트 랭킹 종목 선택' })).toBeVisible();
    await expect(page.locator('.ranking-table:visible')).toHaveCount(1);
    await page.getByRole('tab', { name: '통솔전' }).click();
    await expect(page.getByRole('tab', { name: '통솔전' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.ranking-table:visible thead')).toContainText('통 솔 전');

    const identity = await page
        .locator('.ranking-table:visible .general-identity')
        .first()
        .evaluate((element) => {
            const icon = element.querySelector('img')!.getBoundingClientRect();
            const name = element.querySelector<HTMLElement>('.general-identity-name')!.getBoundingClientRect();
            return { iconWidth: icon.width, iconHeight: icon.height, iconRight: icon.right, nameLeft: name.left };
        });
    expect(identity.iconWidth).toBe(64);
    expect(identity.iconHeight).toBe(64);
    expect(identity.nameLeft).toBeGreaterThanOrEqual(identity.iconRight - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await persistScreenshot(page, 'tournament-ranking-mobile', testInfo.outputPath('tournament-ranking-mobile.webp'));
});

test('desktop betting presents icon-and-name cards and all four rankings without document overflow', async ({
    page,
}, testInfo) => {
    await page.setViewportSize({ width: 1365, height: 900 });
    await installFixture(page);
    await page.goto('betting');

    await expect(page.locator('.candidate-card')).toHaveCount(16);
    await expect(page.locator('.ranking-table:visible')).toHaveCount(4);
    await expect(page.locator('.general-identity-icon').first()).toHaveCSS('width', '64px');
    await expect(page.locator('.general-identity-icon').first()).toHaveCSS('height', '64px');
    const columns = await page
        .locator('.candidate-grid')
        .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1365);
    await persistScreenshot(page, 'tournament-ranking-desktop', testInfo.outputPath('tournament-ranking-desktop.webp'));
});
