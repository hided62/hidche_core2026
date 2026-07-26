import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = process.env.REF_PARITY_URL ?? 'http://127.0.0.1:3400/sam/';
const username = process.env.REF_PARITY_USER ?? 'refadmin';
const passwordFile = process.env.REF_PARITY_PASSWORD_FILE;
const artifactRoot = resolve(process.env.REF_PARITY_ARTIFACT_DIR ?? 'test-results/reference-npc-policy');

if (!passwordFile) {
    throw new Error('REF_PARITY_PASSWORD_FILE is required.');
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

const browser = await chromium.launch({ headless: true });
try {
    const result = {};
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
        await login(context, page);
        await page.goto(new URL('hwe/', baseUrl).toString(), { waitUntil: 'networkidle' });
        await page.goto(new URL('hwe/v_NPCControl.php', baseUrl).toString(), { waitUntil: 'networkidle' });
        try {
            await page.locator('#container').waitFor({ timeout: 10_000 });
        } catch {
            throw new Error(
                `Reference NPC policy failed to mount: ${JSON.stringify({
                    url: page.url(),
                    text: (await page.locator('body').innerText()).slice(0, 500),
                })}`
            );
        }
        result[viewport.name] = await page.evaluate(() => {
            const measure = (selector) => {
                const element = document.querySelector(selector);
                if (!element) return null;
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
                        borderColor: style.borderColor,
                        padding: style.padding,
                        margin: style.margin,
                        cursor: style.cursor,
                    },
                };
            };
            return {
                body: measure('body'),
                container: measure('#container'),
                topBackBar: measure('body > :first-child'),
                sectionBar: measure('.section_bar'),
                formList: measure('.form_list'),
                firstField: measure('.form_list > .col'),
                firstInput: measure('input[type="number"]'),
                firstInfoButton: measure('.form_list button'),
                controlBar: measure('.control_bar'),
                resetButton: measure('.reset_btn'),
                submitButton: measure('.submit_btn'),
                priorityGrid: measure('.half_section_left'),
                priorityColumn: measure('.priority-list'),
                priorityItem: measure('.priority-list .list-group-item'),
                helpButton: measure('.priority_info button'),
                document: {
                    width: document.documentElement.scrollWidth,
                    height: document.documentElement.scrollHeight,
                },
            };
        });
        await page.screenshot({
            path: resolve(artifactRoot, `ref-npc-policy-${viewport.name}.png`),
            fullPage: true,
        });
        await context.close();
    }
    await writeFile(resolve(artifactRoot, 'computed-dom.json'), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: true, artifactRoot, viewports: Object.keys(result) })}\n`);
} finally {
    await browser.close();
}
