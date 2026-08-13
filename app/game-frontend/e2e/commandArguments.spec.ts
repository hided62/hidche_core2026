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
            category: '군사',
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
                {
                    key: 'che_징병',
                    name: '징병',
                    reqArg: true,
                    possible: true,
                    status: 'needsInput',
                    inputFields: [
                        {
                            key: 'crewType',
                            label: '병종',
                            kind: 'select',
                            required: true,
                            optionSource: 'crewTypes',
                        },
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
    city: { id: 1, name: '업', level: 8, region: 1, population: 1000, populationMax: 2000 },
    nation: { id: 1, name: '아국', color: '#008000', level: 1 },
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

const install = async (page: Page, rejectGeneral = false) => {
    const requests: unknown[] = [];
    const generalTurns = turns(30);
    const nationTurns = turns(12);
    let generalRevision = 0;
    let nationRevision = 0;
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
            if (name === 'dashboard.getContextBundleDelta')
                return response({
                    context: { kind: 'snapshot', revision: 'context-v1', data: generalContext },
                    commandTable: { kind: 'snapshot', revision: 'commands-v1', data: commandTable },
                    boardAccess: {
                        kind: 'snapshot',
                        revision: 'board-v1',
                        data: { permission: 0, canMeeting: false, canSecret: false },
                    },
                });
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
            if (name === 'turns.getCommandTable') return response(commandTable);
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

test('enters general and nation command arguments and sends exact values', async ({ page }) => {
    const requests = await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/');

    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    await page.getByTestId('command-picker').getByRole('button', { name: /화계/ }).click();
    const form = page.getByTestId('command-argument-form');
    await expect(form).toBeVisible();
    await expect(form.getByTestId('command-argument-map')).toBeVisible();
    await expect(form.getByTestId('command-argument-guidance')).toContainText('선택한 도시에 화계를 실행합니다.');
    await expect(form.getByTestId('command-map-target-summary')).toContainText('현재 도시에서 0칸');
    const commandMap = form.getByTestId('command-argument-map');
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
    await mapCities.nth(1).hover();
    expect(await mapCities.nth(1).evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer');
    await mapCities.nth(1).focus();
    await expect(mapCities.nth(1)).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
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
    await expect(form.getByTestId('command-map-target-summary')).toContainText('수도 허창 · 도시 1개');
    await expect(page).toHaveURL(/\/che\/chief-center$/);
    await page.screenshot({ path: test.info().outputPath('chief-nation-map-option.png'), fullPage: true });
});

test('leaves the separately scoped recruitment argument window unchanged', async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: /징병/ }).click();
    await expect(picker.getByTestId('command-argument-form')).toBeVisible();
    await expect(picker.getByTestId('command-argument-guidance')).toHaveCount(0);
    await expect(picker.getByTestId('command-argument-map')).toHaveCount(0);
    expect((await picker.boundingBox())?.width).toBeLessThan(300);
});

test('fits the city map option window inside the Ref-compatible 500px mobile page', async ({ page }) => {
    await install(page);
    await page.setViewportSize({ width: 500, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
    const picker = page.getByTestId('command-picker');
    await picker.getByRole('button', { name: /화계/ }).click();
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
        };
    });
    expect(geometry.pickerX).toBeGreaterThanOrEqual(0);
    expect(geometry.pickerRight).toBeLessThanOrEqual(500);
    expect(geometry.pickerWidth).toBeGreaterThanOrEqual(488);
    expect(geometry.pickerScrollWidth).toBeLessThanOrEqual(geometry.pickerWidth);
    expect(geometry.mapWidth).toBeGreaterThan(470);
    expect(geometry.mapHeight / geometry.mapWidth).toBeCloseTo(5 / 7, 2);
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
    if ((await editor.count()) === 0) await page.reload();
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
