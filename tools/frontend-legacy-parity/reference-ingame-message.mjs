import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { chromium } from '@playwright/test';

const baseUrl = process.env.REF_MESSAGE_URL ?? 'http://127.0.0.1:3400/sam/';
const username = process.env.REF_MESSAGE_USER ?? 'refuser1';
const passwordFile = process.env.REF_MESSAGE_PASSWORD_FILE;
const artifactRoot = process.env.REF_MESSAGE_ARTIFACT_DIR;

if (!passwordFile) {
    throw new Error('REF_MESSAGE_PASSWORD_FILE is required.');
}

const password = (await readFile(passwordFile, 'utf8')).trim();

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

const ensureGeneral = async (page) => {
    await page.goto(new URL('hwe/index.php', baseUrl).toString(), {
        waitUntil: 'networkidle',
        timeout: 60_000,
    });
    if (await page.locator('.MessagePanel').isVisible()) {
        return;
    }

    await page.goto(new URL('hwe/v_join.php', baseUrl).toString(), {
        waitUntil: 'networkidle',
        timeout: 60_000,
    });
    const create = page.getByRole('button', { name: '장수 생성', exact: true });
    await create.waitFor({ state: 'visible', timeout: 30_000 });
    page.once('dialog', (dialog) => dialog.accept());
    await create.click();
    await page.locator('.MessagePanel').waitFor({ state: 'visible', timeout: 60_000 });
};

const measure = async (browser, name, viewport) => {
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
        await ensureGeneral(page);
        await page.locator('.MessagePanel').waitFor({ state: 'visible', timeout: 30_000 });
        await page.locator('.BoardHeader').first().waitFor({ state: 'visible' });
        const mailboxOptions = await page.locator('.MessageInputForm select option').evaluateAll((options) =>
            options.map((option) => ({
                value: option.value,
                label: option.textContent?.trim() ?? '',
                group: option.parentElement?.tagName === 'OPTGROUP' ? option.parentElement.label : '',
                disabled: option.disabled,
            }))
        );
        const marker = `computed-dom-${name}-${Date.now()}`;
        await page.locator('.MessageInputForm select').selectOption('9999');
        await page.locator('.MessageInputForm input').fill(marker);
        await page.getByRole('button', { name: '서신전달&갱신' }).click();
        await page.getByText(marker, { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });

        if (artifactRoot) {
            const path = resolve(artifactRoot, `message-ref-${name}.png`);
            await mkdir(dirname(path), { recursive: true });
            await page.locator('.MessagePanel').screenshot({
                path,
                animations: 'disabled',
            });
        }

        const result = await page.evaluate(() => {
            const rect = (element) => {
                const box = element.getBoundingClientRect();
                return {
                    x: box.x,
                    y: box.y,
                    width: box.width,
                    height: box.height,
                };
            };
            const required = (selector) => {
                const element = document.querySelector(selector);
                if (!element) throw new Error(`Missing reference selector: ${selector}`);
                return element;
            };
            const optionalRect = (selector) => {
                const element = document.querySelector(selector);
                return element ? rect(element) : null;
            };
            const style = (selector) => getComputedStyle(required(selector));
            const input = required('.MessageInputForm input');
            const select = required('.MessageInputForm select');
            const submit = required('#msg_submit-col button');
            const firstPlate = document.querySelector('.msg_plate');
            const firstIcon = document.querySelector('.msg_plate .generalIcon');
            const panelStyle = style('.MessagePanel');
            const headerStyle = style('.BoardHeader');
            const plateStyle = firstPlate ? getComputedStyle(firstPlate) : null;
            const iconStyle = firstIcon ? getComputedStyle(firstIcon) : null;
            return {
                panel: rect(required('.MessagePanel')),
                inputForm: rect(required('.MessageInputForm')),
                select: rect(select),
                input: rect(input),
                submit: rect(submit),
                publicSection: rect(required('.PublicTalk')),
                nationalSection: rect(required('.NationalTalk')),
                privateSection: rect(required('.PrivateTalk')),
                diplomacySection: rect(required('.DiplomacyTalk')),
                firstHeader: rect(required('.BoardHeader')),
                firstPlate: optionalRect('.msg_plate'),
                firstIcon: optionalRect('.msg_plate .generalIcon'),
                computed: {
                    panelDisplay: panelStyle.display,
                    panelColumns: panelStyle.gridTemplateColumns,
                    panelFontSize: panelStyle.fontSize,
                    headerColor: headerStyle.color,
                    headerOutlineWidth: headerStyle.outlineWidth,
                    headerBackgroundImage: headerStyle.backgroundImage,
                    plateBackgroundColor: plateStyle?.backgroundColor ?? null,
                    plateFontSize: plateStyle?.fontSize ?? null,
                    plateMinHeight: plateStyle?.minHeight ?? null,
                    iconObjectFit: iconStyle?.objectFit ?? null,
                },
            };
        });

        const submit = page.locator('#msg_submit-col button');
        await submit.hover();
        const hover = await submit.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
                cursor: style.cursor,
                backgroundColor: style.backgroundColor,
            };
        });
        await submit.focus();
        const focus = await submit.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
                outline: style.outline,
                boxShadow: style.boxShadow,
            };
        });
        const markerPlate = page.locator('.msg_plate').filter({ hasText: marker });
        const deleteButton = markerPlate.locator('.btn-delete-msg');
        if (await deleteButton.isVisible()) {
            page.once('dialog', (dialog) => dialog.accept());
            await deleteButton.click();
        }
        return {
            ...result,
            mailboxOptions,
            interaction: { hover, focus },
        };
    } finally {
        await context.close();
    }
};

const browser = await chromium.launch({ headless: true });
try {
    const measurements = {
        desktop: await measure(browser, 'desktop', { width: 1000, height: 900 }),
        mobile: await measure(browser, 'mobile', { width: 500, height: 900 }),
    };
    process.stdout.write(`${JSON.stringify(measurements, null, 2)}\n`);
} finally {
    await browser.close();
}
