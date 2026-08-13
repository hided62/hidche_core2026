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
    generalTurnTime?: string;
    cityDefence?: number;
    cityState?: number;
    nationRate?: number;
    contextRevision?: string;
    contextOperations?: JsonPatchOperation[];
    commandTableRevision?: string;
    commandTableOperations?: JsonPatchOperation[];
    commandBlockedCount?: number;
    forceSnapshotCalls?: number;
    refreshDelayMs?: number;
    largeCommandTable?: boolean;
    currentYear?: number;
    currentMonth?: number;
    globalRecords?: Array<{ id: number; text: string }>;
    generalRecords?: Array<{ id: number; text: string }>;
    worldHistory?: Array<{ id: number; text: string }>;
    reservedTurns?: Array<{ index: number; action: string; args: Record<string, unknown> }>;
    messages?: unknown;
    messageContacts?: unknown;
    autorunLimit?: number | null;
    dashboardResponses?: Array<{
        bytes: number;
        contextKind: string | null;
        commandTableKind: string | null;
        boardAccessKind: string | null;
    }>;
};

type JsonPatchOperation = {
    op: 'add' | 'remove' | 'replace';
    path: string;
    value?: unknown;
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

const readModelInvalidation = (
    overrides: Partial<{
        context: boolean;
        lobby: boolean;
        map: boolean;
        commands: boolean;
        contacts: boolean;
        boardAccess: boolean;
        reservedTurns: boolean;
        records: boolean;
        frontStatus: boolean;
    }>
) => ({
    context: false,
    lobby: false,
    map: false,
    commands: false,
    contacts: false,
    boardAccess: false,
    reservedTurns: false,
    records: false,
    frontStatus: false,
    ...overrides,
});

const emitReadModelInvalidation = (page: Page, invalidation: ReturnType<typeof readModelInvalidation>) =>
    page.evaluate((payload) => {
        (window as unknown as { __emitMainRealtime: (type: string, value: unknown) => void }).__emitMainRealtime(
            'readModelInvalidated',
            {
                invalidation: payload,
            }
        );
    }, invalidation);

const commandTableFixture = (large: boolean, blockedCount = 0) => ({
    general: large
        ? ['내정', '군사', '계략'].map((category, categoryIndex) => ({
              category,
              values: Array.from({ length: 16 }, (_, localIndex) => {
                  const index = categoryIndex * 16 + localIndex;
                  return {
                      key: `command-${index}`,
                      name: index === 0 ? '주민 선정과 장기 도시 개발' : `명령 ${index}`,
                      reqArg: index % 2 === 0,
                      possible: index >= blockedCount,
                      status: index >= blockedCount ? 'available' : 'blocked',
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
                  };
              }),
          }))
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
    if (state.contextRevision) return state.contextRevision;
    const name = state.generalName ?? '메뉴검증장수';
    if (name === '메뉴검증장수') return CONTEXT_INITIAL_REVISION;
    if (name === '부드럽게갱신된장수') return 'EEEEEEEEEEEEEEEEEEEEEE';
    if (name === '탭공유갱신장수') return 'FFFFFFFFFFFFFFFFFFFFFF';
    if (name === '리더만갱신장수') return 'GGGGGGGGGGGGGGGGGGGGGG';
    return 'HHHHHHHHHHHHHHHHHHHHHH';
};

const deltaSlice = <T>(
    value: T,
    revision: string,
    known: string | undefined,
    forceSnapshot: boolean,
    operations?: JsonPatchOperation[]
) => {
    if (forceSnapshot || !known) return { kind: 'snapshot' as const, revision, data: value };
    if (known === revision) return { kind: 'unchanged' as const, revision };
    return {
        kind: 'patch' as const,
        baseRevision: known,
        revision,
        operations: operations ?? [
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
        turnTime: state.generalTurnTime ?? '0185-01-01T00:00:00.000Z',
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
        defence: state.cityDefence ?? 1_000,
        defenceMax: 2_000,
        wall: 1_000,
        wallMax: 2_000,
        supplyState: 1,
        frontState: 0,
        state: state.cityState ?? 0,
    },
    nation: {
        id: 1,
        name: '위',
        color: '#008000',
        level: state.nationLevel,
        gold: 10_000,
        rice: 20_000,
        tech: 100,
        rate: state.nationRate ?? 20,
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
                return response({
                    myGeneral: { id: 7, name: '메뉴검증장수' },
                    year: state.currentYear ?? 185,
                    month: state.currentMonth ?? 1,
                    turnTerm: 10,
                });
            }
            if (operation === 'dashboard.getContextBundleDelta') {
                state.generalMeCalls += 1;
                const input = operationInput(route, index);
                const include = input.include ?? {};
                const forceSnapshot = input.forceSnapshot === true;
                if (forceSnapshot) state.forceSnapshotCalls = (state.forceSnapshotCalls ?? 0) + 1;
                const revision = contextRevision(state);
                const context = include.context
                    ? deltaSlice(
                          generalContext(state),
                          revision,
                          input.known?.context,
                          forceSnapshot,
                          state.contextOperations
                      )
                    : undefined;
                const currentCommandTableRevision = state.commandTableRevision ?? COMMAND_TABLE_REVISION;
                const commandTable = include.commandTable
                    ? forceSnapshot || !input.known?.commandTable
                        ? {
                              kind: 'snapshot' as const,
                              revision: currentCommandTableRevision,
                              data: commandTableFixture(state.largeCommandTable === true, state.commandBlockedCount),
                          }
                        : input.known.commandTable === currentCommandTableRevision
                          ? { kind: 'unchanged' as const, revision: currentCommandTableRevision }
                          : {
                                kind: 'patch' as const,
                                baseRevision: input.known.commandTable,
                                revision: currentCommandTableRevision,
                                operations: state.commandTableOperations ?? [],
                            }
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
                    year: state.currentYear ?? 185,
                    month: state.currentMonth ?? 1,
                    cityList: [[1, 8, state.cityState ?? 0, 1, 1, 1]],
                    nationList: [[1, '위', '#008000', 1]],
                    spyList: {},
                    shownByGeneralList: [],
                    myCity: 1,
                    myNation: 1,
                });
            }
            if (operation === 'turns.getCommandTable') return response({ general: [], nation: [] });
            if (operation === 'turns.reserved.getGeneral' || operation === 'turns.reserved.getNation') {
                return response({
                    turns: state.reservedTurns ?? [],
                    revision: 0,
                    autorunLimit: state.autorunLimit ?? null,
                });
            }
            if (operation === 'messages.getRecent') {
                return response(state.messages ?? emptyMessages(state.permission));
            }
            if (operation === 'messages.getContacts') return response(state.messageContacts ?? { nation: [] });
            if (operation === 'general.getRecentRecords') {
                return response({
                    global: state.globalRecords ?? [{ id: 3, text: '장수 동향 기록' }],
                    general: state.generalRecords ?? [{ id: 2, text: '개인 기록' }],
                    history: state.worldHistory ?? [{ id: 1, text: '중원 정세 기록' }],
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
            commandMenu: describe('.reserved-command-editor details[open] .menu-items'),
            commandDividers: [...document.querySelectorAll<HTMLElement>('.reserved-command-editor details[open] .menu-divider')].map(
                (element) => {
                    const rect = element.getBoundingClientRect();
                    const style = getComputedStyle(element);
                    return {
                        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                        borderTop: style.borderTop,
                        margin: style.margin,
                    };
                }
            ),
        };
    });
    const commandMenu = page.locator('.reserved-command-editor details[open] .menu-items').first();
    if (await commandMenu.isVisible()) {
        await commandMenu.screenshot({ path: resolve(target, `${name}-menu.png`) });
    }
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
    const bettingButton = global.locator('[data-navigation-id="nation-betting"]');
    await expect
        .poll(() =>
            bettingButton.evaluate((element) => ({
                backgroundColor: getComputedStyle(element).backgroundColor,
                backgroundImage: getComputedStyle(element).backgroundImage,
            }))
        )
        .toEqual({ backgroundColor: 'rgb(0, 88, 44)', backgroundImage: 'none' });
    await bettingButton.hover();
    await expect
        .poll(() => bettingButton.evaluate((element) => getComputedStyle(element).backgroundColor))
        .toBe('rgb(0, 88, 44)');
    await gameInfoButton.focus();
    await expect
        .poll(() => gameInfoButton.evaluate((element) => getComputedStyle(element).backgroundColor))
        .toBe('rgb(0, 88, 44)');
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

test('main general card renders the next turn in the Seoul server timezone', async ({ page }) => {
    const state: NavigationFixture = {
        officerLevel: 0,
        permission: 0,
        nationLevel: 0,
        stage: 0,
        npcMode: 1,
        generalMeCalls: 0,
        operations: [],
        generalName: 'Administrator',
        generalTurnTime: '2026-08-13T00:07:06.713Z',
        currentYear: 179,
        currentMonth: 8,
    };
    await installFixture(page, state);
    await page.setViewportSize({ width: 1200, height: 900 });
    await waitForMain(page);

    const title = page.locator('[data-main-target="general"] .general-title').first();
    await expect(title).toContainText('Administrator');
    await expect(title).toContainText('다음 턴 09:07');
    await expect(title).not.toContainText('00:07');

    const desktopGeometry = await title.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            width: rect.width,
            height: rect.height,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            overflow: style.overflow,
        };
    });
    expect(desktopGeometry.width).toBeGreaterThan(0);
    expect(desktopGeometry.height).toBeGreaterThan(0);
    if (artifactRoot) {
        const target = resolve(artifactRoot);
        await mkdir(target, { recursive: true });
        await Promise.all([
            page.screenshot({ path: resolve(target, 'main-turn-time-seoul-desktop-1200.png'), fullPage: true }),
            writeFile(
                resolve(target, 'main-turn-time-seoul-desktop-1200.json'),
                `${JSON.stringify(desktopGeometry, null, 2)}\n`
            ),
        ]);
    }

    await page.setViewportSize({ width: 500, height: 900 });
    const mobileTitle = page.locator('[data-main-target="general"] .general-title').first();
    await expect(mobileTitle).toContainText('다음 턴 09:07');
    expect(await mobileTitle.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    if (artifactRoot) {
        await page.screenshot({
            path: resolve(artifactRoot, 'main-turn-time-seoul-mobile-500.png'),
            fullPage: true,
        });
    }
});

