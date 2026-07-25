import { expect, test, type Page, type Route } from '@playwright/test';

const response = (data: unknown) => ({ result: { data } });

const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const installGatewayFixture = async (page: Page, roles: string[]) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-session-token', 'playwright-admin-session');
    });
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'me') {
                return response({
                    id: 'admin-user',
                    username: 'admin',
                    displayName: '관리자',
                    roles,
                    createdAt: '2026-07-25T00:00:00.000Z',
                });
            }
            if (operation === 'lobby.notice' || operation === 'admin.system.getNotice') {
                return response(operation === 'lobby.notice' ? '' : { notice: '' });
            }
            if (
                operation === 'lobby.profiles' ||
                operation === 'admin.profiles.list' ||
                operation === 'admin.profiles.listScenarios' ||
                operation === 'admin.operations.list'
            ) {
                return response([]);
            }
            if (operation === 'admin.users.getLocalAccountStatus') {
                return response({ enabled: true });
            }
            throw new Error(`Unhandled tRPC operation: ${operation}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(results),
        });
    });
};

test('bootstrap superuser can navigate from the lobby to server operations', async ({ page }) => {
    await installGatewayFixture(page, ['superuser']);

    await page.goto('lobby');
    const adminLink = page.getByRole('link', { name: '관리자 페이지' });
    await expect(adminLink).toBeVisible();
    await adminLink.click();

    await expect(page).toHaveURL(/\/gateway\/admin$/);
    await expect(page.getByRole('heading', { name: '관리자 콘솔' })).toBeVisible();
    await page.getByRole('link', { name: '서버 배포 · 시나리오 초기화' }).click();
    await expect(page).toHaveURL(/\/gateway\/admin\/server-operations$/);
});

test('scoped administrators see the same navigation while ordinary users do not', async ({ browser }) => {
    const scopedContext = await browser.newContext();
    const scopedPage = await scopedContext.newPage();
    await installGatewayFixture(scopedPage, ['admin.profiles.manage:hwe:2']);
    await scopedPage.goto('lobby');
    await expect(scopedPage.getByRole('link', { name: '관리자 페이지' })).toBeVisible();
    await scopedContext.close();

    const userContext = await browser.newContext();
    const userPage = await userContext.newPage();
    await installGatewayFixture(userPage, []);
    await userPage.goto('lobby');
    await expect(userPage.getByRole('link', { name: '관리자 페이지' })).toHaveCount(0);
    await userContext.close();
});
