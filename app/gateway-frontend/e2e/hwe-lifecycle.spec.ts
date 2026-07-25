import { readFile } from 'node:fs/promises';

import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';

const requiredEnv = (name: string): string => {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`${name} is required`);
    }
    return value;
};

const readPassword = async (account: 'admin' | 'user_a' | 'user_b'): Promise<string> => {
    const root = requiredEnv('SAMMO_LIFECYCLE_SECRET_ROOT');
    return (await readFile(`${root}/${account}_password`, 'utf8')).trim();
};

const login = async (page: Page, username: string, password: string): Promise<void> => {
    await page.goto('/gateway/');
    await page.getByLabel('계정명').fill(username);
    await page.getByLabel('비밀번호').fill(password);
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    await expect(page).toHaveURL(/\/gateway\/lobby$/);
};

const hweRow = (page: Page) => page.locator('tbody tr').filter({ hasText: /^hwe섭/ });

const enterHwe = async (page: Page): Promise<void> => {
    const row = hweRow(page);
    await expect(row).toBeVisible();
    await expect(row).not.toContainText('폐 쇄 중');
    await row.getByRole('button').click();
};

const createGeneral = async (
    browser: Browser,
    testInfo: TestInfo,
    account: { username: string; password: 'user_a' | 'user_b'; generalName: string }
): Promise<void> => {
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        colorScheme: 'dark',
        viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await login(page, account.username, await readPassword(account.password));

    const row = hweRow(page);
    await expect(row.getByRole('button', { name: '장수생성' })).toBeVisible();
    await expect(row.getByRole('button', { name: '장수생성' })).toBeEnabled();
    await enterHwe(page);

    await expect(page).toHaveURL(/\/hwe\/join$/);
    await expect(page.getByRole('heading', { name: '장수 생성/빙의' })).toBeVisible();
    await page.getByLabel('장수명').fill(account.generalName);
    await page.getByRole('button', { name: '균형형' }).click();
    await page.locator('.form-actions').getByRole('button', { name: '장수 생성' }).click();

    await expect(page).toHaveURL(/\/hwe\/$/);
    await expect(page.getByRole('heading', { name: '전장 현황' })).toBeVisible();
    await expect(page.locator('.error')).toHaveCount(0);
    await page.screenshot({
        path: testInfo.outputPath(`${account.username}-main.png`),
        fullPage: true,
    });
    await context.close();
};

test('admin resets and opens hwe, then two users create generals and reach main', async ({
    browser,
    page,
}, testInfo) => {
    test.setTimeout(360_000);
    const sourceCommit = requiredEnv('SAMMO_LIFECYCLE_SOURCE_COMMIT');
    page.on('dialog', (dialog) => dialog.accept());

    await login(page, 'guiadmin', await readPassword('admin'));
    await page.getByRole('link', { name: '관리자 페이지' }).click();
    await expect(page).toHaveURL(/\/gateway\/admin$/);
    await page.getByRole('link', { name: '서버 배포 · 시나리오 초기화' }).click();
    await expect(page).toHaveURL(/\/gateway\/admin\/server-operations$/);

    await page.getByTestId('profile-select').selectOption('hwe:2');
    await page.getByTestId('source-commit').check();
    await page.getByTestId('source-ref').fill(sourceCommit);
    await page.getByTestId('load-scenarios').click();
    await expect(page.getByText(/개 시나리오를 확인했습니다/)).toBeVisible();
    await page.getByTestId('scenario-select').selectOption('2');
    await page.getByTestId('request-reset').click();
    await expect(page.getByText('초기화 작업을 시작했습니다.')).toBeVisible();

    await expect(page.getByTestId('operations-table')).toContainText('SUCCEEDED', {
        timeout: 300_000,
    });
    await expect(page.getByText('RUNNING', { exact: true })).toHaveCount(3, {
        timeout: 30_000,
    });
    await page.screenshot({
        path: testInfo.outputPath('admin-reset-running.png'),
        fullPage: true,
    });

    await page.getByRole('link', { name: '삼국지 모의전투 HiDCHe' }).click();
    await expect(page).toHaveURL(/\/gateway\/lobby$/);
    await expect(hweRow(page).getByRole('button', { name: '장수생성' })).toBeEnabled();
    await enterHwe(page);
    await expect(page).toHaveURL(/\/hwe\/$/);
    await expect(page.getByRole('heading', { name: '전장 현황' })).toBeVisible();
    await page.screenshot({
        path: testInfo.outputPath('admin-main.png'),
        fullPage: true,
    });

    await createGeneral(browser, testInfo, {
        username: 'guiusera',
        password: 'user_a',
        generalName: 'GUI장수A',
    });
    await createGeneral(browser, testInfo, {
        username: 'guiuserb',
        password: 'user_b',
        generalName: 'GUI장수B',
    });
});
