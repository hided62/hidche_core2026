import { expect, test, type Page } from '@playwright/test';
import { gamePath } from './gameTestPaths.js';

const currentCommitSha = process.env.PLAYWRIGHT_BUILD_COMMIT_SHA ?? '0123456789abcdef0123456789abcdef01234567';
const nextCommitSha = '89abcdef0123456789abcdef0123456789abcdef';
const noticeMessage = '새 버전이 준비되었습니다. 새로고침하면 변경사항이 반영됩니다.';

const installVersionFixture = async (page: Page) => {
    let availableCommitSha = currentCommitSha;
    let requests = 0;
    await page.route('**/deployment-version.json*', async (route) => {
        requests += 1;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ commitSha: availableCommitSha }),
        });
    });
    return {
        deployNextVersion: () => {
            availableCommitSha = nextCommitSha;
        },
        requestCount: () => requests,
    };
};

for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'mobile', width: 390, height: 844 },
]) {
    test(`shows one quiet update toast without forcing reload on ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const fixture = await installVersionFixture(page);
        await page.goto(gamePath('/version-notice-fixture'));
        await expect(page.getByRole('heading', { name: 'Not Found' })).toBeVisible();
        await expect.poll(fixture.requestCount).toBeGreaterThan(0);
        await page.evaluate(() => {
            Object.assign(window, { __versionNoticePageMarker: 'kept' });
        });

        fixture.deployNextVersion();
        await expect
            .poll(async () => {
                await page.evaluate(() => window.dispatchEvent(new Event('online')));
                return fixture.requestCount();
            })
            .toBeGreaterThan(1);
        const toast = page.getByTestId('game-toast').filter({ hasText: noticeMessage });
        await expect(toast).toBeVisible();
        await expect(toast).toHaveAttribute('data-feedback-kind', 'info');
        await expect(toast).toHaveCSS('transform', 'none');
        const box = await toast.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
        expect(await page.evaluate(() => Reflect.get(window, '__versionNoticePageMarker'))).toBe('kept');

        await page.getByRole('button', { name: '알림 닫기' }).click();
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect(toast).toHaveCount(0);
    });
}
