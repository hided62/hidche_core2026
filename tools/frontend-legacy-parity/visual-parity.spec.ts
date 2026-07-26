import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalFrontendFixture as fixture } from './fixtures/canonical';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const imageRoot = resolve(repositoryRoot, '../../image');
const artifactRoot = process.env.FRONTEND_PARITY_ARTIFACT_DIR;

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
            if (operation === 'auth.kakaoExchange') {
                return {
                    status: 'join',
                    oauthSessionId: 'oauth-visual-session',
                    email: 'visual@example.test',
                };
            }
            if (operation === 'auth.register') {
                loggedIn = true;
                return {
                    user: fixture.gateway.user,
                    sessionToken: fixture.gateway.sessionToken,
                    issuedAt: '2026-07-25T00:00:00.000Z',
                };
            }
            if (operation === 'account.get') return fixture.gateway.account;
            if (operation === 'account.changePassword') return { ok: true };
            if (operation === 'account.disallowThirdPartyUse') return { ok: true };
            if (operation === 'account.deleteIcon') return { ok: true, iconUrl: null };
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
    let surveyVoted = false;
    const surveyComments = fixture.game.surveyDetail.comments.map((comment) => ({ ...comment }));
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
            if (operation === 'public.getMapLayout') return fixture.game.mapLayout;
            if (operation === 'yearbook.getRange') return fixture.game.yearbookRange;
            if (operation === 'yearbook.getHistory') return fixture.game.yearbook;
            if (operation === 'vote.getVoteList') return fixture.game.surveyList;
            if (operation === 'vote.getVoteDetail') {
                return {
                    ...fixture.game.surveyDetail,
                    votes: surveyVoted
                        ? [
                              { selection: [0], count: 3 },
                              { selection: [1], count: 1 },
                          ]
                        : fixture.game.surveyDetail.votes,
                    comments: surveyComments,
                    myVote: surveyVoted ? [0] : null,
                };
            }
            if (operation === 'vote.submitVote') {
                surveyVoted = true;
                return { ok: true, wonLottery: false };
            }
            if (operation === 'vote.addComment') {
                surveyComments.push({
                    id: surveyComments.length + 1,
                    voteId: 2,
                    generalId: 1,
                    nationId: 1,
                    generalName: '유비',
                    nationName: '촉',
                    text: '새 댓글',
                    createdAt: '2026-07-26T02:34:00.000Z',
                });
                return { ok: true };
            }
            if (operation === 'vote.getAdminStatus') return { ok: false };
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

    test('renders account management at the ref geometry and changes a password', async ({ page }) => {
        await page.addInitScript((token) => {
            window.localStorage.setItem('sammo-session-token', token);
        }, fixture.gateway.sessionToken);
        await page.goto('http://127.0.0.1:15100/gateway/account');
        await expect(page.getByText('시각검증')).toBeVisible();
        if (artifactRoot) {
            await page.screenshot({
                path: resolve(artifactRoot, 'account-core-desktop.png'),
                fullPage: true,
                animations: 'disabled',
            });
        }

        const geometry = await page.locator('#account-container').evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                width: rect.width,
                minHeight: style.minHeight,
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                tableBackground: getComputedStyle(document.querySelector<HTMLElement>('#account-table')!)
                    .backgroundImage,
            };
        });
        expect(geometry).toMatchObject({ width: 550, minHeight: '575px', fontSize: '14px' });
        expect(geometry.fontFamily).toContain('Pretendard');
        expect(geometry.tableBackground).toContain('back_walnut.jpg');

        await page.locator('#current-password').fill('current-password');
        await page.locator('#new-password').fill('next-password');
        await page.locator('#confirm-password').fill('next-password');
        const changeButton = page.getByRole('button', { name: '비밀번호 변경' });
        await changeButton.hover();
        await changeButton.focus();
        await expect(changeButton).toBeFocused();
        await changeButton.click();
        await expect(page.getByRole('status')).toHaveText('비밀번호를 변경했습니다.');
    });

    test('shows the account API error without losing the form', async ({ page }) => {
        await page.addInitScript((token) => {
            window.localStorage.setItem('sammo-session-token', token);
        }, fixture.gateway.sessionToken);
        await page.route('**/gateway/api/trpc/**', async (route) => {
            if (operationNames(route).includes('account.changePassword')) {
                await route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: { message: '현재 비밀번호가 일치하지 않습니다.' } }),
                });
                return;
            }
            await route.fallback();
        });
        await page.goto('http://127.0.0.1:15100/gateway/account');
        await page.locator('#current-password').fill('wrong-password');
        await page.locator('#new-password').fill('next-password');
        await page.locator('#confirm-password').fill('next-password');
        await page.getByRole('button', { name: '비밀번호 변경' }).click();
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(page.locator('#current-password')).toHaveValue('wrong-password');
    });

    test('completes the OAuth registration page and stores the session', async ({ page }) => {
        await page.goto('http://127.0.0.1:15100/gateway/oauth/callback?code=visual-code&state=visual-state');
        await expect(page.getByLabel('카카오 이메일')).toHaveValue('visual@example.test');
        await expect(page.getByRole('link', { name: '내용 확인' }).first()).toHaveAttribute(
            'href',
            '/gateway/terms.1.html'
        );
        await expect(page.getByRole('link', { name: '내용 확인' }).last()).toHaveAttribute(
            'href',
            '/gateway/terms.2.html'
        );
        const geometry = await page.locator('#oauth-container').evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return { width: rect.width, fontFamily: style.fontFamily };
        });
        expect(geometry.width).toBe(700);
        expect(geometry.fontFamily).toContain('Pretendard');
        if (artifactRoot) {
            await page.screenshot({
                path: resolve(artifactRoot, 'oauth-join-core-desktop.png'),
                fullPage: true,
                animations: 'disabled',
            });
        }

        await page.locator('#oauth-username').fill('visual-user');
        await page.locator('#oauth-password').fill('visual-password');
        await page.locator('#oauth-confirm').fill('visual-password');
        await page.locator('#oauth-display-name').fill('시각검증');
        await page.getByLabel('내용 확인 후 동의합니다.').first().check();
        await page.getByLabel('내용 확인 후 동의합니다.').last().check();
        const register = page.getByRole('button', { name: '가입' });
        await register.hover();
        await register.focus();
        await register.click();
        await expect(page).toHaveURL(/\/gateway\/lobby$/);
        await expect
            .poll(() => page.evaluate(() => window.localStorage.getItem('sammo-session-token')))
            .toBe(fixture.gateway.sessionToken);
    });

    test('keeps OAuth registration input after an API error', async ({ page }) => {
        await page.route('**/gateway/api/trpc/**', async (route) => {
            if (operationNames(route).includes('auth.register')) {
                await route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: { message: '이미 사용 중인 계정명입니다.' } }),
                });
                return;
            }
            await route.fallback();
        });
        await page.goto('http://127.0.0.1:15100/gateway/oauth/callback?code=visual-code&state=visual-state');
        await page.locator('#oauth-username').fill('duplicate-user');
        await page.locator('#oauth-password').fill('visual-password');
        await page.locator('#oauth-confirm').fill('visual-password');
        await page.locator('#oauth-display-name').fill('시각검증');
        await page.getByLabel('내용 확인 후 동의합니다.').first().check();
        await page.getByLabel('내용 확인 후 동의합니다.').last().check();
        await page.getByRole('button', { name: '가입' }).click();
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(page.locator('#oauth-username')).toHaveValue('duplicate-user');
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

