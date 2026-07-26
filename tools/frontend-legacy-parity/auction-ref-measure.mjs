import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const targetRoot = process.env.REF_AUCTION_URL ?? 'https://dev-sam-ref.hided.net/sam/';
const secretRoot = process.env.REF_SECRET_ROOT;
const username = process.env.REF_USER_ID ?? 'refuser1';
const passwordFile = process.env.REF_PASSWORD_FILE ?? 'user1_password';
const allowGeneralCreate = process.env.REF_CREATE_GENERAL === '1';
const outputRoot = resolve(
    process.env.REF_AUCTION_ARTIFACT_DIR ?? resolve(repositoryRoot, 'test-results/auction-reference')
);

if (!secretRoot) {
    throw new Error('REF_SECRET_ROOT is required.');
}

const password = (await readFile(resolve(secretRoot, passwordFile), 'utf8')).trim();
const viewports = [
    { name: 'desktop', width: 1000, height: 800 },
    { name: 'mobile', width: 500, height: 800 },
];

const login = async (context) => {
    const page = await context.newPage();
    await page.goto(targetRoot, { waitUntil: 'networkidle', timeout: 60_000 });
    const globalSalt = await page.locator('#global_salt').inputValue();
    const clientPasswordHash = createHash('sha512')
        .update(globalSalt + password + globalSalt)
        .digest('hex');
    const response = await context.request.post(new URL('api.php?path=Login/LoginByID', targetRoot).toString(), {
        data: { username, password: clientPasswordHash },
        timeout: 60_000,
    });
    const result = await response.json();
    if (!response.ok() || result.result !== true) {
        throw new Error('Reference login failed.');
    }
    if (allowGeneralCreate) {
        const joinUrl = new URL('hwe/v_join.php', targetRoot).toString();
        await page.goto(joinUrl, { waitUntil: 'networkidle', timeout: 60_000 });
        if (page.url().includes('v_join.php')) {
            const createButton = page.getByRole('button', { name: '장수 생성', exact: true });
            try {
                await createButton.waitFor({ state: 'visible', timeout: 30_000 });
            } catch {
                const pageText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300);
                throw new Error(`Reference general form did not render: ${page.url()} | ${pageText}`);
            }
            page.on('dialog', async (dialog) => dialog.accept());
            await createButton.click();
            await page.waitForURL((url) => !url.pathname.endsWith('/v_join.php'), { timeout: 60_000 });
        }
    }
    await page.close();
};

const roundedRect = (rect) => ({
    x: Math.round(rect.x * 100) / 100,
    y: Math.round(rect.y * 100) / 100,
    width: Math.round(rect.width * 100) / 100,
    height: Math.round(rect.height * 100) / 100,
});

