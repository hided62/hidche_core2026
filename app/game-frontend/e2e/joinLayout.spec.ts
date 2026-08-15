import { expect, test, type Page, type Route } from '@playwright/test';
import { gameBasePath, gameProfile } from './gameTestPaths.js';

const response = (data: unknown) => ({ result: { data } });
const operationNames = (route: Route) =>
    decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(',');

type FixtureState = {
    mapRequests: number;
    generalRequests: number;
    created?: boolean;
    createRequests?: number;
};

const installFixture = async (page: Page, state: FixtureState): Promise<void> => {
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_join_layout');
        localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    await page.route('**/events**', async (route) => route.abort());
    await page.route('**/image/**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="700" height="500"><rect width="700" height="500" fill="#283c2c"/></svg>',
        });
    });
    await page.route(`**${gameBasePath}/api/trpc/**`, async (route) => {
        const operations = operationNames(route);
        const results = operations.map((operation) => {
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') {
                return response({
                    myGeneral: state.created ? { id: 9, name: '생성장수' } : null,
                    year: 180,
                    month: 4,
                    turnTerm: 5,
                });
            }
            if (operation === 'join.getConfig') {
                return response({
                    rules: {
                        stat: { total: 165, min: 15, max: 80, bonusMin: 3, bonusMax: 5 },
                        allowCustomName: true,
                    },
                    user: {
                        id: 'join-layout-user',
                        displayName: '생성장수',
                        canCreateGeneral: true,
                        icons: [],
                        preferredPicture: 'default.jpg',
                    },
                    personalities: [
                        { key: 'Random', name: '???', info: '무작위 성격을 선택합니다.' },
                        { key: 'che_대담', name: '대담', info: '과감한 행동을 선호합니다.' },
                    ],
                    warSpecials: [{ key: 'che_무쌍', name: '무쌍', info: '전투 특기' }],
                    nations: [
                        { id: 1, name: '촉', color: '#66aa44', scoutMessage: '함께 천하를 도모합시다.' },
                        { id: 2, name: '위', color: '#5577bb', scoutMessage: '능력 있는 장수를 기다립니다.' },
                    ],
                    serverInfo: {
                        currentYear: 180,
                        currentMonth: 4,
                        tickMinutes: 5,
                        maxGeneral: 500,
                        userGeneralCount: 2,
                        npcGeneralCount: 1,
                    },
                    inherit: {
                        totalPoint: 30,
                        costs: {
                            inheritBornSpecialPoint: 10,
                            inheritBornTurntimePoint: 5,
                            inheritBornCityPoint: 5,
                            inheritBornStatPoint: 10,
                        },
                        availableCities: [{ id: 1, name: '성도', level: 4, region: 5 }],
                        turnTimeZones: ['00분', '05분'],
                        availableSpecialWar: [{ key: 'che_무쌍', name: '무쌍', info: '전투 특기' }],
                    },
                    selectionPool: { enabled: false, hasGeneral: false },
                    npcPossession: { enabled: true },
                });
            }
            if (operation === 'public.getCachedMap') {
                state.mapRequests += 1;
                return response({
                    year: 180,
                    month: 4,
                    startYear: 180,
                    cityList: [[1, 4, 0, 1, 5, 1]],
                    nationList: [[1, '촉', '#66aa44', 1]],
                    myCity: null,
                    myNation: null,
                    history: [],
                });
            }
            if (operation === 'public.getMapLayout') {
                state.mapRequests += 1;
                return response({
                    mapName: 'che',
                    cityList: [{ id: 1, name: '성도', level: 4, region: 5, x: 100, y: 100, path: [] }],
                    regionMap: { 5: '익주' },
                    levelMap: { 4: '대도시' },
                });
            }
            if (operation === 'public.getGeneralList') {
                state.generalRequests += 1;
                return response([
                    {
                        id: 1,
                        name: '유비',
                        npcState: 0,
                        nationId: 1,
                        nationName: '촉',
                        leadership: 72,
                        strength: 67,
                        intelligence: 76,
                    },
                    {
                        id: 2,
                        name: '조조',
                        npcState: 0,
                        nationId: 2,
                        nationName: '위',
                        leadership: 78,
                        strength: 62,
                        intelligence: 80,
                    },
                    {
                        id: 3,
                        name: '황건장수',
                        npcState: 2,
                        nationId: 0,
                        nationName: '무주',
                        leadership: 55,
                        strength: 65,
                        intelligence: 45,
                    },
                ]);
            }
            if (operation === 'join.createGeneral') {
                state.created = true;
                state.createRequests = (state.createRequests ?? 0) + 1;
                return response({ generalId: 9 });
            }
            if (operation === 'world.getState') {
                return response({ config: { npcMode: 0 } });
            }
            return response({});
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(operations.length === 1 ? results[0] : results),
        });
    });
};

