import { expect, test, type Page, type Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const response = (data: unknown) => ({ result: { data } });
const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const installFixture = async (page: Page) => {
    const requests: Array<{ operation: string; body: string }> = [];
    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-session-token', 'kakao-replacement-session');
    });
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const body = route.request().postData() ?? '';
        const results = operationNames(route).map((operation) => {
            requests.push({ operation, body });
            if (operation === 'account.get') {
                return response({
                    id: 'replacement-user',
                    username: 'replacement-user',
                    displayName: '교체 사용자',
                    roles: ['user'],
                    oauthType: 'KAKAO',
                    email: 'replacement@example.test',
                    createdAt: '2026-08-01T00:00:00.000Z',
                    iconUrl: null,
                    icons: [],
                    preferredPicture: 'default.jpg',
                    maxActiveIcons: 5,
                    nextUploadAt: null,
                    nextRetireAt: null,
                    thirdPartyUse: false,
                    deleteAfter: null,
                    kakaoReplacementApprovedUntil: new Date(Date.now() + 86_400_000).toISOString(),
                });
            }
            if (operation === 'account.notifications.get') {
                return response({
                    capability: { enabled: false, publicKey: null },
                    eventTypes: [],
                    profiles: [],
                    preferences: [],
                    subscriptionCount: 0,
                    currentDeviceSubscribed: false,
                });
            }
            if (operation === 'auth.kakaoStart') {
                return response({
                    authUrl: `${new URL(route.request().url()).origin}/gateway/account?replacement=started`,
                });
            }
            throw new Error(`Unhandled account replacement fixture operation: ${operation}`);
        });
        const isBatch = new URL(route.request().url()).searchParams.get('batch') === '1';
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(isBatch ? results : results[0]),
        });
    });
    return requests;
};

test('starts an approved Kakao replacement with explicit permanent-retirement confirmation', async ({
    page,
}, testInfo) => {
    const requests = await installFixture(page);
    let confirmation = '';
    page.on('dialog', async (dialog) => {
        confirmation = dialog.message();
        await dialog.accept();
    });

    await page.goto('account');
    const button = page.getByRole('button', { name: '새 카카오 계정으로 교체' });
    await expect(button).toBeVisible();
    await expect(page.getByText(/교체 승인 .*까지/)).toBeVisible();
    const initialBackground = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
    await button.hover();
    await expect
        .poll(() => button.evaluate((element) => getComputedStyle(element).backgroundColor))
        .not.toBe(initialBackground);
    await button.focus();
    await expect(button).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('account-kakao-replacement-desktop.png'), fullPage: true });

    await button.click();
    await expect(page).toHaveURL(/replacement=started/);
    expect(confirmation).toContain('기존 카카오 계정은 영구 폐기');
    const startRequest = requests.find(({ operation }) => operation === 'auth.kakaoStart');
    expect(startRequest?.body).toContain('verify');
    expect(startRequest?.body).toContain('kakao-replacement-session');

    await page.setViewportSize({ width: 500, height: 844 });
    const mobileButton = page.getByRole('button', { name: '새 카카오 계정으로 교체' });
    await expect(mobileButton).toBeVisible();
    const geometry = await mobileButton.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: window.innerWidth };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
    await writeFile(testInfo.outputPath('account-kakao-replacement-mobile-geometry.json'), JSON.stringify(geometry));
    await page.screenshot({ path: testInfo.outputPath('account-kakao-replacement-mobile.png'), fullPage: true });
});
