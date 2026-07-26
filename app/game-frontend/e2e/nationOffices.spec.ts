import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Role = 'leader' | 'head' | 'member';
type FixtureState = {
    role: Role;
    failNextRate?: boolean;
    failPersonnelLoad?: boolean;
    rate: number;
    appointedGeneralId?: number;
};

const artifactRoot = process.env.OFFICE_PARITY_ARTIFACT_DIR ? resolve(process.env.OFFICE_PARITY_ARTIFACT_DIR) : null;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const imageRoots = [resolve(repositoryRoot, '../image'), resolve(repositoryRoot, '../../image')];
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
                      ],
                      auditors: [{ id: 6, name: '장료', npcState: 0, permission: 'normal', maxPermission: 4 }],
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
    await page.addInitScript(() => {
        localStorage.setItem('sammo-game-token', 'ga_office_playwright');
        localStorage.setItem('sammo-game-profile', 'che:default');
    });
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
    await page.route('**/che/api/trpc/**', async (route) => {
        const operations = operationName(route).split(',');
        const results = operations.map((operation) => {
            if (operation === 'lobby.info') return response({ myGeneral: { id: 1, name: '조조' } });
            if (operation === 'join.getConfig') return response({});
            if (operation === 'nation.getPersonnelInfo') {
                return state.failPersonnelLoad
                    ? errorResponse(operation, '권한이 부족합니다.', 'FORBIDDEN')
                    : response(personnelFixture(state));
            }
            if (operation === 'nation.getStratFinan') return response(financeFixture(state));
            if (operation === 'nation.appoint') {
                state.appointedGeneralId = 6;
                return response({ ok: true });
            }
            if (operation === 'nation.kick' || operation === 'nation.changePermission') return response({ ok: true });
            if (operation === 'nation.setRate') {
                if (state.failNextRate) {
                    state.failNextRate = false;
                    return errorResponse(operation, '세율을 변경할 수 없습니다.');
                }
                state.rate = 25;
                return response({ ok: true });
            }
            if (
                [
                    'nation.setNotice',
                    'nation.setScoutMsg',
                    'nation.setBill',
                    'nation.setSecretLimit',
                    'nation.setBlockScout',
                ].includes(operation)
            )
                return response({ ok: true });
            if (operation === 'nation.setBlockWar') return response({ availableCnt: 4 });
            return errorResponse(operation, `Unhandled fixture operation: ${operation}`);
        });
        await fulfillJson(route, results);
    });
};

const gotoOffice = async (page: Page, path: 'nation/personnel' | 'nation/finance') => {
    const lobbyResponse = page.waitForResponse((response) => response.url().includes('/trpc/lobby.info'));
    await page.goto(path);
    await lobbyResponse;
};
const screenshot = async (page: Page, name: string) => {
    if (!artifactRoot) return;
    await mkdir(artifactRoot, { recursive: true });
    await page.screenshot({ path: resolve(artifactRoot, name), fullPage: true });
};

test('personnel matches the 1000px legacy table geometry, textures, image, and interaction states', async ({
    page,
}) => {
    await installFixture(page, { role: 'leader', rate: 20 });
    await page.setViewportSize({ width: 1000, height: 900 });
    await gotoOffice(page, 'nation/personnel');
    await expect(page.getByText('작위검증국')).toBeVisible();

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
            documentWidth: document.documentElement.scrollWidth,
        };
    });
    expect(computed.container.width).toBe(1000);
    expect(computed.heading.width).toBe(1000);
    expect(computed.heading.height).toBeCloseTo(56, 0);
    expect(computed.status.width).toBe(1000);
    expect(computed.icon.width).toBeCloseTo(64.7, 0);
    expect(computed.icon.height).toBeCloseTo(64, 0);
    expect(computed.container.fontFamily).toContain('Pretendard');
    expect(computed.container.fontSize).toBe('14px');
    expect(computed.container.lineHeight).toBe('18.2px');
    expect(computed.status.backgroundImage).toContain('back_walnut.jpg');
    expect(computed.documentWidth).toBe(1000);

    const appointButton = page.getByRole('button', { name: '임명' }).first();
    expect(await appointButton.evaluate((button) => getComputedStyle(button).backgroundColor)).toBe(
        'rgb(108, 117, 125)'
    );
    await appointButton.hover();
    expect(await appointButton.evaluate((button) => getComputedStyle(button).cursor)).toBe('pointer');
    await appointButton.focus();
    expect(await appointButton.evaluate((button) => getComputedStyle(button).outlineStyle)).not.toBe('none');
    await screenshot(page, 'core-personnel-desktop-leader.png');
});

test('personnel preserves the legacy fixed 1000px document on a 500px viewport', async ({ page }) => {
    await installFixture(page, { role: 'head', rate: 20 });
    await page.setViewportSize({ width: 500, height: 900 });
    await gotoOffice(page, 'nation/personnel');
    await expect(page.getByText('작위검증국')).toBeVisible();
    expect(
        await page.locator('#personnel-container').evaluate((element) => element.getBoundingClientRect().width)
    ).toBe(1000);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1000);
    await expect(page.getByRole('combobox', { name: '외교권자' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: '추방 대상 장수' })).toBeVisible();
    await screenshot(page, 'core-personnel-mobile-head.png');
});

test('personnel hides every mutation control for an ordinary member and exposes load errors', async ({ page }) => {
    await installFixture(page, { role: 'member', rate: 20 });
    await gotoOffice(page, 'nation/personnel');
    await expect(page.getByText('도 시 관 직 임 명')).toHaveCount(0);
    await expect(page.getByText('외 교 권 자 임 명')).toHaveCount(0);
    await expect(page.getByText('추 방', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/곽가\(10년\).*허창/)).toBeVisible();

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
    await expect(page.getByRole('alert')).toContainText('세율을 변경할 수 없습니다.');
    await expect(input).toHaveValue('20');
    await input.fill('25');
    await page.locator('.policy-cell').filter({ hasText: '세율' }).getByRole('button', { name: '변경' }).click();
    await expect(page.getByRole('status')).toContainText('세율을 변경했습니다.');
    expect(state.rate).toBe(25);

    const readOnly = await page.context().newPage();
    await installFixture(readOnly, { role: 'member', rate: 20 });
    await gotoOffice(readOnly, 'nation/finance');
    await expect(readOnly.getByRole('button', { name: '국가방침 수정' })).toHaveCount(0);
    await expect(readOnly.locator('.policy-cell').getByRole('button', { name: '변경' })).toHaveCount(0);
    await expect(readOnly.getByRole('checkbox', { name: '전쟁 금지' })).toBeDisabled();
});
