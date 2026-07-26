import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = process.env.REF_RANKING_URL ?? 'https://dev-sam-ref.hided.net/sam/';
const username = process.env.REF_RANKING_USER ?? 'refuser1';
const passwordFile = process.env.REF_RANKING_PASSWORD_FILE;
const artifactRoot = resolve(process.env.REF_RANKING_ARTIFACT_DIR ?? 'test-results/reference-rankings');

if (!passwordFile) {
    throw new Error('REF_RANKING_PASSWORD_FILE is required.');
}

const password = (await readFile(passwordFile, 'utf8')).trim();
await mkdir(artifactRoot, { recursive: true });

const login = async (context, page) => {
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60_000 });
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

const measureRanking = async (page) =>
    page.evaluate(() => {
        const pick = (selector) => {
            const element = document.querySelector(selector);
            if (!element) {
                return null;
            }
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                style: {
                    fontFamily: style.fontFamily,
                    fontSize: style.fontSize,
                    lineHeight: style.lineHeight,
                    backgroundImage: style.backgroundImage,
                    backgroundColor: style.backgroundColor,
                    color: style.color,
                    borderTopColor: style.borderTopColor,
                    borderTopWidth: style.borderTopWidth,
                    borderRadius: style.borderRadius,
                    padding: style.padding,
                    fontWeight: style.fontWeight,
                    cursor: style.cursor,
                    minHeight: style.minHeight,
                    objectFit: style.objectFit,
                },
            };
        };
        const image = document.querySelector('.generalIcon');
        return {
            title: document.title,
            container: pick('#container'),
            rankType: pick('.rankType'),
            rankCell: pick('.rankView li'),
            uniqueCell: pick('.rankView li.no_value'),
            image: image
                ? {
                      ...pick('.generalIcon'),
                      naturalWidth: image.naturalWidth,
                      naturalHeight: image.naturalHeight,
                  }
                : null,
            firstButton: pick('button, input[type="submit"], input[type="button"]'),
            rankSectionCount: document.querySelectorAll('.rankView').length,
            document: {
                width: document.documentElement.scrollWidth,
                height: document.documentElement.scrollHeight,
            },
        };
    });

const browser = await chromium.launch({ headless: true });
try {
    const result = {};
    for (const viewport of [
        { name: 'desktop', width: 1365, height: 768 },
        { name: 'mobile', width: 390, height: 844 },
    ]) {
        const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: 1,
            locale: 'ko-KR',
            timezoneId: 'UTC',
            colorScheme: 'dark',
            ignoreHTTPSErrors: true,
        });
        const page = await context.newPage();
        await login(context, page);
        await page.goto(new URL('hwe/', baseUrl).toString(), { waitUntil: 'networkidle', timeout: 60_000 });

        await page.goto(new URL('hwe/a_bestGeneral.php', baseUrl).toString(), {
            waitUntil: 'networkidle',
            timeout: 60_000,
        });
        await page.locator('#container').waitFor();
        const bestGeneral = await measureRanking(page);
        const userButton = page.getByRole('button', { name: '유저 보기' });
        await userButton.hover();
        bestGeneral.userButtonHover = await userButton.evaluate((element) => {
            const style = getComputedStyle(element);
            return { backgroundColor: style.backgroundColor, cursor: style.cursor };
        });
        await userButton.focus();
        bestGeneral.userButtonFocus = await userButton.evaluate((element) => getComputedStyle(element).outline);
        await page.screenshot({
            path: resolve(artifactRoot, `ref-best-general-${viewport.name}.png`),
            fullPage: true,
            animations: 'disabled',
        });

        await page.goto(new URL('hwe/a_hallOfFame.php', baseUrl).toString(), {
            waitUntil: 'networkidle',
            timeout: 60_000,
        });
        await page.locator('#container').waitFor();
        const hallOfFame = await measureRanking(page);
        const scenario = page.locator('#by_scenario');
        hallOfFame.scenario = await scenario.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                rect: { width: rect.width, height: rect.height },
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
            };
        });
        await scenario.focus();
        hallOfFame.scenarioFocus = await scenario.evaluate((element) => getComputedStyle(element).outline);
        await page.screenshot({
            path: resolve(artifactRoot, `ref-hall-of-fame-${viewport.name}.png`),
            fullPage: true,
            animations: 'disabled',
        });

        result[viewport.name] = { bestGeneral, hallOfFame };
        await context.close();
    }
    await writeFile(resolve(artifactRoot, 'computed-dom.json'), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: true, artifactRoot, viewports: Object.keys(result) })}\n`);
} finally {
    await browser.close();
}
