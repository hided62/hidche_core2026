import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { gameBasePath, gameProfile, gameTrpcRoute } from './gameTestPaths.js';

const response = (data: unknown) => ({ result: { data } });
const parityArtifactDir = process.env.MENU_PARITY_ARTIFACT_DIR;
const legacyImageRoot = process.env.LEGACY_IMAGE_ROOT;
const operationNames = (route: Route) =>
    decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(',');

const persistParityArtifact = async (page: Page, name: string, geometry: unknown) => {
    if (!parityArtifactDir) {
        return;
    }
    await mkdir(parityArtifactDir, { recursive: true });
    await Promise.all([
        page.screenshot({ path: resolve(parityArtifactDir, `${name}.png`), fullPage: true }),
        writeFile(resolve(parityArtifactDir, `${name}.json`), `${JSON.stringify(geometry, null, 2)}\n`),
    ]);
};

const readGeneralPanelImages = async (panel: Locator) =>
    panel.evaluate((element) =>
        [...element.querySelectorAll<HTMLElement>('.general-image')].map((image) => {
            const rect = image.getBoundingClientRect();
            const style = getComputedStyle(image);
            return {
                label: image.getAttribute('aria-label'),
                width: rect.width,
                height: rect.height,
                backgroundImage: style.backgroundImage,
                backgroundSize: style.backgroundSize,
                pointerEvents: style.pointerEvents,
                userSelect: style.userSelect,
            };
        })
    );

type FixtureState = {
    permission: 'head' | 'member';
    myset: number;
    scenarioEffect?: string | null;
    instantRetreatEnabled?: boolean;
    instantRetreatAttempts?: number;
    instantRetreatInputs?: Array<Record<string, unknown>>;
    buildNationCandidateEnabled?: boolean;
    buildNationCandidateAttempts?: number;
    buildNationCandidateInputs?: Array<Record<string, unknown>>;
    dieOnPrestartShow?: boolean;
    dieOnPrestartAvailableAt?: string;
    dieOnPrestartAttempts?: number;
    dieOnPrestartInputs?: Array<Record<string, unknown>>;
    generalMeQueries?: number;
    generalLogQueries?: number;
    ensurePrestartQueries?: number;
    ensurePrestartFailure?: 'TIMEOUT' | 'INTERNAL_SERVER_ERROR';
    nationNoticeInput?: string;
    settingMutations: Array<Record<string, unknown>>;
    accessPages: string[];
    iconChoices?: Array<{ id: string; picture: string; imageServer: number; createdAt: string }>;
    adjustIconInputs?: Array<Record<string, unknown>>;
    joinConfig?: Record<string, unknown>;
    createGeneralInputs?: Array<Record<string, unknown>>;
    mainTraits?: { personal: string; specialDomestic: string; specialWar: string };
    hiddenSeedLogText?: string;
    recentRecords?: {
        global: Array<{ id: number; text: string; createdAt?: string }>;
        general: Array<{ id: number; text: string; createdAt?: string }>;
        history: Array<{ id: number; text: string; createdAt?: string }>;
    };
};

type TrpcRequestPayload = {
    json?: Record<string, unknown>;
    input?: { json?: Record<string, unknown> };
};

