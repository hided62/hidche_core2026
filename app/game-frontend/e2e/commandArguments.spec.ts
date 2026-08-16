import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameProfile, gameTrpcRoute } from './gameTestPaths.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const imageRoots = [
    resolve(repositoryRoot, '../image'),
    resolve(repositoryRoot, '../../image'),
    resolve(repositoryRoot, '../sam_rebuild/image'),
    resolve(repositoryRoot, '../../sam_rebuild/image'),
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
const imageContentType = (relativePath: string): string => {
    if (relativePath.endsWith('.png')) return 'image/png';
    if (relativePath.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
};

const response = (data: unknown) => ({ result: { data } });
const errorResponse = (path: string, message: string) => ({
    error: {
        message,
        code: -32000,
        data: { code: 'BAD_REQUEST', httpStatus: 400, path },
    },
});
const operations = (route: Route) =>
    decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(',');

const inputOptions = {
    cities: [
        { value: 1, label: '업 (아국)' },
        { value: 2, label: '허창 (적국)', description: '적국 · 예주 · 대도시' },
    ],
    nations: [
        { value: 1, label: '아국', color: '#008000' },
        { value: 2, label: '적국', color: '#800000', description: '수도 허창' },
    ],
    generals: [
        { value: 1, label: '장수 (아국 · 업)' },
        { value: 2, label: '관우 (아국 · 업)' },
    ],
    crewTypes: [{ value: 1100, label: '보병' }],
    armTypes: [{ value: 1, label: '보병' }],
    nationTypes: [{ value: 'che_중립', label: '중립' }],
    colors: [{ value: 0, label: '색상 1', color: '#ff0000' }],
    items: { horse: [{ value: 'None', label: '판매/해제' }] },
    recruitment: {
        techLevel: 1,
        leadership: 68,
        fullLeadership: 70,
        currentCrewTypeId: 1100,
        currentCrewTypeName: '보병',
        crew: 500,
        gold: 12_345,
        groups: [
            {
                armType: 1,
                armName: '보병',
                values: [
                    {
                        id: 1100,
                        armType: 1,
                        name: '보병',
                        available: true,
                        special: false,
                        attack: 125,
                        defence: 175,
                        speed: 7,
                        avoid: 10,
                        baseCost: 10.35,
                        baseRice: 10.35,
                        info: ['표준적인 보병입니다.', '보병은 방어특화입니다.'],
                    },
                    {
                        id: 1101,
                        armType: 1,
                        name: '정예병',
                        available: false,
                        special: true,
                        attack: 175,
                        defence: 225,
                        speed: 8,
                        avoid: 20,
                        baseCost: 13.8,
                        baseRice: 11.5,
                        info: ['강력하지만 기술이 필요합니다.'],
                    },
                ],
            },
        ],
    },
    context: {
        actorGold: 1000,
        actorRice: 1000,
        citySecurity: 500,
        nationGold: 5000,
        nationRice: 6000,
        nationLevel: 1,
    },
};
const commandTable = {
    general: [
        {
            category: '계략',
            values: [
                {
                    key: 'che_화계',
                    name: '화계',
                    reqArg: true,
                    possible: false,
                    status: 'blocked',
                    reason: '현재 조건에서는 실행할 수 없습니다.',
                    inputFields: [
                        {
                            key: 'destCityId',
                            label: '대상 도시',
                            kind: 'select',
                            required: true,
                            optionSource: 'cities',
                        },
                    ],
                },
                ...[
                    { key: 'che_선동', name: '선동' },
                    { key: 'che_탈취', name: '탈취' },
                    { key: 'che_파괴', name: '파괴' },
                ].map(({ key, name }) => ({
                    key,
                    name,
                    reqArg: true,
                    possible: true,
                    status: 'needsInput',
                    inputFields: [
                        {
                            key: 'destCityId',
                            label: '대상 도시',
                            kind: 'select',
                            required: true,
                            optionSource: 'cities',
                        },
                    ],
                })),
            ],
        },
        {
            category: '내정',
            values: [
                {
                    key: 'che_징병',
                    name: '징병',
                    reqArg: true,
                    possible: true,
                    status: 'needsInput',
                    inputFields: [
                        { key: 'crewType', label: '병종', kind: 'select', required: true, optionSource: 'crewTypes' },
                        { key: 'amount', label: '수량', kind: 'number', required: true, min: 0, step: 1 },
                    ],
                },
                {
                    key: 'che_모병',
                    name: '모병',
                    reqArg: true,
                    possible: true,
                    status: 'needsInput',
                    inputFields: [
                        { key: 'crewType', label: '병종', kind: 'select', required: true, optionSource: 'crewTypes' },
                        { key: 'amount', label: '수량', kind: 'number', required: true, min: 0, step: 1 },
                    ],
                },
            ],
        },
    ],
    nation: [
        {
            category: '인사',
            values: [
                {
                    key: 'che_포상',
                    name: '포상',
                    reqArg: true,
                    possible: true,
                    status: 'needsInput',
                    inputFields: [
                        { key: 'isGold', label: '물자', kind: 'boolean', required: true },
                        { key: 'amount', label: '수량', kind: 'number', required: true, min: 0, step: 1 },
                        {
                            key: 'destGeneralId',
                            label: '대상 장수',
                            kind: 'select',
                            required: true,
                            optionSource: 'generals',
                        },
                    ],
                },
            ],
        },
        {
            category: '외교',
            values: [
                {
                    key: 'che_선전포고',
                    name: '선전포고',
                    reqArg: true,
                    possible: true,
                    status: 'needsInput',
                    inputFields: [
                        {
                            key: 'destNationId',
                            label: '대상 국가',
                            kind: 'select',
                            required: true,
                            optionSource: 'nations',
                        },
                    ],
                },
            ],
        },
    ],
    inputOptions,
};
const buildSimpleCommand = (key: string, name: string) => ({
    key,
    name,
    reqArg: false,
    possible: true,
    status: 'available',
    inputFields: [],
});
const refChiefCommandTable = {
    general: [],
    nation: [
        { category: '휴식', values: [buildSimpleCommand('휴식', '휴식')] },
        {
            category: '인사',
            values: [
                buildSimpleCommand('che_발령', '발령'),
                buildSimpleCommand('che_포상', '포상'),
                buildSimpleCommand('che_몰수', '몰수'),
                buildSimpleCommand('che_부대탈퇴지시', '부대 탈퇴 지시'),
            ],
        },
        {
            category: '외교',
            values: [
                buildSimpleCommand('che_물자원조', '원조'),
                buildSimpleCommand('che_불가침제의', '불가침 제의'),
                buildSimpleCommand('che_선전포고', '선전포고'),
                buildSimpleCommand('che_종전제의', '종전 제의'),
                buildSimpleCommand('che_불가침파기제의', '불가침 파기 제의'),
            ],
        },
        {
            category: '특수',
            values: [
                buildSimpleCommand('che_초토화', '초토화'),
                buildSimpleCommand('che_천도', '천도'),
                buildSimpleCommand('che_증축', '증축'),
                buildSimpleCommand('che_감축', '감축'),
            ],
        },
        {
            category: '전략',
            values: [
                buildSimpleCommand('che_필사즉생', '필사즉생'),
                buildSimpleCommand('che_백성동원', '백성동원'),
                buildSimpleCommand('che_수몰', '수몰'),
                buildSimpleCommand('che_허보', '허보'),
                buildSimpleCommand('che_의병모집', '의병모집'),
                buildSimpleCommand('che_이호경식', '이호경식'),
                buildSimpleCommand('che_급습', '급습'),
                buildSimpleCommand('che_피장파장', '피장파장'),
            ],
        },
        {
            category: '기타',
            values: [buildSimpleCommand('che_국기변경', '국기변경'), buildSimpleCommand('che_국호변경', '국호변경')],
        },
    ],
    inputOptions,
};
const generalContext = {
    general: {
        id: 1,
        name: '장수',
        nationId: 1,
        cityId: 1,
        officerLevel: 5,
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
    city: {
        id: 1,
        name: '업',
        level: 8,
        levelName: '특',
        region: 1,
        regionName: '하북',
        nationId: 1,
        nationName: '아국',
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
    nation: {
        id: 1,
        name: '아국',
        color: '#008000',
        level: 1,
        levelName: '호족',
        gold: 5000,
        rice: 6000,
        tech: 100,
        typeCode: 'che_중립',
        typeName: '중립',
        capitalCityId: 1,
        capitalCityName: '업',
    },
    settings: {},
    penalties: {},
};
const turns = (count: number) => Array.from({ length: count }, (_, index) => ({ index, action: '휴식', args: {} }));
const chiefCenter = {
    me: { id: 1, officerLevel: 5, nationId: 1 },
    nation: { id: 1, name: '아국', level: 1 },
    currentYear: 200,
    currentMonth: 1,
    turnTermMinutes: 10,
    maxTurns: 12,
    chiefs: [12, 10, 8, 6, 11, 9, 7, 5].map((officerLevel) => ({
        officerLevel,
        name: officerLevel === 5 ? '장수' : null,
        npcState: officerLevel === 5 ? 0 : null,
        turnTime: null,
        revision: 0,
        turns: turns(12),
    })),
};

const install = async (page: Page, rejectGeneral = false, commandTableResponse: unknown = commandTable) => {
    const requests: unknown[] = [];
    const generalTurns = turns(30);
    const nationTurns = turns(12);
    let generalRevision = 0;
    let nationRevision = 0;
    let dashboardLoaded = false;
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_commands');
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
        try {
            await route.fulfill({
                status: 200,
                contentType: imageContentType(relativePath),
                body: await readImage(`game/${relativePath}`),
            });
        } catch {
            await route.fulfill({ status: 404, body: '' });
        }
    });
    await page.route(gameTrpcRoute, async (route) => {
        const names = operations(route);
        const body = route.request().postDataJSON();
        const results = names.map((name) => {
            if (name === 'dashboard.getContextBundleDelta') {
                const initial = !dashboardLoaded;
                dashboardLoaded = true;
                return response({
                    context: initial
                        ? {
                              kind: 'snapshot',
                              revision: 'AAAAAAAAAAAAAAAAAAAAAA',
                              data: generalContext,
                          }
                        : { kind: 'unchanged', revision: 'AAAAAAAAAAAAAAAAAAAAAA' },
                    commandTable: initial
                        ? {
                              kind: 'snapshot',
                              revision: 'BBBBBBBBBBBBBBBBBBBBBB',
                              data: commandTableResponse,
                          }
                        : { kind: 'unchanged', revision: 'BBBBBBBBBBBBBBBBBBBBBB' },
                    boardAccess: initial
                        ? {
                              kind: 'snapshot',
                              revision: 'CCCCCCCCCCCCCCCCCCCCCC',
                              data: { permission: 4, canMeeting: true, canSecret: true },
                          }
                        : { kind: 'unchanged', revision: 'CCCCCCCCCCCCCCCCCCCCCC' },
                });
            }
            if (name === 'general.me') return response(generalContext);
            if (name === 'world.getMapLayout')
                return response({
                    mapName: 'che',
                    cityList: [
                        { id: 1, name: '업', level: 8, region: 1, x: 100, y: 100, path: [2] },
                        { id: 2, name: '허창', level: 7, region: 2, x: 240, y: 180, path: [1] },
                    ],
                    regionMap: { 1: '하북', 2: '예주' },
                    levelMap: { 8: '특' },
                });
            if (name === 'auth.status') return response({ ok: true });
            if (name === 'lobby.info')
                return response({
                    myGeneral: { id: 1, name: '장수' },
                    year: 200,
                    month: 1,
                    turnTerm: 10,
                    userCnt: 1,
                    maxUserCnt: 100,
                    npcCnt: 0,
                    nationCnt: 2,
                });
            if (name === 'join.getConfig') return response({});
            if (name === 'world.getMap')
                return response({
                    result: true,
                    version: 0,
                    startYear: 180,
                    year: 200,
                    month: 1,
                    cityList: [
                        [1, 8, 0, 1, 1, 1],
                        [2, 7, 41, 2, 2, 1],
                    ],
                    nationList: [
                        [1, '아국', '#008000', 1],
                        [2, '적국', '#800000', 2],
                    ],
                    spyList: {},
                    shownByGeneralList: [],
                    myCity: 1,
                    myNation: 1,
                });
            if (name === 'turns.getCommandTable') return response(commandTableResponse);
            if (name === 'nation.getChiefCenter') return response(chiefCenter);
            if (name === 'turns.reserved.getGeneral')
                return response({ turns: generalTurns, revision: generalRevision });
            if (name === 'turns.reserved.getNation') return response({ turns: nationTurns, revision: nationRevision });
            if (name === 'general.getRecentRecords') return response({ global: [], general: [], history: [] });
            if (name === 'general.getFrontStatus')
                return response({
                    onlineUserCount: 1,
                    onlineNations: '아국(1)',
                    onlineGenerals: '장수',
                    nationNotice: '',
                    lastExecuted: null,
                    latestVote: null,
                });
            if (name === 'messages.getRecent')
                return response({
                    private: [],
                    national: [],
                    public: [],
                    diplomacy: [],
                    sequence: -1,
                    hasMore: { private: false, national: false, public: false, diplomacy: false },
                    latestRead: { private: 0, diplomacy: 0 },
                    canRespondDiplomacy: false,
                });
            if (name === 'messages.getContacts') return response({ nation: [] });
            if (name === 'board.getAccess') return response({ canMeeting: false, canSecret: false });
            if (name === 'tournament.getState') return response({ stage: 0 });
            if (name === 'turns.reserved.setGeneralBulk') {
                requests.push(body);
                if (rejectGeneral) return errorResponse(name, '대상 도시를 선택할 수 없습니다.');
                const input = (
                    body as Record<string, { entries: Array<{ turnList: number[]; action: string; args?: unknown }> }>
                )[String(names.indexOf(name))];
                for (const entry of input?.entries ?? []) {
                    for (const index of entry.turnList)
                        generalTurns[index] = { index, action: entry.action, args: entry.args ?? {} };
                }
                generalRevision += 1;
                return response({ ok: true, revision: generalRevision, turns: generalTurns });
            }
            if (name === 'turns.reserved.setNationBulk') {
                requests.push(body);
                const input = (
                    body as Record<string, { entries: Array<{ turnList: number[]; action: string; args?: unknown }> }>
                )[String(names.indexOf(name))];
                for (const entry of input?.entries ?? []) {
                    for (const index of entry.turnList)
                        nationTurns[index] = { index, action: entry.action, args: entry.args ?? {} };
                }
                nationRevision += 1;
                return response({ ok: true, revision: nationRevision, turns: nationTurns });
            }
            return errorResponse(name, `unhandled ${name}`);
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
    return requests;
};

test('renders and accepts every Ref strategy command at mobile width', async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width: 500, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();

    const picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: '계략', exact: true }).click();
    const strategies = [
        { name: '선동', guidance: '선택한 도시에 선동을 실행합니다.' },
        { name: '탈취', guidance: '선택한 도시에 탈취를 실행합니다.' },
        { name: '파괴', guidance: '선택한 도시에 파괴를 실행합니다.' },
        { name: '화계', guidance: '선택한 도시에 화계를 실행합니다.' },
    ];
    for (const strategy of strategies) {
        const button = picker.getByRole('button', { name: strategy.name, exact: true });
        await expect(button).toBeVisible();
        await button.click();
        const form = picker.getByTestId('command-argument-form');
        await expect(form.getByTestId('command-argument-guidance')).toContainText(strategy.guidance);
        await expect(form.locator('select option')).toHaveCount(2);
        await picker.getByRole('button', { name: '명령 다시 선택', exact: true }).click();
    }
    await picker.screenshot({ path: test.info().outputPath('all-strategy-commands-mobile.png') });
});

test('reserves force move, retirement, and resignation from the user command picker', async ({ page }) => {
    const specialCommandTable = {
        general: [
            {
                category: '개인',
                values: [
                    {
                        key: 'che_은퇴',
                        name: '은퇴',
                        reqArg: false,
                        possible: false,
                        status: 'blocked',
                        reason: '나이가 60세 이상이어야 합니다.',
                        inputFields: [],
                    },
                ],
            },
            {
                category: '인사',
                values: [
                    {
                        key: 'che_강행',
                        name: '강행',
                        reqArg: true,
                        possible: true,
                        status: 'available',
                        inputFields: [
                            {
                                key: 'destCityId',
                                label: '대상 도시',
                                kind: 'select',
                                required: true,
                                optionSource: 'cities',
                            },
                        ],
                    },
                ],
            },
            {
                category: '국가',
                values: [
                    {
                        key: 'che_하야',
                        name: '하야',
                        reqArg: false,
                        possible: true,
                        status: 'available',
                        inputFields: [],
                    },
                ],
            },
        ],
        nation: [],
        inputOptions,
    };
    const requests = await install(page, false, specialCommandTable);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/');

    const editor = page.locator('[data-command-scope="general"]');

    await editor.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    let picker = page.getByTestId('command-picker');
    const retirement = picker.getByRole('button', { name: '은퇴', exact: true });
    await expect(retirement).toHaveClass(/blocked/);
    await expect(retirement).toHaveAttribute('title', '나이가 60세 이상이어야 합니다.');
    await retirement.hover();
    await retirement.focus();
    await expect(retirement).toBeFocused();
    await picker.screenshot({ path: test.info().outputPath('special-user-commands-desktop-1200.png') });
    await retirement.click();
    await expect(editor.locator('.action-column > div').nth(0)).toHaveText('은퇴');

    await editor.getByRole('button', { name: '2턴 명령 입력', exact: true }).click();
    picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: '국가', exact: true }).click();
    await picker.getByRole('button', { name: '하야', exact: true }).click();
    await expect(editor.locator('.action-column > div').nth(1)).toHaveText('하야');

    await editor.getByRole('button', { name: '3턴 명령 입력', exact: true }).click();
    picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: '인사', exact: true }).click();
    await picker.getByRole('button', { name: '강행', exact: true }).click();
    const forceMoveForm = picker.getByTestId('command-argument-form');
    await expect(forceMoveForm.getByTestId('command-argument-guidance')).toContainText('선택한 도시로 강행합니다.');
    await forceMoveForm.locator('select').selectOption('2');
    await picker.getByRole('button', { name: '입력', exact: true }).click();
    await expect(editor.locator('.action-column > div').nth(2)).toHaveText('강행');

    const serialized = JSON.stringify(requests);
    expect(serialized).toContain('"action":"che_은퇴","args":{}');
    expect(serialized).toContain('"action":"che_하야","args":{}');
    expect(serialized).toContain('"action":"che_강행","args":{"destCityId":2}');

    await page.setViewportSize({ width: 500, height: 900 });
    await editor.getByRole('button', { name: '4턴 명령 입력', exact: true }).click();
    picker = page.getByTestId('command-picker');
    await expect(picker.locator('.category-btn')).toHaveText(['개인', '인사', '국가']);
    const mobileGeometry = await picker.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        horizontalOverflow: element.scrollWidth - element.clientWidth,
        categoryColumns: getComputedStyle(element.querySelector<HTMLElement>('.category-list')!).gridTemplateColumns,
    }));
    expect(mobileGeometry.width).toBeLessThanOrEqual(500);
    expect(mobileGeometry.horizontalOverflow).toBeLessThanOrEqual(0);
    expect(mobileGeometry.categoryColumns.split(' ')).toHaveLength(3);
    await picker.getByRole('button', { name: '개인', exact: true }).click();
    await expect(picker.getByRole('button', { name: '은퇴', exact: true })).toBeVisible();
    await picker.screenshot({ path: test.info().outputPath('special-user-commands-mobile-500.png') });
});

