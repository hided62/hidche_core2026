import { readFile } from 'node:fs/promises';

import { expect, test, type Browser, type TestInfo } from '@playwright/test';

const SAMPLE_ICON = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAvElEQVR4nOXOMQEAIAzAsHqaFrQgn8nIwZE/zbnvZ+mAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YCWDmjpgJYOaOmAlg5o6YC2Elzh0mBKLrgAAAAASUVORK5CYII=',
    'base64'
);

const requiredEnv = (name: string): string => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
};

const readPassword = async (account: 'user_a' | 'user_b'): Promise<string> =>
    (await readFile(`${requiredEnv('SAMMO_LIFECYCLE_SECRET_ROOT')}/${account}_password`, 'utf8')).trim();

const registerAccount = async (
    browser: Browser,
    testInfo: TestInfo,
    account: {
        username: string;
        passwordFile: 'user_a' | 'user_b';
        displayName: string;
        uploadIcon: boolean;
    }
): Promise<void> => {
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        colorScheme: 'dark',
        viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    const password = await readPassword(account.passwordFile);

    await page.goto('/gateway/signup');
    await expect(page.getByRole('heading', { name: '회원가입' })).toBeVisible();
    await page.getByLabel('계정명').fill(account.username);
    await page.getByLabel('비밀번호', { exact: true }).fill(password);
    await page.getByLabel('비밀번호 확인').fill(password);
    await page.getByLabel('닉네임').fill(account.displayName);
    const requiredAgreements = page.locator('.agreement-row input[type="checkbox"]');
    await requiredAgreements.nth(0).check();
    await requiredAgreements.nth(1).check();
    await page.getByRole('button', { name: '가입', exact: true }).click();

    let registeredNow = true;
    try {
        await expect(page).toHaveURL(/\/gateway\/lobby\?welcome=local$/, { timeout: 5_000 });
    } catch {
        registeredNow = false;
        await expect(page.getByRole('alert')).toBeVisible();
        await page.goto('/gateway/');
        await page.getByLabel('계정명').fill(account.username);
        await page.getByLabel('비밀번호').fill(password);
        await page.getByRole('button', { name: '로그인', exact: true }).click();
        await expect(page).toHaveURL(/\/gateway\/lobby$/);
    }
    await page.goto('/gateway/account');
    await expect(page.locator('#account-table')).toContainText(account.username);
    await expect(page.locator('#account-table')).toContainText(account.displayName);

    if (account.uploadIcon) {
        if (registeredNow) {
            await page.locator('input[type="file"]').setInputFiles({
                name: 'sample-user-icon.png',
                mimeType: 'image/png',
                buffer: SAMPLE_ICON,
            });
            await page.getByRole('button', { name: '아이콘 변경', exact: true }).click();
            await expect(page.getByTestId('icon-server-modal')).toBeVisible({ timeout: 30_000 });
        }
        const storedIcon = page.locator('img[alt="전용 아이콘"]');
        await expect(storedIcon).toHaveCount(1);
        await expect(storedIcon).toHaveAttribute(
            'src',
            /^https:\/\/sam-image\.hided\.net\/icons\/users\/core2026\/[a-f0-9]{32}\.png$/
        );
        if (registeredNow) {
            await page.getByTestId('icon-server-close').click();
        }
    }

    await page.screenshot({
        path: testInfo.outputPath(`${account.username}-account.png`),
        fullPage: true,
    });
    await context.close();
};

test('two local users register and the first uploads a remote user icon', async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    await registerAccount(browser, testInfo, {
        username: 'guiusera',
        passwordFile: 'user_a',
        displayName: 'GUI사용자A',
        uploadIcon: true,
    });
    await registerAccount(browser, testInfo, {
        username: 'guiuserb',
        passwordFile: 'user_b',
        displayName: 'GUI사용자B',
        uploadIcon: false,
    });
});