const measurePage = async (page, type) => {
    const diagnostics = [];
    const onPageError = (error) => diagnostics.push(`pageerror: ${error.message}`);
    const onConsole = (message) => {
        if (message.type() === 'error') {
            diagnostics.push(`console: ${message.text()}`);
        }
    };
    const onResponse = (response) => {
        if (response.status() >= 400) {
            diagnostics.push(`http ${response.status()}: ${response.url()}`);
        }
    };
    page.on('pageerror', onPageError);
    page.on('console', onConsole);
    page.on('response', onResponse);
    const relative = type === 'unique' ? 'hwe/v_auction.php?type=unique' : 'hwe/v_auction.php';
    await page.goto(new URL(relative, targetRoot).toString(), { waitUntil: 'networkidle', timeout: 60_000 });
    try {
        await page.locator('#container').waitFor({ state: 'visible', timeout: 30_000 });
    } catch {
        const pageText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300);
        const scripts = await page.locator('script').evaluateAll((elements) =>
            elements.map((element) => ({
                src: element.getAttribute('src'),
                type: element.getAttribute('type'),
                length: element.textContent?.length ?? 0,
            }))
        );
        throw new Error(
            `Reference auction did not render: ${page.url()} | ${await page.title()} | ${pageText} | ${JSON.stringify(scripts)} | ${diagnostics.slice(0, 8).join(' | ')}`
        );
    } finally {
        page.off('pageerror', onPageError);
        page.off('console', onConsole);
        page.off('response', onResponse);
    }
    await page.locator('button').first().waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts.ready);

    const measurement = await page.evaluate(() => {
        const rect = (element) => {
            if (!(element instanceof HTMLElement)) {
                return null;
            }
            const value = element.getBoundingClientRect();
            return { x: value.x, y: value.y, width: value.width, height: value.height };
        };
        const style = (element) => {
            if (!(element instanceof HTMLElement)) {
                return null;
            }
            const value = getComputedStyle(element);
            return {
                color: value.color,
                backgroundColor: value.backgroundColor,
                backgroundImage: value.backgroundImage,
                borderColor: value.borderColor,
                borderWidth: value.borderWidth,
                borderRadius: value.borderRadius,
                fontFamily: value.fontFamily,
                fontSize: value.fontSize,
                fontWeight: value.fontWeight,
                lineHeight: value.lineHeight,
                padding: value.padding,
                cursor: value.cursor,
            };
        };
        const container = document.querySelector('#container');
        const topBar = container?.firstElementChild ?? null;
        const topBarButtons = [...(topBar?.querySelectorAll('button') ?? [])].map((element) => ({
            text: element.textContent?.trim() ?? '',
            rect: rect(element),
            style: style(element),
        }));
        const firstButton = document.querySelector('button');
        const firstInput = [...document.querySelectorAll('input')].find(
            (element) => element.getBoundingClientRect().width > 0
        );
        const firstAuctionRow = document.querySelector('.auctionItem');
        const firstAuctionRowChildren = [...(firstAuctionRow?.children ?? [])].map((element) => ({
            className: element.className,
            rect: rect(element),
            style: style(element),
        }));
        const firstSection = [...document.querySelectorAll('#container > div')].find((element) =>
            ['쌀 구매', '쌀 판매'].includes(element.textContent?.trim() ?? '')
        );
        const directChildren = [...(container?.children ?? [])].slice(0, 12).map((element) => ({
            tag: element.tagName,
            className: element.className,
            text: element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) ?? '',
            rect: rect(element),
        }));
        return {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            document: {
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
            },
            body: { rect: rect(document.body), style: style(document.body) },
            container: { rect: rect(container), style: style(container) },
            topBar: { rect: rect(topBar), style: style(topBar) },
            topBarButtons,
            firstButton: { rect: rect(firstButton), style: style(firstButton) },
            firstInput: { rect: rect(firstInput), style: style(firstInput) },
            firstAuctionRow: { rect: rect(firstAuctionRow), style: style(firstAuctionRow) },
            firstAuctionRowChildren,
            firstSection: { rect: rect(firstSection), style: style(firstSection) },
            directChildren,
        };
    });

    return {
        ...measurement,
        body: {
            ...measurement.body,
            rect: measurement.body.rect ? roundedRect(measurement.body.rect) : null,
        },
        container: {
            ...measurement.container,
            rect: measurement.container.rect ? roundedRect(measurement.container.rect) : null,
        },
        topBar: {
            ...measurement.topBar,
            rect: measurement.topBar.rect ? roundedRect(measurement.topBar.rect) : null,
        },
        topBarButtons: measurement.topBarButtons.map((button) => ({
            ...button,
            rect: button.rect ? roundedRect(button.rect) : null,
        })),
        firstButton: {
            ...measurement.firstButton,
            rect: measurement.firstButton.rect ? roundedRect(measurement.firstButton.rect) : null,
        },
        firstInput: {
            ...measurement.firstInput,
            rect: measurement.firstInput.rect ? roundedRect(measurement.firstInput.rect) : null,
        },
        firstAuctionRow: {
            ...measurement.firstAuctionRow,
            rect: measurement.firstAuctionRow.rect ? roundedRect(measurement.firstAuctionRow.rect) : null,
        },
        firstAuctionRowChildren: measurement.firstAuctionRowChildren.map((child) => ({
            ...child,
            rect: child.rect ? roundedRect(child.rect) : null,
        })),
        firstSection: {
            ...measurement.firstSection,
            rect: measurement.firstSection.rect ? roundedRect(measurement.firstSection.rect) : null,
        },
        directChildren: measurement.directChildren.map((child) => ({
            ...child,
            rect: child.rect ? roundedRect(child.rect) : null,
        })),
    };
};

await mkdir(outputRoot, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const results = {};
try {
    for (const viewport of viewports) {
        const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: 1,
            colorScheme: 'dark',
        });
        try {
            await login(context);
            const page = await context.newPage();
            for (const type of ['resource', 'unique']) {
                results[`${viewport.name}-${type}`] = await measurePage(page, type);
                await page.screenshot({
                    path: resolve(outputRoot, `${viewport.name}-${type}.png`),
                    fullPage: true,
                });
            }
        } finally {
            await context.close();
        }
    }
} finally {
    await browser.close();
}

const outputPath = resolve(outputRoot, 'computed-dom.json');
await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, views: Object.keys(results) }));
