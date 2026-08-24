import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameProfile, gameTrpcRoute } from './gameTestPaths.js';
import { expectLumenButtonStates } from './lumenButton.js';

type Role = 'leader' | 'head' | 'member';
type FixtureState = {
    role: Role;
    failNextRate?: boolean;
    failPersonnelLoad?: boolean;
    rate: number;
    appointedGeneralId?: number;
    appointedCityId?: number;
    appointedOfficerLevel?: number;
    permissionMutationInput?: { isAmbassador: boolean; targetGeneralIds: number[] };
    noticeMutationInput?: string;
    scoutMutationInput?: string;
    uploadDataUrl?: string;
};

type TrpcRequestPayload = {
    json?: Record<string, unknown>;
    input?: { json?: Record<string, unknown> };
};

const purifiedNoticeResponse =
    '<p data-flip="horizontal" style="color:#00ffff">서버 정화 방침</p><img src="/image/icons/default.jpg" alt="default.jpg" />';
const purifiedScoutResponse = '<strong>서버 정화 임관문</strong><a>위험 링크</a>';

const artifactRoot = process.env.OFFICE_PARITY_ARTIFACT_DIR ? resolve(process.env.OFFICE_PARITY_ARTIFACT_DIR) : null;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const imageRoots = [
    ...(process.env.FRONTEND_PARITY_IMAGE_ROOT ? [resolve(process.env.FRONTEND_PARITY_IMAGE_ROOT)] : []),
    resolve(repositoryRoot, '../image'),
    resolve(repositoryRoot, '../../image'),
];
const referenceAsset = async (relativePath: string): Promise<Buffer> => {
    for (const root of imageRoots) {
        try {
            return await readFile(resolve(root, relativePath));
        } catch {
            // Nested worktrees and the primary checkout have different image parents.
        }
    }
    throw new Error(`Reference image not found: ${relativePath}`);
};
const response = (data: unknown) => ({ result: { data } });
const errorResponse = (path: string, message: string, code = 'BAD_REQUEST') => ({
    error: { message, code: -32000, data: { code, httpStatus: code === 'FORBIDDEN' ? 403 : 400, path } },
});
const operationName = (route: Route): string => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6));
};
const responseHasOperation = (url: string, operation: string): boolean => {
    const pathname = decodeURIComponent(new URL(url).pathname);
    return pathname
        .slice(pathname.lastIndexOf('/trpc/') + 6)
        .split(',')
        .includes(operation);
};
const fulfillJson = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const general = (id: number, name: string, officerLevel: number, overrides: Record<string, unknown> = {}) => ({
    id,
    name,
    npcState: 0,
    officerLevel,
    cityId: 1,
    cityName: '허창',
    troopId: 0,
    troopName: null,
    picture: 'default.jpg',
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
    const officerLevel = state.role === 'leader' ? 12 : state.role === 'head' ? 5 : 1;
    const fullGenerals = [
        general(1, '조조', 12),
        general(2, '순욱', 11),
        general(3, '하후돈', 4),
        general(4, '곽가', 3),
        general(5, '정욱', 2),
        general(6, '장료', 1),
        general(7, '허저', 1, { permission: 'ambassador' }),
        general(8, '가후', 1, { permission: 'auditor' }),
        general(9, '전위', 1),
    ];
    const visibleGenerals =
        state.role === 'member' ? fullGenerals.filter((entry) => entry.officerLevel >= 2) : fullGenerals;
    return {
        me: {
            id: state.role === 'leader' ? 1 : state.role === 'head' ? 2 : 6,
            officerLevel,
            canManage: state.role !== 'member',
            canChangePermissions: state.role === 'leader',
            canKick: state.role !== 'member',
        },
        nation: {
            id: 1,
            name: '작위검증국',
            color: '#777777',
            level: 3,
            typeCode: 'che_법가',
            capitalCityId: 1,
            chiefSet: 0,
        },
        chiefStatMin: 65,
        generals: visibleGenerals,
        chiefAssignments: { 12: fullGenerals[0], 11: fullGenerals[1] },
        cityAssignments: [
            {
                id: 1,
                name: '허창',
                level: 7,
                region: 2,
                officerSet: 1 << 3,
                officers: { 4: fullGenerals[2], 3: fullGenerals[3], 2: fullGenerals[4] },
            },
            { id: 2, name: '낙양', level: 6, region: 2, officerSet: 0, officers: { 4: null, 3: null, 2: null } },
        ],
        awards: {
            tigers: [{ id: 3, name: '하후돈', value: 12 }],
            eagles: [{ id: 4, name: '곽가', value: 9 }],
        },
        permissionCandidates:
            state.role === 'leader'
                ? {
                      ambassadors: [
                          { id: 6, name: '장료', npcState: 0, permission: 'normal', maxPermission: 4 },
                          { id: 7, name: '허저', npcState: 0, permission: 'ambassador', maxPermission: 4 },
                          { id: 9, name: '전위', npcState: 0, permission: 'normal', maxPermission: 4 },
                      ],
                      auditors: [
                          { id: 6, name: '장료', npcState: 0, permission: 'normal', maxPermission: 4 },
                          { id: 8, name: '가후', npcState: 0, permission: 'auditor', maxPermission: 4 },
                          { id: 9, name: '전위', npcState: 0, permission: 'normal', maxPermission: 4 },
                      ],
                  }
                : { ambassadors: [], auditors: [] },
    };
};

const financeFixture = (state: FixtureState) => ({
    editable: state.role === 'leader' || state.role === 'head',
    nationMsg: '<p>백성을 편안하게 한다.</p>',
    scoutMsg: '<p>천하의 인재를 구합니다.</p>',
    nationId: 1,
    officerLevel: state.role === 'leader' ? 12 : state.role === 'head' ? 5 : 1,
    year: 185,
    month: 1,
    nationsList: [
        {
            id: 1,
            name: '작위검증국',
            color: '#777777',
            level: 3,
            power: 1234,
            generalCount: 7,
            cityCount: 2,
            diplomacy: { state: 7, term: null },
        },
        {
            id: 2,
            name: '촉',
            color: '#008000',
            level: 3,
            power: 987,
            generalCount: 5,
            cityCount: 1,
            diplomacy: { state: 2, term: 6 },
        },
    ],
    gold: 10000,
    rice: 20000,
    income: { gold: { city: 2000, war: 300 }, rice: { city: 1800, wall: 200 } },
    outcome: 1000,
    policy: { rate: state.rate, bill: 100, secretLimit: 3, blockScout: false, blockWar: false },
    warSettingCnt: { remain: 5, inc: 2, max: 10 },
});

const installFixture = async (page: Page, state: FixtureState) => {
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_office_playwright');
        localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    for (const filename of ['back_walnut.jpg', 'back_green.jpg', 'back_blue.jpg']) {
        await page.route(`**/image/game/${filename}`, async (route) =>
            route.fulfill({
                status: 200,
                contentType: 'image/jpeg',
                body: await referenceAsset(`game/${filename}`),
            })
        );
    }
    await page.route('**/image/icons/**', async (route) =>
        route.fulfill({
            status: 200,
            contentType: 'image/jpeg',
            body: await referenceAsset('icons/default.jpg'),
        })
    );
    await page.route(gameTrpcRoute, async (route) => {
        const operations = operationName(route).split(',');
        const rawRequestBody: unknown = route.request().postData() ? route.request().postDataJSON() : {};
        const requestBody =
            rawRequestBody && typeof rawRequestBody === 'object' ? (rawRequestBody as Record<string, unknown>) : {};
        const results = operations.map((operation, operationIndex) => {
            const rawPayload =
                requestBody[String(operationIndex)] ?? (operations.length === 1 ? requestBody : undefined);
            const payload =
                rawPayload && typeof rawPayload === 'object' ? (rawPayload as TrpcRequestPayload) : undefined;
            const jsonInput =
                payload?.json ?? payload?.input?.json ?? (payload as Record<string, unknown> | undefined) ?? {};
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') return response({ myGeneral: { id: 1, name: '조조' } });
            if (operation === 'join.getConfig') return response({});
            if (operation === 'nation.getPersonnelInfo') {
                return state.failPersonnelLoad
                    ? errorResponse(operation, '권한이 부족합니다.', 'FORBIDDEN')
                    : response(personnelFixture(state));
            }
            if (operation === 'nation.getStratFinan') return response(financeFixture(state));
            if (operation === 'nation.appoint') {
                state.appointedGeneralId = Number(jsonInput.destGeneralId ?? 0);
                state.appointedCityId = Number(jsonInput.destCityId ?? 0);
                state.appointedOfficerLevel = Number(jsonInput.officerLevel ?? 0);
                return response({ ok: true });
            }
            if (operation === 'nation.changePermission') {
                state.permissionMutationInput = {
                    isAmbassador: jsonInput.isAmbassador === true,
                    targetGeneralIds: Array.isArray(jsonInput.targetGeneralIds)
                        ? jsonInput.targetGeneralIds.map((id) => Number(id))
                        : [],
                };
                return response({ ok: true });
            }
            if (operation === 'nation.kick') return response({ ok: true });
            if (operation === 'nation.setRate') {
                if (state.failNextRate) {
                    state.failNextRate = false;
                    return errorResponse(operation, '세율을 변경할 수 없습니다.');
                }
                state.rate = 25;
                return response({ ok: true });
            }
            if (operation === 'nation.setNotice') {
                state.noticeMutationInput = typeof jsonInput.msg === 'string' ? jsonInput.msg : undefined;
                return response({ ok: true, msg: purifiedNoticeResponse });
            }
            if (operation === 'nation.setScoutMsg') {
                state.scoutMutationInput = typeof jsonInput.msg === 'string' ? jsonInput.msg : undefined;
                return response({ ok: true, msg: purifiedScoutResponse });
            }
            if (operation === 'board.uploadImage') {
                state.uploadDataUrl = typeof jsonInput.dataUrl === 'string' ? jsonInput.dataUrl : undefined;
                return response({
                    url: 'https://sam-image.hided.net/uploads/core2026/0123456789abcdef0123456789abcdef.webp',
                    width: 1,
                    height: 1,
                    format: 'webp',
                    animated: false,
                    size: 68,
                });
            }
            if (['nation.setBill', 'nation.setSecretLimit', 'nation.setBlockScout'].includes(operation))
                return response({ ok: true });
            if (operation === 'nation.setBlockWar') return response({ availableCnt: 4 });
            return errorResponse(operation, `Unhandled fixture operation: ${operation}`);
        });
        await fulfillJson(route, results);
    });
};

const gotoOffice = async (page: Page, path: 'nation/personnel' | 'nation/finance') => {
    const lobbyResponse = page.waitForResponse((response) => responseHasOperation(response.url(), 'lobby.info'));
    await page.goto(path);
    await lobbyResponse;
};
const screenshot = async (page: Page, name: string) => {
    if (!artifactRoot) return;
    await mkdir(artifactRoot, { recursive: true });
    await page.screenshot({ path: resolve(artifactRoot, name), fullPage: true });
};

test('personnel keeps the desktop frame while exposing row-level appointment controls', async ({ page }) => {
    await installFixture(page, { role: 'leader', rate: 20 });
    await page.setViewportSize({ width: 1000, height: 900 });
    await gotoOffice(page, 'nation/personnel');
    await expect(page.getByText('작위검증국')).toBeVisible();
    await expectLumenButtonStates(page, page.locator('.personnel-change-button').first(), 'rgb(49, 91, 61)');

    const computed = await page.locator('#personnel-container').evaluate((container) => {
        const box = (selector?: string) => {
            const element = selector ? container.querySelector<HTMLElement>(selector)! : container;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                width: rect.width,
                height: rect.height,
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                lineHeight: style.lineHeight,
                backgroundImage: style.backgroundImage,
                color: style.color,
            };
        };
        return {
            container: box(),
            heading: box('.heading-table'),
            status: box('.chief-status'),
            icon: box('.general-icon'),
            chiefEntry: box('.chief-entry-cell'),
            changeButton: box('.personnel-change-button'),
            cityOfficer: box('.city-officer-cell'),
            documentWidth: document.documentElement.scrollWidth,
        };
    });
    expect(computed.container.width).toBe(1000);
    expect(computed.heading.width).toBe(1000);
    expect(computed.heading.height).toBeCloseTo(56, 0);
    expect(computed.status.width).toBe(1000);
    expect(computed.icon.width).toBe(64);
    expect(computed.icon.height).toBeCloseTo(64, 0);
    expect(computed.chiefEntry.width).toBeGreaterThan(499);
    expect(computed.chiefEntry.width).toBeLessThan(501);
    expect(computed.chiefEntry.height).toBeGreaterThanOrEqual(76);
    expect(computed.changeButton.height).toBeGreaterThanOrEqual(34);
    expect(computed.cityOfficer.width).toBeCloseTo(280, 0);
    expect(computed.container.fontFamily).toContain('Pretendard');
    expect(computed.container.fontSize).toBe('14px');
    expect(computed.container.lineHeight).toBe('18.2px');
    expect(computed.status.backgroundImage).toContain('back_walnut.jpg');
    expect(computed.documentWidth).toBe(1000);

    const changeButton = page.getByRole('button', { name: '주부 변경하기', exact: true });
    expect(await changeButton.evaluate((button) => getComputedStyle(button).backgroundColor)).toBe('rgb(49, 91, 61)');
    await changeButton.hover();
    expect(await changeButton.evaluate((button) => getComputedStyle(button).cursor)).toBe('pointer');
    await changeButton.focus();
    expect(await changeButton.evaluate((button) => getComputedStyle(button).boxShadow)).not.toBe('none');
    await expect(page.getByRole('button', { name: '허창 태수 변경하기', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '허창 군사 변경하기', exact: true })).toHaveCount(0);
    await screenshot(page, 'core-personnel-desktop-leader.png');
});

