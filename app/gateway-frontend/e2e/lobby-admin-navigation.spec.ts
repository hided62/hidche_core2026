import { expect, test, type Page, type Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

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
                operation === 'admin.operations.list' ||
                operation === 'admin.releases.list'
            ) {
                return response([]);
            }
            if (operation === 'admin.releases.gatewayState') {
                return response({ id: 'gateway', updatedAt: '2026-08-01T00:00:00.000Z' });
            }
            if (operation === 'admin.users.getLocalAccountStatus') {
                return response({ enabled: true });
            }
            if (operation === 'admin.capabilities.list') {
                return response([]);
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

test('bootstrap superuser can navigate the administrator workspace from the lobby', async ({ page }, testInfo) => {
    await installGatewayFixture(page, ['superuser']);

    await page.goto('lobby');
    const adminLink = page.getByRole('link', { name: '관리자 페이지' });
    await expect(adminLink).toBeVisible();
    await adminLink.click();

    await expect(page).toHaveURL(/\/gateway\/admin$/);
    await expect(page.getByRole('heading', { name: '운영 개요' })).toBeVisible();
    const navigation = page.getByRole('navigation', { name: '관리자 메뉴' });
    await expect(navigation).toBeVisible();
    const userLink = navigation.getByRole('link', { name: '사용자 관리' });
    const baseColor = await userLink.evaluate((element) => getComputedStyle(element).color);
    await userLink.hover();
    await expect.poll(() => userLink.evaluate((element) => getComputedStyle(element).color)).not.toBe(baseColor);
    await page.screenshot({ path: testInfo.outputPath('admin-overview-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(navigation).toBeHidden();
    await page.getByRole('button', { name: '관리자 메뉴' }).click();
    await expect(navigation).toBeVisible();
    const geometry = await navigation.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, viewportWidth: window.innerWidth };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    await writeFile(testInfo.outputPath('admin-overview-mobile-geometry.json'), JSON.stringify(geometry));
    await page.screenshot({ path: testInfo.outputPath('admin-overview-mobile-menu.png'), fullPage: true });

    await navigation.getByRole('link', { name: '버전 업데이트' }).click();
    await expect(page).toHaveURL(/\/gateway\/admin\/releases$/);
    await expect(page.getByRole('heading', { name: '버전 업데이트' })).toBeVisible();
});

test('legacy server operations URL keeps query parameters and redirects to releases', async ({ page }) => {
    await installGatewayFixture(page, ['superuser']);

    await page.goto('admin/server-operations?operationId=legacy-operation');
    await expect(page).toHaveURL(/\/gateway\/admin\/releases\?operationId=legacy-operation$/);
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
