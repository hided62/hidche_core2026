import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = process.env.REF_GENERAL_URL ?? 'http://127.0.0.1:3416/sam/';
const username = process.env.REF_GENERAL_USER ?? 's100user01';
const passwordFile = process.env.REF_GENERAL_PASSWORD_FILE;
const artifactRoot = resolve(
    process.env.REF_GENERAL_ARTIFACT_DIR ?? 'test-results/reference-nation-general-filter-menu'
);

if (!passwordFile) throw new Error('REF_GENERAL_PASSWORD_FILE is required.');
const password = (await readFile(passwordFile, 'utf8')).trim();
await mkdir(artifactRoot, { recursive: true });

const inspectVisiblePopup = (page) =>
    page.evaluate(() => {
        const popup = [...document.querySelectorAll('.ag-popup, .ag-popup-child')].find((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });
        if (!(popup instanceof HTMLElement)) return null;
        const rect = popup.getBoundingClientRect();
        const style = getComputedStyle(popup);
        return {
            html: popup.innerHTML,
            text: popup.innerText,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            style: {
                color: style.color,
                backgroundColor: style.backgroundColor,
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
            },
            inputs: [...popup.querySelectorAll('input')].map((input) => ({
                type: input.type,
                value: input.value,
                placeholder: input.placeholder,
                ariaLabel: input.getAttribute('aria-label'),
            })),
            selects: [...popup.querySelectorAll('select')].map((select) => ({
                value: select.value,
                options: [...select.options].map((option) => ({ value: option.value, text: option.text })),
            })),
            buttons: [...popup.querySelectorAll('button')].map((button) => ({
                text: button.innerText,
                ariaLabel: button.getAttribute('aria-label'),
                title: button.title,
                className: button.className,
            })),
        };
    });

const inspectOperatorOptions = async (page) => {
    const popup = page.locator('.ag-popup-child:visible');
    await popup.getByRole('listbox', { name: 'Filtering operator' }).first().click();
    const optionList = page.locator('.ag-select-list:visible');
    await optionList.waitFor();
    const options = await optionList.locator('.ag-list-item').allInnerTexts();
    await page.keyboard.press('Escape');
    return options;
};

const browser = await chromium.launch({ headless: true });
try {
    const context = await browser.newContext({
        viewport: { width: 1200, height: 900 },
        deviceScaleFactor: 1,
        locale: 'ko-KR',
        colorScheme: 'dark',
    });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    const salt = await page.locator('#global_salt').inputValue();
    const passwordHash = createHash('sha512')
        .update(salt + password + salt)
        .digest('hex');
    const login = await context.request.post(new URL('api.php?path=Login/LoginByID', baseUrl).toString(), {
        data: { username, password: passwordHash },
    });
    const loginResult = await login.json();
    if (!login.ok() || loginResult.result !== true) throw new Error('Reference login failed.');

    await page.goto(new URL('hwe/', baseUrl).toString(), { waitUntil: 'domcontentloaded' });
    await page.goto(new URL('hwe/v_nationGeneral.php', baseUrl).toString(), { waitUntil: 'domcontentloaded' });
    await page.locator('.ag-root-wrapper').waitFor();
    await page.locator('.ag-center-cols-container .ag-row').first().waitFor();

    const output = {};
    const nameFilterCell = page.locator('.ag-header-row-column-filter .ag-header-cell').nth(1);
    output.nameCell = await nameFilterCell.evaluate((element) => ({
        html: element.innerHTML,
        buttons: [...element.querySelectorAll('button')].map((button) => ({
            ariaLabel: button.getAttribute('aria-label'),
            title: button.title,
            className: button.className,
        })),
    }));
    await nameFilterCell.locator('button').click();
    output.namePopup = await inspectVisiblePopup(page);
    output.nameOperators = await inspectOperatorOptions(page);
    await page.screenshot({ path: resolve(artifactRoot, 'ref-name-filter-menu.png'), fullPage: true });
    await page.keyboard.press('Escape');

    const leadershipFilterButton = page.locator('.ag-floating-filter-button-button:visible').nth(4);
    await leadershipFilterButton.click();
    output.numberPopup = await inspectVisiblePopup(page);
    output.numberOperators = await inspectOperatorOptions(page);
    await page.screenshot({ path: resolve(artifactRoot, 'ref-number-filter-menu.png'), fullPage: true });

    await writeFile(resolve(artifactRoot, 'computed-dom.json'), `${JSON.stringify(output, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: true, artifactRoot, output })}\n`);
} finally {
    await browser.close();
}
