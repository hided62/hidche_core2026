import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { gameProfile, gameTrpcRoute } from './gameTestPaths.js';

const artifactRoot = process.env.INFO_LAYOUT_ARTIFACT_DIR;
const baseline = process.env.INFO_LAYOUT_BASELINE === '1';
const commands = [
    { action: 'che_징병', args: { crewType: 1, amount: 12345 } },
    { action: 'che_화계', args: { destCityId: 1 } },
    { action: '휴식', args: {} },
    { action: 'che_징병', args: { crewType: 1, amount: 9000 } },
    { action: 'che_화계', args: { destCityId: 2 } },
];
const generals = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    name: index === 0 ? '긴이름을가진검증장수' : `검증장수${index + 1}`,
    npcState: index % 5 === 4 ? 2 : 0,
    picture: null,
    imageServer: 0,
    nationId: 1,
    nationName: '위',
    injury: index === 0 ? 30 : 0,
    stats: { leadership: 70, strength: 56, intelligence: 42 },
    baseStats: { leadership: 100, strength: 80, intelligence: 60 },
    leadership: 100,
    strength: 80,
    intelligence: 60,
    leadershipBonus: index === 0 ? 12 : 0,
    experienceLevel: 12,
    officerLevel: 4,
    cityId: 1,
    cityName: '업',
    troopId: 1,
    troopName: index === 0 ? '이름이긴백호부대' : '백호부대',
    gold: index === 0 ? 123456789 : 12345 + index,
    rice: 234567 + index,
    defenceTrain: 90,
    defenceTrainText: '☆',
    crewTypeId: 1,
    crewTypeName: '보병',
    crew: 12345,
    train: 90,
    atmos: 95,
    killTurn: 8,
    turnTime: `2026-01-01T01:${String(index % 60).padStart(2, '0')}:00.000Z`,
    reservedCommands: index % 5 === 4 ? [] : commands,
    turns: index % 5 === 4 ? [] : commands,
}));
const commandTable = {
    general: [
        {
            category: '군사',
            values: [
                { key: 'che_징병', name: '징병', reqArg: true, inputFields: [] },
                { key: 'che_화계', name: '화계', reqArg: true, inputFields: [] },
                { key: '휴식', name: '휴식', reqArg: false, inputFields: [] },
            ],
        },
    ],
    nation: [],
    inputOptions: {
        cities: [
            { value: 1, label: '업 (위)' },
            { value: 2, label: '이름이아주긴목적지도시 (위)' },
        ],
        generals: [],
        nations: [],
        crewTypes: [{ value: 1, label: '보병' }],
        armTypes: [],
        nationTypes: [],
        colors: [],
        items: {},
        recruitment: null,
    },
};
const summary = {
    gold: 123456789,
    rice: 234567890,
    averageGold: 1234567.89,
    averageRice: 2345678.9,
    crew: 1234500,
    generalCount: 100,
    readiness: {
        90: { crew: 1234500, generals: 100 },
        80: { crew: 1234500, generals: 100 },
        60: { crew: 1234500, generals: 100 },
    },
};
const forceSummary = {
    enemyCrew: 0,
    enemyArmedGenerals: 0,
    enemyGenerals: 0,
    ownCrew: 1234500,
    ownArmedGenerals: 100,
    ownGenerals: 100,
    ready90Crew: 1234500,
    ready90Generals: 100,
    ready60Crew: 1234500,
    ready60Generals: 100,
    defenceReadyCrew: 1234500,
    defenceReadyGenerals: 100,
};
const install = async (page: Page, variant: 'mixed' | 'idle' | 'empty' = 'mixed') => {
    const fixtureGenerals =
        variant === 'empty'
            ? []
            : variant === 'idle'
              ? generals.map((general) => ({ ...general, npcState: 2, injury: 0, reservedCommands: [], turns: [] }))
              : generals;
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_info_layout_fixture');
        localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    await page.route('**/image/**', async (route) => {
        const relativePath = new URL(route.request().url()).pathname.split('/image/')[1]!;
        if (relativePath.includes('..')) throw new Error('Invalid image fixture path');
        const root = process.env.FRONTEND_PARITY_IMAGE_ROOT;
        if (!root) throw new Error('FRONTEND_PARITY_IMAGE_ROOT is required');
        const body = await readFile(resolve(root, relativePath));
        await route.fulfill({
            body,
            contentType: relativePath.endsWith('.png')
                ? 'image/png'
                : relativePath.endsWith('.gif')
                  ? 'image/gif'
                  : 'image/jpeg',
        });
    });
    await page.route(gameTrpcRoute, async (route) => {
        const operations = decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(
            ','
        );
        const responses = operations.map((operation) => {
            let data: unknown;
            if (operation === 'auth.status') data = { ok: true };
            else if (operation === 'lobby.info') data = { myGeneral: { id: 1, name: '검증장수' } };
            else if (operation === 'join.getConfig') data = {};
            else if (operation === 'public.recordAccess') data = { recorded: true };
            else if (operation === 'general.me') data = { general: generals[0], iconChoices: [] };
            else if (operation === 'turns.getCommandTable') data = commandTable;
            else if (operation === 'nation.getSecretGeneralList')
                data = {
                    nation: { id: 1, name: '위', color: '#008000', level: 3 },
                    viewer: { generalId: 1, permission: 1 },
                    summary,
                    generals: fixtureGenerals,
                };
            else if (operation === 'world.getCurrentCity')
                data = {
                    me: { id: 1, nationId: 1, officerLevel: 4, admin: false },
                    options: [
                        { id: 1, name: '업', nationId: 1 },
                        { id: 2, name: '낙양', nationId: 1 },
                    ],
                    visibility: { full: true, detailed: true },
                    city: {
                        id: 1,
                        name: '업',
                        nationId: 1,
                        nationColor: '#008000',
                        level: 8,
                        region: 1,
                        population: 150000,
                        populationMax: 620500,
                        agriculture: 1000,
                        agricultureMax: 12500,
                        commerce: 1000,
                        commerceMax: 11300,
                        security: 1000,
                        securityMax: 10000,
                        trust: 80,
                        trade: 100,
                        defence: 5000,
                        defenceMax: 11700,
                        wall: 5000,
                        wallMax: 12200,
                        officers: { 2: '이름이긴종사장수', 3: '군사', 4: '태수' },
                    },
                    generals: fixtureGenerals,
                    forceSummary,
                    lastExecute: '2026-09-12',
                };
            else throw new Error(`Unhandled fixture operation: ${operation}`);
            return { result: { data } };
        });
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(responses) });
    });
};

