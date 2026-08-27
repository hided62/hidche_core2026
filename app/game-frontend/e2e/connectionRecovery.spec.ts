import { expect, test, type Page, type Route } from '@playwright/test';
import { gameProfile, gameTrpcRoute } from './gameTestPaths.js';

const response = (data: unknown) => ({ result: { data } });

const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const installRecoveryFixture = async (page: Page) => {
    let unavailable = true;
    let lobbyRequests = 0;
    await page.addInitScript(
        ({ token, profile }) => {
            window.localStorage.setItem('sammo-game-token', token);
            window.localStorage.setItem('sammo-game-profile', profile);
            window.addEventListener('sammo:game-server-reconnected', () => {
                const state = window as typeof window & { __gameServerReconnects?: number };
                state.__gameServerReconnects = (state.__gameServerReconnects ?? 0) + 1;
            });
        },
        { token: 'ga_recovery', profile: gameProfile }
    );
    await page.route(gameTrpcRoute, async (route) => {
        const operations = operationNames(route);
        if (operations.includes('lobby.info')) {
            lobbyRequests += 1;
            if (unavailable) {
                await route.fulfill({
                    status: 503,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'profile switch in progress' }),
                });
                return;
            }
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
                operations.map((operation) => {
                    if (operation === 'auth.status') return response({ userId: 'recovery-user' });
                    if (operation === 'lobby.info') return response({ myGeneral: null });
                    if (operation === 'join.getConfig') return response({});
                    return response(null);
                })
            ),
        });
    });

    return {
        recover: () => {
            unavailable = false;
        },
        lobbyRequests: () => lobbyRequests,
    };
};

for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile', width: 390, height: 844 },
]) {
    test(`keeps the current screen and reconnects after a transient profile switch on ${viewport.name}`, async ({
        page,
    }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const fixture = await installRecoveryFixture(page);
        await page.goto('select-general');

        const heading = page.locator('.page-title');
        await expect(heading).toContainText('장 수 선 택');
        const notice = page.getByTestId('game-server-connection-notice');
        await expect(notice).toBeVisible();
        await expect(notice).toContainText('화면을 유지한 채 자동으로 다시 연결합니다');
        await expect(notice).toHaveCSS('position', 'fixed');
        const noticeBox = await notice.boundingBox();
        expect(noticeBox).not.toBeNull();
        expect(noticeBox!.x).toBeGreaterThanOrEqual(0);
        expect(noticeBox!.x + noticeBox!.width).toBeLessThanOrEqual(viewport.width);
        const documentWidthDuringReconnect = await page.evaluate(() => document.documentElement.scrollWidth);
        await page.evaluate(() => {
            Object.assign(window, { __connectionRecoveryPageMarker: 'kept' });
        });

        fixture.recover();
        await page.evaluate(() => window.dispatchEvent(new Event('online')));

        await expect(notice).toHaveCount(0);
        await expect(heading).toContainText('장 수 선 택');
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(documentWidthDuringReconnect);
        expect(await page.evaluate(() => Reflect.get(window, '__connectionRecoveryPageMarker'))).toBe('kept');
        expect(await page.evaluate(() => Reflect.get(window, '__gameServerReconnects'))).toBe(1);
        expect(fixture.lobbyRequests()).toBeGreaterThanOrEqual(2);
        expect(await page.evaluate(() => window.localStorage.getItem('sammo-game-token'))).toBe('ga_recovery');
    });
}
