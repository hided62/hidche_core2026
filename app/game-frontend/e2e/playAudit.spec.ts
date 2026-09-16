import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { gamePath, gameProfile, gameTrpcRoute } from './gameTestPaths.js';

const world = {
    year: 190,
    month: 7,
    startYear: 190,
    serverId: 'audit-fixture',
    tick: '100',
    asOf: '2026-09-16T00:00:00.000Z',
};
const dex = { dex1: 100, dex2: 200, dex3: 300, dex4: 400, dex5: 500 };
const population = { count: 2, gold: 200, rice: 400, dex, averageGold: 100, averageRice: 200, averageDex: dex };
const general = {
    id: 1,
    name: '감사장수',
    userId: 'fixture',
    nationId: 2,
    cityId: 3,
    troopId: 0,
    npcState: 2,
    gold: 1200,
    rice: 2400,
    stats: { leadership: 80, strength: 70, intelligence: 90 },
    experience: 100,
    dedication: 200,
    officerLevel: 2,
    injury: 0,
    age: 30,
    crew: 5000,
    crewTypeId: 1,
    train: 80,
    atmos: 90,
    dex,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
};
const install = async (page: Page, denied = false) => {
    const requests: { operation: string; input: Record<string, unknown> }[] = [];
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_audit');
        localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    await page.route(gameTrpcRoute, async (route) => {
        const url = new URL(route.request().url());
        const inputs = JSON.parse(url.searchParams.get('input') ?? route.request().postData() ?? '{}');
        const results = decodeURIComponent(url.pathname.split('/trpc/')[1] ?? '')
            .split(',')
            .map((operation, index) => {
                const input = inputs[index] ?? {};
                requests.push({ operation, input });
                const result = (data: unknown) => ({ result: { data } });
                switch (operation) {
                    case 'auth.status':
                        return result({ ok: true });
                    case 'lobby.info':
                        return result({ myGeneral: null });
                    case 'playAudit.capabilities':
                        return denied
                            ? {
                                  error: {
                                      message: '이 프로필의 플레이 감사 권한이 필요합니다.',
                                      code: -32003,
                                      data: { code: 'FORBIDDEN', httpStatus: 403 },
                                  },
                              }
                            : result({ profileName: gameProfile, read: true, accounts: false });
                    case 'playAudit.coverage':
                        return result({ ...world, status: 'COLLECTED', samples: [], nextCursor: null });
                    case 'playAudit.nations':
                        return result({
                            ...world,
                            collected: true,
                            items: [{ id: 2, name: '촉', color: '#ff0000' }],
                            nextCursor: null,
                        });
                    case 'playAudit.nationSeries':
                        return result({
                            ...world,
                            nextCursor: null,
                            items: [
                                {
                                    year: 190,
                                    month: 1,
                                    periodMonths: 6,
                                    complete: true,
                                    from: { year: 190, month: 1 },
                                    to: { year: 190, month: 6 },
                                    stockAsOf: { year: 190, month: 6 },
                                    stock: {
                                        id: 2,
                                        name: '촉',
                                        color: '#ff0000',
                                        gold: 600,
                                        rice: 1200,
                                        tech: 100,
                                        appliedRate: 20,
                                        populations: { human: population, npc: population, troopNpc: population },
                                    },
                                    flows: { incomeGold: 21, incomeRice: null, paidGold: 10, paidRice: 0 },
                                    months: [1, 2, 3, 4, 5, 6].map((month) => ({
                                        year: 190,
                                        month,
                                        collected: true,
                                        nationPresent: true,
                                        settlementsComplete: true,
                                    })),
                                },
                            ],
                        });
                    case 'playAudit.generals':
                        return result({
                            ...world,
                            collected: !input.at || (input.at as { month: number }).month !== 7,
                            sample: input.at ?? null,
                            nextCursor: input.cursor ? null : 1,
                            items:
                                input.at && (input.at as { month: number }).month === 7
                                    ? []
                                    : [
                                          {
                                              ...general,
                                              id: input.cursor ? 2 : 1,
                                              name: input.cursor ? '다음장수' : '감사장수',
                                          },
                                      ],
                        });
                    case 'playAudit.cities':
                        return result({
                            ...world,
                            collected: true,
                            sample: null,
                            nextCursor: null,
                            items: [
                                {
                                    id: 3,
                                    name: '성도',
                                    nationId: 2,
                                    level: 4,
                                    state: 0,
                                    population: 10000,
                                    populationMax: 20000,
                                    agriculture: 100,
                                    agricultureMax: 200,
                                    commerce: 100,
                                    commerceMax: 200,
                                    security: 100,
                                    securityMax: 200,
                                    wall: 100,
                                    wallMax: 200,
                                    defence: 100,
                                    defenceMax: 200,
                                    supplyState: 1,
                                    frontState: 0,
                                    trust: 80,
                                },
                            ],
                        });
                    default:
                        throw new Error(`Unexpected operation ${operation}`);
                }
            });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
    return requests;
};

const capture = async (page: Page, name: string) => {
    await page.evaluate(() => document.fonts.ready);
    const directory = resolve('/tmp/play-audit-browser', gameProfile.replace(':', '-'));
    await mkdir(directory, { recursive: true });
    const geometry = await page.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        width: document.documentElement.scrollWidth,
        nodes: [...document.querySelectorAll('.audit-page, .panel-card, select, input, button, table')].map((node) => {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return {
                tag: node.tagName,
                width: rect.width,
                height: rect.height,
                x: rect.x,
                y: rect.y,
                font: style.fontSize,
                background: style.backgroundColor,
            };
        }),
    }));
    expect(geometry.width).toBeLessThanOrEqual(geometry.viewport.width);
    await writeFile(resolve(directory, `${name}.json`), JSON.stringify(geometry, null, 2));
    await writeFile(resolve(directory, `${name}.html`), await page.content());
    await page.screenshot({ path: resolve(directory, `${name}.png`), fullPage: true });
};

