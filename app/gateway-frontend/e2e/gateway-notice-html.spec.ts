import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

const artifactRoot = process.env.GATEWAY_NOTICE_ARTIFACT_DIR ? resolve(process.env.GATEWAY_NOTICE_ARTIFACT_DIR) : null;
const response = (data: unknown) => ({ result: { data } });
const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const safeNotice =
    '<b>서버 점검</b><br /><span style="color:#00ff00;font-size:1.2em">20시 재개</span> ' +
    '<a href="https://example.test/notice" target="_blank" rel="noopener noreferrer nofollow">상세</a>';

const installFixture = async (page: Page) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-session-token', 'playwright-notice-session');
        delete (globalThis as Record<string, unknown>).__noticeXss;
    });
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'me') {
                return response({
                    id: 'notice-user',
                    username: 'notice-user',
                    displayName: '공지 확인 사용자',
                    roles: [],
                    kakaoVerified: true,
                    createdAt: '2026-07-31T00:00:00.000Z',
                });
            }
            if (operation === 'lobby.notice') return response(safeNotice);
            if (operation === 'lobby.profiles') return response([]);
            throw new Error(`Unhandled gateway notice fixture operation: ${operation}`);
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
    test(`renders the purified gateway notice on ${viewport.name}`, async ({ page }) => {
        await installFixture(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto('/gateway/lobby');

        const notice = page.getByTestId('gateway-notice');
        await expect(notice).toBeVisible();
        await expect(notice.locator('b')).toHaveText('서버 점검');
        await expect(notice.locator('br')).toHaveCount(1);
        await expect(notice.locator('span')).toHaveText('20시 재개');
        await expect(notice.locator('script, img, svg, iframe, [onerror], [onload], [onclick]')).toHaveCount(0);
        expect(await page.evaluate(() => (globalThis as Record<string, unknown>).__noticeXss)).toBeUndefined();

        const link = notice.getByRole('link', { name: '상세' });
        await expect(link).toHaveAttribute('href', 'https://example.test/notice');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
        await link.focus();
        await expect(link).toBeFocused();
        await link.hover();

        const geometry = await notice.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const emphasis = element.querySelector<HTMLElement>('span');
            const emphasisStyle = emphasis ? getComputedStyle(emphasis) : null;
            return {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                color: style.color,
                fontSize: style.fontSize,
                fontWeight: style.fontWeight,
                emphasisColor: emphasisStyle?.color ?? null,
                emphasisFontSize: emphasisStyle?.fontSize ?? null,
            };
        });
        expect(geometry.width).toBeGreaterThan(0);
        expect(geometry.y).toBe(96);
        expect(geometry.color).toBe('oklch(0.705 0.213 47.604)');
        expect(geometry.fontSize).toBe('30px');
        expect(Number(geometry.fontWeight)).toBeGreaterThanOrEqual(700);
        expect(geometry.emphasisColor).toBe('rgb(0, 255, 0)');
        expect(geometry.emphasisFontSize).toBe('36px');

        if (artifactRoot) {
            await mkdir(artifactRoot, { recursive: true });
            const name = `gateway-notice-${viewport.name}`;
            await writeFile(
                resolve(artifactRoot, `${name}.json`),
                `${JSON.stringify({ viewport, geometry }, null, 2)}\n`,
                'utf8'
            );
            await page.screenshot({ path: resolve(artifactRoot, `${name}.png`), fullPage: true });
        }
    });
}
