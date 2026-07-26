import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium } from '@playwright/test';

const baseUrl = process.env.REF_NATION_BETTING_URL ?? 'https://dev-sam-ref.hided.net/sam/';
const staticBaseUrl = process.env.REF_NATION_BETTING_STATIC_BASE_URL;
const username = process.env.REF_NATION_BETTING_USER ?? 'refuser1';
const passwordFile = process.env.REF_NATION_BETTING_PASSWORD_FILE;
const artifactRoot = resolve(process.env.REF_NATION_BETTING_ARTIFACT_DIR ?? 'test-results/reference-nation-betting');

if (!staticBaseUrl && !passwordFile) {
    throw new Error('REF_NATION_BETTING_PASSWORD_FILE is required.');
}

const password = passwordFile ? (await readFile(passwordFile, 'utf8')).trim() : '';

const bettingList = {
    result: true,
    bettingList: {
        7: {
            id: 7,
            type: 'bettingNation',
            name: '천통국 예상',
            finished: false,
            selectCnt: 2,
            isExclusive: false,
            reqInheritancePoint: true,
            openYearMonth: 2316,
            closeYearMonth: 2340,
            winner: null,
            totalAmount: 800,
        },
    },
    year: 193,
    month: 1,
};

const bettingDetail = {
    result: true,
    bettingInfo: {
        id: 7,
        type: 'bettingNation',
        name: '천통국 예상',
        finished: false,
        selectCnt: 2,
        isExclusive: false,
        reqInheritancePoint: true,
        openYearMonth: 2316,
        closeYearMonth: 2340,
        candidates: [
            { title: '촉', info: '국력: 1200<br>장수 수: 8<br>도시 수: 5', isHtml: true },
            { title: '위', info: '국력: 1100<br>장수 수: 7<br>도시 수: 4', isHtml: true },
            { title: '오', info: '국력: 900<br>장수 수: 6<br>도시 수: 3', isHtml: true },
            { title: '연', info: '국력: 700<br>장수 수: 5<br>도시 수: 2', isHtml: true },
            { title: '양', info: '국력: 650<br>장수 수: 4<br>도시 수: 2', isHtml: true },
            { title: '형', info: '국력: 600<br>장수 수: 3<br>도시 수: 1', isHtml: true },
        ],
        winner: null,
    },
    bettingDetail: [
        ['[-1]', 500],
        ['[0,1]', 200],
        ['[1,2]', 100],
    ],
    myBetting: [['[0,1]', 50]],
    remainPoint: 1200,
    year: 193,
    month: 1,
};

const login = async (context, page) => {
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
    const globalSalt = await page.locator('#global_salt').inputValue();
    // The reference entrance polls install status and can keep the PHP session
    // occupied. Leave it before the login request so the session lock is free.
    await page.goto('about:blank');
    await context.clearCookies();
    const passwordHash = createHash('sha512')
        .update(globalSalt + password + globalSalt)
        .digest('hex');
    const response = await context.request.post(new URL('api.php?path=Login/LoginByID', baseUrl).toString(), {
        data: { username, password: passwordHash },
        timeout: 60_000,
    });
    const result = await response.json();
    if (!response.ok() || result.result !== true) {
        throw new Error('Reference login failed.');
    }
};

const installBettingFixture = async (page) => {
    await page.route('**/api.php*', async (route) => {
        const path = new URL(route.request().url()).searchParams.get('path');
        if (path === 'Betting/GetBettingList') {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bettingList) });
            return;
        }
        if (path === 'Betting/GetBettingDetail') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(bettingDetail),
            });
            return;
        }
        await route.continue();
    });
};