test('leader can grant two ambassador and auditor permissions by click or touch without modifier keys', async ({
    page,
}) => {
    const state: FixtureState = { role: 'leader', rate: 20 };
    await installFixture(page, state);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoOffice(page, 'nation/personnel');

    const ambassadorTrigger = page.locator('.permission-multiselect-trigger').first();
    await expect(ambassadorTrigger).toHaveAccessibleName('외교권자 선택, 현재 1명');
    await ambassadorTrigger.click();
    const ambassadorOptions = page.getByRole('listbox', { name: '외교권자 후보' });
    await expect(ambassadorOptions).toBeVisible();
    await expect(ambassadorOptions.getByRole('option', { name: '허저' })).toHaveAttribute('aria-selected', 'true');
    await ambassadorOptions.getByRole('option', { name: '장료' }).click();
    await expect(ambassadorOptions.getByRole('option', { name: '장료' })).toHaveAttribute('aria-selected', 'true');
    await expect(ambassadorTrigger).toHaveAccessibleName('외교권자 선택, 현재 2명');

    await ambassadorOptions.getByRole('option', { name: '전위' }).click();
    await expect(page.getByTestId('game-toast')).toContainText('최대 2명까지 설정 가능합니다.');
    await expect(ambassadorOptions.getByRole('option', { name: '전위' })).toHaveAttribute('aria-selected', 'false');
    const ambassadorGeometry = await ambassadorOptions.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
    });
    expect(ambassadorGeometry.left).toBeGreaterThanOrEqual(0);
    expect(ambassadorGeometry.right).toBeLessThanOrEqual(390);
    expect(ambassadorGeometry.width).toBeGreaterThanOrEqual(100);
    await screenshot(page, 'core-personnel-mobile-permission-picker-open.png');

    page.once('dialog', async (dialog) => {
        expect(dialog.message()).toBe('외교권자를 변경할까요?');
        await dialog.accept();
    });
    await page.getByRole('button', { name: '외교권자 임명 반영' }).click();
    await expect(page.getByTestId('game-toast').filter({ hasText: '권한을 변경했습니다.' })).toBeVisible();
    await expect.poll(() => state.permissionMutationInput).toEqual({ isAmbassador: true, targetGeneralIds: [7, 6] });

    const auditorTrigger = page.locator('.permission-multiselect-trigger').nth(1);
    await expect(auditorTrigger).toHaveAccessibleName('조언자 선택, 현재 1명');
    await auditorTrigger.click();
    const auditorOptions = page.getByRole('listbox', { name: '조언자 후보' });
    await expect(auditorOptions.getByRole('option', { name: '허저' })).toHaveCount(0);
    await auditorOptions.getByRole('option', { name: '장료' }).click();
    await expect(auditorTrigger).toHaveAccessibleName('조언자 선택, 현재 2명');
    page.once('dialog', async (dialog) => {
        expect(dialog.message()).toBe('조언자를 변경할까요?');
        await dialog.accept();
    });
    await page.getByRole('button', { name: '조언자 임명 반영' }).click();
    await expect(page.getByTestId('game-toast').filter({ hasText: '권한을 변경했습니다.' })).toBeVisible();
    await expect.poll(() => state.permissionMutationInput).toEqual({ isAmbassador: false, targetGeneralIds: [8, 6] });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await screenshot(page, 'core-personnel-mobile-permission-picker.png');
});

