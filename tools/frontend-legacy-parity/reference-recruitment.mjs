import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { chromium } from '@playwright/test';

const baseUrl = process.env.REF_PARITY_BASE_URL ?? 'http://127.0.0.1:3400/sam/';
const username = process.env.REF_PARITY_USER ?? 'refuser1';
const passwordFile =
    process.env.REF_PARITY_PASSWORD_FILE ??
    '/home/letrhee/sam_rebuild/docker_compose_files/reference/secrets/user1_password';
const artifactDir = process.env.REF_PARITY_ARTIFACT_DIR;
const allowGeneralCreate = process.env.REF_CREATE_GENERAL === '1';
const useStaticFixture = process.env.REF_STATIC_FIXTURE === '1';
const password = useStaticFixture ? null : (await readFile(passwordFile, 'utf8')).trim();
const browser = await chromium.launch({ headless: true });

const staticCrewTypes = [
    {
        id: 1100,
        armType: 1,
        name: '보병',
        reqTech: 0,
        reqYear: 0,
        notAvailable: false,
        attack: 125,
        defence: 175,
        speed: 7,
        avoid: 10,
        baseCost: 10.35,
        baseRice: 10.35,
        img: 'https://sam-image.hided.net/game/crewtype1100.png',
        info: ['표준적인 보병입니다.', '보병은 방어특화입니다.'],
    },
    {
        id: 1101,
        armType: 1,
        name: '정예병',
        reqTech: 1000,
        reqYear: 0,
        notAvailable: true,
        attack: 175,
        defence: 225,
        speed: 8,
        avoid: 20,
        baseCost: 13.8,
        baseRice: 11.5,
        img: 'https://sam-image.hided.net/game/crewtype1101.png',
        info: ['강력하지만 기술이 필요합니다.'],
    },
];

const loadStaticReference = async (page, command) => {
    const commandName = command === 'che_모병' ? '모병' : '징병';
    const procRes = {
        relYear: 20,
        year: 200,
        tech: 1000,
        techLevel: 1,
        startYear: 180,
        goldCoeff: command === 'che_모병' ? 2 : 1,
        leadership: 68,
        fullLeadership: 70,
        armCrewTypes: [{ armType: 1, armName: '보병', values: staticCrewTypes }],
        currentCrewType: 1100,
        crew: 500,
        gold: 12_345,
    };
    const assetBase = new URL('dist_js/hwe_dynamic/vue/', baseUrl).toString();
    const rootAssetBase = new URL('', baseUrl).toString();
    await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=500">` +
            `<link rel="stylesheet" href="${rootAssetBase}d_shared/common.css">` +
            `<link rel="stylesheet" href="${assetBase}vendors.css">` +
            `<link rel="stylesheet" href="${assetBase}common_ts.css">` +
            `<link rel="stylesheet" href="${assetBase}bootstrap.css">` +
            `<link rel="stylesheet" href="${assetBase}v_processing.css">` +
            `<script>var staticValues=${JSON.stringify({
                serverNick: 'hwe',
                serverID: 'hwe',
                commandName,
                turnList: [0],
                currentCity: 1,
                currentNation: 1,
                entryInfo: ['General', command],
                mapName: 'che',
                unitSet: 'che',
            })};var procRes=${JSON.stringify(procRes)};var entryInfo=['General',${JSON.stringify(command)}];</script>` +
            `</head><body><div id="app"></div></body></html>`,
        { waitUntil: 'networkidle' }
    );
    for (const url of [
        `${rootAssetBase}d_shared/common_path.js`,
        `${rootAssetBase}hwe/d_shared/base_map.js`,
        `${assetBase}vendors.js`,
        `${assetBase}common_ts.js`,
        `${assetBase}bootstrap.js`,
        `${assetBase}v_processing.js`,
    ]) {
        await page.addScriptTag({ url });
    }
};

if (artifactDir) await mkdir(artifactDir, { recursive: true });

