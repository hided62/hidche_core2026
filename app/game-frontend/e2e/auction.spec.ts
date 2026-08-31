import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameProfile, gameTrpcRoute } from './gameTestPaths.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const imageRoots = [
    ...(process.env.FRONTEND_PARITY_IMAGE_ROOT ? [resolve(process.env.FRONTEND_PARITY_IMAGE_ROOT, 'game')] : []),
    resolve(repositoryRoot, '../image/game'),
    resolve(repositoryRoot, '../../image/game'),
];

type AuctionFixture = {
    failResourceBid?: boolean;
    resourceBidCount: number;
    uniqueBidCount: number;
};

const response = (data: unknown) => ({ result: { data } });
const errorResponse = (path: string, message: string) => ({
    error: {
        message,
        code: -32000,
        data: { code: 'BAD_REQUEST', httpStatus: 400, path },
    },
});

const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};
const responseHasOperation = (url: string, operation: string): boolean => {
    const pathname = decodeURIComponent(new URL(url).pathname);
    return pathname
        .slice(pathname.lastIndexOf('/trpc/') + 6)
        .split(',')
        .includes(operation);
};

const readReferenceImage = async (filename: string): Promise<Buffer> => {
    for (const imageRoot of imageRoots) {
        try {
            return await readFile(resolve(imageRoot, filename));
        } catch {
            // The main checkout and nested feature worktrees have different parents.
        }
    }
    throw new Error(`Reference image not found: ${filename}`);
};

const overview = {
    resourceAuctions: [
        {
            id: 1,
            type: 'BUY_RICE',
            targetCode: '1000',
            status: 'OPEN',
            hostGeneralId: 11,
            hostName: '조조',
            isCallerHost: false,
            closeAt: '2026-07-27T02:30:00.000Z',
            detail: {
                title: '쌀 1000 경매',
                amount: 1000,
                isReverse: false,
                startBidAmount: 500,
                finishBidAmount: 1800,
            },
            highestBid: {
                amount: 750,
                bidderName: '관우',
                isCaller: false,
                eventAt: '2026-07-26T01:00:00.000Z',
            },
        },
        {
            id: 2,
            type: 'SELL_RICE',
            targetCode: '900',
            status: 'OPEN',
            hostGeneralId: 7,
            hostName: '유비',
            isCallerHost: true,
            closeAt: '2026-07-27T03:00:00.000Z',
            detail: {
                title: '금 900 경매',
                amount: 900,
                isReverse: false,
                startBidAmount: 600,
                finishBidAmount: 1700,
            },
            highestBid: null,
        },
    ],
    uniqueAuctions: [
        {
            id: 10,
            type: 'UNIQUE_ITEM',
            targetCode: 'che_무기_12_칠성검',
            status: 'OPEN',
            hostGeneralId: null,
            hostName: '청룡',
            isCallerHost: false,
            closeAt: '2026-07-27T04:00:00.000Z',
            detail: {
                title: '칠성검 경매',
                startBidAmount: 5000,
                remainCloseDateExtensionCnt: 1,
                availableLatestBidCloseDate: '2026-07-27T04:30:00.000Z',
            },
            highestBid: {
                amount: 5500,
                bidderName: '백호',
                isCaller: false,
                eventAt: '2026-07-26T02:00:00.000Z',
            },
        },
        {
            id: 9,
            type: 'UNIQUE_ITEM',
            targetCode: 'che_서적_15_손자병법',
            status: 'FINISHED',
            hostGeneralId: null,
            hostName: '현무',
            isCallerHost: true,
            closeAt: '2026-07-25T04:00:00.000Z',
            detail: {
                title: '손자병법 경매',
                startBidAmount: 5000,
                remainCloseDateExtensionCnt: 0,
                availableLatestBidCloseDate: '2026-07-25T04:30:00.000Z',
            },
            highestBid: {
                amount: 6000,
                bidderName: '현무',
                isCaller: true,
                eventAt: '2026-07-25T03:00:00.000Z',
            },
        },
    ],
    callerAlias: '현무',
    remainPoint: 9000,
    recentLogs: [
        {
            id: 1,
            text: '<C>●</>경매 1번 거래가 성사되었습니다.',
            createdAt: '2026-07-25T00:00:00.000Z',
        },
    ],
};