test('personnel selects an informed general and reports the JosaUtil-composed result in a toast', async ({ page }) => {
    const state: FixtureState = { role: 'head', rate: 20 };
    await installFixture(page, state);
    await page.setViewportSize({ width: 1000, height: 900 });
    await gotoOffice(page, 'nation/personnel');

    await page.getByRole('button', { name: '주부 변경하기', exact: true }).click();
    const picker = page.getByTestId('personnel-selection-dialog');
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('heading', { name: '주부 임명 대상 선택' })).toBeVisible();
    await picker.getByPlaceholder('장수명·도시·관직·특성 검색').fill('장료');
    const candidate = picker.getByRole('button', { name: /장료/ });
    await expect(candidate).toContainText('허창 · 일반 장수');
    await expect(candidate).toContainText('통솔70');
    await expect(candidate).toContainText('소속10년');
    await expect(candidate).toContainText('병력100');
    await candidate.hover();
    expect(await candidate.evaluate((button) => getComputedStyle(button).cursor)).toBe('pointer');
    await candidate.focus();
    expect(await candidate.evaluate((button) => getComputedStyle(button).outlineStyle)).not.toBe('none');
    await screenshot(page, 'core-personnel-desktop-general-picker.png');
    page.once('dialog', async (dialog) => {
        expect(dialog.message()).toBe('장료를 주부직에 임명하시겠습니까?');
        await dialog.accept();
    });
    await candidate.click();

    await expect(page.getByTestId('game-toast')).toContainText('장료를 임명했습니다.');
    expect(state.appointedGeneralId).toBe(6);
    expect(state.appointedCityId).toBe(0);
    expect(state.appointedOfficerLevel).toBe(11);
    await expect(page.locator('.feedback.status')).toHaveCount(0);
    await screenshot(page, 'core-personnel-appointment-toast.png');
});