try {
    const context = await browser.newContext({
        colorScheme: 'dark',
        deviceScaleFactor: 1,
        locale: 'ko-KR',
        timezoneId: 'UTC',
    });
    const page = await context.newPage();
    const diagnostics = [];
    page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.stack ?? error.message}`));
    page.on('console', (message) => {
        if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`);
    });
    if (!useStaticFixture) {
        await page.goto(baseUrl, { waitUntil: 'networkidle' });
        const globalSalt = await page.locator('#global_salt').inputValue();
        const passwordHash = createHash('sha512')
            .update(globalSalt + password + globalSalt)
            .digest('hex');
        const login = await context.request.post(new URL('api.php?path=Login/LoginByID', baseUrl).toString(), {
            data: { username, password: passwordHash },
        });
        const loginResult = await login.json();
        if (!login.ok() || loginResult.result !== true) {
            throw new Error(`reference login failed: HTTP ${login.status()}`);
        }
        await page.goto(new URL('hwe/index.php', baseUrl).toString(), { waitUntil: 'networkidle' });
        if (!(await page.locator('.reservedCommandZone').isVisible()) && allowGeneralCreate) {
            await page.goto(new URL('hwe/v_join.php', baseUrl).toString(), { waitUntil: 'networkidle' });
            const create = page.getByRole('button', { name: '장수 생성', exact: true });
            await create.waitFor({ state: 'visible', timeout: 30_000 });
            page.once('dialog', (dialog) => dialog.accept());
            await create.click();
            await page.locator('.reservedCommandZone').waitFor({ state: 'visible', timeout: 60_000 });
        }
    } else {
        await page.goto(new URL('d_shared/common.css', baseUrl).toString(), { waitUntil: 'networkidle' });
    }

    for (const command of ['che_징병', 'che_모병']) {
        for (const viewport of [
            { name: 'desktop', width: 1000, height: 900 },
            { name: 'mobile', width: 500, height: 900 },
        ]) {
            await page.setViewportSize(viewport);
            if (useStaticFixture) {
                await loadStaticReference(page, command);
            } else {
                const url = new URL('hwe/v_processing.php', baseUrl);
                url.searchParams.set('command', command);
                url.searchParams.set('turnList', '0');
                await page.goto(url.toString(), { waitUntil: 'networkidle' });
            }
            try {
                await page.locator('.crewTypeList').waitFor({ state: 'visible', timeout: 5_000 });
            } catch {
                throw new Error(
                    `reference recruitment page unavailable: ${page.url()} (${await page.title()}) | ${diagnostics
                        .slice(-5)
                        .join(' | ')}`
                );
            }

            const toggle = page.getByRole('button', { name: '선택 할 수 없는 병종도 보기' }).first();
            const unavailableBefore = await page
                .locator('.crewTypeItem')
                .evaluateAll(
                    (rows) =>
                        rows.filter(
                            (row) =>
                                getComputedStyle(row.querySelector('.crewTypeName')).backgroundColor ===
                                'rgb(255, 0, 0)'
                        ).length
                );
            await toggle.hover();
            const toggleHover = await toggle.evaluate((element) => {
                const style = getComputedStyle(element);
                return { backgroundColor: style.backgroundColor, borderColor: style.borderColor, color: style.color };
            });
            await toggle.focus();
            const toggleFocus = await toggle.evaluate((element) => {
                const style = getComputedStyle(element);
                return { outline: style.outline, boxShadow: style.boxShadow };
            });
            await toggle.click();

            const measurement = await page.evaluate(async () => {
                const rect = (element) => element.getBoundingClientRect().toJSON();
                const list = document.querySelector('.crewTypeList');
                const status = document.querySelector('.listFront .bg2');
                const header = document.querySelector('.listHeader');
                const firstRow = document.querySelector('.crewTypeItem');
                const image = firstRow?.querySelector('.crewTypeImg');
                const info = firstRow?.querySelector('.crewTypeInfo');
                const selectedPanel = document.querySelector('.miniCrewPanel');
                if (
                    !(list instanceof HTMLElement) ||
                    !(status instanceof HTMLElement) ||
                    !(header instanceof HTMLElement)
                ) {
                    throw new Error('missing recruitment layout');
                }
                const backgroundImage = image instanceof HTMLElement ? getComputedStyle(image).backgroundImage : '';
                const imageUrl = backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
                const naturalSize = imageUrl
                    ? await new Promise((resolve) => {
                          const probe = new Image();
                          probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
                          probe.onerror = () => resolve(null);
                          probe.src = imageUrl;
                      })
                    : null;
                return {
                    document: {
                        clientWidth: document.documentElement.clientWidth,
                        scrollWidth: document.documentElement.scrollWidth,
                    },
                    list: rect(list),
                    status: rect(status),
                    statusCells: Array.from(status.children, rect),
                    header: rect(header),
                    gridTemplateColumns: getComputedStyle(header).gridTemplateColumns,
                    firstRow: firstRow instanceof HTMLElement ? rect(firstRow) : null,
                    image: image instanceof HTMLElement ? rect(image) : null,
                    imageNaturalSize: naturalSize,
                    info: info instanceof HTMLElement ? rect(info) : null,
                    selectedPanel:
                        selectedPanel instanceof HTMLElement
                            ? { rect: rect(selectedPanel), display: getComputedStyle(selectedPanel).display }
                            : null,
                    statusText: status.textContent?.replace(/\s+/g, ' ').trim(),
                    firstRowText: firstRow?.textContent?.replace(/\s+/g, ' ').trim(),
                    unavailableAfter: Array.from(document.querySelectorAll('.crewTypeItem')).filter(
                        (row) =>
                            getComputedStyle(row.querySelector('.crewTypeName')).backgroundColor === 'rgb(255, 0, 0)'
                    ).length,
                };
            });

            if (artifactDir) {
                await page.screenshot({ path: join(artifactDir, `${command}-${viewport.name}.png`), fullPage: true });
            }
            console.log(
                JSON.stringify({ command, viewport, unavailableBefore, toggleHover, toggleFocus, measurement })
            );
        }
    }
} finally {
    await browser.close();
}