const myGeneral = (state: FixtureState) => ({
    general: {
        id: 7,
        name: '검증장수',
        npcState: 0,
        nationId: state.buildNationCandidateEnabled ? 0 : 1,
        cityId: 1,
        troopId: 0,
        picture: null,
        imageServer: 0,
        officerLevel: state.permission === 'head' ? 9 : 1,
        officerLevelText:
            state.permission === 'head' ? '간의대부' : state.buildNationCandidateEnabled ? '재야' : '일반',
        stats: { leadership: 70, strength: 60, intelligence: 50 },
        gold: 1_000,
        rice: 2_000,
        crew: 300,
        train: 80,
        atmos: 90,
        injury: 0,
        experience: 100,
        dedication: 200,
        age: 30,
        turnTime: '2026-01-01 00:10:00',
        crewTypeId: 1,
        crewTypeName: '보병',
        traits: state.mainTraits ?? { personal: '-', specialDomestic: '-', specialWar: '-' },
        progression: {
            experienceLevel: 1,
            dedicationLevel: 2,
            dedicationText: '29품관',
            statExperience: { leadership: 7, strength: 8, intelligence: 9 },
            statUpgradeLimit: 20,
            dex: [350, 1_375, 3_500, 7_125, 1_275_975],
        },
        items: { horse: 'che_명마', weapon: null, book: null, item: null },
        itemNames: { horse: '명마', weapon: null, book: null, item: null },
    },
    city: {
        id: 1,
        name: '업',
        level: 8,
        levelName: '특',
        region: 2,
        regionName: '중원',
        nationId: 1,
        nationName: '위',
        population: 1000,
        populationMax: 2000,
        agriculture: 100,
        agricultureMax: 200,
        commerce: 100,
        commerceMax: 200,
        security: 100,
        securityMax: 200,
        trust: 70,
        trade: 100,
        defence: 100,
        defenceMax: 200,
        wall: 100,
        wallMax: 200,
        supplyState: 1,
        frontState: 0,
    },
    nation: state.buildNationCandidateEnabled
        ? {
              id: 0,
              name: '재야',
              color: '#000000',
              level: 0,
              levelName: '방랑군',
              gold: 0,
              rice: 0,
              tech: 0,
              typeCode: 'None',
              typeName: '-',
              typePros: '',
              typeCons: '',
              capitalCityId: null,
              capitalCityName: null,
              population: { cityCount: 0, current: 0, max: 0 },
              crew: { generalCount: 0, current: 0, max: 0 },
              power: 0,
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
          }
        : {
              id: 1,
              name: '위',
              color: '#777777',
              level: 3,
              levelName: '주자사',
              gold: 10_000,
              rice: 20_000,
              tech: 100,
              typeCode: 'che_법가',
              typeName: '법가',
              capitalCityId: 1,
              capitalCityName: '업',
              typePros: '금수입↑ 치안↑',
              typeCons: '인구↓ 민심↓',
              population: { cityCount: 1, current: 1_000, max: 2_000 },
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
    settings: {
        tnmt: 0,
        defence_train: 80,
        use_treatment: 21,
        use_auto_nation_turn: 1,
        myset: state.myset,
    },
    penalties: {},
    iconChoices: state.iconChoices ?? [],
    canChangeIcon: true,
    iconChangeAvailableAt: null,
});

const battleCenter = (state: FixtureState) => ({
    me: {
        id: 7,
        officerLevel: state.permission === 'head' ? 9 : 1,
        permissionLevel: state.permission === 'head' ? 2 : 0,
    },
    nation: { id: 1, name: '위', color: '#777777', level: 3 },
    currentYear: 185,
    currentMonth: 1,
    turnTermMinutes: 10,
    generals: [
        {
            id: 7,
            name: '검증장수',
            npcState: 0,
            officerLevel: state.permission === 'head' ? 9 : 1,
            officerLevelText: state.permission === 'head' ? '간의대부' : '일반',
            cityId: 1,
            turnTime: '2026-01-01 00:10:00',
            recentWar: '2026-01-01 00:00:00',
            warnum: 3,
            stats: { leadership: 70, strength: 60, intelligence: 50 },
            experience: 100,
            dedication: 200,
            injury: 0,
            gold: 1_000,
            rice: 2_000,
            crew: 300,
            train: 80,
            atmos: 90,
            age: 30,
            crewTypeId: 1,
            crewTypeName: '보병',
            equipment: { weapon: 'None', book: 'None', horse: 'None', item: 'None' },
            equipmentNames: { weapon: '-', book: '-', horse: '-', item: '-' },
            traits: { personal: '-', specialDomestic: '-', specialWar: '-' },
            progression: {
                experienceLevel: 1,
                dedicationLevel: 2,
                dedicationText: '29품관',
                statExperience: { leadership: 7, strength: 8, intelligence: 9 },
                statUpgradeLimit: 20,
                dex: [350, 1_375, 3_500, 7_125, 1_275_975],
            },
            battleStats: { kills: 1, deaths: 2, fire: 0, killCrew: 300, deathCrew: 100, dex: [] },
        },
        {
            id: 8,
            name: '다른장수',
            npcState: 2,
            officerLevel: 1,
            officerLevelText: '일반',
            cityId: 1,
            turnTime: '2026-01-01 00:20:00',
            recentWar: null,
            warnum: 0,
            stats: { leadership: 50, strength: 50, intelligence: 50 },
            experience: 0,
            dedication: 0,
            injury: 0,
            gold: 500,
            rice: 500,
            crew: 100,
            train: 60,
            atmos: 60,
            age: 20,
            crewTypeId: 1,
            crewTypeName: '보병',
            equipment: { weapon: 'None', book: 'None', horse: 'None', item: 'None' },
            equipmentNames: { weapon: '-', book: '-', horse: '-', item: '-' },
            traits: { personal: '-', specialDomestic: '-', specialWar: '-' },
            progression: {
                experienceLevel: 0,
                dedicationLevel: 0,
                dedicationText: '무품관',
                statExperience: { leadership: 0, strength: 0, intelligence: 0 },
                statUpgradeLimit: 20,
                dex: [0, 0, 0, 0, 0],
            },
            battleStats: { kills: 0, deaths: 0, fire: 0, killCrew: 0, deathCrew: 0, dex: [] },
        },
    ],
});

const install = async (page: Page, state: FixtureState) => {
    await page.addInitScript(
        ({ basePath, profile }) => {
            if (location.pathname.startsWith(`${basePath}/`)) {
                localStorage.setItem('sammo-game-token', 'ga_menu-token');
                localStorage.setItem('sammo-game-profile', profile);
            }
        },
        { basePath: gameBasePath, profile: gameProfile }
    );
    await page.route('**/image/game/**', async (route) => {
        const filename = basename(new URL(route.request().url()).pathname);
        if (
            legacyImageRoot &&
            ['back_walnut.jpg', 'back_green.jpg', 'back_blue.jpg', 'pr5.gif', 'pb5.gif', 'pr8.gif', 'pb8.gif'].includes(
                filename
            )
        ) {
            await route.fulfill({
                status: 200,
                contentType: filename.endsWith('.gif') ? 'image/gif' : 'image/jpeg',
                body: await readFile(resolve(legacyImageRoot, filename)),
            });
            return;
        }
        await route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from('') });
    });
    await page.route(gameTrpcRoute, async (route) => {
        const operations = operationNames(route);
        const rawRequestBody: unknown = route.request().postData() ? route.request().postDataJSON() : {};
        const requestBody =
            rawRequestBody && typeof rawRequestBody === 'object' ? (rawRequestBody as Record<string, unknown>) : {};
        const queryInputText = new URL(route.request().url()).searchParams.get('input');
        let queryInput: Record<string, unknown> = {};
        if (queryInputText) {
            try {
                const parsed: unknown = JSON.parse(queryInputText);
                if (parsed && typeof parsed === 'object') {
                    queryInput = parsed as Record<string, unknown>;
                }
            } catch {
                queryInput = {};
            }
        }
        const results = operations.map((operation, operationIndex) => {
            const rawPayload =
                requestBody[String(operationIndex)] ??
                queryInput[String(operationIndex)] ??
                (operations.length === 1
                    ? Object.keys(requestBody).length > 0
                        ? requestBody
                        : queryInput
                    : undefined);
            const payload =
                rawPayload && typeof rawPayload === 'object' ? (rawPayload as TrpcRequestPayload) : undefined;
            const jsonInput =
                payload?.json ?? payload?.input?.json ?? (payload as Record<string, unknown> | undefined) ?? {};
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info')
                return response({ myGeneral: state.joinConfig ? null : { id: 7, name: '검증장수' } });
            if (operation === 'join.getConfig') return response(state.joinConfig ?? {});
            if (operation === 'join.createGeneral') {
                state.createGeneralInputs?.push(jsonInput);
                return response({ generalId: 9 });
            }
            if (operation === 'dashboard.getContextBundleDelta') {
                return response({
                    context: {
                        kind: 'snapshot',
                        revision: 'AAAAAAAAAAAAAAAAAAAAAA',
                        data: myGeneral(state),
                    },
                    commandTable: {
                        kind: 'snapshot',
                        revision: 'BBBBBBBBBBBBBBBBBBBBBB',
                        data: { general: [], nation: [] },
                    },
                    boardAccess: {
                        kind: 'snapshot',
                        revision: 'CCCCCCCCCCCCCCCCCCCCCC',
                        data: { permission: 4, canMeeting: true, canSecret: true },
                    },
                });
            }
            if (operation === 'general.me') {
                state.generalMeQueries = (state.generalMeQueries ?? 0) + 1;
                return response(myGeneral(state));
            }
            if (operation === 'general.ensureDieOnPrestartStatus') {
                state.ensurePrestartQueries = (state.ensurePrestartQueries ?? 0) + 1;
                if (state.ensurePrestartFailure) {
                    const isTimeout = state.ensurePrestartFailure === 'TIMEOUT';
                    return {
                        error: {
                            message: isTimeout
                                ? '요청 처리 결과를 확인하지 못했습니다.'
                                : '엔진 transaction을 시작하지 못했습니다.',
                            code: -32000,
                            data: {
                                code: state.ensurePrestartFailure,
                                httpStatus: isTimeout ? 408 : 500,
                                path: operation,
                            },
                        },
                    };
                }
                return response({
                    show: state.dieOnPrestartShow ?? false,
                    available: false,
                    availableAt: state.dieOnPrestartAvailableAt ?? null,
                });
            }
            if (operation === 'general.getFrontStatus')
                return response({
                    onlineUserCount: 1,
                    onlineNations: '【위】',
                    onlineGenerals: '검증장수',
                    nationNotice: state.nationNoticeInput ?? '',
                    lastExecuted: '2026-01-01T00:00:00.000Z',
                    latestVote: null,
                });
            if (operation === 'world.getState')
                return response({
                    currentYear: 185,
                    currentMonth: 1,
                    tickSeconds: 600,
                    config: {
                        npcMode: 0,
                        const: {
                            availableInstantAction: {
                                instantRetreat: state.instantRetreatEnabled ?? false,
                            },
                        },
                        environment: { scenarioEffect: state.scenarioEffect ?? null },
                    },
                    meta: {
                        turntime: '2026-01-01T00:00:00.000Z',
                        opentime: state.buildNationCandidateEnabled
                            ? '2026-02-01T00:00:00.000Z'
                            : '2025-12-01T00:00:00.000Z',
                        autorun_user: {},
                    },
                });
            if (operation === 'world.getMapLayout')
                return response({ mapName: 'che', cityList: [], regionMap: {}, levelMap: {} });
            if (operation === 'world.getMap')
                return response({
                    year: 185,
                    month: 1,
                    startYear: 180,
                    cityList: [],
                    nationList: [],
                    myCity: 1,
                    myNation: 1,
                });
            if (operation === 'turns.getCommandTable') return response({ general: [], nation: [] });
            if (operation === 'turns.reserved.getGeneral' || operation === 'turns.reserved.getNation')
                return response({ turns: [], revision: 0 });
            if (operation === 'messages.getRecent')
                return response({
                    private: [],
                    national: [],
                    public: [],
                    diplomacy: [],
                    sequence: -1,
                    hasMore: { private: false, national: false, public: false, diplomacy: false },
                    latestRead: { private: 0, national: 0, public: 0, diplomacy: 0 },
                    canRespondDiplomacy: false,
                });
            if (operation === 'messages.getContacts') return response({ nation: [] });
            if (operation === 'general.getRecentRecords')
                return response(state.recentRecords ?? { global: [], general: [], history: [] });
            if (operation === 'board.getAccess') return response({ permission: 4, canMeeting: true, canSecret: true });
            if (operation === 'tournament.getState') return response({ stage: 0 });
            if (operation === 'public.getTraffic')
                return response({
                    history: [
                        { year: 185, month: 1, date: '2026-01-01T00:00:00.000Z', refresh: 120, online: 8 },
                        { year: 185, month: 2, date: '2026-01-01T00:10:00.000Z', refresh: 240, online: 12 },
                    ],
                    maxRefresh: 240,
                    maxOnline: 12,
                    suspects: [
                        { generalId: null, name: '합계', refresh: 360, refreshScoreTotal: 36 },
                        { generalId: 7, name: '검증장수', refresh: 240, refreshScoreTotal: 24 },
                    ],
                });
            if (operation === 'general.getMyLog') {
                state.generalLogQueries = (state.generalLogQueries ?? 0) + 1;
                return response({
                    type: 'generalAction',
                    logs: [{ id: 1, text: state.hiddenSeedLogText ?? '<Y>기록</>' }],
                });
            }
            if (operation === 'general.instantRetreat') {
                state.instantRetreatInputs?.push(jsonInput);
                state.instantRetreatAttempts = (state.instantRetreatAttempts ?? 0) + 1;
                if (state.instantRetreatAttempts === 1) {
                    return {
                        error: {
                            message: '요청 처리 결과를 확인하지 못했습니다.',
                            code: -32000,
                            data: { code: 'TIMEOUT', httpStatus: 408, path: operation },
                        },
                    };
                }
                return response({ ok: true });
            }
            if (operation === 'general.buildNationCandidate') {
                state.buildNationCandidateInputs?.push(jsonInput);
                state.buildNationCandidateAttempts = (state.buildNationCandidateAttempts ?? 0) + 1;
                if (state.buildNationCandidateAttempts === 1) {
                    return {
                        error: {
                            message: '요청 처리 결과를 확인하지 못했습니다.',
                            code: -32000,
                            data: { code: 'TIMEOUT', httpStatus: 408, path: operation },
                        },
                    };
                }
                return response({ ok: true });
            }
            if (operation === 'general.dieOnPrestart') {
                state.dieOnPrestartInputs?.push(jsonInput);
                state.dieOnPrestartAttempts = (state.dieOnPrestartAttempts ?? 0) + 1;
                if (state.dieOnPrestartAttempts === 1) {
                    return {
                        error: {
                            message: '요청은 접수됐지만 처리 결과를 아직 확인하지 못했습니다.',
                            code: -32000,
                            data: { code: 'TIMEOUT', httpStatus: 408, path: operation },
                        },
                    };
                }
                return response({ ok: true });
            }
            if (operation === 'general.setMySetting') {
                state.settingMutations.push(jsonInput);
                state.myset = Math.max(0, state.myset - 1);
                return response({ ok: true });
            }
            if (operation === 'general.adjustIcon') {
                state.adjustIconInputs?.push(jsonInput);
                return response({ ok: true, generalId: 7, updated: true });
            }
            if (operation === 'public.recordAccess') {
                const pageName = typeof jsonInput.page === 'string' ? jsonInput.page : null;
                if (pageName) state.accessPages.push(pageName);
                return response({ recorded: true });
            }
            if (operation === 'nation.getBattleCenter') {
                if (state.permission === 'member') {
                    return {
                        error: {
                            message: '권한이 부족합니다.',
                            code: -32000,
                            data: { code: 'FORBIDDEN', httpStatus: 403, path: operation },
                        },
                    };
                }
                return response(battleCenter(state));
            }
            if (operation === 'nation.getGeneralLog') {
                const type =
                    typeof jsonInput.type === 'string' &&
                    ['generalHistory', 'battleDetail', 'battleResult', 'generalAction'].includes(jsonInput.type)
                        ? jsonInput.type
                        : 'generalAction';
                return response({
                    type,
                    generalId: 7,
                    logs: [{ id: 1, text: state.hiddenSeedLogText ?? `<Y>${type} 감찰 기록</>` }],
                });
            }
            return response({ ok: true });
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(operations.length === 1 ? results[0] : results),
        });
    });
};

