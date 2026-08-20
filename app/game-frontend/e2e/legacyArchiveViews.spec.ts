import { expect, test, type Page, type Route } from '@playwright/test';

import { gameProfile, gameTrpcRoute } from './gameTestPaths.js';

const response = (data: unknown) => ({ result: { data } });
const operationNames = (route: Route) =>
    decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(',');

const isLegacyRequest = (route: Route): boolean =>
    decodeURIComponent(`${route.request().url()} ${route.request().postData() ?? ''}`).includes('legacy');

const installArchiveViews = async (page: Page) => {
    const hallRequests: string[] = [];
    const dynastyRequests: string[] = [];
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_archive_views');
        localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    await page.route(gameTrpcRoute, async (route) => {
        const legacy = isLegacyRequest(route);
        const operations = operationNames(route);
        if (operations.some((operation) => operation.startsWith('ranking.getHallOfFame'))) {
            hallRequests.push(decodeURIComponent(`${route.request().url()} ${route.request().postData() ?? ''}`));
        }
        if (operations.some((operation) => operation.startsWith('dynasty.'))) {
            dynastyRequests.push(decodeURIComponent(`${route.request().url()} ${route.request().postData() ?? ''}`));
        }
        const results = operations.map((operation) => {
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') return response({ myGeneral: { id: 1, name: '기록장수' } });
            if (operation === 'ranking.getHallOfFameOptions') {
                return response([
                    {
                        sourceProfile: 'che',
                        season: 1,
                        scenarios: [{ id: 7, name: legacy ? '이전 시나리오' : '현재 시나리오', count: 1 }],
                    },
                ]);
            }
            if (operation === 'ranking.getHallOfFame') {
                return response({
                    source: legacy ? 'legacy' : 'current',
                    sourceProfile: 'che',
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
                            sourceProfile: 'che',
                            serverId: legacy ? 'che-old-1' : 'che-current-1',
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
                    sourceProfile: 'che',
                    emperor: {
                        id: 101,
                        serverId: 'che-old-1',
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
            if (operation === 'yearbook.getRange') {
                return response({ firstYearMonth: 22001, lastYearMonth: 22001, currentYearMonth: 22001 });
            }
            if (operation === 'public.getMapLayout') {
                return response({ mapName: 'che', cityList: [], regionMap: {}, levelMap: {} });
            }
            if (operation === 'yearbook.getHistory') {
                return response({
                    notModified: false,
                    hash: 'nation-color-contrast',
                    data: {
                        year: 220,
                        month: 1,
                        map: {
                            result: true,
                            version: 0,
                            startYear: 180,
                            year: 220,
                            month: 1,
                            techLevelLimit: { maxLevel: 12, initialLevel: 1, increaseYears: 5 },
                            cityList: [],
                            nationList: [],
                            spyList: {},
                            shownByGeneralList: [],
                            myCity: null,
                            myNation: null,
                        },
                        nations: [
                            {
                                id: 1,
                                name: '암국',
                                color: '#008000',
                                level: 1,
                                power: 100,
                                generalCount: 1,
                                cities: ['업'],
                            },
                            {
                                id: 2,
                                name: '명국',
                                color: '#FFFF00',
                                level: 1,
                                power: 90,
                                generalCount: 1,
                                cities: ['허창'],
                            },
                        ],
                        globalHistory: [],
                        globalAction: [],
                    },
                });
            }
            return { error: { message: `unhandled ${operation}`, data: { code: 'BAD_REQUEST' } } };
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
    return { dynastyRequests, hallRequests };
};

test('명예의 전당은 현재 profile의 현재·이전 서버 기록만 조회한다', async ({ page }, testInfo) => {
    const state = await installArchiveViews(page);
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto('hall-of-fame');

    await expect(page.getByText('현재장수')).toBeVisible();
    await page.getByLabel('기록 구분').selectOption('legacy');
    await expect(page.getByText('이전장수')).toBeVisible();
    await expect(page.getByLabel('시나리오 검색')).toContainText('이전 시나리오');
    await expect(page.getByLabel('시나리오 검색')).not.toContainText('HWE /');
    expect(state.hallRequests.some((request) => request.includes('legacy'))).toBe(true);
    expect(state.hallRequests.every((request) => !request.includes('sourceProfile'))).toBe(true);
    await expect(page.locator('.legacy-hall-page')).toHaveCSS('width', '1000px');
    await page.getByLabel('시나리오 검색').focus();
    await expect(page.getByLabel('시나리오 검색')).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('hall-profile-scope-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.legacy-hall-page')).toHaveCSS('width', '500px');
    expect(
        await page.getByLabel('시나리오 검색').evaluate((element) => element.scrollWidth <= element.clientWidth)
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('hall-profile-scope-mobile.png'), fullPage: true });
});

test('왕조 일람과 상세는 현재 profile의 이전 서버 기록만 조회한다', async ({ page }, testInfo) => {
    const state = await installArchiveViews(page);
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('dynasty');

    await expect(page.getByText('현재 1기')).toBeVisible();
    await page.getByLabel('기록 구분').focus();
    await expect(page.getByLabel('기록 구분')).toBeFocused();
    await page.getByLabel('기록 구분').selectOption('legacy');
    await expect(page.getByText(/이전 1기.*이전 서버/)).toBeVisible();
    await expect(page.getByText(/CHE 이전 서버|HWE 이전 서버/)).toHaveCount(0);
    await expect(page.locator('.dynasty-page')).toHaveCSS('width', '1000px');
    await expect(page.locator('.dynasty-table')).toHaveCSS('height', '139px');
    await expect(page.locator('.dynasty-table .phase-heading')).toHaveCSS('background-color', 'rgb(135, 206, 235)');
    await page.screenshot({ path: testInfo.outputPath('dynasty-list-profile-scope-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.dynasty-page')).toHaveCSS('width', '1000px');
    await page.screenshot({ path: testInfo.outputPath('dynasty-list-profile-scope-mobile.png'), fullPage: true });

    await page.setViewportSize({ width: 1200, height: 800 });
    const detailLink = page.getByRole('link', { name: '자세히' });
    await expect(detailLink).toHaveAttribute('href', /dynasty\/101\?source=legacy$/);
    await detailLink.click();
    await expect(page.getByText(/이전 1기.*이전 서버/)).toBeVisible();
    await expect(page.getByText(/CHE 이전 서버|HWE 이전 서버/)).toHaveCount(0);
    await expect(page.locator('.dynasty-page')).toHaveCSS('width', '1000px');
    expect(state.dynastyRequests.some((request) => request.includes('legacy'))).toBe(true);
    expect(state.dynastyRequests.every((request) => !request.includes('sourceProfile'))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('dynasty-detail-profile-scope-desktop.png'), fullPage: true });
});

test('연감 국가 라벨은 밝은 배경에 검정, 어두운 배경에 흰 글자를 사용한다', async ({ page }, testInfo) => {
    await installArchiveViews(page);
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('yearbook');

    const labels = page.locator('.nation-position tbody td:first-child span');
    await expect(labels).toHaveCount(2);
    await expect(labels.filter({ hasText: '암국' })).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(labels.filter({ hasText: '명국' })).toHaveCSS('color', 'rgb(0, 0, 0)');
    await page.screenshot({ path: testInfo.outputPath('yearbook-nation-contrast-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 500, height: 800 });
    await expect(labels.filter({ hasText: '암국' })).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(labels.filter({ hasText: '명국' })).toHaveCSS('color', 'rgb(0, 0, 0)');
    await page.screenshot({ path: testInfo.outputPath('yearbook-nation-contrast-mobile.png'), fullPage: true });
});
