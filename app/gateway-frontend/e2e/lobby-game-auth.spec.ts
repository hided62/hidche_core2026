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

const installFixture = async (page: Page) => {
    const gameOperations: Array<{ operation: string; authorization: string | undefined }> = [];
    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-session-token', 'gateway-lobby-session');
    });
    await page.route('http://127.0.0.1:15130/api/trpc/**', async (route) => {
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
                            canCreateGeneral: true,
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
    await page.route('http://localhost:15015/api/trpc/**', async (route) => {
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
                    userCnt: 1,
                    maxUserCnt: 500,
                    npcCnt: 0,
                    nationCnt: 0,
                    turnTerm: 5,
                    fictionMode: '가상',
                    starttime: '2026-07-30 00:00:00',
                    opentime: '2026-07-30 00:00:00',
                    turntime: '2026-07-30 00:05:00',
                    otherTextInfo: '',
                    isUnited: 0,
                    selectionPoolEnabled: true,
                    myGeneral: {
                        name: '선택장수',
                        picture: 'account-hash.png',
                        imageServer: 1,
                    },
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

test('exchanges the gateway token before loading authenticated lobby general data', async ({
    page,
}) => {
    const gameOperations = await installFixture(page);

    await page.goto('lobby');
    const row = page.locator('tbody tr').filter({ hasText: 'hwe섭' });
    await expect(row).toContainText('선택장수');
    await expect(row.getByRole('button', { name: '입장' })).toBeVisible();
    const portrait = row.locator('img');
    await expect(portrait).toHaveAttribute(
        'src',
        '/gateway/api/user-icons/account-hash.png'
    );
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