// CSS textures are not part of document.images; wait for them before collecting visuals.
const waitForVisualAssets = async (page: Page) => {
    await expect(page.locator('.legacy-bg0').first()).toHaveCSS('background-image', /url\(/);
    await page.evaluate(async () => {
        await document.fonts.ready;
        const backgrounds = new Set<string>();
        for (const element of document.querySelectorAll('body, main, table, td, th')) {
            for (const match of getComputedStyle(element).backgroundImage.matchAll(/url\(["']?(.*?)["']?\)/g)) {
                if (match[1]) backgrounds.add(match[1]);
            }
        }
        await Promise.all([
            ...Array.from(document.images, (image) => image.decode()),
            ...Array.from(backgrounds, async (url) => {
                const image = new Image();
                image.src = url;
                await image.decode();
            }),
        ]);
    });
};

const measure = async (page: Page, root: string, table: string, name: string) => {
    await expect(page.locator(`${table} tbody tr`)).toHaveCount(100);
    await waitForVisualAssets(page);
    const result = await page.evaluate(
        ({ root, table }) => {
            const rect = (element: Element) => {
                const b = element.getBoundingClientRect();
                return { x: b.x, y: b.y, width: b.width, height: b.height };
            };
            const container = document.querySelector(root)!;
            const rows = Array.from(document.querySelectorAll(`${table} tbody tr`));
            return {
                fonts: Array.from(document.fonts, (font) => ({ family: font.family, status: font.status })),
                page: rect(container),
                table: rect(document.querySelector(table)!),
                document: {
                    width: document.documentElement.scrollWidth,
                    height: document.documentElement.scrollHeight,
                    clientWidth: document.documentElement.clientWidth,
                },
                rows: rows.map((row) => ({
                    rect: rect(row),
                    cells: Array.from(row.querySelectorAll('td'), (cell) => ({
                        field: cell.dataset.field,
                        gridArea: getComputedStyle(cell).gridArea,
                        rect: rect(cell),
                        text: cell.innerText.replace(/\s+/g, ''),
                        scrollWidth: cell.scrollWidth,
                        clientWidth: cell.clientWidth,
                        fontSize: getComputedStyle(cell).fontSize,
                        lineHeight: getComputedStyle(cell).lineHeight,
                    })),
                })),
                images: Array.from(container.querySelectorAll('img'), (image) => ({
                    rect: rect(image),
                    naturalWidth: image.naturalWidth,
                    naturalHeight: image.naturalHeight,
                    objectFit: getComputedStyle(image).objectFit,
                })),
            };
        },
        { root, table }
    );
    if (artifactRoot) {
        await mkdir(artifactRoot, { recursive: true });
        await writeFile(resolve(artifactRoot, `${name}.json`), JSON.stringify(result, null, 2));
        await writeFile(
            resolve(artifactRoot, `${name}.html`),
            await page.locator(root).evaluate((element) => element.outerHTML)
        );
        await page.screenshot({ path: resolve(artifactRoot, `${name}.png`), fullPage: true });
        await page.screenshot({ path: resolve(artifactRoot, `${name}-viewport.png`) });
    }
    return result;
};

for (const [route, root, table] of [
    ['nation/secret', '.secret-page', '#secret-general-list'],
    ['current-city', '.city-page', '.generals'],
] as const) {
    test(`${route} 500px retains 100 generals without doubling list height`, async ({ page }) => {
        test.setTimeout(60_000);
        await install(page);
        await page.setViewportSize({ width: 1000, height: 900 });
        await page.goto(route);
        const desktop = await measure(page, root, table, `${route.replace('/', '-')}-1000`);
        for (const width of [500, 501, 800]) {
            await page.setViewportSize({ width, height: 900 });
            const mobile = await measure(page, root, table, `${route.replace('/', '-')}-${width}`);
            if (baseline) continue;
            expect(mobile.page.width).toBe(500);
            expect(mobile.table.width).toBe(500);
            expect(mobile.page.x).toBeCloseTo((width - 500) / 2, 0);
            expect(mobile.document.width).toBe(width);
            expect(mobile.table.height / desktop.table.height).toBeLessThan(1.5);
            expect(mobile.page.height / desktop.page.height).toBeLessThan(1.55);
            expect(mobile.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual(
                desktop.rows.map((row) => row.cells.map((cell) => cell.text))
            );
            // Every general shares the same columns, including NPCs and empty reservations.
            for (const row of mobile.rows) {
                const turns = row.cells.find((cell) => cell.field === 'turns')!;
                expect(turns.rect.width).toBeCloseTo(166, 0);
                for (const [index, cell] of row.cells.entries()) {
                    const reference = mobile.rows[0]!.cells[index]!;
                    expect(cell.gridArea).toBe(reference.gridArea);
                    expect(cell.rect.x).toBeCloseTo(reference.rect.x, 1);
                    expect(cell.rect.width).toBeCloseTo(reference.rect.width, 1);
                }
            }
            for (const row of mobile.rows)
                for (const cell of row.cells) {
                    expect(cell.rect.width).toBeGreaterThan(0);
                    expect(cell.rect.x).toBeGreaterThanOrEqual(mobile.page.x - 1);
                    expect(cell.rect.x + cell.rect.width).toBeLessThanOrEqual(mobile.page.x + 501);
                    expect(cell.scrollWidth - cell.clientWidth).toBeLessThanOrEqual(1);
                }
            for (const image of mobile.images)
                expect(image).toMatchObject({ rect: { width: 64, height: 64 }, naturalWidth: 64, naturalHeight: 64 });
        }
        if (baseline) return;
        await page.setViewportSize({ width: 500, height: 900 });
        if (route === 'nation/secret') {
            const sort = page.locator('#secret-list-sort');
            await sort.selectOption('1');
            await page.locator('.title').getByRole('button', { name: '정렬' }).click();
            await expect(page.locator(`${table} tbody tr`).first()).toHaveAttribute('data-general-id', '1');
            const citySort = page.getByRole('button', { name: '도시 기준 정렬' });
            await citySort.hover();
            await citySort.focus();
            await page.mouse.down();
            await page.mouse.up();
            await expect(page.locator('#secret-general-list th[aria-sort="ascending"]')).toContainText('도시');
            const injury = page.locator('[data-directory-tooltip="secret-injury-name-1"]');
            await injury.focus();
            await expect(injury.getByRole('tooltip')).toBeVisible();
            await injury.hover();
            await expect(injury.getByRole('tooltip')).toContainText('부상 30%');
        } else {
            await page.locator('#citySelector').selectOption('2');
            await expect(page).toHaveURL(/cityId=2/);
        }
    });
}

test('physical mobile switches both information pages through the settings 500/1000 radios', async ({
    browser,
    baseURL,
}) => {
    test.skip(baseline);
    const context = await browser.newContext({
        baseURL,
        viewport: { width: 390, height: 844 },
        screen: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
    });
    const page = await context.newPage();
    await install(page);
    for (const mode of ['1000px', '500px'] as const) {
        await page.goto('my-settings');
        await page.locator(`input[value="${mode}"]`).check();
        for (const [route, root] of [
            ['nation/secret', '.secret-page .title'],
            ['current-city', '.city-page'],
        ] as const) {
            await page.goto(route);
            await expect(page.locator(root)).toBeVisible();
            await expect
                .poll(() => page.locator(root).evaluate((element) => element.getBoundingClientRect().width))
                .toBe(mode === '500px' ? 500 : 1000);
            expect(
                await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
            ).toBeLessThanOrEqual(1);
            await expect(
                page.locator(route === 'nation/secret' ? '#secret-general-list tbody tr' : '.generals tbody tr')
            ).toHaveCount(100);
            await waitForVisualAssets(page);
            if (artifactRoot)
                await page.screenshot({
                    path: resolve(artifactRoot, `physical-${route.replace('/', '-')}-${mode}.png`),
                });
        }
    }
    await context.close();
});

test('idle and empty information lists stay compact; doubled text wraps without losing fields', async ({ page }) => {
    test.skip(baseline);
    test.setTimeout(60_000);
    await install(page, 'idle');
    for (const [route, root, table] of [
        ['nation/secret', '.secret-page', '#secret-general-list'],
        ['current-city', '.city-page', '.generals'],
    ] as const) {
        await page.setViewportSize({ width: 1000, height: 900 });
        await page.goto(route);
        const desktop = await measure(page, root, table, `idle-${route.replace('/', '-')}-1000`);
        await page.setViewportSize({ width: 500, height: 900 });
        const mobile = await measure(page, root, table, `idle-${route.replace('/', '-')}-500`);
        if (route === 'nation/secret') {
            // The uniform four-line layout intentionally replaces the former NPC-only two-line layout.
            // Bound the ordinary row directly; desktop idle rows have no command height to share.
            for (const row of mobile.rows.slice(1)) expect(row.rect.height).toBeLessThan(76);
            expect(mobile.table.height).toBeLessThan(7600);
        } else {
            expect(mobile.table.height / desktop.table.height).toBeLessThan(1.8);
        }
        expect(mobile.document.width).toBe(500);
        await page.unroute(gameTrpcRoute);
        await install(page);
        await page.goto(route);
        const unscaled = await measure(page, root, table, `full-text-${route.replace('/', '-')}-500`);
        await page.locator(`${root} td, ${root} th`).evaluateAll((elements) => {
            const sizes = elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize));
            elements.forEach((element, index) => {
                const cell = element as HTMLElement;
                cell.style.setProperty('font-size', `${sizes[index]! * 2}px`, 'important');
                cell.style.setProperty('line-height', '1.3', 'important');
            });
        });
        await page.addStyleTag({ content: `${root} td::before { font-size:22px !important; }` });
        const large = await measure(page, root, table, `large-text-${route.replace('/', '-')}-500`);
        expect(large.document.width).toBe(500);
        expect(large.rows.map((row) => row.cells.map((cell) => cell.text))).toEqual(
            unscaled.rows.map((row) => row.cells.map((cell) => cell.text))
        );
        for (const row of large.rows)
            for (const cell of row.cells) expect(cell.scrollWidth - cell.clientWidth).toBeLessThanOrEqual(1);
        await page.unroute(gameTrpcRoute);
        await install(page, 'idle');
    }
    await page.unroute(gameTrpcRoute);
    await install(page, 'empty');
    for (const [route, table] of [
        ['nation/secret', '#secret-general-list'],
        ['current-city', '.generals'],
    ] as const) {
        await page.goto(route);
        // The mobile current-city table has no heading-only height when there are no rows.
        await expect(page.locator(table)).toBeAttached();
        await expect(page.locator(`${table} tbody tr`)).toHaveCount(0);
        await expect(
            page.locator(route === 'nation/secret' ? '.secret-page .footer' : '.city-page .footer')
        ).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(500);
    }
});
