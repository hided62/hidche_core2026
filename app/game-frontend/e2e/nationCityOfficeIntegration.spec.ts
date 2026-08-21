import { expect, test, type Page, type Route } from '@playwright/test';

import { gameProfile, gameTrpcRoute } from './gameTestPaths.js';

type Role = 'head' | 'member';
type AppointmentInput = { destGeneralId: number; destCityId: number; officerLevel: number };
type FixtureState = {
    role: Role;
    appointed: boolean;
    secretForbidden?: boolean;
    appointmentInputs: AppointmentInput[];
};

const response = (data: unknown) => ({ result: { data } });
const errorResponse = (path: string, message: string, code = 'BAD_REQUEST') => ({
    error: { message, code: -32000, data: { code, httpStatus: code === 'FORBIDDEN' ? 403 : 400, path } },
});
const operations = (route: Route): string[] =>
    decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(',');
const requestInput = (route: Route, index: number): Record<string, unknown> => {
    const body: unknown = route.request().postData() ? route.request().postDataJSON() : {};
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const raw = record[String(index)] ?? record;
    const payload = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const input = payload.input && typeof payload.input === 'object' ? (payload.input as Record<string, unknown>) : {};
    const json = payload.json ?? input.json ?? payload;
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
};

const cities = [
    {
        id: 1,
        name: '허창',
        level: 7,
        region: 2,
        population: 99_000,
        populationMax: 100_000,
        agriculture: 9_500,
        agricultureMax: 10_000,
        commerce: 8_000,
        commerceMax: 10_000,
        security: 8_000,
        securityMax: 10_000,
        trust: 80,
        trade: 100,
        defence: 4_500,
        defenceMax: 5_000,
        wall: 4_500,
        wallMax: 5_000,
        supplyState: 1,
        frontState: 0,
        incomes: { gold: 1000, rice: 900, wall: 800 },
    },
    {
        id: 2,
        name: '낙양',
        level: 6,
        region: 2,
        population: 60_000,
        populationMax: 100_000,
        agriculture: 5_000,
        agricultureMax: 10_000,
        commerce: 5_000,
        commerceMax: 10_000,
        security: 5_000,
        securityMax: 10_000,
        trust: 70,
        trade: 90,
        defence: 2_500,
        defenceMax: 5_000,
        wall: 2_500,
        wallMax: 5_000,
        supplyState: 1,
        frontState: 0,
        incomes: { gold: 800, rice: 700, wall: 600 },
    },
] as const;

const commandTable = {
    general: [
        {
            category: '내정',
            values: [
                {
                    key: 'che_농지개간',
                    name: '농지 개간',
                    reqArg: false,
                    status: 'available',
                    possible: true,
                    inputFields: [],
                },
                { key: 'che_훈련', name: '훈련', reqArg: false, status: 'available', possible: true, inputFields: [] },
            ],
        },
    ],
    nation: [],
    inputOptions: {
        cities: cities.map((city) => ({ value: city.id, label: city.name })),
        nations: [{ value: 1, label: '위' }],
        generals: [],
        crewTypes: [{ value: 1, label: '보병' }],
        armTypes: [],
        nationTypes: [],
        colors: [],
        items: {},
        recruitment: null,
    },
};

const overviewFixture = (state: FixtureState) => ({
    me: { id: state.role === 'head' ? 20 : 21, officerLevel: state.role === 'head' ? 5 : 1 },
    nation: {
        id: 1,
        name: '위',
        color: '#008000',
        level: 3,
        typeCode: 'che_법가',
        capitalCityId: 1,
        rate: 20,
    },
    chiefStatMin: 65,
    cities: cities.map((city) => ({
        ...city,
        officers: {
            4: state.appointed
                ? { id: 21, name: '장료', npcState: 0, officerLevel: 4, cityId: 1, cityName: '허창' }
                : null,
            3: null,
            2: null,
        },
    })),
    generals: [
        {
            id: 1,
            name: '조조',
            npcState: 0,
            officerLevel: 12,
            cityId: 1,
            officerCity: 0,
            stats: { leadership: 90, strength: 80, intelligence: 90 },
        },
        {
            id: 20,
            name: '순욱',
            npcState: 0,
            officerLevel: 5,
            cityId: 1,
            officerCity: 0,
            stats: { leadership: 75, strength: 70, intelligence: 90 },
        },
        {
            id: 21,
            name: '장료',
            npcState: 0,
            officerLevel: state.appointed ? 4 : 1,
            cityId: 1,
            officerCity: state.appointed ? 1 : 0,
            stats: { leadership: 80, strength: 70, intelligence: 50 },
        },
        {
            id: 22,
            name: '조홍',
            npcState: 2,
            officerLevel: 1,
            cityId: 2,
            officerCity: 0,
            stats: { leadership: 60, strength: 65, intelligence: 40 },
        },
    ],
});

