import { generateKeyPairSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const pending = {
    status: 'deletion_pending',
    recoveryId: '11111111-1111-4111-8111-111111111111',
    deleteAfter: '2026-07-30T14:59:59.999Z',
};
const otp = {
    status: 'otp',
    successStatus: 'login',
    challengeId: '22222222-2222-4222-8222-222222222222',
    expiresAt: '2026-11-07T12:00:00Z',
    attemptsRemaining: 3,
};
const installFixture = async (page: Page, entry: 'password' | 'kakao' | 'kakao-link', fail = false) => {
    const calls: string[] = [];
    let restored = false;
    let complete: (() => void) | undefined;
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const url = new URL(route.request().url());
        const names = decodeURIComponent(url.pathname.split('/trpc/')[1]!).split(',');
        const results = [];
        for (const name of names) {
            calls.push(name);
            let data: unknown;
            if (name === 'me')
                data = restored
                    ? {
                          id: 'fixture-user',
                          username: 'fixture-user',
                          displayName: '복구계정',
                          roles: ['user'],
                          kakaoVerified: true,
                      }
                    : null;
            else if (name === 'lobby.profiles') data = [];
            else if (name === 'lobby.notice') data = '';
            else if (name === 'auth.passwordKey')
                data = { keyId: 'fixture-key', publicKeyPem, algorithm: 'RSA-OAEP-256' };
            else if (name === 'auth.login') data = pending;
            else if (name === 'auth.kakaoExchange')
                data =
                    entry === 'kakao-link'
                        ? {
                              status: 'account_recovery',
                              action: 'link_existing',
                              oauthSessionId: 'fixture-link-session',
                              email: 'retained@example.test',
                          }
                        : pending;
            else if (name === 'auth.kakaoResolveAccount') data = otp;
            else if (name === 'auth.kakaoOtp') data = { ...pending, validUntil: '2026-11-08T12:00:00Z' };
            else if (name === 'auth.cancelDeletion') {
                const input = route.request().postDataJSON() as Record<string, { recoveryId: string }>;
                expect(Object.values(input)).toEqual([{ recoveryId: pending.recoveryId }]);
                await new Promise<void>((resolve) => {
                    complete = resolve;
                });
                if (fail) {
                    results.push({
                        error: {
                            message: '복구 인증이 만료되었습니다. 다시 로그인해 주세요.',
                            code: -32001,
                            data: { code: 'UNAUTHORIZED', httpStatus: 401 },
                        },
                    });
                    continue;
                }
                restored = true;
                data = {
                    status: 'login',
                    sessionToken: 'fixture-restored-session',
                    user: { id: 'fixture-user' },
                    issuedAt: '2026-11-07T12:00:00Z',
                };
            } else throw new Error(`Unhandled recovery operation: ${name}`);
            results.push({ result: { data } });
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
    return {
        calls,
        complete: () => {
            expect(complete).toBeDefined();
            complete!();
        },
    };
};

for (const viewport of [
    { name: 'desktop', width: 1200, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
]) {
    for (const entry of ['password', 'kakao', 'kakao-link'] as const) {
        test(`restores a pending account through ${entry} on ${viewport.name}`, async ({ page }, testInfo) => {
            await page.setViewportSize(viewport);
            const f = await installFixture(page, entry);
            await page.goto(
                entry === 'password' ? '/gateway/' : '/gateway/oauth/callback?code=fixture-code&state=fixture-state'
            );
            if (entry === 'password') {
                await page.getByLabel('계정명', { exact: true }).fill('fixture-user');
                await page.getByLabel('비밀번호', { exact: true }).fill('fixture-password');
                await page.getByRole('button', { name: '로그인', exact: true }).click();
            }
            if (entry === 'kakao-link') {
                await expect(page.getByRole('group', { name: '카카오 계정 연결 확인' })).toBeVisible();
                await page.getByRole('button', { name: '기존 계정에 연결' }).click();
                const dialog = page.getByRole('dialog', { name: '인증 코드 필요' });
                await expect(dialog).toBeVisible();
                await dialog.locator('input').fill('1234');
                await dialog.getByRole('button', { name: '제출', exact: true }).click();
            }
            const panel = page.getByRole('group', { name: '탈퇴 취소', exact: true });
            await expect(panel).toBeVisible();
            expect(f.calls).not.toContain('auth.cancelDeletion');
            expect(await page.evaluate(() => localStorage.getItem('sammo-session-token'))).toBeNull();
            await page.evaluate(() => document.fonts.ready);
            const geometry = await panel.evaluate((element) => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return {
                    x: rect.x,
                    width: rect.width,
                    height: rect.height,
                    textAlign: style.textAlign,
                    fontSize: style.fontSize,
                    html: element.outerHTML,
                };
            });
            expect(geometry.x).toBeGreaterThanOrEqual(0);
            expect(geometry.width).toBeLessThan(viewport.width);
            expect(geometry.textAlign).toBe('center');
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
            const button = panel.getByRole('button', { name: '탈퇴 취소', exact: true });
            await button.hover();
            expect(await button.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(47, 77, 108)');
            await page.mouse.down();
            expect(await button.evaluate((el) => el.matches(':active'))).toBe(true);
            await page.mouse.move(0, 0);
            await page.mouse.up();
            await button.focus();
            await page.keyboard.press('Tab');
            await page.keyboard.press('Shift+Tab');
            await expect(button).toBeFocused();
            expect(await button.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
            await writeFile(testInfo.outputPath('panel-dom-geometry-style.json'), JSON.stringify(geometry, null, 2));
            await writeFile(testInfo.outputPath('panel.html'), geometry.html);
            await testInfo.attach('panel-dom-geometry-style', {
                body: JSON.stringify(geometry, null, 2),
                contentType: 'application/json',
            });
            await page.screenshot({ path: testInfo.outputPath('deletion-confirmation.png'), fullPage: true });
            await button.click();
            await expect(panel.getByRole('button', { name: '처리 중...' })).toBeDisabled();
            await expect(panel.getByRole('button', { name: '돌아가기' })).toBeDisabled();
            await expect.poll(() => f.calls.filter((call) => call === 'auth.cancelDeletion').length).toBe(1);
            f.complete();
            await expect(page).toHaveURL(/\/gateway\/lobby$/);
            expect(await page.evaluate(() => localStorage.getItem('sammo-session-token'))).toBe(
                'fixture-restored-session'
            );
            await page.reload();
            await expect(page).toHaveURL(/\/gateway\/lobby$/);
        });
    }
}

test('keeps deletion unchanged when leaving confirmation or when recovery expires', async ({ page }) => {
    const f = await installFixture(page, 'kakao', true);
    await page.goto('/gateway/oauth/callback?code=fixture-code&state=fixture-state');
    const panel = page.getByRole('group', { name: '탈퇴 취소', exact: true });
    await panel.getByRole('button', { name: '돌아가기' }).click();
    await expect(page).toHaveURL(/\/gateway\/$/);
    expect(f.calls).not.toContain('auth.cancelDeletion');
    await page.goto('/gateway/oauth/callback?code=fixture-code&state=fixture-state');
    await panel.getByRole('button', { name: '탈퇴 취소' }).click();
    await expect.poll(() => f.calls.filter((call) => call === 'auth.cancelDeletion').length).toBe(1);
    f.complete();
    await expect(panel.getByRole('alert')).toContainText('다시 로그인');
    expect(await page.evaluate(() => localStorage.getItem('sammo-session-token'))).toBeNull();
});
