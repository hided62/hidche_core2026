import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

const refBaseUrl = process.env.REF_BATTLE_SIM_URL;
const refPasswordFile = process.env.REF_USER_PASSWORD_FILE;
const refUsername = process.env.REF_USER_ID ?? 'refuser1';
const artifactRoot = process.env.BATTLE_SIM_ARTIFACT_DIR;
const refTest = refBaseUrl && refPasswordFile ? test : test.skip;

refTest('runs the legacy simulator in the same Chromium and captures its rendered contract', async ({ page }) => {
    test.setTimeout(120_000);
    if (!refBaseUrl || !refPasswordFile) {
        throw new Error('REF_BATTLE_SIM_URL and REF_USER_PASSWORD_FILE are required');
    }
    const password = (await readFile(refPasswordFile, 'utf8')).trim();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(refBaseUrl, { waitUntil: 'networkidle' });
    await page.locator('#username').fill(refUsername);
    await page.locator('#password').fill(password);
    const globalSalt = await page.locator('#global_salt').inputValue();
    const passwordHash = createHash('sha512')
        .update(globalSalt + password + globalSalt)
        .digest('hex');
    const loginResponse = await page
        .context()
        .request.post(new URL('api.php?path=Login/LoginByID', refBaseUrl).toString(), {
            data: { username: refUsername, password: passwordHash },
        });
    expect(loginResponse.status()).toBe(200);
    await expect(loginResponse.json()).resolves.toMatchObject({ result: true });

    await page.goto(new URL('hwe/battle_simulator.php', refBaseUrl).toString(), {
        waitUntil: 'networkidle',
    });
    const battleButton = page.locator('.btn-begin_battle');
    await expect(battleButton).toBeVisible();
    const container = page.locator('#container');
    const rect = await container.boundingBox();
    expect(rect?.width).toBeGreaterThanOrEqual(995);
    expect(rect?.width).toBeLessThanOrEqual(1005);

    // A login with no game general leaves the legacy nation selects without a
    // selected option. Choose the first legal independent value before running.
    await page.locator('.form_nation_type').evaluateAll((elements) => {
        for (const element of elements) {
            const select = element as HTMLSelectElement;
            select.selectedIndex = 0;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });
    await expect(page.locator('.form_nation_type').first()).not.toHaveValue('');

    await battleButton.hover();
    expect(await battleButton.evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer');
    const simulationResponse = page.waitForResponse(
        (response) => response.url().includes('/j_simulate_battle.php') && response.status() === 200,
        { timeout: 90_000 }
    );
    await battleButton.click();
    await simulationResponse;
    await expect(page.locator('#generalBattleResultLog')).not.toBeEmpty();

    if (artifactRoot) {
        await page.screenshot({
            path: resolve(artifactRoot, 'battle-simulator-ref-desktop.png'),
            fullPage: true,
            animations: 'disabled',
        });
    }
});
