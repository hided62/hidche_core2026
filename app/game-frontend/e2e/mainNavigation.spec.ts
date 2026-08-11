import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

const response = (data: unknown) => ({ result: { data } });
const artifactRoot = process.env.MAIN_NAVIGATION_ARTIFACT_DIR;
const autoRefreshArtifactRoot = process.env.AUTO_REFRESH_ARTIFACT_DIR;
const productionBundle = process.env.PLAYWRIGHT_FRONTEND_MODE === 'production';
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
    generalName?: string;
    refreshDelayMs?: number;
    largeCommandTable?: boolean;
    dashboardResponses?: Array<{
        bytes: number;
        contextKind: string | null;
        commandTableKind: string | null;
        boardAccessKind: string | null;
    }>;
};

type DashboardBundleInput = {
    include?: { context?: boolean; commandTable?: boolean; boardAccess?: boolean };
    known?: { context?: string; commandTable?: string; boardAccess?: string };
    forceSnapshot?: boolean;
};

const operationInput = (route: Route, index: number): DashboardBundleInput => {
    const input = new URL(route.request().url()).searchParams.get('input');
    if (!input) return {};
    const parsed = JSON.parse(input) as Record<string, unknown>;
    const entry = (parsed[String(index)] ?? parsed) as { json?: DashboardBundleInput };
    return entry.json ?? (entry as DashboardBundleInput);
};

const commandTableFixture = (large: boolean) => ({
    general: large
        ? [
              {
                  category: '일반',
                  values: Array.from({ length: 48 }, (_, index) => ({
                      key: `command-${index}`,
                      name: `명령 ${index}`,
                      reqArg: index % 2 === 0,
                      possible: true,
                      status: 'available',
                      inputFields: [
                          {
                              key: 'amount',
                              label: '수량',
                              kind: 'number',
                              required: true,
                              min: 1,
                              max: 10_000,
                          },
                      ],
                  })),
              },
          ]
        : [],
    nation: [],
    inputOptions: {
        cities: Array.from({ length: 20 }, (_, index) => ({ value: index + 1, label: `도시 ${index + 1}` })),
        nations: [],
        generals: [],
        crewTypes: [],
        armTypes: [],
        nationTypes: [],
        colors: [],
        items: {},
    },
});

const CONTEXT_INITIAL_REVISION = 'AAAAAAAAAAAAAAAAAAAAAA';
const COMMAND_TABLE_REVISION = 'CCCCCCCCCCCCCCCCCCCCCC';
const BOARD_ACCESS_REVISION = 'DDDDDDDDDDDDDDDDDDDDDD';

const contextRevision = (state: NavigationFixture) => {
    const name = state.generalName ?? '메뉴검증장수';
    if (name === '메뉴검증장수') return CONTEXT_INITIAL_REVISION;
    if (name === '부드럽게갱신된장수') return 'EEEEEEEEEEEEEEEEEEEEEE';
    if (name === '탭공유갱신장수') return 'FFFFFFFFFFFFFFFFFFFFFF';
    if (name === '리더만갱신장수') return 'GGGGGGGGGGGGGGGGGGGGGG';
    return 'HHHHHHHHHHHHHHHHHHHHHH';
};