test('정화된 국가 방침은 실행 가능한 속성 없이 Chromium에 표시된다', async ({ page }) => {
    const state: FixtureState = {
        permission: 'head',
        myset: 0,
        nationNoticeInput: [
            '<p data-flip="horizontal" style="color:#00ffff">안전한 방침</p>',
            '<img src="/image/icons/default.jpg" />',
            '<a>위험 링크</a>',
        ].join(''),
        settingMutations: [],
        accessPages: [],
    };
    await install(page, state);

    await page.goto('');

    const notice = page.locator('.nation-notice-body');
    await expect(notice).toContainText('안전한 방침');
    await expect(notice.locator('[data-flip="horizontal"]')).toHaveCSS('color', 'rgb(0, 255, 255)');
    await expect(notice.locator('script, svg, [onerror], [onload], [onclick]')).toHaveCount(0);
    await expect(notice.locator('a', { hasText: '위험 링크' })).not.toHaveAttribute('href');
    await expect
        .poll(() => page.evaluate(() => (globalThis as typeof globalThis & { __nationXss?: number }).__nationXss))
        .toBeUndefined();
});

test('재야 메인은 국가 틀과 성격·특기 표기명을 Chromium에 표시한다', async ({ page }) => {
    const state: FixtureState = {
        permission: 'member',
        myset: 0,
        buildNationCandidateEnabled: true,
        mainTraits: { personal: '안전', specialDomestic: '상재', specialWar: '신산' },
        settingMutations: [],
        accessPages: [],
    };
    await install(page, state);
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('');

    const nationCard = page.locator('.nation-card');
    await expect(nationCard.locator('.title')).toHaveText('재야');
    await expect(nationCard.locator('.empty')).toHaveCount(0);
    await expect(nationCard.locator('.grid strong')).toHaveText(Array.from({ length: 6 }, () => '해당 없음'));

    const generalCard = page.locator('.general-card');
    await expect(generalCard).toContainText('성격안전');
    await expect(generalCard).toContainText('특기상재 / 신산');
    await expect(generalCard).not.toContainText('che_');
    await expect(generalCard).toHaveAttribute('data-general-basic-card', '');
    const mainImages = await readGeneralPanelImages(generalCard);
    expect(mainImages).toHaveLength(2);
    expect(mainImages[0]).toMatchObject({ width: 64, height: 64, pointerEvents: 'none', userSelect: 'none' });
    expect(mainImages[0]?.backgroundImage).toContain('/icons/default.jpg');
    expect(mainImages[1]).toMatchObject({ width: 64, height: 64, pointerEvents: 'none', userSelect: 'none' });
    expect(mainImages[1]?.backgroundImage).toContain('/game/crewtype1.png');

    const geometry = await nationCard.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const title = element.querySelector<HTMLElement>('.title')!;
        return {
            width: rect.width,
            height: rect.height,
            titleBackground: getComputedStyle(title).backgroundColor,
            placeholderCount: [...element.querySelectorAll('.grid strong')].filter(
                (cell) => cell.textContent?.trim() === '해당 없음'
            ).length,
        };
    });
    expect(geometry.width).toBeGreaterThan(0);
    expect(geometry.height).toBeGreaterThan(0);
    expect(geometry.titleBackground).toBe('rgb(0, 0, 0)');
    expect(geometry.placeholderCount).toBe(6);
    await persistParityArtifact(page, 'main-neutral-trait-display', geometry);
});

test('메인 카드의 국가·수도·관직·계급·병종은 Ref 출력명으로 표시된다', async ({ page }) => {
    const state: FixtureState = {
        permission: 'head',
        myset: 3,
        mainTraits: { personal: '안전', specialDomestic: '상재', specialWar: '신산' },
        settingMutations: [],
        accessPages: [],
    };
    await install(page, state);
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('');

    const nationCard = page.locator('.nation-card');
    await expect(nationCard.locator('.title')).toHaveText('위 (주자사)');
    await expect(nationCard).toContainText('체제법가');
    await expect(nationCard).toContainText('수도업');
    await expect(nationCard).toContainText('국가 등급주자사');

    const generalCard = page.locator('.general-card');
    await expect(generalCard.locator('.general-title')).toContainText('검증장수 【 간의대부 | 건강 】');
    await expect(generalCard).toContainText('병종보병');
    await expect(generalCard).toContainText('계급 29품관');

    const cityCard = page.locator('.city-card');
    await expect(cityCard.locator('.title')).toContainText('【중원 | 특】 업');
    await expect(cityCard.locator('.title')).toContainText('지배 국가 【 위 】');
    await expect(page.locator('.main-page')).not.toContainText('che_');
});