test('shows every Ref chief command in the exact category and command order', async ({ page }) => {
    await install(page, false, refChiefCommandTable);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/che/chief-center');

    const editor = page.locator('[data-command-scope="nation"]');
    await editor.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const picker = page.getByTestId('command-picker');
    const expected = {
        휴식: ['휴식'],
        인사: ['발령', '포상', '몰수', '부대 탈퇴 지시'],
        외교: ['원조', '불가침 제의', '선전포고', '종전 제의', '불가침 파기 제의'],
        특수: ['초토화', '천도', '증축', '감축'],
        전략: ['필사즉생', '백성동원', '수몰', '허보', '의병모집', '이호경식', '급습', '피장파장'],
        기타: ['국기변경', '국호변경'],
    } as const;

    await expect(picker.locator('.category-btn')).toHaveText(Object.keys(expected));
    for (const [category, commands] of Object.entries(expected)) {
        await picker.locator('.category-btn').filter({ hasText: category }).click();
        await expect(picker.locator('.command-grid .command-item')).toHaveText([...commands]);
    }
    const rename = picker.getByRole('button', { name: '국호변경', exact: true });
    await rename.hover();
    await rename.focus();
    await expect(rename).toBeFocused();
    await picker.screenshot({ path: test.info().outputPath('ref-chief-command-list-desktop-1200.png') });

    await picker.getByRole('button', { name: '명령 입력 닫기', exact: true }).click();
    await page.setViewportSize({ width: 500, height: 900 });
    const mobileEditor = page.locator('[data-command-scope="nation"]:visible');
    await mobileEditor.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const mobilePicker = page.locator('[data-testid="command-picker"]:visible');
    await expect(mobilePicker.locator('.category-btn')).toHaveText(Object.keys(expected));
    const mobileGeometry = await mobilePicker.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        horizontalOverflow: element.scrollWidth - element.clientWidth,
        categoryColumns: getComputedStyle(element.querySelector<HTMLElement>('.category-list')!).gridTemplateColumns,
    }));
    expect(mobileGeometry.width).toBeLessThanOrEqual(500);
    expect(mobileGeometry.horizontalOverflow).toBeLessThanOrEqual(0);
    expect(mobileGeometry.categoryColumns.split(' ')).toHaveLength(3);
    await mobilePicker.screenshot({ path: test.info().outputPath('ref-chief-command-list-mobile-500.png') });
});