const uniqueDetail = {
    auction: {
        id: 10,
        targetCode: 'che_무기_12_칠성검',
        status: 'OPEN',
        hostName: '청룡',
        isCallerHost: false,
        closeAt: '2026-07-27T04:00:00.000Z',
        detail: {
            title: '칠성검 경매',
            startBidAmount: 5000,
            remainCloseDateExtensionCnt: 1,
            availableLatestBidCloseDate: '2026-07-27T04:30:00.000Z',
        },
    },
    bids: [
        {
            id: 101,
            amount: 5500,
            bidderName: '백호',
            isCaller: false,
            eventAt: '2026-07-26T02:00:00.000Z',
        },
        {
            id: 100,
            amount: 5000,
            bidderName: '현무',
            isCaller: true,
            eventAt: '2026-07-26T01:00:00.000Z',
        },
    ],
    callerAlias: '현무',
    remainPoint: 9000,
};

const installFixture = async (page: Page, state: AuctionFixture) => {
    await page.addInitScript((profile) => {
        window.localStorage.setItem('sammo-game-token', 'ga_auction_playwright');
        window.localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    for (const filename of ['back_walnut.jpg', 'back_green.jpg', 'back_blue.jpg']) {
        await page.route(`**/image/game/${filename}`, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'image/jpeg',
                body: await readReferenceImage(filename),
            });
        });
    }
    await page.route(gameTrpcRoute, async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') {
                return response({ myGeneral: { id: 7, name: '유비' } });
            }
            if (operation === 'join.getConfig') {
                return response({});
            }
            if (operation === 'auction.getOverview') {
                return response(overview);
            }
            if (operation === 'auction.getUniqueDetail') {
                return response(uniqueDetail);
            }
            if (operation === 'auction.bidBuyRice') {
                if (state.failResourceBid) {
                    state.failResourceBid = false;
                    return errorResponse(operation, '금이 부족합니다.');
                }
                state.resourceBidCount += 1;
                return response({ ok: true });
            }
            if (operation === 'auction.bidUnique') {
                state.uniqueBidCount += 1;
                return response({ ok: true });
            }
            if (operation === 'auction.openBuyRice' || operation === 'auction.openSellRice') {
                return response({ auctionId: 20, closeAt: '2026-07-28T00:00:00.000Z' });
            }
            return errorResponse(operation, `Unhandled fixture operation: ${operation}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(results),
        });
    });
};

const gotoAuction = async (page: Page, suffix = 'auction') => {
    const lobbyResponse = page.waitForResponse((response) => responseHasOperation(response.url(), 'lobby.info'));
    await page.goto(suffix);
    await lobbyResponse;
    await expect(page.locator('#container')).toBeVisible();
};

test('resource auction preserves the legacy desktop structure, geometry, and interaction states', async ({ page }) => {
    const state = { failResourceBid: true, resourceBidCount: 0, uniqueBidCount: 0 };
    await installFixture(page, state);
    await page.setViewportSize({ width: 1000, height: 800 });
    await gotoAuction(page);
    await expect(page.getByRole('heading', { name: '경매장', exact: true })).toBeVisible();
    await expect(page.getByText('쌀 구매', { exact: true })).toBeVisible();
    await expect(page.getByText('쌀 판매', { exact: true })).toBeVisible();
    await expect(page.getByText('단가', { exact: true }).first()).toBeVisible();

    const geometry = await page.locator('#container').evaluate((container) => {
        const box = (selector: string) => {
            const rect = container.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        };
        const containerRect = container.getBoundingClientRect();
        const row = container.querySelector<HTMLElement>('.resource-row')!;
        const rowRect = row.getBoundingClientRect();
        const cells = [...row.children].map((cell) => cell.getBoundingClientRect().width);
        const button = container.querySelector<HTMLElement>('.tab-button')!;
        const buttonStyle = getComputedStyle(button);
        return {
            container: { x: containerRect.x, width: containerRect.width },
            topBar: box('.top-back-bar'),
            topClose: box('.top-back-bar .close-button'),
            bottomClose: box('.bottom-bar .close-button'),
            row: { width: rowRect.width, height: rowRect.height },
            cells,
            button: {
                height: button.getBoundingClientRect().height,
                borderRadius: buttonStyle.borderRadius,
                cursor: buttonStyle.cursor,
                fontSize: buttonStyle.fontSize,
            },
        };
    });
    expect(geometry.container).toEqual({ x: 0, width: 1000 });
    expect(geometry.topBar).toMatchObject({ x: 0, width: 1000, height: 32 });
    expect(geometry.bottomClose).toMatchObject({ width: geometry.topClose.width, height: geometry.topClose.height });
    expect(geometry.row).toEqual({ width: 1000, height: 22 });
    expect(geometry.cells[0]).toBeCloseTo(66.66, 1);
    expect(geometry.cells[1]).toBeCloseTo(133.34, 1);
    expect(geometry.cells[6]).toBeCloseTo(200, 1);
    expect(geometry.button).toEqual({
        height: 35.5,
        borderRadius: '5.25px',
        cursor: 'pointer',
        fontSize: '14px',
    });
    await page.screenshot({ path: 'test-results/auction/resource-desktop-initial.png', fullPage: true });

    const firstRow = page.locator('.resource-row.clickable-row').first();
    await firstRow.click();
    const bidInput = page.getByRole('spinbutton', { name: '1번 경매 입찰가' });
    await bidInput.fill('800');
    await page.getByRole('button', { name: '입찰', exact: true }).click();
    await expect(page.locator('[data-testid="game-toast"][data-feedback-kind="error"]')).toContainText(
        '금이 부족합니다.'
    );
    await page.screenshot({ path: 'test-results/auction/resource-desktop-error.png', fullPage: true });
    expect(state.resourceBidCount).toBe(0);

    await page.getByRole('button', { name: '입찰', exact: true }).click();
    await expect(page.locator('[data-testid="game-toast"][data-feedback-kind="success"]')).toContainText(
        '입찰했습니다.'
    );
    expect(state.resourceBidCount).toBe(1);

    await firstRow.hover();
    expect(await firstRow.evaluate((row) => getComputedStyle(row).cursor)).toBe('pointer');
    await page.screenshot({ path: 'test-results/auction/resource-desktop.png', fullPage: true });
});

test('resource auction keeps the legacy 500px two-row grid', async ({ page }) => {
    await installFixture(page, { resourceBidCount: 0, uniqueBidCount: 0 });
    await page.setViewportSize({ width: 500, height: 800 });
    await gotoAuction(page);

    const geometry = await page
        .locator('.resource-row')
        .first()
        .evaluate((row) => {
            const origin = row.getBoundingClientRect();
            const relative = (selector: string) => {
                const rect = row.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
                return { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height };
            };
            return {
                row: { width: origin.width, height: origin.height },
                idx: relative('.idx'),
                host: relative('.host'),
                amount: relative('.amount'),
                close: relative('.close-date'),
            };
        });
    expect(geometry.row).toEqual({ width: 500, height: 43 });
    expect(geometry.idx).toEqual({ x: 0, y: 10.5, width: 41.65625, height: 21 });
    expect(geometry.host).toEqual({ x: 41.65625, y: 0, width: 125, height: 21 });
    expect(geometry.amount).toEqual({ x: 41.65625, y: 21, width: 125, height: 21 });
    expect(geometry.close).toEqual({ x: 416.65625, y: 10.5, width: 83.34375, height: 21 });
    await page.screenshot({ path: 'test-results/auction/resource-mobile.png', fullPage: true });
});

test('unique auction separates ongoing and finished lists and auto-loads the legacy detail', async ({ page }) => {
    const state = { resourceBidCount: 0, uniqueBidCount: 0 };
    await installFixture(page, state);
    await page.setViewportSize({ width: 1000, height: 800 });
    await gotoAuction(page, 'auction?type=unique');

    await expect(page.getByRole('heading', { name: '유니크 경매장', exact: true })).toBeVisible();
    await expect(page.locator('.caller-alias')).toContainText('내 가명: 현무');
    await expect(page.getByRole('heading', { name: '경매 10번 상세' })).toBeVisible();
    await expect(page.getByText('최대지연', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '진행중인 경매 목록' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '종료된 경매 목록' })).toBeVisible();
    await expect(page.getByText('남음', { exact: true })).toBeVisible();
    await expect(page.getByText('소진', { exact: true })).toBeVisible();

    const aliasStyle = await page.locator('.caller-alias strong').evaluate((element) => {
        const style = getComputedStyle(element);
        return { color: style.color, fontWeight: style.fontWeight };
    });
    expect(aliasStyle).toEqual({ color: 'rgb(0, 255, 255)', fontWeight: '700' });

    const input = page.getByRole('spinbutton', { name: '유산포인트' });
    await input.fill('5600');
    page.once('dialog', async (dialog) => {
        expect(dialog.message()).toBe('칠성검 경매에 5600유산포인트를 입찰하시겠습니까?');
        await dialog.accept();
    });
    await page.getByRole('button', { name: '입찰', exact: true }).click();
    await expect(page.locator('[data-testid="game-toast"][data-feedback-kind="success"]')).toContainText(
        '입찰이 완료되었습니다.'
    );
    expect(state.uniqueBidCount).toBe(1);
    await page.screenshot({ path: 'test-results/auction/unique-desktop.png', fullPage: true });
});

test('resource host cannot bid on the auction opened by its own general', async ({ page }) => {
    await installFixture(page, { resourceBidCount: 0, uniqueBidCount: 0 });
    await gotoAuction(page);

    await page.locator('.resource-row.clickable-row').filter({ hasText: '유비' }).click();
    await expect(page.getByRole('button', { name: '입찰', exact: true })).toBeDisabled();
});