test('pure NPC message senders are not rendered as reply targets', async ({ page }) => {
    const target = (generalId: number, generalName: string) => ({
        generalId,
        generalName,
        nationId: 1,
        nationName: '위',
        color: '#008000',
        icon: '',
    });
    const messages = {
        ...emptyMessages(0),
        public: [
            {
                id: 102,
                text: 'NPC 메시지',
                time: '2026-08-12 12:00:00',
                msgType: 'public',
                src: target(22, '순수NPC'),
                dest: null,
                option: {},
            },
            {
                id: 101,
                text: '유저 메시지',
                time: '2026-08-12 11:59:00',
                msgType: 'public',
                src: target(21, '유저장수'),
                dest: null,
                option: {},
            },
        ],
    };
    const state: NavigationFixture = {
        officerLevel: 1,
        permission: 0,
        nationLevel: 1,
        stage: 0,
        npcMode: 1,
        generalMeCalls: 0,
        operations: [],
        messages,
        messageContacts: {
            nation: [
                {
                    nationId: 1,
                    mailbox: 9001,
                    name: '위',
                    color: '#008000',
                    general: [[21, '유저장수', 0]],
                },
            ],
        },
    };
    await installFixture(page, state);
    await page.setViewportSize({ width: 1200, height: 900 });
    await waitForMain(page);

    const npcMessage = page.locator('.desktop-message-panel .msg-plate[data-id="102"]');
    const userMessage = page.locator('.desktop-message-panel .msg-plate[data-id="101"]');
    await expect(npcMessage.locator('.msg-header')).toContainText('순수NPC:위');
    await expect(npcMessage.locator('.msg-header')).not.toContainText('↩');
    await expect(npcMessage.getByRole('button', { name: /순수NPC/ })).toHaveCount(0);
    await expect(userMessage.getByRole('button', { name: /유저장수:위.*↩/ })).toBeVisible();
    await userMessage.getByRole('button', { name: /유저장수:위.*↩/ }).click();
    await expect(page.locator('.desktop-message-panel #mailbox_list')).toHaveValue('21');
    await persistArtifact(page, `${basePath.slice(1)}-npc-reply-targets-desktop-1200`);
});

