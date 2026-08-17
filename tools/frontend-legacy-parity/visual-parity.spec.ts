import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';

import { canonicalFrontendFixture as fixture } from './fixtures/canonical.js';
import { gameOrigin, gameUrl, gatewayUrl } from './testUrls.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const imageRoots = [
    ...(process.env.FRONTEND_PARITY_IMAGE_ROOT ? [resolve(process.env.FRONTEND_PARITY_IMAGE_ROOT)] : []),
    resolve(repositoryRoot, '../image'),
    resolve(repositoryRoot, '../../image'),
];
const artifactRoot = process.env.FRONTEND_PARITY_ARTIFACT_DIR;
const passwordPublicKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001,
})
    .publicKey.export({ format: 'pem', type: 'spki' })
    .toString();

const response = (data: unknown) => ({ result: { data } });

const operationNames = (route: Route): string[] => {
    const pathname = new URL(route.request().url()).pathname;
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const operationInputs = (route: Route): unknown[] => {
    const request = route.request();
    const encoded = new URL(request.url()).searchParams.get('input');
    let body: unknown = null;
    try {
        body = encoded ? JSON.parse(encoded) : request.postDataJSON();
    } catch {
        return [];
    }
    if (!body || typeof body !== 'object') return [];
    return operationNames(route).map((_, index) => {
        const entry = (body as Record<string, unknown>)[String(index)];
        if (!entry || typeof entry !== 'object') return undefined;
        return (entry as { json?: unknown }).json ?? entry;
    });
};

const fulfillOperations = async (
    route: Route,
    resolveOperation: (operation: string, input: unknown) => unknown
): Promise<void> => {
    const inputs = operationInputs(route);
    await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
            operationNames(route).map((operation, index) => response(resolveOperation(operation, inputs[index])))
        ),
    });
};

