import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = process.env.REF_MENU_URL ?? 'http://127.0.0.1:3400/sam/';
const username = process.env.REF_MENU_USER ?? 'refuser1';
const passwordFile = process.env.REF_MENU_PASSWORD_FILE;
const artifactRoot = resolve(process.env.REF_MENU_ARTIFACT_DIR ?? 'test-results/reference-ingame-menus');

if (!passwordFile) {
    throw new Error('REF_MENU_PASSWORD_FILE is required.');
}

const password = (await readFile(passwordFile, 'utf8')).trim();
await mkdir(artifactRoot, { recursive: true });

const login = async (context, page) => {
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    const globalSalt = await page.locator('#global_salt').inputValue();
    const passwordHash = createHash('sha512')
        .update(globalSalt + password + globalSalt)
        .digest('hex');
    const response = await context.request.post(new URL('api.php?path=Login/LoginByID', baseUrl).toString(), {
        data: { username, password: passwordHash },
    });
    const result = await response.json();
    if (!response.ok() || result.result !== true) {
        throw new Error('Reference login failed.');
    }
};

const rectAndStyle = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        style: {
            display: style.display,
            gridTemplateColumns: style.gridTemplateColumns,
            fontFamily: style.fontFamily,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            color: style.color,
            backgroundColor: style.backgroundColor,
            backgroundImage: style.backgroundImage,
            borderTopColor: style.borderTopColor,
            borderTopWidth: style.borderTopWidth,
            padding: style.padding,
            margin: style.margin,
            cursor: style.cursor,
        },
    };
};

const measure = async (page, selectors) =>
    page.evaluate(
        ({ selectors, measureSource }) => {
            const measureElement = new Function(`return (${measureSource})`)();
            const result = {};
            for (const [name, selector] of Object.entries(selectors)) {
                const element = document.querySelector(selector);
                result[name] = element ? measureElement(element) : null;
            }
            return {
                elements: result,
                document: {
                    width: document.documentElement.scrollWidth,
                    height: document.documentElement.scrollHeight,
                },
            };
        },
        { selectors, measureSource: rectAndStyle.toString() }
    );

const browser = await chromium.launch({ headless: true });
try {
    const output = {};
    for (const viewport of [
        { name: 'desktop', width: 1000, height: 900 },
        { name: 'mobile', width: 500, height: 900 },
    ]) {
        const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: 1,
            locale: 'ko-KR',
            timezoneId: 'Asia/Seoul',
            colorScheme: 'dark',
        });
        const page = await context.newPage();
        const consoleErrors = [];
        const failedResources = [];
        page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.push(message.text());
        });
        page.on('response', (response) => {
            if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`);
        });
        await login(context, page);
        await page.goto(new URL('hwe/', baseUrl).toString(), { waitUntil: 'networkidle' });

        await page.goto(new URL('hwe/b_myPage.php', baseUrl).toString(), { waitUntil: 'networkidle' });
        await page.locator('#container').waitFor();
        const myPage = await measure(page, {
            body: 'body',
            container: '#container',
            title: '#container > .row:first-child',
            infoColumn: '#container > .row:nth-child(2) > .col:first-child',
            settingsColumn: '#container > .row:nth-child(2) > .col:nth-child(2)',
            saveButton: '#set_my_setting',
            firstSelect: 'select',
            customCss: '#custom_css',
            firstLogTitle: '#generalActionPlate',
        });
        await page.screenshot({ path: resolve(artifactRoot, `ref-my-page-${viewport.name}.png`), fullPage: true });

        await page.goto(new URL('hwe/a_traffic.php', baseUrl).toString(), { waitUntil: 'networkidle' });
        const traffic = await measure(page, {
            body: 'body',
            title: 'body > table:first-of-type',
            chartLayout: 'body > table:nth-of-type(2)',
            refreshChart: 'body > table:nth-of-type(2) > tbody > tr > td:first-child > table',
            onlineChart: 'body > table:nth-of-type(2) > tbody > tr > td:nth-child(2) > table',
            firstBigBar: '.big_bar',
            suspectTable: 'body > table:nth-of-type(3)',
        });
        await page.screenshot({ path: resolve(artifactRoot, `ref-traffic-${viewport.name}.png`), fullPage: true });

        await page.goto(new URL('hwe/a_npcList.php', baseUrl).toString(), { waitUntil: 'networkidle' });
        const npcList = await measure(page, {
            body: 'body',
            title: 'body > table:first-of-type',
            sortSelect: 'select[name="type"]',
            list: 'body > table:nth-of-type(2)',
            header: 'body > table:nth-of-type(2) tr:first-child',
            footer: 'body > table:nth-of-type(3)',
        });
        await page.screenshot({ path: resolve(artifactRoot, `ref-npc-list-${viewport.name}.png`), fullPage: true });

        await page.goto(new URL('hwe/v_battleCenter.php', baseUrl).toString(), { waitUntil: 'networkidle' });
        try {
            await page.locator('#container').waitFor({ timeout: 10_000 });
        } catch {
            throw new Error(
                `Reference battle center failed to mount: ${JSON.stringify({
                    url: page.url(),
                    text: (await page.locator('body').innerText()).slice(0, 500),
                    html: (await page.content()).slice(-1_000),
                    consoleErrors,
                    failedResources,
                })}`
            );
        }
        const battleCenter = await measure(page, {
            body: 'body',
            container: '#container',
            topBar: '#container > :first-child',
            selectorRow: '#container > .row:nth-child(2)',
            previousButton: '#container > .row:nth-child(2) button:first-child',
            firstSelect: '#container > .row:nth-child(2) select:first-of-type',
            generalCard: '.header-cell',
            firstLogHeader: '.header-cell:nth-of-type(1)',
        });
        await page.screenshot({
            path: resolve(artifactRoot, `ref-battle-center-${viewport.name}.png`),
            fullPage: true,
        });
        output[viewport.name] = { myPage, traffic, npcList, battleCenter };
        await context.close();
    }
    await writeFile(resolve(artifactRoot, 'computed-dom.json'), `${JSON.stringify(output, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: true, artifactRoot, viewports: Object.keys(output) })}\n`);
} finally {
    await browser.close();
}
