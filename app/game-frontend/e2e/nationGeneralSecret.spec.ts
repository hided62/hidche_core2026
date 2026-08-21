import { expect, test, type Page, type Route } from '@playwright/test';
import { gameProfile, gameTrpcRoute } from './gameTestPaths.js';

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
    dedicationText: '30품관',
    bill: 600,
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
const otherGeneral = {
    ...general,
    id: 2,
    name: '다른장수',
    npcState: 1,
    stats: { leadership: 40, strength: 80, intelligence: 65 },
    experienceLevel: 12,
    dedicationLevel: 3,
    dedicationText: '28품관',
    bill: 1000,
    gold: 3000,
    rice: 500,
    personality: { key: '용장', name: '용장', info: '공격적인 성격' },
    specialDomestic: { key: '상재', name: '상재', info: '상업 특기' },
    specialWar: { key: '돌격', name: '돌격', info: '전투 특기' },
    belong: 4,
    refreshScoreTotal: 20,
};
const install = async (page: Page, secretAllowed = true) => {
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_general');
        localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    await page.route(gameTrpcRoute, async (route) => {
        const results = operations(route).map((operation) => {
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') return response({ myGeneral: { id: 1, name: '테스트장수' } });
            if (operation === 'join.getConfig') return response({});
            if (operation === 'nation.getGeneralList')
                return response({
                    nation: { id: 1, name: '위', color: '#008000', level: 3 },
                    viewer: { generalId: 1, permission: 0 },
                    generals: [general, otherGeneral],
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
    const computed = await page.locator('.general-page').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { x: rect.x, width: rect.width, fontSize: style.fontSize, fontFamily: style.fontFamily };
    });
    expect(computed).toMatchObject({ x: 100, width: 1000, fontSize: '14px' });
    expect(computed.fontFamily).toContain('Pretendard');
    expect(await page.locator('#nation-general-list').evaluate((el) => getComputedStyle(el).borderCollapse)).toBe(
        'separate'
    );
    expect((await page.locator('#nation-general-list').boundingBox())?.width).toBe(1000);
    expect((await page.locator('#nation-general-list tbody tr').first().boundingBox())?.height).toBe(68);
    await page.getByRole('button', { name: '보기 모드⌄' }).click();
    await page.getByRole('button', { name: '전투', exact: true }).click();
    await expect(page.locator('#nation-general-list')).toContainText('?');
});

test('nation generals restores Ref group, saved view, sort, and Korean search behavior', async ({ page }, testInfo) => {
    await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('nation/generals');
    const table = page.locator('#nation-general-list');
    await page.screenshot({ path: testInfo.outputPath('core-initial.png'), fullPage: true });

    const statGroupButton = page.getByRole('button', { name: '능력치 접기' });
    await expect(statGroupButton).toHaveAttribute('aria-expanded', 'true');
    expect(await statGroupButton.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    await statGroupButton.hover();
    expect(await statGroupButton.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(48, 54, 56)');
    await statGroupButton.focus();
    await expect(statGroupButton).toBeFocused();
    expect(await statGroupButton.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    await statGroupButton.click();
    await page.screenshot({ path: testInfo.outputPath('core-stat-collapsed.png'), fullPage: true });
    await expect(page.getByRole('button', { name: '능력치 펼치기' })).toHaveAttribute('aria-expanded', 'false');
    await expect(table.locator('thead')).toContainText('통|무|지');
    await expect(table.locator('tr[data-general-id="1"]')).toContainText('70|60|50');

    await page.getByRole('button', { name: '능력치 펼치기' }).click();
    await page.getByLabel('장수명 필터').fill('ㅌㅅㅌㅈㅅ');
    await expect(table.locator('tr[data-general-id="1"]')).toBeVisible();
    await expect(table.locator('tr[data-general-id="2"]')).toHaveCount(0);
    await page.getByLabel('장수명 필터').fill('');
    await page.getByLabel('통솔 필터').fill('70');
    await expect(table.locator('tr[data-general-id="1"]')).toBeVisible();
    await expect(table.locator('tr[data-general-id="2"]')).toHaveCount(0);
    await page.getByLabel('통솔 필터').fill('');

    await page.getByRole('button', { name: '통솔 정렬' }).click();
    await expect(table.locator('tbody tr[data-general-id]').first()).toHaveAttribute('data-general-id', '1');
    await page.getByRole('button', { name: '통솔 정렬' }).click();
    await expect(table.locator('tbody tr[data-general-id]').first()).toHaveAttribute('data-general-id', '2');

    await page.getByRole('button', { name: '능력치 접기' }).click();
    await page.getByRole('button', { name: '열 선택⌄' }).click();
    await page.getByLabel('쌀', { exact: true }).uncheck();
    await expect(page.getByRole('button', { name: '쌀 정렬' })).toHaveCount(0);
    await page.getByRole('button', { name: '보기 모드⌄' }).click();
    page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('prompt');
        await dialog.accept('내 보기');
    });
    await page.getByRole('button', { name: /보관하기/ }).click();
    await expect
        .poll(() =>
            page.evaluate(() => ({
                settings: localStorage.getItem('GeneralListDisplaySetting'),
                last: localStorage.getItem('LastUsedSettingsKey_pageNationGeneral'),
            }))
        )
        .toMatchObject({ settings: expect.stringContaining('내 보기'), last: '[false,"내 보기"]' });

    await page.reload();
    await expect(page.getByRole('button', { name: '능력치 펼치기' })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: '쌀 정렬' })).toHaveCount(0);
    await page.getByRole('button', { name: '보기 모드⌄' }).click();
    await expect(page.getByRole('button', { name: '내 보기', exact: true })).toBeVisible();
    page.once('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm');
        await dialog.accept();
    });
    await page.getByRole('button', { name: '내 보기 설정 삭제' }).click();
    await expect
        .poll(() => page.evaluate(() => localStorage.getItem('GeneralListDisplaySetting')))
        .not.toContain('내 보기');
});

