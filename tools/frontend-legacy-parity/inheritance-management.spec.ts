import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const imageRoot = process.env.FRONTEND_PARITY_IMAGE_ROOT ?? resolve(repositoryRoot, '../../image');
const artifactRoot = process.env.FRONTEND_PARITY_ARTIFACT_DIR;
const gameUrl = `http://127.0.0.1:${process.env.FRONTEND_PARITY_GAME_PORT ?? '15102'}/che/inherit`;

const response = (data: unknown) => ({ result: { data } });

const operations = (route: Route): string[] => {
    const pathname = new URL(route.request().url()).pathname;
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const installImages = async (page: Page): Promise<void> => {
    await page.route('**/image/**', async (route) => {
        const relative = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/image\//, '');
        for (const candidate of [
            resolve(imageRoot, relative),
            resolve(imageRoot, 'game', relative),
            resolve(imageRoot, 'icons', '22.jpg'),
        ]) {
            try {
                const body = await readFile(candidate);
                await route.fulfill({
                    status: 200,
                    contentType: extname(candidate).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg',
                    body,
                });
                return;
            } catch {
                // 다음 공개 image root 후보를 확인한다.
            }
        }
        await route.abort('failed');
    });
};

const statusFixture = {
    items: {
        previous: 12_000,
        lived_month: 240,
        max_domestic_critical: 80,
        active_action: 35,
        combat: 150,
        sabotage: 60,
        dex: 42,
        unifier: 0,
        tournament: 30,
        betting: 20,
        max_belong: 8,
    },
    totalPoint: 12_665,
    inheritConst: {
        minMonthToAllowInheritItem: 4,
        inheritBornSpecialPoint: 6000,
        inheritBornTurntimePoint: 2500,
        inheritBornCityPoint: 1000,
        inheritBornStatPoint: 1000,
        inheritItemUniqueMinPoint: 5000,
        inheritItemRandomPoint: 3000,
        inheritBuffPoints: [0, 200, 600, 1200, 2000, 3000],
        inheritSpecificSpecialPoint: 4000,
        inheritResetAttrPointBase: [1000, 1000, 2000, 3000],
        inheritCheckOwnerPoint: 1000,
    },
    buffLevels: {
        warAvoidRatio: 0,
        warCriticalRatio: 1,
        warMagicTrialProb: 0,
        domesticSuccessProb: 0,
        domesticFailProb: 0,
        warAvoidRatioOppose: 0,
        warCriticalRatioOppose: 0,
        warMagicTrialProbOppose: 0,
    },
    resetCosts: { resetSpecialWar: 1000, resetTurnTime: 1000 },
    resetLevels: { resetSpecialWar: 0, resetTurnTime: 0 },
    availableSpecialWar: [{ key: 'che_선봉', name: '선봉', info: '공격에 유리합니다.' }],
    availableUnique: [
        {
            key: 'che_명마_07_백마',
            name: '백마(+7)',
            rawName: '백마',
            info: '기동력을 올려주는 유니크 명마입니다.',
            slot: 'horse',
        },
        {
            key: 'che_무기_12_칠성검',
            name: '칠성검(+12)',
            rawName: '칠성검',
            info: '무력을 올려주는 유니크 무기입니다.',
            slot: 'weapon',
        },
        {
            key: 'che_서적_07_논어',
            name: '논어(+7)',
            rawName: '논어',
            info: '지력을 올려주는 유니크 서적입니다.',
            slot: 'book',
        },
        {
            key: 'che_보물_도기',
            name: '도기',
            rawName: '도기',
            info: '전투를 돕는 유니크 도구입니다.',
            slot: 'item',
        },
    ],
    availableTargetGenerals: [{ id: 8, name: '조조' }],
    turnTimeZones: ['00:00'],
    isUnited: false,
    currentSpecialWar: 'che_선봉',
    currentStat: { leadership: 70, strength: 45, intel: 85 },
};

interface InheritanceLogFixture {
    id: number;
    year: number;
    month: number;
    text: string;
    createdAt: string;
}

const installFixture = async (
    page: Page,
    options: { failBuff?: boolean; logPages?: InheritanceLogFixture[][] } = {}
) => {
    let buffMutationCount = 0;
    let resetTurnMutationCount = 0;
    let logRequestCount = 0;
    const uniqueAuctionRequests: unknown[] = [];
    await installImages(page);
    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-game-token', 'ga_inherit-visual-token');
        window.localStorage.setItem('sammo-game-profile', 'che');
    });
    await page.route('**/che/api/trpc/**', async (route) => {
        const names = operations(route);
        const requestBody: unknown = route.request().postData() ? route.request().postDataJSON() : null;
        if (options.failBuff && names.includes('inherit.buyHiddenBuff')) {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: { message: '의도한 유산 구입 오류' } }),
            });
            return;
        }
        const result = names.map((name) => {
            if (name === 'auth.status') return response({ userId: 'frontend-parity-user' });
            if (name === 'inherit.getStatus') return response(statusFixture);
            if (name === 'lobby.info') {
                return response({
                    profile: { id: 'che', scenario: 'default', name: '체섭' },
                    world: { year: 200, month: 4 },
                    myGeneral: { id: 7, name: '유비', nationId: 1 },
                });
            }
            if (name === 'inherit.getLogs') {
                const defaultPage = [
                    {
                        id: 2,
                        year: 200,
                        month: 4,
                        text: '1000 포인트로 장수 소유자 확인',
                        createdAt: '2026-07-26T00:00:00.000Z',
                    },
                ];
                const pages = options.logPages ?? [defaultPage];
                const pageIndex = Math.min(logRequestCount, pages.length - 1);
                logRequestCount += 1;
                return response(pages[pageIndex] ?? []);
            }
            if (name === 'join.getConfig') {
                return response({ rules: { stat: { total: 200, min: 10, max: 100 } } });
            }
            if (name === 'inherit.buyHiddenBuff') {
                buffMutationCount += 1;
                return response({ ok: true, remainPoint: 11_800 });
            }
            if (name === 'inherit.resetTurnTime') {
                resetTurnMutationCount += 1;
                return response({ ok: true, nextTurnTimeBase: 302.5143852464758, nextTurnTimeLabel: '00:05' });
            }
            if (name === 'inherit.openUniqueAuction') {
                uniqueAuctionRequests.push(requestBody);
                return response({ ok: true, auctionId: 31, closeAt: '2026-07-27T00:00:00.000Z' });
            }
            throw new Error(`Unhandled inheritance fixture operation: ${name}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(result),
        });
    });
    return {
        buffMutationCount: () => buffMutationCount,
        resetTurnMutationCount: () => resetTurnMutationCount,
        logRequestCount: () => logRequestCount,
        uniqueAuctionRequests,
    };
};

test.describe('inheritance management legacy parity', () => {
    test('confirms and displays the Ref-compatible pending turn-time base', async ({ page }) => {
        const fixture = await installFixture(page);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(gameUrl);
        await expect(page.locator('#container')).toBeVisible();

        const item = page.locator('.simple-item').filter({ hasText: '랜덤 턴 초기화' });
        const button = item.getByRole('button', { name: '구입' });
        await expect(button).toBeEnabled();
        page.once('dialog', async (dialog) => {
            expect(dialog.message()).toBe('턴 시간을 1000 포인트로 초기화하시겠습니까?');
            await dialog.accept();
        });
        await button.click();

        await expect(item).toContainText('적용 시간: 00:05');
        expect(fixture.resetTurnMutationCount()).toBe(1);
    });

    test('matches the ref 1000px grid and computed styles on desktop and mobile', async ({ page }) => {
        await installFixture(page);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(gameUrl);
        await expect(page.locator('#container')).toBeVisible();
        await expect(page.locator('#specific-unique')).toHaveValue('che_명마_07_백마');
        await expect(page.locator('#specific-unique optgroup')).toHaveCount(4);
        expect(
            await page.locator('#specific-unique optgroup').evaluateAll((groups) =>
                groups.map((group) => ({
                    label: group.getAttribute('label'),
                    values: [...group.querySelectorAll('option')].map((option) => option.value),
                }))
            )
        ).toEqual([
            { label: '명마', values: ['che_명마_07_백마'] },
            { label: '무기', values: ['che_무기_12_칠성검'] },
            { label: '서적', values: ['che_서적_07_논어'] },
            { label: '도구', values: ['che_보물_도기'] },
        ]);

        const desktop = await page.evaluate(() => {
            const rect = (selector: string) => {
                const box = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
                return { x: box.x, width: box.width };
            };
            const container = getComputedStyle(document.querySelector<HTMLElement>('#container')!);
            const title = getComputedStyle(document.querySelector<HTMLElement>('.section-title')!);
            const button = getComputedStyle(document.querySelector<HTMLElement>('.buy-button')!);
            const navigation = getComputedStyle(document.querySelector<HTMLElement>('.top-button')!);
            const secondary = getComputedStyle(document.querySelector<HTMLElement>('.dual-buttons button')!);
            return {
                container: rect('#container'),
                firstPoint: rect('#inherit_sum'),
                fontFamily: container.fontFamily,
                fontSize: container.fontSize,
                backgroundImage: container.backgroundImage,
                titleBackgroundImage: title.backgroundImage,
                buttonBackground: button.backgroundColor,
                buttonBorderBottomWidth: button.borderBottomWidth,
                navigationBackground: navigation.backgroundColor,
                secondaryBackground: secondary.backgroundColor,
            };
        });

        expect(desktop.container.width).toBe(1000);
        expect(desktop.container.x).toBe(140);
        expect(Math.abs(desktop.firstPoint.width - 327.3)).toBeLessThanOrEqual(1);
        expect(desktop.fontFamily).toContain('Pretendard');
        expect(desktop.fontSize).toBe('14px');
        expect(desktop.backgroundImage).toContain('back_walnut.jpg');
        expect(desktop.titleBackgroundImage).toContain('back_green.jpg');
        expect(desktop.buttonBackground).toBe('rgb(55, 90, 127)');
        expect(desktop.buttonBorderBottomWidth).toBe('4px');
        expect(desktop.navigationBackground).toBe('rgb(0, 88, 44)');
        expect(desktop.secondaryBackground).toBe('rgb(68, 68, 68)');

        const buyButton = page.locator('.buy-button').first();
        const beforeHover = await buyButton.evaluate((element) => {
            const style = getComputedStyle(element);
            return { background: style.backgroundColor, borderBottomWidth: style.borderBottomWidth };
        });
        await buyButton.hover();
        const afterHover = await buyButton.evaluate((element) => {
            const style = getComputedStyle(element);
            return { background: style.backgroundColor, borderBottomWidth: style.borderBottomWidth };
        });
        expect(afterHover.background).toBe(beforeHover.background);
        expect(afterHover.borderBottomWidth).toBe('3px');

        await buyButton.hover({ position: { x: 70, y: 20 } });
        await page.mouse.down();
        await expect
            .poll(() => buyButton.evaluate((element) => getComputedStyle(element).borderBottomWidth))
            .toBe('2px');
        await page.mouse.up();

        await buyButton.focus();
        await expect(buyButton).toBeFocused();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        await expect(buyButton).toBeFocused();
        await expect.poll(() => buyButton.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe('none');

        await buyButton.evaluate((element) => element.setAttribute('disabled', ''));
        await expect.poll(() => buyButton.evaluate((element) => getComputedStyle(element).opacity)).toBe('0.65');
        await buyButton.evaluate((element) => element.removeAttribute('disabled'));
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

        if (artifactRoot) {
            await page.screenshot({ path: resolve(artifactRoot, 'inherit-core-desktop.png'), fullPage: true });
        }

        await page.setViewportSize({ width: 500, height: 900 });
        await page.reload();
        await expect(page.locator('#container')).toBeVisible();
        const mobile = await page.evaluate(() => {
            const container = document.querySelector<HTMLElement>('#container')!.getBoundingClientRect();
            const first = document.querySelector<HTMLElement>('#inherit_sum')!.getBoundingClientRect();
            const second = document.querySelector<HTMLElement>('#inherit_previous')!.getBoundingClientRect();
            return {
                containerWidth: container.width,
                firstWidth: first.width,
                stacked: second.y > first.y,
            };
        });
        expect(mobile.containerWidth).toBe(500);
        expect(mobile.firstWidth).toBeCloseTo(484, 0);
        expect(mobile.stacked).toBe(true);

        if (artifactRoot) {
            await page.screenshot({ path: resolve(artifactRoot, 'inherit-core-mobile.png'), fullPage: true });
        }
    });

    test('submits a legacy buff purchase and refreshes status and logs', async ({ page }) => {
        const fixture = await installFixture(page);
        page.on('dialog', (dialog) => dialog.accept());
        await page.goto(gameUrl);
        await page.locator('#buff-warAvoidRatio').fill('1');
        await page.locator('#buff-warAvoidRatio').locator('xpath=../..').getByRole('button', { name: '구입' }).click();
        await expect.poll(fixture.buffMutationCount).toBe(1);
        await expect(page.locator('#inherit_previous_value')).toHaveValue('12,000');
    });

    test('keeps every paged inheritance log reachable by document scrolling', async ({ page }) => {
        const buildPage = (firstId: number, count: number): InheritanceLogFixture[] =>
            Array.from({ length: count }, (_, index) => {
                const id = firstId - index;
                return {
                    id,
                    year: 200,
                    month: 4,
                    text: `유산 포인트 변경 내역 ${id}`,
                    createdAt: `2026-07-${String((id % 27) + 1).padStart(2, '0')}T00:00:00.000Z`,
                };
            });
        const fixture = await installFixture(page, {
            logPages: [buildPage(60, 30), buildPage(30, 30), []],
        });
        await page.setViewportSize({ width: 500, height: 900 });
        await page.goto(gameUrl);
        await expect(page.locator('.log-row')).toHaveCount(30);

        const firstHeight = await page.evaluate(() => document.scrollingElement?.scrollHeight ?? 0);
        const moreButton = page.getByRole('button', { name: '더 가져오기' });
        await moreButton.click();
        await expect(page.locator('.log-row')).toHaveCount(60);
        await expect(page.locator('.log-row').last()).toContainText('유산 포인트 변경 내역 1');
        const expandedHeight = await page.evaluate(() => document.scrollingElement?.scrollHeight ?? 0);
        expect(expandedHeight).toBeGreaterThan(firstHeight);

        await page.evaluate(() => window.scrollTo(0, document.scrollingElement?.scrollHeight ?? 0));
        await expect(page.locator('.log-row').last()).toBeInViewport();
        await expect(moreButton).toBeInViewport();
        expect(
            await page.evaluate(() =>
                Math.abs(
                    window.scrollY + window.innerHeight - (document.scrollingElement?.scrollHeight ?? window.innerHeight)
                )
            )
        ).toBeLessThanOrEqual(1);
        if (artifactRoot) {
            await page.screenshot({ path: resolve(artifactRoot, 'inherit-core-mobile-60-logs.png'), fullPage: true });
        }

        await moreButton.click();
        await expect.poll(fixture.logRequestCount).toBe(3);
        await expect(moreButton).toBeDisabled();
    });

    test('selects a Ref default unique and starts its auction from the inheritance page', async ({ page }) => {
        const fixture = await installFixture(page);
        await page.goto(gameUrl);

        await page.locator('#specific-unique').selectOption('che_서적_07_논어');
        await page.locator('#specific-unique-amount').fill('6000');
        page.once('dialog', async (dialog) => {
            expect(dialog.message()).toBe('6000 포인트로 논어(+7)를 입찰하겠습니까?');
            await dialog.accept();
        });
        await page
            .locator('.shop-item')
            .filter({ has: page.locator('#specific-unique') })
            .getByRole('button', { name: '경매 시작' })
            .click();

        await expect.poll(() => fixture.uniqueAuctionRequests.length).toBe(1);
        expect(JSON.stringify(fixture.uniqueAuctionRequests[0])).toContain('che_서적_07_논어');
        expect(JSON.stringify(fixture.uniqueAuctionRequests[0])).toContain('6000');
        await expect(page.locator('[data-testid="game-toast"][data-feedback-kind="success"]')).toContainText(
            '성공했습니다. 경매장을 확인해주세요.'
        );
    });

    test('keeps controls usable and renders an API mutation error', async ({ page }) => {
        await installFixture(page, { failBuff: true });
        page.on('dialog', (dialog) => dialog.accept());
        await page.goto(gameUrl);
        await page.locator('#buff-warAvoidRatio').fill('1');
        await page.locator('#buff-warAvoidRatio').locator('xpath=../..').getByRole('button', { name: '구입' }).click();
        await expect(page.locator('[role="alert"]')).toBeVisible();
        await expect(page.locator('#buff-warAvoidRatio')).toHaveValue('1');
        await expect(page.locator('#buff-warAvoidRatio')).toBeEnabled();
    });
});
