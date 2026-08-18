import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';
import { gamePath, gameProfile, gameTrpcRoute } from './gameTestPaths.js';

const response = (data: unknown) => ({ result: { data } });
const operationNames = (route: Route) =>
    decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(',');

const installArchive = async (page: Page, options: { battleAvailable?: boolean; abandoned?: boolean } = {}) => {
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_archive');
        localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    await page.route(gameTrpcRoute, async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') return response({ myGeneral: null });
            if (operation === 'archive.myPastPlays') {
                return response({
                    seasons: [
                        {
                            sourceProfile: 'che',
                            source: options.abandoned ? 'current' : 'legacy',
                            serverId: 'che_2024_01',
                            openedAt: '2024-01-31T00:00:00.000Z',
                            date: '2024-01-31T00:00:00.000Z',
                            season: options.abandoned ? null : 51,
                            scenario: 2,
                            scenarioName: '천하쟁패',
                            status: options.abandoned ? 'ABANDONED' : 'LEGACY',
                            cancellationId: options.abandoned ? '12345678-full-id' : null,
                            cancelledAt: options.abandoned ? '2024-02-01T00:00:00.000Z' : null,
                            dynastyId: options.abandoned ? null : 7,
                            generals: [
                                {
                                    generalNo: 17,
                                    name: '관우',
                                    lastYearMonth: 21403,
                                    nationId: 2,
                                    nationName: '촉',
                                    nationColor: '#800000',
                                    leadership: 91,
                                    strength: 98,
                                    intel: 77,
                                    experience: 23000,
                                    dedication: 1200,
                                    officerLevel: 12,
                                    officerLevelText: '황제',
                                    personal: '대담',
                                    special: '상재',
                                    special2: '신산',
                                    historyCount: 2,
                                },
                            ],
                        },
                    ],
                });
            }
            if (operation === 'archive.myPastPlayDetail') {
                return response({
                    sourceProfile: 'che',
                    source: 'legacy',
                    serverId: 'che_2024_01',
                    generalNo: 17,
                    dynastyPath: '/dynasty/7?source=legacy',
                    nation: { name: '촉', color: '#800000' },
                    general: {
                        id: 17,
                        name: '관우',
                        picture: null,
                        imageServer: 0,
                        npcState: 0,
                        officerLevel: 12,
                        officerLevelText: '황제',
                        generalType: '용장',
                        stats: { leadership: 91, strength: 98, intelligence: 77 },
                        gold: 12_000,
                        rice: 8_000,
                        crew: 7_000,
                        train: 100,
                        atmos: 100,
                        injury: 0,
                        experience: 23_000,
                        dedication: 1_200,
                        crewTypeId: 1,
                        crewTypeName: '보병',
                        traits: { personal: '대담', specialDomestic: '상재', specialWar: '신산' },
                        progression: {
                            experienceLevel: 12,
                            dedicationLevel: 8,
                            dedicationText: '황제',
                            statExperience: { leadership: 12, strength: 14, intelligence: 8 },
                            statUpgradeLimit: 30,
                            dex: [125_000, 250_000, 375_000, 500_000, 625_000],
                        },
                    },
                    masteryAvailable: true,
                    battle: {
                        available: options.battleAvailable ?? true,
                        warnum: 16,
                        wins: 10,
                        losses: 6,
                        strategies: 4,
                        killCrew: 12_000,
                        deathCrew: 8_000,
                        winRate: 62.5,
                        killRate: 75,
                        recentWar: '2024-01-30T03:00:00.000Z',
                    },
                    logs: {
                        generalHistory: {
                            available: true,
                            entries: [
                                { id: 2, text: '<C>●</>214년 3월: 촉에 임관' },
                                { id: 1, text: '<Y>●</>214년 1월: 성도에서 거병' },
                            ],
                        },
                        battleDetail: { available: false, entries: [] },
                        battleResult: {
                            available: true,
                            entries: [
                                {
                                    id: 2,
                                    text: '<S>◆</>214년 3월:<div class="small_war_log">관우 7000 ← 장비 0</div>',
                                },
                                { id: 1, text: '<S>◆</>214년 2월:관우 6500 → 여포 0' },
                            ],
                        },
                        generalAction: { available: false, entries: [] },
                    },
                });
            }
            return { error: { message: `unhandled ${operation}`, data: { code: 'BAD_REQUEST' } } };
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
};

test('지난 플레이 관직은 숫자 대신 저장된 Ref 표시명으로 나타난다', async ({ page }) => {
    await installArchive(page);
    await page.goto('past-plays');

    const generalRow = page.locator('tbody tr').filter({ hasText: '관우' });
    await expect(generalRow).toContainText('황제');
    await expect(generalRow).not.toContainText('che_');
});

test('보존되지 않은 과거 전투 집계는 0으로 꾸미지 않고 가용성 경계를 표시한다', async ({ page }) => {
    await installArchive(page, { battleAvailable: false });
    await page.goto('past-plays');
    await page.locator('.detail-toggle').click();

    await expect(page.locator('[data-general-battle-summary]')).toHaveText('전투 집계가 보존되지 않았습니다.');
    await expect(page.locator('[data-general-battle-summary]')).not.toContainText('승률');
});

test('취소 게임은 정식 기수 번호와 왕조 링크 없이 별도 기록으로 표시된다', async ({ page }, testInfo) => {
    await installArchive(page, { abandoned: true });
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('past-plays');

    const seasonCard = page.locator('.season-card');
    await expect(seasonCard.getByText('취소 게임', { exact: true })).toBeVisible();
    await expect(seasonCard.getByText('취소 ID 12345678')).toBeVisible();
    await expect(seasonCard).toContainText('천하쟁패');
    await expect(seasonCard).not.toContainText('51기');
    await expect(seasonCard.getByRole('link', { name: '이 기수 국가 정보' })).toHaveCount(0);
    const desktop = await seasonCard.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const heading = element.querySelector('.season-heading')!.getBoundingClientRect();
        return { x: rect.x, width: rect.width, headingHeight: heading.height };
    });
    expect(desktop).toMatchObject({ x: 100, width: 1000 });
    await page.screenshot({ path: testInfo.outputPath('abandoned-past-play-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await seasonCard.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            x: rect.x,
            width: rect.width,
            viewportWidth: document.documentElement.clientWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
        };
    });
    expect(mobile.x).toBeGreaterThanOrEqual(0);
    expect(mobile.x + mobile.width).toBeLessThanOrEqual(mobile.viewportWidth);
    expect(mobile.documentScrollWidth).toBeLessThanOrEqual(mobile.viewportWidth);
    await writeFile(
        testInfo.outputPath('abandoned-past-play-metrics.json'),
        JSON.stringify({ desktop, mobile }, null, 2)
    );
    await page.screenshot({ path: testInfo.outputPath('abandoned-past-play-mobile.png'), fullPage: true });
});