test('enters general and nation command arguments and sends exact values', async ({ page }) => {
    const requests = await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/');
    await expect(page.getByTestId('current-city-marker')).toHaveCount(0);

    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    await page.getByTestId('command-picker').getByRole('button', { name: /화계/ }).click();
    const form = page.getByTestId('command-argument-form');
    await expect(form).toBeVisible();
    await expect(form.getByTestId('command-argument-map')).toBeVisible();
    await expect(form.getByTestId('command-argument-guidance')).toContainText('선택한 도시에 화계를 실행합니다.');
    await expect(form.getByTestId('command-map-target-summary')).toContainText('현재 도시에서 0칸');
    const commandMap = form.getByTestId('command-argument-map');
    const currentCityMarker = commandMap.getByTestId('current-city-marker');
    const selectionStatus = form.getByTestId('command-map-selection-status');
    await expect(currentCityMarker).toHaveText('현재');
    await expect(currentCityMarker).toHaveAttribute('aria-label', '현재 도시 업');
    await expect(selectionStatus).toContainText('현재 도시업');
    await expect(selectionStatus).toContainText('선택 도시업');
    const mapCities = commandMap.locator('.city-base');
    await expect(mapCities).toHaveCount(2);
    await expect(commandMap.locator('.city-bg')).toHaveCount(2);
    await expect(commandMap.locator('.city-flag')).toHaveCount(2);
    await expect(commandMap.locator('.city-state')).toHaveCount(1);
    await expect
        .poll(() =>
            commandMap
                .locator('.city-icon')
                .evaluateAll((images: HTMLImageElement[]) =>
                    images.every((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)
                )
        )
        .toBe(true);
    const castleGeometry = await commandMap.locator('.city-icon').evaluateAll((images: HTMLImageElement[]) =>
        images.map((image) => ({
            src: new URL(image.src).pathname,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
            renderedWidth: image.getBoundingClientRect().width,
            renderedHeight: image.getBoundingClientRect().height,
        }))
    );
    expect(castleGeometry).toEqual([
        expect.objectContaining({ src: '/game/cast_8.gif', naturalWidth: 32, naturalHeight: 24 }),
        expect.objectContaining({ src: '/game/cast_7.gif', naturalWidth: 28, naturalHeight: 20 }),
    ]);
    for (const castle of castleGeometry) {
        expect(castle.renderedWidth).toBeGreaterThan(castle.naturalWidth * 0.9);
        expect(castle.renderedHeight).toBeGreaterThan(castle.naturalHeight * 0.9);
        expect(castle.renderedWidth / castle.naturalWidth).toBeCloseTo(castle.renderedHeight / castle.naturalHeight, 2);
    }
    const layerStyles = await commandMap.evaluate((element) => ({
        background: getComputedStyle(element.querySelector<HTMLElement>('.map-bglayer1')!).backgroundImage,
        road: getComputedStyle(element.querySelector<HTMLElement>('.map-bgroad')!).backgroundImage,
    }));
    expect(layerStyles.background).toContain('/game/map/che/bg_spring.jpg');
    expect(layerStyles.road).toContain('/game/map/che/che_road.png');
    await mapCities.nth(1).click();
    await expect(form.locator('select')).toHaveValue('2');
    await expect(form.getByTestId('command-map-target-summary')).toContainText('현재 도시에서 1칸');
    await expect(selectionStatus).toContainText('현재 도시업');
    await expect(selectionStatus).toContainText('선택 도시허창');
    await expect(currentCityMarker).toHaveAttribute('aria-label', '현재 도시 업');
    await expect(mapCities.nth(0)).toHaveClass(/mine/);
    await expect(mapCities.nth(1)).toHaveClass(/selected/);
    await mapCities.nth(1).hover();
    expect(await mapCities.nth(1).evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer');
    await mapCities.nth(1).focus();
    await expect(mapCities.nth(1)).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
    await commandMap.screenshot({ path: test.info().outputPath('main-city-current-marker-desktop.png') });
    const mapGeometry = await form.getByTestId('command-argument-map').evaluate((element) => {
        const area = element.querySelector<HTMLElement>('.map-area')!;
        const rect = area.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
    });
    await page.getByTestId('command-picker').getByRole('button', { name: '입력', exact: true }).click();
    await expect(page.locator('[data-command-scope="general"] .action-column > div').first()).toHaveText('화계');

    await page.goto('/che/chief-center');
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const chiefPicker = page.getByTestId('command-picker');
    await chiefPicker.getByRole('button', { name: /^(?:국가:)?인사$/, exact: true }).click();
    await chiefPicker.getByRole('button', { name: /포상/ }).click();
    const chiefForm = chiefPicker.getByTestId('command-argument-form');
    await chiefForm.getByRole('button', { name: '쌀' }).click();
    await chiefForm.locator('input[type=number]').fill('300');
    await chiefForm.locator('select').selectOption('2');
    const geometry = await chiefForm.evaluate((element) => {
        const row = element.querySelector('.argument-row');
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            width: rect.width,
            rowHeight: row?.getBoundingClientRect().height ?? 0,
            borderStyle: style.borderStyle,
            fontSize: style.fontSize,
        };
    });
    await chiefPicker.getByRole('button', { name: '입력', exact: true }).click();
    await expect(page.locator('[data-command-scope="nation"] .action-column > div').first()).toHaveText('포상');

    expect(JSON.stringify(requests)).toContain('"destCityId":2');
    expect(JSON.stringify(requests)).toContain('"isGold":false');
    expect(JSON.stringify(requests)).toContain('"amount":300');
    expect(JSON.stringify(requests)).toContain('"destGeneralId":2');

    expect(mapGeometry.width).toBeGreaterThan(650);
    expect(mapGeometry.height / mapGeometry.width).toBeCloseTo(5 / 7, 2);

    expect(geometry.width).toBeGreaterThan(200);
    expect(geometry.rowHeight).toBeGreaterThanOrEqual(34);
    expect(geometry.borderStyle).toBe('solid');
    expect(Number.parseFloat(geometry.fontSize)).toBeGreaterThanOrEqual(10);
});

test('uses a Ref-style full recruitment page without horizontal overflow on desktop or mobile', async ({
    page,
}, testInfo) => {
    const requests = await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/');

    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    let picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: '내정', exact: true }).click();
    await picker.getByRole('button', { name: '징병', exact: true }).click();
    await expect(picker).toHaveAttribute('role', 'dialog');
    await expect(picker).toHaveAttribute('aria-modal', 'true');
    await expect(picker.getByRole('button', { name: '명령 입력 닫기', exact: true })).toBeFocused();
    const form = picker.getByTestId('recruitment-command-form');
    await expect(form).toContainText('현재 기술력 : 1등급');
    await expect(form).toContainText('공격');
    await expect(form).toContainText('방어');
    await expect(form).toContainText('기동');
    await expect(form).toContainText('회피');
    await expect(form).toContainText('가격');
    await expect(form).toContainText('군량');
    await expect(form).toContainText('표준적인 보병입니다.');
    await expect(form.getByRole('button', { name: '정예병 선택 불가', exact: true })).toHaveCount(0);
    await form.getByRole('button', { name: '선택 할 수 없는 병종도 보기', exact: true }).click();
    const unavailable = form.getByRole('button', { name: '정예병 선택 불가', exact: true });
    await expect(unavailable).toBeVisible();
    await expect(unavailable.locator('.crew-name')).toHaveCSS('background-color', 'rgb(201, 0, 0)');

    const desktopGeometry = await form.evaluate(async (element) => {
        const row = element.querySelector('.crew-row');
        const image = row?.querySelector('.crew-image');
        const info = row?.querySelector('.crew-info');
        const backgroundImage = image ? getComputedStyle(image).backgroundImage : '';
        const imageUrl = backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
        const naturalSize = imageUrl
            ? await new Promise<{ width: number; height: number } | null>((resolve) => {
                  const probe = new Image();
                  probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
                  probe.onerror = () => resolve(null);
                  probe.src = imageUrl;
              })
            : null;
        return {
            overlay: element.closest('[data-testid="command-picker"]')?.getBoundingClientRect().toJSON(),
            formWidth: element.getBoundingClientRect().width,
            rowHeight: row?.getBoundingClientRect().height ?? 0,
            infoWidth: info?.getBoundingClientRect().width ?? 0,
            imageNaturalSize: naturalSize,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            bodyOverflow: getComputedStyle(document.body).overflow,
        };
    });
    expect(desktopGeometry.overlay).toMatchObject({ x: 0, y: 0, width: 1200, height: 900 });
    expect(desktopGeometry.formWidth).toBe(1000);
    expect(desktopGeometry.rowHeight).toBeGreaterThanOrEqual(64);
    expect(desktopGeometry.infoWidth).toBeCloseTo(250, 0);
    expect(desktopGeometry.imageNaturalSize).toEqual({ width: 128, height: 128 });
    expect(desktopGeometry.scrollWidth).toBe(desktopGeometry.clientWidth);
    expect(desktopGeometry.bodyOverflow).toBe('hidden');

    const infantry = form.getByRole('button', { name: '보병 선택 가능', exact: true });
    await infantry.getByRole('button', { name: '절반', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('recruitment-desktop.png') });
    await picker.getByRole('button', { name: '입력', exact: true }).click();
    await expect(page.locator('[data-command-scope="general"] .action-column > div').first()).toHaveText('징병');
    expect(JSON.stringify(requests)).toContain('"crewType":1100');
    expect(JSON.stringify(requests)).toContain('"amount":3500');

    await page.setViewportSize({ width: 500, height: 844 });
    await page.getByRole('button', { name: '2턴 명령 입력', exact: true }).click();
    picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: '내정', exact: true }).click();
    await picker.getByRole('button', { name: '징병', exact: true }).click();
    await expect(picker.getByRole('button', { name: '명령 입력 닫기', exact: true })).toBeFocused();
    const referenceWidthGeometry = await picker.evaluate((element) => {
        const formElement = element.querySelector<HTMLElement>('[data-testid="recruitment-command-form"]')!;
        const row = formElement.querySelector<HTMLElement>('.crew-row')!;
        const selectedPanel = formElement.querySelector<HTMLElement>('.mobile-selected-panel')!;
        return {
            overlayWidth: element.getBoundingClientRect().width,
            rowWidth: row.getBoundingClientRect().width,
            rowGridColumns: getComputedStyle(row).gridTemplateColumns,
            selectedWidth: selectedPanel.getBoundingClientRect().width,
            selectedGridColumns: getComputedStyle(selectedPanel).gridTemplateColumns,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
        };
    });
    expect(referenceWidthGeometry).toMatchObject({
        overlayWidth: 500,
        rowWidth: 500,
        rowGridColumns: '64px 76px 30px 30px 30px 270px',
        selectedWidth: 500,
        selectedGridColumns: '64px 76px 270px 90px',
        scrollWidth: 500,
        clientWidth: 500,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileGeometry = await picker.evaluate((element) => {
        const formElement = element.querySelector<HTMLElement>('[data-testid="recruitment-command-form"]')!;
        const row = formElement.querySelector('.crew-row');
        const image = row?.querySelector('.crew-image');
        const info = row?.querySelector('.crew-info');
        const selectedPanel = formElement.querySelector('.mobile-selected-panel');
        const rect = element.getBoundingClientRect();
        const bottomElement = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 1);
        return {
            overlay: rect.toJSON(),
            overlayCoversBottom: bottomElement instanceof Element && element.contains(bottomElement),
            formLeft: formElement.getBoundingClientRect().left,
            formWidth: formElement.getBoundingClientRect().width,
            rowWidth: row?.getBoundingClientRect().width ?? 0,
            rowHeight: row?.getBoundingClientRect().height ?? 0,
            rowGridColumns: row ? getComputedStyle(row).gridTemplateColumns : '',
            rowGridRows: row ? getComputedStyle(row).gridTemplateRows : '',
            imageWidth: image?.getBoundingClientRect().width ?? 0,
            infoWidth: info?.getBoundingClientRect().width ?? 0,
            selectedWidth: selectedPanel?.getBoundingClientRect().width ?? 0,
            selectedDisplay: selectedPanel ? getComputedStyle(selectedPanel).display : '',
            actionsBottom: element.querySelector<HTMLElement>('.picker-actions')?.getBoundingClientRect().bottom ?? 0,
            viewportHeight: window.innerHeight,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            bodyOverflow: getComputedStyle(document.body).overflow,
        };
    });
    expect(mobileGeometry.overlay).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
    expect(mobileGeometry.overlayCoversBottom).toBe(true);
    expect(mobileGeometry.rowGridColumns).toBe('64px 76px 30px 30px 30px 160px');
    expect(mobileGeometry).toMatchObject({
        formLeft: 0,
        formWidth: 390,
        rowWidth: 390,
        imageWidth: 64,
        selectedWidth: 390,
        selectedDisplay: 'grid',
        actionsBottom: 844,
        viewportHeight: 844,
        bodyOverflow: 'hidden',
    });
    expect(mobileGeometry.rowHeight).toBeGreaterThanOrEqual(64);
    expect(mobileGeometry.infoWidth).toBeGreaterThanOrEqual(150);
    expect(mobileGeometry.scrollWidth).toBe(mobileGeometry.clientWidth);

    await page.setViewportSize({ width: 390, height: 360 });
    await picker.evaluate((element) => (element.scrollTop = 160));
    const stickyGeometry = await picker.evaluate((element) => {
        const header = element.querySelector<HTMLElement>(':scope > header')!;
        const listFront = element.querySelector<HTMLElement>('.recruitment-list-front')!;
        const actions = element.querySelector<HTMLElement>('.picker-actions')!;
        return {
            scrollTop: element.scrollTop,
            headerTop: header.getBoundingClientRect().top,
            listFrontTop: listFront.getBoundingClientRect().top,
            actionsBottom: actions.getBoundingClientRect().bottom,
            viewportHeight: window.innerHeight,
        };
    });
    expect(stickyGeometry.scrollTop).toBeGreaterThan(0);
    expect(stickyGeometry.headerTop).toBe(0);
    expect(stickyGeometry.listFrontTop).toBeGreaterThanOrEqual(44);
    expect(stickyGeometry.actionsBottom).toBe(stickyGeometry.viewportHeight);

    await page.setViewportSize({ width: 390, height: 844 });
    await picker.evaluate((element) => (element.scrollTop = 0));
    await page.screenshot({ path: testInfo.outputPath('recruitment-mobile.png') });

    await picker.getByRole('button', { name: '명령 다시 선택', exact: true }).click();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
    await picker.getByRole('button', { name: '내정', exact: true }).click();
    await picker.getByRole('button', { name: '모병', exact: true }).click();
    const mercenaryForm = picker.getByTestId('recruitment-command-form');
    await expect(mercenaryForm).toContainText('모병은 가격 2배의 자금이 소요됩니다.');
    await expect(mercenaryForm.locator('.mobile-selected-panel output')).toHaveText('1,346금');
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
});

