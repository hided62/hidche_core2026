import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    nationTypes: [{ key: 'che_중립', name: '중립', info: '특별한 효과 없음' }],
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

const simulationResult = {
    result: true,
    reason: 'success',
    datetime: '205-08',
    avgWar: 5,
    phase: 13,
    killed: 1234,
    maxKilled: 1400,
    minKilled: 1100,
    dead: 432,
    maxDead: 500,
    minDead: 400,
    attackerRice: 321,
    defenderRice: 654,
    attackerSkills: { 필살: 2 },
    defendersSkills: [{ 회피: 1 }],
    lastWarLog: {
        generalHistoryLog: '',
        generalActionLog: '',
        generalBattleResultLog: '<span>유비가 모의전에서 승리했습니다.</span>',
        generalBattleDetailLog: '<span>필살 발동, 피해 1,234</span>',
        nationalHistoryLog: '',
        globalHistoryLog: '',
        globalActionLog: '',
    },
};

type Fixture = {
    hasGeneral: boolean;
    failNextSimulation?: boolean;
    queueFirst?: boolean;
    pollingCount: number;
    requests: string[];
    simulationPayloads: unknown[];
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
    await page.addInitScript((profile) => {
        window.localStorage.setItem('sammo-game-token', 'ga_battle_sim_playwright');
        window.localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    await page.route(gameTrpcRoute, async (route) => {
        const operations = operationNames(route);
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
            if (operation === 'battle.simulate') {
                const rawPayload =
                    requestBody[String(operationIndex)] ?? (operations.length === 1 ? requestBody : undefined);
                const payload =
                    rawPayload && typeof rawPayload === 'object'
                        ? (rawPayload as {
                              json?: unknown;
                              input?: { json?: unknown };
                          })
                        : undefined;
                fixture.simulationPayloads.push(payload?.json ?? payload?.input?.json ?? rawPayload);
                if (fixture.failNextSimulation) {
                    fixture.failNextSimulation = false;
                    return errorResponse(operation, '시뮬레이터 입력 오류');
                }
                if (fixture.queueFirst) {
                    return response({ status: 'queued', jobId: 'job-playwright' });
                }
                return response({ status: 'completed', jobId: 'job-playwright', payload: simulationResult });
            }
            if (operation === 'battle.getSimulation') {
                fixture.pollingCount += 1;
                if (fixture.pollingCount === 1) {
                    return response({ status: 'queued', jobId: 'job-playwright' });
                }
                return response({
                    status: 'completed',
                    jobId: 'job-playwright',
                    payload: simulationResult,
                });
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

const gotoSimulator = async (page: Page) => {
    await page.goto('battle-simulator');
    await expect(page.getByRole('heading', { name: '전투 시뮬레이터' })).toBeVisible();
    await expect(page.getByLabel('시뮬레이터 데이터 안내')).toBeVisible();
    await expect(page.getByText('출병자 설정')).toBeVisible();
};

test('operates independent/game presets, imports my general, and renders battle logs', async ({ page }) => {
    const fixture: Fixture = {
        hasGeneral: true,
        queueFirst: true,
        pollingCount: 0,
        requests: [],
        simulationPayloads: [],
    };
    await installApi(page, fixture);
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoSimulator(page);

    const notice = page.getByLabel('시뮬레이터 데이터 안내');
    const noticeRect = await notice.boundingBox();
    expect(noticeRect?.width).toBeGreaterThan(900);
    expect(await notice.evaluate((element) => getComputedStyle(element).display)).toBe('flex');

    await page.getByRole('button', { name: '독립 기본값' }).click();
    await expect(page.getByLabel('연도', { exact: true })).toHaveValue('190');
    await expect(page.getByLabel('월')).toHaveValue('1');

    await page.getByRole('button', { name: '현재 게임 환경 적용' }).click();
    await expect(page.getByLabel('연도', { exact: true })).toHaveValue('205');
    await expect(page.getByLabel('월')).toHaveValue('8');

    await page.getByRole('button', { name: '내 장수를 출병자로' }).click();
    await expect(page.getByLabel('이름').first()).toHaveValue('유비');
    await expect(page.getByLabel('병사').first()).toHaveValue('4321');
    const attackerDomesticTrait = page.getByLabel('내정특기').first();
    await attackerDomesticTrait.selectOption('che_event_신산');
    await expect(attackerDomesticTrait).toHaveValue('che_event_신산');

    const battleButton = page.getByRole('button', { name: '전투', exact: true });
    await battleButton.hover();
    expect(await battleButton.evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer');
    await page.getByLabel('시드').fill('playwright-fixed-seed');
    await battleButton.click();

    await expect(page.getByText('유비가 모의전에서 승리했습니다.')).toBeVisible();
    await expect(page.getByText('5', { exact: true })).toBeVisible();
    expect(fixture.pollingCount).toBe(2);
    expect(fixture.requests).toContain('battle.getSimulation');
    expect(fixture.simulationPayloads[0]).toMatchObject({
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
    expect(exportedBattle).toMatchObject({
        objType: 'battle',
        data: { attackerGeneral: { special: 'che_event_신산' } },
    });

    await attackerDomesticTrait.selectOption({ label: '-' });
    await expect(attackerDomesticTrait).toHaveValue('-');
    await page.locator('.header-actions input[type="file"]').setInputFiles(downloadPath!);
    await expect(attackerDomesticTrait).toHaveValue('che_event_신산');

    await battleButton.click();
    await expect.poll(() => fixture.simulationPayloads.length).toBe(2);
    expect(fixture.simulationPayloads[1]).toMatchObject({
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
        pollingCount: 0,
        requests: [],
        simulationPayloads: [],
    };
    await installApi(page, fixture);
    await page.setViewportSize({ width: 500, height: 900 });
    await gotoSimulator(page);

    await expect(page).toHaveURL(/battle-simulator/);
    await expect(page.getByRole('button', { name: '내 장수를 출병자로' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '서버에서 가져오기' }).first()).toBeDisabled();

    await page.getByLabel('시드').fill('keep-this-seed');
    await page.getByRole('button', { name: '전투', exact: true }).click();
    await expect(page.getByText('시뮬레이터 입력 오류')).toBeVisible();
    await expect(page.getByLabel('시드')).toHaveValue('keep-this-seed');

    await page.getByRole('button', { name: '전투', exact: true }).click();
    await expect(page.getByText('유비가 모의전에서 승리했습니다.')).toBeVisible();
    await expect(page.getByText('시뮬레이터 입력 오류')).toHaveCount(0);

    const notice = page.getByLabel('시뮬레이터 데이터 안내');
    expect(await notice.evaluate((element) => getComputedStyle(element).flexDirection)).toBe('column');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    if (artifactRoot) {
        await page.screenshot({
            path: resolve(artifactRoot, 'battle-simulator-core-mobile.png'),
            fullPage: true,
            animations: 'disabled',
        });
    }
});