test('profile audit without a general: chart controls, lazy reads, direct reload', async ({ page }) => {
    const requests = await install(page);
    await page.goto(gamePath('/play-audit?tab=nations&nation=2&fromYear=190&fromMonth=1&year=190&month=6'));
    await expect(page.getByRole('cell', { name: '600', exact: true })).toBeVisible();
    expect(requests.some((request) => ['playAudit.generals', 'playAudit.cities'].includes(request.operation))).toBe(
        false
    );
    const count = requests.length;
    await page.getByLabel('지표', { exact: true }).selectOption('incomeGold');
    await expect(page.getByRole('cell', { name: '21', exact: true })).toBeVisible();
    await page.getByLabel('지표', { exact: true }).selectOption('incomeRice');
    await expect(page.getByRole('cell', { name: '자료 없음', exact: true })).toBeVisible();
    expect(requests.length).toBe(count);
    await page.getByText('월별 표본 수집됨', { exact: true }).click();
    await expect(page.getByText('190년 1월: 수집됨')).toBeVisible();
    await capture(page, 'desktop-series');
    await page.reload();
    await expect(page.getByRole('cell', { name: '600', exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(gamePath('/play-audit'));
});

test('mobile city drilldown preserves month and includes foreign stationed generals', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const requests = await install(page);
    await page.goto(gamePath('/play-audit?tab=cities&nation=2&at=month&year=190&month=6'));
    await page.getByText('내정 보기', { exact: true }).click();
    await expect(page.getByText(/농업 100 \/ 200/)).toBeVisible();
    await capture(page, 'mobile-cities');
    await page.getByRole('button', { name: '모든 국가의 주둔 장수' }).click();
    await expect(page.getByRole('rowheader', { name: /감사장수/ })).toBeVisible();
    const input = requests.filter((request) => request.operation === 'playAudit.generals').at(-1)?.input;
    expect(input).toMatchObject({ cityId: 3, at: { year: 190, month: 6, kind: 'MONTH_END' } });
    expect(input).not.toHaveProperty('nationId');
    await page.getByText('상세 보기', { exact: true }).click();
    await expect(page.getByText(/통솔 80/)).toBeVisible();
    await capture(page, 'mobile-generals');
    await page.getByRole('button', { name: '다음 50개 불러오기' }).click();
    await expect(page.getByRole('rowheader', { name: /다음장수/ })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('rowheader', { name: /성도/ })).toBeVisible();
    await page.goto(gamePath('/play-audit?tab=generals&at=month&year=190&month=7'));
    await expect(page.getByText('선택한 시점의 표본이 없습니다.')).toBeVisible();
});

test('denied capability does not request game audit data', async ({ page }) => {
    const requests = await install(page, true);
    await page.goto(gamePath('/play-audit'));
    await expect(page.getByRole('alert')).toContainText('플레이 감사 권한');
    expect(
        requests.filter((request) => request.operation.startsWith('playAudit.')).map((request) => request.operation)
    ).toEqual(['playAudit.capabilities']);
    await expect(page.getByLabel('조회 대상')).toHaveCount(0);
});

test('back navigation during a slow read keeps the newer city view', async ({ page }) => {
    await install(page);
    let release = () => {};
    let markStarted = () => {};
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    const started = new Promise<void>((resolve) => {
        markStarted = resolve;
    });
    await page.route(gameTrpcRoute, async (route) => {
        if (route.request().url().includes('playAudit.generals')) {
            markStarted();
            await held;
        }
        await route.fallback();
    });
    await page.goto(gamePath('/play-audit?tab=cities'));
    await page.getByRole('button', { name: '모든 국가의 주둔 장수' }).click();
    await started;
    await expect(page.getByRole('button', { name: '조회', exact: true })).toBeDisabled();
    await page.goBack();
    await expect(page.getByRole('rowheader', { name: /성도/ })).toBeVisible();
    const response = page.waitForResponse((response) => response.url().includes('playAudit.generals'));
    release();
    await response;
    await expect(page.getByRole('rowheader', { name: /성도/ })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: /감사장수/ })).toHaveCount(0);
    await page.getByRole('button', { name: '조회', exact: true }).focus();
    await expect(page.getByRole('button', { name: '조회', exact: true })).toBeFocused();
});
