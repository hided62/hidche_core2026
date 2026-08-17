import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    processBattleSimJob,
    type BattleSimJobPayload,
    type BattleSimRequestPayload,
    type BattleSimResultPayload,
} from '@sammo-ts/logic';
import { gameProfile, gameTrpcRoute } from './gameTestPaths.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const imageRoots = [
    ...(process.env.FRONTEND_PARITY_IMAGE_ROOT ? [resolve(process.env.FRONTEND_PARITY_IMAGE_ROOT)] : []),
    resolve(repositoryRoot, '../image'),
    resolve(repositoryRoot, '../../image'),
];
const artifactRoot = process.env.BATTLE_SIM_ARTIFACT_DIR;

const response = (data: unknown) => ({ result: { data } });
const errorResponse = (path: string, message: string) => ({
    error: {
        message,
        code: -32000,
        data: { code: 'BAD_REQUEST', httpStatus: 400, path },
    },
});

const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const readImage = async (relative: string): Promise<Buffer> => {
    for (const root of imageRoots) {
        try {
            return await readFile(resolve(root, relative));
        } catch {
            // Main checkout and feature worktrees have different image-root parents.
        }
    }
    throw new Error(`Reference image not found: ${relative}`);
};

const simulatorOptions = {
    world: { startYear: 190, currentYear: 205, currentMonth: 8 },
    config: {
        maxTrainByWar: 120,
        maxAtmosByWar: 120,
        maxTrainByCommand: 100,
        maxAtmosByCommand: 100,
    },
    unitSet: {
        defaultCrewTypeId: 100,
        crewTypes: [
            { id: 100, name: '보병', armType: 1 },
            { id: 200, name: '궁병', armType: 2 },
        ],
    },
    nationTypes: [{ key: 'che_도적', name: '도적', info: '금 수입 증가, 쌀 수입 감소' }],
    eventDomesticTraits: [{ key: 'che_event_신산', name: '신산', info: '계략 강화' }],
    warTraits: [{ key: 'che_필살', name: '필살', info: '필살 확률 증가' }],
    personalities: [{ key: 'che_대담', name: '대담', info: '공격적인 성격' }],
    items: { horse: [], weapon: [], book: [], item: [] },
    nationLevels: [
        { level: 0, name: '방랑군' },
        { level: 1, name: '소국' },
    ],
    cityLevels: [
        { level: 1, name: '소도시' },
        { level: 5, name: '대도시' },
    ],
    dexLevels: [
        { level: 0, label: 'F', value: 0 },
        { level: 1, label: 'E', value: 1000 },
    ],
};

const engineUnitSet: BattleSimJobPayload['unitSet'] = {
    id: 'playwright',
    name: 'playwright',
    crewTypes: [
        {
            id: 100,
            armType: 1,
            name: '보병',
            attack: 100,
            defence: 100,
            speed: 7,
            avoid: 10,
            magicCoef: 0,
            cost: 9,
            rice: 9,
            requirements: [],
            attackCoef: {},
            defenceCoef: {},
            info: [],
            initSkillTrigger: null,
            phaseSkillTrigger: null,
            iActionList: null,
        },
        {
            id: 999,
            armType: 9,
            name: '성벽',
            attack: 0,
            defence: 0,
            speed: 1,
            avoid: 0,
            magicCoef: 0,
            cost: 0,
            rice: 9,
            requirements: [],
            attackCoef: {},
            defenceCoef: {},
            info: [],
            initSkillTrigger: null,
            phaseSkillTrigger: null,
            iActionList: null,
        },
    ],
};

const engineConfig: BattleSimJobPayload['config'] = {
    armPerPhase: 500,
    maxTrainByCommand: 100,
    maxAtmosByCommand: 100,
    maxTrainByWar: 110,
    maxAtmosByWar: 150,
    castleCrewTypeId: 999,
    armTypes: {
        footman: 1,
        wizard: 4,
        siege: 5,
        misc: 6,
        castle: 9,
    },
};

