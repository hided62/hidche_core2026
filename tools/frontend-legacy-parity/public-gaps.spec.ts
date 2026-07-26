import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const imageRoots = [
    resolve(repositoryRoot, '../image/game'),
    resolve(repositoryRoot, '../../image/game'),
];
const artifactRoot = process.env.FRONTEND_PARITY_ARTIFACT_DIR;

const response = (data: unknown) => ({ result: { data } });
const errorResponse = (path: string, message: string) => ({
    error: {
        message,
        code: -32000,
        data: { code: 'BAD_REQUEST', httpStatus: 400, path },
    },
});

const operationNames = (route: Route): string[] => {
    const pathname = new URL(route.request().url()).pathname;
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const fulfill = async (route: Route, results: unknown[]) => {
    await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(results),
    });
};

const installImages = async (page: Page) => {
    await page.route('**/image/game/**', async (route) => {
        const filename = new URL(route.request().url()).pathname.split('/').at(-1) ?? '';
        for (const root of imageRoots) {
            try {
                await route.fulfill({
                    status: 200,
                    contentType: 'image/jpeg',
                    body: await readFile(resolve(root, filename)),
                });
                return;
            } catch {
                // Feature worktrees and the main checkout have different image-relative roots.
            }
        }
        await route.abort('failed');
    });
};

const installSession = async (page: Page) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-game-token', 'ga_public_gaps');
        window.localStorage.setItem('sammo-game-profile', 'che:default');
    });
};

const bettingList = {
    result: true,
    bettingList: {
        7: {
            id: 7,
            type: 'bettingNation',
            name: '천통국 예상',
            finished: false,
            selectCnt: 2,
            isExclusive: false,
            reqInheritancePoint: true,
            openYearMonth: 2316,
            closeYearMonth: 2340,
            winner: null,
            totalAmount: 800,
        },
    },
    year: 193,
    month: 1,
};

const bettingDetail = {
    result: true,
    bettingInfo: {
        id: 7,
        type: 'bettingNation',
        name: '천통국 예상',
        finished: false,
        selectCnt: 2,
        isExclusive: false,
        reqInheritancePoint: true,
        openYearMonth: 2316,
        closeYearMonth: 2340,
        candidates: [
            { title: '촉', info: '국력: 1200<br>장수 수: 8<br>도시 수: 5', isHtml: true },
            { title: '위', info: '국력: 1100<br>장수 수: 7<br>도시 수: 4', isHtml: true },
            { title: '오', info: '국력: 900<br>장수 수: 6<br>도시 수: 3', isHtml: true },
            { title: '연', info: '국력: 700<br>장수 수: 5<br>도시 수: 2', isHtml: true },
            { title: '양', info: '국력: 650<br>장수 수: 4<br>도시 수: 2', isHtml: true },
            { title: '형', info: '국력: 600<br>장수 수: 3<br>도시 수: 1', isHtml: true },
        ],
        winner: null,
    },
    bettingDetail: [
        ['[-1]', 500],
        ['[0,1]', 200],
        ['[1,2]', 100],
    ],
    myBetting: [['[0,1]', 50]],
    remainPoint: 1200,
    year: 193,
    month: 1,
};

const installBettingFixture = async (page: Page) => {
    await installImages(page);
    await installSession(page);
    let failBet = true;
    await page.route('**/che/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'lobby.info') {
                return response({ myGeneral: { id: 1, name: '테스트 장수' } });
            }
            if (operation === 'join.getConfig') {
                return response({});
            }
            if (operation === 'betting.getList') {
                return response(bettingList);
            }
            if (operation === 'betting.getDetail') {
                return response(bettingDetail);
            }
            if (operation === 'betting.bet') {
                if (failBet) {
                    failBet = false;
                    return errorResponse(operation, '유산포인트가 충분하지 않습니다.');
                }
                return response({ result: true });
            }
            return errorResponse(operation, `Unhandled fixture operation: ${operation}`);
        });
        await fulfill(route, results);
    });
};

