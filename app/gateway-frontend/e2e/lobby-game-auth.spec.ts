import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

const response = (data: unknown) => ({ result: { data } });
const artifactRoot = process.env.GATEWAY_STATUS_ARTIFACT_DIR;

if (artifactRoot) {
    mkdirSync(artifactRoot, { recursive: true });
}

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
    authenticated?: boolean;
    roles?: string[];
    kakaoVerified?: boolean;
    canCreateGeneral?: boolean;
    requiresKakaoVerification?: boolean;
    specialAccess?: {
        kind: 'OPERATOR' | 'TESTER' | 'RECOVERY' | 'OTHER';
        grantId: string | null;
        expiresAt: string | null;
        allowsGeneralCreation: boolean;
    } | null;
    myGeneral?: {
        name: string;
        picture: string;
        imageServer: number;
    } | null;
    selectionPoolEnabled?: boolean;
    npcPossessionEnabled?: boolean;
    userCnt?: number;
    maxUserCnt?: number;
    nationCnt?: number;
    isUnited?: number;
    starttime?: string;
    opentime?: string;
    turntime?: string;
};

const installFixture = async (page: Page, options: LobbyFixtureOptions = {}) => {
    const {
        authenticated = true,
        roles = ['user'],
        kakaoVerified = true,
        canCreateGeneral = true,
        requiresKakaoVerification = false,
        specialAccess = null,
        myGeneral = {
            name: '선택장수',
            picture: 'users/core2026/account-hash.png',
            imageServer: 1,
        },
        selectionPoolEnabled = true,
        npcPossessionEnabled = false,
        userCnt = 1,
        maxUserCnt = 500,
        nationCnt = 0,
        isUnited = 0,
        starttime = '2026-07-30 00:00:00',
        opentime = '2026-07-30 00:00:00',
        turntime = '2026-07-30 00:05:00',
    } = options;
    const gameOperations: Array<{ operation: string; authorization: string | undefined }> = [];
    if (authenticated) {
        await page.addInitScript(() => {
            window.localStorage.setItem('sammo-session-token', 'gateway-lobby-session');
        });
    }
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'me') {
                return response(
                    authenticated
                        ? {
                              id: 'lobby-user',
                              username: 'lobby-user',
                              displayName: '로비사용자',
                              roles,
                              kakaoVerified,
                              createdAt: '2026-07-30T00:00:00.000Z',
                          }
                        : null
                );
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
                            requiresKakaoVerification,
                            graceEndsAt: null,
                            specialAccess,
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
                    nationCnt,
                    turnTerm: 5,
                    fictionMode: '가상',
                    starttime,
                    opentime,
                    turntime,
                    otherTextInfo: '',
                    isUnited,
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
    await page.route('https://sam-image.hided.net/icons/users/core2026/account-hash.png', async (route) => {
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
    await expect(portrait).toHaveAttribute('src', 'https://sam-image.hided.net/icons/users/core2026/account-hash.png');
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

test('shows the Kakao verification banner when a profile still requires verification', async ({ page }) => {
    await installFixture(page, {
        kakaoVerified: false,
        requiresKakaoVerification: true,
    });

    await page.goto('lobby');
    await expect(page.getByText('카카오 인증이 필요합니다.')).toBeVisible();
});

test('hides the Kakao verification banner for operator special access', async ({ page }) => {
    await installFixture(page, {
        roles: ['superuser'],
        kakaoVerified: false,
        specialAccess: {
            kind: 'OPERATOR',
            grantId: null,
            expiresAt: null,
            allowsGeneralCreation: true,
        },
    });

    await page.goto('lobby');
    await expect(page.getByText('특수 접근 · OPERATOR')).toBeVisible();
    await expect(page.getByText('카카오 인증이 필요합니다.')).toHaveCount(0);
});

test('hides the Kakao verification banner when a grant removes the remaining verification requirement', async ({
    page,
}) => {
    await installFixture(page, {
        kakaoVerified: false,
        specialAccess: {
            kind: 'RECOVERY',
            grantId: '11111111-1111-4111-8111-111111111111',
            expiresAt: '2026-08-20T00:00:00.000Z',
            allowsGeneralCreation: true,
        },
    });

    await page.goto('lobby');
    await expect(page.getByText('특수 접근 · RECOVERY')).toBeVisible();
    await expect(page.getByText('카카오 인증이 필요합니다.')).toHaveCount(0);
});

test('opens the profile root without profile or game token query parameters', async ({ page }) => {
    await installFixture(page);
    await page.route('**/hwe/', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<title>Clean profile target</title>',
        });
    });

    await page.goto('lobby');
    const row = page.locator('tbody tr').filter({ hasText: 'hwe섭' });
    await row.getByRole('button', { name: '입장', exact: true }).click();

    await expect(page).toHaveURL(/\/hwe\/$/);
    const target = new URL(page.url());
    expect(target.search).toBe('');
    expect(
        await page.evaluate(() => JSON.parse(window.sessionStorage.getItem('sammo-pending-game-session') ?? 'null'))
    ).toEqual({
        profile: 'hwe:903',
        gatewayToken: 'encrypted-gateway-game-token',
    });
});

