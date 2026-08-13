import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = process.env.REF_GENERAL_URL ?? 'http://127.0.0.1:3416/sam/';
const username = process.env.REF_GENERAL_USER ?? 's100user01';
const passwordFile = process.env.REF_GENERAL_PASSWORD_FILE;
const artifactRoot = resolve(process.env.REF_GENERAL_ARTIFACT_DIR ?? 'test-results/reference-nation-general-controls');

if (!passwordFile) throw new Error('REF_GENERAL_PASSWORD_FILE is required.');
const password = (await readFile(passwordFile, 'utf8')).trim();
await mkdir(artifactRoot, { recursive: true });

const measure = async (page) =>
    page.evaluate(() => {
        const describe = (element) => {
            if (!(element instanceof HTMLElement)) return null;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                style: {
                    fontFamily: style.fontFamily,
                    fontSize: style.fontSize,
                    lineHeight: style.lineHeight,
                    color: style.color,
                    backgroundColor: style.backgroundColor,
                    borderCollapse: style.borderCollapse,
                },
            };
        };
        const headerGroups = [...document.querySelectorAll('.ag-header-group-cell')].map((element) => ({
            text: element.textContent?.trim() ?? '',
            className: element.className,
            expanded: element.getAttribute('aria-expanded'),
            rect: describe(element)?.rect,
        }));
        const columns = [...document.querySelectorAll('.ag-header-cell')].map((element) => ({
            id: element.getAttribute('col-id'),
            text: element.textContent?.trim() ?? '',
            sort: element.getAttribute('aria-sort'),
        }));
        const inputs = [...document.querySelectorAll('.ag-header-row-column-filter input.ag-text-field-input')].map(
            (element) => {
                const rect = element.getBoundingClientRect();
                const center = rect.x + rect.width / 2;
                const matchingHeader = [...document.querySelectorAll('.ag-header-row-column .ag-header-cell')].find(
                    (candidate) => {
                        const headerRect = candidate.getBoundingClientRect();
                        return center >= headerRect.x && center <= headerRect.right;
                    }
                );
                return {
                    colId: matchingHeader?.getAttribute('col-id') ?? null,
                    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                    placeholder: element.getAttribute('placeholder'),
                };
            }
        );
        return {
            url: location.href,
            documentWidth: document.documentElement.scrollWidth,
            body: describe(document.body),
            page: describe(document.querySelector('.pageNationGeneral')),
            component: describe(document.querySelector('.component-general-list')),
            grid: describe(document.querySelector('.ag-root-wrapper')),
            firstRow: describe(document.querySelector('.ag-row')),
            headerGroups,
            columns,
            inputs,
            toolbarText: document.querySelector('.component-general-list')?.textContent?.slice(0, 500) ?? '',
        };
    });

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
    await page.evaluate(() => document.fonts.ready);

    const output = { initial: await measure(page) };
    await page.screenshot({ path: resolve(artifactRoot, 'ref-initial.png'), fullPage: true });

    const statGroup = page.locator('.ag-header-group-cell').filter({ hasText: '능력치' });
    await statGroup.locator('.ag-header-expand-icon:visible').click();
    output.collapsed = await measure(page);
    await page.screenshot({ path: resolve(artifactRoot, 'ref-stat-collapsed.png'), fullPage: true });

    const leadershipHeader = page.locator('.ag-header-cell[col-id="leadership"] .ag-header-cell-label');
    await statGroup.locator('.ag-header-expand-icon:visible').click();
    await leadershipHeader.click();
    output.sort = {
        ariaSort: await page.locator('.ag-header-cell[col-id="leadership"]').getAttribute('aria-sort'),
        firstValue: await page.locator('.ag-center-cols-container .ag-row [col-id="leadership"]').first().innerText(),
    };

    await statGroup.locator('.ag-header-expand-icon:visible').click();
    await page.getByRole('button', { name: /보기 모드/ }).click();
    page.once('dialog', (dialog) => dialog.accept('Ref 캡처'));
    await page.getByText('보관하기', { exact: true }).click();
    output.savedSetting = await page.evaluate(() => ({
        settings: localStorage.getItem('GeneralListDisplaySetting'),
        last: localStorage.getItem('LastUsedSettingsKey_pageNationGeneral'),
    }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.ag-root-wrapper').waitFor();
    await page.locator('.ag-center-cols-container .ag-row').first().waitFor();
    output.reloaded = await measure(page);

    await page.getByRole('button', { name: /보기 모드/ }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '삭제', exact: true }).click();
    output.deletedSetting = await page.evaluate(() => localStorage.getItem('GeneralListDisplaySetting'));

    await writeFile(resolve(artifactRoot, 'computed-dom.json'), `${JSON.stringify(output, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: true, artifactRoot, output })}\n`);
} finally {
    await browser.close();
}