test('prioritizes core general fields and keeps context and inheritance progressive', async ({ page }, testInfo) => {
    const state: FixtureState = { mapRequests: 0, generalRequests: 0 };
    await installFixture(page, state);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('join');

    const flow = page.locator('.join-flow');
    const basicPanel = flow.locator('.panel-card').first();
    const advanced = flow.locator('.advanced-options');
    const contextPanel = flow.locator('.panel-card').nth(1);
    await expect(page.getByRole('heading', { name: '장수 기본 정보' })).toBeVisible();
    await expect(page.getByLabel('장수명')).toHaveValue('생성장수');
    await expect(page.getByLabel('성격')).toBeVisible();
    await expect(page.locator('.create-form').getByLabel('통솔')).toHaveValue('55');
    const statActions = page.getByRole('group', { name: '능력치 빠른 설정' });
    await expect(statActions.getByRole('button')).toHaveText(['랜덤형', '통솔무력형', '통솔지력형', '무력지력형']);
    const randomButton = statActions.getByRole('button', { name: '랜덤형', exact: true });
    const defaultButtonStyle = await randomButton.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            top: rect.top,
            height: rect.height,
            backgroundColor: style.backgroundColor,
            color: style.color,
            borderTopWidth: style.borderTopWidth,
            borderRightWidth: style.borderRightWidth,
            borderBottomWidth: style.borderBottomWidth,
            borderBottomColor: style.borderBottomColor,
            marginTop: style.marginTop,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            cursor: style.cursor,
        };
    });
    expect(defaultButtonStyle).toMatchObject({
        height: 40,
        backgroundColor: 'rgb(0, 88, 44)',
        color: 'rgb(255, 255, 255)',
        borderTopWidth: '0px',
        borderRightWidth: '1px',
        borderBottomWidth: '4px',
        borderBottomColor: 'rgb(0, 79, 40)',
        marginTop: '0px',
        fontSize: '14px',
        fontWeight: '700',
        cursor: 'pointer',
    });
    await randomButton.hover();
    const hoverButtonStyle = await randomButton.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            top: rect.top,
            height: rect.height,
            backgroundColor: style.backgroundColor,
            borderBottomWidth: style.borderBottomWidth,
            borderBottomColor: style.borderBottomColor,
            marginTop: style.marginTop,
        };
    });
    expect(hoverButtonStyle).toMatchObject({
        top: defaultButtonStyle.top + 1,
        height: 39,
        backgroundColor: 'rgb(0, 88, 44)',
        borderBottomWidth: '3px',
        borderBottomColor: 'rgb(0, 79, 40)',
        marginTop: '1px',
    });
    await page.screenshot({ path: testInfo.outputPath('join-stat-actions-hover-desktop.png'), fullPage: true });
    await randomButton.focus();
    await expect(randomButton).toBeFocused();
    await expect.poll(() => randomButton.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
    const randomButtonBox = await randomButton.boundingBox();
    expect(randomButtonBox).not.toBeNull();
    await page.mouse.move(
        randomButtonBox!.x + randomButtonBox!.width / 2,
        randomButtonBox!.y + randomButtonBox!.height / 2
    );
    await page.mouse.down();
    const activeButtonStyle = await randomButton.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            top: rect.top,
            height: rect.height,
            backgroundColor: style.backgroundColor,
            borderBottomWidth: style.borderBottomWidth,
            borderBottomColor: style.borderBottomColor,
            marginTop: style.marginTop,
        };
    });
    expect(activeButtonStyle).toMatchObject({
        top: defaultButtonStyle.top + 2,
        height: 38,
        backgroundColor: 'rgb(0, 88, 44)',
        borderBottomWidth: '2px',
        borderBottomColor: 'rgb(0, 79, 40)',
        marginTop: '2px',
    });
    await page.screenshot({ path: testInfo.outputPath('join-stat-actions-active-desktop.png'), fullPage: true });
    await page.mouse.up();
    const setRandomValues = async (values: number[]) => {
        await page.evaluate((nextValues) => {
            let index = 0;
            Math.random = () => nextValues[index++] ?? nextValues.at(-1) ?? 0.5;
        }, values);
    };

    await setRandomValues([0.2, 0.4, 0.6]);
    await statActions.getByRole('button', { name: '랜덤형', exact: true }).click();
    await expect(page.locator('.create-form').getByLabel('통솔')).toHaveValue('36');
    await expect(page.locator('.create-form').getByLabel('무력')).toHaveValue('55');
    await expect(page.locator('.create-form').getByLabel('지력')).toHaveValue('74');

    await setRandomValues([0.9, 0.8, 0.5]);
    await statActions.getByRole('button', { name: '통솔무력형' }).click();
    await expect(page.locator('.create-form').getByLabel('통솔')).toHaveValue('75');
    await expect(page.locator('.create-form').getByLabel('무력')).toHaveValue('75');
    await expect(page.locator('.create-form').getByLabel('지력')).toHaveValue('15');

    await setRandomValues([0.9, 0.5, 0.8]);
    await statActions.getByRole('button', { name: '통솔지력형' }).click();
    await expect(page.locator('.create-form').getByLabel('통솔')).toHaveValue('75');
    await expect(page.locator('.create-form').getByLabel('무력')).toHaveValue('15');
    await expect(page.locator('.create-form').getByLabel('지력')).toHaveValue('75');

    await setRandomValues([0.5, 0.9, 0.8]);
    await statActions.getByRole('button', { name: '무력지력형' }).click();
    await expect(page.locator('.create-form').getByLabel('통솔')).toHaveValue('15');
    await expect(page.locator('.create-form').getByLabel('무력')).toHaveValue('75');
    await expect(page.locator('.create-form').getByLabel('지력')).toHaveValue('75');
    await expect(page.locator('.stat-summary')).toContainText('능력치 합계: 165');
    await expect(advanced).not.toHaveAttribute('open');
    await expect(page.getByText('전투 특기 선택')).toBeHidden();
    expect(state.mapRequests).toBe(0);
    expect(state.generalRequests).toBe(0);

    const geometry = await flow.evaluate((element) => {
        const basic = element.querySelector<HTMLElement>('.panel-card');
        const advancedOptions = element.querySelector<HTMLElement>('.advanced-options');
        const context = element.querySelectorAll<HTMLElement>('.panel-card')[1];
        const rect = element.getBoundingClientRect();
        return {
            width: rect.width,
            left: rect.left,
            basicTop: basic?.getBoundingClientRect().top,
            advancedTop: advancedOptions?.getBoundingClientRect().top,
            contextTop: context?.getBoundingClientRect().top,
        };
    });
    expect(geometry.width).toBe(1000);
    expect(geometry.left).toBe(100);
    expect(geometry.basicTop).toBeLessThan(geometry.advancedTop ?? 0);
    expect(geometry.advancedTop).toBeLessThan(geometry.contextTop ?? 0);
    await expect(basicPanel).toBeVisible();
    await expect(contextPanel).toBeVisible();

    await advanced.locator('summary').click();
    await expect(advanced).toHaveAttribute('open');
    await expect(page.getByText('전투 특기 선택')).toBeVisible();
    await page.getByLabel('전투 특기 선택').selectOption('che_무쌍');
    await expect(advanced.locator('.advanced-point-summary')).toContainText('사용 10');

    const mapTab = page.getByRole('tab', { name: '현재 지도' });
    await mapTab.click();
    await expect(mapTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#context-panel-map .map-area')).toBeVisible();
    expect(state.mapRequests).toBe(2);

    const generalTab = page.getByRole('tab', { name: '장수 목록' });
    await generalTab.click();
    await expect(page.locator('.context-general-table tbody tr')).toHaveCount(3);
    expect(state.generalRequests).toBe(1);
    await page.getByPlaceholder('장수명 또는 국가 검색').fill('촉');
    await expect(page.locator('.context-general-table tbody tr')).toHaveCount(1);
    await expect(page.locator('.context-general-table')).toContainText('유비');
    await generalTab.focus();
    await expect(generalTab).toBeFocused();

    await page.screenshot({ path: testInfo.outputPath('join-layout-desktop.png'), fullPage: true });
});