test('main cards and command input stay inside their Ref-sized grid slots', async ({ page }) => {
    const state: NavigationFixture = {
        officerLevel: 1,
        permission: 0,
        nationLevel: 1,
        stage: 0,
        npcMode: 1,
        generalMeCalls: 0,
        operations: [],
        largeCommandTable: true,
        reservedTurns: Array.from({ length: 30 }, (_, index) => ({
            index,
            action: index === 0 ? '휴식' : `command-${index}`,
            args: {},
        })),
        autorunLimit: 2224,
    };
    await installFixture(page, state);
    await page.setViewportSize({ width: 1200, height: 900 });
    await waitForMain(page);

    const cityBars = page.locator('[data-main-target="city"] [role="progressbar"]');
    const statBars = page.locator('[data-stat-progress] [role="progressbar"]');
    const experienceBar = page.locator('[data-experience-progress] [role="progressbar"]');
    await expect(cityBars).toHaveCount(8);
    await expect(statBars).toHaveCount(3);
    await expect(experienceBar).toHaveCount(1);
    await expect(page.locator('[data-main-target="general"] [data-dex-progress]')).toHaveCount(0);
    await expect(page.locator('[data-main-target="general"] [role="progressbar"]')).toHaveCount(4);

    expect(await cityBars.first().evaluate((element) => element.getBoundingClientRect().height)).toBe(9);
    expect(await statBars.first().evaluate((element) => element.getBoundingClientRect().height)).toBe(12);
    expect(await experienceBar.evaluate((element) => element.getBoundingClientRect().height)).toBe(12);
    const texture = await cityBars.first().evaluate((element) => getComputedStyle(element).backgroundImage);
    const fillTexture = await cityBars
        .first()
        .locator('.legacy-progress__fill')
        .evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(texture).toContain('/game/pr5.gif');
    expect(fillTexture).toContain('/game/pb5.gif');

    const desktopGeometry = await page.evaluate(() => {
        const box = (element: Element) => {
            const rect = element.getBoundingClientRect();
            return {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                right: rect.right,
                bottom: rect.bottom,
            };
        };
        const target = (name: string) => {
            const panel = document.querySelector<HTMLElement>(`[data-main-target="${name}"]`);
            if (!panel) throw new Error(`${name} panel missing`);
            return panel;
        };
        const general = target('general');
        const nation = target('nation');
        const city = target('city');
        const commands = target('commands');
        const generalBody = general.querySelector<HTMLElement>('.general-body');
        const editor = commands.querySelector<HTMLElement>('.reserved-command-editor');
        const controlPad = commands.querySelector<HTMLElement>('.control-pad');
        const bottomActions = commands.querySelector<HTMLElement>('.bottom-actions');
        if (!generalBody || !editor || !controlPad || !bottomActions) throw new Error('main layout probe missing');
        const visibleControlBoxes = [...controlPad.children]
            .filter((element) => getComputedStyle(element).display !== 'none')
            .map(box);
        const bottomActionBoxes = [...bottomActions.children].map(box);
        return {
            general: box(general),
            generalBody: box(generalBody),
            nation: box(nation),
            city: box(city),
            commands: box(commands),
            editor: box(editor),
            controlPad: box(controlPad),
            controlColumns: getComputedStyle(controlPad).gridTemplateColumns,
            visibleControlBoxes,
            bottomActionBoxes,
            commandHorizontalOverflow: commands.scrollWidth - commands.clientWidth,
            commandVerticalOverflow: commands.scrollHeight - commands.clientHeight,
        };
    });
    expect(desktopGeometry.general.y).toBe(desktopGeometry.nation.y);
    expect(desktopGeometry.general.bottom).toBe(desktopGeometry.nation.bottom);
    expect(desktopGeometry.commands.bottom).toBe(desktopGeometry.city.bottom);
    expect(desktopGeometry.generalBody.bottom).toBeLessThanOrEqual(desktopGeometry.general.bottom);
    expect(desktopGeometry.editor.right).toBeLessThanOrEqual(desktopGeometry.commands.right);
    expect(desktopGeometry.commandHorizontalOverflow).toBeLessThanOrEqual(0);
    expect(desktopGeometry.commandVerticalOverflow).toBeLessThanOrEqual(0);
    expect(desktopGeometry.controlColumns.split(' ')).toHaveLength(3);
    expect(desktopGeometry.visibleControlBoxes).toHaveLength(3);
    expect(new Set(desktopGeometry.visibleControlBoxes.map(({ y }) => y)).size).toBe(1);
    expect(desktopGeometry.bottomActionBoxes).toHaveLength(3);
    expect(new Set(desktopGeometry.bottomActionBoxes.map(({ y }) => y)).size).toBe(1);
    await expect(page.locator('[data-main-target="commands"] .edit-column button')).toHaveCount(15);
    const autonomousRest = page.locator('[data-main-target="commands"] .action-column > div').first();
    await expect(autonomousRest).toContainText('휴식(자율 행동)');
    expect(await autonomousRest.evaluate((element) => getComputedStyle(element).color)).toBe('rgb(170, 255, 255)');

    const tenthTurnButton = page.getByRole('button', { name: '10턴 명령 입력' });
    await tenthTurnButton.click();
    const quickPicker = page.getByTestId('command-picker');
    await expect(quickPicker).toBeVisible();
    await tenthTurnButton.click();
    await expect(quickPicker).toBeHidden();
    await tenthTurnButton.click();
    await expect(quickPicker).toBeVisible();
    const quickPickerAlignment = await quickPicker.evaluate((element) => {
        const row = element
            .closest('.reserved-command-editor')
            ?.querySelector<HTMLElement>('.action-column > div:nth-child(10)');
        if (!row) throw new Error('10th command row missing');
        return {
            pickerTop: element.getBoundingClientRect().top,
            rowTop: row.getBoundingClientRect().top,
        };
    });
    expect(quickPickerAlignment.pickerTop - quickPickerAlignment.rowTop).toBeCloseTo(30, 0);
    await quickPicker.getByRole('button', { name: '명령 입력 닫기' }).click();

    const modeButton = page.locator('[data-main-target="commands"] .control-pad').getByRole('button', {
        name: '고급 모드',
    });
    await modeButton.hover();
    await modeButton.focus();
    await expect(modeButton).toBeFocused();
    await modeButton.click();
    const advancedControlGeometry = await page.locator('[data-main-target="commands"] .reserved-command-editor').evaluate(
        (editor) => {
            const range = editor.querySelector<HTMLElement>('.range-menu');
            const recent = [...editor.querySelectorAll<HTMLElement>('.control-pad summary')].find((element) =>
                element.textContent?.includes('최근 실행')
            );
            const advanced = editor.querySelector<HTMLElement>('.advanced-actions');
            const queue = editor.querySelector<HTMLElement>('.queue-grid');
            if (!range || !recent || !advanced || !queue) throw new Error('advanced command controls missing');
            return {
                rangeTop: range.getBoundingClientRect().top,
                recentTop: recent.getBoundingClientRect().top,
                advancedTop: advanced.getBoundingClientRect().top,
                advancedBottom: advanced.getBoundingClientRect().bottom,
                queueTop: queue.getBoundingClientRect().top,
            };
        }
    );
    expect(advancedControlGeometry.rangeTop).toBe(advancedControlGeometry.recentTop);
    expect(advancedControlGeometry.advancedTop).toBeGreaterThan(advancedControlGeometry.rangeTop);
    expect(advancedControlGeometry.advancedBottom).toBeLessThanOrEqual(advancedControlGeometry.queueTop);
    const rangeMenu = page.locator('[data-main-target="commands"] .range-menu');
    await rangeMenu.locator('summary').click();
    const rangeDividers = rangeMenu.locator('.menu-divider');
    await expect(rangeDividers).toHaveCount(1);
    await expect(rangeDividers.first()).toBeVisible();
    expect(await rangeDividers.first().evaluate((element) => getComputedStyle(element).borderTop)).toBe(
        '1px solid rgb(68, 68, 68)'
    );
    await persistArtifact(page, `${basePath.slice(1)}-command-range-divider-desktop-1200`);
    await rangeMenu.evaluate((element) => ((element as HTMLDetailsElement).open = false));
    await expect(rangeMenu).not.toHaveAttribute('open', '');

    const selectedMenu = page.locator('[data-main-target="commands"] .selected-menu');
    await selectedMenu.locator('summary').click();
    const selectedMenuDividers = selectedMenu.locator('.menu-divider');
    await expect(selectedMenuDividers).toHaveCount(3);
    await expect(selectedMenuDividers.first()).toBeVisible();
    expect(await selectedMenuDividers.first().evaluate((element) => getComputedStyle(element).borderTop)).toBe(
        '1px solid rgb(68, 68, 68)'
    );
    await persistArtifact(page, `${basePath.slice(1)}-command-selected-dividers-desktop-1200`);
    await selectedMenu.evaluate((element) => ((element as HTMLDetailsElement).open = false));
    await expect(selectedMenu).not.toHaveAttribute('open', '');

    await page.locator('[data-main-target="commands"] .select-command').click();
    const picker = page.getByTestId('command-picker');
    await expect(picker).toBeVisible();
    const pickerGeometry = await picker.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const editor = element.closest('.reserved-command-editor')?.getBoundingClientRect();
        const categories = element.querySelector<HTMLElement>('.category-list');
        if (!editor || !categories) throw new Error('command picker geometry missing');
        return {
            left: rect.left,
            right: rect.right,
            editorLeft: editor.left,
            editorRight: editor.right,
            categoryColumns: getComputedStyle(categories).gridTemplateColumns,
            categoryBoxes: [...categories.children].map((child) => {
                const childRect = child.getBoundingClientRect();
                return { x: childRect.x, y: childRect.y, width: childRect.width, height: childRect.height };
            }),
            horizontalOverflow: element.scrollWidth - element.clientWidth,
        };
    });
    expect(pickerGeometry.left).toBeGreaterThanOrEqual(pickerGeometry.editorLeft);
    expect(pickerGeometry.right).toBeLessThanOrEqual(pickerGeometry.editorRight);
    expect(pickerGeometry.categoryColumns.split(' ')).toHaveLength(3);
    expect(pickerGeometry.categoryBoxes).toHaveLength(3);
    expect(new Set(pickerGeometry.categoryBoxes.map(({ y }) => y)).size).toBe(1);
    expect(pickerGeometry.horizontalOverflow).toBeLessThanOrEqual(0);
    await picker.getByRole('button', { name: '명령 입력 닫기' }).click();

    await page.locator('[data-main-target="commands"] .control-pad').getByRole('button', { name: '일반 모드' }).click();
    const collapsedPanelHeight = await page
        .locator('[data-main-target="commands"]')
        .evaluate((element) => element.getBoundingClientRect().height);
    await page.locator('[data-main-target="commands"] .bottom-actions').getByRole('button', { name: '펼치기' }).click();
    await expect(page.locator('[data-main-target="commands"] .edit-column button')).toHaveCount(30);
    const expandedDesktopGeometry = await page.locator('.layout-desktop').evaluate((layout) => {
        const commands = layout.querySelector<HTMLElement>('[data-main-target="commands"]');
        const city = layout.querySelector<HTMLElement>('[data-main-target="city"]');
        const nation = layout.querySelector<HTMLElement>('[data-main-target="nation"]');
        if (!commands || !city || !nation) throw new Error('expanded desktop panels missing');
        return {
            commandHeight: commands.getBoundingClientRect().height,
            commandBottom: commands.getBoundingClientRect().bottom,
            cityBottom: city.getBoundingClientRect().bottom,
            nationTop: nation.getBoundingClientRect().top,
            verticalOverflow: commands.scrollHeight - commands.clientHeight,
            overflowY: getComputedStyle(commands).overflowY,
        };
    });
    expect(expandedDesktopGeometry.commandHeight).toBeGreaterThan(collapsedPanelHeight);
    expect(expandedDesktopGeometry.verticalOverflow).toBeLessThanOrEqual(0);
    expect(expandedDesktopGeometry.overflowY).toBe('visible');
    expect(expandedDesktopGeometry.cityBottom).toBe(expandedDesktopGeometry.commandBottom);
    expect(expandedDesktopGeometry.nationTop).toBeGreaterThanOrEqual(expandedDesktopGeometry.commandBottom);

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
        const layout = await page.evaluate(() => {
            const describe = (selector: string) => {
                const element = document.querySelector<HTMLElement>(selector);
                if (!element) return null;
                const rect = element.getBoundingClientRect();
                return {
                    rect: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                        right: rect.right,
                        bottom: rect.bottom,
                    },
                    clientWidth: element.clientWidth,
                    clientHeight: element.clientHeight,
                    scrollWidth: element.scrollWidth,
                    scrollHeight: element.scrollHeight,
                    overflowX: getComputedStyle(element).overflowX,
                    overflowY: getComputedStyle(element).overflowY,
                    boxSizing: getComputedStyle(element).boxSizing,
                    cssWidth: getComputedStyle(element).width,
                    minWidth: getComputedStyle(element).minWidth,
                    paddingInline: getComputedStyle(element).paddingInline,
                    borderInline: `${getComputedStyle(element).borderLeftWidth} ${getComputedStyle(element).borderRightWidth}`,
                };
            };
            return {
                viewport: { width: innerWidth, height: innerHeight },
                documentWidth: document.documentElement.scrollWidth,
                roots: {
                    html: describe('html'),
                    body: describe('body'),
                    app: describe('#app'),
                    main: describe('main.main-page'),
                },
                overflowingElements: [...document.body.querySelectorAll<HTMLElement>('*')]
                    .map((element) => {
                        const rect = element.getBoundingClientRect();
                        return {
                            tag: element.tagName.toLowerCase(),
                            className: element.className,
                            testId: element.dataset.testid ?? null,
                            left: rect.left,
                            right: rect.right,
                            width: rect.width,
                        };
                    })
                    .filter(({ left, right }) => left < 0 || right > innerWidth)
                    .slice(0, 20),
                city: describe('[data-main-target="city"]'),
                nation: describe('[data-main-target="nation"]'),
                general: describe('[data-main-target="general"]'),
                commands: describe('[data-main-target="commands"]'),
                commandEditor: describe('[data-main-target="commands"] .reserved-command-editor'),
                commandPicker: describe('[data-testid="command-picker"]'),
            };
        });
        await Promise.all([
            page.screenshot({ path: resolve(artifactRoot, `progress-bars-${name}.png`), fullPage: true }),
            writeFile(
                resolve(artifactRoot, `progress-bars-${name}.json`),
                `${JSON.stringify({ layout, progress: measurement }, null, 2)}\n`
            ),
        ]);
    };
    await captureProgress('desktop-1200');

    await page.setViewportSize({ width: 500, height: 900 });
    await expect(page.locator('.layout-mobile')).toBeVisible();
    await page.locator('[data-main-target="commands"] .bottom-actions').getByRole('button', { name: '펼치기' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(500);
    await expect(page.locator('[data-main-target="city"] [role="progressbar"]')).toHaveCount(8);
    await expect(page.locator('[data-main-target="general"] [role="progressbar"]')).toHaveCount(4);
    expect(
        await page
            .locator('[data-main-target="city"] [role="progressbar"]')
            .first()
            .evaluate((element) => element.getBoundingClientRect().height)
    ).toBe(9);
    const mobileGeometry = await page.locator('[data-main-target="commands"]').evaluate((commands) => {
        const editor = commands.querySelector<HTMLElement>('.reserved-command-editor');
        const controls = commands.querySelector<HTMLElement>('.control-pad');
        if (!editor || !controls) throw new Error('mobile command layout probe missing');
        const panelRect = commands.getBoundingClientRect();
        const editorRect = editor.getBoundingClientRect();
        const controlBoxes = [...controls.children]
            .filter((element) => getComputedStyle(element).display !== 'none')
            .map((element) => {
                const rect = element.getBoundingClientRect();
                return { y: rect.y, width: rect.width };
            });
        return {
            panelWidth: panelRect.width,
            panelHeight: panelRect.height,
            editorLeft: editorRect.left,
            editorRight: editorRect.right,
            panelLeft: panelRect.left,
            panelRight: panelRect.right,
            horizontalOverflow: commands.scrollWidth - commands.clientWidth,
            verticalOverflow: commands.scrollHeight - commands.clientHeight,
            controlColumns: getComputedStyle(controls).gridTemplateColumns,
            controlBoxes,
        };
    });
    expect(mobileGeometry.panelHeight).toBeGreaterThan(645);
    expect(mobileGeometry.editorLeft).toBeGreaterThanOrEqual(mobileGeometry.panelLeft);
    expect(mobileGeometry.editorRight).toBeLessThanOrEqual(mobileGeometry.panelRight);
    expect(mobileGeometry.horizontalOverflow).toBeLessThanOrEqual(0);
    expect(mobileGeometry.verticalOverflow).toBeLessThanOrEqual(0);
    expect(mobileGeometry.controlColumns.split(' ')).toHaveLength(3);
    expect(mobileGeometry.controlBoxes).toHaveLength(3);
    expect(new Set(mobileGeometry.controlBoxes.map(({ y }) => y)).size).toBe(1);
    await expect(page.locator('[data-main-target="commands"] .edit-column button')).toHaveCount(30);
    const mobileTurnButton = page.getByRole('button', { name: '10턴 명령 입력' });
    await mobileTurnButton.click();
    await expect(page.getByTestId('command-picker')).toBeVisible();
    await mobileTurnButton.click();
    await expect(page.getByTestId('command-picker')).toBeHidden();
    await captureProgress('mobile-500');
});

