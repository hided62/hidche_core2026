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
    status: 'RUNNING' | 'PREOPEN' | 'PAUSED' | 'COMPLETED' | 'STOPPED';
    apiPort: number;
    lifecycle: {
        runtimeExpected: boolean;
        userAccessible: boolean;
        turnsRunning: boolean;
        operatorResumable: boolean;
        dataInitialized: boolean;
    };
};

const lifecycleFor = (status: ProfileFixture['status']): ProfileFixture['lifecycle'] => ({
    runtimeExpected: status !== 'STOPPED',
    userAccessible: status !== 'STOPPED',
    turnsRunning: status === 'RUNNING',
    operatorResumable: status === 'PAUSED' || status === 'STOPPED',
    dataInitialized: true,
});

const profiles: ProfileFixture[] = [
    {
        profileName: 'che:2',
        profile: 'che',
        korName: '체',
        color: '#ff8080',
        status: 'RUNNING',
        apiPort: 15003,
        lifecycle: lifecycleFor('RUNNING'),
    },
    {
        profileName: 'hwe:2',
        profile: 'hwe',
        korName: '훼',
        color: '#80c0ff',
        status: 'PAUSED',
        apiPort: 15015,
        lifecycle: lifecycleFor('PAUSED'),
    },
    {
        profileName: 'kwe:2',
        profile: 'kwe',
        korName: '퀘',
        color: '#b0b0b0',
        status: 'STOPPED',
        apiPort: 15005,
        lifecycle: lifecycleFor('STOPPED'),
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
    lifecycle: lifecycleFor('STOPPED'),
}));

const fulfill = async (route: Route, results: unknown[]): Promise<void> => {
    await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(results),
    });
};

const installImageFixture = async (page: Page): Promise<Set<string> | null> => {
    if (process.env.SAMMO_E2E_REAL_MAP_ASSETS === '1') {
        return null;
    }
    const requestedAssets = new Set<string>();
    const transparentPixel = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/69aQ6wAAAABJRU5ErkJggg==',
        'base64'
    );
    await page.route('https://sam-image.hided.net/game/**', async (route) => {
        requestedAssets.add(new URL(route.request().url()).pathname);
        await route.fulfill({ status: 200, contentType: 'image/png', body: transparentPixel });
    });
    return requestedAssets;
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
            if (operation === 'public.getMapLayout') {
                return response({
                    mapName: 'che',
                    cityList: [
                        { id: 1, name: '낙양', level: 8, region: 2, x: 350, y: 250, path: [2] },
                        { id: 2, name: '허창', level: 1, region: 2, x: 480, y: 300, path: [1] },
                    ],
                    regionMap: { 2: '중원' },
                    levelMap: { 1: '수', 8: '특' },
                });
            }
            if (operation === 'public.getCachedMap') {
                return response({
                    year: 200,
                    month: 1,
                    cityList: [
                        [1, 8, 41, 1, 2, 1],
                        [2, 1, 0, 2, 2, 0],
                    ],
                    nationList: [
                        [1, '위', '#FF0000', 1],
                        [2, '촉', '#0000FF', 2],
                    ],
                    history: [],
                });
            }
            throw new Error(`Unhandled ${profile.profile} operation: ${operation}`);
        });
        await fulfill(route, results);
    });
};

