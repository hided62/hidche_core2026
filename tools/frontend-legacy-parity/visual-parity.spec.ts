import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalFrontendFixture as fixture } from './fixtures/canonical';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const imageRoot = resolve(repositoryRoot, '../../image');

const response = (data: unknown) => ({ result: { data } });

const operationNames = (route: Route): string[] => {
    const pathname = new URL(route.request().url()).pathname;
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const fulfillOperations = async (route: Route, resolveOperation: (operation: string) => unknown): Promise<void> => {
    await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(operationNames(route).map((operation) => response(resolveOperation(operation)))),
    });
};

const installImages = async (page: Page): Promise<void> => {
    await page.route('**/image/**', async (route) => {
        const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
        const relative = pathname.replace(/^\/image\//, '');
        const candidates = [
            resolve(imageRoot, relative),
            resolve(imageRoot, 'game', relative),
            resolve(imageRoot, 'icons', '22.jpg'),
        ];
        for (const candidate of candidates) {
            try {
                const body = await readFile(candidate);
                const extension = extname(candidate).toLowerCase();
                const contentType = extension === '.png' ? 'image/png' : 'image/jpeg';
                await route.fulfill({ status: 200, contentType, body });
                return;
            } catch {
                // 다음 공개 image root 후보를 확인한다.
            }
        }
        await route.abort('failed');
    });
};

const installGatewayFixture = async (page: Page): Promise<void> => {
    let loggedIn = false;
    await installImages(page);
    await page.route('**/gateway/api/trpc/**', async (route) => {
        await fulfillOperations(route, (operation) => {
            if (operation === 'me') return loggedIn ? fixture.gateway.user : null;
            if (operation === 'lobby.profiles') return [fixture.gateway.profile];
            if (operation === 'lobby.notice') return [];
            if (operation === 'auth.login') {
                loggedIn = true;
                return {
                    user: fixture.gateway.user,
                    sessionToken: fixture.gateway.sessionToken,
                    issuedAt: '2026-07-25T00:00:00.000Z',
                };
            }
            if (operation === 'auth.kakaoStart') {
                return { mode: 'login', state: 'visual-state', authUrl: '/gateway/oauth-started' };
            }
            throw new Error(`Unhandled gateway fixture operation: ${operation}`);
        });
    });
    await page.route('**/che/api/trpc/**', async (route) => {
        await fulfillOperations(route, (operation) => {
            if (operation === 'lobby.info') return fixture.game.lobby;
            if (operation === 'public.getMapLayout') return fixture.game.mapLayout;
            if (operation === 'public.getCachedMap') return fixture.game.map;
            throw new Error(`Unhandled gateway game fixture operation: ${operation}`);
        });
    });
};

const installHallFixture = async (page: Page): Promise<void> => {
    await installImages(page);
    await page.route('**/che/api/trpc/**', async (route) => {
        await fulfillOperations(route, (operation) => {
            if (operation === 'ranking.getHallOfFameOptions') return fixture.game.hallOptions;
            if (operation === 'ranking.getHallOfFame') return fixture.game.hall;
            throw new Error(`Unhandled hall fixture operation: ${operation}`);
        });
    });
};

const installAuthenticatedGameFixture = async (page: Page): Promise<void> => {
    await installImages(page);
    await page.addInitScript(
        ({ gameToken, profile }) => {
            window.localStorage.setItem('sammo-game-token', gameToken);
            window.localStorage.setItem('sammo-game-profile', profile);
        },
        {
            gameToken: fixture.game.session.gameToken,
            profile: fixture.game.session.profile,
        }
    );
    await page.route('**/che/api/trpc/**', async (route) => {
        await fulfillOperations(route, (operation) => {
            if (operation === 'lobby.info') {
                return { ...fixture.game.lobby, myGeneral: fixture.game.session.general };
            }
            if (operation === 'join.getConfig') return {};
            if (operation === 'troop.getList') {
                return {
                    nation: { id: 1, name: '촉' },
                    me: fixture.game.session.general,
                    permission: 0,
                    troops: [],
                };
            }
            throw new Error(`Unhandled authenticated game fixture operation: ${operation}`);
        });
    });
};

test.describe('gateway legacy parity', () => {
    test.beforeEach(async ({ page }) => {
        await installGatewayFixture(page);
    });

    for (const viewport of [
        { name: 'desktop', width: 1365, height: 768 },
        { name: 'mobile', width: 390, height: 844 },
    ]) {
        test(`matches the ref login and status geometry on ${viewport.name}`, async ({ page }) => {
            await page.setViewportSize(viewport);
            const mapImage = page.waitForResponse((response) =>
                response.url().endsWith('/image/game/map/che/bg_fall.jpg')
            );
            await page.goto('http://127.0.0.1:15100/gateway/');
            expect((await mapImage).ok()).toBe(true);
            await expect(page.locator('#login_card')).toBeVisible();
            await expect(page.locator('.map-preview-body')).toBeVisible();
            await expect(page.getByText('지도 이미지 및 현황 데이터 영역')).toHaveCount(0);

            const geometry = await page.evaluate(() => {
                const rect = (selector: string) => {
                    const box = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
                    return { x: box.x, y: box.y, width: box.width, height: box.height };
                };
                const titleStyle = getComputedStyle(document.querySelector<HTMLElement>('.gateway-home h2')!);
                const mapStyle = getComputedStyle(document.querySelector<HTMLElement>('.map-preview-body')!);
                return {
                    title: rect('.gateway-home h2'),
                    login: rect('#login_card'),
                    status: rect('#map-subframe'),
                    titleStyle: {
                        fontFamily: titleStyle.fontFamily,
                        fontSize: titleStyle.fontSize,
                        fontWeight: titleStyle.fontWeight,
                    },
                    mapBackgroundImage: mapStyle.backgroundImage,
                };
            });

            expect(geometry.titleStyle.fontFamily).toContain('Pretendard');
            expect(geometry.titleStyle.fontSize).toBe('20px');
            expect(geometry.titleStyle.fontWeight).toBe('400');
            expect(geometry.login.width).toBeLessThanOrEqual(450);
            expect(geometry.status.width).toBeLessThanOrEqual(700);
            expect(geometry.mapBackgroundImage).toContain('bg_fall.jpg');
            if (viewport.name === 'desktop') {
                expect(geometry.login.width).toBeCloseTo(450, 0);
                expect(geometry.status.width).toBeCloseTo(700, 0);
            } else {
                expect(geometry.login.width).toBeCloseTo(374, 0);
                await expect(page.locator('.navbar-toggler')).toBeVisible();
                await page.locator('.navbar-toggler').click();
                await expect(page.locator('#gateway-navigation')).toHaveClass(/open/);
            }

            const loginButton = page.locator('.login-button');
            const before = await loginButton.evaluate((element) => getComputedStyle(element).backgroundColor);
            await loginButton.hover();
            const hover = await loginButton.evaluate((element) => getComputedStyle(element).backgroundColor);
            await loginButton.focus();
            await expect(loginButton).toBeFocused();
            expect(hover).not.toBe(before);
        });
    }

    test('submits the real login mutation and stores the session', async ({ page }) => {
        await page.goto('http://127.0.0.1:15100/gateway/');
        await page.locator('#username').fill('visual-user');
        await page.locator('#password').fill('visual-password');
        await page.locator('.login-button').click();
        await expect(page).toHaveURL(/\/gateway\/lobby$/);
        await expect
            .poll(() => page.evaluate(() => window.localStorage.getItem('sammo-session-token')))
            .toBe(fixture.gateway.sessionToken);
    });
});

test.describe('hall of fame legacy parity', () => {
    test.beforeEach(async ({ page }) => {
        await installHallFixture(page);
    });

    for (const viewport of [
        { name: 'desktop', width: 1365, height: 768, expectedWidth: 1000 },
        { name: 'mobile', width: 390, height: 844, expectedWidth: 500 },
    ]) {
        test(`matches the ref fixed grid on ${viewport.name}`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await page.goto('http://127.0.0.1:15102/che/hall-of-fame');
            await expect(page.getByText('유비')).toBeVisible();
            await expect(page.locator('.rankView')).toHaveCount(2);

            const geometry = await page.evaluate(() => {
                const container = document.querySelector<HTMLElement>('#container')!;
                const item = document.querySelector<HTMLElement>('.rankView li')!;
                const itemStyle = getComputedStyle(item);
                const titleStyle = getComputedStyle(document.querySelector<HTMLElement>('.rankType')!);
                const image = document.querySelector<HTMLImageElement>('.generalIcon')!;
                return {
                    container: container.getBoundingClientRect().width,
                    containerBackgroundImage: getComputedStyle(container).backgroundImage,
                    item: {
                        width: item.getBoundingClientRect().width,
                        minHeight: itemStyle.minHeight,
                    },
                    title: {
                        fontFamily: titleStyle.fontFamily,
                        fontSize: titleStyle.fontSize,
                        backgroundImage: titleStyle.backgroundImage,
                    },
                    image: {
                        width: image.getBoundingClientRect().width,
                        height: image.getBoundingClientRect().height,
                        naturalWidth: image.naturalWidth,
                        naturalHeight: image.naturalHeight,
                        objectFit: getComputedStyle(image).objectFit,
                    },
                };
            });

            expect(geometry.container).toBe(viewport.expectedWidth);
            expect(geometry.containerBackgroundImage).toContain('back_walnut.jpg');
            expect(geometry.item.width).toBe(100);
            expect(geometry.title.fontFamily).toContain('Pretendard');
            expect(geometry.title.backgroundImage).toContain('back_green.jpg');
            expect(geometry.image).toMatchObject({ width: 64, height: 64, objectFit: 'cover' });
            expect(geometry.image.naturalWidth).toBeGreaterThan(0);

            const close = page.getByRole('button', { name: '창 닫기' }).first();
            await close.hover();
            await close.focus();
            await expect(close).toBeFocused();
        });
    }
});

test('game login delegates to the gateway like the ref entry point', async ({ page }) => {
    await page.goto('http://127.0.0.1:15102/che/login');
    await expect(page).toHaveURL('http://127.0.0.1:15102/gateway/');
});

test('canonical logged-in fixture passes the game route guard', async ({ page }) => {
    await installAuthenticatedGameFixture(page);
    await page.goto('http://127.0.0.1:15102/che/troop');
    await expect(page).toHaveURL(/\/che\/troop$/);
    await expect(page.getByText('부대 편성')).toBeVisible();
});