const deltaSlice = <T>(value: T, revision: string, known: string | undefined, forceSnapshot: boolean) => {
    if (forceSnapshot || !known) return { kind: 'snapshot' as const, revision, data: value };
    if (known === revision) return { kind: 'unchanged' as const, revision };
    return {
        kind: 'patch' as const,
        baseRevision: known,
        revision,
        operations: [
            {
                op: 'replace' as const,
                path: '/general/name',
                value: (value as ReturnType<typeof generalContext>).general.name,
            },
        ],
    };
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
        name: state.generalName ?? '메뉴검증장수',
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
        progression: {
            experienceLevel: 1,
            dedicationLevel: 2,
            statExperience: { leadership: 5, strength: 10, intelligence: 15 },
            statUpgradeLimit: 20,
            dex: [350, 100_000, 500_000, 1_000_000, 1_275_975],
        },
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
        if (
            operations.some((operation) => ['general.me', 'dashboard.getContextBundleDelta'].includes(operation)) &&
            state.generalMeCalls > 0 &&
            state.refreshDelayMs
        ) {
            await new Promise((resolve) => setTimeout(resolve, state.refreshDelayMs));
        }
        const results = operations.map((operation, index) => {
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') {
                return response({ myGeneral: { id: 7, name: '메뉴검증장수' }, year: 185, month: 1, turnTerm: 10 });
            }
            if (operation === 'dashboard.getContextBundleDelta') {
                state.generalMeCalls += 1;
                const input = operationInput(route, index);
                const include = input.include ?? {};
                const forceSnapshot = input.forceSnapshot === true;
                const revision = contextRevision(state);
                const context = include.context
                    ? deltaSlice(generalContext(state), revision, input.known?.context, forceSnapshot)
                    : undefined;
                const commandTable = include.commandTable
                    ? forceSnapshot || !input.known?.commandTable
                        ? {
                              kind: 'snapshot' as const,
                              revision: COMMAND_TABLE_REVISION,
                              data: commandTableFixture(state.largeCommandTable === true),
                          }
                        : { kind: 'unchanged' as const, revision: COMMAND_TABLE_REVISION }
                    : undefined;
                const boardAccess = include.boardAccess
                    ? forceSnapshot || !input.known?.boardAccess
                        ? {
                              kind: 'snapshot' as const,
                              revision: BOARD_ACCESS_REVISION,
                              data: {
                                  permission: state.permission,
                                  canMeeting: state.officerLevel >= 1,
                                  canSecret: state.permission >= 2,
                              },
                          }
                        : { kind: 'unchanged' as const, revision: BOARD_ACCESS_REVISION }
                    : undefined;
                return response({ context, commandTable, boardAccess });
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
        operations.forEach((operation, index) => {
            if (operation !== 'dashboard.getContextBundleDelta') return;
            const item = results[index];
            if (!item) return;
            const data = item.result.data as {
                context?: { kind: string };
                commandTable?: { kind: string };
                boardAccess?: { kind: string };
            };
            (state.dashboardResponses ??= []).push({
                bytes: Buffer.byteLength(JSON.stringify(item)),
                contextKind: data.context?.kind ?? null,
                commandTableKind: data.commandTable?.kind ?? null,
                boardAccessKind: data.boardAccess?.kind ?? null,
            });
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(operations.length === 1 ? results[0] : results),
        });
    });
};

