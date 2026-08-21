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
const longGeneralName = 'ⓜ가나다라마바사아자차카타파하일이삼';
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
    longGeneralName,
    ...Array.from({ length: 48 }, (_, index) => `예선장수${index + 17}`),
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
    groupId: Math.floor(index / 8) < 4 ? 10 + (index % 8) : index % 8,
    groupNo: Math.floor(index / 8),
    win: Math.floor(index / 8) < 4 ? 3 - (index % 2) : 7 - Math.floor(index / 8),
    draw: index % 2,
    lose: Math.floor(index / 8) < 4 ? 0 : Math.floor(index / 8),
    gl: 64 - index,
    finalRank: Math.floor(index / 8) + 1,
    preliminaryGroupId: index % 8,
    preliminaryGroupNo: Math.floor(index / 8),
    preliminaryRank: Math.floor(index / 8) + 1,
    preliminaryWin: 7 - Math.floor(index / 8),
    preliminaryDraw: index % 2,
    preliminaryLose: Math.floor(index / 8),
    preliminaryGl: 64 - index,
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
const asRecord = (value: unknown): Record<string, unknown> | null =>
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const findBetInput = (value: unknown): { targetId: number; amount: number } | null => {
    const record = asRecord(value);
    if (!record) return null;
    if (typeof record.targetId === 'number' && typeof record.amount === 'number') {
        return { targetId: record.targetId, amount: record.amount };
    }
    for (const child of Object.values(record)) {
        const result = findBetInput(child);
        if (result) return result;
    }
    return null;
};
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

const installFixture = async (
    page: Page,
    options: {
        applicationOpen?: boolean;
        tournamentType?: number;
        tournamentStage?: number;
        joinedGroupId?: number;
    } = {}
) => {
    let joined = false;
    const placedBets: Array<{ targetId: number; amount: number }> = [];
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
                const tournamentStage = options.tournamentStage ?? (options.applicationOpen ? 1 : 0);
                const joinedGroupId = options.joinedGroupId ?? 0;
                return response({
                    state: {
                        stage: tournamentStage,
                        phase: 0,
                        type: options.tournamentType ?? 0,
                        auto: false,
                        openYear: 184,
                        openMonth: 1,
                        termSeconds: 60,
                        nextAt: '2026-08-02T00:00:00.000Z',
                        winnerId: tournamentStage === 0 ? 1 : undefined,
                    },
                    participants:
                        options.applicationOpen && !joined
                            ? []
                            : options.applicationOpen
                              ? [
                                    {
                                        ...participants[0],
                                        groupId: joinedGroupId,
                                        groupNo: 0,
                                        preliminaryGroupId: joinedGroupId,
                                        preliminaryGroupNo: 0,
                                        win: 0,
                                        draw: 0,
                                        lose: 0,
                                        gl: 0,
                                        seedRank: 0,
                                        finalRank: 0,
                                    },
                                ]
                              : participants,
                    matches,
                    betCount: 16,
                });
            }
            if (operation === 'tournament.join') {
                joined = true;
                return response({ ok: true, count: 1 });
            }
            if (operation === 'tournament.getBettingSummary') {
                return response({
                    totals: Object.fromEntries(
                        participants.slice(0, 16).map((participant, index) => [participant.id, 100 + index * 10])
                    ),
                    myTotals: { 1: 120, 2: 40 },
                    totalAmount: 2800,
                    myAmount: 160,
                });
            }
            if (operation === 'tournament.placeBet') {
                const input = findBetInput(route.request().postDataJSON());
                if (!input) throw new Error('베팅 요청에서 targetId와 amount를 찾을 수 없습니다.');
                placedBets.push(input);
                return response({ ok: true });
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
    return { placedBets };
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

    const controls = await page.locator('#tournament-container').evaluate((container) => {
        const bounds = (selector: string) => container.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        const refresh = bounds('.toolbar button:first-child');
        const join = bounds('.join-button');
        const close = bounds('.close-button');
        return {
            refresh: { width: refresh.width, height: refresh.height },
            join: { width: join.width, height: join.height },
            close: { width: close.width, height: close.height },
        };
    });
    expect(controls.refresh).toEqual({ width: 72, height: 44 });
    expect(controls.join).toEqual({ width: 72, height: 44 });
    expect(controls.close).toEqual({ width: 88, height: 44 });

    const firstSlot = page.locator('.desktop-bracket-name').first();
    const oddsContainment = await firstSlot.evaluate((slot) => {
        const card = slot.getBoundingClientRect();
        const stat = slot.querySelector<HTMLElement>('.bracket-core-stat')!.getBoundingClientRect();
        const odds = slot.querySelector<HTMLElement>('.bracket-odds')!.getBoundingClientRect();
        return {
            cardTop: card.top,
            cardBottom: card.bottom,
            statTop: stat.top,
            statBottom: stat.bottom,
            oddsTop: odds.top,
            oddsBottom: odds.bottom,
            cardHeight: card.height,
        };
    });
    expect(oddsContainment.cardHeight).toBeGreaterThanOrEqual(82);
    expect(oddsContainment.statTop).toBeGreaterThanOrEqual(oddsContainment.cardTop);
    expect(oddsContainment.statBottom).toBeLessThanOrEqual(oddsContainment.cardBottom);
    expect(oddsContainment.oddsTop).toBeGreaterThanOrEqual(oddsContainment.cardTop);
    expect(oddsContainment.oddsBottom).toBeLessThanOrEqual(oddsContainment.cardBottom);
    await expect(firstSlot.locator('.bracket-my-bet')).toHaveText('내 투자 금120');

    const preliminaryTables = page.locator('.preliminary-grid table');
    await expect(preliminaryTables).toHaveCount(8);
    for (let groupIndex = 0; groupIndex < 8; groupIndex += 1) {
        await expect(preliminaryTables.nth(groupIndex).locator('tbody tr')).toHaveCount(8);
        await expect(preliminaryTables.nth(groupIndex).locator('.general-identity')).toHaveCount(8);
    }

    await persistScreenshot(page, 'tournament-desktop', testInfo.outputPath('tournament-bracket-desktop.webp'));
});