test('personnel reflows row-level appointments at 500px and 390px without gradients or overflow', async ({ page }) => {
    const state: FixtureState = { role: 'head', rate: 20 };
    await installFixture(page, state);
    await page.setViewportSize({ width: 500, height: 900 });
    await gotoOffice(page, 'nation/personnel');
    await expect(page.getByText('작위검증국')).toBeVisible();
    expect(
        await page.locator('#personnel-container').evaluate((element) => element.getBoundingClientRect().width)
    ).toBe(500);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(500);
    const rowGeometry = await page.locator('#personnel-container').evaluate((container) => {
        const rect = (selector: string) => container.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        return {
            chiefWidth: rect('.chief-entry-cell').width,
            cityWidth: rect('.city-identity').width,
            officerWidth: rect('.city-officer-cell').width,
            gradientCount: [...container.querySelectorAll<HTMLElement>('*')].filter((element) =>
                getComputedStyle(element).backgroundImage.includes('gradient')
            ).length,
        };
    });
    expect(rowGeometry.chiefWidth).toBeGreaterThan(249);
    expect(rowGeometry.chiefWidth).toBeLessThan(251);
    expect(rowGeometry.cityWidth).toBeGreaterThan(79);
    expect(rowGeometry.cityWidth).toBeLessThan(81);
    expect(rowGeometry.officerWidth).toBeGreaterThan(139);
    expect(rowGeometry.officerWidth).toBeLessThan(141);
    expect(rowGeometry.gradientCount).toBe(0);
    await expect(page.getByRole('combobox', { name: '외교권자' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '추방 대상 장수' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '추방 대상 장수' }).locator('option')).toHaveText([
        '장수 선택',
        '하후돈 (70/70/70)',
        '곽가 (70/70/70)',
        '정욱 (70/70/70)',
        '장료 (70/70/70)',
    ]);

    await page.getByRole('button', { name: '허창 태수 변경하기', exact: true }).click();
    const picker = page.getByTestId('personnel-selection-dialog');
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('heading', { name: '허창 태수 변경' })).toBeVisible();
    expect(await picker.evaluate((element) => getComputedStyle(element).transitionDuration)).toContain('0.15s');
    await expect(picker).toHaveCSS('transform', 'none');
    const pickerGeometry = await picker.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            left: rect.left,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            maxHeight: style.maxHeight,
            borderTopLeftRadius: style.borderTopLeftRadius,
        };
    });
    expect(pickerGeometry.left).toBeGreaterThanOrEqual(0);
    expect(pickerGeometry.right).toBeLessThanOrEqual(500);
    expect(pickerGeometry.bottom).toBe(900);
    expect(pickerGeometry.width).toBeGreaterThan(480);
    expect(pickerGeometry.borderTopLeftRadius).toBe('16px');
    expect(
        await picker.evaluate(
            (element) =>
                [...element.querySelectorAll<HTMLElement>('*')].filter((child) =>
                    getComputedStyle(child).backgroundImage.includes('gradient')
                ).length
        )
    ).toBe(0);
    await expect(picker.getByRole('button', { name: /장료/ })).toContainText('허창 · 일반 장수');
    await expect(picker.getByRole('button', { name: /하후돈/ })).toContainText('현재 임명 중');
    await picker.getByRole('button', { name: /장료/ }).focus();
    expect(
        await picker.getByRole('button', { name: /장료/ }).evaluate((button) => getComputedStyle(button).outlineStyle)
    ).not.toBe('none');
    await screenshot(page, 'core-personnel-mobile-city-picker.png');
    page.once('dialog', async (dialog) => {
        expect(dialog.message()).toBe('장료를 허창 태수직에 임명하시겠습니까?');
        await dialog.accept();
    });
    await picker.getByRole('button', { name: /장료/ }).click();
    await expect(page.getByTestId('game-toast')).toContainText('장료를 임명했습니다.');
    expect(state.appointedGeneralId).toBe(6);
    expect(state.appointedCityId).toBe(1);
    expect(state.appointedOfficerLevel).toBe(4);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    expect(
        await page.locator('#personnel-container').evaluate((element) => element.getBoundingClientRect().width)
    ).toBe(390);
    const overflowContributors = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('body *')]
            .map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                    element: `${element.tagName.toLowerCase()}#${element.id}.${element.className}`,
                    parent: `${element.parentElement?.tagName.toLowerCase() ?? ''}#${element.parentElement?.id ?? ''}.${element.parentElement?.className ?? ''}`,
                    left: rect.left,
                    right: rect.right,
                    width: rect.width,
                };
            })
            .filter((entry) => entry.right > window.innerWidth + 0.5 || entry.left < -0.5)
            .slice(0, 12)
    );
    expect(overflowContributors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    const narrowChiefWidth = await page
        .locator('.chief-entry-cell')
        .first()
        .evaluate((element) => element.getBoundingClientRect().width);
    expect(narrowChiefWidth).toBeGreaterThan(194);
    expect(narrowChiefWidth).toBeLessThan(196);
    await screenshot(page, 'core-personnel-mobile-rows.png');
});

