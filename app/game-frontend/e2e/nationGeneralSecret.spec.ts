import { expect, test, type Page, type Route } from '@playwright/test';
import { gameProfile, gameTrpcRoute } from './gameTestPaths.js';

const response = (data: unknown) => ({ result: { data } });
const operations = (route: Route) =>
    decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(',');
const commandTable = {
    general: [
        {
            category: '전체',
            values: [
                { key: '휴식', name: '휴식', reqArg: false, status: 'available', possible: true, inputFields: [] },
                { key: 'che_이동', name: '이동', reqArg: true, status: 'available', possible: true, inputFields: [] },
                { key: 'che_징병', name: '징병', reqArg: true, status: 'available', possible: true, inputFields: [] },
                { key: 'che_증여', name: '증여', reqArg: true, status: 'available', possible: true, inputFields: [] },
                { key: 'che_화계', name: '화계', reqArg: true, status: 'available', possible: true, inputFields: [] },
            ],
        },
    ],
    nation: [],
    inputOptions: {
        cities: [{ value: 1, label: '업 (위)' }],
        nations: [{ value: 1, label: '위' }],
        generals: [
            { value: 1, label: '테스트장수 (위 · 업)' },
            { value: 2, label: '다른장수 (위 · 업)' },
        ],
        crewTypes: [{ value: 1, label: '보병' }],
        armTypes: [],
        nationTypes: [],
        colors: [],
        items: {},
        recruitment: null,
    },
};
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
const npcColorStates = [0, 1, 2, 4, 5, 6] as const;
const npcColorGenerals = npcColorStates.map((npcState) => ({
    ...general,
    id: 100 + npcState,
    name: `색상장수${npcState}`,
    npcState,
}));
const npcColorSecretGenerals = npcColorStates.map((npcState) => ({
    id: 100 + npcState,
    name: `색상장수${npcState}`,
    npcState,
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
    turnTime: `2026-01-01T01:0${npcState}:00.000Z`,
    reservedCommands: [],
}));
const install = async (page: Page, secretAllowed = true, npcColorFixture = false) => {
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
                    generals: npcColorFixture ? npcColorGenerals : [general, otherGeneral],
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
                    generals: npcColorFixture
                        ? npcColorSecretGenerals
                        : [
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
                                  reservedCommands: [
                                      { action: 'che_이동', args: { destCityId: 1 } },
                                      { action: 'che_징병', args: { crewType: 1, amount: 300 } },
                                      { action: 'che_증여', args: { destGeneralId: 2, isGold: false, amount: 200 } },
                                      { action: 'che_화계', args: { destCityId: 1 } },
                                      { action: '휴식', args: {} },
                                  ],
                              },
                              {
                                  id: 2,
                                  name: '부유장수',
                                  npcState: 0,
                                  injury: 0,
                                  stats: { leadership: 60, strength: 50, intelligence: 40 },
                                  leadershipBonus: 0,
                                  experienceLevel: 8,
                                  troopId: 1,
                                  troopName: '제1부대',
                                  gold: 3000,
                                  rice: 1000,
                                  cityId: 2,
                                  cityName: '낙양',
                                  defenceTrain: 80,
                                  defenceTrainText: '◎',
                                  crewTypeId: 2,
                                  crew: 100,
                                  train: 80,
                                  atmos: 80,
                                  killTurn: 3,
                                  turnTime: '2026-01-01T02:02:00.000Z',
                                  reservedCommands: [],
                              },
                          ],
                });
            }
            if (operation === 'turns.getCommandTable') return response(commandTable);
            return { error: { message: `unhandled ${operation}`, data: { code: 'BAD_REQUEST' } } };
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
};

