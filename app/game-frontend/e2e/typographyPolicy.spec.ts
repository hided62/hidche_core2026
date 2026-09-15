import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { gameProfile, gameTrpcRoute } from './gameTestPaths.js';

// 기존 화면 fixture의 읽기 응답을 고정했다. 실제 계정이나 게임 서버에는 접근하지 않는다.
const fixtureText = await readFile(new URL('./fixtures/typography.json', import.meta.url), 'utf8');
const imageRoot = process.env.FRONTEND_PARITY_IMAGE_ROOT ?? resolve(import.meta.dirname, '../../../../image');
const fontRoot = process.env.TYPOGRAPHY_FONT_ROOT;
const names = [
    { label: '전각9자', general: '가나다라마바사아자', nation: '대한민국천하통일국' },
    { label: '반각18자', general: 'WWWWWWWWWWWWWWWWWW', nation: 'MMMMMMMMMMMMMMMMMM' },
] as const;

const installAssets = async (page: Page): Promise<void> => {
    await page.route(/(?:\/image\/|sam-image\.hided\.net\/)/u, async (route) => {
        const url = new URL(route.request().url());
        const relative = decodeURIComponent(url.pathname.replace(/^\/image\//u, '').replace(/^\//u, ''));
        if (relative.split('/').includes('..')) throw new Error('Invalid typography image path');
        await route.fulfill({
            body: await readFile(resolve(imageRoot, relative)),
            contentType: relative.endsWith('.png')
                ? 'image/png'
                : relative.endsWith('.gif')
                  ? 'image/gif'
                  : 'image/jpeg',
        });
    });
    if (fontRoot) {
        await page.route('**/pretendard.css', (route) =>
            route.fulfill({ path: resolve(fontRoot, 'source.css'), contentType: 'text/css' })
        );
        await page.route('**/*.woff2', (route) =>
            route.fulfill({
                path: resolve(fontRoot, new URL(route.request().url()).pathname.split('/').at(-1)!),
                contentType: 'font/woff2',
            })
        );
    }
};

const install = async (page: Page, scene: string, general: string, nation: string): Promise<void> => {
    const fixtures = JSON.parse(
        fixtureText.replaceAll(names[0].general, general).replaceAll(names[0].nation, nation)
    ) as Record<string, Record<string, unknown>>;
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_typography_fixture');
        localStorage.setItem('sammo-game-profile', profile);
        localStorage.removeItem('sam_customCSS');
    }, gameProfile);
    await page.route('**/events**', (route) => route.abort());
    await page.route(gameTrpcRoute, async (route) => {
        const operations = decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1]!).split(',');
        const responses = operations.map((operation) => {
            const response = fixtures[scene]?.[operation];
            if (response !== undefined) return response;
            if (operation === 'public.recordAccess') return { result: { data: { recorded: true } } };
            throw new Error(`Uncovered typography fixture: ${scene}/${operation}`);
        });
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(responses) });
    });
    await installAssets(page);
};

const waitForFonts = async (page: Page): Promise<void> => {
    await page.evaluate(async () => {
        await document.fonts.ready;
    });
    expect(
        await page.evaluate(() =>
            [...document.fonts].some((font) => font.family.includes('Pretendard') && font.status === 'loaded')
        )
    ).toBe(true);
};