test('personnel hides every mutation control for an ordinary member and exposes load errors', async ({ page }) => {
    await installFixture(page, { role: 'member', rate: 20 });
    await gotoOffice(page, 'nation/personnel');
    await expect(page.getByRole('button', { name: /변경하기/ })).toHaveCount(0);
    await expect(page.getByText('외 교 권 자 임 명')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '추방 대상 장수' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '추방', exact: true })).toHaveCount(0);
    const auditorCell = page.locator('.city-officer-cell').filter({ hasText: '곽가' });
    await expect(auditorCell).toContainText('10년 · 허창');

    const failed = await page.context().newPage();
    await installFixture(failed, { role: 'member', rate: 20, failPersonnelLoad: true });
    await gotoOffice(failed, 'nation/personnel');
    await expect(failed.getByRole('alert')).toContainText('권한이 부족합니다.');
});

test('finance matches the reference 1000px and 500px computed DOM contracts', async ({ page }) => {
    await installFixture(page, { role: 'head', rate: 20 });
    await page.setViewportSize({ width: 1000, height: 900 });
    await gotoOffice(page, 'nation/finance');
    await expect(page.getByText('외교관계')).toBeVisible();
    const desktop = await page.locator('#finance-container').evaluate((container) => {
        const geometry = (selector?: string) => {
            const element = selector ? container.querySelector<HTMLElement>(selector)! : container;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                width: rect.width,
                height: rect.height,
                gridTemplateColumns: style.gridTemplateColumns,
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                lineHeight: style.lineHeight,
                backgroundColor: style.backgroundColor,
                backgroundImage: style.backgroundImage,
            };
        };
        return {
            container: geometry(),
            top: geometry('.top-back-bar'),
            title: geometry('.diplomacy-title'),
            row: geometry('.diplomacy-row'),
            notice: geometry('.notice-title'),
            finance: geometry('.finance-title'),
            input: geometry('input[type="number"]'),
        };
    });
    expect(desktop.container.width).toBe(1000);
    expect(desktop.container.fontFamily).toContain('Pretendard');
    expect(desktop.container.fontSize).toBe('14px');
    expect(desktop.container.backgroundImage).toContain('back_walnut.jpg');
    expect(desktop.top.height).toBe(32);
    expect(desktop.top.gridTemplateColumns).toBe('90px 90px 640px 90px 90px');
    expect(desktop.title.height).toBeCloseTo(25.47, 1);
    expect(desktop.title.backgroundColor).toBe('rgb(55, 90, 127)');
    expect(desktop.row.gridTemplateColumns).toBe(
        '260.859px 130.438px 86.9531px 86.9531px 173.922px 86.9531px 173.922px'
    );
    expect(desktop.notice.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(desktop.finance.backgroundColor).toBe('rgb(0, 188, 140)');
    expect(desktop.input.width).toBeCloseTo(58.66, 1);
    expect(desktop.input.height).toBe(30);
    expect(
        await page
            .locator('.policy-submit')
            .first()
            .evaluate((element) => getComputedStyle(element).backgroundColor)
    ).toBe('rgb(55, 90, 127)');
    expect(
        await page
            .locator('.policy-cancel')
            .first()
            .evaluate((element) => getComputedStyle(element).backgroundColor)
    ).toBe('rgb(108, 117, 125)');
    expect(
        await page
            .getByRole('checkbox', { name: '전쟁 금지' })
            .evaluate((element) => getComputedStyle(element).borderRadius)
    ).toBe('16px');
    await screenshot(page, 'core-finance-desktop-head.png');

    await page.setViewportSize({ width: 500, height: 900 });
    await page.reload();
    await expect(page.getByText('외교관계')).toBeVisible();
    expect(await page.locator('#finance-container').evaluate((element) => element.getBoundingClientRect().width)).toBe(
        500
    );
    expect(
        await page.locator('.top-back-bar').evaluate((element) => getComputedStyle(element).gridTemplateColumns)
    ).toBe('90px 90px 140px 90px 90px');
    expect(
        await page
            .locator('.diplomacy-row')
            .first()
            .evaluate((element) => getComputedStyle(element).gridTemplateColumns)
    ).toBe('130.422px 65.2188px 43.4844px 43.4688px 86.9688px 43.4688px 86.9688px');
    await screenshot(page, 'core-finance-mobile-head.png');
});

