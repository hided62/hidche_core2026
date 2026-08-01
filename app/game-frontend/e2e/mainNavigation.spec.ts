import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

const response = (data: unknown) => ({ result: { data } });
const artifactRoot = process.env.MAIN_NAVIGATION_ARTIFACT_DIR;
const basePath = `/${(process.env.PLAYWRIGHT_GAME_BASE_PATH ?? 'che').replace(/^\/+|\/+$/g, '')}`;
const gameProfile = process.env.PLAYWRIGHT_GAME_PROFILE ?? 'che:default';
const operationNames = (route: Route) =>
    decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(',');

type NavigationFixture = {
    officerLevel: number;
    permission: number;
    nationLevel: number;
    stage: number;
    npcMode: number;
    generalMeCalls: number;
    operations: string[];
};

const emptyMessages = (permission: number) => ({
    private: [],
    national: [],
    public: [],
    diplomacy: [],
    permission,
    sequence: -1,
    hasMore: { private: false, national: false, public: false, diplomacy: false },
    latestRead: { private: 0, national: 0, public: 0, diplomacy: 0 },
    canRespondDiplomacy: false,
});

const generalContext = (state: NavigationFixture) => ({
    general: {
        id: 7,
        name: '메뉴검증장수',
        nationId: 1,
        cityId: 1,
        troopId: 0,
        npcState: 0,
        officerLevel: state.officerLevel,
        picture: null,
        imageServer: 0,
        stats: { leadership: 70, strength: 60, intelligence: 50 },
        gold: 1_000,
        rice: 2_000,
        crew: 300,
        train: 80,
        atmos: 90,
        injury: 0,
        experience: 100,
        dedication: 200,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    city: {
        id: 1,
        name: '업',
        level: 8,
        nationId: 1,
        region: 1,
        population: 100_000,
        populationMax: 200_000,
        agriculture: 1_000,
        agricultureMax: 2_000,
        commerce: 1_000,
        commerceMax: 2_000,
        security: 1_000,
        securityMax: 2_000,
        trust: 80,
        trade: 100,
        defence: 1_000,
        defenceMax: 2_000,
        wall: 1_000,
        wallMax: 2_000,
        supplyState: 1,
        frontState: 0,
    },
    nation: {
        id: 1,
        name: '위',
        color: '#008000',
        level: state.nationLevel,
        gold: 10_000,
        rice: 20_000,
        tech: 100,
        rate: 20,
        bill: 100,
        capitalCityId: 1,
        typeCode: 'che_유가',
    },
    settings: {},
    penalties: {},
});

const installFixture = async (page: Page, state: NavigationFixture) => {
    await page.addInitScript(
        ({ profile }) => {
            localStorage.setItem('sammo-game-token', 'ga_navigation');
            localStorage.setItem('sammo-game-profile', profile);
        },
        { profile: gameProfile }
    );

    await page.route('**/image/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from('') });
    });
    await page.route('**/events**', async (route) => {
        await route.abort();
    });
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const operations = operationNames(route);
        const results = operations.map((operation) =>
            operation === 'me'
                ? response({ id: 'user-7', username: 'menu-user', displayName: '메뉴 사용자' })
                : response({ ok: true })
        );
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(operations.length === 1 ? results[0] : results),
        });
    });
    await page.route(`**${basePath}/api/trpc/**`, async (route) => {
        const operations = operationNames(route);
        state.operations.push(...operations);
        const results = operations.map((operation) => {
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') {
                return response({ myGeneral: { id: 7, name: '메뉴검증장수' }, year: 185, month: 1, turnTerm: 10 });
            }
            if (operation === 'general.me') {
                state.generalMeCalls += 1;
                return response(generalContext(state));
            }
            if (operation === 'world.getState') {
                return response({
                    currentYear: 185,
                    currentMonth: 1,
                    tickSeconds: 600,
                    config: { npcMode: state.npcMode, const: {}, environment: {} },
                    meta: {},
                });
            }
            if (operation === 'world.getMapLayout') {
                return response({
                    mapName: 'che',
                    cityList: [{ id: 1, name: '업', level: 8, region: 1, x: 200, y: 120, path: [] }],
                    regionMap: { 1: '하북' },
                    levelMap: { 8: '특' },
                });
            }
            if (operation === 'world.getMap') {
                return response({
                    result: true,
                    version: 0,
                    startYear: 180,
                    year: 185,
                    month: 1,
                    cityList: [[1, 8, 0, 1, 1, 1]],
                    nationList: [[1, '위', '#008000', 1]],
                    spyList: {},
                    shownByGeneralList: [],
                    myCity: 1,
                    myNation: 1,
                });
            }
            if (operation === 'turns.getCommandTable') return response({ general: [], nation: [] });
            if (operation === 'turns.reserved.getGeneral' || operation === 'turns.reserved.getNation') {
                return response({ turns: [], revision: 0 });
            }
            if (operation === 'messages.getRecent') return response(emptyMessages(state.permission));
            if (operation === 'messages.getContacts') return response({ nation: [] });
            if (operation === 'general.getRecentRecords') {
                return response({
                    global: [{ id: 3, text: '장수 동향 기록' }],
                    general: [{ id: 2, text: '개인 기록' }],
                    history: [{ id: 1, text: '중원 정세 기록' }],
                });
            }
            if (operation === 'general.getFrontStatus') {
                return response({
                    onlineUserCount: 1,
                    onlineNations: '위(1)',
                    onlineGenerals: '메뉴검증장수',
                    nationNotice: '<p>국가 방침</p>',
                    lastExecuted: null,
                    latestVote: { id: 9, title: '메뉴 설문', hasVoted: false },
                });
            }
            if (operation === 'board.getAccess') {
                return response({
                    permission: state.permission,
                    canMeeting: state.officerLevel >= 1,
                    canSecret: state.permission >= 2,
                });
            }
            if (operation === 'tournament.getState') return response({ stage: state.stage });
            return response({ ok: true });
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(operations.length === 1 ? results[0] : results),
        });
    });
};