test('join refresh shows the assigned preliminary group immediately with accessible controls', async ({
    page,
}, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installFixture(page, { applicationOpen: true, joinedGroupId: 5 });
    await page.goto('tournament');

    const refresh = page.getByRole('button', { name: '갱신' });
    const join = page.getByRole('button', { name: '참가' });
    const close = page.getByRole('button', { name: '창 닫기' }).first();
    await expect(join).toBeEnabled();
    await expect(page.getByText('조별 예선 순위')).toBeVisible();
    await expect(page.getByText('조별 본선 순위')).toHaveCount(0);
    await expect(page.getByLabel('토너먼트 대진표')).toHaveCount(0);
    await join.click();

    await expect(page.locator('[data-testid="game-toast"][data-feedback-kind="success"]')).toContainText(
        '참가 신청이 반영되었습니다. 六조에 배정되었습니다.'
    );
    await expect(join).toBeDisabled();
    const preliminaryTabs = page.getByRole('tablist', { name: '예선 조 선택' });
    await expect(preliminaryTabs.getByRole('tab').nth(5)).toHaveAttribute('aria-selected', 'true');
    const assignedGroup = page.locator('[data-preliminary-group="5"]');
    await expect(assignedGroup.locator('.general-identity', { hasText: names[0] })).toBeVisible();
    const assignedGroupBounds = await assignedGroup.boundingBox();
    expect(assignedGroupBounds?.y).toBeLessThan(844);
    expect((assignedGroupBounds?.y ?? 0) + (assignedGroupBounds?.height ?? 0)).toBeGreaterThan(0);
    await persistScreenshot(
        page,
        'tournament-joined-group-mobile',
        testInfo.outputPath('tournament-joined-group.webp')
    );

    for (const control of [refresh, join, close]) {
        const box = await control.boundingBox();
        expect(box?.height).toBe(44);
        expect(box?.width).toBeGreaterThanOrEqual(72);
    }
    await refresh.focus();
    await expect(refresh).toBeFocused();
    await refresh.hover();
    await expect(refresh).toHaveCSS('filter', 'none');
    await expect(refresh).toHaveCSS('height', '43px');
    await expect(refresh).toHaveCSS('margin-top', '1px');
    await expect(refresh).toHaveCSS('border-bottom-width', '3px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('desktop join scrolls the assigned preliminary group into view without future sections', async ({
    page,
}, testInfo) => {
    await page.setViewportSize({ width: 1365, height: 900 });
    await installFixture(page, { applicationOpen: true, joinedGroupId: 7 });
    await page.goto('tournament');

    await expect(page.getByText('조별 본선 순위')).toHaveCount(0);
    await expect(page.getByLabel('토너먼트 대진표')).toHaveCount(0);
    await page.getByRole('button', { name: '참가' }).click();

    await expect(page.locator('[data-testid="game-toast"][data-feedback-kind="success"]')).toContainText(
        '참가 신청이 반영되었습니다. 八조에 배정되었습니다.'
    );
    const assignedGroup = page.locator('[data-preliminary-group="7"]');
    await expect(assignedGroup.locator('.general-identity', { hasText: names[0] })).toBeVisible();
    const bounds = await assignedGroup.boundingBox();
    expect(bounds?.y).toBeLessThan(900);
    expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeGreaterThan(0);
    await persistScreenshot(
        page,
        'tournament-joined-group-desktop',
        testInfo.outputPath('tournament-joined-group.webp')
    );
});