test('finance enforces edit permissions and preserves the old value across an API failure', async ({ page }) => {
    const state: FixtureState = { role: 'head', rate: 20, failNextRate: true };
    await installFixture(page, state);
    await gotoOffice(page, 'nation/finance');
    const input = page.getByRole('spinbutton', { name: '세율' });
    await input.fill('25');
    await page.locator('.policy-cell').filter({ hasText: '세율' }).getByRole('button', { name: '변경' }).click();
    await expect(page.locator('[data-testid="game-toast"][data-feedback-kind="error"]')).toContainText(
        '세율을 변경할 수 없습니다.'
    );
    await expect(input).toHaveValue('20');
    await input.fill('25');
    await page.locator('.policy-cell').filter({ hasText: '세율' }).getByRole('button', { name: '변경' }).click();
    await expect(page.locator('[data-testid="game-toast"][data-feedback-kind="success"]')).toContainText(
        '세율을 변경했습니다.'
    );
    expect(state.rate).toBe(25);

    const readOnly = await page.context().newPage();
    await installFixture(readOnly, { role: 'member', rate: 20 });
    await gotoOffice(readOnly, 'nation/finance');
    await expect(readOnly.getByRole('button', { name: '국가방침 수정' })).toHaveCount(0);
    await expect(readOnly.locator('.policy-cell').getByRole('button', { name: '변경' })).toHaveCount(0);
    await expect(readOnly.getByRole('checkbox', { name: '전쟁 금지' })).toBeDisabled();
});