const secretGeneral = (id: number, name: string, cityId: number, overrides: Record<string, unknown> = {}) => ({
    id,
    name,
    npcState: 0,
    injury: 0,
    stats: { leadership: 70, strength: 70, intelligence: 70 },
    leadershipBonus: 0,
    experienceLevel: 9,
    troopId: 0,
    troopName: null,
    gold: 1000,
    rice: 2000,
    cityId,
    cityName: cityId === 1 ? '허창' : '낙양',
    defenceTrain: 90,
    defenceTrainText: '☆',
    crewTypeId: 1,
    crewTypeName: '보병',
    crew: 300,
    train: 90,
    atmos: 90,
    killTurn: 7,
    turnTime: '2026-01-01T01:02:00.000Z',
    reservedCommands: [
        { action: 'che_농지개간', args: {} },
        { action: 'che_훈련', args: {} },
    ],
    ...overrides,
});

const secretFixture = () => ({
    nation: { id: 1, name: '위', color: '#008000', level: 3 },
    viewer: { generalId: 20, permission: 1 },
    summary: {
        gold: 4000,
        rice: 8000,
        crew: 1200,
        generalCount: 4,
        averageGold: 1000,
        averageRice: 2000,
        readiness: {
            90: { crew: 1200, generals: 4 },
            80: { crew: 1200, generals: 4 },
            60: { crew: 1200, generals: 4 },
        },
    },
    generals: [
        secretGeneral(1, '조조', 1, { leadershipBonus: 6 }),
        secretGeneral(20, '순욱', 1, { leadershipBonus: 3 }),
        secretGeneral(21, '장료', 1, {
            stats: { leadership: 80, strength: 70, intelligence: 50 },
        }),
        secretGeneral(22, '조홍', 2, { npcState: 2, reservedCommands: [] }),
    ],
});

const personnelGeneral = (id: number, name: string, officerLevel: number, overrides: Record<string, unknown> = {}) => ({
    id,
    name,
    npcState: 0,
    officerLevel,
    cityId: 1,
    cityName: '허창',
    troopId: 0,
    troopName: null,
    picture: null,
    imageServer: 0,
    officerCity: officerLevel >= 2 && officerLevel <= 4 ? 1 : 0,
    officerCityName: officerLevel >= 2 && officerLevel <= 4 ? '허창' : null,
    stats: { leadership: 70, strength: 70, intelligence: 70 },
    experience: 100,
    dedication: 200,
    injury: 0,
    gold: 1000,
    rice: 1000,
    crew: 100,
    personality: null,
    specialDomestic: null,
    specialWar: null,
    belong: 10,
    permission: 'normal',
    ...overrides,
});

