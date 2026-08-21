import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';
import { encryptGameSessionToken } from '../../../packages/common/dist/auth/gameToken.js';
import { createGamePostgresConnector } from '../../../packages/infra/dist/index.js';
import { seedScenarioToDatabase } from '../../game-engine/dist/index.js';

const databaseUrl = process.env.CHIEF_COMMAND_MAP_LIVE_DATABASE_URL;
const redisUrl = process.env.CHIEF_COMMAND_MAP_LIVE_REDIS_URL;
const gameTokenSecret = process.env.CHIEF_COMMAND_MAP_LIVE_GAME_SECRET;
const profile = 'chief_command_map_live_integration:2';
const profileId = profile.split(':', 1)[0]!;
const hasLiveFixture = Boolean(databaseUrl && redisUrl && gameTokenSecret);
const actorId = 7_761;
const actorUserId = 'chief-command-map-live-user';
const ownNationId = 9_918;
const targetNationId = 9_919;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const imageRoots = [
    resolve(repositoryRoot, '../image'),
    resolve(repositoryRoot, '../../image'),
    resolve(repositoryRoot, '../sam_rebuild/image'),
    resolve(repositoryRoot, '../../sam_rebuild/image'),
];

const readImage = async (relativePath: string): Promise<Buffer> => {
    if (relativePath.includes('..')) throw new Error(`Unsafe fixture image path: ${relativePath}`);
    for (const root of imageRoots) {
        try {
            return await readFile(resolve(root, relativePath));
        } catch {
            // Product checkout and worktrees have different image-root parents.
        }
    }
    throw new Error(`Fixture image not found: ${relativePath}`);
};

const imageContentType = (relativePath: string): string => {
    if (relativePath.endsWith('.png')) return 'image/png';
    if (relativePath.endsWith('.gif')) return 'image/gif';
    return 'image/jpeg';
};

const installSession = async (page: Page): Promise<void> => {
    const issuedAt = new Date();
    const gameToken = encryptGameSessionToken(
        {
            version: 1,
            profile,
            issuedAt: issuedAt.toISOString(),
            expiresAt: new Date(issuedAt.getTime() + 3_600_000).toISOString(),
            sessionId: `chief-command-map-live-${randomUUID()}`,
            user: {
                id: actorUserId,
                username: actorUserId,
                displayName: '사령부지도검증',
                roles: ['user'],
                canUseGeneralPicture: false,
            },
            sanctions: {},
            identity: {
                kakaoVerified: true,
                canCreateGeneral: true,
                requiresKakaoVerification: false,
                graceEndsAt: null,
            },
        },
        gameTokenSecret!
    );
    await page.addInitScript(
        ({ token, gameProfile }) => {
            localStorage.setItem('sammo-game-token', token);
            localStorage.setItem('sammo-game-profile', gameProfile);
        },
        { token: gameToken, gameProfile: profile }
    );
    await page.route('**/image/**', async (route) => {
        const relativePath = decodeURIComponent(new URL(route.request().url()).pathname.split('/image/')[1] ?? '');
        try {
            await route.fulfill({
                status: 200,
                contentType: imageContentType(relativePath),
                body: await readImage(relativePath),
            });
        } catch {
            await route.fulfill({ status: 404, body: '' });
        }
    });
    await page.route('**/game/**', async (route) => {
        const relativePath = decodeURIComponent(new URL(route.request().url()).pathname.split('/game/')[1] ?? '');
        try {
            await route.fulfill({
                status: 200,
                contentType: imageContentType(relativePath),
                body: await readImage(`game/${relativePath}`),
            });
        } catch {
            await route.fulfill({ status: 404, body: '' });
        }
    });
};

