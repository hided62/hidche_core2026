import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalFrontendFixture as fixture } from './fixtures/canonical.js';
import { gameUrl, gatewayUrl } from './testUrls.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const imageRoots = [resolve(repositoryRoot, '../image'), resolve(repositoryRoot, '../../image')];
const artifactRoot = process.env.FRONTEND_PARITY_ARTIFACT_DIR;

const response = (data: unknown) => ({ result: { data } });
const errorResponse = (path: string, message: string) => ({
    error: {
        message,
        code: -32000,
        data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, path },
    },
});

const operationNames = (route: Route): string[] => {
    const pathname = new URL(route.request().url()).pathname;
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const fulfill = async (route: Route, results: unknown[]) => {
    await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(results),
    });
};

const installImages = async (page: Page) => {
    await page.route('**/image/**', async (route) => {
        const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
        const relative = pathname.replace(/^\/image\//, '');
        const candidates = imageRoots.flatMap((root) => [resolve(root, relative), resolve(root, 'game', relative)]);
        for (const candidate of candidates) {
            try {
                const body = await readFile(candidate);
                await route.fulfill({
                    status: 200,
                    contentType: extname(candidate).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg',
                    body,
                });
                return;
            } catch {
                // Worktree 위치에 따라 다음 image root를 확인한다.
            }
        }
        await route.abort('failed');
    });
};

const cachedHistory = [
    { id: 31, text: '<Y>유비</>가 <C>촉</>을 건국하였습니다.' },
    { id: 30, text: '<S>낙양</>에 새로운 소식이 있습니다.' },
];

const frontRecords = {
    global: [
        { id: 51, text: '<Y>관우</>가 장수 동향을 남겼습니다.' },
        { id: 50, text: '<C>조조</>가 이동하였습니다.' },
    ],
    general: [{ id: 41, text: '<L>유비</>의 개인 기록입니다.' }],
    history: cachedHistory,
};

const generalContext = {
    general: {
        id: 1,
        name: '유비',
        npcState: 0,
        nationId: 1,
        cityId: 1,
        troopId: 0,
        picture: null,
        imageServer: 0,
        officerLevel: 1,
        stats: { leadership: 80, strength: 70, intelligence: 75 },
        gold: 1000,
        rice: 1200,
        crew: 500,
        train: 80,
        atmos: 90,
        injury: 0,
        experience: 100,
        dedication: 200,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    city: {
        id: 1,
        name: '낙양',
        level: 7,
        nationId: 1,
        population: 10000,
        agriculture: 100,
        commerce: 100,
        security: 100,
        defence: 100,
        wall: 100,
        supplyState: 1,
        frontState: 0,
    },
    nation: {
        id: 1,
        name: '촉',
        color: '#d32f2f',
        level: 3,
        gold: 10000,
        rice: 12000,
        tech: 500,
        typeCode: 'che_법가',
        capitalCityId: 1,
    },
    settings: {},
    penalties: {},
};

const emptyMessages = {
    private: [],
    public: [],
    national: [],
    diplomacy: [],
    permission: 0,
    latestRead: { private: 0, diplomacy: 0 },
    canRespondDiplomacy: false,
};

const installGatewayMapFixture = async (page: Page) => {
    await installImages(page);
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'me') return response(null);
            if (operation === 'lobby.profiles') return response([fixture.gateway.profile]);
            return response(null);
        });
        await fulfill(route, results);
    });
    await page.route('**/che/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'auth.status') return response({ userId: 'frontend-parity-user' });
            if (operation === 'lobby.info') return response(fixture.game.lobby);
            if (operation === 'public.getMapLayout') return response(fixture.game.mapLayout);
            if (operation === 'public.getCachedMap') {
                return response({ ...fixture.game.map, history: cachedHistory });
            }
            return errorResponse(operation, `Unhandled gateway map operation: ${operation}`);
        });
        await fulfill(route, results);
    });
};