test('uses the map to choose a nation target in the chief command window', async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/che/chief-center');
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: /^(?:국가:)?외교$/, exact: true }).click();
    await picker.getByRole('button', { name: /선전포고/ }).click();
    const form = picker.getByTestId('command-argument-form');
    await expect(form.getByTestId('command-argument-guidance')).toContainText('초반 제한');
    await form.getByTestId('command-argument-map').locator('.city-base').nth(1).click();
    await expect(form.locator('select')).toHaveValue('2');
    await expect(form.getByTestId('command-map-selection-status')).toContainText('현재 도시업');
    await expect(form.getByTestId('command-map-selection-status')).toContainText('선택 국가적국');
    await expect(form.getByTestId('current-city-marker')).toHaveAttribute('aria-label', '현재 도시 업');
    await expect(form.getByTestId('command-map-target-summary')).toContainText('수도 허창 · 도시 1개');
    await expect(page).toHaveURL(/\/che\/chief-center$/);
    await page.screenshot({ path: test.info().outputPath('chief-nation-map-option.png'), fullPage: true });
});

test('fits the city map option window inside the Ref-compatible 500px mobile page', async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width: 500, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: /화계/ }).click();
    const mobileForm = picker.getByTestId('command-argument-form');
    const mobileMap = mobileForm.getByTestId('command-argument-map');
    const mobileCities = mobileMap.locator('.city-base');
    await mobileCities.nth(1).click();
    await expect(mobileForm.locator('select')).toHaveValue('2');
    await expect(mobileForm.getByTestId('command-map-selection-status')).toContainText('현재 도시업');
    await expect(mobileForm.getByTestId('command-map-selection-status')).toContainText('선택 도시허창');
    await expect(mobileMap.getByTestId('current-city-marker')).toHaveAttribute('aria-label', '현재 도시 업');
    await expect(mobileCities.nth(0)).toHaveClass(/mine/);
    await expect(mobileCities.nth(1)).toHaveClass(/selected/);
    const geometry = await picker.evaluate((element) => {
        const map = element.querySelector<HTMLElement>('[data-testid="command-argument-map"] .map-area')!;
        const pickerRect = element.getBoundingClientRect();
        const mapRect = map.getBoundingClientRect();
        return {
            pickerX: pickerRect.x,
            pickerRight: pickerRect.right,
            pickerWidth: pickerRect.width,
            pickerScrollWidth: element.scrollWidth,
            mapWidth: mapRect.width,
            mapHeight: mapRect.height,
            marker: (() => {
                const marker = element.querySelector<HTMLElement>('[data-testid="current-city-marker"]')!;
                const rect = marker.getBoundingClientRect();
                const style = getComputedStyle(marker);
                return {
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                    pointerEvents: style.pointerEvents,
                    borderColor: style.borderColor,
                };
            })(),
        };
    });
    expect(geometry.pickerX).toBeGreaterThanOrEqual(0);
    expect(geometry.pickerRight).toBeLessThanOrEqual(500);
    expect(geometry.pickerWidth).toBeGreaterThanOrEqual(488);
    expect(geometry.pickerScrollWidth).toBeLessThanOrEqual(geometry.pickerWidth);
    expect(geometry.mapWidth).toBeGreaterThan(470);
    expect(geometry.mapHeight / geometry.mapWidth).toBeCloseTo(5 / 7, 2);
    expect(geometry.marker.left).toBeGreaterThanOrEqual(0);
    expect(geometry.marker.right).toBeLessThanOrEqual(500);
    expect(geometry.marker.top).toBeGreaterThanOrEqual(0);
    expect(geometry.marker.bottom).toBeLessThanOrEqual(900);
    expect(geometry.marker.pointerEvents).toBe('none');
    expect(geometry.marker.borderColor).toBe('rgb(130, 207, 255)');
    await page.screenshot({ path: test.info().outputPath('main-city-map-option-mobile.png'), fullPage: true });
});