test('keeps the primary creation flow readable without horizontal overflow on mobile', async ({ page }, testInfo) => {
    const state: FixtureState = { mapRequests: 0, generalRequests: 0 };
    await installFixture(page, state);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('join');

    await expect(page.getByRole('heading', { name: '장수 기본 정보' })).toBeVisible();
    const mobileGeometry = await page.evaluate(() => {
        const flow = document.querySelector<HTMLElement>('.join-flow');
        const tabs = document.querySelector<HTMLElement>('.context-tabs');
        return {
            viewportWidth: window.innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            flowWidth: flow?.getBoundingClientRect().width,
            tabsWidth: tabs?.getBoundingClientRect().width,
        };
    });
    expect(mobileGeometry).toEqual({
        viewportWidth: 390,
        documentWidth: 390,
        flowWidth: 366,
        tabsWidth: 352,
    });
    const mobileStatButtons = await page
        .getByRole('group', { name: '능력치 빠른 설정' })
        .getByRole('button')
        .evaluateAll((buttons) =>
            buttons.map((button) => {
                const rect = button.getBoundingClientRect();
                return { width: rect.width, height: rect.height };
            })
        );
    expect(mobileStatButtons).toHaveLength(4);
    expect(mobileStatButtons.every(({ width, height }) => width >= 160 && height === 40)).toBe(true);
    await expect(page.locator('.advanced-options')).not.toHaveAttribute('open');
    await page.getByRole('tab', { name: '임관 권유' }).focus();
    await expect(page.getByRole('tab', { name: '임관 권유' })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('join-layout-mobile.png'), fullPage: true });
});

