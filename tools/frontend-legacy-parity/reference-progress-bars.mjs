import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium } from '@playwright/test';

const baseUrl = process.env.REF_MAIN_URL ?? 'http://127.0.0.1:3400/sam/';
const username = process.env.REF_USER_ID ?? 'refuser1';
const passwordFile =
    process.env.REF_USER_PASSWORD_FILE ??
    '/home/letrhee/sam_rebuild/docker_compose_files/reference/secrets/user1_password';
const artifactRoot = resolve(process.env.REF_PROGRESS_ARTIFACT_DIR ?? 'artifacts/ref-progress-bars');

const password = (await readFile(passwordFile, 'utf8')).trim();
await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
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
    const response = await context.request.post(new URL('api.php?path=Login/LoginByID', baseUrl).toString(), {
        data: { username, password: passwordHash },
    });
    if (!response.ok()) throw new Error(`reference login failed: HTTP ${response.status()}`);
    const loginPayload = await response.json();
    if (loginPayload?.result !== true) {
        throw new Error(`reference login rejected: ${String(loginPayload?.reason ?? loginPayload)}`);
    }

    if (process.env.REF_CREATE_GENERAL === '1') {
        await page.goto(new URL('hwe/v_join.php', baseUrl).toString(), { waitUntil: 'networkidle' });
        const createButton = page.getByRole('button', { name: '장수 생성', exact: true });
        if (await createButton.isVisible()) {
            page.on('dialog', (dialog) => dialog.accept());
            await createButton.click();
            await page.waitForURL(/\/hwe\/?$/u);
        }
    }

    for (const viewport of [
        { name: 'desktop-1000', width: 1000, height: 900 },
        { name: 'mobile-500', width: 500, height: 900 },
    ]) {
        await page.setViewportSize(viewport);
        await page.goto(new URL('hwe/', baseUrl).toString(), { waitUntil: 'networkidle' });
        try {
            await page
                .locator('.city-card-basic .sammo-bar, .bar_out')
                .first()
                .waitFor({ state: 'visible', timeout: 8_000 });
        } catch {
            throw new Error(
                `reference main progress bars missing: ${JSON.stringify({
                    url: page.url(),
                    title: await page.title(),
                    bodyText: (await page.locator('body').innerText()).slice(0, 500),
                    cityCards: await page.locator('.city-card-basic').count(),
                    generalCards: await page.locator('.general-card-basic').count(),
                    legacyBars: await page.locator('.bar_out').count(),
                })}`
            );
        }
        const measurement = await page.evaluate(() => {
            const inspect = (element) => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                const fill = element.querySelector('.sammo-bar-in');
                const fillStyle = fill ? getComputedStyle(fill) : null;
                return {
                    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                    borderTop: style.borderTop,
                    borderBottom: style.borderBottom,
                    backgroundImage: getComputedStyle(element.querySelector('.sammo-bar-base')).backgroundImage,
                    fillWidth: fill?.getBoundingClientRect().width ?? 0,
                    fillBackgroundImage: fillStyle?.backgroundImage ?? '',
                };
            };
            const inspectPanel = (selector) => {
                const element = document.querySelector(selector);
                if (!(element instanceof HTMLElement)) return null;
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                return {
                    text: element.textContent?.replace(/\s+/gu, ' ').trim() ?? '',
                    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                    backgroundColor: style.backgroundColor,
                    color: style.color,
                };
            };
            const cityCard = document.querySelector('.city-card-basic');
            if (!(cityCard instanceof HTMLElement)) throw new Error('reference city card missing');
            return {
                viewport: { width: innerWidth, height: innerHeight },
                city: [...document.querySelectorAll('.city-card-basic .sammo-bar')].map(inspect),
                general: [...document.querySelectorAll('.general-card-basic .sammo-bar')].map(inspect),
                cityCard: cityCard.getBoundingClientRect().toJSON(),
                cityLayout: {
                    gridTemplateColumns: getComputedStyle(cityCard).gridTemplateColumns,
                    title: inspectPanel('.city-card-basic .cityNamePanel'),
                    nation: inspectPanel('.city-card-basic .nationNamePanel'),
                    population: inspectPanel('.city-card-basic .popPanel'),
                    trust: inspectPanel('.city-card-basic .trustPanel'),
                    officers: [4, 3, 2].map((level) => inspectPanel(`.city-card-basic .officer${level}Panel`)),
                },
                generalCard: document.querySelector('.general-card-basic').getBoundingClientRect().toJSON(),
            };
        });
        await Promise.all([
            page.screenshot({ path: resolve(artifactRoot, `ref-${viewport.name}.png`), fullPage: true }),
            writeFile(resolve(artifactRoot, `ref-${viewport.name}.json`), `${JSON.stringify(measurement, null, 2)}\n`, {
                mode: 0o600,
            }),
        ]);
        await chmod(resolve(artifactRoot, `ref-${viewport.name}.png`), 0o600);
        console.log(
            JSON.stringify({
                viewport: viewport.name,
                cityBars: measurement.city.length,
                generalBars: measurement.general.length,
                cityHeight: measurement.city[0]?.rect.height,
                generalHeight: measurement.general[0]?.rect.height,
            })
        );
    }
} finally {
    await browser.close();
}
