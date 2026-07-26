import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = process.env.REF_PARITY_URL ?? 'http://127.0.0.1:3400/sam/';
const username = process.env.REF_PARITY_USER ?? 'refadmin';
const passwordFile = process.env.REF_PARITY_PASSWORD_FILE;
const artifactRoot = resolve(process.env.REF_PARITY_ARTIFACT_DIR ?? 'test-results/reference-current-city');

if (!passwordFile) {
    throw new Error('REF_PARITY_PASSWORD_FILE is required.');
}

const password = (await readFile(passwordFile, 'utf8')).trim();
await mkdir(artifactRoot, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
    const context = await browser.newContext({
        viewport: { width: 1200, height: 900 },
        deviceScaleFactor: 1,
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
        colorScheme: 'dark',
    });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    const globalSalt = await page.locator('#global_salt').inputValue();
    const passwordHash = createHash('sha512')
        .update(globalSalt + password + globalSalt)
        .digest('hex');
    const loginResponse = await context.request.post(new URL('api.php?path=Login/LoginByID', baseUrl).toString(), {
        data: { username, password: passwordHash },
    });
    const loginResult = await loginResponse.json();
    if (!loginResponse.ok() || loginResult.result !== true) {
        throw new Error('Reference login failed.');
    }

    await page.goto(new URL('hwe/', baseUrl).toString(), { waitUntil: 'networkidle' });
    const mapCity = page.locator('a[href*="b_currentCity.php?citylist="]').first();
    const hasMapCity = await mapCity.isVisible({ timeout: 8_000 }).catch(() => false);
    let mapInteraction;
    if (hasMapCity) {
        mapInteraction = await mapCity.evaluate((element) => ({
            available: true,
            href: element.getAttribute('href'),
            cursor: getComputedStyle(element).cursor,
            rect: (() => {
                const box = element.getBoundingClientRect();
                return { x: box.x, y: box.y, width: box.width, height: box.height };
            })(),
        }));
        await mapCity.click();
        await page.waitForLoadState('networkidle');
        if (!page.url().includes('b_currentCity.php?citylist=')) {
            throw new Error(`Reference map click did not open current city: ${page.url()}`);
        }
    } else {
        mapInteraction = {
            available: false,
            pageUrl: page.url(),
            pageTitle: await page.title(),
        };
        await page.goto(new URL('hwe/b_currentCity.php', baseUrl).toString(), { waitUntil: 'networkidle' });
    }

    const measurements = await page.evaluate(() => {
        const measure = (element) => {
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                rect: { x: box.x, y: box.y, width: box.width, height: box.height },
                style: {
                    fontFamily: style.fontFamily,
                    fontSize: style.fontSize,
                    lineHeight: style.lineHeight,
                    color: style.color,
                    backgroundColor: style.backgroundColor,
                    backgroundImage: style.backgroundImage,
                    borderCollapse: style.borderCollapse,
                    padding: style.padding,
                    textAlign: style.textAlign,
                },
            };
        };
        const tables = [...document.querySelectorAll('table')];
        const selector = document.querySelector('#citySelector');
        const stats = tables.find((table) => table.textContent?.includes('90병장'));
        const generals = document.querySelector('#general_list')?.closest('table');
        const firstIcon = document.querySelector('.generalIcon');
        const title = stats?.querySelector('tr:first-child td');
        return {
            body: measure(document.body),
            tables: tables.map(measure),
            selector: selector ? measure(selector) : null,
            stats: stats ? measure(stats) : null,
            generals: generals ? measure(generals) : null,
            firstIcon: firstIcon
                ? {
                      ...measure(firstIcon),
                      naturalWidth: firstIcon.naturalWidth,
                      naturalHeight: firstIcon.naturalHeight,
                  }
                : null,
            title: title ? measure(title) : null,
            document: {
                width: document.documentElement.scrollWidth,
                height: document.documentElement.scrollHeight,
            },
        };
    });

    await page.screenshot({
        path: resolve(artifactRoot, 'reference-current-city-desktop.png'),
        fullPage: true,
        animations: 'disabled',
    });
    await writeFile(
        resolve(artifactRoot, 'reference-current-city-computed-dom.json'),
        `${JSON.stringify({ mapInteraction, currentCity: measurements }, null, 2)}\n`
    );
    process.stdout.write(`${JSON.stringify({ ok: true, artifactRoot })}\n`);
    await context.close();
} finally {
    await browser.close();
}