test('nation generals filter buttons open Ref operator menus and apply compound conditions', async ({
    page,
}, testInfo) => {
    await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('nation/generals');
    const table = page.locator('#nation-general-list');

    const nameMenuButton = page.getByRole('button', { name: '장수명 상세 필터 열기' });
    await expect(nameMenuButton).toHaveAttribute('title', 'Open Filter Menu');
    await nameMenuButton.hover();
    expect(await nameMenuButton.evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer');
    await nameMenuButton.focus();
    await expect(nameMenuButton).toBeFocused();
    expect(await nameMenuButton.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
    await nameMenuButton.click();

    const namePopup = page.getByRole('dialog', { name: '장수명 상세 필터' });
    await expect(namePopup).toBeVisible();
    expect((await namePopup.boundingBox())?.width).toBe(190);
    expect(await namePopup.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(45, 52, 54)');
    const nameOperator = page.getByLabel('장수명 첫 번째 필터 연산자');
    expect(await nameOperator.locator('option').allTextContents()).toEqual([
        'Contains',
        'Not contains',
        'Equals',
        'Not equal',
        'Starts with',
        'Ends with',
        'Blank',
        'Not blank',
    ]);
    await nameOperator.selectOption('notContains');
    await page.getByLabel('장수명 첫 번째 필터 값').fill('테스트');
    await expect(page.getByRole('searchbox', { name: '장수명 필터', exact: true })).toHaveValue('테스트');
    await expect(table.locator('tr[data-general-id="1"]')).toHaveCount(0);
    await expect(table.locator('tr[data-general-id="2"]')).toBeVisible();

    await nameOperator.selectOption('contains');
    await page.getByLabel('장수명 첫 번째 필터 값').fill('장수');
    await page.getByLabel('장수명 두 번째 필터 연산자').selectOption('notContains');
    await page.getByLabel('장수명 두 번째 필터 값').fill('테스트');
    await expect(table.locator('tr[data-general-id="1"]')).toHaveCount(0);
    await expect(table.locator('tr[data-general-id="2"]')).toBeVisible();
    await namePopup.getByLabel('OR').check();
    await expect(table.locator('tr[data-general-id="1"]')).toBeVisible();
    await expect(table.locator('tr[data-general-id="2"]')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('core-text-filter-menu.png'), fullPage: true });

    await page.getByLabel('장수명 두 번째 필터 값').fill('');
    await page.getByLabel('장수명 첫 번째 필터 값').fill('');
    await page.getByRole('button', { name: '통솔 상세 필터 열기' }).click();
    const numberPopup = page.getByRole('dialog', { name: '통솔 상세 필터' });
    const numberOperator = page.getByLabel('통솔 첫 번째 필터 연산자');
    expect(await numberOperator.locator('option').allTextContents()).toEqual([
        'Equals',
        'Not equal',
        'Less than',
        'Less than or equals',
        'Greater than',
        'Greater than or equals',
        'In range',
        'Blank',
        'Not blank',
    ]);
    await numberOperator.selectOption('inRange');
    await page.getByLabel('통솔 첫 번째 필터 값').fill('45');
    await page.getByLabel('통솔 첫 번째 필터 끝값').fill('75');
    await expect(table.locator('tr[data-general-id="1"]')).toBeVisible();
    await expect(table.locator('tr[data-general-id="2"]')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('core-number-filter-menu.png'), fullPage: true });
    await numberOperator.selectOption('blank');
    await expect(table.locator('tr[data-general-id]')).toHaveCount(0);
    await expect(numberPopup.getByPlaceholder('Filter...')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(numberPopup).toHaveCount(0);

    await page.setViewportSize({ width: 500, height: 900 });
    expect(await page.locator('.general-page').evaluate((element) => element.getBoundingClientRect().width)).toBe(1000);
    const generalSearch = page.getByLabel('장수명 필터');
    await expect(generalSearch).toHaveCSS('touch-action', 'manipulation');
    const viewportContract = await page.evaluate(() => ({
        content: document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content ?? '',
        scale: window.visualViewport?.scale ?? 1,
    }));
    expect(viewportContract.content).not.toMatch(/(?:user-scalable|minimum-scale|maximum-scale)/u);
    await generalSearch.focus();
    await expect(generalSearch).toBeFocused();
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(viewportContract.scale);
    await nameMenuButton.click();
    await expect(namePopup).toBeVisible();
    await expect(page.getByLabel('장수명 첫 번째 필터 값')).toHaveCSS('touch-action', 'manipulation');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThanOrEqual(1000);
    await page.screenshot({ path: testInfo.outputPath('core-mobile-filter-menu.png'), fullPage: true });
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

    await page.unroute(gameTrpcRoute);
    await install(page, false);
    await page.goto('nation/secret');
    await expect(page.getByRole('alert')).toContainText('권한이 부족합니다.');
    await expect(page.locator('#secret-general-list')).toHaveCount(0);
});