const npcNameRows = [
    {
        id: 1,
        name: '관우',
        npcState: 1,
        ownerName: '악령 관우',
        level: 4,
        nationId: 1,
        nationName: '촉',
        personality: { key: 'che_의리', name: '의리', info: '의리를 중시합니다.' },
        specialDomestic: { key: 'che_상재', name: '상재', info: '상업에 능합니다.' },
        specialWar: { key: 'che_돌격', name: '돌격', info: '돌격에 능합니다.' },
        statTotal: 260,
        leadership: 90,
        strength: 95,
        intelligence: 75,
        experience: 800,
        dedication: 700,
    },
    {
        id: 2,
        name: '조운',
        npcState: 2,
        ownerName: '',
        level: 5,
        nationId: 0,
        nationName: '-',
        personality: { key: 'che_안전', name: '안전', info: '안전을 중시합니다.' },
        specialDomestic: null,
        specialWar: { key: 'che_견고', name: '견고', info: '방어에 능합니다.' },
        statTotal: 270,
        leadership: 95,
        strength: 90,
        intelligence: 85,
        experience: 900,
        dedication: 900,
    },
];

const installNpcFixture = async (page: Page) => {
    await installImages(page);
    let npcCalls = 0;
    await page.route('**/che/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'public.getNpcList') {
                npcCalls += 1;
                if (npcCalls === 3) {
                    return errorResponse(operation, '빙의 일람을 불러오지 못했습니다.');
                }
                return response({
                    sort: npcCalls === 1 ? 1 : 8,
                    generals: npcCalls === 1 ? npcNameRows : [...npcNameRows].reverse(),
                });
            }
            return errorResponse(operation, `Unhandled fixture operation: ${operation}`);
        });
        await fulfill(route, results);
    });
};