const installRealtimeHarness = async (page: Page) => {
    await page.addInitScript(() => {
        class TestEventSource extends EventTarget {
            static latest: TestEventSource | null = null;
            static created = 0;
            static closed = 0;
            readonly url: string;

            constructor(url: string | URL) {
                super();
                this.url = url.toString();
                TestEventSource.created += 1;
                TestEventSource.latest = this;
                queueMicrotask(() => this.dispatchEvent(new Event('open')));
            }

            close() {
                if (TestEventSource.latest === this) {
                    TestEventSource.latest = null;
                    TestEventSource.closed += 1;
                }
            }
        }

        Object.defineProperty(window, 'EventSource', { configurable: true, value: TestEventSource });
        Object.defineProperty(window, '__emitMainRealtime', {
            configurable: true,
            value: (type: string, payload: unknown) => {
                TestEventSource.latest?.dispatchEvent(
                    new MessageEvent(type, { data: JSON.stringify({ type, ...((payload as object) ?? {}) }) })
                );
            },
        });
        Object.defineProperty(window, '__hasMainRealtime', {
            configurable: true,
            value: () => TestEventSource.latest !== null,
        });
        Object.defineProperty(window, '__mainRealtimeStats', {
            configurable: true,
            value: () => ({
                active: TestEventSource.latest !== null,
                created: TestEventSource.created,
                closed: TestEventSource.closed,
            }),
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

test('main city and general cards render every ref bar plus dual dexterity progress at ref heights', async ({
    page,
}) => {
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

    const cityBars = page.locator('[data-main-target="city"] [role="progressbar"]');
    const statBars = page.locator('[data-stat-progress] [role="progressbar"]');
    const experienceBar = page.locator('[data-experience-progress] [role="progressbar"]');
    const dexRows = page.locator('[data-dex-progress]');
    await expect(cityBars).toHaveCount(8);
    await expect(statBars).toHaveCount(3);
    await expect(experienceBar).toHaveCount(1);
    await expect(dexRows).toHaveCount(5);
    await expect(dexRows.locator('[role="progressbar"]')).toHaveCount(10);

    expect(await cityBars.first().evaluate((element) => element.getBoundingClientRect().height)).toBe(9);
    expect(await statBars.first().evaluate((element) => element.getBoundingClientRect().height)).toBe(12);
    expect(await experienceBar.evaluate((element) => element.getBoundingClientRect().height)).toBe(12);
    const firstDexBars = dexRows.first().locator('[role="progressbar"]');
    expect(await firstDexBars.nth(0).evaluate((element) => element.getBoundingClientRect().height)).toBe(12);
    expect(await firstDexBars.nth(1).evaluate((element) => element.getBoundingClientRect().height)).toBe(9);

    await expect(dexRows.nth(3).locator('[role="progressbar"]').nth(0)).toHaveAttribute('aria-valuemax', '100');
    await expect(dexRows.nth(3).locator('[role="progressbar"]').nth(0)).toHaveAttribute(
        'aria-label',
        /1,000,000 \/ 1,275,975 \(EX\+\)/
    );
    await expect(dexRows.nth(3).locator('[role="progressbar"]').nth(1)).toHaveAttribute('aria-label', /까지 .* 남음/);
    await expect(dexRows.nth(4).locator('[role="progressbar"]').nth(1)).toHaveAttribute('aria-label', /EX\+ 달성/);

    const texture = await cityBars.first().evaluate((element) => getComputedStyle(element).backgroundImage);
    const fillTexture = await cityBars
        .first()
        .locator('.legacy-progress__fill')
        .evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(texture).toContain('/game/pr5.gif');
    expect(fillTexture).toContain('/game/pb5.gif');

    const captureProgress = async (name: string) => {
        if (!artifactRoot) return;
        await mkdir(artifactRoot, { recursive: true });
        const measurement = await page.locator('.legacy-progress').evaluateAll((elements) =>
            elements.map((element) => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                const fill = element.querySelector<HTMLElement>('.legacy-progress__fill');
                return {
                    label: element.getAttribute('aria-label'),
                    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                    borderTop: style.borderTop,
                    borderBottom: style.borderBottom,
                    backgroundImage: style.backgroundImage,
                    fillWidth: fill?.getBoundingClientRect().width ?? 0,
                    fillBackgroundImage: fill ? getComputedStyle(fill).backgroundImage : '',
                };
            })
        );
        await Promise.all([
            page.screenshot({ path: resolve(artifactRoot, `progress-bars-${name}.png`), fullPage: true }),
            writeFile(resolve(artifactRoot, `progress-bars-${name}.json`), `${JSON.stringify(measurement, null, 2)}\n`),
        ]);
    };
    await captureProgress('desktop-1200');

    await page.setViewportSize({ width: 500, height: 900 });
    await expect(page.locator('.layout-mobile')).toBeVisible();
    await expect(page.locator('[data-main-target="city"] [role="progressbar"]')).toHaveCount(8);
    await expect(page.locator('[data-main-target="general"] [role="progressbar"]')).toHaveCount(14);
    expect(
        await page
            .locator('[data-main-target="city"] [role="progressbar"]')
            .first()
            .evaluate((element) => element.getBoundingClientRect().height)
    ).toBe(9);
    await captureProgress('mobile-500');
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

test('realtime read-model events skip clock-only work, merge bursts, patch in place, and stop off-route', async ({
    page,
}) => {
    const state: NavigationFixture = {
        officerLevel: 5,
        permission: 2,
        nationLevel: 3,
        stage: 0,
        npcMode: 1,
        generalMeCalls: 0,
        operations: [],
        refreshDelayMs: 300,
        largeCommandTable: true,
    };
    await installRealtimeHarness(page);
    await installFixture(page, state);
    await page.setViewportSize({ width: 1200, height: 900 });
    await waitForMain(page);
    await expect(page.locator('.general-title')).toContainText('메뉴검증장수');

    await page.evaluate(() => {
        const general = document.querySelector('[data-main-target="general"]');
        const city = document.querySelector('[data-main-target="city"]');
        if (!general || !city) throw new Error('refresh probe targets missing');
        const probe = {
            general,
            city,
            generalMutations: 0,
            cityMutations: 0,
            vueMeasures: [] as string[],
        };
        new MutationObserver((records) => (probe.generalMutations += records.length)).observe(general, {
            childList: true,
            subtree: true,
            characterData: true,
        });
        new MutationObserver((records) => (probe.cityMutations += records.length)).observe(city, {
            childList: true,
            subtree: true,
            characterData: true,
        });
        Object.defineProperty(window, '__mainRefreshProbe', { configurable: true, value: probe });
        performance.clearMarks();
        performance.clearMeasures();
        new PerformanceObserver((entries) => {
            probe.vueMeasures.push(...entries.getEntries().map((entry) => entry.name));
        }).observe({ entryTypes: ['measure'] });
    });

    const callsBeforeRefresh = state.generalMeCalls;
    const operationsBeforeClockOnly = state.operations.length;
    await page.evaluate(() => {
        (window as unknown as { __emitMainRealtime: (type: string, payload: unknown) => void }).__emitMainRealtime(
            'turnCompleted',
            {
                at: new Date().toISOString(),
                lastTurnTime: '0185-02-01T00:00:00.000Z',
                changes: {
                    generalIds: [],
                    cityIds: [],
                    nationIds: [],
                    reservedGeneralIds: [],
                    recordGeneralIds: [],
                    worldChanged: false,
                    globalRecordsChanged: false,
                    worldHistoryChanged: false,
                    contactsChanged: false,
                },
            }
        );
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(state.operations.slice(operationsBeforeClockOnly)).toEqual([]);

    const operationsBeforeChangedBurst = state.operations.length;
    state.generalName = '부드럽게갱신된장수';
    await page.evaluate(() => {
        const emit = (window as unknown as { __emitMainRealtime: (type: string, payload: unknown) => void })
            .__emitMainRealtime;
        for (let index = 0; index < 100; index += 1) {
            emit('turnCompleted', {
                at: new Date().toISOString(),
                lastTurnTime: '0185-02-01T00:00:00.000Z',
                changes: {
                    generalIds: [7],
                    cityIds: [],
                    nationIds: [],
                    mapGeneralIds: [],
                    mapCityIds: [],
                    mapNationIds: [],
                    frontStatusGeneralIds: [],
                    frontStatusNationIds: [],
                    frontStatusActorIds: [],
                    frontStatusChanged: false,
                    lobbyGeneralIds: [],
                    lobbyChanged: false,
                    reservedGeneralIds: [],
                    recordGeneralIds: [],
                    worldChanged: false,
                    globalRecordsChanged: false,
                    worldHistoryChanged: false,
                    contactsChanged: false,
                },
            });
        }
    });

    await expect.poll(() => state.generalMeCalls, { timeout: 3_000 }).toBe(callsBeforeRefresh + 1);
    await expect(page.locator('[data-main-target="general"] .skeleton-line')).toHaveCount(0);
    await expect(page.locator('[data-main-target="city"] .skeleton-line')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '갱 신' })).toHaveAttribute('aria-busy', 'false');
    expect(state.generalMeCalls).toBe(callsBeforeRefresh + 1);
    await expect(page.locator('.general-title')).toContainText('부드럽게갱신된장수');
    const changedOperations = state.operations.slice(operationsBeforeChangedBurst);
    expect(changedOperations).toEqual(['dashboard.getContextBundleDelta']);
    expect(changedOperations).not.toEqual(
        expect.arrayContaining([
            'general.me',
            'turns.getCommandTable',
            'board.getAccess',
            'lobby.info',
            'world.getMap',
            'messages.getRecent',
            'messages.getContacts',
            'general.getRecentRecords',
            'general.getFrontStatus',
            'turns.reserved.getGeneral',
        ])
    );
    const initialBundle = state.dashboardResponses?.find(
        (entry) => entry.contextKind === 'snapshot' && entry.commandTableKind === 'snapshot'
    );
    const realtimeBundle = state.dashboardResponses?.find(
        (entry) => entry.contextKind === 'patch' && entry.commandTableKind === 'unchanged'
    );
    expect(initialBundle?.bytes).toBeGreaterThan(5_000);
    expect(realtimeBundle).toMatchObject({
        contextKind: 'patch',
        commandTableKind: 'unchanged',
        boardAccessKind: 'unchanged',
    });
    expect(realtimeBundle?.bytes).toBeLessThan(1_000);

    const operationsBeforeSurvey = state.operations.length;
    await page.evaluate(() => {
        (window as unknown as { __emitMainRealtime: (type: string, payload: unknown) => void }).__emitMainRealtime(
            'readModelChanged',
            {
                at: new Date().toISOString(),
                revision: 42,
                changes: {
                    generalIds: [],
                    cityIds: [],
                    nationIds: [],
                    mapGeneralIds: [],
                    mapCityIds: [],
                    mapNationIds: [],
                    frontStatusGeneralIds: [],
                    frontStatusNationIds: [],
                    frontStatusActorIds: [],
                    frontStatusChanged: true,
                    lobbyGeneralIds: [],
                    lobbyChanged: false,
                    reservedGeneralIds: [],
                    recordGeneralIds: [],
                    worldChanged: false,
                    globalRecordsChanged: false,
                    worldHistoryChanged: false,
                    contactsChanged: false,
                },
            }
        );
    });
    await expect
        .poll(() => state.operations.slice(operationsBeforeSurvey), { timeout: 3_000 })
        .toEqual(['general.getFrontStatus']);

    const profile = await page.evaluate(() => {
        const probe = (
            window as unknown as {
                __mainRefreshProbe: {
                    general: Element;
                    city: Element;
                    generalMutations: number;
                    cityMutations: number;
                    vueMeasures: string[];
                };
            }
        ).__mainRefreshProbe;
        return {
            generalMounted: probe.general === document.querySelector('[data-main-target="general"]'),
            cityMounted: probe.city === document.querySelector('[data-main-target="city"]'),
            generalMutations: probe.generalMutations,
            cityMutations: probe.cityMutations,
            vueMeasures: probe.vueMeasures.filter((name) => /render|patch/u.test(name)),
        };
    });
    expect(profile.generalMounted).toBe(true);
    expect(profile.cityMounted).toBe(true);
    expect(profile.generalMutations).toBeGreaterThan(0);
    expect(profile.cityMutations).toBe(0);
    if (!productionBundle) {
        expect(profile.vueMeasures.some((name) => name.includes('GeneralBasicCard'))).toBe(true);
        expect(profile.vueMeasures.some((name) => name.includes('CityBasicCard'))).toBe(false);
    }
    if (autoRefreshArtifactRoot) {
        await Promise.all([
            page.screenshot({ path: resolve(autoRefreshArtifactRoot, 'auto-refresh-complete.png'), fullPage: true }),
            writeFile(
                resolve(autoRefreshArtifactRoot, 'profile.json'),
                `${JSON.stringify(
                    {
                        emittedTurnEvents: 100,
                        selectiveGeneralRefreshes: state.generalMeCalls - callsBeforeRefresh,
                        responseBytes: {
                            initialSnapshot: initialBundle?.bytes ?? null,
                            realtimeDelta: realtimeBundle?.bytes ?? null,
                            reductionPercent:
                                initialBundle && realtimeBundle
                                    ? Number(((1 - realtimeBundle.bytes / initialBundle.bytes) * 100).toFixed(2))
                                    : null,
                        },
                        responseKinds: realtimeBundle ?? null,
                        inFlightSkeletons: { general: 0, city: 0 },
                        ...profile,
                    },
                    null,
                    2
                )}\n`
            ),
        ]);
    }

    await page.locator(`a[href="${basePath}/board"]`).first().click();
    await page.waitForURL(`**${basePath}/board`);
    expect(
        await page.evaluate(() => (window as unknown as { __hasMainRealtime: () => boolean }).__hasMainRealtime())
    ).toBe(false);
    const callsAfterLeavingMain = state.generalMeCalls;
    await page.evaluate(() => {
        (window as unknown as { __emitMainRealtime: (type: string, payload: unknown) => void }).__emitMainRealtime(
            'turnCompleted',
            {
                at: new Date().toISOString(),
                lastTurnTime: '0185-02-01T00:00:00.000Z',
                changes: {
                    generalIds: [7],
                    cityIds: [],
                    nationIds: [],
                    mapGeneralIds: [],
                    mapCityIds: [],
                    mapNationIds: [],
                    frontStatusGeneralIds: [],
                    frontStatusNationIds: [],
                    frontStatusActorIds: [],
                    frontStatusChanged: false,
                    lobbyGeneralIds: [],
                    lobbyChanged: false,
                    reservedGeneralIds: [],
                    recordGeneralIds: [],
                    worldChanged: false,
                    globalRecordsChanged: false,
                    worldHistoryChanged: false,
                    contactsChanged: false,
                },
            }
        );
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(state.generalMeCalls).toBe(callsAfterLeavingMain);
});

test('same-account main tabs share one realtime diff and exclude a tab while sync is off', async ({
    context,
    page,
}) => {
    const state: NavigationFixture = {
        officerLevel: 5,
        permission: 2,
        nationLevel: 3,
        stage: 0,
        npcMode: 1,
        generalMeCalls: 0,
        operations: [],
    };
    const secondPage = await context.newPage();
    const pages = [page, secondPage];
    for (const currentPage of pages) {
        await currentPage.addInitScript(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        });
        await installRealtimeHarness(currentPage);
        await installFixture(currentPage, state);
        await currentPage.setViewportSize({ width: 1200, height: 900 });
    }

    await Promise.all(pages.map((currentPage) => waitForMain(currentPage)));
    await expect
        .poll(async () => {
            const stats = await Promise.all(
                pages.map((currentPage) =>
                    currentPage.evaluate(() =>
                        (
                            window as unknown as {
                                __mainRealtimeStats: () => { active: boolean; created: number; closed: number };
                            }
                        ).__mainRealtimeStats()
                    )
                )
            );
            return stats.filter((entry) => entry.active).length;
        })
        .toBe(1);

    const activeFlags = await Promise.all(
        pages.map((currentPage) =>
            currentPage.evaluate(() => (window as unknown as { __hasMainRealtime: () => boolean }).__hasMainRealtime())
        )
    );
    const leaderIndex = activeFlags.findIndex(Boolean);
    const followerIndex = leaderIndex === 0 ? 1 : 0;
    const leaderPage = pages[leaderIndex];
    const followerPage = pages[followerIndex];
    if (!leaderPage || !followerPage) throw new Error('realtime leader election failed');

    const callsBeforeSharedRefresh = state.generalMeCalls;
    state.generalName = '탭공유갱신장수';
    await leaderPage.evaluate(() => {
        (window as unknown as { __emitMainRealtime: (type: string, payload: unknown) => void }).__emitMainRealtime(
            'readModelChanged',
            {
                at: new Date().toISOString(),
                revision: 100,
                changes: {
                    generalIds: [7],
                    cityIds: [],
                    nationIds: [],
                    mapGeneralIds: [],
                    mapCityIds: [],
                    mapNationIds: [],
                    frontStatusGeneralIds: [],
                    frontStatusNationIds: [],
                    frontStatusActorIds: [],
                    frontStatusChanged: false,
                    lobbyGeneralIds: [],
                    lobbyChanged: false,
                    reservedGeneralIds: [],
                    recordGeneralIds: [],
                    worldChanged: false,
                    globalRecordsChanged: false,
                    worldHistoryChanged: false,
                    contactsChanged: false,
                },
            }
        );
    });
    await expect.poll(() => state.generalMeCalls).toBe(callsBeforeSharedRefresh + 1);
    await Promise.all(
        pages.map((currentPage) => expect(currentPage.locator('.general-title')).toContainText('탭공유갱신장수'))
    );

    await followerPage.getByRole('button', { name: /실시간 동기화/u }).click();
    await expect(followerPage.getByRole('button', { name: /실시간 동기화: 끔/u })).toBeVisible();
    const callsBeforeExcludedRefresh = state.generalMeCalls;
    state.generalName = '리더만갱신장수';
    await leaderPage.evaluate(() => {
        (window as unknown as { __emitMainRealtime: (type: string, payload: unknown) => void }).__emitMainRealtime(
            'readModelChanged',
            {
                at: new Date().toISOString(),
                revision: 101,
                changes: {
                    generalIds: [7],
                    cityIds: [],
                    nationIds: [],
                    mapGeneralIds: [],
                    mapCityIds: [],
                    mapNationIds: [],
                    frontStatusGeneralIds: [],
                    frontStatusNationIds: [],
                    frontStatusActorIds: [],
                    frontStatusChanged: false,
                    lobbyGeneralIds: [],
                    lobbyChanged: false,
                    reservedGeneralIds: [],
                    recordGeneralIds: [],
                    worldChanged: false,
                    globalRecordsChanged: false,
                    worldHistoryChanged: false,
                    contactsChanged: false,
                },
            }
        );
    });
    await expect.poll(() => state.generalMeCalls).toBe(callsBeforeExcludedRefresh + 1);
    await expect(leaderPage.locator('.general-title')).toContainText('리더만갱신장수');
    await expect(followerPage.locator('.general-title')).toContainText('탭공유갱신장수');

    await followerPage.getByRole('button', { name: /실시간 동기화: 끔/u }).click();
    await expect(followerPage.locator('.general-title')).toContainText('리더만갱신장수');
    await expect
        .poll(async () => {
            const flags = await Promise.all(
                pages.map((currentPage) =>
                    currentPage.evaluate(() =>
                        (window as unknown as { __hasMainRealtime: () => boolean }).__hasMainRealtime()
                    )
                )
            );
            return flags.filter(Boolean).length;
        })
        .toBe(1);
});