const installMainFixture = async (page: Page, failRecords = false) => {
    await installImages(page);
    await page.addInitScript(
        ({ token, profile }) => {
            window.localStorage.setItem('sammo-game-token', token);
            window.localStorage.setItem('sammo-game-profile', profile);
        },
        { token: fixture.game.session.gameToken, profile: fixture.game.session.profile }
    );
    await page.route('**/che/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'auth.status') return response({ userId: 'frontend-parity-user' });
            if (operation === 'lobby.info') {
                return response({ ...fixture.game.lobby, myGeneral: fixture.game.session.general });
            }
            if (operation === 'general.me') return response(generalContext);
            if (operation === 'world.getMapLayout') return response(fixture.game.mapLayout);
            if (operation === 'world.getMap') {
                return response({
                    ...fixture.game.map,
                    spyList: {},
                    shownByGeneralList: [],
                    myCity: 1,
                    myNation: 1,
                });
            }
            if (operation === 'turns.getCommandTable') return response({ general: [], nation: [] });
            if (operation === 'turns.reserved.getGeneral') return response([]);
            if (operation === 'messages.getRecent') return response(emptyMessages);
            if (operation === 'messages.getContacts') return response([]);
            if (operation === 'board.getAccess') {
                return response({ canMeeting: false, canSecret: false, permission: 0 });
            }
            if (operation === 'general.getRecentRecords') {
                return failRecords
                    ? errorResponse(operation, '동향 정보를 불러오지 못했습니다.')
                    : response(frontRecords);
            }
            if (operation === 'general.getFrontStatus') {
                return response({
                    onlineUserCount: 1,
                    onlineNations: '【재야】',
                    onlineGenerals: '지도 장수',
                    nationNotice: '',
                    lastExecuted: '2026-07-26T00:00:00.000Z',
                    latestVote: null,
                });
            }
            if (operation === 'tournament.getState') return response({ stage: 0 });
            if (operation === 'public.recordAccess') return response({ recorded: true });
            return errorResponse(operation, `Unhandled main operation: ${operation}`);
        });
        await fulfill(route, results);
    });
};

test('shows the representative cached map and cached history before login', async ({ page }) => {
    await installGatewayMapFixture(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(gatewayUrl());

    await expect(page.locator('.map-preview-body')).toBeVisible();
    await expect(page.locator('.status-history')).toContainText('유비가 촉을 건국하였습니다.');
    const historyStyle = await page.locator('.status-history').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { width: rect.width, fontFamily: style.fontFamily, fontSize: style.fontSize };
    });
    expect(historyStyle.width).toBeCloseTo(698, 0);
    expect(historyStyle.fontFamily).toContain('Times New Roman');
    expect(historyStyle.fontSize).toBe('14px');
    await expect(page.locator('.status-history span').first()).toHaveCSS('color', 'rgb(255, 255, 0)');

    if (artifactRoot) {
        await page.screenshot({
            path: resolve(artifactRoot, 'gateway-cached-map-history.png'),
            fullPage: true,
            animations: 'disabled',
        });
    }
});

test('shows the current in-game map and all three recent record streams', async ({ page }) => {
    await installMainFixture(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(gameUrl());

    await expect(page.locator('.map-area')).toBeVisible();
    await expect(page.getByText('관우가 장수 동향을 남겼습니다.')).toBeVisible();
    await expect(page.getByText('유비의 개인 기록입니다.')).toBeVisible();
    await expect(page.getByText('유비가 촉을 건국하였습니다.')).toBeVisible();
    await expect(page.getByText('실시간 스트림으로 연결 예정')).toHaveCount(0);

    const geometry = await page.locator('.map-area').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
    });
    expect(geometry).toEqual({ width: 700, height: 500 });
    await expect(page.locator('[data-record-bucket="global"] .record-line span').first()).toHaveCSS(
        'color',
        'rgb(255, 255, 0)'
    );

    if (artifactRoot) {
        await page.screenshot({
            path: resolve(artifactRoot, 'ingame-map-trends-desktop.png'),
            fullPage: true,
            animations: 'disabled',
        });
    }
});

test('keeps the current map visible when the recent record request fails', async ({ page }) => {
    await installMainFixture(page, true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(gameUrl());

    await expect(page.locator('.map-area')).toBeVisible();
    await expect(page.getByRole('alert').first()).toContainText('동향 정보를 불러오지 못했습니다.');
    await expect(page.getByRole('link', { name: '낙양', exact: true })).toBeVisible();
});

test('shows map and trend tabs in the mobile in-game layout', async ({ page }) => {
    await installMainFixture(page);
    await page.setViewportSize({ width: 500, height: 900 });
    await page.goto(gameUrl());

    await expect(page.locator('.map-area')).toBeVisible();
    const mapGeometry = await page.locator('.map-area').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
    });
    expect(mapGeometry.width).toBe(438);
    expect(mapGeometry.height).toBeCloseTo(312.86, 1);
    expect(mapGeometry.width / mapGeometry.height).toBeCloseTo(7 / 5, 2);

    await page.getByRole('button', { name: '동향', exact: true }).click();
    await expect(page.getByText('관우가 장수 동향을 남겼습니다.')).toBeVisible();
    await expect(page.getByText('유비의 개인 기록입니다.')).toBeVisible();
    await expect(page.getByText('유비가 촉을 건국하였습니다.')).toBeVisible();

    if (artifactRoot) {
        await page.screenshot({
            path: resolve(artifactRoot, 'ingame-map-trends-mobile.png'),
            fullPage: true,
            animations: 'disabled',
        });
    }
});