const generalMe = {
    general: {
        id: 7,
        name: '유비',
        npcState: 0,
        nationId: 1,
        cityId: 1,
        troopId: 0,
        picture: '22.jpg',
        imageServer: 0,
        officerLevel: 12,
        stats: { leadership: 85, strength: 72, intelligence: 78 },
        gold: 1000,
        rice: 8765,
        crew: 4321,
        train: 99,
        atmos: 98,
        injury: 0,
        experience: 900,
        dedication: 100,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    city: { id: 1, level: 1, defence: 2222, wall: 3333 },
    nation: { id: 1, level: 1, tech: 4500, typeCode: 'che_중립', capitalCityId: 1 },
    settings: {},
    penalties: {},
};

const importedGeneral = {
    general: {
        no: 7,
        name: '유비',
        officer_level: 12,
        explevel: 30,
        leadership: 85,
        strength: 72,
        intel: 78,
        horse: null,
        weapon: null,
        book: null,
        item: null,
        injury: 0,
        rice: 8765,
        personal: 'che_대담',
        special2: 'che_필살',
        crew: 4321,
        crewtype: 100,
        atmos: 98,
        train: 99,
        dex1: 1000,
        dex2: 0,
        dex3: 0,
        dex4: 0,
        dex5: 0,
        defence_train: 90,
        warnum: 12,
        killnum: 7,
        killcrew: 3456,
    },
};

type Fixture = {
    hasGeneral: boolean;
    failNextSimulation?: boolean;
    prepareDelayMs?: number;
    requests: string[];
    preparedPayloads: BattleSimJobPayload[];
    serverResults: BattleSimResultPayload[];
};

const readOperationInput = (
    requestBody: Record<string, unknown>,
    operationCount: number,
    operationIndex: number
): unknown => {
    const rawPayload = requestBody[String(operationIndex)] ?? (operationCount === 1 ? requestBody : undefined);
    if (!rawPayload || typeof rawPayload !== 'object') {
        return rawPayload;
    }
    const payload = rawPayload as { json?: unknown; input?: { json?: unknown } };
    return payload.json ?? payload.input?.json ?? rawPayload;
};

const installImages = async (page: Page) => {
    for (const filename of ['back_walnut.jpg', 'back_green.jpg', 'back_blue.jpg']) {
        await page.route(`**/image/game/${filename}`, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'image/jpeg',
                body: await readImage(`game/${filename}`),
            });
        });
    }
};