const installImages = async (page: Page): Promise<void> => {
    await page.route('**/image/**', async (route) => {
        const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
        const relative = pathname.replace(/^\/image\//, '');
        const candidates = imageRoots.flatMap((imageRoot) => [
            resolve(imageRoot, relative),
            resolve(imageRoot, 'game', relative),
            resolve(imageRoot, 'icons', '22.jpg'),
        ]);
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
    let localPending = false;
    await installImages(page);
    await page.route('**/gateway/api/trpc/**', async (route) => {
        await fulfillOperations(route, (operation, input) => {
            if (operation === 'me') {
                return loggedIn
                    ? {
                          ...fixture.gateway.user,
                          kakaoVerified: !localPending,
                          kakaoGraceStartedAt: '2026-07-25T00:00:00.000Z',
                      }
                    : null;
            }
            if (operation === 'lobby.profiles') {
                if (!localPending) {
                    return [{ ...fixture.gateway.profile, localAccountPolicy: null }];
                }
                return [
                    {
                        ...fixture.gateway.profile,
                        localAccountPolicy: {
                            requiresKakaoVerification: true,
                            kakaoVerified: false,
                            accessAllowed: true,
                            canCreateGeneral: false,
                            graceEndsAt: '2026-08-01T00:00:00.000Z',
                            generalCreationGraceDays: 0,
                            accessGraceDays: 7,
                        },
                    },
                    {
                        ...fixture.gateway.profile,
                        profileName: 'hwe:2',
                        profile: 'hwe',
                        korName: '훼',
                        localAccountPolicy: {
                            requiresKakaoVerification: true,
                            kakaoVerified: false,
                            accessAllowed: true,
                            canCreateGeneral: true,
                            graceEndsAt: '2026-08-01T00:00:00.000Z',
                            generalCreationGraceDays: 7,
                            accessGraceDays: 7,
                        },
                    },
                ];
            }
            if (operation === 'lobby.notice') return [];
            if (operation === 'auth.passwordKey') {
                return {
                    keyId: 'visual-key',
                    algorithm: 'RSA-OAEP-256',
                    publicKeyPem: passwordPublicKey,
                };
            }
            if (operation === 'auth.login') {
                loggedIn = true;
                localPending = false;
                return {
                    user: fixture.gateway.user,
                    sessionToken: fixture.gateway.sessionToken,
                    issuedAt: '2026-07-25T00:00:00.000Z',
                };
            }
            if (operation === 'auth.kakaoStart') {
                return { mode: 'login', state: 'visual-state', authUrl: '/gateway/oauth-started' };
            }
            if (operation === 'auth.checkRegistrationField') {
                const fieldInput = input as { field?: string; value?: string } | undefined;
                return {
                    available: true,
                    normalizedValue:
                        fieldInput?.field === 'username' ? fieldInput.value?.toLowerCase() : fieldInput?.value,
                    message: '사용할 수 있습니다.',
                };
            }
            if (operation === 'auth.registerLocal') {
                loggedIn = true;
                localPending = true;
                return {
                    user: {
                        ...fixture.gateway.user,
                        username: 'visual-local',
                        displayName: '시각가입',
                        kakaoVerified: false,
                        kakaoGraceStartedAt: '2026-07-25T00:00:00.000Z',
                    },
                    sessionToken: fixture.gateway.sessionToken,
                    issuedAt: '2026-07-25T00:00:00.000Z',
                    requiresKakaoVerification: true,
                };
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
    await page.route('**/hwe/api/trpc/**', async (route) => {
        await fulfillOperations(route, (operation) => {
            if (operation === 'lobby.info') return fixture.game.lobby;
            if (operation === 'public.getMapLayout') return fixture.game.mapLayout;
            if (operation === 'public.getCachedMap') return fixture.game.map;
            throw new Error(`Unhandled gateway HWE fixture operation: ${operation}`);
        });
    });
};

type HallFixtureCalls = {
    options: number;
    hallInputs: unknown[];
};

const installHallFixture = async (page: Page): Promise<HallFixtureCalls> => {
    const calls: HallFixtureCalls = {
        options: 0,
        hallInputs: [],
    };
    await installImages(page);
    await page.route('**/che/api/trpc/**', async (route) => {
        await fulfillOperations(route, (operation, input) => {
            if (operation === 'ranking.getHallOfFameOptions') {
                calls.options += 1;
                return fixture.game.hallOptions;
            }
            if (operation === 'ranking.getHallOfFame') {
                calls.hallInputs.push(input);
                return fixture.game.hall;
            }
            throw new Error(`Unhandled hall fixture operation: ${operation}`);
        });
    });
    return calls;
};

const installAuthenticatedGameFixture = async (page: Page): Promise<void> => {
    let surveyVoted = false;
    const surveyComments: Array<{
        id: number;
        voteId: number;
        generalId: number;
        nationId: number;
        generalName: string;
        nationName: string;
        text: string;
        createdAt: string;
    }> = fixture.game.surveyDetail.comments.map((comment) => ({ ...comment }));
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
            if (operation === 'auth.status') return { userId: 'frontend-legacy-fixture-user' };
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
            if (operation === 'ranking.getBestGeneral') return fixture.game.bestGeneral;
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
            if (operation === 'public.recordAccess') return { recorded: true };
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
            await page.goto(gatewayUrl());
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
        await page.goto(gatewayUrl());
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
        await page.goto(gatewayUrl('/account'));
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
        await page.goto(gatewayUrl('/account'));
        await page.locator('#current-password').fill('wrong-password');
        await page.locator('#new-password').fill('next-password');
        await page.locator('#confirm-password').fill('next-password');
        await page.getByRole('button', { name: '비밀번호 변경' }).click();
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(page.locator('#current-password')).toHaveValue('wrong-password');
    });

    test('completes the OAuth registration page and stores the session', async ({ page }) => {
        await page.goto(gatewayUrl('/oauth/callback?code=visual-code&state=visual-state'));
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
        await page.goto(gatewayUrl('/oauth/callback?code=visual-code&state=visual-state'));
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

    for (const viewport of [
        { name: 'desktop', width: 1365, height: 900 },
        { name: 'mobile', width: 390, height: 844 },
    ]) {
        test(`renders the local signup form at ref-compatible geometry on ${viewport.name}`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await page.goto(gatewayUrl('/signup'));
            await expect(page.getByRole('heading', { name: '회원가입' })).toBeVisible();
            await expect(page.locator('iframe[title="이용 약관"]')).toBeVisible();
            await expect(page.locator('iframe[title="개인정보 제공 및 이용 동의"]')).toBeVisible();

            const geometry = await page.locator('#signup-container').evaluate((element) => {
                const box = element.getBoundingClientRect();
                const card = document.querySelector<HTMLElement>('.signup-card')!.getBoundingClientRect();
                const style = getComputedStyle(element);
                const terms = document.querySelector<HTMLElement>('.terms')!.getBoundingClientRect();
                return {
                    width: box.width,
                    cardWidth: card.width,
                    termsHeight: terms.height,
                    fontFamily: style.fontFamily,
                };
            });

            expect(geometry.fontFamily).toContain('Pretendard');
            expect(geometry.termsHeight).toBe(200);
            if (viewport.name === 'desktop') {
                expect(geometry.width).toBe(1140);
                expect(geometry.cardWidth).toBe(1116);
            } else {
                expect(geometry.width).toBe(390);
                expect(geometry.cardWidth).toBe(366);
            }
        });
    }

    test('registers locally with an encrypted password and shows profile-specific Kakao gates', async ({ page }) => {
        let registrationBody = '';
        await page.route('**/gateway/api/trpc/**', async (route) => {
            if (operationNames(route).includes('auth.registerLocal')) {
                registrationBody = route.request().postData() ?? '';
            }
            await route.fallback();
        });
        await page.goto(gatewayUrl('/signup'));
        await page.locator('#signup-username').fill('VISUAL-LOCAL');
        await page.locator('#signup-password').fill('visual-password');
        await page.locator('#signup-confirm-password').fill('visual-password');
        await page.locator('#signup-display-name').fill('시각가입');
        const agreements = page.getByLabel('동의합니다.');
        await agreements.nth(0).check();
        await agreements.nth(1).check();

        const register = page.getByRole('button', { name: '가입', exact: true });
        const before = await register.evaluate((element) => getComputedStyle(element).backgroundColor);
        await register.hover();
        const hover = await register.evaluate((element) => getComputedStyle(element).backgroundColor);
        await register.focus();
        await expect(register).toBeFocused();
        expect(hover).not.toBe(before);
        await register.click();

        await expect(page).toHaveURL(/\/gateway\/lobby\?welcome=local$/);
        await expect(page.locator('#kakao-verification-banner')).toBeVisible();
        expect(registrationBody).toContain('ciphertext');
        expect(registrationBody).not.toContain('visual-password');
        await expect
            .poll(() => page.evaluate(() => window.localStorage.getItem('sammo-session-token')))
            .toBe(fixture.gateway.sessionToken);

        const cheRow = page.locator('tbody tr').filter({ hasText: '체섭' }).first();
        const hweRow = page.locator('tbody tr').filter({ hasText: '훼섭' }).first();
        await expect(cheRow.getByRole('button', { name: '인증 필요' })).toBeDisabled();
        await expect(hweRow.getByRole('button', { name: '장수생성' })).toBeEnabled();

        if (artifactRoot) {
            await page.screenshot({
                path: resolve(artifactRoot, 'local-signup-profile-policy.png'),
                fullPage: true,
                animations: 'disabled',
            });
        }
    });

    test('keeps local signup input after a registration API error', async ({ page }) => {
        await page.route('**/gateway/api/trpc/**', async (route) => {
            if (operationNames(route).includes('auth.registerLocal')) {
                await route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: { message: '이미 사용중인 계정명입니다.' } }),
                });
                return;
            }
            await route.fallback();
        });
        await page.goto(gatewayUrl('/signup'));
        await page.locator('#signup-username').fill('duplicate-local');
        await page.locator('#signup-password').fill('visual-password');
        await page.locator('#signup-confirm-password').fill('visual-password');
        await page.locator('#signup-display-name').fill('중복가입');
        const agreements = page.getByLabel('동의합니다.');
        await agreements.nth(0).check();
        await agreements.nth(1).check();
        await page.getByRole('button', { name: '가입', exact: true }).click();

        await expect(page.getByRole('alert')).toBeVisible();
        await expect(page.locator('#signup-username')).toHaveValue('duplicate-local');
        await expect(page.locator('#signup-password')).toHaveValue('visual-password');
        await expect(page.locator('#signup-display-name')).toHaveValue('중복가입');
    });
});

test.describe('best general legacy parity', () => {
    test.beforeEach(async ({ page }) => {
        await installAuthenticatedGameFixture(page);
    });

    for (const viewport of [
        { name: 'desktop', width: 1365, height: 768, expectedWidth: 1000 },
        { name: 'mobile', width: 390, height: 844, expectedWidth: 500 },
    ]) {
        test(`matches the ref fixed ranking grid on ${viewport.name}`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await page.goto(gameUrl('/best-general'));
            await expect(page.getByText('유비').first()).toBeVisible();
            await expect(page.locator('.rankView')).toHaveCount(3);
            if (artifactRoot) {
                await page.screenshot({
                    path: resolve(artifactRoot, `best-general-core-${viewport.name}.png`),
                    fullPage: true,
                    animations: 'disabled',
                });
            }

            const geometry = await page.evaluate(() => {
                const container = document.querySelector<HTMLElement>('#best-general-container')!;
                const item = document.querySelector<HTMLElement>('.rankView li')!;
                const uniqueItem = document.querySelector<HTMLElement>('.rankView li.no-value')!;
                const title = document.querySelector<HTMLElement>('.rankType')!;
                const image = document.querySelector<HTMLImageElement>('.generalIcon')!;
                return {
                    container: {
                        x: container.getBoundingClientRect().x,
                        width: container.getBoundingClientRect().width,
                        fontFamily: getComputedStyle(container).fontFamily,
                        fontSize: getComputedStyle(container).fontSize,
                        backgroundImage: getComputedStyle(container).backgroundImage,
                    },
                    item: {
                        width: item.getBoundingClientRect().width,
                        minHeight: getComputedStyle(item).minHeight,
                    },
                    uniqueItem: {
                        minHeight: getComputedStyle(uniqueItem).minHeight,
                    },
                    title: {
                        fontSize: getComputedStyle(title).fontSize,
                        lineHeight: getComputedStyle(title).lineHeight,
                        backgroundImage: getComputedStyle(title).backgroundImage,
                    },
                    image: {
                        width: image.getBoundingClientRect().width,
                        height: image.getBoundingClientRect().height,
                        naturalWidth: image.naturalWidth,
                        objectFit: getComputedStyle(image).objectFit,
                    },
                    closeX: document
                        .querySelector<HTMLElement>('.legacy-ranking-title .legacy-button')!
                        .getBoundingClientRect().x,
                };
            });

            expect(geometry.container.width).toBe(viewport.expectedWidth);
            expect(geometry.container.fontFamily).toContain('Pretendard');
            expect(geometry.container.fontSize).toBe('14px');
            expect(geometry.container.backgroundImage).toContain('back_walnut.jpg');
            expect(geometry.closeX).toBe(geometry.container.x);
            expect(geometry.item).toEqual({ width: 100, minHeight: '149px' });
            expect(geometry.uniqueItem.minHeight).toBe('128px');
            expect(geometry.title).toMatchObject({
                fontSize: viewport.name === 'desktop' ? '28px' : '22.06px',
                lineHeight: viewport.name === 'desktop' ? '33.6px' : '26.472px',
            });
            expect(geometry.title.backgroundImage).toContain('back_green.jpg');
            expect(geometry.image).toMatchObject({ width: 64, height: 64, objectFit: 'fill' });
            expect(geometry.image.naturalWidth).toBeGreaterThan(0);

            const npcButton = page.getByRole('button', { name: 'NPC 보기' });
            const npcButtonBox = await npcButton.boundingBox();
            expect(npcButtonBox).not.toBeNull();
            await page.mouse.move(
                npcButtonBox!.x + npcButtonBox!.width / 2,
                npcButtonBox!.y + npcButtonBox!.height / 2
            );
            await page.mouse.down();
            await expect(npcButton).toHaveCSS('background-color', 'rgb(107, 107, 107)');
            if (artifactRoot) {
                await npcButton.screenshot({
                    path: resolve(artifactRoot, `best-general-active-${viewport.name}.png`),
                    animations: 'disabled',
                });
            }
            await page.mouse.up();
            await npcButton.evaluate((element) => element.blur());
            await page.mouse.move(0, 0);
            await expect(npcButton).toHaveCSS('background-color', 'rgb(55, 90, 127)');
            await npcButton.hover();
            await expect(npcButton).toHaveCSS('background-color', 'rgb(107, 107, 107)');
            await npcButton.focus();
            await expect(npcButton).toBeFocused();
            await npcButton.click();
            await expect(npcButton).toHaveAttribute('aria-pressed', 'true');

            const itemName = page.locator('.item-name').first();
            await itemName.hover();
            await expect(itemName).toHaveAttribute('title', '최고의 명마');
        });
    }

    test('keeps the current ranking and selected user type after an API error', async ({ page }) => {
        await page.goto(gameUrl('/best-general'));
        await expect(page.getByText('유비').first()).toBeVisible();
        await page.route('**/che/api/trpc/**', async (route) => {
            if (operationNames(route).includes('ranking.getBestGeneral')) {
                await route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: { message: '명장일람 조회에 실패했습니다.' } }),
                });
                return;
            }
            await route.fallback();
        });
        const npcButton = page.getByRole('button', { name: 'NPC 보기' });
        await npcButton.click();
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(page.getByText('유비').first()).toBeVisible();
        await expect(npcButton).toHaveAttribute('aria-pressed', 'true');
    });
});