test('NPC general names use the complete Ref palette in secret and nation lists on desktop and mobile', async ({
    page,
}, testInfo) => {
    await install(page, true, true);
    const expectedColors = new Map<number, string>([
        [1, 'rgb(135, 206, 235)'],
        [2, 'rgb(0, 255, 255)'],
        [4, 'rgb(0, 191, 255)'],
        [5, 'rgb(0, 139, 139)'],
        [6, 'rgb(102, 205, 170)'],
    ]);

    for (const viewport of [
        { width: 1200, height: 900 },
        { width: 500, height: 900 },
    ]) {
        await page.setViewportSize(viewport);
        for (const path of ['nation/secret', 'nation/generals']) {
            await page.goto(path);
            const table = page.locator(path.endsWith('secret') ? '#secret-general-list' : '#nation-general-list');
            await expect(table).toBeVisible();
            for (const npcState of npcColorStates) {
                const name = table.locator(`[data-npc-state="${npcState}"] [data-general-name]`);
                await expect(name).toBeVisible();
                if (npcState === 0) {
                    expect(await name.evaluate((element) => (element as HTMLElement).style.color)).toBe('');
                } else {
                    await expect(name).toHaveCSS('color', expectedColors.get(npcState)!);
                }
            }
            await page.screenshot({
                path: testInfo.outputPath(`npc-colors-${path.replace('/', '-')}-${viewport.width}.png`),
                fullPage: true,
            });
        }
    }
});

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