const waitForMain = async (page: Page) => {
    await page.goto('./');
    await expect(page.getByRole('heading', { name: '전장 현황' })).toBeVisible();
    await expect(page.locator('.main-global-menu').first()).toBeVisible();
    await expect(page.locator('.main-nation-menu')).toBeVisible();
    await expect(page.locator('[data-navigation-id="npc-list"]')).toHaveCount(3);
};

const gridColumnCount = async (page: Page, selector: string) =>
    page
        .locator(selector)
        .first()
        .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);

const persistArtifact = async (page: Page, name: string) => {
    if (!artifactRoot) return;
    const target = resolve(artifactRoot);
    await mkdir(target, { recursive: true });
    const geometry = await page.evaluate(() => {
        const describe = (selector: string) => {
            const element = document.querySelector<HTMLElement>(selector);
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                display: style.display,
                position: style.position,
                zIndex: style.zIndex,
                gridTemplateColumns: style.gridTemplateColumns,
                columnCount: style.columnCount,
                gap: style.gap,
                fontSize: style.fontSize,
                lineHeight: style.lineHeight,
                color: style.color,
                backgroundColor: style.backgroundColor,
                backgroundImage: style.backgroundImage,
                borderColor: style.borderColor,
                padding: style.padding,
                boxShadow: style.boxShadow,
                overflowY: style.overflowY,
                maxHeight: style.maxHeight,
                cursor: style.cursor,
                opacity: style.opacity,
                visibility: style.visibility,
            };
        };
        return {
            viewport: { width: innerWidth, height: innerHeight },
            global: describe('.main-global-menu'),
            nation: describe('.main-nation-menu'),
            bottom: describe('.main-mobile-bottom'),
            globalPopup: describe('#mobile-global-menu'),
            nationPopup: describe('#mobile-nation-menu'),
            quickPopup: describe('#mobile-quick-menu'),
        };
    });
    await Promise.all([
        page.screenshot({ path: resolve(target, `${name}.png`), fullPage: true }),
        writeFile(resolve(target, `${name}.json`), `${JSON.stringify(geometry, null, 2)}\n`),
    ]);
};

