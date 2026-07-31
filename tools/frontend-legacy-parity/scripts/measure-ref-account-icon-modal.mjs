import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const targetUrl = process.env.REF_ACCOUNT_URL;
const passwordFile = process.env.REF_ACCOUNT_PASSWORD_FILE;
const username = process.env.REF_ACCOUNT_USERNAME ?? 'refuser1';
const outputPath = process.env.REF_ACCOUNT_MODAL_OUTPUT;
const screenshotPath = process.env.REF_ACCOUNT_MODAL_SCREENSHOT;
const viewportWidth = Number.parseInt(process.env.REF_VIEWPORT_WIDTH ?? '1440', 10);
const viewportHeight = Number.parseInt(process.env.REF_VIEWPORT_HEIGHT ?? '900', 10);

if (!targetUrl || !passwordFile || process.env.REF_ALLOW_ICON_DELETE !== '1') {
    throw new Error(
        'REF_ACCOUNT_URL, REF_ACCOUNT_PASSWORD_FILE, and REF_ALLOW_ICON_DELETE=1 are required for the disposable Ref account.'
    );
}

const password = (await readFile(passwordFile, 'utf8')).trim();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
    viewport: { width: viewportWidth, height: viewportHeight },
    deviceScaleFactor: 1,
    locale: 'ko-KR',
    colorScheme: 'dark',
});
const page = await context.newPage();

