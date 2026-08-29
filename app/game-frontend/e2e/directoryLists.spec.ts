import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

const response = (data: unknown) => ({ result: { data } });
const gameBasePath = (process.env.PLAYWRIGHT_GAME_BASE_PATH ?? 'che').replace(/^\/+|\/+$/gu, '');
const gameProfile = process.env.PLAYWRIGHT_GAME_PROFILE ?? `${gameBasePath}:default`;
const operationNames = (route: Route) =>
    decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(',');

const nationDirectory = [
    {
        id: 2,
        name: '촉',
        color: '#800000',
        level: 2,
        type: { key: 'che_법가', name: '법가' },
        power: 2000,
        capitalCityId: 2,
        generalCount: 1,
        totalCrew: 1_200,
        cityCount: 1,
        officers: Array.from({ length: 8 }, (_, index) => ({
            officerLevel: 12 - index,
            general: index === 0 ? { id: 20, name: '유비', npcState: 0, cityId: 2 } : null,
        })),
        ambassadorNames: ['유비'],
        auditorCount: 0,
        cities: [{ id: 2, name: '성도', capital: true }],
        generals: [{ id: 20, name: '유비', npcState: 0 }],
    },
    {
        id: 1,
        name: '위',
        color: '#008000',
        level: 3,
        type: { key: 'che_명가', name: '명가' },
        power: 1000,
        capitalCityId: 1,
        generalCount: 2,
        totalCrew: 2_500,
        cityCount: 1,
        officers: Array.from({ length: 8 }, (_, index) => ({
            officerLevel: 12 - index,
            general: index === 0 ? { id: 10, name: '조조', npcState: 0, cityId: 1 } : null,
        })),
        ambassadorNames: ['조조', '순욱'],
        auditorCount: 1,
        cities: [{ id: 1, name: '허창', capital: true }],
        generals: [
            { id: 10, name: '조조', npcState: 0 },
            { id: 11, name: '순욱', npcState: 1 },
        ],
    },
    {
        id: 0,
        name: '재 야',
        color: '#000000',
        level: 0,
        type: { key: 'None', name: '-' },
        power: 0,
        capitalCityId: 0,
        generalCount: 1,
        totalCrew: 0,
        cityCount: 1,
        officers: Array.from({ length: 8 }, (_, index) => ({ officerLevel: 12 - index, general: null })),
        ambassadorNames: [],
        auditorCount: 0,
        cities: [{ id: 3, name: '낙양', capital: false }],
        generals: [{ id: 30, name: '재야장', npcState: 2 }],
    },
];

const generals = [
    {
        id: 10,
        name: '조조',
        ownerName: null,
        picture: '계정 icon.png',
        imageServer: 1,
        npcState: 0,
        age: 35,
        nationId: 1,
        nationName: '위',
        nationLevel: 3,
        personality: { key: 'che_대담', name: '대담', info: '대담한 성격' },
        specialDomestic: { key: 'che_상재', name: '상재', info: '상업 특기' },
        specialWar: { key: 'che_귀모', name: '귀모', info: '전투 특기' },
        injury: 10,
        leadership: 90,
        leadershipBonus: 6,
        strength: 70,
        intelligence: 95,
        experience: 10_000,
        experienceLevel: 31,
        honorText: '약간',
        dedication: 900,
        dedicationText: '27품관',
        officerLevel: 12,
        killturn: 3,
        refreshScoreTotal: 120,
        refreshText: '가끔',
    },
    {
        id: 20,
        name: '유비',
        ownerName: '통일유저',
        picture: '장수/유비 1.png',
        imageServer: 0,
        npcState: 0,
        age: 34,
        nationId: 2,
        nationName: '촉',
        nationLevel: 2,
        personality: { key: 'che_인덕', name: '인덕', info: '인덕 있는 성격' },
        specialDomestic: { key: 'None', name: '-', info: '' },
        specialWar: { key: 'None', name: '-', info: '' },
        injury: 0,
        leadership: 80,
        leadershipBonus: 4,
        strength: 75,
        intelligence: 70,
        experience: 20_000,
        experienceLevel: 44,
        honorText: '지역적',
        dedication: 800,
        dedicationText: '27품관',
        officerLevel: 12,
        killturn: 1,
        refreshScoreTotal: 210,
        refreshText: '보통',
    },
];

const pyaScaleGenerals = Array.from({ length: 845 }, (_, index) => {
    const source = generals[index % generals.length]!;
    return {
        ...source,
        id: index + 1,
        name: `성능장수${index + 1}`,
        ownerName: null,
        picture: `performance/general-${index + 1}.png`,
        imageServer: 0,
    };
});

const npcGenerals = [
    {
        id: 10,
        name: '낮은장수',
        ownerName: '',
        npcState: 0,
        level: 4,
        nationId: 2,
        nationName: '촉',
        personality: null,
        specialDomestic: null,
        specialWar: null,
        statTotal: 120,
        leadership: 30,
        strength: 50,
        intelligence: 40,
        experience: 100,
        dedication: 50,
    },
    {
        id: 20,
        name: '높은장수',
        ownerName: '빙의자',
        npcState: 1,
        level: 8,
        nationId: 1,
        nationName: '위',
        personality: null,
        specialDomestic: null,
        specialWar: null,
        statTotal: 240,
        leadership: 90,
        strength: 70,
        intelligence: 80,
        experience: 500,
        dedication: 300,
    },
];

