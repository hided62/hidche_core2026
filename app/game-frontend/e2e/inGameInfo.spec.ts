import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const response = (data: unknown) => ({ result: { data } });
const artifactRoot = process.env.CITY_PARITY_ARTIFACT_DIR;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const imageRoots = [resolve(repositoryRoot, '../image'), resolve(repositoryRoot, '../../image')];
const readImage = async (relativePath: string): Promise<Buffer> => {
    if (relativePath.includes('..')) throw new Error(`Unsafe fixture image path: ${relativePath}`);
    for (const root of imageRoots) {
        try {
            return await readFile(resolve(root, relativePath));
        } catch {
            // Product checkout and feature worktrees have different image-root parents.
        }
    }
    throw new Error(`Fixture image not found: ${relativePath}`);
};
const imageContentType = (relativePath: string) => {
    if (relativePath.endsWith('.png')) return 'image/png';
    if (relativePath.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
};
const operationNames = (route: Route) =>
    decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(',');
const city = {
    id: 1,
    name: '업',
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
    supplyState: 1,
    frontState: 0,
    incomes: { gold: 1000, rice: 900, wall: 800 },
    officers: { 2: null, 3: null, 4: { id: 1, name: '태수', npcState: 0, officerLevel: 4, cityId: 1, cityName: '업' } },
};
const map = {
    result: true,
    version: 0,
    startYear: 180,
    year: 200,
    month: 1,
    cityList: [[1, 8, 0, 1, 1, 1]],
    nationList: [[1, '아국', '#008000', 1]],
    spyList: {},
    shownByGeneralList: [],
    myCity: 1,
    myNation: 1,
};
const layout = {
    mapName: 'che',
    cityList: [{ id: 1, name: '업', level: 8, region: 1, x: 345, y: 130, path: [] }],
    regionMap: { 1: '하북' },
    levelMap: { 8: '특' },
};
const generalContext = {
    general: {
        id: 1,
        name: '장수',
        nationId: 1,
        cityId: 1,
        officerLevel: 1,
        npcState: 0,
        troopId: 0,
        picture: null,
        imageServer: 0,
        stats: { leadership: 70, strength: 60, intelligence: 50 },
        gold: 1000,
        rice: 1000,
        crew: 500,
        train: 90,
        atmos: 90,
        injury: 0,
        experience: 0,
        dedication: 0,
        items: { horse: 'None', weapon: 'None', book: 'None', item: 'None' },
    },
    city,
    nation: { id: 1, name: '아국', color: '#008000', level: 1 },
    settings: {},
    penalties: {},
};
const emptyMessages = {
    private: [],
    national: [],
    public: [],
    diplomacy: [],
    sequence: -1,
    hasMore: { private: false, national: false, public: false, diplomacy: false },
    latestRead: { private: 0, national: 0, public: 0, diplomacy: 0 },
    canRespondDiplomacy: false,
};

const install = async (page: Page, mode: 'member' | 'wanderer' | 'admin' = 'member') => {
    await page.addInitScript(() => {
        localStorage.setItem('sammo-game-token', 'ga_info');
        localStorage.setItem('sammo-game-profile', 'che:default');
    });
    await page.route('**/image/**', async (route) => {
        const relativePath = decodeURIComponent(new URL(route.request().url()).pathname.split('/image/')[1] ?? '');
        await route.fulfill({
            status: 200,
            contentType: imageContentType(relativePath),
            body: await readImage(relativePath),
        });
    });
    await page.route('**/che/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'lobby.info') return response({ myGeneral: { id: 1, name: '장수' } });
            if (operation === 'join.getConfig') return response({});
            if (operation === 'general.me') return response(generalContext);
            if (operation === 'world.getMap') return response(map);
            if (operation === 'turns.getCommandTable') return response({ general: [], nation: [] });
            if (operation === 'turns.reserved.getGeneral') return response([]);
            if (operation === 'messages.getRecent') return response(emptyMessages);
            if (operation === 'board.getAccess') return response({ canMeeting: false, canSecret: false });
            if (operation === 'tournament.getState') return response({ stage: 0 });
            if (operation === 'nation.getNationInfo')
                return response({
                    nation: {
                        id: 1,
                        name: '아국',
                        color: '#008000',
                        level: 1,
                        power: 1234,
                        gold: 10000,
                        rice: 9000,
                        tech: 100,
                        rate: 20,
                        bill: 100,
                        capitalCityId: 1,
                        generalCount: 2,
                    },
                    population: { current: 150000, max: 620500 },
                    crew: { current: 500, max: 7000 },
                    income: {
                        goldCity: 1000,
                        goldWar: 200,
                        goldTotal: 1200,
                        riceCity: 900,
                        riceWall: 800,
                        riceTotal: 1700,
                        outcome: 300,
                    },
                    budget: { gold: 10900, rice: 10400 },
                    cities: [{ id: 1, name: '업', capital: true }],
                    history: [{ id: 1, year: 200, month: 1, text: '건국했습니다.' }],
                });
            if (operation === 'nation.getCityOverview')
                return response({
                    me: { id: 1, officerLevel: 1 },
                    nation: {
                        id: 1,
                        name: '아국',
                        color: '#008000',
                        level: 1,
                        typeCode: 'che_중립',
                        capitalCityId: 1,
                        rate: 20,
                    },
                    chiefStatMin: 65,
                    cities: [city],
                    generals: [
                        {
                            id: 1,
                            name: '장수',
                            npcState: 0,
                            officerLevel: 1,
                            cityId: 1,
                            officerCity: 0,
                            stats: { leadership: 70, strength: 60, intelligence: 50 },
                        },
                    ],
                });
            if (operation === 'world.getGlobalInfo')
                return response({
                    myNationId: 1,
                    nations: [
                        {
                            id: 1,
                            name: '아국',
                            color: '#008000',
                            capitalCityId: 1,
                            level: 1,
                            power: 1234,
                            cities: ['업'],
                        },
                        {
                            id: 2,
                            name: '적국',
                            color: '#800000',
                            capitalCityId: 2,
                            level: 1,
                            power: 1000,
                            cities: ['허창'],
                        },
                    ],
                    diplomacy: { 1: { 1: 2, 2: 0 }, 2: { 1: 0, 2: 2 } },
                    conflict: [],
                    map,
                });
            if (operation === 'world.getMapLayout') return response(layout);
            if (operation === 'world.getCurrentCity')
                return response({
                    me: {
                        id: 1,
                        nationId: mode === 'wanderer' ? 0 : 1,
                        officerLevel: mode === 'wanderer' ? 0 : 1,
                        admin: mode === 'admin',
                    },
                    options: [{ id: 1, name: '업', nationId: 1 }],
                    visibility: { full: mode !== 'wanderer', detailed: mode !== 'wanderer' },
                    city: {
                        id: 1,
                        name: '업',
                        nationId: 1,
                        nationColor: '#008000',
                        level: 8,
                        region: 1,
                        population: mode === 'wanderer' ? null : 150000,
                        populationMax: 620500,
                        agriculture: mode === 'wanderer' ? null : 1000,
                        agricultureMax: 12500,
                        commerce: mode === 'wanderer' ? null : 1000,
                        commerceMax: 11300,
                        security: mode === 'wanderer' ? null : 1000,
                        securityMax: 10000,
                        trust: mode === 'wanderer' ? null : 80,
                        trade: 100,
                        defence: mode === 'wanderer' ? null : 5000,
                        defenceMax: 11700,
                        wall: mode === 'wanderer' ? null : 5000,
                        wallMax: 12200,
                        officers: { 2: '-', 3: '-', 4: '태수' },
                    },
                    generals:
                        mode === 'wanderer'
                            ? []
                            : [
                                  {
                                      id: 1,
                                      name: '장수',
                                      npcState: 0,
                                      picture: null,
                                      imageServer: 0,
                                      nationId: 1,
                                      nationName: '아국',
                                      leadership: 70,
                                      strength: 60,
                                      intelligence: 50,
                                      injury: 0,
                                      officerLevel: 1,
                                      leadershipBonus: 0,
                                      defenceTrain: 80,
                                      crewTypeId: 1,
                                      crewTypeName: '보병',
                                      crew: 500,
                                      train: 90,
                                      atmos: 90,
                                      turns: ['징병'],
                                  },
                              ],
                    forceSummary: {
                        enemyCrew: 0,
                        enemyArmedGenerals: 0,
                        enemyGenerals: 0,
                        ownCrew: mode === 'wanderer' ? 0 : 500,
                        ownArmedGenerals: mode === 'wanderer' ? 0 : 1,
                        ownGenerals: mode === 'wanderer' ? 0 : 1,
                        ready90Crew: mode === 'wanderer' ? 0 : 500,
                        ready90Generals: mode === 'wanderer' ? 0 : 1,
                        ready60Crew: mode === 'wanderer' ? 0 : 500,
                        ready60Generals: mode === 'wanderer' ? 0 : 1,
                        defenceReadyCrew: mode === 'wanderer' ? 0 : 500,
                        defenceReadyGenerals: mode === 'wanderer' ? 0 : 1,
                    },
                    lastExecute: '2026-07-26',
                });
            return { error: { message: `unhandled ${operation}`, data: { code: 'BAD_REQUEST' } } };
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
};
const go = async (page: Page, path: string) => {
    await page.goto(path);
};

test('four legacy menu pages keep the 1000px desktop table contract', async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    for (const [path, selector, fontSize, fontFamily, borderCollapse] of [
        ['nation/info', '.legacy-info-page', '14px', 'Pretendard', 'collapse'],
        ['nation/cities', '.nation-cities-page', '14px', 'Pretendard', 'collapse'],
        ['global-info', '.global-page', '14px', 'Pretendard', 'collapse'],
        ['current-city', '.city-page', '16px', 'Times New Roman', 'separate'],
    ] as const) {
        await go(page, path);
        await expect(page.locator(selector)).toBeVisible();
        const box = await page.locator(selector).evaluate((el) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return { x: r.x, width: r.width, fontSize: s.fontSize, fontFamily: s.fontFamily };
        });
        expect(box.width).toBe(1000);
        expect(box.x).toBe(100);
        expect(box.fontSize).toBe(fontSize);
        expect(box.fontFamily).toContain(fontFamily);
        expect(
            await page
                .locator('table')
                .first()
                .evaluate((el) => getComputedStyle(el).borderCollapse)
        ).toBe(borderCollapse);
    }
});