try {
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    const globalSalt = await page.locator('#global_salt').inputValue();
    const passwordHash = createHash('sha512')
        .update(globalSalt + password + globalSalt)
        .digest('hex');
    const loginResponse = await context.request.post(new URL('api.php?path=Login/LoginByID', targetUrl).toString(), {
        data: { username, password: passwordHash },
    });
    const loginResult = await loginResponse.json();
    if (!loginResponse.ok() || loginResult.result !== true) {
        throw new Error('Ref disposable account login failed.');
    }

    await page.goto(new URL('i_entrance/user_info.php', targetUrl).toString(), {
        waitUntil: 'networkidle',
    });
    await page.locator('#slot_nickname').waitFor({ state: 'visible' });
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#btn_remove_icon').click();
    const modal = page.locator('#chooseServer');
    await modal.waitFor({ state: 'visible' });
    await page.locator('#chooseServerForm input').first().waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);

    const measure = () =>
        page.evaluate(() => {
            const rect = (selector) => {
                const value = document.querySelector(selector).getBoundingClientRect();
                return { x: value.x, y: value.y, width: value.width, height: value.height };
            };
            const style = (selector) => {
                const value = getComputedStyle(document.querySelector(selector));
                return {
                    color: value.color,
                    backgroundColor: value.backgroundColor,
                    borderColor: value.borderColor,
                    borderRadius: value.borderRadius,
                    boxShadow: value.boxShadow,
                    fontFamily: value.fontFamily,
                    fontSize: value.fontSize,
                    fontWeight: value.fontWeight,
                    lineHeight: value.lineHeight,
                    letterSpacing: value.letterSpacing,
                    wordSpacing: value.wordSpacing,
                    whiteSpace: value.whiteSpace,
                    padding: value.padding,
                    outline: value.outline,
                    opacity: value.opacity,
                    transitionDuration: value.transitionDuration,
                    transitionProperty: value.transitionProperty,
                    transitionTimingFunction: value.transitionTimingFunction,
                    transform: value.transform,
                };
            };
            const textLines = (selector) => {
                const root = document.querySelector(selector);
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                const lines = new Map();
                let node = walker.nextNode();
                while (node) {
                    for (let offset = 0; offset < node.textContent.length; offset += 1) {
                        const range = document.createRange();
                        range.setStart(node, offset);
                        range.setEnd(node, offset + 1);
                        const box = range.getBoundingClientRect();
                        if (box.width > 0) {
                            const top = Math.round(box.top);
                            lines.set(top, `${lines.get(top) ?? ''}${node.textContent[offset]}`);
                        }
                    }
                    node = walker.nextNode();
                }
                return [...lines.entries()].sort(([left], [right]) => left - right).map(([, text]) => text);
            };
            return {
                viewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio },
                dialog: rect('#chooseServer .modal-dialog'),
                content: rect('#chooseServer .modal-content'),
                header: rect('#chooseServer .modal-header'),
                title: rect('#chooseServer .modal-title'),
                titleLines: textLines('#chooseServer .modal-title'),
                body: rect('#chooseServer .modal-body'),
                footer: rect('#chooseServer .modal-footer'),
                close: rect('#chooseServer .close'),
                secondary: rect('#chooseServer .btn-secondary'),
                apply: rect('#modal-apply'),
                dialogStyle: style('#chooseServer .modal-content'),
                motionStyle: style('#chooseServer .modal-dialog'),
                titleStyle: style('#chooseServer .modal-title'),
                closeStyle: style('#chooseServer .close'),
                secondaryStyle: style('#chooseServer .btn-secondary'),
                applyStyle: style('#modal-apply'),
                modalStyle: style('#chooseServer'),
                backdropStyle: style('.modal-backdrop'),
                checked: Array.from(document.querySelectorAll('#chooseServerForm input')).map((input) => input.checked),
                labels: Array.from(document.querySelectorAll('#chooseServerForm label')).map((label) =>
                    label.textContent?.trim()
                ),
                activeElement: document.activeElement?.id || document.activeElement?.tagName,
                titleFontMetrics: (() => {
                    const title = document.querySelector('#chooseServer .modal-title');
                    const titleStyle = getComputedStyle(title);
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    context.font = titleStyle.font;
                    return {
                        font: context.font,
                        textWidth: context.measureText('새 아이콘을 적용할 서버를 선택하세요.').width,
                        selectionPrefixWidth: context.measureText('새 아이콘을 적용할 서버를 선택').width,
                        pretendardLoaded: document.fonts.check('20px Pretendard'),
                    };
                })(),
                overflow: {
                    documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
                    dialogFits:
                        document.querySelector('#chooseServer .modal-dialog').scrollWidth <=
                        document.querySelector('#chooseServer .modal-dialog').clientWidth,
                    headerFits:
                        document.querySelector('#chooseServer .modal-header').scrollWidth <=
                        document.querySelector('#chooseServer .modal-header').clientWidth,
                },
            };
        });
    const measured = await measure();

    if (screenshotPath) {
        await page.locator('#chooseServer .modal-content').screenshot({
            path: screenshotPath,
            animations: 'disabled',
        });
    }

    const apply = page.locator('#modal-apply');
    await apply.hover();
    measured.applyHoverStyle = (await measure()).applyStyle;
    await apply.focus();
    measured.applyFocusStyle = (await measure()).applyStyle;
    const applyBox = await apply.boundingBox();
    if (!applyBox) {
        throw new Error('Ref apply button has no rendered box.');
    }
    await page.mouse.move(applyBox.x + applyBox.width / 2, applyBox.y + applyBox.height / 2);
    await page.mouse.down();
    measured.applyActiveStyle = (await measure()).applyStyle;
    await page.mouse.move(5, 5);
    await page.mouse.up();
    await page.locator('#chooseServerForm input').first().focus();
    measured.checkboxFocusStyle = await page
        .locator('#chooseServerForm input')
        .first()
        .evaluate((element) => {
            const value = getComputedStyle(element);
            return { outline: value.outline, opacity: value.opacity };
        });
    await page.keyboard.press('Tab');
    measured.keyboardFocus = {
        activeElement: await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName),
        applyStyle: (await measure()).applyStyle,
    };

    await page.mouse.click(5, 5);
    measured.backdropClickKeepsOpen = await modal.isVisible();
    await page.waitForTimeout(30);
    measured.staticBackdropMotionStyle = (await measure()).motionStyle;
    await page.waitForTimeout(350);
    measured.staticBackdropSettledMotionStyle = (await measure()).motionStyle;
    await page.keyboard.press('Escape');
    measured.escapeKeepsOpen = await modal.isVisible();

    const output = `${JSON.stringify(measured, null, 2)}\n`;
    if (outputPath) {
        await writeFile(outputPath, output);
    } else {
        process.stdout.write(output);
    }
} finally {
    await context.close();
    await browser.close();
}
