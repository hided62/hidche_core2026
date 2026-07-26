import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { chromium } from '@playwright/test';

const targetUrl = process.env.REF_BOARD_URL ?? 'https://dev-sam-ref.hided.net/sam/';
const username = process.env.REF_BOARD_USER ?? 'refuser1';
const passwordFile = process.env.REF_BOARD_PASSWORD_FILE;
const artifactRoot = process.env.REF_BOARD_ARTIFACT_DIR;

if (!passwordFile) {
    throw new Error('REF_BOARD_PASSWORD_FILE is required');
}

const password = (await readFile(passwordFile, 'utf8')).trim();

const login = async (context, page) => {
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60_000 });
    const globalSalt = await page.locator('#global_salt').inputValue();
    const passwordHash = createHash('sha512')
        .update(globalSalt + password + globalSalt)
        .digest('hex');
    const response = await context.request.post(new URL('api.php?path=Login/LoginByID', targetUrl).toString(), {
        data: { username, password: passwordHash },
    });
    const result = await response.json();
    if (!response.ok() || result.result !== true) {
        throw new Error('Reference login failed');
    }
};

const measure = async (browser, name, viewport, isSecret) => {
    const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        locale: 'ko-KR',
        timezoneId: 'UTC',
        ignoreHTTPSErrors: true,
    });
    try {
        const page = await context.newPage();
        await login(context, page);
        const boardUrl = new URL('hwe/v_board.php', targetUrl);
        if (isSecret) {
            boardUrl.searchParams.set('isSecret', 'true');
        }
        await page.goto(boardUrl.toString(), { waitUntil: 'networkidle', timeout: 60_000 });
        await page.locator('.articleFrame').first().waitFor({ state: 'visible' });

        if (artifactRoot) {
            const path = resolve(artifactRoot, `board-ref-${name}.png`);
            await mkdir(dirname(path), { recursive: true });
            await page.screenshot({ path, fullPage: true, animations: 'disabled' });
        }

        const geometry = await page.evaluate(() => {
            const rect = (selector) => {
                const box = document.querySelector(selector).getBoundingClientRect();
                return { x: box.x, y: box.y, width: box.width, height: box.height };
            };
            const pageStyle = getComputedStyle(document.querySelector('#container'));
            const articleText = getComputedStyle(document.querySelector('.articleFrame .text'));
            return {
                title: document.title,
                container: rect('#container'),
                topBar: rect('.back_bar'),
                titleLabel: rect('#newArticle .articleTitle'),
                submitArticle: rect('#submitArticle'),
                articleAuthor: rect('.articleFrame .authorName'),
                articleDate: rect('.articleFrame .date'),
                icon: rect('.articleFrame .generalIcon'),
                commentAuthor: rect('.articleFrame .comment .authorName'),
                submitComment: rect('.articleFrame .submitComment'),
                bottomButton: rect('.bg0[style] .back_btn'),
                font: {
                    family: pageStyle.fontFamily,
                    size: pageStyle.fontSize,
                    lineHeight: pageStyle.lineHeight,
                },
                whiteSpace: articleText.whiteSpace,
                walnut: getComputedStyle(document.querySelector('#newArticle')).backgroundImage,
                green: getComputedStyle(document.querySelector('.articleFrame > .bg1')).backgroundImage,
                blue: getComputedStyle(document.querySelector('.newArticleHeader')).backgroundImage,
                submitStyle: {
                    backgroundColor: getComputedStyle(document.querySelector('#submitArticle')).backgroundColor,
                    borderColor: getComputedStyle(document.querySelector('#submitArticle')).borderColor,
                    color: getComputedStyle(document.querySelector('#submitArticle')).color,
                },
            };
        });
        const submit = page.locator('#submitArticle');
        await submit.hover();
        const hoverBackground = await submit.evaluate((element) => getComputedStyle(element).backgroundColor);
        await submit.focus();
        const focusOutline = await submit.evaluate((element) => getComputedStyle(element).outline);
        return {
            ...geometry,
            submitInteraction: {
                hoverBackground,
                focusOutline,
            },
        };
    } finally {
        await context.close();
    }
};

const browser = await chromium.launch({ headless: true });
try {
    const measurements = {
        desktop: await measure(browser, 'desktop', { width: 1000, height: 800 }, false),
        mobile: await measure(browser, 'mobile', { width: 500, height: 800 }, true),
    };
    process.stdout.write(`${JSON.stringify(measurements, null, 2)}\n`);
} finally {
    await browser.close();
}