test('shows the creation success dialog exactly once before navigating home', async ({ page }, testInfo) => {
    const state: FixtureState = { mapRequests: 0, generalRequests: 0 };
    await installFixture(page, state);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('join');

    await page.locator('.create-form').getByRole('button', { name: '장수 생성', exact: true }).click();

    const successDialog = page.getByRole('alertdialog', { name: '완료' });
    await expect(successDialog).toHaveCount(1);
    await expect(successDialog).toContainText('장수를 생성했습니다!');
    await expect(successDialog.getByRole('button', { name: '확인' })).toBeFocused();
    await expect(page).toHaveURL(/\/join(?:\?.*)?$/);
    expect(state.createRequests).toBe(1);

    const dialogGeometry = await successDialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            left: rect.left,
            right: window.innerWidth - rect.right,
            width: rect.width,
            documentWidth: document.documentElement.scrollWidth,
        };
    });
    expect(dialogGeometry.left).toBeGreaterThanOrEqual(12);
    expect(dialogGeometry.right).toBeGreaterThanOrEqual(12);
    expect(dialogGeometry.width).toBeLessThanOrEqual(366);
    expect(dialogGeometry.documentWidth).toBe(390);
    await page.screenshot({ path: testInfo.outputPath('join-create-success-dialog-mobile.png'), fullPage: true });

    await successDialog.getByRole('button', { name: '확인' }).click();
    await expect(successDialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${gameBasePath}/?$`));
    expect(state.createRequests).toBe(1);
});