const mountStaticReference = async (page) => {
    const hweUrl = new URL('hwe/', staticBaseUrl);
    const assetUrl = new URL('dist_js/hwe_dynamic/vue/', staticBaseUrl);
    await page.setContent(
        `<!doctype html>
        <html lang="ko">
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=500">
                <base href="${hweUrl}">
                <link rel="stylesheet" href="${new URL('d_shared/common.css', hweUrl)}">
                <link rel="stylesheet" href="${new URL('vendors.css', assetUrl)}">
                <link rel="stylesheet" href="${new URL('common_ts.css', assetUrl)}">
                <link rel="stylesheet" href="${new URL('bootstrap.css', assetUrl)}">
                <link rel="stylesheet" href="${new URL('v_nationBetting.css', assetUrl)}">
            </head>
            <body>
                <div id="app"></div>
                <script src="${new URL('d_shared/common_path.js', hweUrl)}"></script>
                <script src="${new URL('vendors.js', assetUrl)}"></script>
                <script src="${new URL('common_ts.js', assetUrl)}"></script>
                <script src="${new URL('bootstrap.js', assetUrl)}"></script>
                <script src="${new URL('v_nationBetting.js', assetUrl)}"></script>
            </body>
        </html>`,
        { waitUntil: 'networkidle' }
    );
};

const measure = async (browser, viewport) => {
    const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        locale: 'ko-KR',
        timezoneId: 'UTC',
        ignoreHTTPSErrors: true,
    });
    try {
        const page = await context.newPage();
        await installBettingFixture(page);
        if (staticBaseUrl) {
            await mountStaticReference(page);
        } else {
            await login(context, page);
            await page.goto(new URL('hwe/v_nationBetting.php', baseUrl).toString(), {
                waitUntil: 'networkidle',
                timeout: 60_000,
            });
        }
        await page.locator('.bettingItem').click();
        await page.locator('.bettingCandidate').first().waitFor({ state: 'visible' });

        const geometry = await page.locator('#container').evaluate((container) => {
            const rect = (element) => {
                const value = element.getBoundingClientRect();
                return { x: value.x, y: value.y, width: value.width, height: value.height };
            };
            const cards = Array.from(container.querySelectorAll('.bettingCandidate'));
            const firstCard = cards[0];
            const cardStyle = getComputedStyle(firstCard);
            const titleStyle = getComputedStyle(firstCard.querySelector('.title'));
            const optionalRect = (selector) => {
                const element = container.querySelector(selector);
                return element ? rect(element) : null;
            };
            return {
                container: rect(container),
                topBar: rect(container.querySelector('.back_bar')),
                candidateCells: Array.from(container.querySelectorAll('.bettingCandidates > div')).map(rect),
                candidates: cards.map(rect),
                bettingForm: optionalRect('.bettingCandidates + .row'),
                payoutTable: optionalRect('.bettingCandidates + .row + div'),
                bettingList: optionalRect('.bettingList'),
                bottomBar: optionalRect('.bottom_bar, .bg0[style]'),
                cardStyle: {
                    borderWidth: cardStyle.borderWidth,
                    borderRadius: cardStyle.borderRadius,
                    cursor: cardStyle.cursor,
                    fontSize: cardStyle.fontSize,
                    lineHeight: cardStyle.lineHeight,
                },
                titleStyle: {
                    fontWeight: titleStyle.fontWeight,
                    textAlign: titleStyle.textAlign,
                },
            };
        });

        await page.locator('.bettingCandidate').first().click();
        const pickedStyle = await page
            .locator('.bettingCandidate')
            .first()
            .evaluate((candidate) => {
                const style = getComputedStyle(candidate);
                return {
                    borderColor: style.borderColor,
                    outlineWidth: style.outlineWidth,
                    titleWeight: getComputedStyle(candidate.querySelector('.title')).fontWeight,
                };
            });

        const screenshotPath = resolve(artifactRoot, `nation-betting-ref-${viewport.name}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
        return { geometry, pickedStyle, screenshotPath };
    } finally {
        await context.close();
    }
};

await mkdir(artifactRoot, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
    const result = {};
    for (const viewport of [
        { name: 'desktop', width: 1280, height: 900 },
        { name: 'mobile', width: 500, height: 900 },
    ]) {
        result[viewport.name] = await measure(browser, viewport);
    }
    const outputPath = resolve(artifactRoot, 'computed-dom.json');
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: true, artifactRoot, outputPath })}\n`);
} finally {
    await browser.close();
}
