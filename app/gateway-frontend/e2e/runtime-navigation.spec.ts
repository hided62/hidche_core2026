import { readFile } from 'node:fs/promises';

import { expect, test, type Page, type Route } from '@playwright/test';

const defaultNavigation = JSON.parse(
    await readFile(new URL('../../../resources/navigation.json', import.meta.url), 'utf8')
) as {
    gateway: { items: Array<{ id: string; label: string }> };
};
const response = (data: unknown) => ({ result: { data } });
const operationNames = (route: Route) =>
    decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(',');

const installGatewayFixture = async (page: Page, navigation: unknown = defaultNavigation) => {
    await page.route('**/gateway/api/navigation', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(navigation) });
    });
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const operations = operationNames(route);
        const results = operations.map((operation) => {
            if (operation === 'navigation.get') return response(navigation);
            if (operation === 'me' || operation === 'lobby.notice') return response(null);
            if (operation === 'lobby.profiles') return response([]);
            return response({ ok: true });
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(operations.length === 1 ? results[0] : results),
        });
    });
};

test('Gateway 상단 메뉴가 PHP 항목과 desktop geometry를 따른다', async ({ page }) => {
    await installGatewayFixture(page);
    await page.setViewportSize({ width: 1365, height: 900 });
    await page.goto('./');

    const navigation = page.locator('#gateway-navigation');
    await expect(navigation.locator('a')).toHaveText(defaultNavigation.gateway.items.map((item) => item.label));
    await expect(page.locator('.gateway-navbar')).toHaveCSS('height', '76px');
    await expect(page.locator('.gateway-navbar')).toHaveCSS('padding', '16px 0px');
    await expect(navigation.locator('a').first()).toHaveCSS('font-size', '16px');
    await expect(navigation.locator('a').first()).toHaveCSS('padding', '8px');

    await navigation.locator('a').first().hover();
    await expect(navigation.locator('a').first()).toHaveCSS('color', 'rgb(255, 255, 255)');
});

test('Gateway 모바일 접이식 메뉴가 PHP 40px 행과 전체 너비를 따른다', async ({ page }) => {
    await installGatewayFixture(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('./');

    await page.getByRole('button', { name: '메뉴 열기' }).click();
    const links = page.locator('#gateway-navigation a');
    await expect(links).toHaveCount(10);
    const first = await links.first().boundingBox();
    expect(first).toMatchObject({ x: 1, y: 56, width: 388, height: 40 });
    await links.first().focus();
    await expect(links.first()).toBeFocused();
    await expect(links.first()).toHaveCSS('color', 'rgb(255, 255, 255)');
});

test('JSON 응답을 바꾸면 frontend 재빌드 없이 다음 로드에 반영된다', async ({ page }) => {
    const changed = structuredClone(defaultNavigation);
    changed.gateway.items[0]!.label = '운영 공지';
    await installGatewayFixture(page, changed);
    await page.goto('./');

    await expect(page.locator('[data-navigation-id="notice"]')).toHaveText('운영 공지');
});