test('final group section appears before the later knockout section', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installFixture(page, { tournamentStage: 3 });
    await page.goto('tournament');

    await expect(page.getByText('조별 예선 순위')).toBeVisible();
    await expect(page.getByText('조별 본선 순위')).toBeVisible();
    await expect(page.getByLabel('토너먼트 대진표')).toHaveCount(0);
    await persistScreenshot(page, 'tournament-final-stage-mobile', testInfo.outputPath('tournament-final-stage.webp'));
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
    const longIdentity = bracket.locator('.mobile-bracket-name', { hasText: longGeneralName });
    await expect(longIdentity).toBeVisible();
    const longNameMetrics = await longIdentity.locator('.general-identity-name').evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            overflow: style.overflow,
            textOverflow: style.textOverflow,
            whiteSpace: style.whiteSpace,
            title: element.getAttribute('title'),
        };
    });
    expect(longNameMetrics.scrollWidth).toBeGreaterThan(longNameMetrics.clientWidth);
    expect(longNameMetrics.overflow).toBe('hidden');
    expect(longNameMetrics.textOverflow).toBe('ellipsis');
    expect(longNameMetrics.whiteSpace).toBe('nowrap');
    expect(longNameMetrics.title).toBe(longGeneralName);
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
    const firstMobileSlot = bracket.locator('.mobile-bracket-name').first();
    const mobileOddsContainment = await firstMobileSlot.evaluate((slot) => {
        const card = slot.getBoundingClientRect();
        const stat = slot.querySelector<HTMLElement>('.bracket-core-stat')!.getBoundingClientRect();
        const odds = slot.querySelector<HTMLElement>('.bracket-odds')!.getBoundingClientRect();
        return {
            cardTop: card.top,
            cardBottom: card.bottom,
            statTop: stat.top,
            statBottom: stat.bottom,
            oddsBottom: odds.bottom,
            cardHeight: card.height,
        };
    });
    expect(mobileOddsContainment.cardHeight).toBeGreaterThanOrEqual(82);
    expect(mobileOddsContainment.statTop).toBeGreaterThanOrEqual(mobileOddsContainment.cardTop);
    expect(mobileOddsContainment.statBottom).toBeLessThanOrEqual(mobileOddsContainment.cardBottom);
    expect(mobileOddsContainment.oddsBottom).toBeLessThanOrEqual(mobileOddsContainment.cardBottom);
    await expect(firstMobileSlot.locator('.bracket-my-bet')).toHaveText('내 투자 금120');
    await expect(page.getByRole('tablist', { name: '본선 조 선택' })).toBeVisible();
    await page.getByRole('tab', { name: '二조' }).first().click();
    await expect(page.getByRole('tab', { name: '二조' }).first()).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await persistScreenshot(page, 'tournament-mobile', testInfo.outputPath('tournament-bracket-mobile.webp'));
});

