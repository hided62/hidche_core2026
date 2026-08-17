import { expect, test, type Page, type Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const response = (data: unknown) => ({ result: { data } });

const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const installGatewayFixture = async (page: Page, roles: string[]) => {
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-session-token', 'playwright-admin-session');
    });
    await page.route('**/gateway/api/trpc/**', async (route) => {
        requests.push({
            method: route.request().method(),
            url: route.request().url(),
            body: route.request().postDataJSON(),
        });
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
                operation === 'admin.profiles.listScenarios' ||
                operation === 'admin.operations.list' ||
                operation === 'admin.releases.list'
            ) {
                return response([]);
            }
            if (operation === 'admin.profiles.list') {
                return response(
                    roles.some((role) => role.includes(':hwe:2'))
                        ? [
                              {
                                  profileName: 'hwe:2',
                                  profile: 'hwe',
                                  instanceKey: '2',
                                  currentScenario: '1010',
                                  scenario: '1010',
                                  status: 'RUNNING',
                                  buildStatus: 'SUCCEEDED',
                                  meta: { korName: '환상서버' },
                                  runtime: {},
                                  runtimeActions: [],
                              },
                          ]
                        : []
                );
            }
            if (operation === 'admin.profiles.listNavigation') {
                return response(
                    roles.some((role) => role === 'superuser' || role.includes(':hwe:2'))
                        ? [
                              {
                                  profileName: 'hwe:2',
                                  profile: 'hwe',
                                  instanceKey: '2',
                                  currentScenario: '1010',
                                  meta: { korName: '환상서버' },
                              },
                          ]
                        : []
                );
            }
            if (operation === 'admin.releases.gatewayState') {
                return response({ id: 'gateway', updatedAt: '2026-08-01T00:00:00.000Z' });
            }
            if (operation === 'admin.users.getLocalAccountStatus') {
                return response({ enabled: true });
            }
            if (operation === 'admin.capabilities.list') {
                return response(
                    roles.includes('superuser')
                        ? [
                              { permission: 'admin.users.manage', scope: 'GLOBAL', scopes: ['*'] },
                              { permission: 'admin.profiles.runtime', scope: 'PROFILE', scopes: ['*'] },
                              { permission: 'admin.profiles.settings', scope: 'PROFILE', scopes: ['*'] },
                              { permission: 'admin.profiles.deploy', scope: 'PROFILE', scopes: ['*'] },
                              { permission: 'admin.scenarios.reset', scope: 'PROFILE', scopes: ['*'] },
                              { permission: 'admin.releases.manage', scope: 'GLOBAL', scopes: ['*'] },
                              { permission: 'admin.notice.manage', scope: 'GLOBAL', scopes: ['*'] },
                              { permission: 'admin.audit.read', scope: 'GLOBAL', scopes: ['*'] },
                          ]
                        : [
                              {
                                  permission: roles[0]?.split(':')[0],
                                  scope: 'PROFILE',
                                  scopes: ['hwe:2'],
                              },
                          ]
                );
            }
            throw new Error(`Unhandled tRPC operation: ${operation}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
                new URL(route.request().url()).searchParams.get('batch') === '1' ? results : results[0]
            ),
        });
    });
    return requests;
};

test('bootstrap superuser can navigate the administrator workspace from the lobby', async ({ page }, testInfo) => {
    const requests = await installGatewayFixture(page, ['superuser']);

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

    await navigation.getByRole('link', { name: 'Gateway 릴리스' }).click();
    await expect(page).toHaveURL(/\/gateway\/admin\/releases$/);
    await expect(page.getByRole('heading', { name: 'Gateway 릴리스', level: 1 })).toBeVisible();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(({ method }) => method === 'POST')).toBe(true);
    expect(requests.every(({ url }) => !new URL(url).searchParams.has('input'))).toBe(true);
    expect(requests.some(({ body }) => JSON.stringify(body).includes('"limit":30'))).toBe(true);
});

test('desktop administrator sidebar follows the navbar away and then sticks to the viewport top', async ({
    page,
}, testInfo) => {
    await page.setViewportSize({ width: 1200, height: 500 });
    await installGatewayFixture(page, ['superuser']);
    await page.goto('admin');

    const sidebar = page.locator('#admin-navigation');
    await expect(sidebar).toBeVisible();
    const measurements: Array<{
        scrollY: number;
        top: number;
        bottom: number;
        height: number;
        viewportHeight: number;
        position: string;
        backgroundColor: string;
    }> = [];

    for (const scrollY of [0, 20, 55, 56, 120]) {
        await page.evaluate((top) => window.scrollTo(0, top), scrollY);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY);

        const geometry = await sidebar.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                top: rect.top,
                bottom: rect.bottom,
                height: rect.height,
                viewportHeight: window.innerHeight,
                position: style.position,
                backgroundColor: style.backgroundColor,
            };
        });
        expect(geometry.top).toBeCloseTo(Math.max(0, 56 - scrollY), 0);
        expect(geometry.position).toBe('sticky');
        expect(geometry.backgroundColor).toBe('rgb(17, 17, 19)');
        measurements.push({ scrollY, ...geometry });

        if (scrollY >= 56) {
            expect(geometry.bottom).toBeCloseTo(geometry.viewportHeight, 0);
        }

        if (scrollY === 20 || scrollY === 56) {
            await page.screenshot({ path: testInfo.outputPath(`admin-sidebar-scroll-${scrollY}.png`) });
        }
    }

    await writeFile(testInfo.outputPath('admin-sidebar-scroll-geometry.json'), JSON.stringify(measurements, null, 2));
});

test('legacy server operations URL keeps query parameters and redirects to the server list', async ({ page }) => {
    await installGatewayFixture(page, ['superuser']);

    await page.goto('admin/server-operations?operationId=legacy-operation');
    await expect(page).toHaveURL(/\/gateway\/admin\/servers\?operationId=legacy-operation$/);
});

test('scoped administrators see the same navigation while ordinary users do not', async ({ browser }) => {
    const scopedContext = await browser.newContext();
    const scopedPage = await scopedContext.newPage();
    await installGatewayFixture(scopedPage, ['admin.profiles.runtime:hwe:2']);
    await scopedPage.goto('lobby');
    await expect(scopedPage.getByRole('link', { name: '관리자 페이지' })).toBeVisible();
    await scopedPage.getByRole('link', { name: '관리자 페이지' }).click();
    const scopedNavigation = scopedPage.getByRole('navigation', { name: '관리자 메뉴' });
    await expect(scopedNavigation.getByRole('link', { name: '환상서버 [2]' })).toBeVisible();
    await expect(scopedNavigation.getByRole('link', { name: 'Gateway 릴리스' })).toHaveCount(0);
    await expect(scopedNavigation.getByRole('link', { name: '사용자 관리' })).toHaveCount(0);
    await scopedContext.close();

    const userContext = await browser.newContext();
    const userPage = await userContext.newPage();
    await installGatewayFixture(userPage, []);
    await userPage.goto('lobby');
    await expect(userPage.getByRole('link', { name: '관리자 페이지' })).toHaveCount(0);
    await userContext.close();
});