test('desktop menus preserve ref columns, prefix-safe routes, and controlled dropdown behavior', async ({ page }) => {
    const state: NavigationFixture = {
        officerLevel: 5,
        permission: 2,
        nationLevel: 3,
        stage: 1,
        npcMode: 1,
        generalMeCalls: 0,
        operations: [],
    };
    await installFixture(page, state);
    await page.setViewportSize({ width: 1200, height: 900 });
    await waitForMain(page);

    await expect(page.locator('.main-global-menu')).toHaveCount(3);
    expect(await gridColumnCount(page, '.main-global-menu')).toBe(8);
    expect(await gridColumnCount(page, '.main-nation-menu')).toBe(10);
    await expect(page.locator('.main-mobile-bottom')).toBeHidden();
    await expect(page.locator('.layout-desktop')).toBeVisible();
    await expect(page.locator('.layout-mobile')).toHaveCount(0);
    const contentOrder = await page
        .locator('.record-zone, [data-menu-position="middle"], .desktop-message-panel, [data-menu-position="bottom"]')
        .evaluateAll((elements) =>
            elements.map((element) => {
                if (element.classList.contains('record-zone')) return 'records';
                if (element.getAttribute('data-menu-position') === 'middle') return 'middle-menu';
                if (element.classList.contains('desktop-message-panel')) return 'messages';
                return 'bottom-menu';
            })
        );
    expect(contentOrder).toEqual(['records', 'middle-menu', 'messages', 'bottom-menu']);

    const global = page.locator('.main-global-menu').first();
    await expect(global.locator('[data-navigation-id="nation-betting"]')).toHaveAttribute(
        'href',
        `${basePath}/nation-betting`
    );
    await expect(global.locator('[data-navigation-id="nation-list"]')).toHaveAttribute(
        'href',
        `${basePath}/nation-list`
    );
    await expect(global.locator('[data-navigation-id="nation-list"]')).toHaveAttribute('target', '_blank');
    await expect(global.locator('[data-navigation-id="board-community"]')).toHaveAttribute('href', '/xe/community');
    await expect(global.locator('[data-navigation-id="official-chat"]')).toHaveAttribute('aria-disabled', 'true');
    await expect(global.locator('[data-navigation-id="survey"]')).toHaveClass(/highlight/);
    await expect(page.locator('.main-nation-menu [data-navigation-id="tournament"]')).toHaveClass(/highlight/);

    const gameInfoButton = global.locator('[data-menu-id="game-info"]');
    await gameInfoButton.focus();
    await gameInfoButton.press('Enter');
    await expect(gameInfoButton).toHaveAttribute('aria-expanded', 'true');
    await expect(global.locator('#global-menu-game-info')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(gameInfoButton).toHaveAttribute('aria-expanded', 'false');
    await expect(gameInfoButton).toBeFocused();

    await gameInfoButton.click();
    await page.getByRole('heading', { name: '전장 현황' }).click();
    await expect(gameInfoButton).toHaveAttribute('aria-expanded', 'false');
    await persistArtifact(page, `${basePath.slice(1)}-desktop-1200`);
});

test('the 939/940 boundary switches to the Ref-style 502px single document', async ({ page }) => {
    const state: NavigationFixture = {
        officerLevel: 5,
        permission: 2,
        nationLevel: 3,
        stage: 6,
        npcMode: 1,
        generalMeCalls: 0,
        operations: [],
    };
    await installFixture(page, state);
    await page.setViewportSize({ width: 940, height: 900 });
    await waitForMain(page);
    expect(await gridColumnCount(page, '.main-global-menu')).toBe(8);
    expect(await gridColumnCount(page, '.main-nation-menu')).toBe(10);
    await expect(page.locator('.main-mobile-bottom')).toBeHidden();
    await expect(page.locator('.layout-desktop')).toBeVisible();

    await page.setViewportSize({ width: 939, height: 900 });
    await expect(page.locator('.layout-mobile')).toBeVisible();
    expect(await gridColumnCount(page, '.main-global-menu')).toBe(4);
    expect(await gridColumnCount(page, '.main-nation-menu')).toBe(5);
    await expect(page.locator('.main-mobile-bottom')).toHaveCount(0);

    await page.setViewportSize({ width: 500, height: 900 });
    const documentGeometry = await page.locator('.main-page').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            x: rect.x,
            width: rect.width,
            height: rect.height,
            scrollWidth: document.documentElement.scrollWidth,
        };
    });
    expect(documentGeometry).toMatchObject({
        x: 0,
        width: 502,
        scrollWidth: 502,
    });
    expect(documentGeometry.height).toBeGreaterThan(900);
    for (const selector of [
        '[data-main-target="commands"]',
        '[data-main-target="general"]',
        '[data-main-target="map"]',
        '[data-main-target="world-history"]',
        '.mobile-message-panel',
    ]) {
        await expect(page.locator(selector)).toBeVisible();
    }
    await persistArtifact(page, `${basePath.slice(1)}-mobile-500`);
});

