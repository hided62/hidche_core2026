import { expect, test, type Page, type Route } from '@playwright/test';

const response = (data: unknown) => ({ result: { data } });
const gameUrl = process.env.FRONTEND_PARITY_GAME_URL ?? 'http://127.0.0.1:15102';
const artifactDir = process.env.FRONTEND_PARITY_ARTIFACT_DIR;
const errorResponse = (path: string, message: string) => ({
    error: {
        message,
        code: -32000,
        data: { code: 'BAD_REQUEST', httpStatus: 400, path },
    },
});

const operationNames = (route: Route): string[] => {
    const pathname = new URL(route.request().url()).pathname;
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const participants = Array.from({ length: 64 }, (_, index) => ({
    id: index + 1,
    name: `장수${String(index + 1).padStart(2, '0')}`,
    leadership: 80 - (index % 20),
    strength: 70 + (index % 20),
    intel: 65 + (index % 15),
    level: 5,
    groupId: 10 + Math.floor(index / 8),
    groupNo: index % 8,
    win: index % 4,
    draw: index % 2,
    lose: (index + 1) % 3,
    gl: 20 - index,
    finalRank: (index % 8) + 1,
}));

const matches = Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    stage: 7,
    roundIndex: index,
    attackerId: index * 2 + 1,
    defenderId: index * 2 + 2,
}));

const snapshot = {
    state: {
        stage: 6,
        phase: 0,
        type: 0,
        auto: true,
        openYear: 193,
        openMonth: 1,
        termSeconds: 60,
        nextAt: '2099-01-01T00:00:00.000Z',
        bettingId: 7,
        bettingCloseAt: '2099-01-01T00:00:00.000Z',
    },
    participants,
    matches,
    betCount: 3,
};

const bettingSummary = {
    state: snapshot.state,
    totals: { 1: 300, 2: 200, 3: 100 },
    myTotals: { 1: 50 },
    totalAmount: 600,
    myAmount: 50,
};