const personnelFixture = (state: FixtureState) => {
    const allGenerals = [
        personnelGeneral(1, '조조', 12),
        personnelGeneral(20, '순욱', 5, { stats: { leadership: 75, strength: 70, intelligence: 90 } }),
        personnelGeneral(21, '장료', state.appointed ? 4 : 1, {
            stats: { leadership: 80, strength: 70, intelligence: 50 },
        }),
        personnelGeneral(22, '조홍', 1, {
            npcState: 2,
            cityId: 2,
            cityName: '낙양',
            stats: { leadership: 60, strength: 65, intelligence: 40 },
        }),
    ];
    const canManage = state.role === 'head';
    return {
        me: {
            id: canManage ? 20 : 21,
            officerLevel: canManage ? 5 : 1,
            canManage,
            canChangePermissions: false,
            canKick: canManage,
        },
        nation: {
            id: 1,
            name: '위',
            color: '#008000',
            level: 3,
            typeCode: 'che_법가',
            capitalCityId: 1,
            chiefSet: 0,
        },
        chiefStatMin: 65,
        generals: canManage ? allGenerals : [],
        chiefAssignments: { 12: allGenerals[0], 5: allGenerals[1] },
        cityAssignments: cities.map((city) => ({
            id: city.id,
            name: city.name,
            level: city.level,
            region: city.region,
            officerSet: city.id === 1 && state.appointed ? 1 << 4 : 0,
            officers: {
                4: city.id === 1 && state.appointed ? allGenerals[2] : null,
                3: null,
                2: null,
            },
        })),
        awards: { tigers: [], eagles: [] },
        permissionCandidates: { ambassadors: [], auditors: [] },
    };
};

const install = async (page: Page, state: FixtureState): Promise<void> => {
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_city_office');
        localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    await page.route(gameTrpcRoute, async (route) => {
        const result = operations(route).map((operation, index) => {
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') return response({ myGeneral: { id: 20, name: '순욱' } });
            if (operation === 'join.getConfig') return response({});
            if (operation === 'nation.getCityOverview') return response(overviewFixture(state));
            if (operation === 'nation.getSecretGeneralList') {
                return state.secretForbidden
                    ? errorResponse(
                          operation,
                          '권한이 부족합니다. 수뇌부가 아니거나 사관년도가 부족합니다.',
                          'FORBIDDEN'
                      )
                    : response(secretFixture());
            }
            if (operation === 'nation.getPersonnelInfo') return response(personnelFixture(state));
            if (operation === 'turns.getCommandTable') return response(commandTable);
            if (operation === 'nation.appoint') {
                const input = requestInput(route, index);
                state.appointmentInputs.push({
                    destGeneralId: Number(input.destGeneralId),
                    destCityId: Number(input.destCityId),
                    officerLevel: Number(input.officerLevel),
                });
                state.appointed = true;
                return response({ ok: true });
            }
            return errorResponse(operation, `Unhandled fixture operation: ${operation}`);
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
    });
};

test('암행부 행을 도시별로 나누고 수뇌의 인사부 즉시 임명을 반영한다', async ({ page }, testInfo) => {
    const state: FixtureState = { role: 'head', appointed: false, appointmentInputs: [] };
    await install(page, state);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('nation/cities');

    await expect(page.locator('.nation-cities-page')).toBeVisible();
    await expect(page.locator('.city-user-table')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '인사부 연동' })).toHaveCount(0);

    await page.getByRole('button', { name: '암행부 연동' }).click();
    await expect(page.locator('.city-user-table')).toHaveCount(2);
    await expect(page.locator('.city[data-city-id="1"] .city-user-table tr[data-general-id="21"]')).toContainText(
        '장료'
    );
    await expect(page.locator('.city[data-city-id="2"] .city-user-table tr[data-general-id="22"]')).toContainText(
        '조홍'
    );
    await expect(page.locator('.city[data-city-id="2"] .city-user-table tr[data-general-id="21"]')).toHaveCount(0);
    await expect(page.locator('.city[data-city-id="1"] tr[data-general-id="21"] .command-attention')).toHaveText(
        '농지 개간'
    );

    const integratedBox = await page.locator('.city[data-city-id="1"] .city-user-table').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { width: rect.width, borderCollapse: style.borderCollapse, fontSize: style.fontSize };
    });
    expect(integratedBox).toEqual({ width: 941, borderCollapse: 'collapse', fontSize: '14px' });

    await page.getByRole('button', { name: '인사부 연동' }).click();
    const ordinaryRow = page.locator('.city[data-city-id="1"] tr[data-general-id="21"]');
    await expect(ordinaryRow.locator('.appointment-button')).toHaveCount(3);
    await expect(ordinaryRow.locator('.mode-4')).toBeEnabled();
    await expect(ordinaryRow.locator('.mode-3')).toBeDisabled();
    await expect(ordinaryRow.locator('.mode-2')).toBeEnabled();
    await expect(page.locator('tr[data-general-id="1"] .appointment-button')).toHaveCount(0);

    const disabledStyle = await ordinaryRow.locator('.mode-3').evaluate((button) => {
        const style = getComputedStyle(button);
        return { borderTopWidth: style.borderTopWidth, backgroundColor: style.backgroundColor };
    });
    expect(disabledStyle).toEqual({ borderTopWidth: '0px', backgroundColor: 'rgba(0, 0, 0, 0)' });
    const appointButton = page.getByRole('button', { name: '장료을(를) 허창 태수로 임명' });
    await appointButton.hover();
    expect(await appointButton.evaluate((button) => getComputedStyle(button).cursor)).toBe('pointer');
    await appointButton.focus();
    await expect(appointButton).toBeFocused();

    await page.screenshot({ path: testInfo.outputPath('nation-city-integrated-desktop.png'), fullPage: true });
    await appointButton.click();
    await expect.poll(() => state.appointmentInputs).toEqual([{ destGeneralId: 21, destCityId: 1, officerLevel: 4 }]);
    await expect(page.locator('.city[data-city-id="1"] .officer-4-value')).toHaveText('장료');
    await expect(page.locator('.city[data-city-id="1"] .officer-4-value')).toHaveClass(/effective-officer/u);
    await expect(page.locator('.city[data-city-id="1"] tr[data-general-id="21"] .mode-4')).toBeDisabled();

    await page.setViewportSize({ width: 500, height: 900 });
    expect(await page.locator('.nation-cities-page').evaluate((element) => element.getBoundingClientRect().width)).toBe(
        1000
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThanOrEqual(1000);
    await page.screenshot({ path: testInfo.outputPath('nation-city-integrated-mobile.png'), fullPage: true });
});

