import { expect, test, type Page, type Route } from '@playwright/test';
import { resolve } from 'node:path';

const artifactRoot = process.env.FRONTEND_PARITY_ARTIFACT_DIR;
const gameOrigin = `http://127.0.0.1:${process.env.FRONTEND_PARITY_GAME_PORT ?? '15102'}`;

const response = (data: unknown) => ({ result: { data } });
const errorResponse = (path: string, code: 'BAD_REQUEST' | 'NOT_FOUND', message: string) => ({
    error: {
        message,
        code: -32000,
        data: { code, httpStatus: code === 'NOT_FOUND' ? 404 : 400, path },
    },
});

const operationNames = (route: Route): string[] => {
    const pathname = new URL(route.request().url()).pathname;
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const listPayload = {
    current: { year: 200, month: 1 },
    entries: [
        {
            id: 1,
            serverId: 'hwe_260725_u3uE',
            phase: '훼2기',
            name: '백년01',
            year: 215,
            month: 4,
            color: '#FF0000',
            type: 'che_병가',
            power: 34434,
            gennum: 71,
            citynum: 78,
            l12name: 'ⓜ⑮오리온자리',
            l11name: 'ⓜ②물조명성너프필수',
            l10name: 'ⓜ㉗좌우쌍욍검유비',
            l9name: 'ⓜ②다니엘레메로시',
            l8name: 'ⓜ⑤쿠로',
            l7name: 'ⓜ⑮료우기시키',
            l6name: 'ⓜ㉓랜덤박스',
            l5name: 'ⓜ㉒임사영',
        },
    ],
};

const detailPayload = {
    emperor: {
        id: 1,
        serverId: 'hwe_260725_u3uE',
        winnerNationId: 1,
        phase: '훼2기',
        nationCount: '8 / 17',
        nationName: '백년01, 청해, 백제',
        nationHist: '병가(3), 유가(2)',
        genCount: '71 / 92',
        personalHist: '의리(14), 대담(11)',
        specialHist: '상재(8), 견고(7)',
        name: '백년01',
        type: 'che_병가',
        color: '#FF0000',
        year: 215,
        month: 4,
        power: 34434,
        gennum: 71,
        citynum: 78,
        pop: '2,345,000 / 2,500,000',
        poprate: '93.8 %',
        gold: 120000,
        rice: 150000,
        l12name: 'ⓜ⑮오리온자리',
        l11name: 'ⓜ②물조명성너프필수',
        l10name: 'ⓜ㉗좌우쌍욍검유비',
        l9name: 'ⓜ②다니엘레메로시',
        l8name: 'ⓜ⑤쿠로',
        l7name: 'ⓜ⑮료우기시키',
        l6name: 'ⓜ㉓랜덤박스',
        l5name: 'ⓜ㉒임사영',
        tiger: '관우【10】, 조운【9】',
        eagle: '주유【7】, 육손【6】',
        gen: '오리온자리, 물조명성너프필수, 좌우쌍욍검유비',
        history: ['<C>●</><Y><b>【통일】</b></><D><b>백년01</b></>이 전토를 통일하였습니다.'],
    },
    nations: [
        {
            archiveId: 3,
            nation: 1,
            isWinner: true,
            name: '백년01',
            color: '#FF0000',
            type: 'che_병가',
            typeName: '병가',
            level: 7,
            levelName: '황제',
            tech: 4000,
            maxPower: 34434,
            maxCrew: 120000,
            maxCities: ['낙양', '장안', '성도'],
            generals: [11, 12],
            history: ['<Y>오리온자리</>가 황제로 즉위'],
            date: '2026-07-25T12:00:00.000Z',
            generalsFull: [
                { generalNo: 11, name: '오리온자리', lastYearMonth: 21504 },
                { generalNo: 12, name: '료우기시키', lastYearMonth: 21504 },
            ],
        },
        {
            archiveId: 4,
            nation: 2,
            isWinner: false,
            name: '청해',
            color: '#0000FF',
            type: 'che_법가',
            typeName: '법가',
            level: 5,
            levelName: '공',
            tech: 3000,
            maxPower: 20000,
            maxCrew: 80000,
            maxCities: ['허창'],
            generals: [13],
            history: ['<Y>조조</>가 나라를 세웠습니다.'],
            date: '2026-07-24T12:00:00.000Z',
            generalsFull: [{ generalNo: 13, name: '조조', lastYearMonth: 21003 }],
        },
    ],
};

const installFixture = async (page: Page): Promise<void> => {
    await page.route('**/image/game/**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'image/png',
            body: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                'base64'
            ),
        });
    });
    await page.route('**/che/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'lobby.info') {
                return response({ myGeneral: null });
            }
            if (operation === 'dynasty.getList') {
                return response(listPayload);
            }
            if (operation === 'dynasty.getDetail') {
                const input = new URL(route.request().url()).searchParams.get('input') ?? '';
                return input.includes('999')
                    ? errorResponse(operation, 'NOT_FOUND', '왕조 정보를 찾을 수 없습니다.')
                    : response(detailPayload);
            }
            return errorResponse(operation, 'BAD_REQUEST', `Unhandled fixture operation: ${operation}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(results),
        });
    });
};

test.beforeEach(async ({ page }) => {
    await installFixture(page);
    await page.setViewportSize({ width: 1280, height: 900 });
});

test('dynasty list matches the ref Chromium table geometry and interactions', async ({ page }) => {
    await page.goto(`${gameOrigin}/che/dynasty`);
    await expect(page.getByText('백년01 (215年 4月)')).toBeVisible();

    const geometry = await page.locator('#dynasty-list-container').evaluate((container) => {
        const rect = container.getBoundingClientRect();
        const tables = Array.from(container.querySelectorAll<HTMLTableElement>('table')).map((table) => {
            const tableRect = table.getBoundingClientRect();
            const style = getComputedStyle(table);
            return {
                x: tableRect.x,
                y: tableRect.y,
                width: tableRect.width,
                height: tableRect.height,
                borderSpacing: style.borderSpacing,
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                lineHeight: style.lineHeight,
            };
        });
        const button = container.querySelector<HTMLButtonElement>('button')!;
        const buttonStyle = getComputedStyle(button);
        const cellStyle = getComputedStyle(container.querySelector<HTMLTableCellElement>('td')!);
        return {
            container: { x: rect.x, y: rect.y, width: rect.width },
            tables,
            button: {
                height: button.getBoundingClientRect().height,
                borderWidth: buttonStyle.borderWidth,
                borderRadius: buttonStyle.borderRadius,
                padding: buttonStyle.padding,
                fontFamily: buttonStyle.fontFamily,
                fontSize: buttonStyle.fontSize,
                cursor: buttonStyle.cursor,
            },
            firstCell: {
                padding: cellStyle.padding,
                borderWidth: cellStyle.borderWidth,
                textAlign: cellStyle.textAlign,
            },
        };
    });

    expect(geometry.container).toEqual({ x: 140, y: 8, width: 1000 });
    expect(geometry.tables.slice(0, 3).map(({ x, width, borderSpacing }) => ({ x, width, borderSpacing }))).toEqual([
        { x: 140, width: 1000, borderSpacing: '2px' },
        { x: 140, width: 1000, borderSpacing: '2px' },
        { x: 140, width: 1000, borderSpacing: '2px' },
    ]);
    expect(geometry.tables.slice(0, 3).map(({ y, height }) => ({ y, height }))).toEqual([
        { y: 8, height: 47 },
        { y: 65, height: 37 },
        { y: 112, height: 139 },
    ]);
    expect(geometry.tables[0]!.fontFamily).toContain('Times New Roman');
    expect(geometry.tables[0]!.fontSize).toBe('16px');
    expect(geometry.tables[0]!.lineHeight).toBe('normal');
    expect(geometry.button).toEqual({
        height: 22,
        borderWidth: '2px',
        borderRadius: '0px',
        padding: '1px 6px',
        fontFamily: 'Arial',
        fontSize: '13.3333px',
        cursor: 'default',
    });
    expect(geometry.firstCell).toEqual({ padding: '1px', borderWidth: '0px', textAlign: 'start' });

    const historyLink = page.getByRole('link', { name: '역사 보기' }).last();
    await expect(historyLink).toHaveAttribute('href', '/che/yearbook?serverID=hwe_260725_u3uE');
    if (artifactRoot) {
        await page.screenshot({ path: resolve(artifactRoot, 'dynasty-core-list.png'), fullPage: true });
    }

    const detailLink = page.getByRole('link', { name: '자세히' });
    await detailLink.focus();
    await expect(detailLink).toBeFocused();
    await detailLink.click();
    await expect(page).toHaveURL(/\/che\/dynasty\/1$/);
    await expect(page.getByText('국 가 수')).toBeVisible();

    if (artifactRoot) {
        await page.screenshot({ path: resolve(artifactRoot, 'dynasty-core-detail.png'), fullPage: true });
    }
});

test('dynasty detail preserves the legacy fields, old-nation table and error flow', async ({ page }) => {
    await page.goto(`${gameOrigin}/che/dynasty/1`);
    await expect(page.getByText('장 수 성 격')).toBeVisible();
    await expect(page.getByText('의리(14), 대담(11)')).toBeVisible();
    await expect(page.getByText('오 호 장 군')).toBeVisible();
    await expect(page.getByText('건 안 칠 자')).toBeVisible();
    await expect(page.getByText('【 백년01 】')).toBeVisible();
    await expect(page.getByText('황제', { exact: true })).toBeVisible();
    await expect(page.locator('.old-nation-table')).toHaveCount(2);
    await expect(page.locator('.old-nation-table').nth(0)).toContainText('120000명');
    await expect(page.locator('.old-nation-table').nth(0)).toContainText('34434');
    await expect(page.locator('.old-nation-table').nth(0)).toContainText('낙양, 장안, 성도');
    await expect(page.locator('.old-nation-table').nth(1)).toContainText('법가');
    await expect(page.locator('.old-nation-table').nth(1)).toContainText('3000');
    await expect(page.locator('.old-nation-table').nth(1)).toContainText('80000명');
    await expect(page.locator('.old-nation-table').nth(1)).toContainText('20000');
    await expect(page.locator('.old-nation-table').nth(1)).toContainText('허창');

    const geometry = await page.locator('#dynasty-detail-container').evaluate((container) => {
        const rect = container.getBoundingClientRect();
        const first = container.querySelector<HTMLTableElement>('table')!.getBoundingClientRect();
        const emperor = container.querySelector<HTMLTableElement>('.emperor-table')!.getBoundingClientRect();
        const oldNation = container.querySelector<HTMLTableElement>('.old-nation-table')!.getBoundingClientRect();
        return {
            container: { x: rect.x, y: rect.y, width: rect.width },
            first: { x: first.x, y: first.y, width: first.width, height: first.height },
            emperor: { x: emperor.x, y: emperor.y, width: emperor.width },
            oldNation: { x: oldNation.x, width: oldNation.width },
        };
    });
    expect(geometry.container).toEqual({ x: 140, y: 8, width: 1000 });
    expect(geometry.first).toEqual({ x: 140, y: 8, width: 1000, height: 47 });
    expect(geometry.emperor).toEqual({ x: 140, y: 55, width: 1000 });
    expect(geometry.oldNation).toEqual({ x: 140, width: 1000 });

    await page.goto(`${gameOrigin}/che/dynasty/999`);
    await expect(page.getByRole('alert')).toHaveText('왕조 정보를 찾을 수 없습니다.');
    await expect(page.locator('.emperor-table')).toHaveCount(0);
    await page.getByRole('button', { name: '창 닫기' }).first().click();
    await expect(page).toHaveURL(/\/che\/public$/);
});

test('dynasty public view is identical for anonymous and distinct user tokens', async ({ browser }) => {
    const snapshots: string[] = [];
    for (const token of [null, 'ga_dynasty_owner_a', 'ga_dynasty_owner_b']) {
        const context = await browser.newContext({
            viewport: { width: 1280, height: 900 },
            deviceScaleFactor: 1,
            colorScheme: 'dark',
        });
        const page = await context.newPage();
        await installFixture(page);
        if (token) {
            await page.addInitScript((value) => {
                window.localStorage.setItem('sammo-game-token', value);
            }, token);
        }
        await page.goto(`${gameOrigin}/che/dynasty`);
        await expect(page.getByText('백년01 (215年 4月)')).toBeVisible();
        snapshots.push(await page.locator('#dynasty-list-container').innerText());
        await context.close();
    }

    expect(snapshots[1]).toBe(snapshots[0]);
    expect(snapshots[2]).toBe(snapshots[0]);
});
