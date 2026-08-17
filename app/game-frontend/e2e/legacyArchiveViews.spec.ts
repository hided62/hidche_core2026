import { expect, test, type Page, type Route } from '@playwright/test';

import { gameProfile, gameTrpcRoute } from './gameTestPaths.js';

const response = (data: unknown) => ({ result: { data } });
const operationNames = (route: Route) =>
    decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(',');

const isLegacyRequest = (route: Route): boolean =>
    decodeURIComponent(`${route.request().url()} ${route.request().postData() ?? ''}`).includes('legacy');

const installArchiveViews = async (page: Page) => {
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_archive_views');
        localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    await page.route(gameTrpcRoute, async (route) => {
        const legacy = isLegacyRequest(route);
        const results = operationNames(route).map((operation) => {
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') return response({ myGeneral: null });
            if (operation === 'ranking.getHallOfFameOptions') {
                return response([
                    {
                        sourceProfile: legacy ? 'hwe' : 'che',
                        season: legacy ? 1 : 2,
                        scenarios: [{ id: 7, name: legacy ? '이전 시나리오' : '현재 시나리오', count: 1 }],
                    },
                ]);
            }
            if (operation === 'ranking.getHallOfFame') {
                return response({
                    source: legacy ? 'legacy' : 'current',
                    sourceProfile: legacy ? 'hwe' : 'che',
                    sections: [
                        {
                            title: '명 성',
                            valueType: 'int',
                            entries: [
                                {
                                    generalId: 1,
                                    name: legacy ? '이전장수' : '현재장수',
                                    ownerName: null,
                                    nationName: legacy ? '이전국' : '현재국',
                                    bgColor: '#330000',
                                    fgColor: '#ffffff',
                                    picture: null,
                                    imageServer: 0,
                                    value: 100,
                                    printValue: '100',
                                },
                            ],
                        },
                    ],
                });
            }
            if (operation === 'dynasty.getList') {
                return response({
                    source: legacy ? 'legacy' : 'current',
                    current: legacy ? null : { year: 220, month: 1 },
                    entries: [
                        {
                            id: legacy ? 101 : 1,
                            source: legacy ? 'legacy' : 'current',
                            sourceProfile: legacy ? 'hwe' : 'che',
                            serverId: legacy ? 'hwe-old-1' : 'che-current-1',
                            phase: legacy ? '이전 1기' : '현재 1기',
                            name: '촉',
                            year: 215,
                            month: 4,
                            color: '#800000',
                            type: '병가',
                            power: 100,
                            gennum: 5,
                            citynum: 3,
                            l12name: '유비',
                            l11name: '제갈량',
                            l10name: '관우',
                            l9name: '방통',
                            l8name: '장비',
                            l7name: '법정',
                            l6name: '조운',
                            l5name: '마량',
                        },
                    ],
                });
            }
            if (operation === 'dynasty.getDetail') {
                return response({
                    source: 'legacy',
                    sourceProfile: 'hwe',
                    emperor: {
                        id: 101,
                        serverId: 'hwe-old-1',
                        winnerNationId: 1,
                        phase: '이전 1기',
                        nationCount: '1 / 2',
                        nationName: '촉',
                        nationHist: '병가',
                        genCount: '5 / 10',
                        personalHist: '의리',
                        specialHist: '상재',
                        name: '촉',
                        type: '병가',
                        color: '#800000',
                        year: 215,
                        month: 4,
                        power: 100,
                        gennum: 5,
                        citynum: 3,
                        pop: '1000',
                        poprate: '100%',
                        gold: 100,
                        rice: 100,
                        l12name: '유비',
                        l11name: '제갈량',
                        l10name: '관우',
                        l9name: '방통',
                        l8name: '장비',
                        l7name: '법정',
                        l6name: '조운',
                        l5name: '마량',
                        tiger: '',
                        eagle: '',
                        gen: '',
                        history: [],
                    },
                    nations: [],
                });
            }
            return { error: { message: `unhandled ${operation}`, data: { code: 'BAD_REQUEST' } } };
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
};

test('명예의 전당은 현재 기록과 이전 서버 기록을 분리해 조회한다', async ({ page }) => {
    await installArchiveViews(page);
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto('hall-of-fame');

    await expect(page.getByText('현재장수')).toBeVisible();
    await page.getByLabel('기록 구분').selectOption('legacy');
    await expect(page.getByText('이전장수')).toBeVisible();
    await expect(page.getByLabel('시나리오 검색')).toContainText('HWE / 이전 시나리오');
    await expect(page.locator('.legacy-hall-page')).toHaveCSS('width', '1000px');
});

test('왕조 일람과 상세는 이전 서버 source와 profile을 유지한다', async ({ page }) => {
    await installArchiveViews(page);
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('dynasty');

    await expect(page.getByText('현재 1기')).toBeVisible();
    await page.getByLabel('기록 구분').selectOption('legacy');
    await expect(page.getByText(/이전 1기.*HWE 이전 서버/)).toBeVisible();
    const detailLink = page.getByRole('link', { name: '자세히' });
    await expect(detailLink).toHaveAttribute('href', /dynasty\/101\?source=legacy$/);
    await detailLink.click();
    await expect(page.getByText(/이전 1기.*HWE 이전 서버/)).toBeVisible();
    await expect(page.locator('.dynasty-page')).toHaveCSS('width', '1000px');
});