test('수뇌 대상은 재확인하고 일반 장수에게는 임명 버튼을 열지 않는다', async ({ page }) => {
    const headState: FixtureState = { role: 'head', appointed: false, appointmentInputs: [] };
    await install(page, headState);
    await page.goto('nation/cities');
    await page.getByRole('button', { name: '암행부 연동' }).click();
    await page.getByRole('button', { name: '인사부 연동' }).click();

    const chiefButton = page.getByRole('button', { name: '순욱을(를) 허창 태수로 임명' });
    expect(await chiefButton.evaluate((button) => getComputedStyle(button).color)).toBe('rgb(255, 0, 0)');
    page.once('dialog', async (dialog) => {
        expect(dialog.message()).toBe('수뇌입니다. 임명할까요?');
        await dialog.dismiss();
    });
    await chiefButton.click();
    await expect.poll(() => headState.appointmentInputs.length).toBe(0);

    await page.unroute(gameTrpcRoute);
    const memberState: FixtureState = { role: 'member', appointed: false, appointmentInputs: [] };
    await install(page, memberState);
    await page.reload();
    await page.getByRole('button', { name: '암행부 연동' }).click();
    page.once('dialog', async (dialog) => {
        expect(dialog.message()).toBe('수뇌가 아닙니다!');
        await dialog.accept();
    });
    await page.getByRole('button', { name: '인사부 연동' }).click();
    await expect(page.locator('.appointment-button')).toHaveCount(0);
    expect(memberState.appointmentInputs).toEqual([]);
});

test('암행부 권한 거부는 도시 기밀 행과 인사부 연동을 열지 않는다', async ({ page }) => {
    const state: FixtureState = {
        role: 'member',
        appointed: false,
        secretForbidden: true,
        appointmentInputs: [],
    };
    await install(page, state);
    await page.goto('nation/cities');
    await page.getByRole('button', { name: '암행부 연동' }).click();

    await expect(page.locator('.integration-error')).toContainText('권한이 부족합니다.');
    await expect(page.locator('.city-user-table')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '인사부 연동' })).toHaveCount(0);
    expect(state.appointmentInputs).toEqual([]);
});
