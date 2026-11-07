import { generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

import { expect, test, type Page, type Route } from '@playwright/test';

const response = (data: unknown) => ({ result: { data } });
const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const installPasswordSetupFixture = async (page: Page) => {
    const calls: string[] = [];
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            calls.push(operation);
            if (operation === 'me') return response(null);
            if (operation === 'lobby.notice') return response('');
            if (operation === 'lobby.profiles') return response([]);
            if (operation === 'auth.passwordKey') {
                return response({ keyId: 'password-setup-key', publicKeyPem, algorithm: 'RSA-OAEP-256' });
            }
            if (operation === 'auth.kakaoExchange') {
                return response({
                    status: 'password_setup',
                    oauthSessionId: '11111111-1111-4111-8111-111111111112',
                    email: 'migrated@example.test',
                    successStatus: 'login',
                });
            }
            if (operation === 'auth.kakaoSetPassword') {
                return response({
                    status: 'otp',
                    challengeId: '11111111-1111-4111-8111-111111111111',
                    expiresAt: '2026-08-17T12:03:00.000Z',
                    attemptsRemaining: 3,
                });
            }
            throw new Error(`Unhandled password setup fixture operation: ${operation}`);
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
    return calls;
};

const installFixture = async (page: Page, action: 'link_existing' | 'rejoin') => {
    const calls: string[] = [];
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const operations = operationNames(route);
        const results = operations.map((operation) => {
            calls.push(operation);
            if (operation === 'me') return response(null);
            if (operation === 'lobby.notice') return response('');
            if (operation === 'lobby.profiles') return response([]);
            if (operation === 'auth.kakaoExchange') {
                return response({
                    status: 'account_recovery',
                    action,
                    oauthSessionId: `${action}-session`,
                    email: 'retained@example.test',
                });
            }
            if (operation === 'auth.kakaoResolveAccount') {
                return action === 'link_existing'
                    ? response({
                          status: 'otp',
                          successStatus: 'login',
                          challengeId: '11111111-1111-4111-8111-111111111111',
                          expiresAt: '2026-08-08T12:03:00.000Z',
                          attemptsRemaining: 3,
                      })
                    : response({
                          status: 'join',
                          oauthSessionId: 'confirmed-registration-session',
                          email: 'retained@example.test',
                      });
            }
            throw new Error(`Unhandled Kakao account recovery fixture operation: ${operation}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(results),
        });
    });
    return calls;
};

const verifyRecoveryChoice = async (page: Page, action: 'link_existing' | 'rejoin') => {
    const group = page.getByRole('group', { name: '카카오 계정 연결 확인' });
    const confirm = group.getByRole('button', {
        name: action === 'link_existing' ? '기존 계정에 연결' : '재가입',
    });
    await expect(group).toBeVisible();
    await expect(group).toContainText('retained@example.test');
    await expect(group).toContainText(
        action === 'link_existing' ? '이 계정에 카카오 로그인을 연결해드릴까요?' : '새 계정으로 재가입하시겠습니까?'
    );
    await page.evaluate(() => document.fonts.ready);
    const geometry = await group.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            width: rect.width,
            height: rect.height,
            backgroundColor: style.backgroundColor,
            fontSize: style.fontSize,
        };
    });
    expect(geometry.width).toBeGreaterThan(300);
    expect(geometry.backgroundColor).toBe('rgba(0, 0, 0, 0)');

    await confirm.hover();
    await page.waitForTimeout(200);
    expect(await confirm.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(47, 77, 108)');
    await confirm.focus();
    expect(await confirm.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
    return { group, confirm, geometry };
};

for (const viewport of [
    { name: 'desktop', width: 1200, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
] as const) {
    test(`links the retained email account only after confirmation on ${viewport.name}`, async ({ page }) => {
        const calls = await installFixture(page, 'link_existing');
        await page.setViewportSize(viewport);
        await page.goto('/gateway/oauth/callback?code=oauth-code&state=oauth-state');
        const { confirm, geometry } = await verifyRecoveryChoice(page, 'link_existing');

        await confirm.click();
        await expect(page.getByRole('dialog', { name: '인증 코드 필요' })).toBeVisible();
        expect(calls.filter((operation) => operation === 'auth.kakaoResolveAccount')).toHaveLength(1);
        expect(geometry.width).toBe(viewport.name === 'desktop' ? 698 : 372);
    });

    test(`continues an orphaned Kakao connection as a new registration on ${viewport.name}`, async ({ page }) => {
        const calls = await installFixture(page, 'rejoin');
        await page.setViewportSize(viewport);
        await page.goto('/gateway/oauth/callback?code=oauth-code&state=oauth-state');
        const { confirm, geometry } = await verifyRecoveryChoice(page, 'rejoin');

        await confirm.click();
        await expect(page.getByRole('heading', { name: '회원가입' })).toBeVisible();
        await expect(page.getByLabel('카카오 이메일')).toHaveValue('retained@example.test');
        expect(calls.filter((operation) => operation === 'auth.kakaoResolveAccount')).toHaveLength(1);
        expect(geometry.width).toBe(viewport.name === 'desktop' ? 698 : 372);
    });

    test(`sets a migrated password before opening the OTP dialog on ${viewport.name}`, async ({ page }) => {
        const calls = await installPasswordSetupFixture(page);
        await page.setViewportSize(viewport);
        await page.goto('/gateway/oauth/callback?code=oauth-code&state=oauth-state');

        const form = page.getByRole('form', { name: '새 비밀번호 설정' });
        await expect(form).toBeVisible();
        await expect(form).toContainText('카카오 인증으로 기존 계정을 확인했습니다.');
        await expect(form.getByLabel('카카오 이메일')).toHaveValue('migrated@example.test');
        const geometry = await form.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return { width: rect.width, right: rect.right };
        });
        await form.getByLabel('새 비밀번호').fill('new-password-value');
        await form.getByLabel('비밀번호 확인').fill('new-password-value');
        await form.getByRole('button', { name: '새 비밀번호 설정' }).click();

        await expect(page.getByRole('dialog', { name: '인증 코드 필요' })).toBeVisible();
        expect(calls.filter((operation) => operation === 'auth.kakaoSetPassword')).toHaveLength(1);
        expect(geometry.width).toBeGreaterThan(300);
        expect(geometry.right).toBeLessThanOrEqual(viewport.width);
    });
}

const installSelfRecoveryFixture = async (page: Page, byPassword: boolean) => {
    const calls: string[] = [];
    let loggedIn = false;
    let passwordAttempts = 0;
    let release: (() => void) | undefined;
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const results = [];
        for (const operation of operationNames(route)) {
            calls.push(operation);
            let data: unknown;
            if (operation === 'me')
                data = loggedIn
                    ? {
                          id: 'self-user',
                          username: 'self-user',
                          displayName: '복구 사용자',
                          roles: ['user'],
                          kakaoVerified: true,
                      }
                    : null;
            else if (operation === 'lobby.notice') data = '';
            else if (operation === 'lobby.profiles') data = [];
            else if (operation === 'auth.passwordKey')
                data = { keyId: 'self-link-key', publicKeyPem, algorithm: 'RSA-OAEP-256' };
            else if (operation === 'auth.kakaoExchange')
                data = byPassword
                    ? {
                          status: 'join',
                          oauthSessionId: '33333333-3333-4333-8333-333333333333',
                          email: 'new@example.test',
                      }
                    : {
                          status: 'account_recovery',
                          action: 'link_existing',
                          oauthSessionId: '33333333-3333-4333-8333-333333333333',
                          email: 'retained@example.test',
                          passwordRequired: false,
                      };
            else if (operation === 'auth.kakaoLinkWithPassword') {
                const input = Object.values(
                    route.request().postDataJSON() as Record<
                        string,
                        { username: string; credential: { ciphertext: string } }
                    >
                )[0]!;
                expect(input.username).toBe('self-user');
                expect(input.credential.ciphertext).not.toBe('fixture-password');
                passwordAttempts++;
                if (passwordAttempts === 1) {
                    results.push({
                        error: {
                            message: '기존 계정명 또는 비밀번호가 일치하지 않습니다.',
                            code: -32001,
                            data: { code: 'UNAUTHORIZED', httpStatus: 401 },
                        },
                    });
                    continue;
                }
                await new Promise<void>((resolve) => {
                    release = resolve;
                });
                data = {
                    status: 'otp',
                    successStatus: 'login',
                    challengeId: '44444444-4444-4444-8444-444444444444',
                    expiresAt: '2099-01-01T00:00:00Z',
                    attemptsRemaining: 3,
                };
            } else if (operation === 'auth.kakaoResolveAccount')
                data = {
                    status: 'otp',
                    successStatus: 'login',
                    challengeId: '44444444-4444-4444-8444-444444444444',
                    expiresAt: '2099-01-01T00:00:00Z',
                    attemptsRemaining: 3,
                };
            else if (operation === 'auth.kakaoOtp') {
                loggedIn = true;
                data = { status: 'login', sessionToken: 'fixture-self-recovered', validUntil: '2099-01-01T00:00:00Z' };
            } else throw new Error(`Unhandled self recovery operation: ${operation}`);
            results.push(response(data));
        }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(results) });
    });
    return {
        calls,
        release: () => {
            expect(release).toBeDefined();
            release!();
        },
    };
};

for (const viewport of [
    { name: 'desktop', width: 1200, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
]) {
    for (const byPassword of [false, true]) {
        test(`self-recovers by ${byPassword ? 'existing password' : 'matching email'} and new talk OTP on ${viewport.name}`, async ({
            page,
        }, testInfo) => {
            await page.setViewportSize(viewport);
            const f = await installSelfRecoveryFixture(page, byPassword);
            await page.goto('/gateway/oauth/callback?code=fixture-code&state=fixture-state');
            if (byPassword) {
                await page.getByText('기존 계정 비밀번호로 연결', { exact: true }).click();
                const form = page.getByRole('form', { name: '기존 비밀번호로 카카오 연결' });
                await form.getByLabel('기존 계정명').fill('self-user');
                await form.getByLabel('기존 비밀번호').fill('wrong-password');
                const button = form.getByRole('button', { name: '비밀번호 확인 후 연결' });
                await button.click();
                await expect(page.getByRole('alert')).toContainText('일치하지 않습니다.');
                await form.getByLabel('기존 비밀번호').fill('fixture-password');
                await page.evaluate(() => document.fonts.ready);
                await button.hover();
                expect(await button.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(47, 77, 108)');
                await page.mouse.down();
                expect(await button.evaluate((el) => el.matches(':active'))).toBe(true);
                await page.mouse.move(1, 1);
                await page.mouse.up();
                await button.focus();
                await page.keyboard.press('Tab');
                await page.keyboard.press('Shift+Tab');
                await expect(button).toBeFocused();
                const geometry = await form.evaluate((el) => {
                    const rect = el.getBoundingClientRect();
                    return {
                        left: rect.left,
                        right: rect.right,
                        width: rect.width,
                        height: rect.height,
                        viewport: innerWidth,
                        fontSize: getComputedStyle(el).fontSize,
                        html: el.outerHTML,
                        overflow: document.documentElement.scrollWidth - innerWidth,
                    };
                });
                expect(geometry.overflow).toBe(0);
                expect(geometry.right).toBeLessThanOrEqual(viewport.width);
                await writeFile(testInfo.outputPath('self-link-geometry.json'), JSON.stringify(geometry, null, 2));
                await writeFile(testInfo.outputPath('self-link-panel.html'), geometry.html);
                await testInfo.attach('self-link-geometry', {
                    body: JSON.stringify(geometry),
                    contentType: 'application/json',
                });
                await page.screenshot({ path: testInfo.outputPath('self-link-password.png'), fullPage: true });
                await button.click();
                await expect(form.getByRole('button')).toBeDisabled();
                await expect.poll(() => f.calls.filter((call) => call === 'auth.kakaoLinkWithPassword').length).toBe(2);
                f.release();
            } else {
                await page.getByRole('button', { name: '기존 계정에 연결', exact: true }).click();
            }
            const dialog = page.getByRole('dialog', { name: '인증 코드 필요' });
            await expect(dialog).toBeVisible();
            expect(await page.evaluate(() => localStorage.getItem('sammo-session-token'))).toBeNull();
            await page.screenshot({ path: testInfo.outputPath('self-link-before-commit.png'), fullPage: true });
            await dialog.locator('input').fill('1234');
            await dialog.getByRole('button', { name: '제출', exact: true }).click();
            await expect(page).toHaveURL(/\/gateway\/lobby$/);
            expect(await page.evaluate(() => localStorage.getItem('sammo-session-token'))).toBe(
                'fixture-self-recovered'
            );
            expect(f.calls).not.toContain('auth.register');
            expect(f.calls).not.toContain('admin.users.setKakaoReplacementApproval');
            await page.reload();
            await expect(page).toHaveURL(/\/gateway\/lobby$/);
        });
    }
}
