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

const readPassword = async (account: 'admin'): Promise<string> => {
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
    await page.goto('/gateway/admin/servers/hwe%3A2/scenario');
    await page.getByTestId('source-commit').check();
    await page.getByTestId('source-ref').fill(sourceCommit);
    await page.getByTestId('load-scenarios').click();
    await expect(page.getByText(/개 시나리오를 확인했습니다/)).toBeVisible();
    await page.getByTestId('scenario-select').selectOption(scenarioId);

    const latestOperation = page.getByTestId('operation-summary-row').first();
    const previousLatestOperation = await latestOperation.textContent();
    await page.getByTestId('request-reset').click();
    await expect(page.getByText('초기화 작업을 시작했습니다.')).toBeVisible();
    await expect.poll(() => latestOperation.textContent(), { timeout: 15_000 }).not.toBe(previousLatestOperation);
    await latestOperation.getByTestId('operation-details-toggle').click();
    await expect(page.getByTestId('operation-detail').first()).toContainText(sourceCommit, { timeout: 15_000 });
    await expect(latestOperation.locator('[data-operation-status]')).toHaveAttribute(
        'data-operation-status',
        'SUCCEEDED',
        {
            timeout: 300_000,
        }
    );
    const profileStatus = page.getByTestId('selected-profile-status');
    await expect(profileStatus.locator(':scope > div').nth(0)).toContainText('RUNNING', {
        timeout: 30_000,
    });
    await expect(profileStatus.locator(':scope > div').nth(1)).toContainText('SUCCEEDED');
    await expect(profileStatus.locator('.text-emerald-400')).toHaveCount(3, {
        timeout: 30_000,
    });
    await expect(profileStatus.locator('..').locator('.text-red-400')).toHaveCount(0);
    await expect
        .poll(
            () =>
                page.evaluate(async () => {
                    const response = await fetch(
                        '/hwe/api/trpc/lobby.info,public.getMapLayout,public.getCachedMap?batch=1&input=%7B%7D'
                    );
                    return response.status;
                }),
            { timeout: 60_000 }
        )
        .toBe(200);
};

type PossessCandidateBatch = Array<{
    result?: {
        data?: {
            candidates?: Array<{ picture?: string | null }>;
        };
    };
}>;

const inspectScenarioIcons = async (
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
    await login(page, 'guiadmin', await readPassword('admin'));
    const row = hweRow(page);
    await expect(row.getByRole('button', { name: '장수생성' })).toBeEnabled({ timeout: 60_000 });
    await row.getByRole('button').click();
    await expect(page).toHaveURL(/\/hwe\/join$/);
    const candidatesResponse = page.waitForResponse(
        (candidate) =>
            candidate.url().includes('/hwe/api/trpc/join.listPossessCandidates') && candidate.status() === 200
    );
    await page.getByRole('button', { name: 'NPC 빙의' }).click();
    const payload = (await (await candidatesResponse).json()) as PossessCandidateBatch;
    const iconPaths = payload
        .flatMap((entry) => entry.result?.data?.candidates ?? [])
        .map((candidate) => candidate.picture)
        .filter(
            (picture): picture is string => typeof picture === 'string' && picture.startsWith(`${expectedDirectory}/`)
        );
    expect(iconPaths.length).toBeGreaterThan(0);

    const imageRoot = requiredEnv('SAMMO_IMAGE_ROOT');
    for (const iconPath of iconPaths) {
        await access(path.join(imageRoot, 'icons', iconPath));
    }
    await page.screenshot({
        path: testInfo.outputPath(`scenario-${scenarioId}-npc-icons.png`),
        fullPage: true,
    });
    await context.close();
    return iconPaths;
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
    const numericScenarioIcons = await inspectScenarioIcons(browser, testInfo, '1010', '장수');
    expect(numericScenarioIcons.every((iconPath) => iconPath.startsWith('장수/'))).toBe(true);

    await resetScenario(page, '2220', sourceCommit);
    const nullScenarioIcons = await inspectScenarioIcons(browser, testInfo, '2220', '장수');
    expect(nullScenarioIcons.every((iconPath) => iconPath.startsWith('장수/'))).toBe(true);

    await resetScenario(page, '2140', sourceCommit);
    const themedScenarioIcons = await inspectScenarioIcons(browser, testInfo, '2140', '걸그룹');
    expect(themedScenarioIcons.every((iconPath) => iconPath.startsWith('걸그룹/'))).toBe(true);
});