test.describe('hall of fame legacy parity', () => {
    let hallCalls: HallFixtureCalls;

    test.beforeEach(async ({ page }) => {
        hallCalls = await installHallFixture(page);
    });

    for (const viewport of [
        { name: 'desktop', width: 1365, height: 768, expectedWidth: 1000 },
        { name: 'mobile', width: 390, height: 844, expectedWidth: 500 },
    ]) {
        test(`matches the ref fixed grid on ${viewport.name}`, async ({ page }) => {
            await page.setViewportSize(viewport);
            await page.goto(gameUrl('/hall-of-fame'));
            await expect(page.getByText('유비')).toBeVisible();
            await expect.poll(() => hallCalls.options).toBe(1);
            await expect.poll(() => hallCalls.hallInputs.length).toBe(1);
            expect(hallCalls.hallInputs[0]).toEqual({ season: 1 });
            await expect(page.locator('.rankView')).toHaveCount(2);
            if (artifactRoot) {
                await page.screenshot({
                    path: resolve(artifactRoot, `hall-of-fame-core-${viewport.name}.png`),
                    fullPage: true,
                    animations: 'disabled',
                });
            }

            const geometry = await page.evaluate(() => {
                const container = document.querySelector<HTMLElement>('#container')!;
                const item = document.querySelector<HTMLElement>('.rankView li')!;
                const itemStyle = getComputedStyle(item);
                const titleStyle = getComputedStyle(document.querySelector<HTMLElement>('.rankType')!);
                const image = document.querySelector<HTMLImageElement>('.generalIcon')!;
                return {
                    container: {
                        x: container.getBoundingClientRect().x,
                        width: container.getBoundingClientRect().width,
                    },
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
                    closeX: document
                        .querySelector<HTMLElement>('.legacy-hall-title .legacy-button')!
                        .getBoundingClientRect().x,
                };
            });

            expect(geometry.container.width).toBe(viewport.expectedWidth);
            expect(geometry.closeX).toBe(geometry.container.x);
            expect(geometry.containerBackgroundImage).toContain('back_walnut.jpg');
            expect(geometry.item.width).toBe(100);
            expect(geometry.title.fontFamily).toContain('Pretendard');
            expect(geometry.title.fontSize).toBe(viewport.name === 'desktop' ? '28px' : '22.06px');
            expect(geometry.title.backgroundImage).toContain('back_green.jpg');
            expect(geometry.image).toMatchObject({ width: 64, height: 64, objectFit: 'fill' });
            expect(geometry.image.naturalWidth).toBeGreaterThan(0);

            const close = page.getByRole('button', { name: '창 닫기' }).first();
            await close.hover();
            await expect(close).toHaveCSS('background-color', 'rgb(107, 107, 107)');
            await close.focus();
            await expect(close).toBeFocused();

            const scenario = page.getByLabel('시나리오 검색');
            await expect(scenario).toHaveCSS('width', '189px');
            await scenario.focus();
            await expect(scenario).toBeFocused();
            await scenario.selectOption('scenario:1:22');
            await expect(scenario).toHaveValue('scenario:1:22');
            await expect.poll(() => hallCalls.hallInputs.length).toBe(2);
            expect(hallCalls.hallInputs[1]).toEqual({ season: 1, scenario: 22 });
            expect(hallCalls.options).toBe(1);
        });
    }

    test('keeps the selected scenario after a hall API error', async ({ page }) => {
        await page.goto(gameUrl('/hall-of-fame'));
        await expect(page.getByText('유비')).toBeVisible();
        let failedHallRequests = 0;
        await page.route('**/che/api/trpc/**', async (route) => {
            if (operationNames(route).includes('ranking.getHallOfFame')) {
                failedHallRequests += 1;
                await route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: { message: '명예의 전당 조회에 실패했습니다.' } }),
                });
                return;
            }
            await route.fallback();
        });
        const scenario = page.getByLabel('시나리오 검색');
        await scenario.selectOption('scenario:1:22');
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(scenario).toHaveValue('scenario:1:22');
        await expect(page.getByText('유비')).toBeVisible();
        await expect.poll(() => failedHallRequests).toBe(1);
        await page.waitForTimeout(250);
        expect(failedHallRequests).toBe(1);
    });
});

