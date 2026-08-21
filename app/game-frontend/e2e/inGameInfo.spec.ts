import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const response = (data: unknown) => ({ result: { data } });
const artifactRoot = process.env.CITY_PARITY_ARTIFACT_DIR;
const gameBasePath = `/${(process.env.PLAYWRIGHT_GAME_BASE_PATH ?? 'che').replace(/^\/+|\/+$/g, '')}`;
const gameProfile = process.env.PLAYWRIGHT_GAME_PROFILE ?? `${gameBasePath.slice(1)}:default`;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const imageRoots = [
    ...(process.env.FRONTEND_PARITY_IMAGE_ROOT ? [resolve(process.env.FRONTEND_PARITY_IMAGE_ROOT)] : []),
    resolve(repositoryRoot, '../image'),
    resolve(repositoryRoot, '../../image'),
];
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
const castleFixtures = [
    { id: 1, level: 8, layoutLevel: 1, x: 100, y: 100, width: 32, height: 24 },
    { id: 2, level: 1, layoutLevel: 8, x: 200, y: 100, width: 16, height: 15 },
    { id: 3, level: 2, layoutLevel: 8, x: 300, y: 100, width: 20, height: 14 },
    { id: 4, level: 3, layoutLevel: 8, x: 400, y: 100, width: 14, height: 14 },
    { id: 5, level: 4, layoutLevel: 8, x: 100, y: 220, width: 20, height: 15 },
    { id: 6, level: 5, layoutLevel: 8, x: 200, y: 220, width: 24, height: 16 },
    { id: 7, level: 6, layoutLevel: 8, x: 300, y: 220, width: 26, height: 18 },
    { id: 8, level: 7, layoutLevel: 8, x: 400, y: 220, width: 28, height: 20 },
] as const;
const map = {
    result: true,
    version: 0,
    startYear: 180,
    year: 200,
    month: 1,
    techLevelLimit: { maxLevel: 12, initialLevel: 1, increaseYears: 5 },
    cityList: castleFixtures.map(({ id, level }) => [id, level, 0, 1, 1, 1]),
    nationList: [[1, '아국', '#008000', 1]],
    spyList: {},
    shownByGeneralList: [],
    myCity: 1,
    myNation: 1,
};
const layout = {
    mapName: 'che',
    cityList: castleFixtures.map(({ id, layoutLevel: level, x, y }) => ({
        id,
        name: id === 1 ? '업' : `성${id}`,
        level,
        region: 1,
        x,
        y,
        path: [],
    })),
    regionMap: { 1: '하북' },
    levelMap: { 1: '수', 2: '진', 3: '관', 4: '이', 5: '소', 6: '중', 7: '대', 8: '특' },
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
    nation: {
        id: 1,
        name: '아국',
        color: '#008000',
        level: 1,
        gold: 10_000,
        rice: 9_000,
        tech: 100,
        typeName: '유가',
        typePros: '농상↑ 민심↑',
        typeCons: '쌀수입↓',
        population: { cityCount: 1, current: 150_000, max: 620_500 },
        crew: { generalCount: 2, current: 500, max: 7_000 },
        power: 1_234,
        bill: 100,
        taxRate: 20,
        strategicCommandLimit: 0,
        diplomaticLimit: 0,
        prohibitScout: false,
        prohibitWar: false,
        techLevel: 0,
        techLimited: false,
        topChiefs: {},
        impossibleStrategicCommands: [],
    },
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

const install = async (
    page: Page,
    mode: 'member' | 'wanderer' | 'admin' = 'member',
    trade: number | null = 100,
    globalNationCount = 2,
    mapFixture = map,
    denseCurrentCity = false
) => {
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_info');
        localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    await page.route('**/image/**', async (route) => {
        const relativePath = decodeURIComponent(new URL(route.request().url()).pathname.split('/image/')[1] ?? '');
        await route.fulfill({
            status: 200,
            contentType: imageContentType(relativePath),
            body: await readImage(relativePath),
        });
    });
    await page.route('**/game/**', async (route) => {
        const relativePath = decodeURIComponent(new URL(route.request().url()).pathname.split('/game/')[1] ?? '');
        const fixturePath = `game/${relativePath}`;
        await route.fulfill({
            status: 200,
            contentType: imageContentType(fixturePath),
            body: await readImage(fixturePath),
        });
    });
    await page.route(`**${gameBasePath}/api/trpc/**`, async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') return response({ myGeneral: { id: 1, name: '장수' } });
            if (operation === 'join.getConfig') return response({});
            if (operation === 'dashboard.getContextBundleDelta') {
                return response({
                    context: {
                        kind: 'snapshot',
                        revision: 'AAAAAAAAAAAAAAAAAAAAAA',
                        data: generalContext,
                    },
                    commandTable: {
                        kind: 'snapshot',
                        revision: 'BBBBBBBBBBBBBBBBBBBBBB',
                        data: { general: [], nation: [] },
                    },
                    boardAccess: {
                        kind: 'snapshot',
                        revision: 'CCCCCCCCCCCCCCCCCCCCCC',
                        data: { permission: 0, canMeeting: false, canSecret: false },
                    },
                });
            }
            if (operation === 'general.me') return response(generalContext);
            if (operation === 'world.getMap') return response(mapFixture);
            if (operation === 'turns.getCommandTable') return response({ general: [], nation: [] });
            if (operation === 'turns.reserved.getGeneral' || operation === 'turns.reserved.getNation') {
                return response({ turns: [], revision: 0 });
            }
            if (operation === 'messages.getRecent') return response(emptyMessages);
            if (operation === 'messages.getContacts') return response({ nation: [] });
            if (operation === 'general.getRecentRecords') return response({ global: [], general: [], history: [] });
            if (operation === 'general.getFrontStatus')
                return response({
                    onlineUserCount: 1,
                    onlineNations: '아국(1)',
                    onlineGenerals: '장수',
                    nationNotice: '',
                    lastExecuted: null,
                    latestVote: null,
                });
            if (operation === 'board.getAccess') return response({ canMeeting: false, canSecret: false });
            if (operation === 'tournament.getState') return response({ stage: 0 });
            if (operation === 'public.recordAccess') return response({ recorded: true });
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
                            generalCount: 2,
                            cities: ['업'],
                        },
                        {
                            id: 2,
                            name: '적국',
                            color: '#FFFF00',
                            capitalCityId: 2,
                            level: 1,
                            power: 1000,
                            generalCount: 1,
                            cities: ['허창'],
                        },
                    ].slice(0, globalNationCount),
                    diplomacy: { 1: { 1: 2, 2: 0 }, 2: { 1: 0, 2: 2 } },
                    conflict: [],
                    map: mapFixture,
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
                        trade,
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
                                      turns: denseCurrentCity ? ['징병', '훈련'] : ['징병'],
                                  },
                                  ...(denseCurrentCity
                                      ? Array.from({ length: 12 }, (_, index) => ({
                                            id: index + 2,
                                            name: `NPC장수이름이긴${index + 1}`,
                                            npcState: 2,
                                            picture: null,
                                            imageServer: 0,
                                            nationId: 1,
                                            nationName: '아국',
                                            leadership: 60,
                                            strength: 60,
                                            intelligence: 60,
                                            injury: 0,
                                            officerLevel: 1,
                                            leadershipBonus: 0,
                                            defenceTrain: 80,
                                            crewTypeId: 1,
                                            crewTypeName: '보병',
                                            crew: 500,
                                            train: 90,
                                            atmos: 90,
                                            turns: [],
                                        }))
                                      : []),
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
        ['current-city', '.city-page', '14px', 'Pretendard', 'separate'],
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
        if (path === 'nation/info') {
            await expect(page.locator(selector)).toContainText('작 위호족');
            await expect(page.locator(selector)).not.toContainText('작 위1');
        }
    }
});