test('메인 장수 동향과 개인 전투 기록은 모두 21px 행 간격을 유지한다', async ({ page }) => {
    const state: FixtureState = {
        permission: 'head',
        myset: 3,
        settingMutations: [],
        accessPages: [],
        recentRecords: {
            global: [
                {
                    id: 18611,
                    text:
                        '<C>●</>9월:<D><b>위</b></>의 <Y>Administrator</>가 <G><b>낙양</b></>으로 ' +
                        '진격합니다.<span class="hidden_but_copyable">(전투시드: 0123456789abcdef)</span>',
                },
                {
                    id: 18610,
                    text: '<C>●</>9월:<Y>Administrator</>가 <D><b>위</b></>에 <S>임관</>했습니다.',
                },
                {
                    id: 18609,
                    text: '<C>●</>9월:<Y>뇌동</>의 기병이 퇴각했습니다.',
                },
            ],
            general: [
                {
                    id: 18608,
                    text:
                        '<S>◆</>186년 9월:<div class="small_war_log">' +
                        '<span class="me"><span class="crew_type">귀병</span> ' +
                        '<span class="name_plate_cover">【<span class="name">Administrator</span>】</span> ' +
                        '<span class="remain_crew">0</span>(<span class="killed_crew">-2209</span>)</span> ' +
                        '<span class="war_type war_type_defense">←</span> ' +
                        '<span class="you"><span class="remain_crew">1361</span>' +
                        '(<span class="killed_crew">-5539</span>) <span class="crew_type">기병</span> ' +
                        '<span class="name_plate_cover">【<span class="name">ⓝ뇌동</span>】</span></span></div>',
                    createdAt: '2026-01-01T03:54:00.000Z',
                },
            ],
            history: [],
        },
    };
    await install(page, state);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('');

    const inspectGlobalRhythm = async (selector: string) => {
        const lines = page.locator(selector);
        await expect(lines).toHaveCount(3);
        return lines.evaluateAll((elements) =>
            elements.map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                    top: rect.top,
                    height: rect.height,
                    lineHeight: getComputedStyle(element).lineHeight,
                };
            })
        );
    };
    const assertUniformGlobalRhythm = (geometry: Awaited<ReturnType<typeof inspectGlobalRhythm>>) => {
        expect(geometry.map((line) => line.height)).toEqual([21, 21, 21]);
        expect(geometry.map((line) => line.lineHeight)).toEqual(['21px', '21px', '21px']);
        expect(geometry[1]!.top - geometry[0]!.top).toBe(21);
        expect(geometry[2]!.top - geometry[1]!.top).toBe(21);
    };

    const desktopGlobalGeometry = await inspectGlobalRhythm('.record-zone [data-record-bucket="global"] .record-line');
    assertUniformGlobalRhythm(desktopGlobalGeometry);
    await persistParityArtifact(page, 'core-main-trend-log-rhythm-desktop', desktopGlobalGeometry);

    const expectedText = '◆186년 9월:귀병 【Administrator】 0(-2209) ← 1361(-5539) 기병 【ⓝ뇌동】 12:54';
    const inspect = async (line: Locator) => {
        await expect(line).toContainText(expectedText);
        return line.evaluate((element) => {
            const lineRect = element.getBoundingClientRect();
            const battle = element.querySelector<HTMLElement>('.small_war_log');
            if (!battle) throw new Error('전투 요약 markup을 찾지 못했습니다.');
            const battleRect = battle.getBoundingClientRect();
            return {
                line: { top: lineRect.top, height: lineRect.height },
                battle: {
                    top: battleRect.top,
                    height: battleRect.height,
                    display: getComputedStyle(battle).display,
                },
                lineHeight: getComputedStyle(element).lineHeight,
            };
        });
    };
    const assertSingleLine = (geometry: Awaited<ReturnType<typeof inspect>>) => {
        expect(geometry.battle.display).toBe('inline-block');
        expect(geometry.line.height).toBe(21);
        expect(geometry.battle.height).toBe(21);
        expect(geometry.battle.top).toBeCloseTo(geometry.line.top, 0);
    };

    const desktopGeometry = await inspect(
        page.locator('.record-zone [data-record-bucket="general"] .record-line').first()
    );
    assertSingleLine(desktopGeometry);
    await persistParityArtifact(page, 'core-main-personal-battle-log-inline-desktop', desktopGeometry);

    await page.setViewportSize({ width: 500, height: 900 });
    const mobileGeometry = await inspect(
        page.locator('.record-zone-mobile [data-record-bucket="general"] .record-line').first()
    );
    assertSingleLine(mobileGeometry);
    const mobileGlobalGeometry = await inspectGlobalRhythm(
        '.record-zone-mobile [data-record-bucket="global"] .record-line'
    );
    assertUniformGlobalRhythm(mobileGlobalGeometry);
    await persistParityArtifact(page, 'core-main-trend-log-rhythm-mobile', mobileGlobalGeometry);
    await persistParityArtifact(page, 'core-main-personal-battle-log-inline-mobile', mobileGeometry);
});

test('전투시드는 메인·내 정보·감찰부에서 숨긴 채 선택할 수 있다', async ({ page }) => {
    const seedText = '(전투시드: 0123456789abcdef)';
    const logText =
        '<D><b>위</b></>의 <Y>검증장수</>가 <G><b>낙양</b></>으로 ' +
        `진격합니다.<span class="hidden_but_copyable">${seedText}</span>`;
    const state: FixtureState = {
        permission: 'head',
        myset: 3,
        settingMutations: [],
        accessPages: [],
        hiddenSeedLogText: logText,
        recentRecords: {
            global: [{ id: 18611, text: logText }],
            general: [],
            history: [],
        },
    };
    await install(page, state);

    const inspectHiddenSeed = async (selector: string) => {
        const seed = page.locator(selector);
        await expect(seed).toHaveCount(1);
        return seed.evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const result = {
                text: element.textContent,
                selectedText: selection?.toString(),
                color: style.color,
                fontSize: style.fontSize,
                width: rect.width,
                height: rect.height,
            };
            selection?.removeAllRanges();
            return result;
        });
    };
    const assertHiddenSeed = (result: Awaited<ReturnType<typeof inspectHiddenSeed>>) => {
        expect(result.text).toBe(seedText);
        expect(result.selectedText).toBe(seedText);
        expect(result.color).toBe('rgba(0, 0, 0, 0)');
        expect(result.fontSize).toBe('0px');
        expect(result.width).toBe(0);
        expect(result.height).toBe(0);
    };

    for (const viewport of [
        { width: 1000, height: 900 },
        { width: 500, height: 900 },
    ]) {
        await page.setViewportSize(viewport);

        await page.goto('');
        const mainSeed = await inspectHiddenSeed('[data-record-bucket="global"] .hidden_but_copyable');
        assertHiddenSeed(mainSeed);
        await persistParityArtifact(page, `core-hidden-battle-seed-main-${viewport.width}`, mainSeed);

        await page.goto('my-page');
        const myPageSeed = await inspectHiddenSeed('.log-panel:first-child .hidden_but_copyable');
        assertHiddenSeed(myPageSeed);
        await persistParityArtifact(page, `core-hidden-battle-seed-my-page-${viewport.width}`, myPageSeed);

        await page.goto('battle-center');
        const battleCenterSeed = await inspectHiddenSeed('[data-log-type="generalAction"] .hidden_but_copyable');
        assertHiddenSeed(battleCenterSeed);
        await persistParityArtifact(page, `core-hidden-battle-seed-battle-center-${viewport.width}`, battleCenterSeed);
    }
});

