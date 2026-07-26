import { expect, test, type Page, type Route } from '@playwright/test';

const response = (data: unknown) => ({ result: { data } });
const operations = (route: Route) =>
    decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(',');
const general = {
    id: 1,
    name: '테스트장수',
    npcState: 0,
    officerLevel: 1,
    cityId: 1,
    cityName: null,
    troopId: 0,
    troopName: null,
    officerCity: 0,
    officerCityName: null,
    stats: { leadership: 70, strength: 60, intelligence: 50 },
    experienceLevel: 9,
    dedicationLevel: 1,
    injury: 0,
    gold: 1000,
    rice: 2000,
    personality: null,
    specialDomestic: null,
    specialWar: null,
    belong: 1,
    refreshScoreTotal: 10,
    permission: 'normal',
};
const install = async (page: Page, secretAllowed = true) => {
    await page.addInitScript(() => {
        localStorage.setItem('sammo-game-token', 'ga_general');
        localStorage.setItem('sammo-game-profile', 'che:default');
    });
    await page.route('**/che/api/trpc/**', async (route) => {
        const results = operations(route).map((operation) => {
            if (operation === 'lobby.info') return response({ myGeneral: { id: 1, name: '테스트장수' } });
            if (operation === 'join.getConfig') return response({});
            if (operation === 'nation.getGeneralList')
                return response({
                    nation: { id: 1, name: '위', color: '#008000', level: 3 },
                    viewer: { generalId: 1, permission: 0 },
                    generals: [general],
                });
            if (operation === 'nation.getSecretGeneralList') {
                if (!secretAllowed)
                    return {
                        error: {
                            message: '권한이 부족합니다.',
                            code: -32000,
                            data: { code: 'FORBIDDEN', httpStatus: 403, path: operation },
                        },
                    };
                return response({
                    nation: { id: 1, name: '위', color: '#008000', level: 3 },
                    viewer: { generalId: 1, permission: 1 },
                    summary: {
                        gold: 1000,
                        rice: 2000,
                        crew: 300,
                        generalCount: 1,
                        averageGold: 1000,
                        averageRice: 2000,
                        readiness: {
                            90: { crew: 300, generals: 1 },
                            80: { crew: 300, generals: 1 },
                            60: { crew: 300, generals: 1 },
                        },
                    },
                    generals: [
                        {
                            id: 1,
                            name: '테스트장수',
                            npcState: 0,
                            injury: 0,
                            stats: { leadership: 70, strength: 60, intelligence: 50 },
                            leadershipBonus: 0,
                            experienceLevel: 9,
                            troopId: 0,
                            troopName: null,
                            gold: 1000,
                            rice: 2000,
                            cityId: 1,
                            cityName: '업',
                            defenceTrain: 90,
                            defenceTrainText: '☆',
                            crewTypeId: 1,
                            crew: 300,
                            train: 90,
                            atmos: 90,
                            killTurn: 7,
                            turnTime: '2026-01-01T01:02:00.000Z',
                            reservedCommands: ['징병', '훈련'],
                        },
                    ],
                });
            }
            return { error: { message: `unhandled ${operation}`, data: { code: 'BAD_REQUEST' } } };
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
};

test('nation generals keeps the 1000px legacy grid and redacted member columns', async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('nation/generals');
    await expect(page.locator('#nation-general-list')).toContainText('테스트장수');
    await expect(page.locator('#nation-general-list')).toContainText('?');
    const computed = await page.locator('.general-page').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { x: rect.x, width: rect.width, fontSize: style.fontSize, fontFamily: style.fontFamily };
    });
    expect(computed).toMatchObject({ x: 100, width: 1000, fontSize: '16px' });
    expect(computed.fontFamily).toContain('Times New Roman');
    expect(await page.locator('#nation-general-list').evaluate((el) => getComputedStyle(el).borderCollapse)).toBe(
        'separate'
    );
    expect((await page.locator('#nation-general-list').boundingBox())?.width).toBe(1030);
    expect((await page.locator('#nation-general-list tbody tr').boundingBox())?.height).toBe(66);
});

test('both pages preserve the legacy 1000px overflow contract at 500px', async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width: 500, height: 900 });
    for (const path of ['nation/generals', 'nation/secret']) {
        await page.goto(path);
        await expect(
            page.locator(path.endsWith('secret') ? '#secret-general-list' : '#nation-general-list')
        ).toBeVisible();
        expect(await page.locator('main').evaluate((el) => el.getBoundingClientRect().width)).toBe(1000);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThanOrEqual(1000);
    }
});

test('secret office renders summary, turns, and the forbidden error flow', async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('nation/secret');
    await expect(page.locator('.summary')).toContainText('전체 금');
    await expect(page.locator('#secret-general-list')).toContainText('1 : 징병');
    expect(await page.locator('.secret-page').evaluate((el) => el.getBoundingClientRect().width)).toBe(1000);

    await page.unroute('**/che/api/trpc/**');
    await install(page, false);
    await page.goto('nation/secret');
    await expect(page.getByRole('alert')).toContainText('권한이 부족합니다.');
    await expect(page.locator('#secret-general-list')).toHaveCount(0);
});
