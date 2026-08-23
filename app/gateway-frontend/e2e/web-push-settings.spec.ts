import { expect, test, type Page, type Route } from '@playwright/test';

const response = (data: unknown) => ({ result: { data } });

const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const inputAt = (route: Route, index: number): Record<string, unknown> => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<
        string,
        { json?: Record<string, unknown> } | Record<string, unknown>
    >;
    const input = body[String(index)] ?? ({} as Record<string, unknown>);
    return ('json' in input && input.json ? input.json : input) as Record<string, unknown>;
};

const installFixture = async (page: Page) => {
    const saved: Record<string, unknown>[] = [];
    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-session-token', 'web-push-session');
    });
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation, index) => {
            if (operation === 'account.get') {
                return response({
                    id: '11111111-1111-4111-8111-111111111111',
                    username: 'push-user',
                    displayName: '알림 사용자',
                    roles: ['user'],
                    oauthType: 'NONE',
                    createdAt: '2026-08-23T00:00:00.000Z',
                    iconUrl: null,
                    icons: [],
                    preferredPicture: 'default.jpg',
                    maxActiveIcons: 5,
                    nextUploadAt: null,
                    nextRetireAt: null,
                    thirdPartyUse: false,
                    deleteAfter: null,
                });
            }
            if (operation === 'account.notifications.get') {
                return response({
                    capability: { enabled: false, publicKey: null },
                    eventTypes: [
                        'TROOP_ANNIHILATED',
                        'PRIVATE_MESSAGE_RECEIVED',
                        'AUTONOMOUS_ACTION_ENDED',
                        'RESERVED_TURNS_ENDED',
                        'PROFILE_PREOPENED',
                        'PROFILE_OPEN_SCHEDULED',
                        'PROFILE_OPENED',
                        'NATION_DESTROYED',
                        'TARGET_DATE_REACHED',
                    ],
                    profiles: [
                        {
                            profileName: 'hwe:default',
                            profile: 'hwe',
                            currentScenario: 'default',
                            status: 'RUNNING',
                        },
                    ],
                    preferences: [],
                    subscriptionCount: 0,
                    currentDeviceSubscribed: false,
                });
            }
            if (operation === 'account.notifications.setPreference') {
                saved.push(inputAt(route, index));
                return response({ ok: true });
            }
            throw new Error(`Unhandled gateway tRPC operation: ${operation}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(results),
        });
    });
    return saved;
};

test('web push settings are default-off and remain configurable while delivery is disabled', async ({
    page,
}, testInfo) => {
    const saved = await installFixture(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/gateway/account');

    const table = page.locator('#notification-table');
    await expect(table).toBeVisible();
    await expect(table).toContainText('준비됨 · 운영 비활성');
    await expect(page.getByRole('button', { name: '이 기기 알림 켜기' })).toBeDisabled();
    const checkboxes = table.getByRole('checkbox');
    await expect(checkboxes).toHaveCount(9);
    for (let index = 0; index < 9; index += 1) await expect(checkboxes.nth(index)).not.toBeChecked();

    await table.getByRole('checkbox', { name: '알림 받기' }).nth(1).check();
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]).toMatchObject({
        profileName: 'hwe:default',
        eventType: 'PRIVATE_MESSAGE_RECEIVED',
        enabled: true,
    });

    const profileSelect = table.locator('select');
    await profileSelect.focus();
    expect(await profileSelect.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
    const bounds = await table.boundingBox();
    expect(bounds?.width).toBe(550);
    const serviceWorkerScope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(serviceWorkerScope).toBe('http://127.0.0.1:15130/gateway/');
    const pwaAssets = await page.evaluate(async () => {
        const [manifest, worker] = await Promise.all([fetch('/gateway/manifest.webmanifest'), fetch('/gateway/sw.js')]);
        return {
            manifestStatus: manifest.status,
            manifestType: manifest.headers.get('content-type'),
            manifestBody: await manifest.json(),
            workerStatus: worker.status,
            workerType: worker.headers.get('content-type'),
        };
    });
    expect(pwaAssets).toMatchObject({
        manifestStatus: 200,
        manifestBody: { start_url: './', scope: './', display: 'standalone' },
        workerStatus: 200,
    });
    expect(pwaAssets.manifestType).toContain('application/manifest+json');
    expect(pwaAssets.workerType).toContain('javascript');
    await page.screenshot({ path: testInfo.outputPath('web-push-settings-desktop.png'), fullPage: true });
});

test('web push settings fit a mobile Chromium viewport and show the iPhone install prerequisite', async ({
    page,
}, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
            configurable: true,
        });
    });
    await installFixture(page);
    await page.goto('/gateway/account');

    const table = page.locator('#notification-table');
    await expect(table).toContainText('홈 화면에 추가');
    const bounds = await table.boundingBox();
    expect(bounds?.x).toBe(0);
    expect(bounds?.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath('web-push-settings-mobile.png'), fullPage: true });
});