test('메인 개인 기록의 공격·수비 시각은 Ref와 같은 90% 글자 크기로 표시한다', async ({ page }) => {
    const state: FixtureState = {
        permission: 'head',
        myset: 3,
        settingMutations: [],
        accessPages: [],
        recentRecords: {
            global: [],
            general: [
                {
                    id: 18703,
                    text: '<C>●</>10월:천귀병으로 <Y>ⓝ염행</>의 보병을 <M>수비</>합니다.',
                    createdAt: '2026-01-01T03:54:00.000Z',
                },
                {
                    id: 18702,
                    text: '<C>●</>10월:천귀병으로 <Y>ⓝ염행</>의 보병을 <M>공격</>합니다.',
                    createdAt: '2026-01-01T03:55:00.000Z',
                },
                {
                    id: 18701,
                    text: '<C>●</>10월:이미 기록된 시각 <1>12:34</>',
                    createdAt: '2026-01-01T03:56:00.000Z',
                },
            ],
            history: [],
        },
    };
    await install(page, state);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('');

    const inspect = async (selector: string) => {
        const lines = page.locator(selector);
        await expect(lines).toHaveCount(3);
        await expect(lines.nth(0)).toHaveText('●10월:천귀병으로 ⓝ염행의 보병을 수비합니다. 12:54');
        await expect(lines.nth(1)).toHaveText('●10월:천귀병으로 ⓝ염행의 보병을 공격합니다. 12:55');
        await expect(lines.nth(2)).toHaveText('●10월:이미 기록된 시각 12:34');

        return lines.evaluateAll((elements) =>
            elements.map((element) => {
                const spans = [...element.querySelectorAll<HTMLElement>('span')];
                const time = spans.find((span) => /^\d{2}:\d{2}$/u.test(span.textContent ?? ''));
                const name = spans.find((span) => span.textContent === 'ⓝ염행');
                const action = spans.find((span) => span.textContent === '수비' || span.textContent === '공격');
                if (!time) throw new Error('개인 기록 시각 span을 찾지 못했습니다.');
                const rect = element.getBoundingClientRect();
                return {
                    text: element.textContent,
                    row: {
                        width: rect.width,
                        height: rect.height,
                        clientWidth: element.clientWidth,
                        scrollWidth: element.scrollWidth,
                        fontSize: getComputedStyle(element).fontSize,
                        lineHeight: getComputedStyle(element).lineHeight,
                    },
                    time: {
                        fontSize: getComputedStyle(time).fontSize,
                        lineHeight: getComputedStyle(time).lineHeight,
                    },
                    nameFontSize: name ? getComputedStyle(name).fontSize : null,
                    actionFontSize: action ? getComputedStyle(action).fontSize : null,
                    timeSpanCount: spans.filter((span) => /^\d{2}:\d{2}$/u.test(span.textContent ?? '')).length,
                };
            })
        );
    };
    const assertFontContract = (measurements: Awaited<ReturnType<typeof inspect>>) => {
        expect(measurements.map((entry) => entry.row.fontSize)).toEqual(['14px', '14px', '14px']);
        expect(measurements.map((entry) => entry.row.lineHeight)).toEqual(['21px', '21px', '21px']);
        expect(measurements.map((entry) => entry.row.height)).toEqual([21, 21, 21]);
        expect(measurements.map((entry) => entry.time.fontSize)).toEqual(['12.6px', '12.6px', '12.6px']);
        expect(measurements.map((entry) => entry.timeSpanCount)).toEqual([1, 1, 1]);
        expect(measurements[0]?.nameFontSize).toBe('14px');
        expect(measurements[0]?.actionFontSize).toBe('14px');
        expect(measurements[1]?.nameFontSize).toBe('14px');
        expect(measurements[1]?.actionFontSize).toBe('14px');
        expect(measurements.every((entry) => entry.row.scrollWidth <= entry.row.clientWidth)).toBe(true);
    };

    const desktop = await inspect('.record-zone [data-record-bucket="general"] .record-line');
    assertFontContract(desktop);
    await persistParityArtifact(page, 'core-main-personal-war-log-time-font-desktop', desktop);

    await page.setViewportSize({ width: 500, height: 900 });
    const mobile = await inspect('.record-zone-mobile [data-record-bucket="general"] .record-line');
    assertFontContract(mobile);
    await persistParityArtifact(page, 'core-main-personal-war-log-time-font-mobile', mobile);
});

test('접속량정보 keeps the legacy public 1016px chart geometry', async ({ page }) => {
    const state: FixtureState = { permission: 'member', myset: 0, settingMutations: [], accessPages: [] };
    await install(page, state);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('traffic');
    await expect(page.locator('.chart-title').first()).toHaveText('접 속 량');
    await expect.poll(() => state.accessPages).toContain('traffic');

    const geometry = await page.locator('#traffic-container').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const title = element.querySelector<HTMLElement>('.title-table')!.getBoundingClientRect();
        const charts = [...element.querySelectorAll<HTMLElement>('.chart-table')].map((chart) =>
            chart.getBoundingClientRect()
        );
        const row = element.querySelector<HTMLElement>('.chart-row')!.getBoundingClientRect();
        const bar = element.querySelector<HTMLElement>('.big-bar')!.getBoundingClientRect();
        const suspect = element.querySelector<HTMLElement>('.suspect-table')!.getBoundingClientRect();
        return {
            width: rect.width,
            minWidth: getComputedStyle(element).minWidth,
            fontSize: getComputedStyle(element).fontSize,
            fontFamily: getComputedStyle(element).fontFamily,
            titleWidth: title.width,
            chartWidths: charts.map((chart) => chart.width),
            chartGap: charts[1]!.x - charts[0]!.right,
            rowHeight: row.height,
            barHeight: bar.height,
            suspectWidth: suspect.width,
        };
    });
    expect(geometry.width).toBe(1016);
    expect(geometry.minWidth).toBe('1016px');
    expect(geometry.fontSize).toBe('14px');
    expect(geometry.fontFamily).toContain('Pretendard');
    expect(geometry.titleWidth).toBe(1000);
    expect(geometry.chartWidths).toEqual([483, 483]);
    expect(geometry.chartGap).toBe(26);
    expect(geometry.rowHeight).toBe(31);
    expect(geometry.barHeight).toBe(30);
    expect(geometry.suspectWidth).toBeGreaterThanOrEqual(994);
    await persistParityArtifact(page, 'traffic-desktop', geometry);

    await page.setViewportSize({ width: 500, height: 900 });
    const mobileWidth = await page
        .locator('#traffic-container')
        .evaluate((element) => element.getBoundingClientRect().width);
    expect(mobileWidth).toBe(1016);
});