test.describe('yearbook legacy parity', () => {
    test.beforeEach(async ({ page }) => {
        await installAuthenticatedGameFixture(page);
    });

    for (const viewport of [
        { name: 'desktop', width: 1365, height: 768, containerWidth: 1000, mapWidth: 700 },
        { name: 'mobile', width: 390, height: 844, containerWidth: 500, mapWidth: 498 },
    ]) {
        test(`renders the ref yearbook grid on ${viewport.name}`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await page.goto('http://127.0.0.1:15102/che/yearbook');
            await expect(page.getByText('한이 낙양을 지키고 있습니다.')).toBeVisible();
            if (artifactRoot) {
                await page.screenshot({
                    path: resolve(artifactRoot, `yearbook-core-${viewport.name}.png`),
                    fullPage: true,
                    animations: 'disabled',
                });
            }

            const geometry = await page.evaluate(() => {
                const rect = (selector: string) =>
                    document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
                const container = document.querySelector<HTMLElement>('#yearbook-container')!;
                return {
                    containerWidth: rect('#yearbook-container').width,
                    mapWidth: rect('.map-position').width,
                    nationWidth: rect('.nation-position').width,
                    fontFamily: getComputedStyle(container).fontFamily,
                    fontSize: getComputedStyle(container).fontSize,
                    backgroundImage: getComputedStyle(container).backgroundImage,
                };
            });
            expect(geometry.containerWidth).toBe(viewport.containerWidth);
            expect(geometry.mapWidth).toBe(viewport.mapWidth);
            expect(geometry.fontFamily).toContain('Pretendard');
            expect(geometry.fontSize).toBe('14px');
            expect(geometry.backgroundImage).toContain('back_walnut.jpg');
            if (viewport.name === 'desktop') {
                expect(geometry.nationWidth).toBe(300);
            } else {
                expect(geometry.nationWidth).toBe(498);
            }

            const previous = page.getByRole('button', { name: '◀ 이전달' });
            await previous.hover();
            await previous.focus();
            await expect(previous).toBeFocused();
            await expect(page.getByRole('button', { name: '다음달 ▶' })).toBeDisabled();
        });
    }

    test('shows the history API error while keeping month navigation available', async ({ page }) => {
        await page.route('**/che/api/trpc/**', async (route) => {
            if (operationNames(route).includes('yearbook.getHistory')) {
                await route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: { message: '연감 데이터를 찾을 수 없습니다.' } }),
                });
                return;
            }
            await route.fallback();
        });
        await page.goto('http://127.0.0.1:15102/che/yearbook');
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(page.getByLabel('연월 선택')).toBeVisible();
    });
});