test('국가 정보의 작위는 Ref 국가 등급 이름으로 표시된다', async ({ page }) => {
    await install(page);
    await page.goto('nation/info');

    const root = page.locator('.legacy-info-page');
    await expect(root).toContainText('작 위호족');
    await expect(root).not.toContainText('작 위1');
});

test('map keeps desktop hover navigation and lets touch users choose one-tap or two-tap city navigation', async ({
    browser,
    page,
}, testInfo) => {
    await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await go(page, 'global-info');

    const desktopCity = page.locator('.city-base').first();
    await expect(page.locator('.map-toggle-single-tap')).toHaveCount(0);
    await desktopCity.hover();
    await expect(page.locator('.map-tooltip .tooltip-title')).toHaveText('【하북|특】업');
    await desktopCity.click();
    await expect(page).toHaveURL(/\/current-city\?cityId=1$/u);
    await page.goBack();
    await expect(page).toHaveURL(/\/global-info$/u);
    const retainedSelection = page.locator('.city-base').first();
    await expect(retainedSelection).toHaveClass(/selected/);
    expect(
        await retainedSelection.locator('.city-icon').evaluate((element) => getComputedStyle(element).boxShadow)
    ).toContain('255, 235, 150');

    const configuredBaseUrl = testInfo.project.use.baseURL;
    if (typeof configuredBaseUrl !== 'string') {
        throw new Error('Playwright baseURL is required for the mobile map contract');
    }
    const context = await browser.newContext({
        baseURL: configuredBaseUrl,
        viewport: { width: 390, height: 844 },
        screen: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        colorScheme: 'dark',
    });
    const mobilePage = await context.newPage();

    try {
        await install(mobilePage);
        await go(mobilePage, 'global-info');

        const twoTapButton = mobilePage.getByRole('button', { name: '두번 탭 해 도시 이동 끄기' });
        await expect(twoTapButton).toBeVisible();
        await expect(twoTapButton).toHaveAttribute('aria-pressed', 'false');
        const controlGeometry = await twoTapButton.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const mapRect = element.closest('.map-area')?.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                right: rect.right,
                bottom: rect.bottom,
                mapRight: mapRect?.right,
                mapBottom: mapRect?.bottom,
                fontSize: style.fontSize,
                lineHeight: style.lineHeight,
                documentWidth: document.documentElement.scrollWidth,
                viewportWidth: document.documentElement.clientWidth,
                overflowing: Array.from(document.querySelectorAll<HTMLElement>('body *'))
                    .filter(
                        (candidate) => candidate.getBoundingClientRect().right > document.documentElement.clientWidth
                    )
                    .map((candidate) => ({
                        tag: candidate.tagName,
                        className: candidate.className,
                        right: candidate.getBoundingClientRect().right,
                    }))
                    .slice(0, 8),
            };
        });
        expect(controlGeometry).toMatchObject({
            fontSize: '11px',
            lineHeight: '18px',
            viewportWidth: 500,
            overflowing: [],
        });
        expect(controlGeometry.documentWidth).toBeLessThanOrEqual(controlGeometry.viewportWidth + 1);
        expect(controlGeometry.mapRight! - controlGeometry.right).toBeCloseTo(4, 1);
        expect(controlGeometry.mapBottom! - controlGeometry.bottom).toBeCloseTo(4, 1);

        const mobileCities = mobilePage.locator('.city-base');
        await mobileCities.nth(0).tap();
        await expect(mobilePage).toHaveURL(/\/global-info$/u);
        await expect(mobilePage.locator('.map-tooltip .tooltip-title')).toHaveText('【하북|특】업');

        await mobileCities.nth(1).tap();
        await expect(mobilePage).toHaveURL(/\/global-info$/u);
        await expect(mobilePage.locator('.map-tooltip .tooltip-title')).toHaveText('【하북|수】성2');
        await mobilePage.screenshot({ path: testInfo.outputPath('mobile-map-first-tap-tooltip.png'), fullPage: true });

        await mobileCities.nth(1).tap();
        await expect(mobilePage).toHaveURL(/\/current-city\?cityId=2$/u);

        await go(mobilePage, 'global-info');
        await mobilePage.getByRole('button', { name: '두번 탭 해 도시 이동 끄기' }).click();
        const singleTapButton = mobilePage.getByRole('button', { name: '두번 탭 해 도시 이동 켜기' });
        await expect(singleTapButton).toHaveAttribute('aria-pressed', 'true');
        expect(await mobilePage.evaluate(() => localStorage.getItem('sam.toggleSingleTap'))).toBe('yes');

        await mobilePage.reload();
        await expect(singleTapButton).toBeVisible();
        await mobilePage.locator('.city-base').nth(2).tap();
        await expect(mobilePage).toHaveURL(/\/current-city\?cityId=3$/u);

        await go(mobilePage, 'global-info');
        await mobilePage.getByRole('button', { name: '두번 탭 해 도시 이동 켜기' }).click();
        expect(await mobilePage.evaluate(() => localStorage.getItem('sam.toggleSingleTap'))).toBe('no');
        await mobilePage.locator('.city-base').first().tap();
        await expect(mobilePage).toHaveURL(/\/global-info$/u);
    } finally {
        await context.close();
    }
});