const parseSort = (route: Route): number => {
    try {
        const request = route.request();
        const queryInput = new URL(request.url()).searchParams.get('input');
        const input = (request.postData() ? request.postDataJSON() : queryInput ? JSON.parse(queryInput) : {}) as {
            0?: { json?: { sort?: number }; sort?: number };
            json?: { sort?: number };
        };
        return input[0]?.json?.sort ?? input[0]?.sort ?? input.json?.sort ?? 9;
    } catch {
        return 9;
    }
};

const install = async (
    page: Page,
    mode: 'general' | 'no-general' | 'error-after-load' = 'general',
    accessPages: string[] = [],
    requestedOperations: string[] = [],
    directoryRows = generals,
    nationDirectoryRows = nationDirectory
) => {
    let generalDirectoryCalls = 0;
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_directory');
        localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    await page.route('**/image/general/**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#777"/></svg>',
        })
    );
    await page.route('**/gateway/api/user-icons/**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#777"/></svg>',
        })
    );
    await page.route('**/image/icons/**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#777"/></svg>',
        })
    );
    await page.route('https://sam-image.hided.net/icons/**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#777"/></svg>',
        })
    );
    await page.route('**/image/game/**', (route) =>
        route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from('') })
    );
    await page.route(`**/${gameBasePath}/api/trpc/**`, async (route) => {
        const requestBody = route.request().postDataJSON() as
            Record<string, { json?: { page?: unknown }; page?: unknown }> | undefined;
        const operations = operationNames(route);
        requestedOperations.push(...operations);
        const results = operations.map((operation, operationIndex) => {
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') {
                return response({ myGeneral: mode === 'no-general' ? null : { id: 1, name: '조회자' } });
            }
            if (operation === 'join.getConfig') return response({});
            if (operation === 'world.getNationDirectory') return response(nationDirectoryRows);
            if (operation === 'public.recordAccess') {
                const payload = requestBody?.[String(operationIndex)];
                const pageName = payload?.json?.page ?? payload?.page;
                if (typeof pageName === 'string') accessPages.push(pageName);
                return response({ recorded: true });
            }
            if (operation === 'world.getGeneralDirectory') {
                generalDirectoryCalls += 1;
                if (mode === 'error-after-load' && generalDirectoryCalls > 1) {
                    return {
                        error: {
                            message: '권한 확인 실패',
                            code: -32000,
                            data: {
                                code: 'FORBIDDEN',
                                httpStatus: 403,
                                path: 'world.getGeneralDirectory',
                            },
                        },
                    };
                }
                const sort = parseSort(route);
                const rows =
                    sort === 8
                        ? [...directoryRows].sort((left, right) => left.killturn - right.killturn)
                        : directoryRows;
                return response({ sort, generals: rows });
            }
            if (operation === 'public.getNpcList') {
                const sort = parseSort(route);
                const rows = [...npcGenerals].sort((left, right) => {
                    if (sort === 2) return left.nationId - right.nationId || left.id - right.id;
                    if (sort === 3) return right.statTotal - left.statTotal || left.id - right.id;
                    if (sort === 4) return right.leadership - left.leadership || left.id - right.id;
                    if (sort === 5) return right.strength - left.strength || left.id - right.id;
                    if (sort === 6) return right.intelligence - left.intelligence || left.id - right.id;
                    if (sort === 7) return right.experience - left.experience || left.id - right.id;
                    if (sort === 8) return right.dedication - left.dedication || left.id - right.id;
                    return left.name.localeCompare(right.name) || left.id - right.id;
                });
                return response({ sort, generals: rows, tokenKeepCounts: {} });
            }
            return { error: { message: `unhandled ${operation}`, data: { code: 'BAD_REQUEST' } } };
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
};

const installAccessBoundary = async (page: Page, accessPages: string[]) => {
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_access_boundary');
        localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    await page.route('**/image/**', (route) => route.abort('failed'));
    await page.route(`**/${gameBasePath}/api/trpc/**`, async (route) => {
        const requestBody = route.request().postDataJSON() as
            Record<string, { json?: { page?: unknown }; page?: unknown }> | undefined;
        const results = operationNames(route).map((operation, operationIndex) => {
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') return response({ myGeneral: { id: 1, name: '조회자' } });
            if (operation === 'public.recordAccess') {
                const payload = requestBody?.[String(operationIndex)];
                const pageName = payload?.json?.page ?? payload?.page;
                if (typeof pageName === 'string') accessPages.push(pageName);
                return response({ recorded: true });
            }
            return response({});
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
};

test('a level-zero nation shows the ruler current city even without territory there', async ({ page }) => {
    const roamingNation = {
        ...nationDirectory[0]!,
        id: 3,
        name: '방랑군',
        level: 0,
        capitalCityId: 0,
        cityCount: 0,
        officers: Array.from({ length: 8 }, (_, index) => ({
            officerLevel: 12 - index,
            general: index === 0 ? { id: 40, name: '방랑군주', npcState: 0, cityId: 2 } : null,
        })),
        rulerCityName: '성도',
        cities: [],
        generals: [{ id: 40, name: '방랑군주', npcState: 0 }],
    };
    await install(page, 'general', [], [], generals, [roamingNation]);

    await page.goto('nation-list');

    const table = page.locator('[data-nation-id="3"]');
    await expect(table).toContainText('현재 위치 : 성도');
    await expect(table.locator('.roaming-city')).toHaveCSS('color', 'rgb(255, 255, 0)');
});

test('PYA-scale general directory mounts only the active responsive layout and defers portraits', async (
    { page },
    testInfo
) => {
    const requestedPortraits = new Set<string>();
    page.on('request', (request) => {
        if (request.url().includes('/performance/general-')) {
            requestedPortraits.add(request.url());
        }
    });
    await page.setViewportSize({ width: 1200, height: 900 });
    await install(page, 'general', [], [], pyaScaleGenerals);
    await page.goto('general-list');

    await expect(page.locator('.general-table tbody tr[data-general-id]')).toHaveCount(845);
    await expect(page.locator('.general-card-list [data-general-card-id]')).toHaveCount(0);
    await expect(page.locator('.general-icon')).toHaveCount(845);
    await expect(page.locator('.general-icon').first()).toHaveAttribute('loading', 'lazy');
    await expect(page.locator('.general-icon').first()).toHaveAttribute('decoding', 'async');
    await page.waitForTimeout(250);
    expect(requestedPortraits.size).toBeLessThan(100);
    const desktopMetrics = await page.evaluate(() => ({
        domNodes: document.querySelectorAll('*').length,
        documentHeight: document.documentElement.scrollHeight,
    }));
    await writeFile(
        testInfo.outputPath('pya-scale-desktop-metrics.json'),
        `${JSON.stringify({ ...desktopMetrics, requestedPortraits: requestedPortraits.size }, null, 2)}\n`
    );
    await page.screenshot({ path: testInfo.outputPath('pya-scale-desktop.png') });

    await page.setViewportSize({ width: 500, height: 844 });
    await expect(page.locator('.general-table')).toHaveCount(0);
    await expect(page.locator('.general-card-list [data-general-card-id]')).toHaveCount(845);
    await expect(page.locator('.general-icon')).toHaveCount(845);
    await page.screenshot({ path: testInfo.outputPath('pya-scale-mobile.png') });

    await page.setViewportSize({ width: 1200, height: 900 });
    await expect(page.locator('.general-table tbody tr[data-general-id]')).toHaveCount(845);
    await expect(page.locator('.general-card-list')).toHaveCount(0);
});

test('nation and general directories preserve the fixed legacy Chromium geometry', async ({ page }) => {
    const accessPages: string[] = [];
    await install(page, 'general', accessPages);
    await page.setViewportSize({ width: 1200, height: 900 });

    const measurements: Record<string, unknown> = {};
    for (const path of ['nation-list', 'general-list']) {
        await page.goto(path);
        const root = page.locator('.directory-page');
        await expect(root).toBeVisible();
        const geometry = await root.evaluate((element, currentPath) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const tableStyle = getComputedStyle(element.querySelector('table')!);
            const cellStyle = getComputedStyle(element.querySelector('td')!);
            const titleRect = element.querySelector('.title-table')!.getBoundingClientRect();
            const contentTable =
                currentPath === 'nation-list'
                    ? element.querySelector('.nation-table')!
                    : element.querySelector('.general-table')!;
            const contentRect = contentTable.getBoundingClientRect();
            const contentFirstRow = contentTable.querySelector('tr')!.getBoundingClientRect();
            return {
                x: rect.x,
                width: rect.width,
                fontSize: style.fontSize,
                lineHeight: style.lineHeight,
                fontFamily: style.fontFamily,
                borderCollapse: tableStyle.borderCollapse,
                cellBorderWidth: cellStyle.borderTopWidth,
                cellPadding: cellStyle.padding,
                bodyBackgroundColor: getComputedStyle(document.body).backgroundColor,
                title: { x: titleRect.x, y: titleRect.y, width: titleRect.width, height: titleRect.height },
                content: {
                    x: contentRect.x,
                    y: contentRect.y,
                    width: contentRect.width,
                    firstRowHeight: contentFirstRow.height,
                },
            };
        }, path);
        measurements[path] = geometry;
        expect(geometry).toMatchObject({
            x: 100,
            width: 1000,
            fontSize: '14px',
            lineHeight: '18.2px',
            borderCollapse: 'collapse',
            cellBorderWidth: '1px',
            bodyBackgroundColor: 'rgb(0, 0, 0)',
        });
        expect(geometry.fontFamily).toContain('Pretendard');

        if (path === 'nation-list') {
            expect(geometry.title).toEqual({ x: 100, y: 0, width: 1000, height: 55.6875 });
            expect(geometry.content).toEqual({
                x: 100,
                y: 55.6875,
                width: 1000,
                firstRowHeight: 19.1875,
            });
            expect(
                await page
                    .locator('.nation-table .label-cell')
                    .first()
                    .evaluate((element) => element.getBoundingClientRect().width)
            ).toBe(79.921875);
        } else {
            expect(geometry.title).toEqual({ x: 100, y: 0, width: 1000, height: 80.875 });
            expect(geometry.content).toEqual({
                x: 100,
                y: 80.875,
                width: 1000,
                firstRowHeight: 19.1875,
            });
            expect(
                await page
                    .locator('.general-table tbody tr[data-general-id]')
                    .first()
                    .evaluate((element) => element.getBoundingClientRect().height)
            ).toBe(65);
        }
    }
    await expect.poll(() => accessPages).toContain('nation-list');
    expect(accessPages).not.toContain('general-list');

    const header = page.locator('.general-table thead th').first();
    expect(await header.evaluate((element) => getComputedStyle(element).backgroundImage)).toContain('back_green.jpg');
    const icon = page.locator('.general-icon').first();
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute('src', 'https://sam-image.hided.net/icons/%EA%B3%84%EC%A0%95%20icon.png');
    expect(
        await icon.evaluate((element) => {
            const image = element as HTMLImageElement;
            const rect = image.getBoundingClientRect();
            return {
                width: rect.width,
                height: rect.height,
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
                objectFit: getComputedStyle(image).objectFit,
            };
        })
    ).toEqual({ width: 64, height: 64, naturalWidth: 64, naturalHeight: 64, objectFit: 'fill' });
    const nestedLegacyIcon = page.locator('.general-icon').nth(1);
    await expect(nestedLegacyIcon).toHaveAttribute(
        'src',
        'https://sam-image.hided.net/icons/%EC%9E%A5%EC%88%98/%EC%9C%A0%EB%B9%84%201.png'
    );
    await expect
        .poll(() => nestedLegacyIcon.evaluate((element) => (element as HTMLImageElement).naturalWidth))
        .toBe(64);

    const artifactRoot = process.env.DIRECTORY_PARITY_ARTIFACT_DIR;
    if (artifactRoot) {
        const output = resolve(artifactRoot);
        await mkdir(output, { recursive: true });
        await writeFile(resolve(output, 'computed-dom.json'), `${JSON.stringify(measurements, null, 2)}\n`);
        await page.screenshot({ path: resolve(output, 'general-directory.png'), fullPage: true });
        await page.goto('nation-list');
        await page.screenshot({ path: resolve(output, 'nation-directory.png'), fullPage: true });
    }
});

test('general directory sorts the loaded rows locally in a stable three-state cycle', async ({ page }) => {
    const requestedOperations: string[] = [];
    await install(page, 'general', [], requestedOperations);
    await page.goto('general-list');
    await expect(page.locator('tbody tr[data-general-id]')).toHaveCount(2);
    await page.selectOption('#viewType', '8');
    await page.getByRole('button', { name: '정렬하기' }).click();
    await expect(page.locator('tbody tr[data-general-id]').first()).toHaveAttribute('data-general-id', '10');
    await page.getByRole('button', { name: '정렬하기' }).click();
    await expect(page.locator('tbody tr[data-general-id]').first()).toHaveAttribute('data-general-id', '20');
    await page.getByRole('button', { name: '정렬하기' }).click();
    await expect(page.locator('tbody tr[data-general-id]').first()).toHaveAttribute('data-general-id', '10');
    expect(requestedOperations.filter((operation) => operation === 'world.getGeneralDirectory')).toHaveLength(1);

    await expect(page.locator('tbody tr[data-general-id="10"] .wounded').first()).toHaveText('81');
    await expect(page.locator('tbody tr[data-general-id="10"] .leadership-bonus')).toHaveText('+6');

    await page.locator('#viewType').focus();
    expect(await page.locator('#viewType').evaluate((element) => document.activeElement === element)).toBe(true);
});

test('directory sort controls stay legible in dark mode and sortable headers apply the matching option', async ({
    page,
}, testInfo) => {
    await install(page);
    await page.goto('general-list');

    const select = page.locator('#viewType');
    const submit = page.getByRole('button', { name: '정렬하기' });
    const colors = await select.evaluate((element) => {
        const selectStyle = getComputedStyle(element);
        const optionStyle = getComputedStyle(element.querySelector('option')!);
        return {
            selectBackground: selectStyle.backgroundColor,
            selectColor: selectStyle.color,
            optionBackground: optionStyle.backgroundColor,
            optionColor: optionStyle.color,
        };
    });
    expect(colors).toEqual({
        selectBackground: 'rgb(24, 35, 29)',
        selectColor: 'rgb(247, 250, 248)',
        optionBackground: 'rgb(24, 35, 29)',
        optionColor: 'rgb(247, 250, 248)',
    });
    const defaultButton = await submit.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            background: style.backgroundColor,
            color: style.color,
            borderBottomWidth: style.borderBottomWidth,
            cursor: style.cursor,
        };
    });
    expect(defaultButton).toEqual({
        background: 'rgb(55, 90, 127)',
        color: 'rgb(255, 255, 255)',
        borderBottomWidth: '3px',
        cursor: 'pointer',
    });
    await submit.hover();
    await page.mouse.down();
    expect(await submit.evaluate((element) => getComputedStyle(element).borderBottomWidth)).toBe('1px');
    await page.mouse.up();

    await page.getByRole('button', { name: /^삭턴 내림차순/u }).click();
    await expect(select).toHaveValue('8');
    await expect(page.locator('th[aria-sort="descending"]')).toContainText('삭턴');
    await expect(page.locator('tbody tr[data-general-id]').first()).toHaveAttribute('data-general-id', '10');
    await page.screenshot({ path: testInfo.outputPath('directory-sort-controls-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 500, height: 844 });
    await expect(select).toHaveCSS('background-color', 'rgb(24, 35, 29)');
    await expect(submit).toHaveCSS('border-bottom-width', '3px');
    await page.screenshot({ path: testInfo.outputPath('directory-sort-controls-mobile.png'), fullPage: true });
});

test('name and mixed-direction stable sorting reuse one response until explicit refresh', async ({ page }) => {
    const requestedOperations: string[] = [];
    await install(page, 'general', [], requestedOperations);
    await page.goto('general-list');

    const rows = page.locator('tbody tr[data-general-id]');
    await page.getByRole('button', { name: /^이름 내림차순/u }).click();
    await expect(rows.first()).toHaveAttribute('data-general-id', '10');
    await page.getByRole('button', { name: /^이름 오름차순/u }).click();
    await expect(rows.first()).toHaveAttribute('data-general-id', '20');
    await page.getByRole('button', { name: /^이름 정렬 해제/u }).click();
    await expect(rows.first()).toHaveAttribute('data-general-id', '10');

    await page.getByRole('button', { name: /^통솔 내림차순/u }).click();
    await page.getByRole('button', { name: /^무력 내림차순/u }).click();
    await expect(rows.first()).toHaveAttribute('data-general-id', '20');
    await expect(
        page.getByRole('columnheader').filter({ hasText: '통솔' }).locator('.legacy-sort-indicator')
    ).toHaveText('▼2');
    await page.getByRole('button', { name: /^무력 오름차순/u }).click();
    await expect(rows.first()).toHaveAttribute('data-general-id', '10');
    expect(requestedOperations.filter((operation) => operation === 'world.getGeneralDirectory')).toHaveLength(1);

    await page.getByRole('button', { name: '갱 신' }).click();
    await expect
        .poll(() => requestedOperations.filter((operation) => operation === 'world.getGeneralDirectory').length)
        .toBe(2);
    await expect(rows.first()).toHaveAttribute('data-general-id', '10');
});

test('trait and injury explanations appear on pointer hover and keyboard focus', async ({ page }, testInfo) => {
    await install(page);
    await page.goto('general-list');

    const personality = page.locator('[data-directory-tooltip="personality-10"]');
    await personality.hover();
    await expect(personality.getByRole('tooltip')).toContainText('성격 · 대담');
    await expect(personality.getByRole('tooltip')).toContainText('대담한 성격');

    const domestic = page.locator('[data-directory-tooltip="special-domestic-10"]');
    await domestic.hover();
    await expect(domestic.getByRole('tooltip')).toContainText('내정 특기 · 상재');
    await expect(domestic.getByRole('tooltip')).toContainText('상업 특기');

    const war = page.locator('[data-directory-tooltip="special-war-10"]');
    await war.focus();
    await expect(war.getByRole('tooltip')).toContainText('전투 특기 · 귀모');
    await expect(war.getByRole('tooltip')).toContainText('전투 특기');

    const injury = page.locator('[data-directory-tooltip="injury-leadership-10"]');
    await injury.hover();
    await expect(injury.getByRole('tooltip')).toContainText('부상 10%');
    await expect(injury.getByRole('tooltip')).toContainText('원래 통솔 90 → 적용 81');
    const tooltipGeometry = await injury.getByRole('tooltip').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            left: rect.left,
            right: window.innerWidth - rect.right,
            display: style.display,
            background: style.backgroundColor,
            color: style.color,
            fontSize: style.fontSize,
        };
    });
    expect(tooltipGeometry.left).toBeGreaterThanOrEqual(8);
    expect(tooltipGeometry.right).toBeGreaterThanOrEqual(8);
    expect(tooltipGeometry).toMatchObject({
        display: 'block',
        background: 'rgb(16, 16, 16)',
        color: 'rgb(245, 245, 245)',
        fontSize: '12.5px',
    });
    await page.screenshot({ path: testInfo.outputPath('directory-trait-injury-tooltips.png'), fullPage: true });
});

test('npc directory reuses the dark sort controls and sorts from a table header', async ({ page }, testInfo) => {
    await install(page);
    await page.goto('npc-list');
    await expect(page.locator('.npc-table tbody tr[data-general-id]')).toHaveCount(2);
    await page.getByRole('button', { name: '통솔 기준 정렬' }).click();
    await expect(page.locator('#npc-list-sort')).toHaveValue('4');
    await expect(page.locator('.npc-table th[aria-sort="descending"]')).toContainText('통솔');
    await expect(page.locator('.npc-table tbody tr[data-general-id]').first()).toHaveAttribute('data-general-id', '20');
    await expect(page.locator('#npc-list-sort')).toHaveCSS('background-color', 'rgb(24, 35, 29)');
    await expect(page.getByRole('button', { name: '정렬하기' })).toHaveCSS('background-color', 'rgb(55, 90, 127)');
    await page.screenshot({ path: testInfo.outputPath('npc-sort-controls-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 500, height: 844 });
    await expect(page.locator('#npc-list-sort')).toHaveCSS('color', 'rgb(247, 250, 248)');
    await page.screenshot({ path: testInfo.outputPath('npc-sort-controls-mobile.png'), fullPage: true });
});

test('nation directory reuses only the public general-directory row on hover and keyboard focus', async ({ page }) => {
    const requestedOperations: string[] = [];
    await install(page, 'general', [], requestedOperations);

    const artifactRoot = process.env.DIRECTORY_PARITY_ARTIFACT_DIR;
    for (const viewport of [
        { name: 'desktop', width: 1200, height: 900 },
        { name: 'mobile', width: 500, height: 844 },
    ] as const) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto('nation-list');
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('button', { name: '장수 일람 연동' })).toHaveCount(0);
        await expect(page.locator('[data-general-preview-trigger]')).toHaveCount(4);
        await expect(page.locator('[data-nation-id="1"]')).toContainText('총 병사');
        await expect(page.locator('[data-nation-id="1"]')).toContainText('2,500');
        expect(requestedOperations.filter((operation) => operation === 'world.getGeneralDirectory')).toHaveLength(
            viewport.name === 'desktop' ? 0 : 1
        );

        const documentHeightBefore = await page.evaluate(() => document.documentElement.scrollHeight);
        const firstTrigger = page.locator('[data-general-preview-trigger="10"]');
        await firstTrigger.hover();

        const preview = page.locator('#nation-general-preview');
        await expect(preview).toBeVisible();
        await expect(preview.locator('[data-general-card-id]')).toHaveCount(1);
        await expect(preview.locator('[data-general-card-id="10"]')).toContainText('조조');
        await expect(preview.locator('[data-general-card-id="10"]')).toContainText('대담');
        await expect(preview.locator('[data-directory-tooltip="card-special-domestic-10"]')).toContainText('상재');
        await expect(preview.locator('[data-directory-tooltip="card-special-war-10"]')).toContainText('귀모');
        await expect(preview.locator('[data-directory-tooltip="card-special-domestic-10"]')).toHaveCSS(
            'text-decoration-line',
            'none'
        );
        await expect(preview).not.toContainText('user-');
        await expect(preview).not.toContainText('secret');

        const previewGeometry = await preview.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const card = element.querySelector('[data-general-card-id]')!.getBoundingClientRect();
            const trigger = document.querySelector('[data-general-preview-trigger="10"]')!.getBoundingClientRect();
            const verticalGap = rect.bottom <= trigger.top ? trigger.top - rect.bottom : rect.top - trigger.bottom;
            return {
                x: rect.x,
                right: window.innerWidth - rect.right,
                width: rect.width,
                verticalGap,
                position: style.position,
                cardHeight: card.height,
                documentWidth: document.documentElement.scrollWidth,
                documentHeight: document.documentElement.scrollHeight,
            };
        });
        expect(previewGeometry.position).toBe('fixed');
        expect(previewGeometry.width).toBe(viewport.name === 'desktop' ? 500 : 484);
        expect(previewGeometry.x).toBeGreaterThanOrEqual(8);
        expect(previewGeometry.right).toBeGreaterThanOrEqual(8);
        expect(previewGeometry.verticalGap).toBe(8);
        expect(previewGeometry.cardHeight).toBeGreaterThan(100);
        expect(previewGeometry.documentWidth).toBe(viewport.width);
        expect(previewGeometry.documentHeight).toBe(documentHeightBefore);

        await page.locator('.nation-title').first().hover();
        await expect(preview).toHaveCount(0);

        const foreignTrigger = page.locator('[data-general-preview-trigger="20"]');
        await foreignTrigger.focus();
        await expect(preview.locator('[data-general-card-id="20"]')).toContainText('유비');
        expect(await foreignTrigger.getAttribute('aria-expanded')).toBe('true');
        expect(await foreignTrigger.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('dashed');

        await page.getByRole('button', { name: '창 닫기' }).first().focus();
        await expect(preview).toHaveCount(0);

        if (artifactRoot) {
            const output = resolve(artifactRoot);
            await mkdir(output, { recursive: true });
            await firstTrigger.hover();
            await expect(preview).toBeVisible();
            await page.screenshot({
                path: resolve(output, `nation-directory-hover-${viewport.name}.png`),
                fullPage: true,
            });
        }
    }

    expect(requestedOperations.filter((operation) => operation === 'world.getGeneralDirectory')).toHaveLength(2);
    expect(requestedOperations).not.toContain('nation.getSecretGeneralList');
    expect(requestedOperations).not.toContain('nation.getPersonnelInfo');
    expect(requestedOperations).not.toContain('general.me');
});

test('nation and general directories rearrange for mobile and keep the tapped preview near its trigger', async ({
    browser,
}) => {
    const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        screen: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
    });
    const page = await context.newPage();
    const requestedOperations: string[] = [];
    const mobileMeasurements: Record<string, unknown> = {};

    try {
        await install(page, 'general', [], requestedOperations);
        await page.goto('nation-list');
        await page.waitForLoadState('networkidle');

        const nationMetrics = await page.locator('.directory-page').evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return {
                x: rect.x,
                width: rect.width,
                innerWidth: window.innerWidth,
                scrollWidth: document.documentElement.scrollWidth,
            };
        });
        expect(nationMetrics.x).toBe(0);
        expect(nationMetrics.width).toBe(500);
        expect(nationMetrics.scrollWidth).toBeLessThanOrEqual(nationMetrics.innerWidth);
        mobileMeasurements.nation = nationMetrics;

        const mobileNationTables = page.locator('.nation-table');
        await expect(mobileNationTables).toHaveCount(2);
        for (const nationTable of await mobileNationTables.all()) {
            const mobileNationRows = nationTable.locator('.mobile-only:visible');
            await expect(mobileNationRows).toHaveCount(7);
            expect(await mobileNationRows.evaluateAll((rows) => rows.map((row) => row.children.length))).toEqual([
                4, 4, 4, 4, 4, 4, 4,
            ]);
        }
        await expect(page.locator('.nation-table .desktop-only:visible')).toHaveCount(0);
        const nationCellWidths = await page
            .locator('.nation-table .mobile-only:visible')
            .first()
            .locator('td')
            .evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect().width));
        expect(nationCellWidths).toHaveLength(4);
        expect(nationCellWidths[0]).toBeCloseTo(80, 0);
        expect(nationCellWidths[1]).toBeCloseTo(170, 0);
        mobileMeasurements.nationCellWidths = nationCellWidths;

        const firstTrigger = page.locator('[data-general-preview-trigger="10"]');
        await firstTrigger.tap();
        const preview = page.locator('#nation-general-preview');
        await expect(preview).toBeVisible();
        await expect(preview.locator('[data-general-card-id="10"]')).toContainText('조조');
        const touchGeometry = await preview.evaluate((element) => {
            const previewRect = element.getBoundingClientRect();
            const triggerRect = document.querySelector('[data-general-preview-trigger="10"]')!.getBoundingClientRect();
            return {
                left: previewRect.left,
                right: window.innerWidth - previewRect.right,
                width: previewRect.width,
                verticalGap:
                    previewRect.bottom <= triggerRect.top
                        ? triggerRect.top - previewRect.bottom
                        : previewRect.top - triggerRect.bottom,
            };
        });
        expect(touchGeometry.left).toBe(8);
        expect(touchGeometry.right).toBeGreaterThanOrEqual(8);
        expect(touchGeometry.width).toBe(484);
        expect(touchGeometry.verticalGap).toBe(8);
        mobileMeasurements.touchPreview = touchGeometry;
        expect(requestedOperations.filter((operation) => operation === 'world.getGeneralDirectory')).toHaveLength(1);

        await page.goto('general-list');
        await page.waitForLoadState('networkidle');
        await expect(page.locator('.general-table')).toBeHidden();
        await expect(page.locator('.general-card-list')).toBeVisible();
        await expect(page.locator('.general-card-list [data-general-card-id]')).toHaveCount(2);
        await expect(page.locator('[data-directory-tooltip="card-special-domestic-10"]')).toContainText('상재');
        await expect(page.locator('[data-directory-tooltip="card-special-war-10"]')).toContainText('귀모');
        await expect(page.locator('[data-directory-tooltip="card-injury-leadership-10"] > .wounded')).toHaveText(
            '81'
        );
        await expect(page.locator('[data-general-card-id="10"] .leadership-bonus')).toHaveText('+6');
        const mobileInjury = page.locator('[data-directory-tooltip="card-injury-leadership-10"]');
        await mobileInjury.focus();
        await expect(mobileInjury.getByRole('tooltip')).toBeVisible();
        const mobileTooltipGeometry = await mobileInjury.getByRole('tooltip').evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return {
                left: rect.left,
                right: window.innerWidth - rect.right,
                width: rect.width,
                innerWidth: window.innerWidth,
            };
        });
        expect(mobileTooltipGeometry.left).toBeGreaterThanOrEqual(8);
        expect(mobileTooltipGeometry.right).toBeGreaterThanOrEqual(8);
        expect(mobileTooltipGeometry.width).toBeLessThanOrEqual(mobileTooltipGeometry.innerWidth - 16);

        const generalMetrics = await page.locator('.directory-page').evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const cardElement = element.querySelector('[data-general-card-id]')!;
            const card = cardElement.getBoundingClientRect();
            return {
                width: rect.width,
                cardWidth: card.width,
                cardHeight: card.height,
                cardGridColumns: getComputedStyle(cardElement).gridTemplateColumns,
                scrollWidth: document.documentElement.scrollWidth,
                innerWidth: window.innerWidth,
            };
        });
        expect(generalMetrics.width).toBe(500);
        expect(generalMetrics.cardWidth).toBe(500);
        expect(generalMetrics.cardHeight).toBeGreaterThan(100);
        expect(generalMetrics.cardGridColumns).toMatch(/^66px /u);
        expect(generalMetrics.scrollWidth).toBe(generalMetrics.innerWidth);
        mobileMeasurements.general = generalMetrics;

        const artifactRoot = process.env.DIRECTORY_PARITY_ARTIFACT_DIR;
        if (artifactRoot) {
            const output = resolve(artifactRoot);
            await mkdir(output, { recursive: true });
            await writeFile(
                resolve(output, 'mobile-computed-dom.json'),
                `${JSON.stringify(mobileMeasurements, null, 2)}\n`
            );
            await page.screenshot({ path: resolve(output, 'general-directory-mobile.png'), fullPage: true });
            await page.goto('nation-list');
            await firstTrigger.tap();
            await expect(preview).toBeVisible();
            await page.screenshot({ path: resolve(output, 'nation-directory-tap-mobile.png'), fullPage: true });
        }
    } finally {
        await context.close();
    }

    expect(requestedOperations).not.toContain('nation.getSecretGeneralList');
    expect(requestedOperations).not.toContain('nation.getPersonnelInfo');
    expect(requestedOperations).not.toContain('general.me');
});

