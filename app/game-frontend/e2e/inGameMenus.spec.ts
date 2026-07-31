import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';

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

type FixtureState = {
    permission: 'head' | 'member';
    myset: number;
    scenarioEffect?: string | null;
    instantRetreatEnabled?: boolean;
    instantRetreatAttempts?: number;
    instantRetreatInputs?: Array<Record<string, unknown>>;
    generalMeQueries?: number;
    generalLogQueries?: number;
    settingMutations: Array<Record<string, unknown>>;
    accessPages: string[];
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
        nationId: 1,
        cityId: 1,
        troopId: 0,
        picture: null,
        imageServer: 0,
        officerLevel: state.permission === 'head' ? 5 : 1,
        stats: { leadership: 70, strength: 60, intelligence: 50 },
        gold: 1_000,
        rice: 2_000,
        crew: 300,
        train: 80,
        atmos: 90,
        injury: 0,
        experience: 100,
        dedication: 200,
        items: { horse: 'che_명마', weapon: null, book: null, item: null },
    },
    city: { id: 1, name: '업', level: 8, nationId: 1 },
    nation: { id: 1, name: '위', color: '#777777', level: 3 },
    settings: {
        tnmt: 0,
        defence_train: 80,
        use_treatment: 21,
        use_auto_nation_turn: 1,
        myset: state.myset,
    },
    penalties: {},
});

const battleCenter = (state: FixtureState) => ({
    me: {
        id: 7,
        officerLevel: state.permission === 'head' ? 5 : 1,
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
            officerLevel: state.permission === 'head' ? 5 : 1,
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
        },
        {
            id: 8,
            name: '다른장수',
            npcState: 2,
            officerLevel: 1,
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
        },
    ],
});

const install = async (page: Page, state: FixtureState) => {
    await page.addInitScript(() => {
        localStorage.setItem('sammo-game-token', 'ga_menu-token');
        localStorage.setItem('sammo-game-profile', 'che:default');
    });
    await page.route('**/image/game/**', async (route) => {
        const filename = basename(new URL(route.request().url()).pathname);
        if (legacyImageRoot && ['back_walnut.jpg', 'back_green.jpg', 'back_blue.jpg'].includes(filename)) {
            await route.fulfill({
                status: 200,
                contentType: 'image/jpeg',
                body: await readFile(resolve(legacyImageRoot, filename)),
            });
            return;
        }
        await route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from('') });
    });
    await page.route('**/che/api/trpc/**', async (route) => {
        const operations = operationNames(route);
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
            if (operation === 'lobby.info') return response({ myGeneral: { id: 7, name: '검증장수' } });
            if (operation === 'join.getConfig') return response({});
            if (operation === 'general.me') {
                state.generalMeQueries = (state.generalMeQueries ?? 0) + 1;
                return response(myGeneral(state));
            }
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
                        opentime: '2025-12-01T00:00:00.000Z',
                        autorun_user: {},
                    },
                });
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
                return response({ type: 'generalAction', logs: [{ id: 1, text: '<Y>기록</>' }] });
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
            if (operation === 'general.setMySetting') {
                state.settingMutations.push(jsonInput);
                state.myset = Math.max(0, state.myset - 1);
                return response({ ok: true });
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
                const type = new URL(route.request().url()).searchParams.get('input')?.includes('generalAction')
                    ? 'generalAction'
                    : operation;
                return response({ type, generalId: 7, logs: [{ id: 1, text: '<Y>감찰 기록</>' }] });
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

test('내 정보&설정 keeps the legacy 1000px/500px geometry and saves in place', async ({ page }) => {
    const state: FixtureState = { permission: 'head', myset: 3, settingMutations: [], accessPages: [] };
    await install(page, state);
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('my-page');
    await expect(page.locator('.title-row')).toContainText('내 정 보');
    await expect(page.locator('#set_my_setting')).toBeVisible();
    await expect.poll(() => state.accessPages).toContain('my-page');
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
    expect(desktop.minWidth).toBe('500px');
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

    await page.setViewportSize({ width: 500, height: 900 });
    await page.reload();
    const mobile = await page.locator('#container').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const settings = element.querySelector<HTMLElement>('.settings-column')!.getBoundingClientRect();
        return {
            width: rect.width,
            scrollWidth: document.documentElement.scrollWidth,
            columns: getComputedStyle(element.querySelector('.top-grid')!).gridTemplateColumns,
            settingsOffset: settings.x - rect.x,
            settingsWidth: settings.width,
        };
    });
    expect(mobile).toMatchObject({
        width: 500,
        scrollWidth: 500,
        columns: '500px',
        settingsOffset: 0,
        settingsWidth: 500,
    });
    await persistParityArtifact(page, 'core-my-page-mobile', mobile);
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

    await instantRetreatButton.click();
    await expect.poll(() => state.instantRetreatInputs?.length).toBe(1);
    await expect
        .poll(() => dialogs.some((message) => message.includes('요청 처리 결과를 확인하지 못했습니다.')))
        .toBe(true);
    expect(state.generalMeQueries).toBe(1);

    await instantRetreatButton.click();
    await expect.poll(() => state.instantRetreatInputs?.length).toBe(2);
    await expect.poll(() => state.generalMeQueries).toBe(2);
    await expect.poll(() => state.generalLogQueries).toBe(8);
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

test('감찰부 keeps the selector interaction and shows the permission error path', async ({ page }) => {
    const head: FixtureState = { permission: 'head', myset: 3, settingMutations: [], accessPages: [] };
    await install(page, head);
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('battle-center');
    await expect(page.getByRole('heading', { name: '감찰부' })).toBeVisible();
    await expect(page.locator('.selector-row select').nth(1)).toHaveValue('8');
    await page.getByRole('button', { name: '다음 ▶' }).click();
    await expect(page.locator('.selector-row select').nth(1)).toHaveValue('7');
    const geometry = await page.locator('.battle-page').evaluate((element) => {
        const selector = element.querySelector<HTMLElement>('.selector-row')!;
        const controls = [...selector.children].map((child) => (child as HTMLElement).getBoundingClientRect());
        const logBlock = element.querySelector<HTMLElement>('.log-block')!.getBoundingClientRect();
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
    await persistParityArtifact(page, 'core-battle-center-desktop', geometry);

    await page.setViewportSize({ width: 500, height: 900 });
    const mobileGeometry = await page.locator('.selector-row').evaluate((element) => ({
        columns: getComputedStyle(element).gridTemplateColumns,
        controlWidths: [...element.children].map((child) => (child as HTMLElement).getBoundingClientRect().width),
    }));
    expect(mobileGeometry.columns.split(' ')).toHaveLength(4);
    expect(mobileGeometry.controlWidths[0]).toBeCloseTo(83.33, 0);
    expect(mobileGeometry.controlWidths[1]).toBeCloseTo(125, 0);
    await persistParityArtifact(page, 'core-battle-center-mobile', mobileGeometry);

    await page.unrouteAll({ behavior: 'wait' });
    const member: FixtureState = { permission: 'member', myset: 3, settingMutations: [], accessPages: [] };
    await install(page, member);
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('권한이 부족합니다.');
});