const installFixture = async (page: Page) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-game-token', 'ga_tournament_visual');
        window.localStorage.setItem('sammo-game-profile', 'che:default');
    });
    let betCalls = 0;
    let joinCalls = 0;
    await page.route('**/image/game/**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'image/jpeg',
            body: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==', 'base64'),
        })
    );
    await page.route('**/che/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'lobby.info') {
                return response({ myGeneral: { id: 64, name: '내장수' } });
            }
            if (operation === 'join.getConfig') return response({});
            if (operation === 'general.me') {
                return response({ general: { id: 64, name: '내장수' }, nation: null, city: null });
            }
            if (operation === 'tournament.getSnapshot') return response(snapshot);
            if (operation === 'tournament.getBettingSummary') return response(bettingSummary);
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
                        entries: [
                            {
                                rank: 1,
                                generalId: 1,
                                name: '장수01',
                                npcState: 0,
                                stat: 210,
                                games: 12,
                                win: 8,
                                draw: 2,
                                lose: 2,
                                score: 42,
                                prizes: 1,
                            },
                        ],
                    }))
                );
            }
            if (operation === 'tournament.getAdminStatus')
                return errorResponse(operation, 'Admin permission is required.');
            if (operation === 'tournament.join') {
                joinCalls += 1;
                return joinCalls === 1
                    ? errorResponse(operation, '금이 부족합니다.')
                    : response({ ok: true, count: 64 });
            }
            if (operation === 'tournament.placeBet') {
                betCalls += 1;
                return betCalls === 1
                    ? errorResponse(operation, '500금까지만 베팅 가능합니다.')
                    : response({ ok: true });
            }
            return errorResponse(operation, `Unhandled fixture operation: ${operation}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(results),
        });
    });
};

test.beforeEach(async ({ page }) => {
    await installFixture(page);
});

test('tournament keeps the legacy 2000px bracket and 250px group geometry', async ({ page }) => {
    await page.setViewportSize({ width: 2200, height: 1000 });
    await page.goto(`${gameUrl}/che/tournament`);
    await expect(page.getByText('삼모전 토너먼트')).toBeVisible();
    await expect(page.locator('.top16 span')).toHaveCount(16);

    const geometry = await page.locator('#tournament-container').evaluate((container) => {
        const rect = container.getBoundingClientRect();
        const candidate = container.querySelector<HTMLElement>('.top16 span')!;
        const groupTable = container.querySelector<HTMLElement>('.group-grid table')!;
        const title = container.querySelector<HTMLElement>('.legacy-title')!;
        const refresh = container.querySelector<HTMLElement>('.toolbar button')!;
        const style = getComputedStyle(container);
        return {
            x: rect.x,
            width: rect.width,
            candidateWidth: candidate.getBoundingClientRect().width,
            groupWidth: groupTable.getBoundingClientRect().width,
            titleHeight: title.getBoundingClientRect().height,
            refreshHeight: refresh.getBoundingClientRect().height,
            refreshRadius: getComputedStyle(refresh).borderRadius,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            backgroundImage: getComputedStyle(container.querySelector<HTMLElement>('.bracket')!).backgroundImage,
        };
    });
    expect(geometry).toMatchObject({
        x: 100,
        width: 2000,
        candidateWidth: 125,
        groupWidth: 250,
        titleHeight: 55.6875,
        refreshHeight: 35.5,
        refreshRadius: '5.25px',
        fontSize: '14px',
    });
    expect(geometry.fontFamily).toContain('Pretendard');
    expect(geometry.backgroundImage).toContain('back_walnut.jpg');
    if (artifactDir) await page.screenshot({ path: `${artifactDir}/core-tournament.png`, fullPage: true });

    const refresh = page.getByRole('button', { name: '갱신' });
    const before = await refresh.evaluate((element) => getComputedStyle(element).filter);
    await refresh.hover();
    const hover = await refresh.evaluate((element) => getComputedStyle(element).filter);
    await refresh.focus();
    await expect(refresh).toBeFocused();
    expect(hover).not.toBe(before);
});

test('tournament keeps the fixed legacy canvas at a 1024px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`${gameUrl}/che/tournament`);
    await expect(page.locator('#tournament-container')).toHaveCSS('width', '2000px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThanOrEqual(2000);
});

test('betting keeps the 1120px and 16 by 70px layout and retains a failed selection', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${gameUrl}/che/betting`);
    await expect(page.getByText('베 팅 장')).toBeVisible();
    await expect(page.locator('.names span')).toHaveCount(16);

    const geometry = await page.locator('#tournament-betting-container').evaluate((container) => {
        const rect = container.getBoundingClientRect();
        const first = container.querySelector<HTMLElement>('.names span')!;
        const title = container.querySelector<HTMLElement>('.title')!;
        const refresh = container.querySelector<HTMLElement>('.toolbar button')!;
        const stateStyle = getComputedStyle(container.querySelector<HTMLElement>('.state')!);
        const tableStyle = getComputedStyle(container.querySelector<HTMLElement>('.candidate-table')!);
        return {
            x: rect.x,
            width: rect.width,
            candidateWidth: first.getBoundingClientRect().width,
            titleHeight: title.getBoundingClientRect().height,
            refreshHeight: refresh.getBoundingClientRect().height,
            refreshRadius: getComputedStyle(refresh).borderRadius,
            stateFontSize: stateStyle.fontSize,
            tableFontSize: tableStyle.fontSize,
            tableBorder: tableStyle.borderTopWidth,
        };
    });
    expect(geometry).toEqual({
        x: 80,
        width: 1120,
        candidateWidth: 70,
        titleHeight: 55.6875,
        refreshHeight: 35.5,
        refreshRadius: '5.25px',
        stateFontSize: '24px',
        tableFontSize: '10px',
        tableBorder: '1px',
    });
    if (artifactDir) await page.screenshot({ path: `${artifactDir}/core-betting.png`, fullPage: true });

    const select = page.getByLabel('장수01 베팅 금액');
    await select.selectOption('500');
    const bet = page.getByRole('button', { name: '베팅!' }).first();
    await bet.hover();
    await bet.focus();
    await expect(bet).toBeFocused();
    await bet.click();
    await expect(page.getByRole('status')).toHaveText('500금까지만 베팅 가능합니다.');
    await expect(select).toHaveValue('500');

    await bet.click();
    await expect(page.getByRole('status')).toHaveText('베팅이 등록되었습니다.');
});
