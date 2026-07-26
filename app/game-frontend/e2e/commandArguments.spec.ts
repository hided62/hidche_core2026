import { expect, test, type Page, type Route } from '@playwright/test';

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
        { value: 2, label: '허창 (적국)' },
    ],
    nations: [
        { value: 1, label: '아국', color: '#008000' },
        { value: 2, label: '적국', color: '#800000' },
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
};
const commandTable = {
    general: [{
        category: '군사',
        values: [{
            key: 'che_화계',
            name: '화계',
            reqArg: true,
            possible: true,
            status: 'needsInput',
            inputFields: [{
                key: 'destCityId',
                label: '대상 도시',
                kind: 'select',
                required: true,
                optionSource: 'cities',
            }],
        }],
    }],
    nation: [{
        category: '인사',
        values: [{
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
        }],
    }],
    inputOptions,
};
const generalContext = {
    general: {
        id: 1, name: '장수', nationId: 1, cityId: 1, officerLevel: 5, npcState: 0, troopId: 0,
        picture: null, imageServer: 0, stats: { leadership: 70, strength: 60, intelligence: 50 },
        gold: 1000, rice: 1000, crew: 500, train: 90, atmos: 90, injury: 0, experience: 0,
        dedication: 0, items: { horse: 'None', weapon: 'None', book: 'None', item: 'None' },
    },
    city: { id: 1, name: '업', level: 8, region: 1, population: 1000, populationMax: 2000 },
    nation: { id: 1, name: '아국', color: '#008000', level: 1 },
    settings: {},
    penalties: {},
};
const turns = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ index, action: '휴식', args: {} }));

const install = async (page: Page, rejectGeneral = false) => {
    const requests: unknown[] = [];
    await page.addInitScript(() => {
        localStorage.setItem('sammo-game-token', 'ga_commands');
        localStorage.setItem('sammo-game-profile', 'che:default');
    });
    await page.route('**/image/**', (route) => route.fulfill({ status: 404, body: '' }));
    await page.route('**/che/api/trpc/**', async (route) => {
        const names = operations(route);
        const body = route.request().postDataJSON();
        const results = names.map((name) => {
            if (name === 'general.me') return response(generalContext);
            if (name === 'world.getMapLayout') return response({
                mapName: 'che',
                cityList: [{ id: 1, name: '업', level: 8, region: 1, x: 100, y: 100, path: [] }],
                regionMap: { 1: '하북' },
                levelMap: { 8: '특' },
            });
            if (name === 'lobby.info') return response({
                myGeneral: { id: 1, name: '장수' },
                year: 200, month: 1, turnTerm: 10, userCnt: 1, maxUserCnt: 100, npcCnt: 0, nationCnt: 2,
            });
            if (name === 'join.getConfig') return response({});
            if (name === 'world.getMap') return response({
                result: true, version: 0, startYear: 180, year: 200, month: 1,
                cityList: [[1, 8, 0, 1, 1, 1]], nationList: [[1, '아국', '#008000', 1]],
                spyList: {}, shownByGeneralList: [], myCity: 1, myNation: 1,
            });
            if (name === 'turns.getCommandTable') return response(commandTable);
            if (name === 'turns.reserved.getGeneral') return response(turns(30));
            if (name === 'turns.reserved.getNation') return response(turns(12));
            if (name === 'messages.getRecent') return response({
                private: [], national: [], public: [], diplomacy: [], sequence: -1,
                hasMore: { private: false, national: false, public: false, diplomacy: false },
                latestRead: { private: 0, diplomacy: 0 },
                canRespondDiplomacy: false,
            });
            if (name === 'messages.getContacts') return response({ nation: [] });
            if (name === 'board.getAccess') return response({ canMeeting: false, canSecret: false });
            if (name === 'tournament.getState') return response({ stage: 0 });
            if (name === 'turns.reserved.setGeneral') {
                requests.push(body);
                return rejectGeneral
                    ? errorResponse(name, '대상 도시를 선택할 수 없습니다.')
                    : response({ ok: true, turns: [{ index: 0, action: 'che_화계', args: { destCityId: 2 } }] });
            }
            if (name === 'turns.reserved.setNation') {
                requests.push(body);
                return response({
                    ok: true,
                    turns: [{ index: 0, action: 'che_포상', args: { isGold: false, amount: 300, destGeneralId: 2 } }],
                });
            }
            return errorResponse(name, `unhandled ${name}`);
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
    return requests;
};

test('enters general and nation command arguments and sends exact values', async ({ page }) => {
    const requests = await install(page);
    await page.goto('/');

    await page.getByRole('button', { name: /화계/ }).click();
    const form = page.getByTestId('command-argument-form');
    await expect(form).toBeVisible();
    await form.locator('select').selectOption('2');
    const generalSection = page.locator('.reserved-section').filter({ hasText: '일반 예턴' });
    await generalSection.getByRole('button', { name: '배치' }).first().click();
    await expect(generalSection.locator('.turn-action').first()).toHaveText('che_화계');

    await page.getByRole('button', { name: '국가:인사' }).click();
    await page.getByRole('button', { name: /포상/ }).click();
    await form.getByRole('button', { name: '쌀' }).click();
    await form.locator('input[type=number]').fill('300');
    await form.locator('select').selectOption('2');
    const nationSection = page.locator('.reserved-section').filter({ hasText: '국가 예턴' });
    await nationSection.getByRole('button', { name: '배치' }).first().click();
    await expect(nationSection.locator('.turn-action').first()).toHaveText('che_포상');

    expect(JSON.stringify(requests)).toContain('"destCityId":2');
    expect(JSON.stringify(requests)).toContain('"isGold":false');
    expect(JSON.stringify(requests)).toContain('"amount":300');
    expect(JSON.stringify(requests)).toContain('"destGeneralId":2');

    const geometry = await form.evaluate((element) => {
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
    expect(geometry.width).toBeGreaterThan(250);
    expect(geometry.rowHeight).toBeGreaterThanOrEqual(34);
    expect(geometry.borderStyle).toBe('solid');
    expect(geometry.fontSize).toBe('10.5px');
});

test('keeps the entered command visible and reports a server validation error', async ({ page }) => {
    await install(page, true);
    await page.goto('/');
    await page.getByRole('button', { name: /화계/ }).click();
    await page.getByTestId('command-argument-form').locator('select').selectOption('2');
    await page.locator('.reserved-section').filter({ hasText: '일반 예턴' })
        .getByRole('button', { name: '배치' }).first().click();

    await expect(page.locator('.error')).toContainText('대상 도시를 선택할 수 없습니다.');
    await expect(page.getByTestId('command-argument-form').locator('select')).toHaveValue('2');
});
