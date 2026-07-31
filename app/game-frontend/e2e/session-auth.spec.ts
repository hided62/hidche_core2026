import { expect, test, type Page, type Route } from '@playwright/test';
import { gameBasePath, gameProfile, gameTrpcRoute } from './gameTestPaths.js';

const response = (data: unknown) => ({ result: { data } });

const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const publicResponse = (operation: string): unknown => {
    if (operation === 'public.getMapLayout') {
        return response({ mapName: 'che', cityList: [] });
    }
    if (operation === 'public.getCachedMap') {
        return response({ year: 180, month: 1, cityList: [], nationList: [], history: [] });
    }
    if (operation === 'public.getWorldTrend') {
        return response({ year: 180, month: 1, turnTerm: 5 });
    }
    if (operation === 'public.getNationList' || operation === 'public.getGeneralList') {
        return response([]);
    }
    throw new Error(`Unhandled public tRPC operation: ${operation}`);
};

const seedGameStorage = async (page: Page, gameToken: string): Promise<void> => {
    await page.addInitScript(
        ({ token, profile }) => {
            window.localStorage.setItem('sammo-game-token', token);
            window.localStorage.setItem('sammo-game-profile', profile);
        },
        { token: gameToken, profile: gameProfile }
    );
};

test('removes an invalid ga_ token and redirects an authenticated route to public', async ({ page }) => {
    await seedGameStorage(page, 'ga_invalid');
    let gatewayRequests = 0;
    await page.route('http://127.0.0.1:15120/api/trpc/**', async (route) => {
        gatewayRequests += 1;
        await route.abort();
    });
    await page.route(gameTrpcRoute, async (route) => {
        const operations = operationNames(route);
        if (operations.includes('auth.status')) {
            expect(route.request().headers().authorization).toBe('Bearer ga_invalid');
            await route.fulfill({
                status: 401,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'invalid token' }),
            });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(operations.map(publicResponse)),
        });
    });

    await page.goto('select-general');
    await expect(page).toHaveURL(new RegExp(`${gameBasePath}/public$`));
    await expect(page.getByRole('heading', { name: '공개 동향' })).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem('sammo-game-token'))).toBeNull();
    expect(gatewayRequests).toBe(0);
});

test('keeps a valid ga_ token when only lobby.info is unavailable', async ({ page }) => {
    await seedGameStorage(page, 'ga_valid');
    page.on('dialog', (dialog) => dialog.accept());
    let gatewayRequests = 0;
    let statusRequests = 0;
    let lobbyRequests = 0;
    await page.route('http://127.0.0.1:15120/api/trpc/**', async (route) => {
        gatewayRequests += 1;
        await route.abort();
    });
    await page.route(gameTrpcRoute, async (route) => {
        const operations = operationNames(route);
        if (operations.includes('auth.status')) {
            statusRequests += 1;
            expect(route.request().headers().authorization).toBe('Bearer ga_valid');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([response({ userId: 'valid-user' })]),
            });
            return;
        }
        if (operations.includes('lobby.info')) {
            lobbyRequests += 1;
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'lobby unavailable' }),
            });
            return;
        }
        await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'fixture page data unavailable' }),
        });
    });

    await page.goto('select-general');
    await expect(page).toHaveURL(new RegExp(`${gameBasePath}/select-general$`));
    await expect(page.locator('.page-title')).toContainText('장 수 선 택');
    expect(await page.evaluate(() => window.localStorage.getItem('sammo-game-token'))).toBe('ga_valid');
    expect(statusRequests).toBe(1);
    expect(lobbyRequests).toBe(1);
    expect(gatewayRequests).toBe(0);
});