test('nation generals top controls share fixed Lumen state geometry on desktop and mobile', async ({
    page,
}, testInfo) => {
    await install(page);
    const evidence: Record<string, unknown> = {};

    for (const viewport of [
        { width: 1200, height: 900 },
        { width: 500, height: 900 },
    ]) {
        await page.setViewportSize(viewport);
        await page.goto('nation/generals');
        await expect(page.locator('#nation-general-list')).toBeVisible();
        const controls = [
            page.getByRole('button', { name: '돌아가기' }),
            page.getByRole('button', { name: '갱신' }),
            page.getByRole('button', { name: '보기 모드⌄' }),
            page.getByRole('button', { name: '열 선택⌄' }),
        ];
        const viewportEvidence: Record<string, unknown> = {};

        for (const control of controls) {
            const label = (await control.textContent())?.trim() ?? 'unknown';
            await expect(control).toHaveClass(/legacy-button--fixed-height/u);
            const measure = () =>
                control.evaluate((element) => {
                    const rect = element.getBoundingClientRect();
                    const style = getComputedStyle(element);
                    return {
                        top: rect.top,
                        bottom: rect.bottom,
                        height: rect.height,
                        marginTop: style.marginTop,
                        borderBottomWidth: style.borderBottomWidth,
                        borderRadius: style.borderRadius,
                        backgroundColor: style.backgroundColor,
                        fontFamily: style.fontFamily,
                        fontSize: style.fontSize,
                    };
                });
            await page.mouse.move(viewport.width - 1, viewport.height - 1);
            const base = await measure();
            expect(base).toMatchObject({
                height: 32,
                marginTop: '0px',
                borderBottomWidth: '4px',
                borderRadius: '5.25px',
                fontSize: '14px',
            });
            expect(base.fontFamily).toContain('Pretendard');

            await control.hover();
            const hover = await measure();
            expect(hover).toMatchObject({ height: 31, marginTop: '1px', borderBottomWidth: '3px' });
            expect(hover.bottom).toBeCloseTo(base.bottom, 2);

            const box = await control.boundingBox();
            if (!box) throw new Error(`${label} control is not measurable`);
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            const active = await measure();
            expect(active).toMatchObject({ height: 30, marginTop: '2px', borderBottomWidth: '2px' });
            expect(active.bottom).toBeCloseTo(base.bottom, 2);
            await page.mouse.move(viewport.width - 1, viewport.height - 1);
            await page.mouse.up();
            viewportEvidence[label] = { default: base, hover, active };
        }
        evidence[`${viewport.width}x${viewport.height}`] = viewportEvidence;
        await page.screenshot({
            path: testInfo.outputPath(`nation-general-buttons-${viewport.width}.png`),
            fullPage: true,
        });
    }

    await testInfo.attach('nation-general-button-geometry', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
    });
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

test('both pages preserve the legacy 1000px overflow contract at 500px', async ({ page }, testInfo) => {
    await install(page);
    await page.setViewportSize({ width: 500, height: 900 });
    for (const path of ['nation/generals', 'nation/secret']) {
        await page.goto(path);
        await expect(
            page.locator(path.endsWith('secret') ? '#secret-general-list' : '#nation-general-list')
        ).toBeVisible();
        const fixedWidthElement = path.endsWith('secret')
            ? page.locator('.secret-page .title').first()
            : page.locator('.general-page');
        expect(await fixedWidthElement.evaluate((el) => el.getBoundingClientRect().width)).toBe(1000);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThanOrEqual(1000);
        if (path.endsWith('secret')) {
            await page.screenshot({ path: testInfo.outputPath('secret-command-brief-mobile-500.png'), fullPage: true });
        }
    }
});

test('secret office renders five Ref-style command briefs and the forbidden error flow', async ({ page }, testInfo) => {
    await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('nation/secret');
    await expect(page.locator('.summary')).toContainText('전체 금');
    const commandRows = page.locator('#secret-general-list .turns div');
    await expect(commandRows).toHaveCount(5);
    await expect(commandRows).toHaveText([
        '1 : 【업】으로 이동',
        '2 : 【보병】 300명 징병',
        '3 : 【다른장수】에게 쌀 200을 증여',
        '4 : 【업】에 화계실행',
        '5 : 휴식',
    ]);
    await expect(commandRows.nth(2)).toHaveAttribute('title', '【다른장수】에게 쌀 200을 증여');
    const geometry = await page
        .locator('#secret-general-list .turns')
        .first()
        .evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                width: rect.width,
                height: rect.height,
                fontSize: style.fontSize,
                textAlign: style.textAlign,
                horizontalOverflow: element.scrollWidth - element.clientWidth,
            };
        });
    expect(geometry.width).toBeGreaterThanOrEqual(190);
    expect(geometry.width).toBeLessThanOrEqual(230);
    expect(geometry.height).toBeGreaterThanOrEqual(60);
    expect(geometry).toMatchObject({ fontSize: '11px', textAlign: 'left', horizontalOverflow: 0 });
    const titleBox = await page.locator('.secret-page .title').first().boundingBox();
    const listBox = await page.locator('#secret-general-list').boundingBox();
    expect(titleBox?.width).toBe(1000);
    expect(listBox?.width).toBe(974);
    await testInfo.attach('secret-command-brief-geometry', {
        body: JSON.stringify(
            { viewport: { width: 1200, height: 900 }, titleBox, listBox, commandCell: geometry },
            null,
            2
        ),
        contentType: 'application/json',
    });
    await page.screenshot({ path: testInfo.outputPath('secret-command-brief-desktop-1200.png'), fullPage: true });

    await page.unroute(gameTrpcRoute);
    await install(page, false);
    await page.goto('nation/secret');
    await expect(page.getByRole('alert')).toContainText('권한이 부족합니다.');
    await expect(page.locator('#secret-general-list')).toHaveCount(0);
});

test('secret office applies the selected sort on submit and immediately from sortable headers', async ({ page }) => {
    await install(page);
    await page.goto('nation/secret');
    const rows = page.locator('#secret-general-list tbody tr[data-general-id]');
    await expect(rows.first()).toHaveAttribute('data-general-id', '1');

    await page.locator('#secret-list-sort').selectOption('1');
    await expect(rows.first()).toHaveAttribute('data-general-id', '1');
    await page.getByRole('button', { name: '정렬하기' }).click();
    await expect(rows.first()).toHaveAttribute('data-general-id', '2');
    await expect(page.locator('#secret-general-list th[aria-sort="descending"]')).toContainText('자 금');

    await page.getByRole('button', { name: '도시 기준 정렬' }).click();
    await expect(page.locator('#secret-list-sort')).toHaveValue('3');
    await expect(rows.first()).toHaveAttribute('data-general-id', '1');
    await expect(page.locator('#secret-list-sort')).toHaveCSS('color', 'rgb(247, 250, 248)');
    await expect(page.getByRole('button', { name: '정렬하기' })).toHaveCSS('border-bottom-width', '3px');
});