test('shows and operates a city target map through live PostgreSQL, Game API, and production Chromium', async ({
    browser,
    page,
}, testInfo) => {
    test.skip(!hasLiveFixture, 'dedicated PostgreSQL, Redis, and game token secret are required');
    page.setDefaultTimeout(15_000);

    const schema = new URL(databaseUrl!).searchParams.get('schema');
    if (schema !== profileId || !schema.endsWith('chief_command_map_live_integration')) {
        throw new Error('Refusing a non-dedicated chief command map schema.');
    }

    const previousSeed = process.env.INTEGRATION_WORLD_SEED;
    process.env.INTEGRATION_WORLD_SEED = 'chief-command-map-live-seed';
    try {
        await seedScenarioToDatabase({
            scenarioId: 2,
            databaseUrl: databaseUrl!,
            now: new Date('2099-08-01T00:00:00.000Z'),
            gameClockMode: 'manual',
            installOptions: {
                turnTermMinutes: 5,
                joinMode: 'full',
                npcMode: 0,
                showImgLevel: 3,
                serverId: profile,
                season: 1,
            },
        });
    } finally {
        if (previousSeed === undefined) delete process.env.INTEGRATION_WORLD_SEED;
        else process.env.INTEGRATION_WORLD_SEED = previousSeed;
    }

    const connector = createGamePostgresConnector({ url: databaseUrl! });
    await connector.connect();
    try {
        const db = connector.prisma;
        const [ownCity, targetCity] = await db.city.findMany({ orderBy: { id: 'asc' }, take: 2 });
        if (!ownCity || !targetCity) throw new Error('The seeded scenario needs at least two cities.');

        await db.general.deleteMany({ where: { userId: actorUserId } });
        await db.nation.upsert({
            where: { id: ownNationId },
            create: {
                id: ownNationId,
                name: '지도아국',
                color: '#225500',
                capitalCityId: ownCity.id,
                level: 7,
                meta: { gennum: 1, scout: 0 },
            },
            update: {
                name: '지도아국',
                color: '#225500',
                capitalCityId: ownCity.id,
                level: 7,
                meta: { gennum: 1, scout: 0 },
            },
        });
        await db.nation.upsert({
            where: { id: targetNationId },
            create: {
                id: targetNationId,
                name: '지도적국',
                color: '#772222',
                capitalCityId: targetCity.id,
                level: 1,
                meta: { gennum: 0, scout: 0 },
            },
            update: {
                name: '지도적국',
                color: '#772222',
                capitalCityId: targetCity.id,
                level: 1,
                meta: { gennum: 0, scout: 0 },
            },
        });
        await db.city.update({ where: { id: ownCity.id }, data: { nationId: ownNationId, supplyState: 1 } });
        await db.city.update({ where: { id: targetCity.id }, data: { nationId: targetNationId, supplyState: 1 } });
        await db.general.create({
            data: {
                id: actorId,
                userId: actorUserId,
                name: '지도군주',
                nationId: ownNationId,
                cityId: ownCity.id,
                troopId: 0,
                npcState: 0,
                leadership: 80,
                strength: 70,
                intel: 60,
                officerLevel: 12,
                experience: 100,
                dedication: 100,
                gold: 100_000,
                rice: 100_000,
                turnTime: new Date('2099-08-01T00:05:00.000Z'),
                turnTick: null,
                meta: { killturn: 960, belong: 1 },
                penalty: {},
            },
        });

        await installSession(page);
        const mapResponses: number[] = [];
        page.on('response', (response) => {
            if (response.url().includes('world.getMap')) mapResponses.push(response.status());
        });
        await page.goto('chief-center');
        await expect(page.getByRole('heading', { name: '사령부', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
        const picker = page.getByTestId('command-picker');
        await picker.getByRole('button', { name: /^(?:국가:)?특수$/, exact: true }).click();
        await picker.getByRole('button', { name: '천도', exact: true }).click();

        const form = picker.getByTestId('command-argument-form');
        const map = form.getByTestId('command-argument-map');
        await expect(map).toBeVisible();
        await expect.poll(() => mapResponses.length).toBeGreaterThan(0);
        expect(mapResponses.every((status) => status >= 200 && status < 300)).toBe(true);

        const target = map.locator('.city-base').nth(1);
        await expect(target).toBeVisible();
        await target.click();
        await expect(form.getByRole('combobox', { name: '대상 도시' })).toHaveValue(String(targetCity.id));
        await expect(form.getByTestId('command-map-selection-status')).toContainText(`선택 도시${targetCity.name}`);
        await expect(form.getByTestId('command-map-target-summary')).toContainText(targetCity.name);

        const geometry = await map.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return {
                width: rect.width,
                height: rect.height,
                display: getComputedStyle(element).display,
            };
        });
        expect(geometry.width).toBeGreaterThan(400);
        expect(geometry.height).toBeGreaterThan(250);
        expect(geometry.display).not.toBe('none');
        await page.screenshot({ path: testInfo.outputPath('chief-command-city-map-live.png'), fullPage: true });

        await page
            .getByRole('button', { name: '명령 입력 닫기', exact: true })
            .click({ timeout: 2_000 })
            .catch(() => undefined);
        await page.getByRole('button', { name: '2턴 명령 입력', exact: true }).click();
        const nationPicker = page.getByTestId('command-picker');
        await nationPicker.getByRole('button', { name: /^(?:국가:)?외교$/, exact: true }).click();
        await nationPicker.getByRole('button', { name: '선전포고', exact: true }).click();
        const nationForm = nationPicker.getByTestId('command-argument-form');
        const nationMap = nationForm.getByTestId('command-argument-map');
        await expect(nationMap).toBeVisible();
        await nationMap.locator('.city-base').nth(1).click();
        await expect(nationForm.getByRole('combobox', { name: '대상 국가' })).toHaveValue(String(targetNationId));
        await expect(nationForm.getByTestId('command-map-selection-status')).toContainText('선택 국가지도적국');
        await expect(nationForm.getByTestId('command-map-target-summary')).toContainText(
            `지도적국 · 수도 ${targetCity.name} · 도시 1개`
        );
        await page.screenshot({ path: testInfo.outputPath('chief-command-nation-map-live.png'), fullPage: true });

        const mobileContext = await browser.newContext({
            viewport: { width: 500, height: 900 },
            deviceScaleFactor: 1,
            locale: 'ko-KR',
            timezoneId: 'Asia/Seoul',
        });
        const mobilePage = await mobileContext.newPage();
        mobilePage.setDefaultTimeout(15_000);
        await installSession(mobilePage);
        const configuredBaseUrl = testInfo.project.use.baseURL;
        if (typeof configuredBaseUrl !== 'string') throw new Error('The live Chromium baseURL is required.');
        await mobilePage.goto(new URL('chief-center', configuredBaseUrl).href);
        await mobilePage.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
        const mobilePicker = mobilePage.getByTestId('command-picker');
        await mobilePicker.getByRole('button', { name: /^(?:국가:)?특수$/, exact: true }).click();
        await mobilePicker.getByRole('button', { name: '천도', exact: true }).click();
        const mobileMap = mobilePicker.getByTestId('command-argument-map');
        await expect(mobileMap).toBeVisible();
        const mobileGeometry = await mobilePicker.evaluate((element) => ({
            pickerWidth: element.getBoundingClientRect().width,
            pickerOverflow: element.scrollWidth - element.clientWidth,
            documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }));
        expect(mobileGeometry).toEqual({ pickerWidth: 500, pickerOverflow: 0, documentOverflow: 0 });
        await mobilePage.screenshot({
            path: testInfo.outputPath('chief-command-city-map-live-mobile.png'),
            fullPage: true,
        });
        await mobileContext.close();
    } finally {
        await connector.disconnect();
    }
});