test('finance editor preserves Ref formatting controls and uploads images through sam-image', async ({ page }) => {
    const state: FixtureState = { role: 'head', rate: 20 };
    await installFixture(page, state);
    await page.setViewportSize({ width: 1000, height: 900 });
    await gotoOffice(page, 'nation/finance');
    await page.getByRole('button', { name: '국가방침 수정' }).click();

    const editor = page.getByRole('textbox', { name: '국가 방침' });
    const editorFrame = page.locator('#notice-form .legacy-html-editor');
    await expect(editor).toBeVisible();
    expect(await editorFrame.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    expect(await editor.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');

    await editor.fill('첫 번째 항목');
    await page.getByRole('button', { name: '번호 목록' }).click();
    await expect(editor.locator('ol')).toHaveCSS('list-style-type', 'decimal');
    await expect(editor.locator('li')).toContainText('첫 번째 항목');
    await screenshot(page, 'core-finance-numbered-list-desktop.png');
    await page.getByRole('button', { name: '번호 목록' }).click();

    const alignmentIcons = await page
        .getByRole('toolbar', { name: '서식' })
        .getByRole('button', { name: /^(왼쪽|가운데|오른쪽) 정렬$/ })
        .locator('svg')
        .evaluateAll((icons) => icons.map((icon) => icon.innerHTML));
    expect(alignmentIcons).toHaveLength(3);
    expect(new Set(alignmentIcons).size).toBe(3);

    await editor.fill('서식 검증');
    await editor.press('Control+A');
    await page.getByRole('combobox', { name: '글꼴', exact: true }).selectOption('Gungsuh, serif');
    await page.getByRole('combobox', { name: '글꼴 크기' }).selectOption('22px');
    await page.getByLabel('글자색').evaluate((element) => {
        const input = element as HTMLInputElement;
        input.value = '#123456';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.getByLabel('배경색').evaluate((element) => {
        const input = element as HTMLInputElement;
        input.value = '#fedcba';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.getByRole('button', { name: '가운데 정렬' }).click();
    await expect(page.getByRole('button', { name: '가운데 정렬' })).toHaveClass(/active/);

    const formattedText = editor.locator('span', { hasText: '서식 검증' });
    await expect(formattedText).toHaveCSS('font-family', /Gungsuh/);
    await expect(formattedText).toHaveCSS('font-size', '22px');
    await expect(formattedText).toHaveCSS('color', 'rgb(18, 52, 86)');
    await expect(formattedText).toHaveCSS('background-color', 'rgb(254, 220, 186)');
    await expect(editor.locator('p')).toHaveCSS('text-align', 'center');

    await editor.press('End');
    await page.getByRole('button', { name: '구분선' }).click();
    await page.getByLabel('업로드할 이미지').setInputFiles({
        name: '방침.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64'
        ),
    });

    await expect.poll(() => state.uploadDataUrl).toMatch(/^data:image\/png;base64,/);
    await expect(editor.locator('hr')).toHaveCount(1);
    const uploadedImage = editor.locator('img');
    await expect(uploadedImage).toHaveAttribute(
        'src',
        'https://sam-image.hided.net/uploads/core2026/0123456789abcdef0123456789abcdef.webp'
    );

    await uploadedImage.click();
    const imageToolbar = page.getByRole('toolbar', { name: '이미지 정렬' });
    await expect(imageToolbar).toBeVisible();
    await expect(imageToolbar.getByRole('button')).toHaveCount(5);
    await screenshot(page, 'core-finance-image-toolbar-desktop.png');
    await imageToolbar.getByRole('button', { name: '이미지 오른쪽 정렬' }).click();
    await expect(uploadedImage).toHaveClass(/custom-image-align-right/);
    await expect(uploadedImage).toHaveCSS('display', 'block');
    await expect(uploadedImage).toHaveCSS('margin-right', '0px');

    await page.getByRole('toolbar', { name: '서식' }).getByRole('button', { name: '가운데 정렬' }).click();
    await expect(uploadedImage).toHaveClass(/custom-image-align-center/);
    await uploadedImage.click();
    await imageToolbar.getByRole('button', { name: '이미지 오른쪽 정렬' }).click();

    const imageButton = page.getByRole('button', { name: '이미지', exact: true });
    await imageButton.hover();
    await expect(imageButton).toHaveCSS('border-color', 'rgb(157, 200, 240)');
    await page.getByRole('combobox', { name: '글꼴', exact: true }).focus();
    await expect(page.getByRole('combobox', { name: '글꼴', exact: true })).toHaveCSS('outline-style', 'solid');
    await screenshot(page, 'core-finance-editor-desktop.png');

    await page.setViewportSize({ width: 500, height: 900 });
    const mobileGeometry = await editorFrame.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        scrollWidth: element.scrollWidth,
        toolbarHeight: element.querySelector('[role="toolbar"]')?.getBoundingClientRect().height ?? 0,
    }));
    expect(mobileGeometry.width).toBe(500);
    expect(mobileGeometry.scrollWidth).toBeLessThanOrEqual(500);
    expect(mobileGeometry.toolbarHeight).toBeGreaterThan(24);
    await screenshot(page, 'core-finance-editor-mobile.png');

    await page.locator('#notice-form').getByRole('button', { name: '저장' }).click();
    await expect.poll(() => state.noticeMutationInput).toContain('font-family: Gungsuh, serif');
    expect(state.noticeMutationInput).toContain('font-size: 22px');
    expect(state.noticeMutationInput).toContain('color: rgb(18, 52, 86)');
    expect(state.noticeMutationInput).toContain('background-color: rgb(254, 220, 186)');
    expect(state.noticeMutationInput).toContain('text-align: center');
    expect(state.noticeMutationInput).toContain('<hr>');
    expect(state.noticeMutationInput).toContain('class="custom-image-align-right"');
    expect(state.noticeMutationInput).toContain(
        'https://sam-image.hided.net/uploads/core2026/0123456789abcdef0123456789abcdef.webp'
    );
});

test('recruitment editor keeps the Ref 870px content width in desktop and scales it to 500px on mobile', async ({
    page,
}) => {
    await installFixture(page, { role: 'head', rate: 20 });
    await page.setViewportSize({ width: 1000, height: 900 });
    await gotoOffice(page, 'nation/finance');
    await page.getByRole('button', { name: '임관 권유문 수정' }).click();

    const form = page.locator('#scout-message-form');
    const editorFrame = form.locator('.legacy-html-editor');
    const desktop = await form.evaluate((element) => {
        const frame = element.querySelector<HTMLElement>('.legacy-html-editor')!;
        const formRect = element.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();
        return {
            formWidth: formRect.width,
            frameWidth: frameRect.width,
            leftInset: frameRect.left - formRect.left,
            rightInset: formRect.right - frameRect.right,
        };
    });
    expect(desktop.formWidth).toBe(1000);
    expect(desktop.frameWidth).toBe(870);
    expect(desktop.leftInset).toBe(130);
    expect(desktop.rightInset).toBe(0);

    await page.setViewportSize({ width: 500, height: 900 });
    const mobile = await editorFrame.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            visualWidth: rect.width,
            sourceWidth: element.clientWidth,
            toolbarWidth: element.querySelector<HTMLElement>('[role="toolbar"]')!.getBoundingClientRect().width,
        };
    });
    expect(mobile.sourceWidth).toBe(870);
    expect(mobile.visualWidth).toBeCloseTo(500, 1);
    expect(mobile.toolbarWidth).toBeCloseTo(500, 1);
    expect(await page.locator('.page-finance').evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(500);
    await screenshot(page, 'core-finance-scout-editor-mobile.png');
});