test('내 정보&설정 keeps desktop density and becomes a 390px horizontal-identity layout', async ({ page }) => {
    const state: FixtureState = { permission: 'head', myset: 3, settingMutations: [], accessPages: [] };
    await install(page, state);
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('my-page');
    await expect(page.locator('.general-table')).toHaveAttribute('data-general-basic-card', '');
    const myPageImages = await readGeneralPanelImages(page.locator('.general-table'));
    expect(myPageImages.map(({ width, height }) => ({ width, height }))).toEqual([
        { width: 64, height: 64 },
        { width: 64, height: 64 },
    ]);
    expect(myPageImages[0]?.backgroundImage).toContain('/icons/default.jpg');
    expect(myPageImages[1]?.backgroundImage).toContain('/game/crewtype1.png');
    await expect(page.locator('.legacy-general-details')).toContainText('계급 29품관');
    await expect(page.locator('.legacy-general-details')).toContainText('병종 보병');
    await expect(page.locator('.item-group')).toContainText('명마');
    await expect(page.locator('#container')).not.toContainText('che_');
    await expect(page.locator('.title-row')).toContainText('내 정 보');
    await expect(page.locator('#set_my_setting')).toBeVisible();
    await expect(page.locator('.general-column [role="progressbar"]')).toHaveCount(14);
    await expect(page.locator('.general-column [aria-label*="1,275,975 (EX+)"]')).toHaveCount(5);
    await expect.poll(() => state.generalMeQueries).toBeGreaterThan(0);
    expect(state.accessPages).not.toContain('my-page');
    const noDefenceOption = page.locator('option[value="999"]');
    await expect(noDefenceOption).toHaveText('× [훈련 -3,사기 -6]');
    await expect(page.locator('#defence_train option')).toHaveText([
        '☆(훈사90)',
        '◎(훈사80)',
        '○(훈사60)',
        '△(훈사40)',
        '× [훈련 -3,사기 -6]',
    ]);

    const desktop = await page.locator('#container').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const title = element.querySelector<HTMLElement>('.title-row')!.getBoundingClientRect();
        const settings = element.querySelector<HTMLElement>('.settings-column')!.getBoundingClientRect();
        const saveButton = element.querySelector<HTMLElement>('#set_my_setting')!;
        const save = saveButton.getBoundingClientRect();
        const customCss = element.querySelector<HTMLElement>('#custom_css')!.getBoundingClientRect();
        const columns = getComputedStyle(element.querySelector('.top-grid')!).gridTemplateColumns;
        return {
            width: rect.width,
            minWidth: getComputedStyle(element).minWidth,
            fontSize: getComputedStyle(element).fontSize,
            columns,
            titleHeight: title.height,
            settingsOffset: settings.x - rect.x,
            saveWidth: save.width,
            saveHeight: save.height,
            saveBackground: getComputedStyle(saveButton).backgroundColor,
            customCssWidth: customCss.width,
            customCssHeight: customCss.height,
            backgroundImage: getComputedStyle(element).backgroundImage,
            sectionBackgroundImage: getComputedStyle(element.querySelector('.section-title')!).backgroundImage,
        };
    });
    expect(desktop.width).toBe(1000);
    expect(desktop.minWidth).toBe('0px');
    expect(desktop.fontSize).toBe('14px');
    expect(desktop.columns.split(' ')).toHaveLength(2);
    expect(desktop.titleHeight).toBeCloseTo(54, 0);
    expect(desktop.settingsOffset).toBeCloseTo(500, 0);
    expect(desktop.saveWidth).toBe(160);
    expect(desktop.saveHeight).toBe(30);
    expect(desktop.saveBackground).toBe('rgb(34, 85, 0)');
    expect(desktop.customCssWidth).toBe(420);
    expect(desktop.customCssHeight).toBe(150);
    expect(desktop.backgroundImage).toContain('back_walnut.jpg');
    expect(desktop.sectionBackgroundImage).toContain('back_green.jpg');
    await persistParityArtifact(page, 'core-my-page-desktop', desktop);

    const defenceSelect = page.locator('select').filter({ has: page.locator('option[value="999"]') });
    await defenceSelect.selectOption('999');
    const noEffectState = await defenceSelect.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            scenarioEffect: null,
            optionText: element.querySelector<HTMLOptionElement>('option[value="999"]')?.textContent,
            selectedText: element.querySelector<HTMLOptionElement>('option:checked')?.textContent,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            color: style.color,
            backgroundColor: style.backgroundColor,
        };
    });
    expect(noEffectState.rect.width).toBe(134);
    expect(noEffectState.rect.height).toBe(20);
    await persistParityArtifact(page, 'core-my-page-no-effect-999', noEffectState);
    await page.locator('#set_my_setting').click();
    await expect.poll(() => state.settingMutations.length).toBe(1);
    expect(state.settingMutations[0]).not.toHaveProperty('generalId');

    for (const [effectIndex, scenarioEffect] of [
        'event_UnlimitedDefenceThresholdChange',
        'event_StrongAttacker',
        'event_MoreEffect',
    ].entries()) {
        state.scenarioEffect = scenarioEffect;
        state.myset = 1;
        await page.reload();
        await expect(noDefenceOption).toHaveText('×');
        await defenceSelect.selectOption('999');
        const effectState = await defenceSelect.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                optionText: element.querySelector<HTMLOptionElement>('option[value="999"]')?.textContent,
                selectedText: element.querySelector<HTMLOptionElement>('option:checked')?.textContent,
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                fontSize: style.fontSize,
                lineHeight: style.lineHeight,
                color: style.color,
                backgroundColor: style.backgroundColor,
            };
        });
        expect(effectState.optionText).toBe('×');
        expect(effectState.selectedText).toBe('×');
        expect(effectState.rect.width).toBe(86);
        expect(effectState.rect.height).toBe(20);
        await persistParityArtifact(page, `core-my-page-${scenarioEffect}`, effectState);
        await page.locator('#set_my_setting').click();
        await expect.poll(() => state.settingMutations.length).toBe(effectIndex + 2);
        expect(state.settingMutations.at(-1)).not.toHaveProperty('generalId');
    }

    await page.setViewportSize({ width: 390, height: 900 });
    await page.reload();
    const mobile = await page.locator('#container').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const settings = element.querySelector<HTMLElement>('.settings-column')!.getBoundingClientRect();
        const icon = element
            .querySelector<HTMLElement>('[data-general-basic-card] .general-icon')!
            .getBoundingClientRect();
        const name = element
            .querySelector<HTMLElement>('[data-general-basic-card] .general-title')!
            .getBoundingClientRect();
        return {
            width: rect.width,
            scrollWidth: document.documentElement.scrollWidth,
            columns: getComputedStyle(element.querySelector('.top-grid')!).gridTemplateColumns,
            settingsOffset: settings.x - rect.x,
            settingsWidth: settings.width,
            identity: {
                iconRight: icon.right,
                nameLeft: name.left,
                iconTop: icon.top,
                iconBottom: icon.bottom,
                nameTop: name.top,
                nameBottom: name.bottom,
            },
        };
    });
    expect(mobile).toMatchObject({
        width: 390,
        scrollWidth: 390,
        columns: '390px',
        settingsOffset: 0,
        settingsWidth: 390,
    });
    expect(mobile.identity.nameLeft).toBeGreaterThanOrEqual(mobile.identity.iconRight - 1);
    expect(mobile.identity.nameTop).toBeLessThan(mobile.identity.iconBottom);
    expect(mobile.identity.nameBottom).toBeGreaterThan(mobile.identity.iconTop);
    await persistParityArtifact(page, 'core-my-page-mobile', mobile);
});

for (const [label, failure] of [
    ['daemon timeout', 'TIMEOUT'],
    ['engine transaction 오류', 'INTERNAL_SERVER_ERROR'],
] as const) {
    test(`내 정보 기본 출력은 ${label}에도 표시되고 사전 삭제 동작만 비활성화된다`, async ({ page }) => {
        const state: FixtureState = {
            permission: 'head',
            myset: 3,
            ensurePrestartFailure: failure,
            settingMutations: [],
            accessPages: [],
        };
        await install(page, state);
        await page.setViewportSize({ width: 1000, height: 900 });
        await page.goto('my-page');

        await expect(page.locator('.general-table')).toContainText('검증장수');
        await expect(page.locator('#set_my_setting')).toBeVisible();
        await expect(page.locator('.log-panel').first()).toContainText('기록');
        await expect(page.locator('.error-row')).toHaveCount(0);

        const statusError = page.locator('.prestart-status-error');
        await expect(statusError).toBeVisible();
        await expect(statusError.getByRole('button', { name: '장수 삭제' })).toBeDisabled();
        await expect(statusError.getByRole('button', { name: '상태 재확인' })).toBeEnabled();
        await expect.poll(() => state.ensurePrestartQueries).toBe(1);
    });
}