test('shows one public map panel and switches it by hover, click, and keyboard', async ({ page }, testInfo) => {
    const requestedAssets = await installImageFixture(page);
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
    await expect(panel.getByText('체섭', { exact: true })).toHaveCount(0);
    await expect(panel.locator('.map-preview-title')).toHaveCount(0);
    const dateBar = panel.locator('.map-preview-date-bar');
    await expect(dateBar).toHaveText('200년 1월');
    const summary = panel.getByTestId('public-map-preview-summary');
    await expect(summary).toContainText('RUNNING');
    await expect(summary).toContainText('유저 11 / 500');

    const roadLayer = panel.getByTestId('map-preview-road');
    const castles = panel.getByTestId('map-preview-castle');
    const nationBackgrounds = panel.getByTestId('map-preview-city-background');
    await expect(panel.locator('.map-preview')).toHaveClass(/map-preview-detail/);
    await expect(roadLayer).toBeVisible();
    await expect(roadLayer).toHaveCSS('background-image', /map\/che\/che_road\.png/);
    await expect(castles).toHaveCount(2);
    await expect(castles.nth(0)).toHaveAttribute('src', /\/game\/cast_8\.gif$/);
    await expect(castles.nth(1)).toHaveAttribute('src', /\/game\/cast_1\.gif$/);
    await expect(nationBackgrounds).toHaveCount(2);
    await expect(nationBackgrounds.nth(0)).toHaveCSS('background-image', /\/game\/bFF0000\.png/);
    const mapGeometry = await panel.locator('.map-preview-body').evaluate((mapBody) => {
        const rectOf = (element: Element | null) => {
            if (!element) throw new Error('expected map preview element');
            const rect = element.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
        };
        return {
            body: rectOf(mapBody),
            road: rectOf(mapBody.querySelector('[data-testid="map-preview-road"]')),
            largeCastle: rectOf(mapBody.querySelector('[data-testid="map-preview-castle"]')),
            largeNationBackground: rectOf(mapBody.querySelector('[data-testid="map-preview-city-background"]')),
        };
    });
    expect(mapGeometry).toEqual({
        body: { width: 700, height: 500 },
        road: { width: 700, height: 500 },
        largeCastle: { width: 32, height: 24 },
        largeNationBackground: { width: 96, height: 72 },
    });
    const dateGeometry = await dateBar.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const bodyRect = element.nextElementSibling?.getBoundingClientRect();
        const style = getComputedStyle(element);
        const textStyle = getComputedStyle(element.firstElementChild!);
        return {
            width: rect.width,
            height: rect.height,
            bottom: rect.bottom,
            bodyTop: bodyRect?.top,
            backgroundColor: style.backgroundColor,
            justifyContent: style.justifyContent,
            fontSize: textStyle.fontSize,
            lineHeight: textStyle.lineHeight,
        };
    });
    expect(dateGeometry).toEqual({
        width: 700,
        height: 20,
        bottom: dateGeometry.bodyTop,
        bodyTop: dateGeometry.bodyTop,
        backgroundColor: 'rgb(0, 0, 0)',
        justifyContent: 'center',
        fontSize: '14px',
        lineHeight: '20px',
    });
    if (requestedAssets) {
        await expect.poll(() => requestedAssets.has('/game/map/che/che_road.png')).toBe(true);
        await expect.poll(() => requestedAssets.has('/game/cast_8.gif')).toBe(true);
        await expect.poll(() => requestedAssets.has('/game/fFF0000.gif')).toBe(true);
    } else {
        await expect.poll(() => castles.nth(0).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(32);
        await expect.poll(() => castles.nth(1).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(16);
        await expect
            .poll(() =>
                page.evaluate(async () => {
                    const image = new Image();
                    image.src = 'https://sam-image.hided.net/game/map/che/che_road.png';
                    await image.decode();
                    return [image.naturalWidth, image.naturalHeight];
                })
            )
            .toEqual([700, 500]);
    }

    const firstCity = panel.getByTestId('map-preview-city').first();
    await expect(firstCity).not.toHaveAttribute('title');
    await firstCity.hover();
    const cityTooltip = panel.getByTestId('map-preview-city-tooltip');
    await expect(cityTooltip).toBeVisible();
    await expect(cityTooltip.locator('.tooltip-city-name')).toHaveText('【중원|특】낙양');
    await expect(cityTooltip.locator('.tooltip-nation-name')).toHaveText('위');
    const tooltipGeometry = await cityTooltip.evaluate((tooltip) => {
        const rect = tooltip.getBoundingClientRect();
        const style = getComputedStyle(tooltip);
        return {
            width: rect.width,
            height: rect.height,
            backgroundColor: style.backgroundColor,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
        };
    });
    expect(tooltipGeometry.width).toBeGreaterThanOrEqual(120);
    expect(tooltipGeometry.height).toBe(32);
    expect(tooltipGeometry.backgroundColor).toBe('rgb(30, 164, 255)');
    expect(tooltipGeometry.fontSize).toBe('14px');
    expect(tooltipGeometry.lineHeight).toBe('15px');
    await page.screenshot({ path: testInfo.outputPath('public-map-city-hover-desktop.png'), fullPage: true });

    await hweTab.hover();
    await expect(hweTab).toHaveAttribute('aria-selected', 'true');
    await expect(panel.getByText('훼섭', { exact: true })).toHaveCount(0);
    await expect(summary).toContainText('PAUSED');
    await expect(summary).toContainText('유저 22 / 500');

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
    expect(geometry.backgroundColor).toBe('rgba(9, 9, 11, 0.5)');
    await page.screenshot({ path: testInfo.outputPath('public-map-tabs-desktop.png'), fullPage: true });
    await testInfo.attach('public-map-tabs-desktop-geometry', {
        body: Buffer.from(
            `${JSON.stringify({ panel: geometry, date: dateGeometry, map: mapGeometry, tooltip: tooltipGeometry }, null, 2)}\n`
        ),
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
        const panel = page.getByTestId('public-map-preview-panel');
        await expect(panel.getByText('훼섭', { exact: true })).toHaveCount(0);
        await expect(panel.locator('.map-preview-title')).toHaveCount(0);
        await expect(panel.locator('.map-preview-date-bar')).toHaveText('200년 1월');
        const summary = panel.getByTestId('public-map-preview-summary');
        await expect(summary).toContainText('PAUSED');
        await expect(summary).toContainText('유저 22 / 500');
        await expect(panel.getByTestId('map-preview-road')).toBeVisible();
        await expect(panel.getByTestId('map-preview-castle')).toHaveCount(2);
        const mapBox = await panel.locator('.map-preview-body').boundingBox();
        expect(mapBox?.width).toBeGreaterThan(280);
        expect(mapBox?.width).toBeLessThanOrEqual(366);
        expect(mapBox?.height).toBeCloseTo((mapBox?.width ?? 0) * (5 / 7), 0);
        const horizontalOverflow = await panel.evaluate((element) => element.scrollWidth - element.clientWidth);
        expect(horizontalOverflow).toBe(0);
        const rightCity = panel.getByTestId('map-preview-city').nth(1);
        await rightCity.hover();
        const tooltip = panel.getByTestId('map-preview-city-tooltip');
        await expect(tooltip).toContainText('【중원|수】허창');
        await expect(tooltip).toContainText('촉');
        const tooltipBounds = await tooltip.evaluate((element) => {
            const tooltipRect = element.getBoundingClientRect();
            const mapRect = element.parentElement?.getBoundingClientRect();
            if (!mapRect) throw new Error('expected map preview body');
            return {
                left: tooltipRect.left - mapRect.left,
                right: mapRect.right - tooltipRect.right,
                width: tooltipRect.width,
            };
        });
        expect(tooltipBounds.left).toBeGreaterThanOrEqual(0);
        expect(tooltipBounds.right).toBeGreaterThanOrEqual(0);
        expect(tooltipBounds.width).toBeGreaterThanOrEqual(120);
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

test('shows a PAUSED profile with a live runtime on the public login status', async ({ page }) => {
    await installGatewayFixture(page, [profiles[1]!], false);
    await installGameFixture(page, profiles[1]!, 22);

    await page.goto('/gateway/');
    const status = page.locator('#map-subframe');
    await expect(status).toContainText('훼 현황');
    await expect(status).toContainText('유저 22명');
    await expect(status).not.toContainText('현재 공개 중인 서버가 없습니다.');
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