test('tournament and betting pages expose same-row navigation tabs beside close', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTournament(page);

    const navigation = page.getByRole('tablist', { name: '토너먼트와 베팅장 이동' });
    const tournamentTab = navigation.getByRole('tab', { name: '토너먼트' });
    const bettingTab = navigation.getByRole('tab', { name: '베팅장' });
    const close = page.getByRole('button', { name: '창 닫기' }).first();
    await expect(tournamentTab).toHaveAttribute('aria-selected', 'true');

    const headerCenters = await Promise.all(
        [tournamentTab, bettingTab, close].map(async (control) => {
            const box = await control.boundingBox();
            return box ? box.y + box.height / 2 : -1;
        })
    );
    expect(Math.max(...headerCenters) - Math.min(...headerCenters)).toBeLessThan(1);

    await bettingTab.click();
    await expect(page).toHaveURL(/\/betting$/);
    await expect(page.getByRole('tab', { name: '베팅장' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: '토너먼트' }).click();
    await expect(page).toHaveURL(/\/tournament$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('mobile betting rankings use tabs and keep dedicated icons beside general names', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { placedBets } = await installFixture(page, { tournamentStage: 6 });
    await page.goto('betting');

    await expect(page.locator('.candidate-table')).toHaveCount(0);
    const betButtons = page.locator('.mobile-bracket .bracket-bet-button:visible');
    await expect(betButtons).toHaveCount(16);
    await expect(page.locator('.betting-bracket .bracket-core-stat').first()).toHaveText('종합 240');
    await expect(page.locator('.betting-bracket .bracket-my-bet').first()).toHaveText('내 투자 금120');

    const firstCard = page.locator('.mobile-bracket-name[data-general-id="1"]');
    const firstBetButton = page.getByRole('button', { name: '관우에게 베팅하기' });
    const corner = await firstCard.evaluate((card) => {
        const own = card.getBoundingClientRect();
        const button = card.querySelector<HTMLElement>('.bracket-bet-button')!.getBoundingClientRect();
        return {
            topOffset: button.top - own.top,
            rightOffset: own.right - button.right,
            contained: button.top >= own.top && button.right <= own.right && button.bottom <= own.bottom,
        };
    });
    expect(corner.topOffset).toBeGreaterThanOrEqual(2);
    expect(corner.topOffset).toBeLessThanOrEqual(4);
    expect(corner.rightOffset).toBeGreaterThanOrEqual(2);
    expect(corner.rightOffset).toBeLessThanOrEqual(4);
    expect(corner.contained).toBe(true);

    await firstBetButton.hover();
    await expect(firstBetButton).toHaveCSS('filter', 'brightness(1.25)');
    await firstBetButton.focus();
    await expect(firstBetButton).toBeFocused();
    await firstBetButton.click();
    const dialog = page.getByRole('dialog', { name: '베팅하기' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('배당 28.00')).toBeVisible();
    await expect(dialog.getByText('예상 환수금 280')).toBeVisible();
    await dialog.getByLabel('베팅 금액').selectOption('50');
    await expect(dialog.getByText('예상 환수금 1,400')).toBeVisible();
    await persistScreenshot(
        page,
        'tournament-betting-dialog-mobile',
        testInfo.outputPath('betting-dialog-mobile.webp')
    );
    await dialog.getByRole('button', { name: '베팅 등록' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('[data-testid="game-toast"][data-feedback-kind="success"]')).toContainText(
        '베팅이 등록되었습니다.'
    );
    expect(placedBets).toEqual([{ targetId: 1, amount: 50 }]);

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

test('betting bracket shows intelligence for debate tournament candidates', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installFixture(page, { tournamentType: 3, tournamentStage: 6 });
    await page.goto('betting');

    await expect(page.locator('.betting-bracket .bracket-core-stat').first()).toHaveText('지력 80');
    await expect(page.locator('.betting-bracket .bracket-odds').first()).toHaveText('배당 28.00');
    await expect(page.locator('.betting-bracket .bracket-my-bet').first()).toHaveText('내 투자 금120');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('desktop betting presents icon-and-name cards and all four rankings without document overflow', async ({
    page,
}, testInfo) => {
    await page.setViewportSize({ width: 1365, height: 900 });
    await installFixture(page, { tournamentStage: 6 });
    await page.goto('betting');

    await expect(page.locator('.candidate-table')).toHaveCount(0);
    await expect(page.locator('.desktop-bracket .bracket-bet-button:visible')).toHaveCount(16);
    await expect(page.locator('.ranking-table:visible')).toHaveCount(4);
    await expect(page.locator('.general-identity-icon').first()).toHaveCSS('width', '64px');
    await expect(page.locator('.general-identity-icon').first()).toHaveCSS('height', '64px');
    const firstCardCorner = await page
        .locator('.desktop-bracket-name.betting-target[data-general-id="1"]')
        .evaluate((card) => {
            const own = card.getBoundingClientRect();
            const button = card.querySelector<HTMLElement>('.bracket-bet-button')!.getBoundingClientRect();
            return {
                topOffset: button.top - own.top,
                rightOffset: own.right - button.right,
                contained: button.top >= own.top && button.right <= own.right && button.bottom <= own.bottom,
            };
        });
    expect(firstCardCorner.topOffset).toBeGreaterThanOrEqual(2);
    expect(firstCardCorner.topOffset).toBeLessThanOrEqual(4);
    expect(firstCardCorner.rightOffset).toBeGreaterThanOrEqual(2);
    expect(firstCardCorner.rightOffset).toBeLessThanOrEqual(4);
    expect(firstCardCorner.contained).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1365);
    await persistScreenshot(page, 'tournament-ranking-desktop', testInfo.outputPath('tournament-ranking-desktop.webp'));
});
