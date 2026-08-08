import { expect, test, type Page, type Route } from '@playwright/test';

const response = (data: unknown) => ({ result: { data } });
const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
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
}