test('past plays is available without a current general and preserves desktop interaction geometry', async ({
    page,
}) => {
    await installArchive(page);
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('past-plays');

    const root = page.locator('.past-plays-page');
    await expect(root).toBeVisible();
    await expect(page.getByRole('heading', { name: '내 지난 플레이 보기' })).toBeVisible();
    await expect(page.getByText('천하쟁패 · 51기')).toBeVisible();
    await expect(page.getByText('이전 서버 기록')).toBeVisible();
    await expect(page.getByText('che', { exact: true })).toBeVisible();
    await expect(page.getByText(/2024.*개장/)).toBeVisible();
    await expect(page.locator('.general-name')).toHaveText('관우');
    await expect(page.locator('tbody tr').filter({ hasText: '관우' })).toContainText('황제');
    const detailToggle = page.locator('.detail-toggle');
    await expect(detailToggle).toHaveText('상세 보기');
    await detailToggle.hover();
    const beforePress = await detailToggle.boundingBox();
    await page.mouse.down();
    expect(await detailToggle.evaluate((element) => getComputedStyle(element).transform)).not.toBe('none');
    await page.mouse.up();
    expect((await detailToggle.boundingBox())?.y).toBeCloseTo(beforePress?.y ?? 0, 0);
    await expect(page.getByText('214년 3월: 촉에 임관')).toBeVisible();
    await expect(detailToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.archive-general-card')).toHaveAttribute('data-general-basic-card', '');
    await expect(page.locator('.archive-general-card [role="progressbar"]')).toHaveCount(14);
    await expect(page.locator('[data-general-battle-summary]')).toContainText('승률62.5%');
    await expect(page.locator('[data-general-battle-summary]')).toContainText('살상률75.0%');
    await expect(page.locator('[data-log-type="battleDetail"]')).toContainText(
        '이 기수에는 전투 기록이 보존되지 않았습니다.'
    );
    await expect(page.locator('[data-log-type="battleResult"]')).toContainText('214년 3월:관우 7000 ← 장비 0');
    await expect(page.locator('[data-log-type="battleResult"]')).not.toContainText('<div');
    await expect(page.locator('[data-log-type="generalAction"]')).toContainText(
        '이 기수에는 개인 기록이 보존되지 않았습니다.'
    );
    await expect(page.locator('[data-log-type="generalHistory"] C')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '이 기수 국가 정보' })).toHaveAttribute(
        'href',
        `${gamePath('/dynasty/7')}?source=legacy`
    );

    const geometry = await root.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const titleRect = element.querySelector('.title-row')!.getBoundingClientRect();
        const tableRect = element.querySelector('table')!.getBoundingClientRect();
        const detailGrid = element.querySelector('.detail-grid')!;
        const card = element.querySelector('[data-general-basic-card]')!.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            x: rect.x,
            width: rect.width,
            minHeight: rect.height,
            title: { x: titleRect.x, y: titleRect.y, width: titleRect.width },
            tableWidth: tableRect.width,
            detailColumns: getComputedStyle(detailGrid).gridTemplateColumns,
            cardWidth: card.width,
            color: style.color,
            backgroundColor: style.backgroundColor,
        };
    });
    expect(geometry).toMatchObject({
        x: 100,
        width: 1000,
        title: { x: 100, y: 0, width: 1000 },
        tableWidth: 1000,
        cardWidth: 497,
        color: 'rgb(238, 238, 238)',
        backgroundColor: 'rgb(48, 32, 22)',
    });

    const refresh = page.getByRole('button', { name: '새로고침' });
    await refresh.hover();
    await expect(refresh).toHaveCSS('color', 'rgb(135, 206, 235)');
    await refresh.focus();
    expect(await refresh.evaluate((element) => document.activeElement === element)).toBe(true);

    const artifactRoot = process.env.PAST_PLAYS_ARTIFACT_DIR;
    if (artifactRoot) {
        const output = resolve(artifactRoot);
        await mkdir(output, { recursive: true });
        await writeFile(resolve(output, 'desktop-computed-dom.json'), `${JSON.stringify(geometry, null, 2)}\n`);
        await page.screenshot({ path: resolve(output, 'desktop.png'), fullPage: true });
    }
});

test('past plays keeps the legacy-width table scrollable on a mobile viewport', async ({ page }) => {
    await installArchive(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('past-plays');

    await page.locator('.detail-toggle').click();
    await expect(page.locator('.archive-general-card')).toBeVisible();

    const scroll = page.locator('.table-scroll');
    const metrics = await scroll.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflowX: getComputedStyle(element).overflowX,
    }));
    // The shared legacy shell keeps its historical 500 px minimum canvas.
    expect(metrics).toEqual({ clientWidth: 500, scrollWidth: 940, overflowX: 'auto' });
    await expect(page.locator('.title-row')).toHaveCSS('flex-direction', 'column');
    await expect(page.locator('.detail-grid')).toHaveCSS('grid-template-columns', '498px');
    const detailMetrics = await page.locator('.detail-shell').evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        scrollWidth: element.scrollWidth,
        recordBottom: element.querySelector('[data-general-record-panels]')!.getBoundingClientRect().bottom,
        shellBottom: element.getBoundingClientRect().bottom,
    }));
    expect(detailMetrics.width).toBe(498);
    expect(detailMetrics.scrollWidth).toBe(498);
    expect(detailMetrics.recordBottom).toBeLessThanOrEqual(detailMetrics.shellBottom);
});