test('nation menu presentation follows the server-derived permission matrix', async ({ page }) => {
    const state: NavigationFixture = {
        officerLevel: 1,
        permission: 0,
        nationLevel: 1,
        stage: 0,
        npcMode: 1,
        generalMeCalls: 0,
        operations: [],
    };
    await installFixture(page, state);
    await page.setViewportSize({ width: 1200, height: 900 });
    await waitForMain(page);
    const nationMenu = page.locator('.main-nation-menu');

    await expect(nationMenu.locator('[data-navigation-id="meeting"]')).toHaveAttribute('href', `${basePath}/board`);
    await expect(nationMenu.locator('[data-navigation-id="secret-board"]')).toHaveAttribute('aria-disabled', 'true');
    await expect(nationMenu.locator('[data-navigation-id="diplomacy"]')).toHaveAttribute('aria-disabled', 'true');
    await expect(nationMenu.locator('[data-navigation-id="nation-info"]')).toHaveAttribute(
        'href',
        `${basePath}/nation/info`
    );

    state.officerLevel = 2;
    const callsBeforeRefresh = state.generalMeCalls;
    await page.getByRole('button', { name: '갱 신' }).click();
    await expect.poll(() => state.generalMeCalls).toBeGreaterThan(callsBeforeRefresh);
    await expect(nationMenu.locator('[data-navigation-id="diplomacy"]')).toHaveAttribute(
        'href',
        `${basePath}/diplomacy`
    );
    await expect(nationMenu.locator('[data-navigation-id="nation-secret"]')).toHaveAttribute(
        'href',
        `${basePath}/nation/secret`
    );
});

test('mobile single document refreshes once and preserves tokens on lobby return', async ({ page }) => {
    const state: NavigationFixture = {
        officerLevel: 5,
        permission: 2,
        nationLevel: 3,
        stage: 0,
        npcMode: 1,
        generalMeCalls: 0,
        operations: [],
    };
    await installFixture(page, state);
    await page.setViewportSize({ width: 500, height: 900 });
    await waitForMain(page);

    for (const selector of [
        '[data-main-target="policy"]',
        '[data-main-target="commands"]',
        '[data-main-target="nation"]',
        '[data-main-target="general"]',
        '[data-main-target="city"]',
        '[data-main-target="map"]',
        '[data-main-target="global-records"]',
        '[data-main-target="general-records"]',
        '[data-main-target="world-history"]',
        '[data-message-type="public"]',
        '[data-message-type="national"]',
        '[data-message-type="private"]',
        '[data-message-type="diplomacy"]',
    ]) {
        await expect(page.locator(selector)).toBeVisible();
    }

    const callsBeforeRefresh = state.generalMeCalls;
    await page.getByRole('button', { name: '갱 신' }).click();
    await expect.poll(() => state.generalMeCalls).toBeGreaterThan(callsBeforeRefresh);

    await page.evaluate(() => {
        localStorage.setItem('sammo-session-token', 'session_navigation');
    });
    await page.route('**/gateway/', async (route) => {
        await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>gateway</title>' });
    });
    await Promise.all([page.waitForURL('**/gateway/'), page.getByRole('button', { name: '로비로' }).click()]);
    expect(
        await page.evaluate(() => ({
            session: localStorage.getItem('sammo-session-token'),
            game: localStorage.getItem('sammo-game-token'),
            profile: localStorage.getItem('sammo-game-profile'),
        }))
    ).toEqual({
        session: 'session_navigation',
        game: 'ga_navigation',
        profile: gameProfile,
    });
    expect(state.operations).not.toContain('auth.logout');
});
