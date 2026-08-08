import { expect, test, type Page, type Route } from '@playwright/test';

const response = (data: unknown) => ({ result: { data } });
const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

type ProfileFixture = {
    profileName: string;
    profile: string;
    korName: string;
    color: string;
    status: 'RUNNING' | 'PREOPEN' | 'STOPPED';
    apiPort: number;
};

const profiles: ProfileFixture[] = [
    {
        profileName: 'che:2',
        profile: 'che',
        korName: '체',
        color: '#ff8080',
        status: 'RUNNING',
        apiPort: 15003,
    },
    {
        profileName: 'hwe:2',
        profile: 'hwe',
        korName: '훼',
        color: '#80c0ff',
        status: 'PREOPEN',
        apiPort: 15015,
    },
    {
        profileName: 'kwe:2',
        profile: 'kwe',
        korName: '퀘',
        color: '#b0b0b0',
        status: 'STOPPED',
        apiPort: 15005,
    },
];

const orderedProfileData: ReadonlyArray<readonly [string, string, number]> = [
    ['che', '체', 15003],
    ['kwe', '퀘', 15005],
    ['pwe', '풰', 15007],
    ['twe', '퉤', 15009],
    ['nya', '냐', 15011],
    ['pya', '퍄', 15013],
    ['hwe', '훼', 15015],
];
const orderedProfiles: ProfileFixture[] = orderedProfileData.map(([profile, korName, apiPort]) => ({
    profileName: `${profile}:default`,
    profile,
    korName,
    color: '#b0b0b0',
    status: 'STOPPED',
    apiPort,
}));

const fulfill = async (route: Route, results: unknown[]): Promise<void> => {
    await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(results),
    });
};

const installGatewayFixture = async (page: Page, fixtureProfiles: ProfileFixture[], authenticated: boolean) => {
    if (authenticated) {
        await page.addInitScript(() => window.localStorage.setItem('sammo-session-token', 'map-tab-session'));
    }
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'me') {
                return response(
                    authenticated
                        ? {
                              id: 'map-tab-user',
                              username: 'map-tab-user',
                              displayName: '지도 탭 사용자',
                              roles: [],
                              kakaoVerified: true,
                              createdAt: '2026-08-08T00:00:00.000Z',
                          }
                        : null
                );
            }
            if (operation === 'lobby.notice') return response('');
            if (operation === 'lobby.profiles') return response(fixtureProfiles);
            if (operation === 'auth.issueGameSession') {
                const body = route.request().postData() ?? '';
                const selected = fixtureProfiles.find((profile) => body.includes(profile.profileName));
                return response({
                    profile: selected?.profileName ?? fixtureProfiles[0]?.profileName,
                    gameToken: 'map-tab-game-token',
                    expiresAt: '2026-08-08T01:00:00.000Z',
                });
            }
            throw new Error(`Unhandled gateway operation: ${operation}`);
        });
        await fulfill(route, results);
    });
};

const installGameFixture = async (page: Page, profile: ProfileFixture, userCnt: number) => {
    await page.route(`**/${profile.profile}/api/trpc/**`, async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'auth.exchangeGatewayToken') {
                return response({
                    accessToken: `${profile.profile}-access-token`,
                    profile: profile.profileName,
                    expiresAt: '2026-08-08T01:00:00.000Z',
                });
            }
            if (operation === 'lobby.info') {
                return response({
                    year: 200,
                    month: profile.profile === 'che' ? 1 : 2,
                    userCnt,
                    maxUserCnt: 500,
                    npcCnt: 0,
                    nationCnt: profile.profile === 'che' ? 2 : 3,
                    turnTerm: 10,
                    fictionMode: '가상',
                    starttime: '2026-08-08 00:00:00',
                    opentime: '2026-08-08 00:00:00',
                    turntime: '2026-08-08 00:10:00',
                    otherTextInfo: '',
                    isUnited: 0,
                    selectionPoolEnabled: true,
                    npcPossessionEnabled: false,
                    myGeneral: null,
                });
            }
            if (operation === 'public.getMapLayout') return response({ mapName: profile.profile, cityList: [] });
            if (operation === 'public.getCachedMap') {
                return response({ year: 200, month: 1, cityList: [], nationList: [], history: [] });
            }
            throw new Error(`Unhandled ${profile.profile} operation: ${operation}`);
        });
        await fulfill(route, results);
    });
};

