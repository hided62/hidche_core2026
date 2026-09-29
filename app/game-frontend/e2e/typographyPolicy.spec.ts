import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { verifyVerticalAlignment } from '../../../tools/frontend-legacy-parity/verticalAlignment.js';
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

        test(`인사부도 공통 네 단계를 사용한다 ${width}px ${name.label}`, async ({ page }, testInfo) => {
            await page.setViewportSize({ width, height: 900 });
            await install(page, 'personnel', name.general, name.nation);
            await page.goto('nation/personnel');
            await expect(page.locator('.nation-heading')).toContainText(name.nation);
            await expect(page.locator('.chief-entry-copy strong').first()).toHaveText(name.general);
            await waitForFonts(page);
            await expect(page.locator('.nation-heading')).toHaveCSS('font-size', width === 500 ? '16px' : '24px');
            await expect(page.locator('.chief-entry-copy strong').first()).toHaveCSS('font-size', '16px');
            const requests = page.locator('#city-office-requests');
            await expect(requests.locator('.request-row')).toHaveCount(1);
            await expect(requests.locator('.request-row small')).toHaveCSS('font-size', '12px');
            await expect(requests.locator('.request-actions button').first()).toHaveCSS('font-size', '14px');

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

    test(`사령부 12턴 요약은 12px와 겹치지 않는 행을 사용한다 ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await install(page, 'chief', names[0].general, names[0].nation);
        await page.goto('chief-center');
        const row = page.locator('.chief-overview .chief-card.compact .chief-row').first();
        await expect(row).toBeVisible();
        await waitForFonts(page);
        await expect(row).toHaveCSS('font-size', '12px');
        await expect(row).toHaveCSS('line-height', '16px');
        await expect(page.locator('.chief-overview .compact-name').first()).toHaveCSS('font-size', '12px');
        expect((await row.boundingBox())?.height).toBe(16);
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
        await expect(summary.locator('.name_plate').first()).toHaveCSS('font-size', '12px');
        await expect(summary.locator('.crew_plate').first()).toHaveCSS('font-size', '12px');
        await waitForFonts(page);
        await page.screenshot({ path: testInfo.outputPath('battle-log-exception.png'), fullPage: true });
    });
}

for (const width of [500, 1000]) {
    for (const scene of [
        {
            name: 'main',
            route: './',
            selectors: [
                '.general-basic-grid > .cell-label',
                '.general-basic-grid > strong',
                '.city-title',
                '.city-nation',
                '.record-title',
                '.activity-status .status-row',
            ],
        },
        { name: 'personnel', route: 'nation/personnel', selectors: ['.nation-heading', '.personnel-change-button'] },
        { name: 'possession', route: 'join', selectors: ['.npc-token-status'] },
    ]) {
        test(`세로 정렬은 셀 크기와 가로 정렬을 보존한다 ${scene.name} ${width}px`, async ({ page }, testInfo) => {
            await page.setViewportSize({ width, height: 900 });
            await install(page, scene.name, names[0].general, names[0].nation);
            await page.goto(scene.route);
            await verifyVerticalAlignment(page, testInfo, scene.selectors);
        });
    }
}

// Actual page CSS, including the reset and scoped component rules, must implement the ladder.
test('small은 부모 단계에서 내려가고 다섯 번째 크기에서 멈춘다', async ({ page }, testInfo) => {
    await install(page, 'main', names[0].general, names[0].nation);
    await page.goto('./');
    await expect(page.locator('.game-shell__title')).toBeVisible();
    const actual = await page.evaluate(() => {
        const host = document.createElement('section');
        host.id = 'typography-ladder-probe';
        document.body.append(host);
        const result = ['title', 'emphasis', 'normal', 'small'].map((tier) => {
            const parent = document.createElement('div');
            parent.className = `sammo-text-${tier}`;
            parent.innerHTML = '본문<small>보조<span>상속</span><small>중첩<small>최소</small></small></small>';
            host.append(parent);
            return [parent, ...parent.querySelectorAll('small')].map((node) => getComputedStyle(node).fontSize);
        });
        host.remove();
        return result;
    });
    expect(actual).toEqual([
        ['24px', '16px', '14px', '12px'],
        ['16px', '14px', '12px', '10px'],
        ['14px', '12px', '10px', '10px'],
        ['12px', '10px', '10px', '10px'],
    ]);
    await testInfo.attach('small-ladder', { body: JSON.stringify(actual), contentType: 'application/json' });
});

for (const width of [500, 1000]) {
    for (const general of ['가나다라', names[0].general, names[1].general]) {
        test(`명장 이름은 12px를 최대로 칸에 맞게 축소한다 ${width}px ${general.length}자`, async ({
            page,
        }, testInfo) => {
            await page.setViewportSize({ width, height: 900 });
            await install(page, 'best', general, names[0].nation);
            await page.goto('best-general');
            const label = page.locator('.hall-name .sammo-fit-text').first();
            await expect(label).toHaveText(general);
            await waitForFonts(page);
            await expect(label).toHaveAttribute('data-font-fit-max', '12');
            await expect(label).toHaveAttribute('title', general);
            const measured = await label.evaluate((element) => {
                const style = getComputedStyle(element);
                return {
                    size: Number.parseFloat(style.fontSize),
                    overflow: style.overflow,
                    ellipsis: style.textOverflow,
                };
            });
            expect(measured.size).toBeLessThanOrEqual(12);
            expect(measured.size).toBeGreaterThanOrEqual(10);
            if (general.length === 4) expect(measured.size).toBe(12);
            if (general.length === 18) expect(measured.size).toBeLessThan(12);
            expect(measured).toMatchObject({ overflow: 'hidden', ellipsis: 'ellipsis' });
            await page.screenshot({ path: testInfo.outputPath('ranking-fitted-name.png'), fullPage: true });
            await testInfo.attach('fitted-name', { body: JSON.stringify(measured), contentType: 'application/json' });
        });
    }
}

for (const width of [500, 1000]) {
    test(`장수 생성의 보조 설명 class는 small 단계를 덮어쓰지 않는다 ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await install(page, 'join', names[0].general, names[0].nation);
        await page.goto('join');
        await expect(page.locator('.create-form')).toBeVisible();
        await page.locator('.advanced-options > summary').click();
        await waitForFonts(page);
        const steps = await page.locator('small').evaluateAll((elements) =>
            elements
                .filter((element) => element.checkVisibility())
                .map((element) => ({
                    parent: getComputedStyle(element.parentElement!).fontSize,
                    size: getComputedStyle(element).fontSize,
                }))
        );
        expect(steps.length).toBeGreaterThan(0);
        const next: Record<string, string> = {
            '24px': '16px',
            '16px': '14px',
            '14px': '12px',
            '12px': '10px',
            '10px': '10px',
        };
        for (const step of steps) expect(step.size).toBe(next[step.parent]);
        await expect(page.locator('.primary-field small.muted')).toHaveCSS('font-size', '10px');
        await testInfo.attach('join-small-steps', { body: JSON.stringify(steps), contentType: 'application/json' });
    });
}