test('내 정보에서 사람 장수의 등록 전콘을 골라 변경한다', async ({ page }) => {
    const iconId = '3f804277-584f-4f44-b39c-9ecf40d1ed31';
    const state: FixtureState = {
        permission: 'member',
        myset: 1,
        settingMutations: [],
        accessPages: [],
        iconChoices: [
            {
                id: iconId,
                picture: 'mine.png',
                imageServer: 1,
                createdAt: '2026-08-01T00:00:00.000Z',
            },
        ],
        adjustIconInputs: [],
    };
    await install(page, state);
    await page.goto('my-page');
    await expect(page.getByText('전용 아이콘 변경 (24시간에 1회)')).toBeVisible();
    await expect(page.locator('.selected-general-icon img')).toHaveCSS('width', '64px');
    await expect(page.locator('.selected-general-icon img')).toHaveCSS('height', '64px');
    await page.locator('.general-icon-choice input').check();
    page.once('dialog', async (dialog) => dialog.accept());
    await page.getByRole('button', { name: '아이콘 변경' }).click();
    await expect.poll(() => state.adjustIconInputs?.length ?? 0).toBe(1);
    expect(state.adjustIconInputs?.[0]).toMatchObject({ iconId });
    expect(state.adjustIconInputs?.[0]?.clientRequestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
});

test('장수 생성에서 등록 전콘을 골라 생성 요청에 전달한다', async ({ page }) => {
    const firstIconId = '3f804277-584f-4f44-b39c-9ecf40d1ed31';
    const secondIconId = 'f6af46a2-809a-481d-b66d-0f7bbb706780';
    const state: FixtureState = {
        permission: 'member',
        myset: 1,
        settingMutations: [],
        accessPages: [],
        createGeneralInputs: [],
        joinConfig: {
            rules: { stat: { total: 150, min: 30, max: 70 }, allowCustomName: true },
            user: {
                id: 'user-1',
                displayName: '생성장수',
                canCreateGeneral: true,
                preferredPicture: 'first.png',
                icons: [
                    {
                        id: firstIconId,
                        picture: 'first.png',
                        imageServer: 1,
                        createdAt: '2026-07-31T00:00:00.000Z',
                    },
                    {
                        id: secondIconId,
                        picture: 'second.png',
                        imageServer: 1,
                        createdAt: '2026-08-01T00:00:00.000Z',
                    },
                ],
            },
            personalities: [{ key: 'Random', name: '???', info: '무작위 성격' }],
            nations: [],
            selectionPool: { enabled: false },
            npcPossession: { enabled: false },
            inherit: null,
        },
    };
    await install(page, state);
    await page.goto('join');

    const choices = page.getByRole('radiogroup', { name: '전용 아이콘 선택' }).getByRole('radio');
    await expect(choices).toHaveCount(2);
    await expect(choices.nth(0)).toBeChecked();
    await choices.nth(1).check();
    await page.getByRole('button', { name: '장수 생성', exact: true }).last().click();

    await expect.poll(() => state.createGeneralInputs?.length ?? 0).toBe(1);
    expect(state.createGeneralInputs?.[0]).toMatchObject({ pic: true, iconId: secondIconId });
});

test('내 정보 즉시행동은 timeout 재시도 ID를 유지하고 성공 후 새 ID를 만든다', async ({ page }) => {
    const state: FixtureState = {
        permission: 'head',
        myset: 3,
        instantRetreatEnabled: true,
        instantRetreatAttempts: 0,
        instantRetreatInputs: [],
        generalMeQueries: 0,
        generalLogQueries: 0,
        ensurePrestartQueries: 0,
        settingMutations: [],
        accessPages: [],
    };
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
        dialogs.push(`${dialog.type()}:${dialog.message()}`);
        await dialog.accept();
    });
    await install(page, state);
    await page.goto('my-page');

    const instantRetreatButton = page.getByRole('button', { name: '접경 귀환' });
    await expect(instantRetreatButton).toBeVisible();
    await expect.poll(() => state.generalMeQueries).toBe(1);
    await expect.poll(() => state.ensurePrestartQueries).toBe(1);

    await instantRetreatButton.click();
    await expect.poll(() => state.instantRetreatInputs?.length).toBe(1);
    await expect(page.getByTestId('game-toast')).toContainText('요청 처리 결과를 확인하지 못했습니다.');
    await expect.poll(() => state.generalMeQueries).toBe(2);
    await expect.poll(() => state.ensurePrestartQueries).toBe(2);

    await instantRetreatButton.click();
    await expect.poll(() => state.instantRetreatInputs?.length).toBe(2);
    await expect.poll(() => state.generalMeQueries).toBe(3);
    await expect.poll(() => state.ensurePrestartQueries).toBe(3);
    await expect.poll(() => state.generalLogQueries).toBe(12);
    await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame())));

    await instantRetreatButton.click();
    await expect.poll(() => state.instantRetreatInputs?.length).toBe(3);

    const requestIds = state.instantRetreatInputs?.map((input) => input.clientRequestId);
    expect(requestIds?.[0]).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/i));
    expect(requestIds?.[1]).toBe(requestIds?.[0]);
    expect(requestIds?.[2]).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/i));
    expect(requestIds?.[2]).not.toBe(requestIds?.[1]);
    expect(state.instantRetreatInputs?.every((input) => !('generalId' in input))).toBe(true);
});

test('가오픈 장수 삭제는 레거시 표시와 확인을 보존하고 timeout을 같은 ID로 재시도한다', async ({ page }) => {
    const state: FixtureState = {
        permission: 'head',
        myset: 3,
        dieOnPrestartShow: true,
        dieOnPrestartAvailableAt: '2026-01-01T00:20:00.000Z',
        dieOnPrestartAttempts: 0,
        dieOnPrestartInputs: [],
        settingMutations: [],
        accessPages: [],
    };
    const dialogs: string[] = [];
    let confirmCount = 0;
    page.on('dialog', async (dialog) => {
        dialogs.push(`${dialog.type()}:${dialog.message()}`);
        if (dialog.type() === 'confirm') {
            confirmCount += 1;
            if (confirmCount === 1) {
                await dialog.dismiss();
                return;
            }
        }
        await dialog.accept();
    });
    await install(page, state);
    await page.addInitScript(() => {
        localStorage.setItem('sammo-session-token', 'gateway-session-token');
    });
    await page.route(/^http:\/\/127\.0\.0\.1:\d+\/api\/trpc\/me(?:\?|$)/u, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
                response({
                    id: 'gateway-user',
                    username: 'gateway-user',
                    displayName: '게이트웨이 사용자',
                })
            ),
        });
    });
    await page.route('**/gateway/**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><html><body>gateway</body></html>',
        });
    });
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('my-page');

    const actionLine = page.locator('.action-line').filter({ hasText: '가오픈 기간 내 장수 삭제' });
    const deleteButton = actionLine.getByRole('button', { name: '장수 삭제' });
    await expect(actionLine).toContainText('가오픈 기간 내 장수 삭제 (2026-01-01 09:20:00 부터)');
    await expect(deleteButton).toBeVisible();
    await expect(deleteButton).toBeEnabled();
    const geometry = await deleteButton.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            width: rect.width,
            height: rect.height,
            fontSize: style.fontSize,
            color: style.color,
            backgroundColor: style.backgroundColor,
            cursor: style.cursor,
        };
    });
    expect(geometry).toEqual({
        width: 160,
        height: 30,
        fontSize: '14px',
        color: 'rgb(255, 255, 255)',
        backgroundColor: 'rgb(34, 85, 0)',
        cursor: 'pointer',
    });
    await persistParityArtifact(page, 'core-my-page-die-on-prestart', geometry);

    await deleteButton.click();
    await expect.poll(() => confirmCount).toBe(1);
    expect(dialogs[0]).toBe('confirm:정말로 삭제하시겠습니까?');
    expect(state.dieOnPrestartInputs).toHaveLength(0);

    const timeoutReload = page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame());
    await deleteButton.click();
    await expect.poll(() => state.dieOnPrestartInputs?.length).toBe(1);
    const failureDialog = page.getByRole('alertdialog', { name: '장수 삭제 실패' });
    await expect(failureDialog).toContainText('요청은 접수됐지만 처리 결과를 아직 확인하지 못했습니다.');
    await failureDialog.getByRole('button', { name: '확인' }).click();
    await timeoutReload;
    await page.waitForLoadState('networkidle');
    await expect(deleteButton).toBeVisible();
    const pendingRequestId = await page.evaluate(() => sessionStorage.getItem('sam.pending.dieOnPrestart'));
    expect(pendingRequestId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/i));

    await deleteButton.click();
    await expect.poll(() => state.dieOnPrestartInputs?.length).toBe(2);
    await page.waitForURL(/\/gateway\/$/u);
    await expect(page.locator('body')).toHaveText('gateway');

    const requestIds = state.dieOnPrestartInputs?.map((input) => input.clientRequestId);
    expect(requestIds).toEqual([pendingRequestId, pendingRequestId]);
    expect(state.dieOnPrestartInputs?.every((input) => !('generalId' in input) && !('userId' in input))).toBe(true);
    const storage = await page.evaluate(() => ({
        gameToken: localStorage.getItem('sammo-game-token'),
        gameProfile: localStorage.getItem('sammo-game-profile'),
        sessionToken: localStorage.getItem('sammo-session-token'),
        pendingRequestId: sessionStorage.getItem('sam.pending.dieOnPrestart'),
    }));
    expect(storage).toEqual({
        gameToken: null,
        gameProfile: 'che:default',
        sessionToken: 'gateway-session-token',
        pendingRequestId: null,
    });
});