test('global-info renders the ref nation summary columns beside the map', async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await go(page, 'global-info');

    const mapTitle = page.locator('.map-title');
    await expect(mapTitle).toHaveText(/200年 1月/u);
    const titleBackground = await page
        .locator('.map-top')
        .evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(titleBackground).toContain('ltitle.jpg');
    expect(titleBackground).toContain('rtitle.jpg');
    const titleTextBackground = await mapTitle.evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(titleTextBackground).toContain('ad.gif');
    expect(titleTextBackground).toContain('spring.gif');
    await mapTitle.hover();
    const titleTooltip = page.locator('.map-title-tooltip');
    await expect(titleTooltip).toBeVisible();
    await expect(titleTooltip).toContainText('기술등급 제한 : 5등급 (205년 해제)');
    const titleGeometry = await page.locator('.map-top').evaluate((element) => {
        const band = element.getBoundingClientRect();
        const title = element.querySelector('.map-title')?.getBoundingClientRect();
        const tooltip = element.querySelector('.map-title-tooltip')?.getBoundingClientRect();
        return {
            band: { width: band.width, height: band.height },
            title: title ? { width: title.width, height: title.height } : null,
            tooltip: tooltip ? { width: tooltip.width, height: tooltip.height } : null,
        };
    });
    expect(titleGeometry).toEqual({
        band: { width: 700, height: 20 },
        title: { width: 160, height: 20 },
        tooltip: { width: 220, height: 28 },
    });
    if (artifactRoot) {
        await mkdir(artifactRoot, { recursive: true });
        await page.screenshot({ path: resolve(artifactRoot, 'core-global-info-title-hover.png'), fullPage: true });
    }

    const hoveredCastle = page.locator('.city-base').first();
    await hoveredCastle.hover();
    const cityTooltip = page.locator('.map-tooltip');
    await expect(cityTooltip).toBeVisible();
    await expect(cityTooltip.locator('.tooltip-title')).toHaveText('【하북|특】업');
    await expect(cityTooltip.locator('.tooltip-body')).toHaveText('아국');
    const cityTooltipStyle = await cityTooltip.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
            width: rect.width,
            backgroundColor: style.backgroundColor,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
        };
    });
    expect(cityTooltipStyle.width).toBeGreaterThanOrEqual(120);
    expect(cityTooltipStyle).toMatchObject({
        backgroundColor: 'rgb(30, 164, 255)',
        fontSize: '14px',
        lineHeight: '15px',
    });
    if (artifactRoot) {
        await page.screenshot({ path: resolve(artifactRoot, 'core-global-info-city-hover.png'), fullPage: true });
    }

    await expect
        .poll(async () => {
            const [matrixWrapBox, matrixBox] = await Promise.all([
                page.locator('.matrix-wrap').boundingBox(),
                page.locator('.matrix').boundingBox(),
            ]);
            if (!matrixWrapBox || !matrixBox) return null;
            return Math.abs(matrixWrapBox.height - matrixBox.height);
        })
        .toBeLessThan(1);

    await expect
        .poll(() =>
            page
                .locator('.map-area .city-icon')
                .evaluateAll((images: HTMLImageElement[]) =>
                    images.every((image) => image.complete && image.naturalWidth > 0)
                )
        )
        .toBe(true);
    const castleGeometry = await page.locator('.map-area').evaluate((mapArea) => {
        const mapRect = mapArea.getBoundingClientRect();
        return Array.from(mapArea.querySelectorAll<HTMLImageElement>('.city-icon')).map((image) => {
            const iconRect = image.getBoundingClientRect();
            const cityBase = image.closest<HTMLElement>('.city-base');
            if (!cityBase) throw new Error('castle icon is missing its city coordinate cell');
            const baseRect = cityBase.getBoundingClientRect();
            return {
                src: new URL(image.src).pathname,
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
                width: iconRect.width,
                height: iconRect.height,
                iconCenterX: iconRect.left + iconRect.width / 2 - mapRect.left,
                iconCenterY: iconRect.top + iconRect.height / 2 - mapRect.top,
                cellCenterX: baseRect.left + baseRect.width / 2 - mapRect.left,
                cellCenterY: baseRect.top + baseRect.height / 2 - mapRect.top,
            };
        });
    });
    expect(castleGeometry).toEqual(
        castleFixtures.map(({ level, x, y, width, height }) => ({
            src: `/game/cast_${level}.gif`,
            naturalWidth: width,
            naturalHeight: height,
            width,
            height,
            iconCenterX: x,
            iconCenterY: y,
            cellCenterX: x,
            cellCenterY: y,
        }))
    );

    const summary = page.locator('.simple-nation-list');
    await expect(summary).toBeVisible();
    await expect(summary.locator('thead')).toContainText('국명');
    await expect(summary.locator('thead')).toContainText('국력');
    await expect(summary.locator('thead')).toContainText('장수');
    await expect(summary.locator('thead')).toContainText('속령');
    await expect(summary.locator('tbody tr').first()).toHaveText(/아국\s*1,234\s*2\s*1/u);
    await expect(summary.locator('tbody tr').first().locator('td').last()).toHaveAttribute('title', '업');
    await expect(summary.locator('tbody tr').first().locator('td').first().locator('span')).toHaveCSS(
        'color',
        'rgb(255, 255, 255)'
    );
    await expect(summary.locator('tbody tr').nth(1).locator('td').first().locator('span')).toHaveCSS(
        'color',
        'rgb(0, 0, 0)'
    );

    const geometry = await summary.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const headings = Array.from(element.querySelectorAll('th')).map(
            (heading) => heading.getBoundingClientRect().width
        );
        return { x: rect.x, width: rect.width, headings };
    });
    expect(geometry).toMatchObject({ x: 800, width: 300 });
    expect(geometry.headings[0]).toBeCloseTo((300 * 44) / 97, 0);
    expect(geometry.headings[1]).toBeCloseTo((300 * 23) / 97, 0);
    expect(geometry.headings[2]).toBeCloseTo((300 * 15) / 97, 0);
    expect(geometry.headings[3]).toBeCloseTo((300 * 15) / 97, 0);

    if (artifactRoot) {
        await mkdir(artifactRoot, { recursive: true });
        await writeFile(
            resolve(artifactRoot, 'core-global-info-computed-dom.json'),
            `${JSON.stringify(
                {
                    titleBackground,
                    titleTextBackground,
                    titleGeometry,
                    cityTooltipStyle,
                    geometry,
                    castleGeometry,
                    headings: await summary.locator('th').allTextContents(),
                    rows: await summary.locator('tbody tr').allTextContents(),
                    cityTitles: await summary
                        .locator('tbody td:last-child')
                        .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('title'))),
                },
                null,
                2
            )}\n`,
            'utf8'
        );
        await page.screenshot({ path: resolve(artifactRoot, 'core-global-info-desktop.png'), fullPage: true });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileCastleGeometry = await page.locator('.map-area').evaluate((mapArea) => {
        const mapRect = mapArea.getBoundingClientRect();
        return Array.from(mapArea.querySelectorAll<HTMLImageElement>('.city-icon')).map((image) => {
            const rect = image.getBoundingClientRect();
            return {
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
                width: rect.width,
                height: rect.height,
                centerX: rect.left + rect.width / 2 - mapRect.left,
                centerY: rect.top + rect.height / 2 - mapRect.top,
            };
        });
    });
    const smallScale = 5 / 7;
    for (const [index, rendered] of mobileCastleGeometry.entries()) {
        const { width, height, x, y } = castleFixtures[index]!;
        expect(rendered.naturalWidth).toBe(width);
        expect(rendered.naturalHeight).toBe(height);
        expect(rendered.width).toBeCloseTo(width * smallScale, 1);
        expect(rendered.height).toBeCloseTo(height * smallScale, 1);
        expect(rendered.centerX).toBeCloseTo(x * smallScale, 1);
        expect(rendered.centerY).toBeCloseTo(y * smallScale, 1);
    }
    const mobileGeometry = await page.locator('.map-grid').evaluate((element) => {
        const map = element.querySelector('.map-viewer')?.getBoundingClientRect();
        const summary = element.querySelector('.simple-nation-list')?.getBoundingClientRect();
        return {
            map: map ? { y: map.y, width: map.width, bottom: map.bottom } : null,
            summary: summary ? { y: summary.y, width: summary.width } : null,
        };
    });
    expect(mobileGeometry.map?.width).toBe(500);
    expect(mobileGeometry.summary?.width).toBe(500);
    expect(mobileGeometry.summary?.y).toBe(mobileGeometry.map?.bottom);
    await mapTitle.hover();
    await expect(titleTooltip).toBeVisible();
    const mobileTitleGeometry = await page.locator('.map-top').evaluate((element) => {
        const band = element.getBoundingClientRect();
        const tooltip = element.querySelector('.map-title-tooltip')?.getBoundingClientRect();
        return {
            band: { width: band.width, height: band.height },
            tooltip: tooltip ? { x: tooltip.x, width: tooltip.width } : null,
            documentWidth: document.documentElement.scrollWidth,
        };
    });
    expect(mobileTitleGeometry.band).toEqual({ width: 500, height: 20 });
    expect(mobileTitleGeometry.tooltip?.width).toBe(220);
    expect(mobileTitleGeometry.documentWidth).toBe(500);
    await hoveredCastle.hover();
    await expect(cityTooltip).toBeVisible();
    await expect(cityTooltip.locator('.tooltip-title')).toHaveText('【하북|특】업');
    if (artifactRoot) {
        await page.screenshot({
            path: resolve(artifactRoot, 'core-global-info-mobile-city-hover.png'),
            fullPage: true,
        });
        await page.screenshot({ path: resolve(artifactRoot, 'core-global-info-mobile.png'), fullPage: true });
    }
});

