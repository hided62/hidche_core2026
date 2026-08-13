import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { chromium } from '@playwright/test';

const baseUrl = process.env.REF_MAIN_URL ?? 'http://127.0.0.1:3400/sam/';
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

    for (const viewport of [
        { name: 'desktop', width: 1000, height: 900 },
        { name: 'mobile', width: 500, height: 900 },
    ]) {
        await page.setViewportSize(viewport);
        await page.goto(new URL('hwe/', baseUrl).toString(), { waitUntil: 'networkidle' });
        await page.locator('.onlineNations').waitFor({ state: 'visible' });
        const measurement = await page.evaluate(() => {
            const inspect = (selector) => {
                const element = document.querySelector(selector);
                if (!(element instanceof HTMLElement)) {
                    throw new Error(`missing ${selector}`);
                }
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return {
                    rect: rect.toJSON(),
                    backgroundColor: style.backgroundColor,
                    backgroundImage: style.backgroundImage,
                    borderTop: style.borderTop,
                    color: style.color,
                    fontFamily: style.fontFamily,
                    fontSize: style.fontSize,
                    fontWeight: style.fontWeight,
                    lineHeight: style.lineHeight,
                    padding: style.padding,
                };
            };
            return {
                container: inspect('#container'),
                gameInfo: inspect('.gameInfo'),
                tournamentStatus: inspect('.subTournamentState'),
                lastExecuted: inspect('.subLastExecuted'),
                onlineNations: inspect('.onlineNations'),
                onlineUsers: inspect('.onlineUsers'),
                nationNotice: inspect('.nationNotice'),
                voteStatus: inspect('.subVoteState'),
            };
        });
        console.log(JSON.stringify({ viewport, measurement }));
    }
} finally {
    await browser.close();
}
