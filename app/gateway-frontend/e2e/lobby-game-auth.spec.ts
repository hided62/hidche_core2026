import { expect, test, type Page, type Route } from '@playwright/test';

const response = (data: unknown) => ({ result: { data } });

const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const fulfillTrpc = async (route: Route, results: unknown[]): Promise<void> => {
    await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
            'access-control-allow-origin': '*',
        },
        body: JSON.stringify(results),
    });
};

type LobbyFixtureOptions = {
    canCreateGeneral?: boolean;
    myGeneral?: {
        name: string;
        picture: string;
        imageServer: number;
    } | null;
    selectionPoolEnabled?: boolean;
    npcPossessionEnabled?: boolean;
    userCnt?: number;
    maxUserCnt?: number;
};

const installFixture = async (page: Page, options: LobbyFixtureOptions = {}) => {
    const {
        canCreateGeneral = true,
        myGeneral = {
            name: '선택장수',
            picture: 'account-hash.png',
            imageServer: 1,
        },
        selectionPoolEnabled = true,
        npcPossessionEnabled = false,
        userCnt = 1,
        maxUserCnt = 500,
    } = options;
    const gameOperations: Array<{ operation: string; authorization: string | undefined }> = [];
    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-session-token', 'gateway-lobby-session');
    });
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'me') {
                return response({
                    id: 'lobby-user',
                    username: 'lobby-user',
                    displayName: '로비사용자',
                    roles: ['user'],
                    kakaoVerified: true,
                    createdAt: '2026-07-30T00:00:00.000Z',
                });
            }
            if (operation === 'lobby.notice') {
                return response('');
            }
            if (operation === 'lobby.profiles') {
                return response([
                    {
                        profileName: 'hwe:903',
                        profile: 'hwe',
                        scenario: '903',
                        status: 'RUNNING',
                        apiPort: 15015,
                        runtime: {
                            apiRunning: true,
                            daemonRunning: true,
                            auctionRunning: true,
                            battleSimRunning: true,
                            tournamentRunning: true,
                        },
                        korName: 'hwe',
                        color: '#ffffff',
                        localAccountPolicy: {
                            accessAllowed: true,
                            canCreateGeneral,
                            requiresKakaoVerification: false,
                            graceEndsAt: null,
                        },
                    },
                ]);
            }
            if (operation === 'auth.issueGameSession') {
                return response({
                    profile: 'hwe:903',
                    gameToken: 'encrypted-gateway-game-token',
                    expiresAt: '2026-07-30T01:00:00.000Z',
                });
            }
            throw new Error(`Unhandled gateway tRPC operation: ${operation}`);
        });
        await fulfillTrpc(route, results);
    });
    await page.route('**/hwe/api/trpc/**', async (route) => {
        expect(new URL(route.request().url()).pathname).toContain('/hwe/api/trpc/');
        const authorization = route.request().headers().authorization;
        const results = operationNames(route).map((operation) => {
            gameOperations.push({ operation, authorization });
            if (operation === 'auth.exchangeGatewayToken') {
                return response({
                    accessToken: 'ga_lobby-access-token',
                    profile: 'hwe:903',
                    expiresAt: '2026-07-30T01:00:00.000Z',
                });
            }
            if (operation === 'lobby.info') {
                return response({
                    year: 180,
                    month: 1,
                    userCnt,
                    maxUserCnt,
                    npcCnt: 0,
                    nationCnt: 0,
                    turnTerm: 5,
                    fictionMode: '가상',
                    starttime: '2026-07-30 00:00:00',
                    opentime: '2026-07-30 00:00:00',
                    turntime: '2026-07-30 00:05:00',
                    otherTextInfo: '',
                    isUnited: 0,
                    selectionPoolEnabled,
                    npcPossessionEnabled,
                    myGeneral,
                });
            }
            if (operation === 'public.getMapLayout') {
                return response({ mapName: 'che', cityList: [] });
            }
            if (operation === 'public.getCachedMap') {
                return response({ year: 180, month: 1, cityList: [], nationList: [] });
            }
            throw new Error(`Unhandled game tRPC operation: ${operation}`);
        });
        await fulfillTrpc(route, results);
    });
    await page.route('**/gateway/api/user-icons/account-hash.png', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'image/png',
            body: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                'base64'
            ),
        });
    });
    return gameOperations;
};

test('exchanges the gateway token before loading authenticated lobby general data', async ({ page }) => {
    const gameOperations = await installFixture(page);

    await page.goto('lobby');
    const row = page.locator('tbody tr').filter({ hasText: 'hwe섭' });
    await expect(row).toContainText('선택장수');
    await expect(row.getByRole('button', { name: '입장' })).toBeVisible();
    const portrait = row.locator('img');
    await expect(portrait).toHaveAttribute('src', '/gateway/api/user-icons/account-hash.png');
    await expect.poll(() => portrait.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);

    expect(gameOperations.find(({ operation }) => operation === 'auth.exchangeGatewayToken')).toEqual({
        operation: 'auth.exchangeGatewayToken',
        authorization: undefined,
    });
    expect(gameOperations.find(({ operation }) => operation === 'lobby.info')).toEqual({
        operation: 'lobby.info',
        authorization: 'Bearer ga_lobby-access-token',
    });
});

test('applies the signed general-acquisition policy to both create and possession actions', async ({ page }) => {
    await installFixture(page, {
        canCreateGeneral: false,
        myGeneral: null,
        selectionPoolEnabled: false,
        npcPossessionEnabled: true,
    });

    await page.goto('lobby');
    const row = page.locator('tbody tr').filter({ hasText: 'hwe섭' });
    await expect(row.getByRole('button', { name: '인증 필요' })).toBeDisabled();
    await expect(row.getByRole('button', { name: '장수빙의' })).toBeDisabled();
});

test('opens the mode-1 possession tab with a fresh gateway game token', async ({ page }) => {
    await installFixture(page, {
        myGeneral: null,
        selectionPoolEnabled: false,
        npcPossessionEnabled: true,
    });
    await page.route('**/hwe/join?**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<title>NPC possession target</title>',
        });
    });

    await page.goto('lobby');
    const row = page.locator('tbody tr').filter({ hasText: 'hwe섭' });
    await expect(row.getByRole('button', { name: '장수빙의' })).toBeEnabled();
    await row.getByRole('button', { name: '장수빙의' }).click();

    await expect(page).toHaveURL(/\/hwe\/join\?/);
    const target = new URL(page.url());
    expect(target.searchParams.get('tab')).toBe('possess');
    expect(target.searchParams.get('profile')).toBe('hwe:903');
    expect(target.searchParams.get('gameToken')).toBe('encrypted-gateway-game-token');
});

test('shows registration closed instead of acquisition actions at the Ref capacity boundary', async ({ page }) => {
    await installFixture(page, {
        myGeneral: null,
        selectionPoolEnabled: false,
        npcPossessionEnabled: true,
        userCnt: 300,
        maxUserCnt: 300,
    });

    await page.goto('lobby');
    const row = page.locator('tbody tr').filter({ hasText: 'hwe섭' });
    await expect(row).toContainText('장수 등록 마감');
    await expect(row.getByRole('button', { name: '장수생성' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: '장수빙의' })).toHaveCount(0);
});