test('opens the mode-1 possession route with a fresh gateway game token outside the URL', async ({ page }) => {
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

    await expect(page).toHaveURL(/\/hwe\/join\?tab=possess$/);
    const target = new URL(page.url());
    expect(target.searchParams.get('tab')).toBe('possess');
    expect(target.searchParams.has('profile')).toBe(false);
    expect(target.searchParams.has('gameToken')).toBe(false);
    expect(
        await page.evaluate(() => JSON.parse(window.sessionStorage.getItem('sammo-pending-game-session') ?? 'null'))
    ).toEqual({
        profile: 'hwe:903',
        gatewayToken: 'encrypted-gateway-game-token',
    });
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

for (const season of [
    {
        name: 'competition',
        isUnited: 0,
        opentime: '2000-01-01 00:00:00',
        label: '<4국 경쟁중>',
        period: '2026-07-30 00:00:00 ~',
    },
    {
        name: 'preopen',
        isUnited: 0,
        opentime: '2099-01-01 00:00:00',
        label: '-가오픈 중-',
        period: '2026-07-30 00:00:00 ~',
    },
    {
        name: 'event running',
        isUnited: 1,
        opentime: '2099-01-01 00:00:00',
        label: '§이벤트 진행중§',
        period: '2026-07-30 00:00:00 ~',
    },
    {
        name: 'united',
        isUnited: 2,
        opentime: '2099-01-01 00:00:00',
        label: '§천하통일§',
        period: '2026-07-30 00:00:00\n~ 2026-07-30 00:05:00',
    },
    {
        name: 'event finished',
        isUnited: 3,
        opentime: '2099-01-01 00:00:00',
        label: '§이벤트 종료§',
        period: '2026-07-30 00:00:00\n~ 2026-07-30 00:05:00',
    },
] as const) {
    test(`renders the Ref ${season.name} season status without changing entry actions`, async ({ page }) => {
        await installFixture(page, {
            isUnited: season.isUnited,
            opentime: season.opentime,
            nationCnt: 4,
        });

        await page.goto('lobby');
        const row = page.locator('tbody tr').filter({ hasText: 'hwe섭' });
        const status = row.getByText(season.label, { exact: true });
        await expect(status).toBeVisible();
        await expect(row.locator('td').first().locator('[title]')).toHaveAttribute('title', season.period);
        await expect(row.getByRole('button', { name: '입장' })).toBeVisible();

        if (artifactRoot) {
            const [viewport, rowGeometry, statusGeometry] = await Promise.all([
                page.evaluate(() => ({
                    width: window.innerWidth,
                    height: window.innerHeight,
                    devicePixelRatio: window.devicePixelRatio,
                })),
                row.evaluate((element) => {
                    const rect = element.getBoundingClientRect();
                    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
                }),
                status.evaluate((element) => {
                    const rect = element.getBoundingClientRect();
                    const style = getComputedStyle(element);
                    return {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                        color: style.color,
                        fontFamily: style.fontFamily,
                        fontSize: style.fontSize,
                        lineHeight: style.lineHeight,
                        textAlign: style.textAlign,
                    };
                }),
            ]);
            const geometry = { viewport, row: rowGeometry, status: statusGeometry };
            const slug = season.name.replaceAll(' ', '-');
            writeFileSync(resolve(artifactRoot, `gateway-${slug}.json`), `${JSON.stringify(geometry, null, 2)}\n`);
            await page.screenshot({ path: resolve(artifactRoot, `gateway-${slug}.png`), fullPage: true });
        }
    });
}

test('renders the same Ref season status on the public gateway page', async ({ page }) => {
    await installFixture(page, { authenticated: false, isUnited: 3, nationCnt: 4 });

    await page.goto('');
    const status = page.locator('.season-status');
    await expect(status).toHaveText('§이벤트 종료§');
    await expect(status).toHaveAttribute('title', '2026-07-30 00:00:00\n~ 2026-07-30 00:05:00');
    await expect(page.getByRole('button', { name: '현황 새로고침' })).toBeEnabled();
});