test('사전 거병은 timeout reload 뒤 같은 ID를 재시도하고 성공 reload 뒤 새 ID를 만든다', async ({ page }) => {
    const state: FixtureState = {
        permission: 'head',
        myset: 3,
        buildNationCandidateEnabled: true,
        buildNationCandidateAttempts: 0,
        buildNationCandidateInputs: [],
        ensurePrestartQueries: 0,
        settingMutations: [],
        accessPages: [],
    };
    page.on('dialog', (dialog) => dialog.accept());
    await install(page, state);
    await page.goto('my-page');

    const build = page.getByRole('button', { name: '사전 거병' });
    await expect(build).toBeVisible();
    await expect.poll(() => state.ensurePrestartQueries).toBe(1);

    await build.click();
    await expect.poll(() => state.buildNationCandidateInputs?.length).toBe(1);
    await expect.poll(() => state.ensurePrestartQueries).toBe(2);

    await build.click();
    await expect.poll(() => state.buildNationCandidateInputs?.length).toBe(2);
    await expect.poll(() => state.ensurePrestartQueries).toBe(3);

    await build.click();
    await expect.poll(() => state.buildNationCandidateInputs?.length).toBe(3);
    const requestIds = state.buildNationCandidateInputs?.map((input) => input.clientRequestId);
    expect(requestIds?.[1]).toBe(requestIds?.[0]);
    expect(requestIds?.[2]).not.toBe(requestIds?.[1]);
});

test('감찰부 keeps the selector interaction and shows the permission error path', async ({ page }) => {
    const head: FixtureState = { permission: 'head', myset: 3, settingMutations: [], accessPages: [] };
    await install(page, head);
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('battle-center');
    await expect(page.getByRole('heading', { name: '감찰부' })).toBeVisible();
    await expect(page.locator('.selector-row select').nth(1)).toHaveValue('8');
    await page.getByRole('button', { name: '다음 ▶' }).click();
    await expect(page.locator('.selector-row select').nth(1)).toHaveValue('7');
    await expect(page.locator('.battle-general-name')).toContainText('검증장수');
    await expect(page.locator('.battle-general-name')).toContainText('간의대부');
    await expect(page.locator('.battle-general-name')).toContainText('건강');
    await expect(page.locator('.battle-general-extra')).toContainText('계급29품관');
    await expect(page.locator('.battle-general-card')).toContainText('병종보병');
    await expect(page.locator('.battle-general-card')).not.toContainText('che_');
    await expect(page.locator('.battle-general-card')).toHaveAttribute('data-general-basic-card', '');
    const battleImages = await readGeneralPanelImages(page.locator('.battle-general-card'));
    expect(battleImages).toHaveLength(2);
    expect(battleImages[0]?.backgroundImage).toContain('/icons/default.jpg');
    expect(battleImages[1]?.backgroundImage).toContain('/game/crewtype1.png');
    await expect(page.locator('.battle-general-card [role="progressbar"]')).toHaveCount(14);
    await expect(page.locator('.battle-general-card [aria-label*="1,275,975 (EX+)"]')).toHaveCount(5);
    await expect(page.locator('.general-meta')).toHaveCount(0);
    await expect(page.locator('.battle-general-extra__recent-value')).toHaveText('01-01 00:00');
    await expect(page.locator('.battle-general-extra__recent-value')).not.toContainText('2026');
    await expect(page.locator('.log-block')).toHaveCount(4);
    await expect(page.locator('.log-block[data-log-type="battleResult"]')).toContainText('battleResult 감찰 기록');
    expect(
        await page
            .locator('.battle-general-card [role="progressbar"]')
            .first()
            .evaluate((bar) => getComputedStyle(bar).backgroundImage)
    ).toContain('/game/pr8.gif');
    const geometry = await page.locator('.battle-page').evaluate((element) => {
        const selector = element.querySelector<HTMLElement>('.selector-row')!;
        const controls = [...selector.children].map((child) => (child as HTMLElement).getBoundingClientRect());
        const logBlocks = [...element.querySelectorAll<HTMLElement>('.log-block')];
        const logBlock = logBlocks[0]!.getBoundingClientRect();
        const recentLabel = element.querySelector<HTMLElement>('.battle-general-extra__recent-label')!;
        const recentValue = element.querySelector<HTMLElement>('.battle-general-extra__recent-value')!;
        const previousStat = recentLabel.previousElementSibling as HTMLElement;
        return {
            width: element.getBoundingClientRect().width,
            fontSize: getComputedStyle(element).fontSize,
            selectorColumns: getComputedStyle(selector).gridTemplateColumns,
            selectorHeight: selector.getBoundingClientRect().height,
            controlWidths: controls.map((control) => control.width),
            logBlockWidth: logBlock.width,
            backgroundImage: getComputedStyle(element).backgroundImage,
            generalBackgroundImage: getComputedStyle(element.querySelector<HTMLElement>('.battle-general-card')!)
                .backgroundImage,
            logBackgroundImages: logBlocks.map((block) => getComputedStyle(block).backgroundImage),
            recentLabelTop: recentLabel.getBoundingClientRect().top,
            recentValueTop: recentValue.getBoundingClientRect().top,
            recentValueWidth: recentValue.getBoundingClientRect().width,
            previousStatTop: previousStat.getBoundingClientRect().top,
        };
    });
    expect(geometry.width).toBe(1000);
    expect(geometry.fontSize).toBe('14px');
    expect(geometry.selectorColumns.split(' ')).toHaveLength(4);
    expect(geometry.selectorHeight).toBeCloseTo(36, 0);
    expect(geometry.controlWidths[0]).toBeCloseTo(83.33, 0);
    expect(geometry.controlWidths[1]).toBeCloseTo(333.33, 0);
    expect(geometry.logBlockWidth).toBeCloseTo(500, 0);
    expect(geometry.backgroundImage).toContain('back_walnut.jpg');
    expect(geometry.generalBackgroundImage).toContain('back_blue.jpg');
    expect(geometry.logBackgroundImages).toHaveLength(4);
    expect(geometry.logBackgroundImages.every((background) => background.includes('back_walnut.jpg'))).toBe(true);
    expect(geometry.recentLabelTop).toBeCloseTo(geometry.recentValueTop, 0);
    expect(geometry.recentLabelTop).toBeGreaterThan(geometry.previousStatTop);
    expect(geometry.recentValueWidth).toBeGreaterThan(400);
    await persistParityArtifact(page, 'core-battle-center-desktop', geometry);

    await page.setViewportSize({ width: 500, height: 900 });
    const mobileGeometry = await page.locator('.battle-page').evaluate((element) => {
        const selector = element.querySelector<HTMLElement>('.selector-row')!;
        const battleResult = element.querySelector<HTMLElement>('.log-block[data-log-type="battleResult"]')!;
        const footer = element.querySelector<HTMLElement>('.battle-footer')!;
        const pageRect = element.getBoundingClientRect();
        const resultRect = battleResult.getBoundingClientRect();
        const footerRect = footer.getBoundingClientRect();
        return {
            columns: getComputedStyle(selector).gridTemplateColumns,
            controlWidths: [...selector.children].map((child) => (child as HTMLElement).getBoundingClientRect().width),
            pageHeight: pageRect.height,
            pageOverflow: getComputedStyle(element).overflow,
            resultBottomWithinPage: resultRect.bottom <= pageRect.bottom,
            footerAfterResult: footerRect.top >= resultRect.bottom,
            resultBackgroundImage: getComputedStyle(battleResult).backgroundImage,
        };
    });
    expect(mobileGeometry.columns.split(' ')).toHaveLength(4);
    expect(mobileGeometry.controlWidths[0]).toBeCloseTo(83.33, 0);
    expect(mobileGeometry.controlWidths[1]).toBeCloseTo(125, 0);
    expect(mobileGeometry.pageHeight).toBeGreaterThan(0);
    expect(mobileGeometry.pageOverflow).toBe('visible');
    expect(mobileGeometry.resultBottomWithinPage).toBe(true);
    expect(mobileGeometry.footerAfterResult).toBe(true);
    expect(mobileGeometry.resultBackgroundImage).toContain('back_walnut.jpg');
    await page.locator('.log-block[data-log-type="battleResult"]').scrollIntoViewIfNeeded();
    await expect(page.locator('.log-block[data-log-type="battleResult"]')).toBeInViewport();
    await persistParityArtifact(page, 'core-battle-center-mobile', mobileGeometry);

    await page.unrouteAll({ behavior: 'wait' });
    const member: FixtureState = { permission: 'member', myset: 3, settingMutations: [], accessPages: [] };
    await install(page, member);
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('권한이 부족합니다.');
});