test('shows one public map panel and switches it by hover, click, and keyboard', async ({ page }, testInfo) => {
    await installGatewayFixture(page, profiles, true);
    await installGameFixture(page, profiles[0]!, 11);
    await installGameFixture(page, profiles[1]!, 22);

    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('lobby');

    const tablist = page.getByRole('tablist', { name: '공개 지도 서버 선택' });
    const cheTab = tablist.getByRole('tab', { name: '체섭' });
    const hweTab = tablist.getByRole('tab', { name: '훼섭' });
    const panel = page.getByTestId('public-map-preview-panel');
    await expect(tablist.getByRole('tab')).toHaveCount(2);
    await expect(tablist.getByRole('tab', { name: '퀘섭' })).toHaveCount(0);
    await expect(panel).toHaveCount(1);
    await expect(cheTab).toHaveAttribute('aria-selected', 'true');
    await expect(panel).toContainText('유저 11 / 500');

    await hweTab.hover();
    await expect(hweTab).toHaveAttribute('aria-selected', 'true');
    await expect(panel).toContainText('유저 22 / 500');

    await cheTab.click();
    await expect(cheTab).toHaveAttribute('aria-selected', 'true');
    await cheTab.press('ArrowRight');
    await expect(hweTab).toBeFocused();
    await expect(hweTab).toHaveAttribute('aria-selected', 'true');

    const geometry = await panel.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            width: rect.width,
            borderLeft: style.borderLeft,
            borderTopWidth: style.borderTopWidth,
            backgroundColor: style.backgroundColor,
        };
    });
    expect(geometry.width).toBeLessThanOrEqual(992);
    expect(geometry.borderLeft).toBe('1px solid rgb(63, 63, 70)');
    expect(geometry.borderTopWidth).toBe('0px');
    expect(geometry.backgroundColor).toBe('rgba(9, 9, 11, 0.498)');
    await page.screenshot({ path: testInfo.outputPath('public-map-tabs-desktop.png'), fullPage: true });
    await testInfo.attach('public-map-tabs-desktop-geometry', {
        body: Buffer.from(`${JSON.stringify(geometry, null, 2)}\n`),
        contentType: 'application/json',
    });
});

test.describe('touch navigation', () => {
    test.use({ hasTouch: true });

    test('switches the single map panel by touch-sized tab on mobile', async ({ page }, testInfo) => {
        await installGatewayFixture(page, profiles, true);
        await installGameFixture(page, profiles[0]!, 11);
        await installGameFixture(page, profiles[1]!, 22);

        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('lobby');
        const hweTab = page.getByRole('tab', { name: '훼섭' });
        const box = await hweTab.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(34);
        await hweTab.tap();
        await expect(hweTab).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByTestId('public-map-preview-panel')).toContainText('유저 22 / 500');
        await page.screenshot({ path: testInfo.outputPath('public-map-tabs-mobile.png'), fullPage: true });
    });
});

test('treats an all-closed profile list as a normal empty login status', async ({ page }, testInfo) => {
    let gameRequestCount = 0;
    await installGatewayFixture(page, [profiles[2]!], false);
    await page.route('**/kwe/api/trpc/**', async (route) => {
        gameRequestCount += 1;
        await route.abort();
    });

    await page.goto('/gateway/');
    const status = page.locator('#map-subframe');
    await expect(status).toContainText('서버 현황');
    await expect(status).toContainText('현재 공개 중인 서버가 없습니다.');
    await expect(status).not.toContainText('Failed to fetch');
    expect(gameRequestCount).toBe(0);
    await page.screenshot({ path: testInfo.outputPath('login-no-public-server.png'), fullPage: true });
});

test('renders the Gateway profile order returned by the API', async ({ page }, testInfo) => {
    await installGatewayFixture(page, orderedProfiles, true);

    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('lobby');

    const renderedProfiles = await page.locator('tbody tr td:first-child > div:first-child').allTextContents();
    expect(renderedProfiles.map((name) => name.trim())).toEqual([
        '체섭',
        '퀘섭',
        '풰섭',
        '퉤섭',
        '냐섭',
        '퍄섭',
        '훼섭',
    ]);
    await page.screenshot({ path: testInfo.outputPath('gateway-profile-order.png'), fullPage: true });
});
