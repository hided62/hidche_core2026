import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

const artifactRoot = process.env.LEGACY_LOG_ARTIFACT_DIR ? resolve(process.env.LEGACY_LOG_ARTIFACT_DIR) : null;
const response = (data: unknown) => ({ result: { data } });
const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const history = [
    {
        id: 1,
        text: '<R><b>안전 강조</b></><img src=x onerror="globalThis.__legacyLogXss=1"><script>globalThis.__legacyLogXss=2</script>',
    },
    {
        id: 2,
        text:
            '<div class="small_war_log"><span class="me"><span class="name">정상 장수</span></span>' +
            '<span class="war_type war_type_attack">→</span><span class="ev_highlight">강조</span>' +
            '<span class="name" onclick="globalThis.__legacyLogXss=3">오염 이름</span></div>',
    },
];

const installFixture = async (page: Page) => {
    await page.addInitScript(() => {
        delete (globalThis as Record<string, unknown>).__legacyLogXss;
        localStorage.removeItem('sammo-session-token');
    });
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'me') return response(null);
            if (operation === 'lobby.profiles') {
                return response([
                    {
                        profileName: 'che:2',
                        profile: 'che',
                        scenario: '2',
                        status: 'RUNNING',
                        apiPort: 15003,
                        korName: '체',
                        color: '#ffffff',
                        runtime: {
                            apiRunning: true,
                            daemonRunning: true,
                            auctionRunning: true,
                            battleSimRunning: true,
                            tournamentRunning: true,
                        },
                    },
                ]);
            }
            throw new Error(`Unhandled gateway legacy log fixture operation: ${operation}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(results),
        });
    });
    await page.route('**/che/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'lobby.info') {
                return response({
                    year: 200,
                    month: 1,
                    userCnt: 1,
                    maxUserCnt: 100,
                    npcCnt: 0,
                    nationCnt: 1,
                    turnTerm: 10,
                    fictionMode: '가상',
                    starttime: '2026-07-31T00:00:00.000Z',
                    opentime: '2026-07-31T00:00:00.000Z',
                    turntime: '2026-07-31T00:10:00.000Z',
                    otherTextInfo: '',
                    isUnited: false,
                    selectionPoolEnabled: false,
                    npcPossessionEnabled: false,
                    myGeneral: null,
                });
            }
            if (operation === 'public.getMapLayout') return response({ mapName: 'che', cityList: [] });
            if (operation === 'public.getCachedMap') {
                return response({ year: 200, month: 1, cityList: [], nationList: [], history });
            }
            throw new Error(`Unhandled game legacy log fixture operation: ${operation}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(results),
        });
    });
};

for (const viewport of [
    { name: 'desktop', width: 1200, height: 900 },
    { name: 'mobile', width: 500, height: 900 },
] as const) {
    test(`renders only rebuilt public history markup on ${viewport.name}`, async ({ page }) => {
        await installFixture(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto('/gateway/');

        const lines = page.locator('.status-history > div');
        await expect(lines).toHaveCount(2);
        await expect(lines.nth(0).locator('b')).toHaveText('안전 강조');
        await expect(lines.nth(1).locator('.small_war_log .war_type_attack')).toHaveText('→');
        await expect(lines.nth(1).locator('.ev_highlight')).toHaveText('강조');
        await expect(lines.locator('script, img, svg, a, [onerror], [onclick], [style*="url"]')).toHaveCount(0);
        await expect(lines.nth(0)).toContainText('<img src=x onerror=');
        await expect(lines.nth(1)).toContainText('<span class="name" onclick=');
        expect(await page.evaluate(() => (globalThis as Record<string, unknown>).__legacyLogXss)).toBeUndefined();

        const geometry = await lines.evaluateAll((elements) =>
            elements.map((element) => {
                const rect = element.getBoundingClientRect();
                const colorSpan = element.querySelector<HTMLElement>('span[style]');
                const bold = element.querySelector<HTMLElement>('b');
                return {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    color: colorSpan ? getComputedStyle(colorSpan).color : null,
                    fontWeight: bold ? getComputedStyle(bold).fontWeight : null,
                };
            })
        );
        expect(geometry[0]?.width).toBeGreaterThan(0);
        expect(geometry[0]?.color).toBe('rgb(255, 0, 0)');
        expect(Number(geometry[0]?.fontWeight)).toBeGreaterThanOrEqual(600);

        const refresh = page.getByRole('button', { name: '현황 새로고침' });
        await refresh.focus();
        await expect(refresh).toBeFocused();
        await refresh.hover();

        if (artifactRoot) {
            await mkdir(artifactRoot, { recursive: true });
            const name = `legacy-log-gateway-${viewport.name}`;
            await writeFile(
                resolve(artifactRoot, `${name}.json`),
                `${JSON.stringify({ viewport, geometry }, null, 2)}\n`,
                'utf8'
            );
            await page.screenshot({ path: resolve(artifactRoot, `${name}.png`), fullPage: true });
        }
    });
}