test('a reused image element falls back for each newly broken account icon', async ({ page }) => {
    await install(page);
    await page.route('https://sam-image.hided.net/icons/**', (route) => {
        if (route.request().url().endsWith('/default.jpg')) {
            return route.fulfill({
                status: 200,
                contentType: 'image/svg+xml',
                body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#777"/></svg>',
            });
        }
        return route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' });
    });
    await page.route('**/gateway/api/user-icons/**', (route) =>
        route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' })
    );
    await page.goto('general-list');

    const icon = page.locator('.general-icon').first();
    await expect(icon).toHaveAttribute('src', 'https://sam-image.hided.net/icons/default.jpg');
    await expect.poll(() => icon.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(64);
    await icon.evaluate((element) => {
        (element as HTMLImageElement).src = '/gateway/api/user-icons/second-missing.png';
    });
    await expect(icon).toHaveAttribute('src', 'https://sam-image.hided.net/icons/default.jpg');
    await expect.poll(() => icon.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(64);
});

test('a failed explicit refresh retains the local sort selection and existing rows', async ({ page }) => {
    await install(page, 'error-after-load');
    await page.goto('general-list');
    await page.selectOption('#viewType', '8');
    await page.getByRole('button', { name: '정렬하기' }).click();
    await page.getByRole('button', { name: '갱 신' }).click();
    await expect(page.getByRole('alert')).toContainText('권한 확인 실패');
    await expect(page.locator('#viewType')).toHaveValue('8');
    await expect(page.locator('tbody tr[data-general-id]')).toHaveCount(2);
});

test('an authenticated account without a general is redirected away from both directories', async ({ page }) => {
    await install(page, 'no-general');
    for (const path of ['nation-list', 'general-list']) {
        await page.goto(path);
        await expect(page).toHaveURL(new RegExp(`/${gameBasePath}/join$`, 'u'));
    }
});

test('route access belongs only to the eight Ref page boundaries', async ({ page }) => {
    const accessPages: string[] = [];
    await installAccessBoundary(page, accessPages);
    const retained = [
        ['nation/info', 'nation-info'],
        ['nation/cities', 'nation-cities'],
        ['nation-list', 'nation-list'],
        ['current-city', 'current-city'],
        ['dynasty', 'dynasty'],
        ['dynasty/1', 'dynasty'],
        ['traffic', 'traffic'],
        ['npc-control', 'npc-control'],
    ] as const;
    for (const [path, pageName] of retained) {
        const before = accessPages.length;
        await page.goto(path);
        await expect(page.locator('#app')).toHaveAttribute('data-v-app', '');
        await expect.poll(() => accessPages.length).toBe(before + 1);
        await page.waitForLoadState('networkidle');
        expect(accessPages.at(-1)).toBe(pageName);
    }

    const endpointOwned = [
        './',
        'global-info',
        'general-list',
        'diplomacy',
        'nation/generals',
        'nation/personnel',
        'nation/finance',
        'battle-center',
        'board',
        'board/secret',
        'best-general',
        'hall-of-fame',
        'yearbook',
        'nation-betting',
        'npc-list',
        'my-page',
        'tournament',
        'betting',
    ];
    for (const path of endpointOwned) {
        const before = accessPages.length;
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        expect(accessPages).toHaveLength(before);
    }
});
