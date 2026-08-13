import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';
import { gamePath, gameProfile, gameTrpcRoute } from './gameTestPaths.js';

const response = (data: unknown) => ({ result: { data } });
const operationNames = (route: Route) =>
    decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(',');

const installArchive = async (page: Page) => {
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
                            serverId: 'che_2024_01',
                            date: '2024-01-31T00:00:00.000Z',
                            season: 51,
                            scenario: 2,
                            scenarioName: '천하쟁패',
                            dynastyId: 7,
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
                    serverId: 'che_2024_01',
                    generalNo: 17,
                    name: '관우',
                    lastYearMonth: 21403,
                    history: ['<C>●</>214년 3월: 촉에 임관', '<Y>●</>214년 1월: 성도에서 거병'],
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
    await expect(page.locator('.general-name')).toHaveText('관우');
    await expect(page.locator('tbody tr').filter({ hasText: '관우' })).toContainText('황제');
    await expect(page.getByRole('link', { name: '이 기수 국가 정보' })).toHaveAttribute('href', gamePath('/dynasty/7'));
    const historyToggle = page.locator('.history-toggle');
    await expect(historyToggle).toHaveText('보기 (2)');
    await historyToggle.click();
    await expect(page.getByText('214년 3월: 촉에 임관')).toBeVisible();
    await expect(historyToggle).toHaveAttribute('aria-expanded', 'true');

    const geometry = await root.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const titleRect = element.querySelector('.title-row')!.getBoundingClientRect();
        const tableRect = element.querySelector('table')!.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            x: rect.x,
            width: rect.width,
            minHeight: rect.height,
            title: { x: titleRect.x, y: titleRect.y, width: titleRect.width },
            tableWidth: tableRect.width,
            color: style.color,
            backgroundColor: style.backgroundColor,
        };
    });
    expect(geometry).toMatchObject({
        x: 100,
        width: 1000,
        title: { x: 100, y: 0, width: 1000 },
        tableWidth: 1000,
        color: 'rgb(238, 238, 238)',
        backgroundColor: 'rgb(21, 21, 21)',
    });

    const refresh = page.getByRole('button', { name: '새로고침' });
    await refresh.hover();
    expect(await refresh.evaluate((element) => getComputedStyle(element).color)).toBe('rgb(135, 206, 235)');
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

    const scroll = page.locator('.table-scroll');
    const metrics = await scroll.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflowX: getComputedStyle(element).overflowX,
    }));
    // The shared legacy shell keeps its historical 500 px minimum canvas.
    expect(metrics).toEqual({ clientWidth: 500, scrollWidth: 940, overflowX: 'auto' });
    await expect(page.locator('.title-row')).toHaveCSS('flex-direction', 'column');
});
