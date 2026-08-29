import { expect, test, type Page, type Route } from '@playwright/test';

import { gameProfile, gameTrpcRoute } from './gameTestPaths.js';

const response = (data: unknown) => ({ result: { data } });
const errorResponse = (path: string) => ({
    error: {
        message: `Unhandled fixture operation: ${path}`,
        code: -32000,
        data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, path },
    },
});
const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const bettingList = {
    bettingList: {
        1: {
            id: 1,
            type: 'nation',
            name: '첫 번째 천통국 베팅',
            finished: false,
            selectCnt: 1,
            isExclusive: true,
            reqInheritancePoint: false,
            openYearMonth: 2400,
            closeYearMonth: 2411,
            winner: null,
            totalAmount: 0,
        },
        2: {
            id: 2,
            type: 'nation',
            name: '두 번째 천통국 베팅',
            finished: false,
            selectCnt: 1,
            isExclusive: true,
            reqInheritancePoint: false,
            openYearMonth: 2400,
            closeYearMonth: 2411,
            winner: null,
            totalAmount: 0,
        },
    },
    year: 200,
    month: 1,
};

const bettingDetail = (id: number) => ({
    bettingInfo: {
        ...bettingList.bettingList[id as 1 | 2],
        candidates: [
            { title: '위', info: '조조' },
            { title: '촉', info: '유비' },
            { title: '오', info: '손권' },
        ],
    },
    bettingDetail: [],
    myBetting: [],
    remainPoint: 5_000,
    year: 200,
    month: 1,
});

const installFixture = async (page: Page) => {
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_nation_betting_playwright');
        localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);

    let detailId = 2;
    await page.route(gameTrpcRoute, async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') return response({ myGeneral: { id: 7, name: '유비' } });
            if (operation === 'join.getConfig') return response({});
            if (operation === 'betting.getList') return response(bettingList);
            if (operation === 'betting.getDetail') {
                detailId = detailId === 2 ? 1 : 2;
                return response(bettingDetail(detailId));
            }
            if (operation === 'betting.bet') return response({ result: true });
            return errorResponse(operation);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(results),
        });
    });
};

test('keeps the nation-betting amount while changing candidates, submitting, and opening another bet', async ({
    page,
}, testInfo) => {
    await installFixture(page);
    await page.setViewportSize({ width: 500, height: 844 });
    await page.goto('nation-betting');

    await page.getByRole('button', { name: /두 번째 천통국 베팅/u }).click();
    const amount = page.getByRole('spinbutton', { name: '베팅 금액' });
    await amount.fill('100');
    await page.getByRole('button', { name: /위 조조/u }).click();
    await expect(amount).toHaveValue('100');
    await page.getByRole('button', { name: /촉 유비/u }).click();
    await expect(amount).toHaveValue('100');

    await page.getByRole('button', { name: '베팅', exact: true }).click();
    await expect(page.getByTestId('game-toast')).toContainText('베팅했습니다');
    await expect(amount).toHaveValue('100');

    await page.getByRole('button', { name: /첫 번째 천통국 베팅/u }).click();
    await expect(amount).toHaveValue('100');
    await page.screenshot({ path: testInfo.outputPath('nation-betting-amount-retained.png'), fullPage: true });
});
