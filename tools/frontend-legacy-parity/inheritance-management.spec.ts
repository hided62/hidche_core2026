import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const imageRoot = resolve(repositoryRoot, '../../image');
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
            key: 'che_무기_12_칠성검',
            name: '칠성검(+12)',
            rawName: '칠성검',
            info: '무력을 올려주는 유니크 무기입니다.',
        },
    ],
    availableTargetGenerals: [{ id: 8, name: '조조' }],
    turnTimeZones: ['00:00'],
    isUnited: false,
    currentSpecialWar: 'che_선봉',
    currentStat: { leadership: 70, strength: 45, intel: 85 },
};

const installFixture = async (page: Page, options: { failBuff?: boolean } = {}) => {
    let buffMutationCount = 0;
    await installImages(page);
    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-game-token', 'ga_inherit-visual-token');
        window.localStorage.setItem('sammo-game-profile', 'che');
    });
    await page.route('**/che/api/trpc/**', async (route) => {
        const names = operations(route);
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
                return response([
                    {
                        id: 2,
                        year: 200,
                        month: 4,
                        text: '1000 포인트로 장수 소유자 확인',
                        createdAt: '2026-07-26T00:00:00.000Z',
                    },
                ]);
            }
            if (name === 'join.getConfig') {
                return response({ rules: { stat: { total: 200, min: 10, max: 100 } } });
            }
            if (name === 'inherit.buyHiddenBuff') {
                buffMutationCount += 1;
                return response({ ok: true, remainPoint: 11_800 });
            }
            throw new Error(`Unhandled inheritance fixture operation: ${name}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(result),
        });
    });
    return { buffMutationCount: () => buffMutationCount };
};

test.describe('inheritance management legacy parity', () => {
    test('matches the ref 1000px grid and computed styles on desktop and mobile', async ({ page }) => {
        await installFixture(page);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(gameUrl);
        await expect(page.locator('#container')).toBeVisible();
        await expect(page.locator('#specific-unique')).toHaveValue('che_무기_12_칠성검');

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
        expect(desktop.firstPoint.width).toBeCloseTo(327.3, 0);
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
        await expect.poll(() => buyButton.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');

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
        expect(mobile.firstWidth).toBeCloseTo(482, 0);
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
