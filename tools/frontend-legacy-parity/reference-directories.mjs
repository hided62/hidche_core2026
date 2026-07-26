import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = process.env.REF_DIRECTORY_URL ?? 'http://127.0.0.1:3400/sam/';
const username = process.env.REF_DIRECTORY_USER ?? 'refuser1';
const passwordFile = process.env.REF_DIRECTORY_PASSWORD_FILE;
const artifactRoot = resolve(process.env.REF_DIRECTORY_ARTIFACT_DIR ?? 'test-results/reference-directories');
if (!passwordFile) throw new Error('REF_DIRECTORY_PASSWORD_FILE is required.');
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
                    display: style.display,
                    fontFamily: style.fontFamily,
                    fontSize: style.fontSize,
                    lineHeight: style.lineHeight,
                    borderCollapse: style.borderCollapse,
                    borderSpacing: style.borderSpacing,
                    borderWidth: style.borderWidth,
                    padding: style.padding,
                    backgroundImage: style.backgroundImage,
                    color: style.color,
                    objectFit: style.objectFit,
                },
                image:
                    element instanceof HTMLImageElement
                        ? { naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight }
                        : null,
            };
        }
        return {
            elements: result,
            documentWidth: document.documentElement.scrollWidth,
            bodyText: document.body.innerText.slice(0, 120),
        };
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
    const passwordHash = createHash('sha512').update(salt + password + salt).digest('hex');
    const login = await context.request.post(new URL('api.php?path=Login/LoginByID', baseUrl).toString(), {
        data: { username, password: passwordHash },
    });
    const loginResult = await login.json();
    if (!login.ok() || loginResult.result !== true) throw new Error('Reference login failed.');

    const output = {};
    const targets = [
        [
            'nation-directory',
            'hwe/a_kingdomList.php',
            {
                body: 'body',
                title: 'body > table:first-of-type',
                firstNation: 'body > table:nth-of-type(2)',
                firstNationTitle: 'body > table:nth-of-type(2) tr:first-child td',
                firstLabel: 'body > table:nth-of-type(2) tr:nth-child(2) td:first-child',
            },
        ],
        [
            'general-directory',
            'hwe/a_genList.php',
            {
                body: 'body',
                title: 'body > table:first-of-type',
                list: 'body > table:nth-of-type(2)',
                header: 'body > table:nth-of-type(2) tr:first-child',
                firstRow: 'body > table:nth-of-type(2) tr:nth-child(2)',
                firstImage: 'body > table:nth-of-type(2) tr:nth-child(2) img',
            },
        ],
    ];
    for (const [name, path, selectors] of targets) {
        await page.goto(new URL(path, baseUrl).toString(), { waitUntil: 'networkidle' });
        output[name] = await measure(page, selectors);
        await page.screenshot({ path: resolve(artifactRoot, `${name}.png`), fullPage: true });
    }
    await writeFile(resolve(artifactRoot, 'computed-dom.json'), `${JSON.stringify(output, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: true, artifactRoot })}\n`);
} finally {
    await browser.close();
}