test.describe('survey legacy parity', () => {
    test.beforeEach(async ({ page }) => {
        await installAuthenticatedGameFixture(page);
    });

    for (const viewport of [
        { name: 'desktop', width: 1365, height: 768, containerWidth: 1000, commentNameWidth: 260 },
        { name: 'mobile', width: 390, height: 844, containerWidth: 500, commentNameWidth: 130 },
    ]) {
        test(`renders the ref vote tables on ${viewport.name}`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await page.goto('http://127.0.0.1:15102/che/survey');
            await expect(page.getByText('설문 조사(90금과 추첨으로 유니크템 증정!)')).toBeVisible();
            await expect(page.getByText('기병이 좋습니다.')).toBeVisible();
            await expect(page.locator('#vote-new-panel')).toHaveCount(0);
            if (artifactRoot) {
                await page.screenshot({
                    path: resolve(artifactRoot, `survey-core-${viewport.name}.png`),
                    fullPage: true,
                    animations: 'disabled',
                });
            }

            const geometry = await page.evaluate(() => {
                const rect = (selector: string) =>
                    document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
                const container = document.querySelector<HTMLElement>('#container')!;
                const title = document.querySelector<HTMLElement>('#vote-title')!;
                return {
                    containerWidth: rect('#container').width,
                    containerHeight: rect('#container').height,
                    resultWidth: rect('#vote-result').width,
                    commentNameWidth: rect('#vote-comment .comment-name').width,
                    fontFamily: getComputedStyle(container).fontFamily,
                    fontSize: getComputedStyle(container).fontSize,
                    backgroundImage: getComputedStyle(container).backgroundImage,
                    title: {
                        height: rect('#vote-title').height,
                        fontSize: getComputedStyle(title).fontSize,
                        backgroundImage: getComputedStyle(title).backgroundImage,
                    },
                };
            });

            expect(geometry.containerWidth).toBe(viewport.containerWidth);
            expect(geometry.containerHeight).toBeLessThan(viewport.height);
            expect(geometry.resultWidth).toBe(viewport.containerWidth);
            expect(geometry.commentNameWidth).toBe(viewport.commentNameWidth);
            expect(geometry.fontFamily).toContain('Pretendard');
            expect(geometry.fontSize).toBe('14px');
            expect(geometry.backgroundImage).toContain('back_walnut.jpg');
            expect(geometry.title.height).toBeCloseTo(37.8, 0);
            expect(geometry.title.fontSize).toBe('25.2px');
            expect(geometry.title.backgroundImage).toContain('back_blue.jpg');

            const secondOption = page.locator('#v-vote-1');
            await secondOption.check();
            await expect(secondOption).toBeChecked();
            await secondOption.focus();
            await expect(secondOption).toBeFocused();

            const voteButton = page.getByRole('button', { name: '투표', exact: true });
            const beforeHover = await voteButton.evaluate((element) => getComputedStyle(element).filter);
            await voteButton.hover();
            const afterHover = await voteButton.evaluate((element) => getComputedStyle(element).filter);
            expect(afterHover).not.toBe(beforeHover);
        });
    }

    test('submits a vote and comment through the real screen controls', async ({ page }) => {
        await page.goto('http://127.0.0.1:15102/che/survey');
        await page.getByRole('button', { name: '투표', exact: true }).click();
        await expect(page.getByRole('status')).toHaveText('설문을 마쳤습니다.');
        await expect(page.getByText('결산', { exact: true })).toBeVisible();

        await page.getByLabel('댓글').fill('새 댓글');
        await page.getByRole('button', { name: '댓글 달기' }).click();
        await expect(page.getByText('새 댓글')).toBeVisible();
    });

    test('keeps the selected option after a vote API error', async ({ page }) => {
        await page.route('**/che/api/trpc/**', async (route) => {
            if (operationNames(route).includes('vote.submitVote')) {
                await route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: { message: '이미 설문조사를 완료하였습니다.' } }),
                });
                return;
            }
            await route.fallback();
        });
        await page.goto('http://127.0.0.1:15102/che/survey');
        const secondOption = page.locator('#v-vote-1');
        await secondOption.check();
        await page.getByRole('button', { name: '투표', exact: true }).click();
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(secondOption).toBeChecked();
    });
});