test('keeps the entered command visible and reports a server validation error', async ({ page }) => {
    await install(page, true);
    await page.goto('/');
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    await page.getByTestId('command-picker').getByRole('button', { name: /화계/ }).click();
    await page.getByTestId('command-argument-form').locator('select').selectOption('2');
    await page.getByTestId('command-picker').getByRole('button', { name: '입력', exact: true }).click();

    await expect(page.getByRole('alert')).toContainText('대상 도시를 선택할 수 없습니다.');
    await expect(page.getByTestId('command-argument-form').locator('select')).toHaveValue('2');
});

test('uses drag selection, clipboard paste, and a stored template in advanced mode', async ({ page }) => {
    const requests = await install(page);
    await page.goto('/');

    const editor = page.locator('[data-command-scope="general"]');
    await expect(editor).toBeVisible();
    await editor.getByRole('button', { name: '고급 모드', exact: true }).click();
    const drag = async (first: number, last: number, selector = '.index-column > button') => {
        const cells = editor.locator(selector);
        const from = await cells.nth(first).boundingBox();
        const to = await cells.nth(last).boundingBox();
        if (!from || !to) throw new Error('turn buttons are not measurable');
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
        await page.mouse.up();
    };

    await drag(0, 2);
    await expect(editor.locator('.index-column > button.selected')).toHaveCount(3);
    await editor.getByRole('button', { name: '명령 선택 ▾', exact: true }).click();
    const picker = editor.getByTestId('command-picker');
    const blockedFire = picker.getByRole('button', { name: '화계', exact: true });
    await expect(blockedFire).toBeEnabled();
    await blockedFire.click();
    await picker.getByTestId('command-argument-form').locator('select').selectOption('2');
    await picker.getByRole('button', { name: '입력', exact: true }).click();
    await expect(editor.locator('.action-column > div').nth(2)).toHaveText('화계');

    await drag(0, 2);
    await editor.locator('details.selected-menu > summary').click();
    await editor.getByRole('button', { name: '복사하기', exact: true }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('core2026:general:1:clipboard'))).not.toBeNull();
    await editor.locator('details.range-menu > summary').click();
    await editor.getByRole('button', { name: '모든턴', exact: true }).click();
    await expect(editor.locator('.index-column > button.selected')).toHaveCount(15);
    await editor.locator('details.selected-menu > summary').click();
    await editor.getByRole('button', { name: '붙여넣기', exact: true }).click();
    await expect(editor.locator('.action-column > div').nth(5)).toHaveText('화계');

    await drag(0, 2);
    page.once('dialog', (dialog) => dialog.accept('화계 세트'));
    await editor.locator('details.selected-menu > summary').click();
    await editor.getByRole('button', { name: '보관하기', exact: true }).click();
    await editor
        .locator('details')
        .filter({ has: page.getByText('보관함', { exact: true }) })
        .locator('summary')
        .click();
    await expect(editor.getByRole('button', { name: '화계 세트', exact: true })).toBeVisible();

    expect(JSON.stringify(requests)).toContain('"turnList":[0,1,2]');
    expect(JSON.stringify(requests)).toContain('"turnList":[0,3,6,9,12');
    await page.screenshot({ path: test.info().outputPath('advanced-command-editor.png'), fullPage: true });
});

