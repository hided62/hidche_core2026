import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

const artifactRoot = process.env.KAKAO_OTP_ARTIFACT_DIR ? resolve(process.env.KAKAO_OTP_ARTIFACT_DIR) : null;
const response = (data: unknown) => ({ result: { data } });
const errorResponse = (path: string, message: string) => ({
    error: {
        message,
        code: -32001,
        data: {
            code: 'UNAUTHORIZED',
            httpStatus: 401,
            path,
        },
    },
});
const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const challenge = {
    status: 'otp' as const,
    challengeId: '11111111-1111-4111-8111-111111111111',
    expiresAt: '2026-08-08T06:00:00.000Z',
    attemptsRemaining: 3,
};

const installFixture = async (page: Page, source: 'password' | 'oauth') => {
    let loggedIn = false;
    let otpAttempts = 0;
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const operations = operationNames(route);
        const results = await Promise.all(
            operations.map(async (operation) => {
                if (operation === 'me') {
                    return response(
                        loggedIn
                            ? {
                                  id: 'kakao-otp-user',
                                  username: 'kakao-otp-user',
                                  displayName: '카카오 인증 사용자',
                                  roles: [],
                                  picture: 'default.jpg',
                                  kakaoVerified: true,
                                  kakaoGraceStartedAt: '2026-08-08T00:00:00.000Z',
                                  createdAt: '2026-08-08T00:00:00.000Z',
                              }
                            : null
                    );
                }
                if (operation === 'lobby.notice') return response('');
                if (operation === 'lobby.profiles') return response([]);
                if (operation === 'auth.passwordKey') {
                    return response({ keyId: 'playwright-key', publicKeyPem, algorithm: 'RSA-OAEP-256' });
                }
                if (operation === 'auth.login') return response({ ...challenge, successStatus: 'login' });
                if (operation === 'auth.kakaoExchange') {
                    return response({ ...challenge, successStatus: source === 'oauth' ? 'verified' : 'login' });
                }
                if (operation === 'auth.kakaoOtp') {
                    otpAttempts += 1;
                    await new Promise((resolveDelay) => setTimeout(resolveDelay, 800));
                    if (otpAttempts === 1) {
                        return errorResponse(operation, '인증 번호가 틀렸습니다. 2회 더 시도할 수 있습니다.');
                    }
                    loggedIn = true;
                    return response({
                        status: 'login',
                        user: {
                            id: 'kakao-otp-user',
                            username: 'kakao-otp-user',
                            displayName: '카카오 인증 사용자',
                            roles: [],
                            picture: 'default.jpg',
                            kakaoVerified: true,
                            kakaoGraceStartedAt: '2026-08-08T00:00:00.000Z',
                            createdAt: '2026-08-08T00:00:00.000Z',
                        },
                        sessionToken: 'verified-session-token',
                        issuedAt: '2026-08-08T05:57:00.000Z',
                        validUntil: '2026-08-18T05:57:00.000Z',
                    });
                }
                throw new Error(`Unhandled Kakao OTP fixture operation: ${operation}`);
            })
        );
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(results),
        });
    });
    return { otpAttempts: () => otpAttempts };
};

const verifyDialog = async (page: Page, artifactName: string) => {
    const dialog = page.getByRole('dialog', { name: '인증 코드 필요' });
    const input = dialog.getByLabel('인증 코드');
    const submit = dialog.getByRole('button', { name: '제출' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("카카오톡의 '나와의 채팅'란을 확인해 주세요.");
    await expect(input).toBeFocused();

    const geometry = await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            backgroundColor: style.backgroundColor,
            border: style.border,
            fontSize: style.fontSize,
        };
    });
    expect(geometry.width).toBeLessThanOrEqual(500);
    expect(geometry.width).toBeGreaterThan(350);
    expect(geometry.backgroundColor).toBe('rgb(48, 48, 48)');
    expect(geometry.border).toBe('1px solid rgb(68, 68, 68)');

    await submit.hover();
    await page.waitForTimeout(200);
    expect(await submit.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(55, 90, 127)');
    await input.press('Tab');
    await page.keyboard.press('Tab');
    await expect(submit).toBeFocused();
    await page.waitForTimeout(200);
    expect(await submit.evaluate((element) => getComputedStyle(element).boxShadow)).toMatch(
        /^rgba\(85, 115, 146, 0\.49\d\) 0px 0px 0px 4px$/
    );

    if (artifactRoot) {
        await mkdir(artifactRoot, { recursive: true });
        await page.screenshot({ path: resolve(artifactRoot, `${artifactName}.png`), fullPage: true });
        await writeFile(
            resolve(artifactRoot, `${artifactName}.json`),
            `${JSON.stringify(geometry, null, 2)}\n`,
            'utf8'
        );
    }

    const verifyPointerActive = async () => {
        const box = await submit.boundingBox();
        if (!box) throw new Error('OTP submit button has no rendered geometry.');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        expect(await submit.evaluate((element) => element.matches(':active'))).toBe(true);
        await page.waitForTimeout(200);
        expect(await submit.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(44, 72, 102)');
        await page.mouse.move(1, 1);
        await page.mouse.up();
    };
    const submitAndObserveDisabled = () =>
        submit.evaluate(
            (element) =>
                new Promise<{ disabled: boolean; opacity: string }>((resolveDisabled) => {
                    (element as HTMLButtonElement).click();
                    setTimeout(
                        () =>
                            resolveDisabled({
                                disabled: (element as HTMLButtonElement).disabled,
                                opacity: getComputedStyle(element).opacity,
                            }),
                        200
                    );
                })
        );

    await input.fill('0000');
    await verifyPointerActive();
    expect(await submitAndObserveDisabled()).toEqual({ disabled: true, opacity: '0.65' });
    await expect(dialog.getByRole('alert')).toContainText('2회 더 시도');
    await expect(input).toBeFocused();

    await input.fill('1234');
    expect(await submitAndObserveDisabled()).toEqual({ disabled: true, opacity: '0.65' });
    await expect(page).toHaveURL(/\/gateway\/lobby(?:\?verified=1)?$/);
    await expect
        .poll(() => page.evaluate(() => window.localStorage.getItem('sammo-session-token')))
        .toBe('verified-session-token');
    return geometry;
};

for (const viewport of [
    { name: 'desktop', width: 1200, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
] as const) {
    test(`completes password-login KakaoTalk OTP on ${viewport.name}`, async ({ page }) => {
        const fixture = await installFixture(page, 'password');
        await page.setViewportSize(viewport);
        await page.goto('/gateway/');
        await page.getByLabel('계정명').fill('kakao-otp-user');
        await page.getByLabel('비밀번호').fill('password-for-browser-fixture');
        await page.getByRole('button', { name: '로그인', exact: true }).click();

        const geometry = await verifyDialog(page, `kakao-otp-password-${viewport.name}`);
        expect(geometry.width).toBe(viewport.name === 'desktop' ? 500 : 374);
        expect(geometry.y).toBe(viewport.name === 'desktop' ? 28 : 8);
        expect(fixture.otpAttempts()).toBe(2);
    });
}

test('completes the same KakaoTalk OTP flow after OAuth callback', async ({ page }) => {
    const fixture = await installFixture(page, 'oauth');
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/gateway/oauth/callback?code=oauth-code&state=oauth-state');

    await verifyDialog(page, 'kakao-otp-oauth-callback');
    await expect(page).toHaveURL(/\/gateway\/lobby\?verified=1$/);
    expect(fixture.otpAttempts()).toBe(2);
});
