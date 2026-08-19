import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = process.env.REF_PARITY_URL ?? 'http://127.0.0.1:3400/sam/';
const username = process.env.REF_PARITY_USER ?? 'refadmin';
const passwordFile = process.env.REF_PARITY_PASSWORD_FILE;
const artifactRoot = resolve(process.env.REF_PARITY_ARTIFACT_DIR ?? 'test-results/reference-nation-offices');

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

const rect = (element) => {
    const value = element.getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height };
};

const style = (element) => {
    const value = getComputedStyle(element);
    return {
        display: value.display,
        gridTemplateColumns: value.gridTemplateColumns,
        fontFamily: value.fontFamily,
        fontSize: value.fontSize,
        lineHeight: value.lineHeight,
        color: value.color,
        backgroundColor: value.backgroundColor,
        backgroundImage: value.backgroundImage,
        borderTopColor: value.borderTopColor,
        padding: value.padding,
        cursor: value.cursor,
    };
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
        const failedResources = [];
        const consoleErrors = [];
        page.on('response', (response) => {
            if (response.status() >= 400) failedResources.push(`${response.status()} ${response.url()}`);
        });
        page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.push(message.text());
        });
        await login(context, page);
        await page.goto(new URL('hwe/', baseUrl).toString(), { waitUntil: 'networkidle' });

        await page.goto(new URL('hwe/b_myBossInfo.php', baseUrl).toString(), { waitUntil: 'networkidle' });
        const personnel = await page.evaluate(
            ({ rectSource, styleSource }) => {
                const rect = new Function(`return (${rectSource})`)();
                const style = new Function(`return (${styleSource})`)();
                const tables = [...document.querySelectorAll('table')];
                const firstIcon = document.querySelector('.generalIcon');
                const firstSelect = document.querySelector('select');
                const firstButton = document.querySelector('button, input[type="button"]');
                return {
                    body: { rect: rect(document.body), style: style(document.body) },
                    tables: tables.slice(0, 8).map((table) => ({ rect: rect(table), style: style(table) })),
                    icon: firstIcon ? { rect: rect(firstIcon), style: style(firstIcon) } : null,
                    select: firstSelect ? { rect: rect(firstSelect), style: style(firstSelect) } : null,
                    button: firstButton ? { rect: rect(firstButton), style: style(firstButton) } : null,
                    document: {
                        width: document.documentElement.scrollWidth,
                        height: document.documentElement.scrollHeight,
                    },
                };
            },
            { rectSource: rect.toString(), styleSource: style.toString() }
        );
        await page.screenshot({
            path: resolve(artifactRoot, `ref-personnel-${viewport.name}.png`),
            fullPage: true,
        });

        await page.goto(new URL('hwe/v_nationStratFinan.php', baseUrl).toString(), { waitUntil: 'networkidle' });
        try {
            await page.locator('#container').waitFor({ timeout: 10_000 });
        } catch {
            await page.screenshot({
                path: resolve(artifactRoot, `ref-finance-${viewport.name}-error.png`),
                fullPage: true,
            });
            throw new Error(
                `Reference finance failed to mount: ${JSON.stringify({
                    url: page.url(),
                    text: (await page.locator('body').innerText()).slice(0, 500),
                    failedResources,
                    consoleErrors,
                })}`
            );
        }
        const finance = await page.evaluate(
            ({ rectSource, styleSource }) => {
                const rect = new Function(`return (${rectSource})`)();
                const style = new Function(`return (${styleSource})`)();
                const pick = (selector) => {
                    const element = document.querySelector(selector);
                    return element ? { rect: rect(element), style: style(element) } : null;
                };
                return {
                    body: pick('body'),
                    container: pick('#container'),
                    topBar: pick('#container > :first-child'),
                    diplomacyTitle: pick('.diplomacyTitle'),
                    diplomacyRow: pick('.diplomacyTable .tRow'),
                    noticeTitle: pick('.noticeTitle'),
                    noticeForm: pick('#noticeForm'),
                    scoutForm: pick('#scoutMsgForm'),
                    financeTitle: pick('.financeTitle'),
                    financeGrid: pick('.financeTitle + .row'),
                    firstInput: pick('input[type="number"]'),
                    firstButton: pick('button'),
                    document: {
                        width: document.documentElement.scrollWidth,
                        height: document.documentElement.scrollHeight,
                    },
                };
            },
            { rectSource: rect.toString(), styleSource: style.toString() }
        );
        await page.screenshot({
            path: resolve(artifactRoot, `ref-finance-${viewport.name}.png`),
            fullPage: true,
        });
        const editNoticeButton = page.getByRole('button', { name: /국가방침 수정/ });
        let financeEditor = null;
        if ((await editNoticeButton.count()) > 0) {
            await editNoticeButton.click();
            await page.locator('#noticeForm .tiptap-editor .ProseMirror').waitFor();
            const toolbar = page.locator('#noticeForm [role="toolbar"]');
            const imageButton = toolbar.getByRole('button').filter({ has: page.locator('.bi-image') });
            if ((await imageButton.count()) > 0) await imageButton.hover();
            const firstToolbarButton = toolbar.getByRole('button').first();
            await firstToolbarButton.focus();
            financeEditor = await page.evaluate(
                ({ rectSource, styleSource }) => {
                    const rect = new Function(`return (${rectSource})`)();
                    const style = new Function(`return (${styleSource})`)();
                    const form = document.querySelector('#noticeForm');
                    const toolbarElement = form?.querySelector('[role="toolbar"]');
                    const content = form?.querySelector('.tiptap-editor .ProseMirror');
                    const buttons = toolbarElement ? [...toolbarElement.querySelectorAll('button')] : [];
                    const image = buttons.find((button) => button.querySelector('.bi-image'));
                    return {
                        form: form ? { rect: rect(form), style: style(form) } : null,
                        toolbar: toolbarElement
                            ? {
                                  rect: rect(toolbarElement),
                                  style: style(toolbarElement),
                                  scrollWidth: toolbarElement.scrollWidth,
                                  buttonCount: buttons.length,
                                  colorInputCount: toolbarElement.querySelectorAll('input[type="color"]').length,
                              }
                            : null,
                        content: content ? { rect: rect(content), style: style(content) } : null,
                        imageButton: image ? { rect: rect(image), style: style(image) } : null,
                        focused: document.activeElement ? style(document.activeElement) : null,
                    };
                },
                { rectSource: rect.toString(), styleSource: style.toString() }
            );
            await page.screenshot({
                path: resolve(artifactRoot, `ref-finance-editor-${viewport.name}.png`),
                fullPage: true,
            });
        }
        result[viewport.name] = { personnel, finance, financeEditor };
        await context.close();
    }
    await writeFile(resolve(artifactRoot, 'computed-dom.json'), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: true, artifactRoot, viewports: Object.keys(result) })}\n`);
} finally {
    await browser.close();
}