test('map title keeps the ref early-game restriction boundary and color', async ({ page }) => {
    await install(page, 'member', 100, 2, { ...map, startYear: 198 });
    await page.setViewportSize({ width: 1200, height: 900 });
    await go(page, 'global-info');

    const mapTitle = page.locator('.map-title');
    await expect(mapTitle).toHaveCSS('color', 'rgb(255, 255, 0)');
    await mapTitle.hover();
    await expect(page.locator('.map-title-tooltip')).toHaveText(
        '초반제한 기간 : 0년 12개월 (201년)기술등급 제한 : 1등급 (203년 해제)'
    );
});

test('global-info diplomacy height follows the active nation count', async ({ page }) => {
    await install(page, 'member', 100, 1);
    await go(page, 'global-info');

    const matrixWrap = page.locator('.matrix-wrap');
    const matrix = page.locator('.matrix');
    const mapSection = page.locator('.map-section');
    await expect(matrix.locator('tbody tr')).toHaveCount(1);

    for (const viewport of [
        { name: 'desktop', width: 1200, height: 900 },
        { name: 'mobile', width: 390, height: 844 },
    ]) {
        await page.setViewportSize(viewport);
        await expect
            .poll(async () => {
                const [wrapBox, matrixBox] = await Promise.all([matrixWrap.boundingBox(), matrix.boundingBox()]);
                if (!wrapBox || !matrixBox) return null;
                return Math.abs(wrapBox.height - matrixBox.height);
            })
            .toBeLessThan(1);

        const geometry = await page.evaluate(() => {
            const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
            const diplomacy = rect('.section');
            const matrix = rect('.matrix');
            const matrixWrap = rect('.matrix-wrap');
            const mapSection = rect('.map-section');
            return {
                diplomacyHeight: diplomacy?.height ?? null,
                matrixHeight: matrix?.height ?? null,
                matrixWrapHeight: matrixWrap?.height ?? null,
                gapToMap: matrixWrap && mapSection ? mapSection.top - matrixWrap.bottom : null,
            };
        });
        expect(geometry.matrixHeight).not.toBeNull();
        expect(geometry.matrixWrapHeight).toBeCloseTo(geometry.matrixHeight!, 0);
        expect(geometry.diplomacyHeight).toBeLessThan(200);
        expect(geometry.gapToMap).toBe(21);
        await expect(mapSection).toBeInViewport();

        if (artifactRoot) {
            await mkdir(artifactRoot, { recursive: true });
            await writeFile(
                resolve(artifactRoot, `core-global-info-one-nation-${viewport.name}.json`),
                `${JSON.stringify(geometry, null, 2)}\n`,
                'utf8'
            );
            await page.screenshot({
                path: resolve(artifactRoot, `core-global-info-one-nation-${viewport.name}.png`),
                fullPage: true,
            });
        }
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
    expect(legacyGeometry.stats).toEqual({ x: 100, y: 165.375, width: 1000, height: 106.9375 });
    expect(legacyGeometry.generals).toMatchObject({ x: 88, y: 290.3125, width: 1024 });
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

test('current-city wraps dense general names and only shrinks reserved turns', async ({ page }) => {
    await install(page, 'member', 100, 2, map, true);
    for (const viewport of [
        { name: 'desktop', width: 1200, height: 900 },
        { name: 'mobile', width: 500, height: 900 },
    ]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await go(page, 'current-city');

        const pageStyle = await page.locator('.city-page').evaluate((element) => {
            const style = getComputedStyle(element);
            return { fontFamily: style.fontFamily, fontSize: style.fontSize };
        });
        expect(pageStyle.fontFamily).toContain('Pretendard');
        expect(pageStyle.fontSize).toBe('14px');

        const controlFonts = await page
            .locator('.city-page')
            .evaluate(() =>
                ['#citySelector', '.back-link'].map(
                    (selector) => getComputedStyle(document.querySelector(selector)!).fontFamily
                )
            );
        expect(controlFonts).toHaveLength(2);
        for (const fontFamily of controlFonts) {
            expect(fontFamily).toContain('Pretendard');
        }

        const names = page.locator('.general-names');
        await expect(names).toHaveCSS('white-space', 'normal');
        const nameLineCount = await names.locator('span').evaluateAll((elements) => {
            const tops = elements.map((element) => Math.round(element.getBoundingClientRect().top));
            return new Set(tops).size;
        });
        expect(nameLineCount).toBeGreaterThan(1);

        const rows = page.locator('.generals tbody tr');
        const reservedTurns = rows.nth(0).locator('.turns');
        const npcTurns = rows.nth(1).locator('.turns');
        await expect(reservedTurns).toContainText('1 : 징병');
        await expect(reservedTurns).toContainText('2 : 훈련');
        await expect(reservedTurns).toHaveClass(/turns--reserved/);
        await expect(npcTurns).toHaveText('NPC 장수');
        await expect(npcTurns).not.toHaveClass(/turns--reserved/);

        const turnFontSizes = await Promise.all([
            reservedTurns.evaluate((element) => getComputedStyle(element).fontSize),
            npcTurns.evaluate((element) => getComputedStyle(element).fontSize),
        ]);
        expect(Number.parseFloat(turnFontSizes[0])).toBeLessThan(Number.parseFloat(pageStyle.fontSize));
        expect(turnFontSizes[1]).toBe(pageStyle.fontSize);

        const reservedLineTops = await reservedTurns
            .locator('.turn-line')
            .evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().top)));
        expect(new Set(reservedLineTops).size).toBe(2);

        if (artifactRoot) {
            await mkdir(artifactRoot, { recursive: true });
            await writeFile(
                resolve(artifactRoot, `core-current-city-dense-${viewport.name}.json`),
                `${JSON.stringify({ pageStyle, nameLineCount, turnFontSizes, reservedLineTops }, null, 2)}\n`,
                'utf8'
            );
            await page.screenshot({
                path: resolve(artifactRoot, `core-current-city-dense-${viewport.name}.png`),
                fullPage: true,
                animations: 'disabled',
            });
        }
    }
});

test('current-city renders a missing merchant rate with the legacy dash and percent text', async ({ page }) => {
    await install(page, 'member', null);
    await page.setViewportSize({ width: 1200, height: 900 });
    await go(page, 'current-city');

    const tradeValue = page
        .locator('.stats th')
        .filter({ hasText: /^시세$/ })
        .locator('xpath=following-sibling::td[1]');
    await expect(tradeValue).toHaveText('- %');
});

test('a Chromium map click opens the clicked city route and keeps the legacy pointer interaction', async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await go(page, '');
    const cityLink = page.locator('.city-base').first();
    await expect(cityLink).toBeVisible();
    await cityLink.hover();
    await expect(cityLink).toHaveCSS('cursor', 'pointer');
    await cityLink.click();
    await expect(page).toHaveURL(
        (url) => url.pathname === `${gameBasePath}/current-city` && url.searchParams.get('cityId') === '1'
    );
    await expect(page.locator('.stats')).toContainText('업');
});