test('nation betting matches the legacy desktop geometry and preserves a failed form', async ({ page }) => {
    await installBettingFixture(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('http://127.0.0.1:15102/che/nation-betting');
    await expect(page.getByRole('button', { name: /천통국 예상/ })).toBeVisible();
    await page.getByRole('button', { name: /천통국 예상/ }).click();
    await expect(page.locator('.betting-candidate')).toHaveCount(6);

    const geometry = await page.locator('#nation-betting-container').evaluate((container) => {
        const containerRect = container.getBoundingClientRect();
        const bar = container.querySelector<HTMLElement>('.legacy-top-bar')!.getBoundingClientRect();
        const cards = Array.from(container.querySelectorAll<HTMLElement>('.betting-candidate'));
        const cardStyle = getComputedStyle(cards[0]!);
        return {
            container: { x: containerRect.x, width: containerRect.width },
            bar: { width: bar.width, height: bar.height },
            cardWidths: cards.map((card) => card.getBoundingClientRect().width),
            cardStyle: {
                borderWidth: cardStyle.borderWidth,
                borderRadius: cardStyle.borderRadius,
                cursor: cardStyle.cursor,
                fontSize: cardStyle.fontSize,
                lineHeight: cardStyle.lineHeight,
            },
        };
    });

    expect(geometry.container).toEqual({ x: 140, width: 1000 });
    expect(geometry.bar).toEqual({ width: 1000, height: 32 });
    expect(geometry.cardWidths.every((width) => Math.abs(width - 162) < 1)).toBe(true);
    expect(geometry.cardStyle).toEqual({
        borderWidth: '1px',
        borderRadius: '7px',
        cursor: 'pointer',
        fontSize: '14px',
        lineHeight: '18.2px',
    });

    await page.locator('.betting-candidate').nth(0).click();
    await page.locator('.betting-candidate').nth(1).click();
    const pickedStyle = await page.locator('.betting-candidate').first().evaluate((candidate) => {
        const style = getComputedStyle(candidate);
        return { borderColor: style.borderColor, outlineWidth: style.outlineWidth, titleWeight: getComputedStyle(candidate.querySelector('.candidate-title')!).fontWeight };
    });
    expect(pickedStyle.borderColor).toBe('rgb(255, 255, 255)');
    // Chromium snaps the legacy 1.5px CSS outline to one device pixel at DSF 1.
    expect(pickedStyle.outlineWidth).toBe('1px');
    expect(Number(pickedStyle.titleWeight)).toBeGreaterThanOrEqual(700);

    const amountInput = page.getByLabel('베팅 금액');
    await amountInput.fill('300');
    await page.getByRole('button', { name: '베팅', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('유산포인트가 충분하지 않습니다.');
    await expect(amountInput).toHaveValue('300');
    await expect(page.locator('.betting-candidate.picked')).toHaveCount(2);

    await page.getByRole('button', { name: '베팅', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('베팅했습니다');
    await expect(amountInput).toHaveValue('0');

    if (artifactRoot) {
        await page.screenshot({ path: resolve(artifactRoot, 'nation-betting-core-desktop.png'), fullPage: true });
    }
});

test('nation betting keeps the legacy 500px three-column mobile contract', async ({ page }) => {
    await installBettingFixture(page);
    await page.setViewportSize({ width: 500, height: 900 });
    await page.goto('http://127.0.0.1:15102/che/nation-betting');
    await page.getByRole('button', { name: /천통국 예상/ }).click();
    await expect(page.locator('.betting-candidate')).toHaveCount(6);

    const geometry = await page.locator('#nation-betting-container').evaluate((container) => {
        const rect = container.getBoundingClientRect();
        const cards = Array.from(container.querySelectorAll<HTMLElement>('.betting-candidate'));
        return {
            x: rect.x,
            width: rect.width,
            firstWidth: cards[0]!.getBoundingClientRect().width,
            fourthY: cards[3]!.getBoundingClientRect().y,
            firstY: cards[0]!.getBoundingClientRect().y,
        };
    });
    expect(geometry.x).toBe(0);
    expect(geometry.width).toBe(500);
    expect(geometry.firstWidth).toBeCloseTo(161.328125, 3);
    expect(geometry.fourthY).toBeGreaterThan(geometry.firstY);

    if (artifactRoot) {
        await page.screenshot({ path: resolve(artifactRoot, 'nation-betting-core-mobile.png'), fullPage: true });
    }
});

test('NPC list matches the legacy table geometry, sorting and error retention', async ({ page }) => {
    await installNpcFixture(page);
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto('http://127.0.0.1:15102/che/npc-list');
    await expect(page.locator('.npc-table tbody tr')).toHaveCount(2);

    const geometry = await page.locator('#npc-list-container').evaluate((container) => {
        const containerRect = container.getBoundingClientRect();
        const tableRect = container.querySelector<HTMLElement>('.npc-table')!.getBoundingClientRect();
        const headers = Array.from(container.querySelectorAll<HTMLElement>('.npc-table th'));
        const style = getComputedStyle(headers[0]!);
        return {
            container: { x: containerRect.x, width: containerRect.width },
            tableWidth: tableRect.width,
            headerWidths: headers.map((header) => header.getBoundingClientRect().width),
            headerStyle: {
                height: headers[0]!.getBoundingClientRect().height,
                borderWidth: style.borderWidth,
                padding: style.padding,
                fontSize: style.fontSize,
                lineHeight: style.lineHeight,
            },
        };
    });

    expect(geometry.container).toEqual({ x: 12, width: 1000 });
    expect(geometry.tableWidth).toBe(1000);
    // The legacy width attributes total 974px; Chromium proportionally expands them into the 1000px table.
    expect(geometry.headerWidths).toEqual([
        104.609375,
        104.609375,
        69.734375,
        121.015625,
        69.734375,
        90.25,
        69.734375,
        69.734375,
        69.734375,
        69.734375,
        80,
        80.109375,
    ]);
    expect(geometry.headerStyle).toEqual({
        height: 20,
        borderWidth: '1px',
        padding: '0px',
        fontSize: '14px',
        lineHeight: '18.2px',
    });
    await expect(page.locator('.npc-table tbody tr').first()).toContainText('관우');
    await expect(page.locator('.npc-table tbody tr').first().locator('td').first()).toHaveCSS('color', 'rgb(135, 206, 235)');
    const personality = page.locator('.npc-table tbody tr').first().locator('.trait-tooltip').first();
    await personality.hover();
    await expect(personality.getByRole('tooltip')).toBeVisible();
    expect(await personality.evaluate((element) => getComputedStyle(element).cursor)).toBe('help');

    await page.locator('#npc-list-sort').selectOption('8');
    await page.getByRole('button', { name: '정렬하기' }).click();
    await expect(page.locator('.npc-table tbody tr').first()).toContainText('조운');

    await page.locator('#npc-list-sort').selectOption('7');
    await page.getByRole('button', { name: '정렬하기' }).click();
    await expect(page.getByRole('alert')).toContainText('빙의 일람을 불러오지 못했습니다.');
    await expect(page.locator('#npc-list-sort')).toHaveValue('7');
    await expect(page.locator('.npc-table tbody tr').first()).toContainText('조운');

    if (artifactRoot) {
        await page.screenshot({ path: resolve(artifactRoot, 'npc-list-core-desktop.png'), fullPage: true });
    }
});