test('game login delegates to the gateway like the ref entry point', async ({ page }) => {
    await page.goto(gameUrl('/login'));
    await expect(page).toHaveURL(`${gameOrigin}/gateway/`);
});

test('canonical logged-in fixture passes the game route guard', async ({ page }) => {
    await installAuthenticatedGameFixture(page);
    await page.goto(gameUrl('/troop'));
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
            await page.goto(gameUrl('/yearbook'));
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

    for (const viewport of [
        { name: 'desktop', width: 1365, height: 768, minimumWorldHeight: 128 },
        { name: 'mobile', width: 390, height: 844, minimumWorldHeight: 149 },
    ]) {
        test(`grows record blocks with long content on ${viewport.name}`, async ({ page }) => {
            const longWorldHistory = Array.from(
                { length: 12 },
                (_, index) => `<C>●</> 중원 정세 긴 기록 ${index + 1}번째 줄입니다.`
            );
            const longGlobalAction = Array.from(
                { length: 8 },
                (_, index) => `<L>●</> 장수 동향 긴 기록 ${index + 1}번째 줄입니다.`
            );
            await page.route('**/che/api/trpc/**', async (route) => {
                if (!operationNames(route).includes('yearbook.getHistory')) {
                    await route.fallback();
                    return;
                }
                await fulfillOperations(route, () => ({
                    ...fixture.game.yearbook,
                    data: {
                        ...fixture.game.yearbook.data,
                        globalHistory: longWorldHistory,
                        globalAction: longGlobalAction,
                    },
                }));
            });

            await page.setViewportSize(viewport);
            await page.goto(gameUrl('/yearbook'));
            await expect(page.getByText('중원 정세 긴 기록 12번째 줄입니다.')).toBeVisible();
            await expect(page.getByText('장수 동향 긴 기록 8번째 줄입니다.')).toBeVisible();
            if (artifactRoot) {
                await page.screenshot({
                    path: resolve(artifactRoot, `yearbook-long-content-${viewport.name}.png`),
                    fullPage: true,
                    animations: 'disabled',
                });
            }

            const geometry = await page.locator('.history-log').evaluateAll((blocks) =>
                blocks.map((block) => {
                    const element = block as HTMLElement;
                    return {
                        height: element.getBoundingClientRect().height,
                        clientHeight: element.clientHeight,
                        scrollHeight: element.scrollHeight,
                    };
                })
            );
            expect(geometry[0]?.height).toBeGreaterThan(viewport.minimumWorldHeight);
            expect(geometry[1]?.height).toBeGreaterThan(65);
            expect(geometry[0]?.clientHeight).toBe(geometry[0]?.scrollHeight);
            expect(geometry[1]?.clientHeight).toBe(geometry[1]?.scrollHeight);
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
        await page.goto(gameUrl('/yearbook'));
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(page.getByLabel('연월 선택')).toBeVisible();
    });

    test('keeps the rendered yearbook in place while moving between months', async ({ page }) => {
        await page.goto(gameUrl('/yearbook'));
        await expect(page.getByText('한이 낙양을 지키고 있습니다.')).toBeVisible();

        let releaseHistory: (() => void) | undefined;
        const historyReleased = new Promise<void>((resolve) => {
            releaseHistory = resolve;
        });
        let markHistoryRequested: (() => void) | undefined;
        const historyRequested = new Promise<void>((resolve) => {
            markHistoryRequested = resolve;
        });
        await page.route('**/che/api/trpc/**', async (route) => {
            if (!operationNames(route).includes('yearbook.getHistory')) {
                await route.fallback();
                return;
            }
            markHistoryRequested?.();
            await historyReleased;
            await fulfillOperations(route, () => ({
                notModified: false,
                hash: 'yearbook-previous-month-hash',
                data: {
                    ...fixture.game.yearbook.data,
                    year: 197,
                    month: 6,
                    map: {
                        ...fixture.game.yearbook.data.map,
                        year: 197,
                        month: 6,
                    },
                    nations: fixture.game.yearbook.data.nations.map((nation, index) => ({
                        ...nation,
                        generalCount: index === 0 ? 12 : 8,
                    })),
                    globalHistory: ['<C>●</> 이전 달의 중원 정세입니다.'],
                    globalAction: ['<L>●</> 이전 달의 장수 동향입니다.'],
                },
            }));
        });

        await page.evaluate(() => {
            const grid = document.querySelector<HTMLElement>('.history-grid')!;
            const transition = {
                grid,
                mapBody: document.querySelector<HTMLElement>('.map-body')!,
                nationBody: document.querySelector<HTMLElement>('.nation-position tbody')!,
                removedNodes: 0,
            };
            new MutationObserver((records) => {
                transition.removedNodes += records.reduce((count, record) => count + record.removedNodes.length, 0);
            }).observe(grid, { childList: true, subtree: true });
            (window as unknown as { __yearbookTransition: typeof transition }).__yearbookTransition = transition;
        });

        await page.getByRole('button', { name: '◀ 이전달' }).click();
        await historyRequested;

        await expect(page.locator('.history-grid')).toHaveAttribute('aria-busy', 'true');
        await expect(page.locator('.map-body')).toHaveCount(1);
        await expect(page.locator('.map-viewer .skeleton-lines')).toHaveCount(0);
        await expect(page.getByText('한이 낙양을 지키고 있습니다.')).toBeVisible();
        expect(
            await page.evaluate(() => {
                const transition = (
                    window as unknown as {
                        __yearbookTransition: {
                            grid: Element;
                            mapBody: Element;
                            nationBody: Element;
                            removedNodes: number;
                        };
                    }
                ).__yearbookTransition;
                return {
                    gridIsSame: document.querySelector('.history-grid') === transition.grid,
                    mapIsSame: document.querySelector('.map-body') === transition.mapBody,
                    nationIsSame: document.querySelector('.nation-position tbody') === transition.nationBody,
                    removedNodes: transition.removedNodes,
                };
            })
        ).toEqual({ gridIsSame: true, mapIsSame: true, nationIsSame: true, removedNodes: 0 });

        releaseHistory?.();
        await expect(page.getByText('이전 달의 중원 정세입니다.')).toBeVisible();
        await expect(page.locator('.history-grid')).toHaveAttribute('aria-busy', 'false');
        expect(
            await page.evaluate(() => {
                const transition = (
                    window as unknown as {
                        __yearbookTransition: { grid: Element; mapBody: Element; nationBody: Element };
                    }
                ).__yearbookTransition;
                return {
                    gridIsSame: document.querySelector('.history-grid') === transition.grid,
                    mapIsSame: document.querySelector('.map-body') === transition.mapBody,
                    nationIsSame: document.querySelector('.nation-position tbody') === transition.nationBody,
                };
            })
        ).toEqual({ gridIsSame: true, mapIsSame: true, nationIsSame: true });
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
            await page.goto(gameUrl('/survey'));
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
                    voteButton: {
                        backgroundColor: getComputedStyle(document.querySelector<HTMLElement>('.vote-submit')!)
                            .backgroundColor,
                        borderBottomWidth: getComputedStyle(document.querySelector<HTMLElement>('.vote-submit')!)
                            .borderBottomWidth,
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
            expect(geometry.voteButton).toEqual({
                backgroundColor: 'rgb(68, 68, 68)',
                borderBottomWidth: '4px',
            });

            const secondOption = page.locator('#v-vote-1');
            await secondOption.check();
            await expect(secondOption).toBeChecked();
            await secondOption.focus();
            await expect(secondOption).toBeFocused();

            const voteButton = page.getByRole('button', { name: '투표', exact: true });
            const beforeHover = await voteButton.evaluate((element) => getComputedStyle(element).borderBottomWidth);
            await voteButton.hover();
            const afterHover = await voteButton.evaluate((element) => getComputedStyle(element).borderBottomWidth);
            expect(afterHover).not.toBe(beforeHover);
        });
    }

    test('submits a vote and comment through the real screen controls', async ({ page }) => {
        await page.goto(gameUrl('/survey'));
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
        await page.goto(gameUrl('/survey'));
        const secondOption = page.locator('#v-vote-1');
        await secondOption.check();
        await page.getByRole('button', { name: '투표', exact: true }).click();
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(secondOption).toBeChecked();
    });
});
