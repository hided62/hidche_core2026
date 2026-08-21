import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameProfile, gameTrpcRoute } from './gameTestPaths.js';
import { touchDrag } from './touchDrag.js';

type FixtureState = {
    permissionLevel: number;
    failNextMutation?: boolean;
    failLoad?: boolean;
    mutations: string[];
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const artifactRoot = process.env.NPC_POLICY_PARITY_ARTIFACT_DIR
    ? resolve(process.env.NPC_POLICY_PARITY_ARTIFACT_DIR)
    : null;
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
const fulfillJson = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const nationPriority = [
    '불가침제의',
    '선전포고',
    '천도',
    '유저장긴급포상',
    '부대전방발령',
    '유저장구출발령',
    '유저장후방발령',
    '부대유저장후방발령',
    '유저장전방발령',
    '유저장포상',
    '부대구출발령',
    '부대후방발령',
    'NPC긴급포상',
    'NPC구출발령',
    'NPC후방발령',
    'NPC포상',
    'NPC전방발령',
    '유저장내정발령',
    'NPC내정발령',
    'NPC몰수',
];
const generalPriority = [
    'NPC사망대비',
    '귀환',
    '금쌀구매',
    '출병',
    '긴급내정',
    '전투준비',
    '전방워프',
    'NPC헌납',
    '징병',
    '후방워프',
    '전쟁내정',
    '소집해제',
    '일반내정',
    '내정워프',
];
const policy = {
    reqNationGold: 10_000,
    reqNationRice: 12_000,
    CombatForce: {},
    SupportForce: [],
    DevelopForce: [],
    reqHumanWarUrgentGold: 0,
    reqHumanWarUrgentRice: 0,
    reqHumanWarRecommandGold: 0,
    reqHumanWarRecommandRice: 0,
    reqHumanDevelGold: 10_000,
    reqHumanDevelRice: 10_000,
    reqNPCWarGold: 0,
    reqNPCWarRice: 0,
    reqNPCDevelGold: 0,
    reqNPCDevelRice: 500,
    minimumResourceActionAmount: 1_000,
    maximumResourceActionAmount: 10_000,
    minNPCWarLeadership: 40,
    minWarCrew: 1_500,
    minNPCRecruitCityPopulation: 50_000,
    safeRecruitCityPopulationRatio: 0.5,
    properWarTrainAtmos: 90,
    cureThreshold: 10,
};

const policyFixture = (state: FixtureState) => ({
    nationId: 1,
    nationName: '위',
    nationLevel: 3,
    defaultNationPolicy: policy,
    currentNationPolicy: policy,
    zeroPolicy: {
        ...policy,
        reqHumanWarUrgentGold: 7_600,
        reqHumanWarUrgentRice: 7_600,
        reqHumanWarRecommandGold: 15_200,
        reqHumanWarRecommandRice: 15_200,
        reqNPCWarGold: 2_700,
        reqNPCWarRice: 2_700,
        reqNPCDevelGold: 540,
    },
    defaultNationPriority: nationPriority,
    currentNationPriority: nationPriority,
    availableNationPriorityItems: nationPriority,
    defaultGeneralActionPriority: generalPriority,
    currentGeneralActionPriority: generalPriority,
    availableGeneralActionPriorityItems: generalPriority,
    lastSetters: {
        policy: { setter: null, date: null },
        nation: { setter: null, date: null },
        general: { setter: null, date: null },
    },
    defaultStatMax: 70,
    defaultStatNpcMax: 75,
    permissionLevel: state.permissionLevel,
});

const installFixture = async (page: Page, state: FixtureState) => {
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_npc_policy_playwright');
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
    await page.route(gameTrpcRoute, async (route) => {
        const operations = operationName(route).split(',');
        const results = operations.map((operation) => {
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') return response({ myGeneral: { id: 22, name: '정책담당' } });
            if (operation === 'join.getConfig') return response({});
            if (operation === 'npc.getPolicy') {
                return state.failLoad
                    ? errorResponse(operation, '권한이 부족합니다.', 'FORBIDDEN')
                    : response(policyFixture(state));
            }
            if (
                operation === 'npc.setNationPolicy' ||
                operation === 'npc.setNationPriority' ||
                operation === 'npc.setGeneralPriority'
            ) {
                state.mutations.push(operation);
                if (state.failNextMutation) {
                    state.failNextMutation = false;
                    return errorResponse(operation, '권한이 부족합니다.', 'FORBIDDEN');
                }
                return response({ ok: true });
            }
            return errorResponse(operation, `Unhandled fixture operation: ${operation}`);
        });
        await fulfillJson(route, results);
    });
};

const gotoPolicy = async (page: Page) => {
    await page.goto('npc-control');
};

const screenshot = async (page: Page, name: string) => {
    if (!artifactRoot) return;
    await mkdir(artifactRoot, { recursive: true });
    await page.screenshot({ path: resolve(artifactRoot, name), fullPage: true });
};

test('desktop geometry, typography, textures, drag, focus, tooltip, and successful save match the reference', async ({
    page,
}) => {
    const state: FixtureState = { permissionLevel: 4, mutations: [] };
    await installFixture(page, state);
    await page.setViewportSize({ width: 1000, height: 900 });
    await gotoPolicy(page);
    await expect(page.locator('#container')).toBeVisible();

    const computed = await page.evaluate(() => {
        const measure = (selector: string) => {
            const element = document.querySelector<HTMLElement>(selector)!;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                display: style.display,
                gridTemplateColumns: style.gridTemplateColumns,
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                lineHeight: style.lineHeight,
                color: style.color,
                backgroundImage: style.backgroundImage,
                backgroundColor: style.backgroundColor,
            };
        };
        return {
            body: measure('body'),
            container: measure('#container'),
            topBar: measure('.top-back-bar'),
            section: measure('.section_bar'),
            form: measure('.form_list'),
            field: measure('.policy-field'),
            input: measure('.field-row input'),
            control: measure('.control_bar'),
            reset: measure('.reset_btn'),
            submit: measure('.submit_btn'),
            priorityPanel: measure('.priority-panel'),
            priorityList: measure('.priority-list'),
            inactiveHeader: measure('.inactive-header'),
            activeItem: measure('.priority-column:nth-child(2) .priority-item'),
            help: measure('.help-button'),
            documentWidth: document.documentElement.scrollWidth,
        };
    });

    expect(computed.body).toMatchObject({ width: 1000, fontSize: '14px', lineHeight: '21px' });
    expect(computed.body.fontFamily).toContain('Pretendard');
    expect(computed.container).toMatchObject({ x: 0, y: 32, width: 1000 });
    expect(computed.container.backgroundImage).toContain('back_walnut.jpg');
    expect(computed.topBar).toMatchObject({ width: 1000, height: 32 });
    expect(computed.section).toMatchObject({ x: 1, y: 33, width: 998, height: 23 });
    expect(computed.section.backgroundImage).toContain('back_green.jpg');
    expect(computed.form).toMatchObject({ x: 9, width: 982 });
    expect(computed.form.gridTemplateColumns).toBe('491px 491px');
    expect(computed.field.width).toBeCloseTo(491, 0);
    expect(computed.input).toMatchObject({ width: 224, height: 34 });
    expect(computed.reset).toMatchObject({ width: 150, height: 35.5, backgroundColor: 'rgb(48, 48, 48)' });
    expect(computed.submit).toMatchObject({ width: 150, height: 35.5, backgroundColor: 'rgb(55, 90, 127)' });
    expect(computed.priorityPanel.width).toBeCloseTo(499, 0);
    expect(computed.priorityList.width).toBeCloseTo(229, 0);
    expect(computed.inactiveHeader).toMatchObject({ height: 37, backgroundColor: 'rgb(214, 214, 214)' });
    expect(computed.activeItem.height).toBe(37);
    expect(computed.help).toMatchObject({ width: 24, height: 22.375 });
    expect(computed.documentWidth).toBe(1000);
    await screenshot(page, 'core-npc-policy-desktop-baseline.png');

    const goldInput = page.getByLabel('국가 권장 금');
    await goldInput.focus();
    await expect(goldInput).toBeFocused();
    expect(await goldInput.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');

    const help = page.getByRole('button', { name: '불가침제의 설명' });
    await help.hover();
    await expect.poll(() => help.evaluate((element) => getComputedStyle(element, '::after').opacity)).toBe('1');

    const active = page.locator('.priority-panel').first().locator('.priority-column').nth(1).getByText('불가침제의');
    await active.dragTo(
        page.locator('.priority-panel').first().locator('.priority-column').first().locator('.priority-list')
    );
    await expect(
        page.locator('.priority-panel').first().locator('.priority-column').first().getByText('불가침제의')
    ).toBeVisible();

    await goldInput.fill('12345');
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#container > .control_bar').getByRole('button', { name: '설정' }).click();
    await expect(page.getByRole('status')).toContainText('NPC 정책이 반영되었습니다.');
    expect(state.mutations).toContain('npc.setNationPolicy');
    await screenshot(page, 'core-npc-policy-desktop.png');
});

test('500px layout stacks policy fields and priority panels like the reference', async ({ page }) => {
    await installFixture(page, { permissionLevel: 4, mutations: [] });
    await page.setViewportSize({ width: 500, height: 900 });
    await gotoPolicy(page);
    await expect(page.locator('#container')).toBeVisible();

    const geometry = await page.evaluate(() => {
        const rect = (selector: string) => {
            const value = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
            return { x: value.x, y: value.y, width: value.width, height: value.height };
        };
        return {
            container: rect('#container'),
            form: rect('.form_list'),
            firstField: rect('.policy-field'),
            panels: [...document.querySelectorAll<HTMLElement>('.priority-panel')].map((element) => {
                const value = element.getBoundingClientRect();
                return { x: value.x, y: value.y, width: value.width };
            }),
            documentWidth: document.documentElement.scrollWidth,
        };
    });

    expect(geometry.container).toMatchObject({ x: 0, y: 32, width: 500 });
    expect(geometry.form).toMatchObject({ x: 9, width: 482 });
    expect(geometry.firstField.width).toBeCloseTo(482, 0);
    expect(geometry.panels).toHaveLength(2);
    expect(geometry.panels[0]).toMatchObject({ x: 1, width: 498 });
    expect(geometry.panels[1]?.x).toBe(1);
    expect(geometry.panels[1]?.y).toBeGreaterThan(geometry.panels[0]?.y ?? 0);
    expect(geometry.documentWidth).toBe(500);
    await screenshot(page, 'core-npc-policy-mobile.png');
});

test('physical mobile touch reorders NPC priority across active and inactive lists', async ({ browser }, testInfo) => {
    const configuredBaseUrl = testInfo.project.use.baseURL;
    if (typeof configuredBaseUrl !== 'string') {
        throw new Error('Playwright baseURL is required for the mobile touch contract');
    }
    const context = await browser.newContext({
        baseURL: configuredBaseUrl,
        viewport: { width: 390, height: 844 },
        screen: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
        colorScheme: 'dark',
    });
    const mobilePage = await context.newPage();
    try {
        await installFixture(mobilePage, { permissionLevel: 4, mutations: [] });
        await gotoPolicy(mobilePage);
        await expect(mobilePage.locator('#container')).toBeVisible();

        const nationPanel = mobilePage.locator('.priority-panel').first();
        const activeList = nationPanel.locator('.priority-column').nth(1).locator('.priority-list');
        const activeRows = activeList.locator('.priority-item');
        await touchDrag(
            mobilePage,
            activeRows.nth(0),
            activeRows.nth(3),
            { targetYRatio: 0.9 }
        );
        await expect
            .poll(() =>
                activeList
                    .locator('.priority-item .priority_info > span:nth-child(2)')
                    .first()
                    .textContent()
            )
            .toBe('선전포고');

        const activeItem = activeList.getByText('불가침제의', { exact: true });
        const inactiveList = nationPanel.locator('.priority-column').first().locator('.priority-list');
        await touchDrag(mobilePage, activeItem, inactiveList.locator('.inactive-header'));

        await expect(inactiveList.getByText('불가침제의', { exact: true })).toBeVisible();
        await expect(
            activeList.getByText('불가침제의', { exact: true })
        ).toHaveCount(0);
        await mobilePage.screenshot({ path: testInfo.outputPath('npc-priority-mobile-touch.png'), fullPage: true });
    } finally {
        await context.close();
    }
});

test('a read-level user sees enabled legacy controls but a forbidden save retains the draft', async ({ page }) => {
    const state: FixtureState = { permissionLevel: 1, failNextMutation: true, mutations: [] };
    await installFixture(page, state);
    await gotoPolicy(page);

    const input = page.getByLabel('국가 권장 금');
    await expect(input).toBeEnabled();
    await input.fill('23456');
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#container > .control_bar').getByRole('button', { name: '설정' }).click();
    await expect(page.getByRole('alert')).toContainText('권한이 부족합니다.');
    await expect(input).toHaveValue('23456');
    expect(state.mutations).toEqual(['npc.setNationPolicy']);
});

test('a user below secret read permission receives a recoverable page error', async ({ page }) => {
    await installFixture(page, { permissionLevel: 0, failLoad: true, mutations: [] });
    await gotoPolicy(page);
    await expect(page.getByRole('alert')).toContainText('권한이 부족합니다.');
    await expect(page.locator('#container')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();
});
