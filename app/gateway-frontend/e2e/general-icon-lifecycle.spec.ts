import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';

const requiredEnv = (name: string): string => {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`${name} is required`);
    }
    return value;
};

const readPassword = async (account: 'admin' | 'user_a'): Promise<string> => {
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

const resetScenario = async (page: Page, scenarioId: string, sourceCommit: string): Promise<void> => {
    await page.goto('/gateway/admin/server-operations');
    await page.getByTestId('profile-select').selectOption('hwe:2');
    await page.getByTestId('source-commit').check();
    await page.getByTestId('source-ref').fill(sourceCommit);
    await page.getByTestId('load-scenarios').click();
    await expect(page.getByText(/개 시나리오를 확인했습니다/)).toBeVisible();
    await page.getByTestId('scenario-select').selectOption(scenarioId);

    const latestOperation = page.getByTestId('operations-table').locator('tbody tr').first();
    const previousLatestOperation = await latestOperation.textContent();
    await page.getByTestId('request-reset').click();
    await expect(page.getByText('초기화 작업을 시작했습니다.')).toBeVisible();
    await expect
        .poll(() => latestOperation.textContent(), { timeout: 15_000 })
        .not.toBe(previousLatestOperation);
    await expect(latestOperation).toContainText(sourceCommit, { timeout: 15_000 });
    await expect(latestOperation.locator('td').nth(3)).toHaveText('SUCCEEDED', {
        timeout: 300_000,
    });
    await expect(page.getByTestId('selected-profile-status').locator('.text-emerald-400')).toHaveCount(2, {
        timeout: 30_000,
    });
};

const createGeneralAndInspectIcons = async (
    browser: Browser,
    testInfo: TestInfo,
    scenarioId: string,
    expectedDirectory: string
): Promise<string[]> => {
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        colorScheme: 'dark',
        viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await login(page, 'guiusera', await readPassword('user_a'));
    const row = hweRow(page);
    await expect(row.getByRole('button', { name: '장수생성' })).toBeEnabled({ timeout: 60_000 });
    await row.getByRole('button').click();
    await expect(page).toHaveURL(/\/hwe\/join$/);
    await page.getByLabel('장수명').fill(`아이콘${scenarioId}`);
    await page.getByRole('button', { name: '균형형' }).click();
    await page.locator('.form-actions').getByRole('button', { name: '장수 생성' }).click();
    await expect(page).toHaveURL(/\/hwe\/$/);

    await page.goto('/hwe/current-city');
    await expect(page.getByText('도 시 정 보', { exact: true })).toBeVisible();
    await expect(page.locator('.error')).toHaveCount(0);
    const iconSources = await page.locator(`img[src*="/image/icons/${expectedDirectory}/"]`).evaluateAll((images) =>
        images.map((image) => (image as HTMLImageElement).src)
    );
    expect(iconSources.length).toBeGreaterThan(0);

    const imageRoot = requiredEnv('SAMMO_IMAGE_ROOT');
    for (const source of iconSources) {
        const relativePath = decodeURIComponent(new URL(source).pathname).replace(/^\/image\/icons\//, '');
        await access(path.join(imageRoot, 'icons', relativePath));
    }
    await page.screenshot({
        path: testInfo.outputPath(`scenario-${scenarioId}-current-city.png`),
        fullPage: true,
    });
    await context.close();
    return iconSources;
};

test('Chromium resets numeric and null-picture scenarios to repository-backed name paths', async ({
    browser,
    page,
}, testInfo) => {
    test.setTimeout(720_000);
    const sourceCommit = requiredEnv('SAMMO_LIFECYCLE_SOURCE_COMMIT');
    page.on('dialog', (dialog) => dialog.accept());
    await login(page, 'guiadmin', await readPassword('admin'));

    await resetScenario(page, '1010', sourceCommit);
    const numericScenarioIcons = await createGeneralAndInspectIcons(browser, testInfo, '1010', '장수');
    expect(numericScenarioIcons.some((source) => decodeURIComponent(source).includes('/image/icons/장수/'))).toBe(true);

    await resetScenario(page, '2220', sourceCommit);
    const nullScenarioIcons = await createGeneralAndInspectIcons(browser, testInfo, '2220', '장수');
    expect(nullScenarioIcons.some((source) => decodeURIComponent(source).includes('/image/icons/장수/'))).toBe(true);

    await resetScenario(page, '2140', sourceCommit);
    const themedScenarioIcons = await createGeneralAndInspectIcons(browser, testInfo, '2140', '걸그룹');
    expect(themedScenarioIcons.some((source) => decodeURIComponent(source).includes('/image/icons/걸그룹/'))).toBe(
        true
    );
});
