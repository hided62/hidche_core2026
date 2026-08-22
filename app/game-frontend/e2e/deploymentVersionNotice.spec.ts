import { expect, test, type Page } from '@playwright/test';
import { gamePath } from './gameTestPaths.js';

const currentCommitSha = process.env.PLAYWRIGHT_BUILD_COMMIT_SHA ?? '0123456789abcdef0123456789abcdef01234567';
const nextCommitSha = '89abcdef0123456789abcdef0123456789abcdef';
const noticeMessage = '새 버전이 준비되었습니다. 새로고침하면 변경사항이 반영됩니다.';

const installVersionFixture = async (page: Page) => {
    let availableCommitSha = currentCommitSha;
    let requests = 0;
    const requestUrls: string[] = [];
    await page.route('**/deployment-version.json', async (route) => {
        requests += 1;
        requestUrls.push(route.request().url());
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
        requestUrls: () => requestUrls,
    };
};

test('revalidates the stable production version URL with the browser-managed ETag', async ({ page }) => {
    test.skip(process.env.PLAYWRIGHT_FRONTEND_MODE !== 'production', 'Vite production ETag is required.');
    const requests: Array<Promise<{ url: string; ifNoneMatch: string | null }>> = [];
    const responseStatuses: number[] = [];
    page.on('request', (request) => {
        if (!new URL(request.url()).pathname.endsWith('/deployment-version.json')) return;
        requests.push(
            request.headerValue('if-none-match').then((ifNoneMatch) => ({
                url: request.url(),
                ifNoneMatch,
            }))
        );
    });
    page.on('response', (response) => {
        if (!new URL(response.url()).pathname.endsWith('/deployment-version.json')) return;
        responseStatuses.push(response.status());
    });

    await page.goto(gamePath('/version-notice-etag-fixture'));
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    await expect.poll(() => responseStatuses.length).toBeGreaterThan(0);
    const completedResponses = responseStatuses.length;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => requests.length).toBeGreaterThan(1);
    await expect.poll(() => responseStatuses.length).toBeGreaterThan(completedResponses);
    const requestDetails = await Promise.all(requests);

    expect(new Set(requestDetails.map(({ url }) => url))).toEqual(
        new Set([new URL('deployment-version.json', page.url()).toString()])
    );
    expect(requestDetails[0]?.ifNoneMatch).toBeNull();
    expect(requestDetails.slice(1).some(({ ifNoneMatch }) => Boolean(ifNoneMatch))).toBe(true);
    // Chromium exposes a successfully revalidated cached response to Fetch as the usable 200 response.
    expect(responseStatuses.every((status) => status === 200)).toBe(true);
});

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
        expect(fixture.requestUrls().every((url) => new URL(url).search === '')).toBe(true);
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