test('finance adopts the server-purified notice and scout message before rendering the saved preview', async ({
    page,
}) => {
    const state: FixtureState = { role: 'head', rate: 20 };
    await installFixture(page, state);
    await gotoOffice(page, 'nation/finance');

    const dirtyNotice =
        '<script>globalThis.__nationNoticeXss=1</script><img src=x onerror="globalThis.__nationNoticeXss=2"><p data-flip="horizontal" style="color:#00ffff">원문</p>';
    await page.getByRole('button', { name: '국가방침 수정' }).click();
    await page.getByRole('textbox', { name: '국가 방침' }).fill(dirtyNotice);
    await page.locator('#notice-form').getByRole('button', { name: '저장' }).click();

    const noticePreview = page.locator('#notice-form .message-preview');
    await expect(noticePreview).toContainText('서버 정화 방침');
    expect(state.noticeMutationInput).not.toContain('<script>');
    expect(state.noticeMutationInput).toContain('&lt;script&gt;');
    expect(state.noticeMutationInput).toContain('&lt;img src=x onerror=');
    await expect(noticePreview.locator('[data-flip="horizontal"]')).toHaveCSS('color', 'rgb(0, 255, 255)');
    await expect(noticePreview.locator('script, svg, [onerror], [onload], [onclick]')).toHaveCount(0);
    await expect
        .poll(() =>
            page.evaluate(() => (globalThis as typeof globalThis & { __nationNoticeXss?: number }).__nationNoticeXss)
        )
        .toBeUndefined();

    const dirtyScout =
        '<svg onload="globalThis.__nationScoutXss=1"></svg><a href="javascript:alert(1)" onclick="globalThis.__nationScoutXss=2">원문</a>';
    await page.getByRole('button', { name: '임관 권유문 수정' }).click();
    await page.getByRole('textbox', { name: '임관 권유' }).fill(dirtyScout);
    await page.locator('#scout-message-form').getByRole('button', { name: '저장' }).click();

    const scoutPreview = page.locator('#scout-message-form .message-preview');
    await expect(scoutPreview).toContainText('서버 정화 임관문');
    expect(state.scoutMutationInput).not.toContain('<svg');
    expect(state.scoutMutationInput).toContain('&lt;svg onload=');
    expect(state.scoutMutationInput).toContain('&lt;a href="javascript:alert(1)"');
    await expect(scoutPreview.locator('a', { hasText: '위험 링크' })).not.toHaveAttribute('href');
    await expect(scoutPreview.locator('script, svg, [onerror], [onload], [onclick]')).toHaveCount(0);
    await expect
        .poll(() =>
            page.evaluate(() => (globalThis as typeof globalThis & { __nationScoutXss?: number }).__nationScoutXss)
        )
        .toBeUndefined();
});
