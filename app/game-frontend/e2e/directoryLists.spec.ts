import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

const response = (data: unknown) => ({ result: { data } });
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
        picture: 'default.jpg',
        imageServer: 0,
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
        picture: 'default.jpg',
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

const parseSort = (route: Route): number => {
    const raw = new URL(route.request().url()).searchParams.get('input');
    if (!raw) return 9;
    try {
        const input = JSON.parse(raw) as { 0?: { sort?: number }; json?: { sort?: number } };
        return input[0]?.sort ?? input.json?.sort ?? 9;
    } catch {
        return 9;
    }
};

const install = async (
    page: Page,
    mode: 'general' | 'no-general' | 'error-after-load' = 'general'
) => {
    let generalDirectoryCalls = 0;
    await page.addInitScript(() => {
        localStorage.setItem('sammo-game-token', 'ga_directory');
        localStorage.setItem('sammo-game-profile', 'che:default');
    });
    await page.route('**/image/general/**', (route) =>
        route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#777"/></svg>',
        })
    );
    await page.route('**/image/game/**', (route) =>
        route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from('') })
    );
    await page.route('**/che/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'lobby.info') {
                return response({ myGeneral: mode === 'no-general' ? null : { id: 1, name: '조회자' } });
            }
            if (operation === 'join.getConfig') return response({});
            if (operation === 'world.getNationDirectory') return response(nationDirectory);
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
                const rows = sort === 8 ? [...generals].sort((left, right) => left.killturn - right.killturn) : generals;
                return response({ sort, generals: rows });
            }
            return { error: { message: `unhandled ${operation}`, data: { code: 'BAD_REQUEST' } } };
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
};

test('nation and general directories preserve the fixed legacy Chromium geometry', async ({ page }) => {
    await install(page);
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

    const header = page.locator('.general-table thead td').first();
    expect(await header.evaluate((element) => getComputedStyle(element).backgroundImage)).toContain('back_green.jpg');
    const icon = page.locator('.general-icon').first();
    await expect(icon).toBeVisible();
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

test('general directory submits the legacy sort selector and keeps wounded/bonus rendering', async ({ page }) => {
    await install(page);
    await page.goto('general-list');
    await expect(page.locator('tbody tr[data-general-id]')).toHaveCount(2);
    await page.selectOption('#viewType', '8');
    await page.getByRole('button', { name: '정렬하기' }).click();
    await expect(page.locator('tbody tr[data-general-id]').first()).toHaveAttribute('data-general-id', '20');
    await expect(page.locator('tbody tr[data-general-id="10"] .wounded').first()).toHaveText('81');
    await expect(page.locator('tbody tr[data-general-id="10"] .leadership-bonus')).toHaveText('+6');

    await page.locator('#viewType').focus();
    expect(await page.locator('#viewType').evaluate((element) => document.activeElement === element)).toBe(true);
});

test('a failed resort retains the selected value and existing rows', async ({ page }) => {
    await install(page, 'error-after-load');
    await page.goto('general-list');
    await page.selectOption('#viewType', '8');
    await page.getByRole('button', { name: '정렬하기' }).click();
    await expect(page.getByRole('alert')).toContainText('권한 확인 실패');
    await expect(page.locator('#viewType')).toHaveValue('8');
    await expect(page.locator('tbody tr[data-general-id]')).toHaveCount(2);
});

test('an authenticated account without a general is redirected away from both directories', async ({ page }) => {
    await install(page, 'no-general');
    for (const path of ['nation-list', 'general-list']) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/che\/join$/);
    }
});
