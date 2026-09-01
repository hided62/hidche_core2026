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
    directGeneralCreationEnabled?: boolean;
    npcPossessionEnabled?: boolean;
    userCnt?: number;
    maxUserCnt?: number;
    nationCnt?: number;
    isUnited?: number;
    starttime?: string;
    opentime?: string;
    preopenAt?: string;
    turntime?: string;
    turnTerm?: number;
    scenarioTitle?: string;
    npcMode?: number;
    defaultStatTotal?: number;
    korName?: string;
    otherTextInfo?: string;
    autorunUser?: {
        limitMinutes: number;
        options: string[];
    } | null;
    upcomingReset?: {
        phase: 'SCHEDULED' | 'PREPARING' | 'READY' | 'DELAYED';
        scheduledAt: string | null;
        preopenAt: string;
        openAt: string;
        scenarioId: number;
        scenarioTitle: string;
        turnTermMinutes: number;
        fictionMode: string;
        npcMode: number;
        defaultStatTotal: number;
        otherTextInfo: string;
        autorunUser: {
            limitMinutes: number;
            options: string[];
        } | null;
    } | null;
    lobbyBundleFailures?: number;
    profileStatus?: 'RUNNING' | 'PREOPEN' | 'PAUSED' | 'COMPLETED' | 'STOPPED' | 'RESERVED';
    includeStoppedProfile?: boolean;
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
        directGeneralCreationEnabled = true,
        npcPossessionEnabled = false,
        userCnt = 1,
        maxUserCnt = 500,
        nationCnt = 0,
        isUnited = 0,
        starttime = '2026-07-30 00:00:00',
        opentime = '2026-07-30 00:00:00',
        preopenAt = '',
        turntime = '2026-07-30 00:05:00',
        turnTerm = 5,
        scenarioTitle = '',
        npcMode = 0,
        defaultStatTotal = 165,
        korName = 'hwe',
        otherTextInfo = '',
        autorunUser = null,
        upcomingReset = null,
        lobbyBundleFailures = 0,
        profileStatus = 'RUNNING',
        includeStoppedProfile = false,
    } = options;
    const runtimeAvailable = ['RUNNING', 'PREOPEN', 'PAUSED', 'COMPLETED'].includes(profileStatus);
    let remainingLobbyBundleFailures = lobbyBundleFailures;
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
                return response(
                    [
                        {
                            profileName: 'hwe:903',
                            profile: 'hwe',
                            instanceKey: '903',
                            currentScenario: '903',
                            scenario: '903',
                            status: profileStatus,
                            lifecycle: {
                                runtimeExpected: runtimeAvailable,
                                userAccessible: runtimeAvailable,
                                turnsRunning: profileStatus === 'RUNNING',
                                operatorResumable: profileStatus === 'PAUSED' || profileStatus === 'STOPPED',
                                dataInitialized: true,
                            },
                            apiPort: 15015,
                            runtime: {
                                apiRunning: runtimeAvailable,
                                daemonRunning: runtimeAvailable,
                                auctionRunning: runtimeAvailable,
                                battleSimRunning: runtimeAvailable,
                                tournamentRunning: runtimeAvailable,
                            },
                            korName,
                            color: '#ffffff',
                            upcomingReset,
                            localAccountPolicy: {
                                accessAllowed: true,
                                canCreateGeneral,
                                requiresKakaoVerification,
                                graceEndsAt: null,
                                specialAccess,
                            },
                        },
                        includeStoppedProfile
                            ? {
                                  profileName: 'che:2601',
                                  profile: 'che',
                                  instanceKey: '2601',
                                  currentScenario: '2601',
                                  scenario: '2601',
                                  status: 'STOPPED',
                                  lifecycle: {
                                      runtimeExpected: false,
                                      userAccessible: false,
                                      turnsRunning: false,
                                      operatorResumable: true,
                                      dataInitialized: true,
                                  },
                                  apiPort: 15003,
                                  runtime: {
                                      apiRunning: false,
                                      daemonRunning: false,
                                      auctionRunning: false,
                                      battleSimRunning: false,
                                      tournamentRunning: false,
                                  },
                                  korName: 'che',
                                  color: '#f59e0b',
                                  localAccountPolicy: {
                                      accessAllowed: false,
                                      canCreateGeneral: false,
                                      requiresKakaoVerification: false,
                                      graceEndsAt: null,
                                      specialAccess: null,
                                  },
                              }
                            : null,
                    ].filter((profile) => profile !== null)
                );
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
        const operations = operationNames(route);
        if (operations.includes('lobby.info') && remainingLobbyBundleFailures > 0) {
            remainingLobbyBundleFailures -= 1;
            gameOperations.push(...operations.map((operation) => ({ operation, authorization })));
            await route.fulfill({
                status: 502,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'profile runtime is switching' }),
            });
            return;
        }
        const results = operations.map((operation) => {
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
                    turnTerm,
                    fictionMode: '가상',
                    starttime,
                    opentime,
                    preopenAt,
                    turntime,
                    otherTextInfo,
                    scenarioTitle,
                    npcMode,
                    defaultStatTotal,
                    autorunUser,
                    isUnited,
                    selectionPoolEnabled,
                    directGeneralCreationEnabled,
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

test('shows the Ref scenario title instead of the stored scenario code for an active profile', async ({
    page,
}, testInfo) => {
    await installFixture(page, {
        scenarioTitle: '【가상모드27-b】 아시아 명장전(비급)',
    });
    await page.setViewportSize({ width: 1365, height: 900 });

    await page.goto('lobby');
    const row = page.locator('tbody tr').filter({ hasText: 'hwe섭' });
    const info = row.locator('.profile-info-cell');
    const title = row.getByTestId('profile-scenario-title');
    await expect(title).toHaveText('【가상모드27-b】 아시아 명장전(비급)');
    await expect(info).not.toContainText('903');
    await expect(title).toHaveCSS('color', 'oklch(0.75 0.183 55.934)');
    await page.screenshot({ path: testInfo.outputPath('gateway-active-scenario-title-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await title.scrollIntoViewIfNeeded();
    const mobileGeometry = await info.evaluate((element) => {
        const titleElement = element.querySelector('[data-testid="profile-scenario-title"]');
        if (!titleElement) throw new Error('expected scenario title');
        const infoRect = element.getBoundingClientRect();
        const titleRect = titleElement.getBoundingClientRect();
        return {
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
            info: infoRect.toJSON(),
            title: titleRect.toJSON(),
        };
    });
    expect(mobileGeometry.documentWidth).toBe(mobileGeometry.viewportWidth);
    expect(mobileGeometry.title.left).toBeGreaterThanOrEqual(mobileGeometry.info.left);
    expect(mobileGeometry.title.right).toBeLessThanOrEqual(mobileGeometry.info.right);
    await page.screenshot({ path: testInfo.outputPath('gateway-active-scenario-title-mobile.png'), fullPage: true });
});

test('copies the complete preopen announcement and reveals autorun details without changing layout', async ({
    page,
}, testInfo) => {
    await installFixture(page, {
        roles: ['superuser'],
        kakaoVerified: false,
        profileStatus: 'PREOPEN',
        korName: '훼',
        specialAccess: {
            kind: 'OPERATOR',
            grantId: null,
            expiresAt: null,
            allowsGeneralCreation: true,
        },
        preopenAt: '2026-08-19 22:00:00',
        opentime: '2026-08-19 23:00:00',
        starttime: '2026-08-19 23:00:00',
        turnTerm: 1,
        scenarioTitle: '【가상모드27-b】 아시아 명장전(비급)',
        npcMode: 0,
        defaultStatTotal: 310,
        autorunUser: {
            limitMinutes: 1_440,
            options: ['develop', 'warp', 'recruit_high', 'train', 'battle', 'chief'],
        },
    });
    await page.setViewportSize({ width: 1200, height: 900 });

    await page.goto('lobby');
    const row = page.locator('tbody tr').filter({ hasText: '훼섭' });
    const serverName = row.locator('.profile-server-cell .font-bold');
    const settings = row.locator('.profile-announcement-settings');
    const autorun = row.locator('.copyable-autorun');
    const detail = row.locator('.copyable-autorun-detail');
    await expect(row.getByTestId('profile-preopen-at')).toHaveText('- 가오픈 일시 : 2026-08-19 22:00:00 -');
    await expect(row.getByTestId('profile-open-at')).toHaveText('- 오픈 일시 : 2026-08-19 23:00:00 -');
    await expect(row.getByTestId('profile-scenario-announcement')).toHaveText(
        '【가상모드27-b】 아시아 명장전(비급) 1분 턴 서버'
    );
    const settingsText = (await settings.textContent())?.replace(/\s+/g, ' ').trim();
    expect(settingsText).toBe(
        '(상성 설정:가상), (빙의 여부:불가), (최대 스탯:310), ' +
            '(기타 설정:자율행동[내정, 순간이동, 모병, 훈련/사기진작, 출병, 사령턴, 24시간 유효])'
    );
    await expect(detail).toHaveCSS('font-size', '0px');
    await expect(detail).toHaveCSS('color', 'rgba(0, 0, 0, 0)');
    await expect(page.getByText('특수 접근 · OPERATOR')).toHaveCount(0);
    await expect(page.getByText('카카오 인증이 필요합니다.')).toHaveCount(0);

    const baseGeometry = await row.evaluate((element) => ({
        row: element.getBoundingClientRect().toJSON(),
        documentWidth: document.documentElement.scrollWidth,
    }));
    await autorun.hover();
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('내정, 순간이동, 모병, 훈련/사기진작, 출병, 사령턴, 24시간 유효');
    const hoverGeometry = await row.evaluate((element) => ({
        row: element.getBoundingClientRect().toJSON(),
        documentWidth: document.documentElement.scrollWidth,
    }));
    expect(hoverGeometry).toEqual(baseGeometry);
    await page.screenshot({ path: testInfo.outputPath('gateway-autorun-announcement-hover.png'), fullPage: true });

    await autorun.focus();
    await expect(autorun).toBeFocused();
    await expect(detail).toBeVisible();
    await expect(autorun).toHaveCSS('outline-width', '2px');

    await page.mouse.click(8, 8);
    const start = await serverName.boundingBox();
    const end = await settings.boundingBox();
    if (!start || !end) throw new Error('expected announcement selection geometry');
    await page.mouse.move(start.x + 1, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + end.width - 1, end.y + end.height / 2, { steps: 24 });
    await page.mouse.up();
    const selectedText = await page.evaluate(() => window.getSelection()?.toString() ?? '');
    const compactSelection = selectedText.replace(/\s+/g, ' ').trim();
    expect(compactSelection).toContain(
        '훼섭 - 가오픈 일시 : 2026-08-19 22:00:00 - - 오픈 일시 : 2026-08-19 23:00:00 - ' +
            '【가상모드27-b】 아시아 명장전(비급) 1분 턴 서버 ' +
            '(상성 설정:가상), (빙의 여부:불가), (최대 스탯:310), ' +
            '(기타 설정:자율행동[내정, 순간이동, 모병, 훈련/사기진작, 출병, 사령턴, 24시간 유효])'
    );
    expect(compactSelection).not.toContain('OPERATOR');

    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.setViewportSize({ width: 390, height: 844 });
    await autorun.scrollIntoViewIfNeeded();
    const mobileBase = await row.evaluate((element) => ({
        row: element.getBoundingClientRect().toJSON(),
        documentWidth: document.documentElement.scrollWidth,
    }));
    await autorun.hover();
    await expect(detail).toBeVisible();
    const mobileHover = await row.evaluate((element) => {
        const tooltip = element.querySelector('.copyable-autorun-detail');
        if (!tooltip) throw new Error('expected autorun tooltip');
        return {
            row: element.getBoundingClientRect().toJSON(),
            tooltip: tooltip.getBoundingClientRect().toJSON(),
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
        };
    });
    expect(mobileHover.row).toEqual(mobileBase.row);
    expect(mobileHover.documentWidth).toBe(mobileHover.viewportWidth);
    expect(mobileHover.tooltip.left).toBeGreaterThanOrEqual(8);
    expect(mobileHover.tooltip.right).toBeLessThanOrEqual(mobileHover.viewportWidth - 8);
    await page.screenshot({ path: testInfo.outputPath('gateway-autorun-announcement-mobile.png'), fullPage: true });
});

test('loads and labels a PAUSED profile whose runtime remains available', async ({ page }, testInfo) => {
    const gameOperations = await installFixture(page, { profileStatus: 'PAUSED' });
    await page.setViewportSize({ width: 1365, height: 900 });

    await page.goto('lobby');
    const row = page.locator('tbody tr').filter({ hasText: 'hwe섭' });
    const pausedStatus = row.getByTestId('profile-paused-status');
    await expect(pausedStatus).toHaveText('턴 일시정지 · 조회/예약턴 가능');
    await expect(pausedStatus).toHaveCSS('color', 'oklch(0.879 0.169 91.605)');
    await expect(row).toContainText('선택장수');
    await expect(row).not.toContainText('정보를 불러오는 중');
    await expect(row.getByRole('button', { name: '입장' })).toBeVisible();
    expect(gameOperations.some(({ operation }) => operation === 'lobby.info')).toBe(true);
    await expect(page.getByRole('tab', { name: 'hwe섭' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('gateway-paused-profile-lobby.png'), fullPage: true });
});

test('does not contact a STOPPED game runtime and labels it inaccessible', async ({ page }, testInfo) => {
    const gameOperations = await installFixture(page, { profileStatus: 'STOPPED' });

    await page.goto('lobby');
    const row = page.locator('tbody tr').filter({ hasText: 'hwe섭' });
    await expect(row).toContainText('서버 중지 · 접근 불가');
    await expect(row).not.toContainText('정보를 불러오는 중');
    await expect(row.getByRole('button', { name: '입장' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'hwe섭' })).toHaveCount(0);
    expect(gameOperations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('gateway-stopped-profile-lobby.png'), fullPage: true });
});

test('matches the normal preopen copy text and labels an immediate announcement with its build time', async ({
    page,
}, testInfo) => {
    const gameOperations = await installFixture(page, {
        profileStatus: 'STOPPED',
        korName: '체',
        upcomingReset: {
            phase: 'SCHEDULED',
            scheduledAt: '2026-08-27T05:00:00.000Z',
            preopenAt: '2026-08-27T05:30:00.000Z',
            openAt: '2026-08-27T11:00:00.000Z',
            scenarioId: 1010,
            scenarioTitle: '【가상】황건적의 난',
            turnTermMinutes: 60,
            fictionMode: '가상',
            npcMode: 1,
            defaultStatTotal: 70,
            otherTextInfo: '랜덤 임관',
            autorunUser: {
                limitMinutes: 1440,
                options: ['develop', 'battle'],
            },
        },
        includeStoppedProfile: true,
    });
    await page.setViewportSize({ width: 1200, height: 900 });

    await page.goto('lobby');
    const row = page.locator('tbody tr').filter({ hasText: '체섭' });
    const announcement = row.getByTestId('upcoming-reset-announcement');
    const badge = announcement.getByTestId('reserved-announcement-badge');
    const tooltip = announcement.getByTestId('reserved-announcement-build-tooltip');
    await expect(row.getByTestId('upcoming-reset-phase')).toHaveCount(0);
    await expect(row.getByTestId('upcoming-reset-scheduled-at')).toHaveCount(0);
    await expect(row.getByTestId('upcoming-reset-preopen-at')).toHaveText('- 가오픈 일시 : 2026-08-27 14:30:00 -');
    await expect(row.getByTestId('upcoming-reset-open-at')).toHaveText('- 오픈 일시 : 2026-08-27 20:00:00 -');
    await expect(row.getByTestId('upcoming-reset-scenario-title')).toHaveText('【가상】황건적의 난');
    await expect(
        row.getByTestId('upcoming-reset-scenario-announcement').locator(':scope > .text-green-400')
    ).toHaveText('60분 턴 서버');
    await expect(announcement.locator('.profile-announcement-settings')).toHaveText(
        '(상성 설정:가상), (빙의 여부:가능), (최대 스탯:70), ' +
            '(기타 설정:랜덤 임관, 자율행동[내정, 출병, 24시간 유효])'
    );
    await expect(tooltip).toBeHidden();
    await expect(badge).toHaveText(/예약 공지/);
    await expect(badge).toHaveAttribute('aria-label', '예약 공지의 실제 빌드 시작 시각 보기');
    await expect(badge).toHaveCSS('user-select', 'none');
    await expect(badge).toHaveCSS('border-top-color', 'rgb(217, 119, 6)');
    await expect(row).not.toContainText('서버 중지 · 접근 불가');
    await expect(row).not.toContainText('정보를 불러오는 중');
    await expect(row.getByRole('button', { name: '입장' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'hwe섭' })).toHaveCount(0);
    expect(gameOperations).toEqual([]);

    const desktopGeometry = await announcement.evaluate((element) => {
        const badge = element.querySelector<HTMLElement>('[data-testid="reserved-announcement-badge"]');
        if (!badge) throw new Error('expected reserved announcement badge');
        return {
            announcement: element.getBoundingClientRect().toJSON(),
            cell: element.parentElement?.getBoundingClientRect().toJSON(),
            badge: badge.getBoundingClientRect().toJSON(),
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
        };
    });
    expect(desktopGeometry.announcement.left).toBeGreaterThanOrEqual(desktopGeometry.cell?.left ?? 0);
    expect(desktopGeometry.announcement.right).toBeLessThanOrEqual(desktopGeometry.cell?.right ?? 0);
    expect(desktopGeometry.badge.width).toBeGreaterThan(40);
    expect(desktopGeometry.badge.height).toBe(18);
    const desktopRowDivider = await page
        .locator('tbody tr')
        .first()
        .evaluate((element) => {
            const style = getComputedStyle(element);
            return { color: style.borderBottomColor, width: style.borderBottomWidth };
        });
    expect(desktopRowDivider).toEqual({ color: 'rgb(82, 82, 91)', width: '1px' });
    await badge.hover();
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText('실제 빌드 시작 : 2026-08-27 14:00:00');
    await expect(tooltip).not.toContainText('초기화 옵션');
    const desktopTooltipGeometry = await tooltip.evaluate((element) => element.getBoundingClientRect().toJSON());
    expect(desktopTooltipGeometry.left).toBeGreaterThanOrEqual(8);
    expect(desktopTooltipGeometry.right).toBeLessThanOrEqual(desktopGeometry.viewportWidth - 8);
    expect(desktopTooltipGeometry.top).toBeGreaterThanOrEqual(desktopGeometry.cell?.top ?? 0);
    expect(desktopTooltipGeometry.bottom).toBeLessThanOrEqual(desktopGeometry.cell?.bottom ?? 0);
    await badge.focus();
    await expect(badge).toBeFocused();
    await expect(badge).toHaveCSS('outline-width', '2px');

    await page.mouse.click(8, 8);
    const selectionStart = await announcement.getByTestId('upcoming-reset-preopen-at').boundingBox();
    const selectionEnd = await announcement.locator('.profile-announcement-settings').boundingBox();
    if (!selectionStart || !selectionEnd) throw new Error('expected upcoming announcement selection geometry');
    await page.mouse.move(selectionStart.x + 1, selectionStart.y + selectionStart.height / 2);
    await page.mouse.down();
    await page.mouse.move(selectionEnd.x + selectionEnd.width - 1, selectionEnd.y + selectionEnd.height / 2, {
        steps: 24,
    });
    await page.mouse.up();
    const compactSelection = (await page.evaluate(() => window.getSelection()?.toString() ?? ''))
        .replace(/\s+/g, ' ')
        .trim();
    expect(compactSelection).toBe(
        '- 가오픈 일시 : 2026-08-27 14:30:00 - - 오픈 일시 : 2026-08-27 20:00:00 - ' +
            '【가상】황건적의 난 60분 턴 서버 ' +
            '(상성 설정:가상), (빙의 여부:가능), (최대 스탯:70), ' +
            '(기타 설정:랜덤 임관, 자율행동[내정, 출병, 24시간 유효])'
    );
    expect(compactSelection).not.toContain('예약 공지');
    expect(compactSelection).not.toContain('실제 빌드 시작');
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.screenshot({ path: testInfo.outputPath('gateway-upcoming-reset-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await announcement.scrollIntoViewIfNeeded();
    const mobileGeometry = await announcement.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            left: rect.left,
            right: rect.right,
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
        };
    });
    expect(mobileGeometry.left).toBeGreaterThanOrEqual(0);
    expect(mobileGeometry.right).toBeLessThanOrEqual(mobileGeometry.viewportWidth);
    expect(mobileGeometry.documentWidth).toBe(mobileGeometry.viewportWidth);
    await badge.hover();
    await expect(tooltip).toBeVisible();
    const mobileTooltipGeometry = await tooltip.evaluate((element) => element.getBoundingClientRect().toJSON());
    expect(mobileTooltipGeometry.left).toBeGreaterThanOrEqual(8);
    expect(mobileTooltipGeometry.right).toBeLessThanOrEqual(mobileGeometry.viewportWidth - 8);
    expect(mobileTooltipGeometry.bottom).toBeLessThanOrEqual(844 - 8);
    await page.screenshot({ path: testInfo.outputPath('gateway-upcoming-reset-mobile.png'), fullPage: true });
});

test('shows a build-complete RESERVED announcement without the early-publication badge', async ({ page }) => {
    const gameOperations = await installFixture(page, {
        profileStatus: 'RESERVED',
        upcomingReset: {
            phase: 'READY',
            scheduledAt: null,
            preopenAt: '2026-08-27T05:30:00.000Z',
            openAt: '2026-08-27T11:00:00.000Z',
            scenarioId: 1010,
            scenarioTitle: '【가상】황건적의 난',
            turnTermMinutes: 60,
            fictionMode: '가상',
            npcMode: 1,
            defaultStatTotal: 70,
            otherTextInfo: '',
            autorunUser: null,
        },
    });

    await page.goto('lobby');
    const row = page.locator('tbody tr').filter({ hasText: 'hwe섭' });
    await expect(row.getByTestId('upcoming-reset-phase')).toHaveCount(0);
    await expect(row.getByTestId('upcoming-reset-scenario-title')).toHaveText('【가상】황건적의 난');
    await expect(row.getByTestId('reserved-announcement-badge')).toHaveCount(0);
    await expect(row.getByTestId('reserved-announcement-build-tooltip')).toHaveCount(0);
    await expect(row).not.toContainText('준 비 중 · 접근 불가');
    await expect(row.getByRole('button', { name: '입장' })).toHaveCount(0);
    expect(gameOperations).toEqual([]);
});

test('automatically recovers profile details after a transient update outage', async ({ page }) => {
    const gameOperations = await installFixture(page, { lobbyBundleFailures: 1 });

    await page.goto('lobby');
    const row = page.locator('tbody tr').filter({ hasText: 'hwe섭' });
    await expect(row.getByTestId('profile-info-retrying')).toContainText('서버 응답을 기다리고 있습니다.');
    await expect(row.getByRole('button', { name: '지금 다시 확인' })).toBeVisible();
    await expect(row).toContainText('선택장수', { timeout: 8_000 });
    expect(gameOperations.filter(({ operation }) => operation === 'lobby.info')).toHaveLength(2);
});

test('uses two-row mobile server cards without horizontal scrolling and keeps retry keyboard-accessible', async ({
    page,
}, testInfo) => {
    // Keep the scheduled retry in the error state so it cannot race the manual retry after the screenshot.
    await installFixture(page, { lobbyBundleFailures: 2, includeStoppedProfile: true });
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto('lobby');
    const row = page.locator('tbody tr').filter({ hasText: 'hwe섭' });
    const retry = row.getByRole('button', { name: '지금 다시 확인' });
    const tableScroll = page.getByTestId('profile-table-scroll');
    await expect(retry).toBeVisible();
    await retry.focus();
    await expect(retry).toBeFocused();
    const geometry = await tableScroll.evaluate((scrollElement) => {
        const rows = [...scrollElement.querySelectorAll('tbody tr')];
        const row = rows[0];
        const button = row?.querySelector('button');
        const serverCell = row?.querySelector('.profile-server-cell');
        const infoCell = row?.querySelector('.profile-info-cell');
        const portraitCell = row?.querySelector('.profile-portrait-cell');
        const generalCell = row?.querySelector('.profile-general-cell');
        const actionCell = row?.querySelector('.profile-action-cell');
        if (!row) throw new Error('expected profile row');
        if (!button) throw new Error('expected profile retry button');
        if (!serverCell || !infoCell || !portraitCell || !generalCell || !actionCell) {
            throw new Error('expected all profile cells');
        }
        const scrollRect = scrollElement.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const style = getComputedStyle(button);
        const bodyStyle = getComputedStyle(scrollElement.querySelector('tbody')!);
        const firstRowStyle = getComputedStyle(rows[0]!);
        const rect = (element: Element) => {
            const value = element.getBoundingClientRect();
            return { top: value.top, right: value.right, bottom: value.bottom, left: value.left, width: value.width };
        };
        return {
            pageScrollWidth: document.documentElement.scrollWidth,
            scroll: {
                left: scrollRect.left,
                right: scrollRect.right,
                clientWidth: scrollElement.clientWidth,
                scrollWidth: scrollElement.scrollWidth,
            },
            row: { left: rowRect.left, right: rowRect.right, width: rowRect.width },
            rows: rows.map((element) => rect(element)),
            button: { left: buttonRect.left, right: buttonRect.right, width: buttonRect.width },
            cells: {
                server: rect(serverCell),
                info: rect(infoCell),
                portrait: rect(portraitCell),
                general: rect(generalCell),
                action: rect(actionCell),
            },
            viewportWidth: window.innerWidth,
            outlineStyle: style.outlineStyle,
            outlineWidth: style.outlineWidth,
            rowGap: bodyStyle.rowGap,
            dividerBackground: bodyStyle.backgroundColor,
            firstRowBorderColor: firstRowStyle.borderBottomColor,
            firstRowBorderWidth: firstRowStyle.borderBottomWidth,
        };
    });
    expect(geometry.pageScrollWidth).toBe(geometry.viewportWidth);
    expect(geometry.scroll.clientWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.scroll.scrollWidth).toBe(geometry.scroll.clientWidth);
    expect(geometry.row.width).toBe(geometry.scroll.clientWidth);
    expect(geometry.rows).toHaveLength(2);
    expect(geometry.rows[0]?.bottom).toBeLessThanOrEqual(geometry.rows[1]?.top ?? 0);
    expect(geometry.rows.every((item) => item.width === geometry.scroll.clientWidth)).toBe(true);
    expect(geometry.rowGap).toBe('2px');
    expect(geometry.dividerBackground).toBe('rgb(63, 63, 70)');
    expect(geometry.firstRowBorderColor).toBe('rgb(82, 82, 91)');
    expect(geometry.firstRowBorderWidth).toBe('1px');
    expect(geometry.button.left).toBeGreaterThanOrEqual(geometry.scroll.left);
    expect(geometry.button.right).toBeLessThanOrEqual(geometry.scroll.right);
    expect(geometry.cells.server.top).toBeCloseTo(geometry.cells.info.top, 0);
    expect(geometry.cells.server.left).toBeCloseTo(geometry.row.left, 0);
    expect(geometry.cells.info.right).toBeCloseTo(geometry.row.right, 0);
    expect(geometry.cells.portrait.top).toBeCloseTo(geometry.cells.general.top, 0);
    expect(geometry.cells.general.top).toBeCloseTo(geometry.cells.action.top, 0);
    expect(geometry.cells.portrait.top).toBeGreaterThanOrEqual(geometry.cells.server.bottom);
    expect(geometry.cells.portrait.left).toBeCloseTo(geometry.row.left, 0);
    expect(geometry.cells.action.right).toBeCloseTo(geometry.row.right, 0);
    expect(geometry.outlineStyle).toBe('solid');
    expect(geometry.outlineWidth).toBe('2px');

    await retry.click();
    await expect(row).toContainText('선택장수');
    await expect(row.getByTestId('profile-info-retrying')).toHaveCount(0);
    const enterButton = row.getByRole('button', { name: '입장' });
    await expect(enterButton).toBeVisible();
    const enterBackground = await enterButton.evaluate((element) => getComputedStyle(element).backgroundColor);
    await enterButton.hover();
    await expect
        .poll(() => enterButton.evaluate((element) => getComputedStyle(element).backgroundColor))
        .not.toBe(enterBackground);
    await page.screenshot({ path: testInfo.outputPath('gateway-profile-two-row-mobile.png'), fullPage: true });

    await page.setViewportSize({ width: 320, height: 700 });
    await expect
        .poll(() =>
            tableScroll.evaluate((element) => ({
                documentWidth: document.documentElement.scrollWidth,
                viewportWidth: window.innerWidth,
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth,
                rowWidth: element.querySelector('tbody tr')?.getBoundingClientRect().width,
            }))
        )
        .toEqual({ documentWidth: 320, viewportWidth: 320, clientWidth: 286, scrollWidth: 286, rowWidth: 286 });

    await page.setViewportSize({ width: 799, height: 900 });
    await expect
        .poll(() =>
            tableScroll.evaluate((element) => ({
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth,
                rowDisplay: getComputedStyle(element.querySelector('tbody tr')!).display,
            }))
        )
        .toEqual({ clientWidth: 765, scrollWidth: 765, rowDisplay: 'grid' });

    await page.setViewportSize({ width: 800, height: 900 });
    await expect
        .poll(() =>
            tableScroll.evaluate((element) => ({
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth,
                rowDisplay: getComputedStyle(element.querySelector('tbody tr')!).display,
            }))
        )
        .toEqual({ clientWidth: 766, scrollWidth: 766, rowDisplay: 'table-row' });
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
    await expect(page.getByText('특수 접근 · OPERATOR')).toHaveCount(0);
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
    await expect(page.getByText('특수 접근 · RECOVERY')).toHaveCount(0);
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
        directGeneralCreationEnabled: false,
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
    await expect(row.getByRole('button', { name: '장수생성' })).toHaveCount(0);
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