test('current-city hides values and general rows for a wandering user', async ({ page }) => {
    await install(page, 'wanderer');
    await go(page, 'current-city');
    await expect(page.locator('.stats')).toContainText('?/620,500');
    await expect(page.locator('.generals')).toHaveCount(0);
});

test('current-city exposes own general details to a member and admin fixture', async ({ page }) => {
    await install(page, 'admin');
    await page.setViewportSize({ width: 1200, height: 900 });
    await go(page, 'current-city');
    await expect(page.locator('.generals')).toContainText('장수');
    await expect(page.locator('.generals')).toContainText('90');
    const legacyGeometry = await page.evaluate(() => {
        const rect = (selector: string) => {
            const box = document.querySelector(selector)?.getBoundingClientRect();
            return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
        };
        const icon = document.querySelector<HTMLImageElement>('.general-icon');
        return {
            selector: rect('#citySelector'),
            stats: rect('.stats'),
            generals: rect('.generals'),
            titleAlign: getComputedStyle(document.querySelector('.city-page > table:first-child td')!).textAlign,
            icon: icon
                ? {
                      ...rect('.general-icon'),
                      naturalWidth: icon.naturalWidth,
                      naturalHeight: icon.naturalHeight,
                  }
                : null,
        };
    });
    expect(legacyGeometry.selector).toMatchObject({ width: 400, height: 19 });
    expect(legacyGeometry.stats).toEqual({ x: 100, y: 178, width: 1000, height: 136 });
    expect(legacyGeometry.generals).toMatchObject({ x: 88, y: 332, width: 1024 });
    expect(legacyGeometry.titleAlign).toBe('start');
    expect(legacyGeometry.icon).toMatchObject({ width: 64, height: 64, naturalWidth: 64, naturalHeight: 64 });
    if (artifactRoot) {
        await mkdir(artifactRoot, { recursive: true });
        const computedDom = await page.evaluate(() => {
            const measure = (selector: string) => {
                const element = document.querySelector(selector);
                if (!element) return null;
                const box = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return {
                    rect: { x: box.x, y: box.y, width: box.width, height: box.height },
                    style: {
                        fontFamily: style.fontFamily,
                        fontSize: style.fontSize,
                        lineHeight: style.lineHeight,
                        color: style.color,
                        backgroundColor: style.backgroundColor,
                        backgroundImage: style.backgroundImage,
                        borderCollapse: style.borderCollapse,
                        padding: style.padding,
                        textAlign: style.textAlign,
                    },
                };
            };
            const icon = document.querySelector<HTMLImageElement>('.general-icon');
            return {
                body: measure('body'),
                page: measure('.city-page'),
                selector: measure('#citySelector'),
                stats: measure('.stats'),
                generals: measure('.generals'),
                title: measure('.city-title'),
                firstIcon: icon
                    ? {
                          ...measure('.general-icon'),
                          naturalWidth: icon.naturalWidth,
                          naturalHeight: icon.naturalHeight,
                      }
                    : null,
                document: {
                    width: document.documentElement.scrollWidth,
                    height: document.documentElement.scrollHeight,
                },
            };
        });
        await writeFile(
            resolve(artifactRoot, 'core-current-city-computed-dom.json'),
            `${JSON.stringify(computedDom, null, 2)}\n`
        );
        await page.screenshot({
            path: resolve(artifactRoot, 'core-current-city-desktop.png'),
            fullPage: true,
            animations: 'disabled',
        });
    }
});

test('a Chromium map click opens the clicked city route and keeps the legacy pointer interaction', async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await go(page, '');
    const cityLink = page.locator('.map-city').first();
    await expect(cityLink).toBeVisible();
    await cityLink.hover();
    await expect(cityLink).toHaveCSS('cursor', 'pointer');
    await cityLink.click();
    await expect(page).toHaveURL(/\/che\/current-city\?cityId=1$/);
    await expect(page.locator('.stats')).toContainText('업');
});
