import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { chromium } from '@playwright/test';

const baseUrl = process.env.REF_GATEWAY_URL ?? 'http://127.0.0.1:3400/sam/';
const username = process.env.REF_USER_ID ?? 'refuser1';
const passwordFile =
    process.env.REF_USER_PASSWORD_FILE ??
    '/home/letrhee/sam_rebuild/docker_compose_files/reference/secrets/user1_password';
const password = (await readFile(passwordFile, 'utf8')).trim();
const browser = await chromium.launch({ headless: true });

try {
    const context = await browser.newContext({
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        locale: 'ko-KR',
        timezoneId: 'UTC',
        viewport: { width: 1000, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    const globalSalt = await page.locator('#global_salt').inputValue();
    const passwordHash = createHash('sha512')
        .update(globalSalt + password + globalSalt)
        .digest('hex');
    const login = await context.request.post(new URL('api.php?path=Login/LoginByID', baseUrl).toString(), {
        data: { username, password: passwordHash },
    });
    if (!login.ok()) {
        throw new Error(`reference login failed: HTTP ${login.status()}`);
    }
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    const logout = page.locator('#btn_logout');
    await logout.waitFor({ state: 'visible' });
    const inspect = async () =>
        logout.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                rect: rect.toJSON(),
                backgroundColor: style.backgroundColor,
                border: style.border,
                borderRadius: style.borderRadius,
                color: style.color,
                cursor: style.cursor,
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                fontWeight: style.fontWeight,
                lineHeight: style.lineHeight,
                padding: style.padding,
            };
        });
    const normal = await inspect();
    await logout.hover();
    const hover = await inspect();
    await logout.focus();
    const focus = await inspect();
    console.log(JSON.stringify({ viewport: page.viewportSize(), normal, hover, focus }));
} finally {
    await browser.close();
}