const installApi = async (page: Page, fixture: Fixture) => {
    await installImages(page);
    await page.addInitScript(() => {
        const nativeWorker = window.Worker;
        const testWindow = window as unknown as {
            __battleWorkerResponses: unknown[];
            __battleWorkerUrls: string[];
        };
        testWindow.__battleWorkerResponses = [];
        testWindow.__battleWorkerUrls = [];
        window.Worker = class TrackedWorker extends nativeWorker {
            constructor(scriptURL: string | URL, options?: WorkerOptions) {
                super(scriptURL, options);
                testWindow.__battleWorkerUrls.push(String(scriptURL));
                this.addEventListener('message', (event) => testWindow.__battleWorkerResponses.push(event.data));
            }
        };
    });
    await page.addInitScript((profile) => {
        window.localStorage.setItem('sammo-game-token', 'ga_battle_sim_playwright');
        window.localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    await page.route(gameTrpcRoute, async (route) => {
        const operations = operationNames(route);
        if (fixture.prepareDelayMs && operations.includes('battle.prepareSimulation')) {
            await new Promise((resolveDelay) => setTimeout(resolveDelay, fixture.prepareDelayMs));
        }
        const rawRequestBody: unknown = route.request().postData() ? route.request().postDataJSON() : {};
        const requestBody =
            rawRequestBody && typeof rawRequestBody === 'object' ? (rawRequestBody as Record<string, unknown>) : {};
        const results = operations.map((operation, operationIndex) => {
            fixture.requests.push(operation);
            if (operation === 'auth.status') return response({ userId: 'battle-sim-user' });
            if (operation === 'lobby.info') {
                return response({
                    year: 205,
                    month: 8,
                    myGeneral: fixture.hasGeneral ? { name: '유비', picture: '22.jpg' } : null,
                });
            }
            if (operation === 'battle.getSimulatorContext') return response(simulatorOptions);
            if (operation === 'general.me') return response(fixture.hasGeneral ? generalMe : null);
            if (operation === 'battle.getGeneralList') {
                return response({
                    myNationId: 1,
                    myGeneralId: 7,
                    nations: [{ id: 1, name: '촉', color: '#8fbc8f' }],
                    generalsByNation: { 1: [{ id: 7, name: '유비', npcState: 0 }] },
                });
            }
            if (operation === 'battle.getGeneralDetail') return response(importedGeneral);
            if (operation === 'battle.prepareSimulation') {
                if (fixture.failNextSimulation) {
                    fixture.failNextSimulation = false;
                    return errorResponse(operation, '시뮬레이터 입력 오류');
                }
                const request = readOperationInput(
                    requestBody,
                    operations.length,
                    operationIndex
                ) as BattleSimRequestPayload;
                const prepared: BattleSimJobPayload = {
                    ...request,
                    seeds: request.seed
                        ? []
                        : Array.from({ length: request.repeatCnt }, (_, index) => `playwright-repeat-${index}`),
                    unitSet: engineUnitSet,
                    config: engineConfig,
                    time: { year: request.year, month: request.month, startYear: 190 },
                    scenarioEffect: null,
                };
                fixture.preparedPayloads.push(prepared);
                fixture.serverResults.push(processBattleSimJob(structuredClone(prepared)));
                return response(prepared);
            }
            return errorResponse(operation, `Unhandled battle simulator fixture operation: ${operation}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(results),
        });
    });
};

const readBrowserWorkerResult = async (page: Page, resultIndex: number): Promise<BattleSimResultPayload> => {
    await expect
        .poll(async () =>
            page.evaluate((index) => {
                const testWindow = window as unknown as { __battleWorkerResponses?: unknown[] };
                return Boolean(testWindow.__battleWorkerResponses?.[index]);
            }, resultIndex)
        )
        .toBe(true);
    const response = (await page.evaluate((index) => {
        const testWindow = window as unknown as { __battleWorkerResponses?: unknown[] };
        return testWindow.__battleWorkerResponses?.[index];
    }, resultIndex)) as {
        ok: boolean;
        result: BattleSimResultPayload;
    };
    expect(response.ok).toBe(true);
    return response.result;
};

const gotoSimulator = async (page: Page) => {
    await page.goto('battle-simulator');
    await expect(page.getByText('전역 설정')).toBeVisible();
    await expect(page.getByLabel('시뮬레이터 데이터 안내')).toBeVisible();
    await expect(page.getByText('출병자 설정')).toBeVisible();
};

test('operates independent/game presets, imports my general, and renders battle logs', async ({ page }) => {
    const fixture: Fixture = {
        hasGeneral: true,
        requests: [],
        preparedPayloads: [],
        serverResults: [],
    };
    await installApi(page, fixture);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoSimulator(page);

    const nationTypeSelects = page.locator('[data-parity-id="attacker-nation"] select').first();
    await expect(nationTypeSelects).toHaveValue('che_도적');
    await expect(nationTypeSelects.locator('option[value="che_중립"]')).toHaveCount(0);

    const notice = page.getByLabel('시뮬레이터 데이터 안내');
    const noticeRect = await notice.boundingBox();
    expect(noticeRect?.width).toBeLessThan(100);
    await notice.locator('summary').click();

    await page.getByRole('button', { name: '독립 기본값' }).click();
    await expect(page.getByLabel('연도', { exact: true })).toHaveValue('190');
    await expect(page.getByLabel('월')).toHaveValue('1');

    await page.getByRole('button', { name: '현재 게임 환경 적용' }).click();
    await expect(page.getByLabel('연도', { exact: true })).toHaveValue('205');
    await expect(page.getByLabel('월')).toHaveValue('8');

    await page.getByRole('button', { name: '내 장수를 출병자로' }).click();
    await expect(page.getByLabel('이름').first()).toHaveValue('유비');
    await expect(page.getByLabel('병사').first()).toHaveValue('4321');
    await notice.locator('summary').click();
    const battleButton = page.getByRole('button', { name: '전투', exact: true });
    await battleButton.hover();
    expect(await battleButton.evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer');
    await page.getByLabel('시드').fill('playwright-fixed-seed');
    await battleButton.click();

    await expect(page.getByText('전투를 진행 중입니다.')).toHaveCount(0);
    expect(await readBrowserWorkerResult(page, 0)).toEqual(fixture.serverResults[0]);
    for (const [parityId, html] of [
        ['battle-log', fixture.serverResults[0]?.lastWarLog?.generalBattleResultLog ?? ''],
        ['battle-detail-log', fixture.serverResults[0]?.lastWarLog?.generalBattleDetailLog ?? ''],
    ] as const) {
        const browserNormalizedHtml = await page.evaluate((rawHtml) => {
            const element = document.createElement('div');
            element.innerHTML = rawHtml;
            return element.innerHTML;
        }, html);
        expect(await page.locator(`[data-parity-id="${parityId}"]`).innerHTML()).toBe(browserNormalizedHtml);
    }
    expect(fixture.requests).not.toContain('battle.simulate');
    expect(fixture.requests).not.toContain('battle.getSimulation');
    expect(fixture.preparedPayloads[0]).toMatchObject({
        attackerGeneral: { special: 'che_event_신산' },
    });

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '모두 저장' }).click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const exportedBattle = JSON.parse(await readFile(downloadPath!, 'utf8')) as {
        objType: string;
        data: { attackerGeneral: { special?: string | null } };
    };
    expect(exportedBattle).toMatchObject({ objType: 'battle' });
    expect(exportedBattle).not.toHaveProperty('data.attackerGeneral.special');

    await page.locator('.header-actions input[type="file"]').setInputFiles(downloadPath!);

    await battleButton.click();
    await expect.poll(() => fixture.preparedPayloads.length).toBe(2);
    expect(await readBrowserWorkerResult(page, 1)).toEqual(fixture.serverResults[1]);
    expect(fixture.preparedPayloads[1]).toMatchObject({
        attackerGeneral: { special: 'che_event_신산' },
    });

    if (artifactRoot) {
        await page.screenshot({
            path: resolve(artifactRoot, 'battle-simulator-core-desktop.png'),
            fullPage: true,
            animations: 'disabled',
        });
    }
});

test('keeps simulation available without a game general and preserves input after an API error', async ({ page }) => {
    const fixture: Fixture = {
        hasGeneral: false,
        failNextSimulation: true,
        requests: [],
        preparedPayloads: [],
        serverResults: [],
    };
    await installApi(page, fixture);
    await page.setViewportSize({ width: 500, height: 900 });
    await gotoSimulator(page);

    await expect(page).toHaveURL(/battle-simulator/);
    await page.getByLabel('시뮬레이터 데이터 안내').locator('summary').click();
    await expect(page.getByRole('button', { name: '내 장수를 출병자로' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '서버에서 가져오기' }).first()).toBeDisabled();

    await page.getByLabel('시드').fill('keep-this-seed');
    await page.getByRole('button', { name: '전투', exact: true }).click();
    await expect(page.getByText('시뮬레이터 입력 오류')).toBeVisible();
    await expect(page.getByLabel('시드')).toHaveValue('keep-this-seed');

    fixture.prepareDelayMs = 1_500;
    await page.getByRole('button', { name: '전투', exact: true }).click();
    const progressToast = page.getByTestId('game-toast').filter({ hasText: '전투를 진행 중입니다.' });
    await expect(progressToast).toBeVisible();
    const progressToastRect = await progressToast.boundingBox();
    expect(progressToastRect?.x).toBeGreaterThanOrEqual(0);
    expect((progressToastRect?.x ?? 0) + (progressToastRect?.width ?? 0)).toBeLessThanOrEqual(500);
    if (artifactRoot) {
        await page.screenshot({
            path: resolve(artifactRoot, 'battle-simulator-progress-mobile.png'),
            fullPage: true,
            animations: 'disabled',
        });
    }
    await expect(progressToast).toHaveCount(0);
    await expect(page.getByText('시뮬레이터 입력 오류')).toHaveCount(0);
    expect(await readBrowserWorkerResult(page, 0)).toEqual(fixture.serverResults[0]);

    const notice = page.getByLabel('시뮬레이터 데이터 안내');
    expect(await notice.evaluate((element) => getComputedStyle(element).position)).toBe('absolute');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    if (artifactRoot) {
        await page.screenshot({
            path: resolve(artifactRoot, 'battle-simulator-core-mobile.png'),
            fullPage: true,
            animations: 'disabled',
        });
    }
});

test('runs 1000 battles in the Chromium worker and matches the Node processor exactly', async ({ page }) => {
    test.setTimeout(60_000);
    const fixture: Fixture = {
        hasGeneral: false,
        prepareDelayMs: 500,
        requests: [],
        preparedPayloads: [],
        serverResults: [],
    };
    await installApi(page, fixture);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoSimulator(page);

    await page.getByLabel('반복 횟수').selectOption('1000');
    await page.getByLabel('시드').fill('');
    const worldSettings = page.locator('[data-parity-id="world-settings"]');
    const worldSettingsTop = (await worldSettings.boundingBox())?.y;
    await page.getByRole('button', { name: '전투', exact: true }).click();

    const progressToast = page.getByTestId('game-toast').filter({ hasText: '전투를 진행 중입니다.' });
    await expect(progressToast).toBeVisible();
    expect(await page.locator('.game-toast-viewport').evaluate((element) => getComputedStyle(element).position)).toBe(
        'fixed'
    );
    expect((await worldSettings.boundingBox())?.y).toBe(worldSettingsTop);
    if (artifactRoot) {
        await page.screenshot({
            path: resolve(artifactRoot, 'battle-simulator-progress-desktop.png'),
            fullPage: true,
            animations: 'disabled',
        });
    }
    await expect(progressToast).toHaveCount(0, { timeout: 30_000 });

    expect(fixture.preparedPayloads).toHaveLength(1);
    expect(fixture.preparedPayloads[0]?.seeds).toHaveLength(1000);
    expect(new Set(fixture.preparedPayloads[0]?.seeds).size).toBe(1000);
    expect(await readBrowserWorkerResult(page, 0)).toEqual(fixture.serverResults[0]);
    const battleSummary = page.locator('[data-parity-id="battle-summary"]');
    await expect(battleSummary.locator('tr').filter({ hasText: '전투 횟수' }).locator('td')).toHaveText('1,000');
    await expect(battleSummary.locator('tr').filter({ hasText: '전투 일시' }).locator('td')).toHaveText(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u
    );
    expect(fixture.preparedPayloads[0]?.attackerGeneral.turntime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
    expect(fixture.requests).not.toContain('battle.simulate');
    expect(fixture.requests).not.toContain('battle.getSimulation');
    const workerUrls = await page.evaluate(() => {
        const testWindow = window as unknown as { __battleWorkerUrls?: string[] };
        return testWindow.__battleWorkerUrls ?? [];
    });
    expect(workerUrls.some((url) => url.includes('battleSimulator.worker'))).toBe(true);
});