test('keeps the shared main and chief shell geometry and interaction states', async ({ page }) => {
    const requests = await install(page);
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '전장 현황' })).toBeVisible();

    const mainGeometry = await page.locator('.main-page').evaluate((element) => {
        const header = element.querySelector<HTMLElement>('.game-shell__header')!;
        const title = element.querySelector<HTMLElement>('.game-shell__title')!;
        const subtitle = element.querySelector<HTMLElement>('.game-shell__subtitle')!;
        const action = element.querySelector<HTMLElement>('.game-shell__action')!;
        return {
            width: element.getBoundingClientRect().width,
            padding: getComputedStyle(element).padding,
            gap: getComputedStyle(element).gap,
            headerWidth: header.getBoundingClientRect().width,
            headerGap: getComputedStyle(header).gap,
            headerBorder: getComputedStyle(header).borderBottomWidth,
            headerPadding: getComputedStyle(header).paddingBottom,
            titleFontSize: getComputedStyle(title).fontSize,
            subtitleFontSize: getComputedStyle(subtitle).fontSize,
            actionPadding: getComputedStyle(action).padding,
            actionFontSize: getComputedStyle(action).fontSize,
        };
    });
    expect(mainGeometry).toMatchObject({
        width: 1000,
        padding: '0px',
        gap: '10px',
        headerWidth: 1000,
        headerGap: '12px',
        headerBorder: '1px',
        headerPadding: '12px',
        actionPadding: '6px 12px',
    });
    expect(Number.parseFloat(mainGeometry.titleFontSize)).toBeGreaterThan(20);
    expect(Number.parseFloat(mainGeometry.subtitleFontSize)).toBeGreaterThan(10);
    expect(Number.parseFloat(mainGeometry.actionFontSize)).toBeGreaterThan(10);

    const mainAction = page.getByRole('link', { name: '세력 정보' });
    await mainAction.hover();
    expect(await mainAction.evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer');
    await mainAction.focus();
    expect(await mainAction.evaluate((element) => document.activeElement === element)).toBe(true);

    await page.setViewportSize({ width: 1200, height: 900 });
    await page.locator('.main-nation-menu').first().locator('[data-navigation-id="chief-center"]').click();
    await expect(page).toHaveURL(/\/che\/chief-center$/);
    await expect(page.getByRole('heading', { name: '사령부', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    await expect(page.getByTestId('command-picker')).toBeVisible();
    await page
        .getByTestId('command-picker')
        .getByRole('button', { name: /^(?:국가:)?인사$/, exact: true })
        .click();
    await page.getByTestId('command-picker').getByRole('button', { name: /포상/ }).click();
    const chiefArgumentForm = page.getByTestId('command-picker').getByTestId('command-argument-form');
    await chiefArgumentForm.getByRole('button', { name: '쌀' }).click();
    await chiefArgumentForm.locator('input[type=number]').fill('300');
    await chiefArgumentForm.locator('select').selectOption('2');
    await page.getByTestId('command-picker').getByRole('button', { name: '입력', exact: true }).click();
    await expect(page.locator('[data-command-scope="nation"] .action-column > div').first()).toHaveText('포상');
    expect(JSON.stringify(requests)).toContain('"action":"che_포상"');
    expect(JSON.stringify(requests)).toContain('"destGeneralId":2');
    const chiefDesktop = await page.locator('.chief-page').evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        padding: getComputedStyle(element).padding,
        headerWidth: element.querySelector<HTMLElement>('.chief-top')!.getBoundingClientRect().width,
    }));
    expect(chiefDesktop).toEqual({ width: 1000, padding: '0px', headerWidth: 1000 });

    await page.setViewportSize({ width: 500, height: 900 });
    const chiefMobile = await page.locator('.chief-page').evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        padding: getComputedStyle(element).padding,
        headerWidth: element.querySelector<HTMLElement>('.chief-top')!.getBoundingClientRect().width,
    }));
    expect(chiefMobile).toEqual({ width: 500, padding: '0px', headerWidth: 500 });
});