test('the 939/940 boundary switches to the Ref-style 500px single document', async ({ page }) => {
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
    await expect(page.locator('.main-mobile-bottom')).toBeVisible();

    await page.setViewportSize({ width: 500, height: 900 });
    await expect
        .poll(() =>
            page
                .locator('.main-global-menu')
                .first()
                .locator('[data-navigation-id="nation-betting"]')
                .evaluate((element) => getComputedStyle(element).backgroundColor)
        )
        .toBe('rgb(0, 88, 44)');
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
        width: 500,
        scrollWidth: 500,
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

test('real mobile devices initially fit the complete 500px game canvas', async ({ browser }, testInfo) => {
    test.setTimeout(60_000);
    const configuredBaseUrl = testInfo.project.use.baseURL;
    if (typeof configuredBaseUrl !== 'string') {
        throw new Error('Playwright baseURL is required for the mobile viewport contract');
    }

    const deviceWidths = [360, 390, 480];
    const measurements: Record<string, unknown> = {};

    for (const deviceWidth of deviceWidths) {
        const context = await browser.newContext({
            baseURL: configuredBaseUrl,
            viewport: { width: deviceWidth, height: 844 },
            screen: { width: deviceWidth, height: 844 },
            deviceScaleFactor: 1,
            isMobile: true,
            hasTouch: true,
            colorScheme: 'dark',
        });
        const mobilePage = await context.newPage();
        const state: NavigationFixture = {
            officerLevel: 5,
            permission: 2,
            nationLevel: 3,
            stage: 6,
            npcMode: 1,
            generalMeCalls: 0,
            operations: [],
        };
        await installFixture(mobilePage, state);
        await waitForMain(mobilePage);

        const mainGeometry = await mobilePage.locator('.main-page').evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return {
                viewportMeta: document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content,
                screenWidth: screen.availWidth,
                innerWidth: window.innerWidth,
                layoutViewportWidth: document.documentElement.clientWidth,
                visualViewportWidth: window.visualViewport?.width ?? null,
                visualViewportScale: window.visualViewport?.scale ?? null,
                documentScrollWidth: document.documentElement.scrollWidth,
                canvas: {
                    left: rect.left,
                    right: rect.right,
                    width: rect.width,
                },
            };
        });

        expect(mainGeometry.viewportMeta).toBe('width=500');
        expect(mainGeometry.screenWidth).toBe(deviceWidth);
        expect(mainGeometry.layoutViewportWidth).toBe(500);
        expect(mainGeometry.visualViewportWidth).toBeCloseTo(500, 2);
        expect(mainGeometry.visualViewportScale).toBeCloseTo(deviceWidth / 500, 2);
        expect(mainGeometry.documentScrollWidth).toBeLessThanOrEqual(mainGeometry.innerWidth);
        expect(mainGeometry.canvas).toEqual({ left: 0, right: 500, width: 500 });
        expect(mainGeometry.canvas.right).toBeLessThanOrEqual((mainGeometry.visualViewportWidth ?? 0) + 0.01);
        if (artifactRoot) {
            await mkdir(artifactRoot, { recursive: true });
            await mobilePage.screenshot({
                path: resolve(artifactRoot, `initial-mobile-fit-${deviceWidth}.png`),
                fullPage: true,
            });
        }

        const routeGeometry: Record<string, unknown> = {};
        if (deviceWidth === 390) {
            for (const target of [
                'chief-center',
                'battle-center',
                'inherit',
                'nation-betting',
            ]) {
                await mobilePage.goto(target);
                await expect
                    .poll(() => mobilePage.locator('#app').evaluate((element) => getComputedStyle(element).minWidth))
                    .toBe('500px');
                routeGeometry[target] = await mobilePage.locator('#app').evaluate((element) => {
                    const rect = element.getBoundingClientRect();
                    return {
                        viewportMeta: document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content,
                        layoutViewportWidth: document.documentElement.clientWidth,
                        visualViewportWidth: window.visualViewport?.width ?? null,
                        left: rect.left,
                        right: rect.right,
                        width: rect.width,
                    };
                });
                const geometry = routeGeometry[target] as {
                    viewportMeta: string;
                    layoutViewportWidth: number;
                    visualViewportWidth: number;
                    left: number;
                    right: number;
                    width: number;
                };
                expect(geometry.viewportMeta).toBe('width=500');
                expect(geometry.layoutViewportWidth).toBe(500);
                expect(geometry.visualViewportWidth).toBeCloseTo(500, 2);
                expect(geometry.left).toBeCloseTo(0, 2);
                expect(geometry.right).toBeCloseTo(500, 2);
                expect(geometry.width).toBeCloseTo(500, 2);
            }
        }

        measurements[String(deviceWidth)] = { main: mainGeometry, routes: routeGeometry };
        await context.close();
    }

    if (artifactRoot) {
        await writeFile(
            resolve(artifactRoot, 'initial-mobile-fit-computed-dom.json'),
            `${JSON.stringify(measurements, null, 2)}\n`
        );
    }
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
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(state.operations.slice(operationsBeforeClockOnly)).toEqual([]);

    const operationsBeforeChangedBurst = state.operations.length;
    state.generalName = '부드럽게갱신된장수';
    await page.evaluate(() => {
        const emit = (window as unknown as { __emitMainRealtime: (type: string, payload: unknown) => void })
            .__emitMainRealtime;
        for (let index = 0; index < 100; index += 1) {
            emit('readModelInvalidated', {
                invalidation: {
                    context: true,
                    lobby: false,
                    map: false,
                    commands: true,
                    contacts: false,
                    boardAccess: true,
                    reservedTurns: false,
                    records: false,
                    frontStatus: false,
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
            'readModelInvalidated',
            {
                invalidation: {
                    context: false,
                    lobby: false,
                    map: false,
                    commands: false,
                    contacts: false,
                    boardAccess: false,
                    reservedTurns: false,
                    records: false,
                    frontStatus: true,
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

    const callsBeforeDefence = state.generalMeCalls;
    state.cityDefence = 900;
    state.contextRevision = 'I'.repeat(22);
    state.contextOperations = [{ op: 'replace', path: '/city/defence', value: 900 }];
    state.commandTableRevision = 'J'.repeat(22);
    state.commandBlockedCount = 1;
    state.commandTableOperations = [
        { op: 'replace', path: '/general/0/values/0/possible', value: false },
        { op: 'replace', path: '/general/0/values/0/status', value: 'blocked' },
    ];
    await emitReadModelInvalidation(page, readModelInvalidation({ context: true, commands: true }));
    await expect.poll(() => state.generalMeCalls, { timeout: 4_000 }).toBe(callsBeforeDefence + 1);
    await expect(page.locator('[data-city-progress="수비"] .city-progress__text')).toHaveText('900 / 2,000');

    const callsBeforeTax = state.generalMeCalls;
    state.nationRate = 25;
    state.contextRevision = 'K'.repeat(22);
    state.contextOperations = [{ op: 'replace', path: '/nation/rate', value: 25 }];
    state.commandTableRevision = 'L'.repeat(22);
    state.commandBlockedCount = 2;
    state.commandTableOperations = [
        { op: 'replace', path: '/general/0/values/1/possible', value: false },
        { op: 'replace', path: '/general/0/values/1/status', value: 'blocked' },
    ];
    await emitReadModelInvalidation(
        page,
        readModelInvalidation({ context: true, commands: true, boardAccess: true })
    );
    await expect.poll(() => state.generalMeCalls, { timeout: 4_000 }).toBe(callsBeforeTax + 1);

    const callsBeforeCityState = state.generalMeCalls;
    const operationsBeforeCityState = state.operations.length;
    state.cityState = 5;
    state.contextRevision = 'M'.repeat(22);
    state.contextOperations = [{ op: 'replace', path: '/city/state', value: 5 }];
    state.commandTableRevision = 'N'.repeat(22);
    state.commandBlockedCount = 3;
    state.commandTableOperations = [
        { op: 'replace', path: '/general/0/values/2/possible', value: false },
        { op: 'replace', path: '/general/0/values/2/status', value: 'blocked' },
    ];
    await emitReadModelInvalidation(page, readModelInvalidation({ context: true, map: true, commands: true }));
    await expect.poll(() => state.generalMeCalls, { timeout: 4_000 }).toBe(callsBeforeCityState + 1);
    await expect(page.locator('.city-base .city-state img')).toHaveAttribute('src', /event5\.gif$/u);
    expect(state.operations.slice(operationsBeforeCityState).sort()).toEqual(
        ['dashboard.getContextBundleDelta', 'world.getMap'].sort()
    );

    const callsBeforeFallback = state.generalMeCalls;
    const forcedBeforeFallback = state.forceSnapshotCalls ?? 0;
    state.generalName = 'snapshot복구장수';
    state.contextRevision = 'O'.repeat(22);
    state.contextOperations = [{ op: 'replace', path: '/missing/value', value: 'invalid-delta' }];
    state.commandTableOperations = [];
    await emitReadModelInvalidation(
        page,
        readModelInvalidation({ context: true, commands: true, boardAccess: true })
    );
    await expect.poll(() => state.generalMeCalls, { timeout: 4_000 }).toBe(callsBeforeFallback + 2);
    expect(state.forceSnapshotCalls).toBe(forcedBeforeFallback + 1);
    await expect(page.locator('.general-title')).toContainText('snapshot복구장수');
    await expect(page.locator('.game-feedback')).toHaveCount(0);
    await expect(page.locator('[data-main-target="general"] .skeleton-line')).toHaveCount(0);
    await expect(page.locator('[data-main-target="city"] .skeleton-line')).toHaveCount(0);
    expect(
        await page.evaluate(() => {
            const probe = (
                window as unknown as {
                    __mainRefreshProbe: { general: Element; city: Element };
                }
            ).__mainRefreshProbe;
            return {
                generalMounted: probe.general === document.querySelector('[data-main-target="general"]'),
                cityMounted: probe.city === document.querySelector('[data-main-target="city"]'),
            };
        })
    ).toEqual({ generalMounted: true, cityMounted: true });

    await page.locator(`a[href="${basePath}/board"]`).first().click();
    await page.waitForURL(`**${basePath}/board`);
    expect(
        await page.evaluate(() => (window as unknown as { __hasMainRealtime: () => boolean }).__hasMainRealtime())
    ).toBe(false);
    const callsAfterLeavingMain = state.generalMeCalls;
    await page.evaluate(() => {
        (window as unknown as { __emitMainRealtime: (type: string, payload: unknown) => void }).__emitMainRealtime(
            'readModelInvalidated',
            {
                invalidation: {
                    context: true,
                    lobby: false,
                    map: false,
                    commands: true,
                    contacts: false,
                    boardAccess: true,
                    reservedTurns: false,
                    records: false,
                    frontStatus: false,
                },
            }
        );
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(state.generalMeCalls).toBe(callsAfterLeavingMain);
});

test('global activity, world history, and a month boundary refresh their visible main slices', async ({ page }) => {
    const state: NavigationFixture = {
        officerLevel: 5,
        permission: 2,
        nationLevel: 3,
        stage: 0,
        npcMode: 1,
        generalMeCalls: 0,
        operations: [],
    };
    await installRealtimeHarness(page);
    await installFixture(page, state);
    await page.setViewportSize({ width: 1200, height: 900 });
    await waitForMain(page);
    await expect
        .poll(() =>
            page.evaluate(() => (window as unknown as { __hasMainRealtime: () => boolean }).__hasMainRealtime())
        )
        .toBe(true);

    state.globalRecords = [
        { id: 4, text: '자동 갱신된 장수 동향' },
        { id: 3, text: '장수 동향 기록' },
    ];
    const operationsBeforeGlobal = state.operations.length;
    await emitReadModelInvalidation(page, readModelInvalidation({ records: true }));
    await expect(page.locator('[data-main-target="global-records"]')).toContainText('자동 갱신된 장수 동향');
    expect(state.operations.slice(operationsBeforeGlobal)).toEqual(['general.getRecentRecords']);

    state.worldHistory = [
        { id: 5, text: '자동 갱신된 중원 정세' },
        { id: 1, text: '중원 정세 기록' },
    ];
    const operationsBeforeHistory = state.operations.length;
    await emitReadModelInvalidation(page, readModelInvalidation({ records: true }));
    await expect(page.locator('[data-main-target="world-history"]')).toContainText('자동 갱신된 중원 정세');
    expect(state.operations.slice(operationsBeforeHistory)).toEqual(['general.getRecentRecords']);

    state.currentMonth = 2;
    const operationsBeforeMonth = state.operations.length;
    await page.evaluate(
        (invalidation) => {
            (window as unknown as { __emitMainRealtime: (type: string, payload: unknown) => void }).__emitMainRealtime(
                'readModelInvalidated',
                {
                    invalidation,
                }
            );
        },
        readModelInvalidation({ lobby: true, map: true, commands: true })
    );
    await expect(page.getByText('현재: 185년 2월')).toBeVisible();
    await expect(page.locator('.map-viewer')).toContainText('185年 2月');
    expect(state.operations.slice(operationsBeforeMonth).sort()).toEqual(
        ['dashboard.getContextBundleDelta', 'lobby.info', 'world.getMap'].sort()
    );
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
            'readModelInvalidated',
            {
                invalidation: {
                    context: true,
                    lobby: false,
                    map: false,
                    commands: true,
                    contacts: false,
                    boardAccess: true,
                    reservedTurns: false,
                    records: false,
                    frontStatus: false,
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
            'readModelInvalidated',
            {
                invalidation: {
                    context: true,
                    lobby: false,
                    map: false,
                    commands: true,
                    contacts: false,
                    boardAccess: true,
                    reservedTurns: false,
                    records: false,
                    frontStatus: false,
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