for (const width of [500, 1000]) {
    for (const name of names) {
        test(`메인 주요 이름과 제목을 보존한다 ${width}px ${name.label}`, async ({ page }, testInfo) => {
            await page.setViewportSize({ width, height: 900 });
            await install(page, 'main', name.general, name.nation);
            await page.goto('./');
            const general = page.locator('.battle-general-name:visible').first();
            await expect(general).toContainText(name.general);
            const nation = page.locator('.city-nation:visible').first();
            await expect(nation).toContainText(name.nation);
            await waitForFonts(page);
            for (const label of [general, nation]) {
                expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
            }
            await expect(page.locator('.game-shell__title')).toHaveCSS('font-size', '24px');
            await page.screenshot({ path: testInfo.outputPath('main-maximum-name.png'), fullPage: true });
        });

        test(`네 단계와 밀집 화면 보류 계약 ${width}px ${name.label}`, async ({ page }, testInfo) => {
            await page.setViewportSize({ width, height: 900 });
            await install(page, 'personnel', name.general, name.nation);
            await page.goto('nation/personnel');
            await expect(page.locator('.nation-heading')).toContainText(name.nation);
            await expect(page.locator('.chief-entry-copy strong').first()).toHaveText(name.general);
            await waitForFonts(page);
            await expect(page.locator('.nation-heading')).toHaveCSS('font-size', width === 500 ? '16px' : '24px');
            // 500px의 15px 이름/10px 잠금은 확대 시 표시 이름이 줄어들어 보류했다.
            await expect(page.locator('.chief-entry-copy strong').first()).toHaveCSS(
                'font-size',
                width === 500 ? '15px' : '16px'
            );
            const geometry = await page.locator('#personnel-container').evaluate((element) => ({
                width: element.getBoundingClientRect().width,
                scrollWidth: element.scrollWidth,
                controls: [...element.querySelectorAll<HTMLElement>('.personnel-change-button')].map((button) => {
                    const rect = button.getBoundingClientRect();
                    return { width: rect.width, height: rect.height, text: button.innerText };
                }),
            }));
            expect(geometry.scrollWidth).toBeLessThanOrEqual(width + 1);
            expect(geometry.controls.every((control) => control.width > 0 && control.height >= 24)).toBe(true);
            await testInfo.attach('geometry', {
                body: JSON.stringify(geometry, null, 2),
                contentType: 'application/json',
            });
            await page.screenshot({ path: testInfo.outputPath('personnel-maximum-name.png'), fullPage: true });
        });
    }

    test(`사령부 12턴 요약의 기존 밀도를 유지한다 ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await install(page, 'chief', names[0].general, names[0].nation);
        await page.goto('chief-center');
        const row = page.locator('.chief-overview .chief-card.compact .chief-row').first();
        await expect(row).toBeVisible();
        await waitForFonts(page);
        await expect(row).toHaveCSS('font-size', '8.8px');
        await expect(row).toHaveCSS('line-height', '11.25px');
        await expect(page.locator('.chief-overview .compact-name').first()).toHaveCSS('font-size', '10.4px');
        expect((await row.boundingBox())?.height).toBe(11.25);
        await page.screenshot({ path: testInfo.outputPath('chief-deferred-density.png'), fullPage: true });
    });

    for (const length of [4, 7, 9, 18]) {
        test(`빙의 이름 길이별 축소를 유지한다 ${width}px ${length}자`, async ({ page }, testInfo) => {
            const general = length === 18 ? names[1].general : names[0].general.slice(0, length);
            await page.setViewportSize({ width, height: 900 });
            await install(page, 'possession', general, names[0].nation);
            await page.goto('join');
            const title = page.locator('.npc-card-name').first();
            await expect(title).toHaveText(general);
            await waitForFonts(page);
            await expect(title).toHaveCSS('font-size', length >= 9 ? '12px' : '16px');
            await expect(title).toHaveCSS('white-space', 'nowrap');
            expect((await title.boundingBox())?.height).toBe(25);
            await page.screenshot({ path: testInfo.outputPath('possession-name-length.png'), fullPage: true });
        });
    }

    test(`전투 로그의 장수명과 병력 축소를 유지한다 ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await installAssets(page);
        const log =
            '◆217년 7월:<div class="small_war_log">마귀 ' +
            '<span class="name_plate">【Hide_D】</span> <span class="crew_plate">0(-3714)</span> ' +
            '<span class="war_type_defense">←</span> <span class="crew_plate">3955(-3545)</span> ' +
            '백이 <span class="name_plate">【경국지색소교】</span> 19:57</div>';
        await page.route(gameTrpcRoute, async (route) => {
            const operations = decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1]!).split(
                ','
            );
            const data: Record<string, unknown> = {
                'public.getMapLayout': { mapName: 'che', cityList: [] },
                'public.getCachedMap': {
                    year: 217,
                    month: 7,
                    cityList: [],
                    nationList: [],
                    history: [{ id: 1, text: log }],
                },
                'public.getWorldTrend': { year: 217, month: 7, turnTerm: 10 },
                'public.getNationList': [],
                'public.getGeneralList': [],
            };
            await route.fulfill({
                contentType: 'application/json',
                body: JSON.stringify(operations.map((operation) => ({ result: { data: data[operation] } }))),
            });
        });
        await page.goto('public');
        const summary = page.locator('.small_war_log').first();
        await expect(summary).toContainText('【경국지색소교】');
        await expect(summary).toHaveCSS('font-size', '14px');
        await expect(summary.locator('.name_plate').first()).toHaveCSS('font-size', '10.5px');
        await expect(summary.locator('.crew_plate').first()).toHaveCSS('font-size', '12.6px');
        await waitForFonts(page);
        await page.screenshot({ path: testInfo.outputPath('battle-log-exception.png'), fullPage: true });
    });
}
