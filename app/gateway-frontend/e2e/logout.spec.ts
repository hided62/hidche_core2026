import { expect, test, type Page, type Route } from '@playwright/test';

const response = (data: unknown) => ({ result: { data } });
const errorResponse = (path: string, message: string) => ({
    error: {
        message,
        code: -32603,
        data: {
            code: 'INTERNAL_SERVER_ERROR',
            httpStatus: 500,
            path,
        },
    },
});

const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const installLobbyFixture = async (page: Page, options: { failLogout?: boolean } = {}) => {
    let loggedOut = false;
    let logoutBody = '';
    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-session-token', 'playwright-session');
        window.localStorage.setItem('sammo-game-token', 'playwright-game-session');
        window.localStorage.setItem('sammo-game-profile', 'che:default');
    });
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'me') {
                return response(
                    loggedOut
                        ? null
                        : {
                              id: 'user-1',
                              username: 'tester',
                              displayName: '테스터',
                              roles: [],
                              createdAt: '2026-07-26T00:00:00.000Z',
                          }
                );
            }
            if (operation === 'lobby.notice') {
                return response('');
            }
            if (operation === 'lobby.profiles') {
                return response([]);
            }
            if (operation === 'auth.logout') {
                logoutBody = route.request().postData() ?? '';
                if (options.failLogout) {
                    return errorResponse(operation, '로그아웃 서버가 응답하지 않습니다.');
                }
                loggedOut = true;
                return response({ ok: true });
            }
            throw new Error(`Unhandled tRPC operation: ${operation}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(results),
        });
    });
    return {
        logoutBody: () => logoutBody,
    };
};

test('logs out through the server before clearing all browser session state', async ({ page }) => {
    const fixture = await installLobbyFixture(page);
    await page.goto('lobby');

    const logout = page.locator('#btn_logout');
    await expect(logout).toBeVisible();
    const before = await logout.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            width: rect.width,
            height: rect.height,
            backgroundColor: style.backgroundColor,
            border: style.border,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
        };
    });
    expect(before).toMatchObject({
        width: 200,
        height: 48,
        backgroundColor: 'rgb(48, 48, 48)',
        border: '0px none rgb(255, 255, 255)',
        fontSize: '16px',
        lineHeight: '24px',
    });

    await logout.hover();
    await logout.click();

    await expect(page).toHaveURL(/\/gateway\/$/);
    expect(fixture.logoutBody()).toContain('playwright-session');
    await expect
        .poll(() =>
            page.evaluate(() => ({
                session: window.localStorage.getItem('sammo-session-token'),
                game: window.localStorage.getItem('sammo-game-token'),
                profile: window.localStorage.getItem('sammo-game-profile'),
            }))
        )
        .toEqual({ session: null, game: null, profile: null });
});

test('keeps the lobby and every token when server logout fails', async ({ page }) => {
    await installLobbyFixture(page, { failLogout: true });
    await page.goto('lobby');

    await page.locator('#btn_logout').click();

    await expect(page).toHaveURL(/\/gateway\/lobby$/);
    await expect(page.getByTestId('action-toast')).toContainText('로그아웃 서버가 응답하지 않습니다.');
    await expect
        .poll(() =>
            page.evaluate(() => ({
                session: window.localStorage.getItem('sammo-session-token'),
                game: window.localStorage.getItem('sammo-game-token'),
                profile: window.localStorage.getItem('sammo-game-profile'),
            }))
        )
        .toEqual({
            session: 'playwright-session',
            game: 'playwright-game-session',
            profile: 'che:default',
        });
});
