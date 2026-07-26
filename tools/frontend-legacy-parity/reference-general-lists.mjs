import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = process.env.REF_GENERAL_URL ?? 'http://127.0.0.1:3400/sam/';
const username = process.env.REF_GENERAL_USER ?? 'refuser1';
const passwordFile = process.env.REF_GENERAL_PASSWORD_FILE;
const artifactRoot = resolve(process.env.REF_GENERAL_ARTIFACT_DIR ?? 'test-results/reference-general-lists');
if (!passwordFile) throw new Error('REF_GENERAL_PASSWORD_FILE is required.');
const password = (await readFile(passwordFile, 'utf8')).trim();
await mkdir(artifactRoot, { recursive: true });

const measure = async (page, selectors) =>
    page.evaluate((items) => {
        const result = {};
        for (const [name, selector] of Object.entries(items)) {
            const element = document.querySelector(selector);
            if (!element) {
                result[name] = null;
                continue;
            }
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            result[name] = {
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                style: {
                    fontFamily: style.fontFamily,
                    fontSize: style.fontSize,
                    borderCollapse: style.borderCollapse,
                    backgroundImage: style.backgroundImage,
                    color: style.color,
                },
            };
        }
        return { elements: result, documentWidth: document.documentElement.scrollWidth };
    }, selectors);

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

    const output = {};
    for (const [name, path, selectors] of [
        [
            'generals',
            'hwe/b_myGenInfo.php',
            {
                body: 'body',
                title: 'body > table:first-of-type',
                list: 'body > table:nth-of-type(2)',
                firstRow: 'body > table:nth-of-type(2) tr:nth-child(2)',
            },
        ],
        [
            'secret',
            'hwe/b_genList.php',
            {
                body: 'body',
                title: 'body > table:first-of-type',
                summary: 'body > table:nth-of-type(2)',
                list: '#general_list',
                firstRow: '#general_list tbody tr:first-child',
            },
        ],
    ]) {
        await page.goto(new URL(path, baseUrl).toString(), { waitUntil: 'networkidle' });
        output[name] = await measure(page, selectors);
        await page.screenshot({ path: resolve(artifactRoot, `ref-${name}.png`), fullPage: true });
    }
    await writeFile(resolve(artifactRoot, 'computed-dom.json'), `${JSON.stringify(output, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: true, artifactRoot, output })}\n`);
} finally {
    await browser.close();
}
