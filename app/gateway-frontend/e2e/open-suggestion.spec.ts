import { expect, test, type Page, type Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const response = (data: unknown) => ({ result: { data } });

const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const installFixture = async (page: Page): Promise<string[]> => {
    const operations: string[] = [];
    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-session-token', 'regular-user-session');
    });
    await page.route('**/gateway/api/trpc/**', async (route) => {
        expect(route.request().headers()['x-session-token']).toBe('regular-user-session');
        const results = operationNames(route).map((operation) => {
            operations.push(operation);
            if (operation === 'me') {
                return response({
                    id: 'regular-user',
                    username: 'regular-user',
                    displayName: '일반유저',
                    roles: [],
                    createdAt: '2026-08-22T00:00:00.000Z',
                });
            }
            if (operation === 'lobby.notice') return response('');
            if (operation === 'lobby.profiles') {
                return response([
                    {
                        profileName: 'pya:default',
                        profile: 'pya',
                        instanceKey: 'default',
                        currentScenario: '2701',
                        scenario: '2701',
                        status: 'STOPPED',
                        lifecycle: {
                            runtimeExpected: false,
                            userAccessible: false,
                            turnsRunning: false,
                            operatorResumable: true,
                            dataInitialized: true,
                        },
                        apiPort: 15015,
                        runtime: {},
                        korName: '퍄',
                        color: '#f97316',
                        localAccountPolicy: null,
                    },
                ]);
            }
            if (operation === 'lobby.scenarios') {
                return response([
                    {
                        id: 2701,
                        title: '【가상모드27-b】 아시아 명장전(비급)',
                        year: 180,
                        defaultStatTotal: 310,
                        fiction: 1,
                        npcCount: 210,
                        npcExCount: 25,
                        npcNeutralCount: 12,
                        nations: [{ id: 1, name: '위', color: '#f00', cities: ['낙양'], generals: 5 }],
                    },
                    {
                        id: 100,
                        title: '【가상모드】 기본 시나리오',
                        year: 184,
                        defaultStatTotal: 165,
                        fiction: 0,
                        npcCount: 100,
                        npcExCount: 0,
                        npcNeutralCount: 0,
                        nations: [],
                    },
                ]);
            }
            throw new Error(`Unhandled tRPC operation: ${operation}`);
        });
        const batched = new URL(route.request().url()).searchParams.get('batch') === '1';
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(batched ? results : results[0]),
        });
    });
    return operations;
};

test('lets a regular user inspect active-build scenarios and copy an open suggestion without a mutation', async ({
    page,
}, testInfo) => {
    const operations = await installFixture(page);

    await page.goto('lobby');
    const suggestionLink = page.getByRole('link', { name: '오픈 건의 양식 작성' });
    await expect(suggestionLink).toBeVisible();
    await suggestionLink.hover();
    await suggestionLink.focus();
    await expect(suggestionLink).toBeFocused();
    await suggestionLink.click();

    await expect(page).toHaveURL(/\/gateway\/open-suggestion$/);
    await expect(page.getByRole('heading', { name: '오픈 건의 양식' })).toBeVisible();
    await expect(page.getByText('서버 설정, 시나리오, 오픈 시각은 변경되지 않습니다.')).toBeVisible();
    await expect(page.getByTestId('scenario-summary')).toContainText('310');

    await page.getByTestId('proposal-open').fill('2026-08-18T12:00');
    await page.getByTestId('proposal-preopen').fill('2026-08-18T12:30');
    await expect(page.getByText('가오픈 일시는 오픈 일시보다 늦을 수 없습니다.')).toBeVisible();
    await expect(page.getByTestId('copy-proposal')).toBeDisabled();
    await page.getByTestId('proposal-preopen').fill('2026-08-18T11:30');
    const output = page.getByTestId('proposal-output');
    await expect(output).toHaveValue(
        `퍄섭<오픈건의>
- 가오픈 일시 : 2026-08-18 11:30:00 -
- 오픈 일시 : 2026-08-18 12:00:00 -
【가상모드27-b】 아시아 명장전(비급) 1분 턴 서버
(상성 설정:가상), (빙의 여부:불가), (최대 스탯:310), (기타 설정:자율행동[내정, 순간이동, 모병, 훈련/사기진작, 출병, 사령턴, 24시간 유효])`
    );

    await page.getByTestId('copy-proposal').click();
    await expect(page.getByRole('status').filter({ hasText: '오픈 건의 양식을 복사했습니다.' })).toBeVisible();

    await page.getByText('시간 동기화', { exact: true }).click();
    await expect(output).toHaveValue(/시간동기화 없음/);

    await page.getByText('시나리오 목록 2개 보기').click();
    await expect(page.getByRole('cell', { name: '【가상모드】 기본 시나리오' })).toBeVisible();

    const desktopGeometry = await page.locator('.suggestion-page').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            viewportWidth: window.innerWidth,
            documentWidth: document.documentElement.scrollWidth,
        };
    });
    expect(desktopGeometry.left).toBeGreaterThanOrEqual(0);
    expect(desktopGeometry.right).toBeLessThanOrEqual(desktopGeometry.viewportWidth);
    expect(desktopGeometry.documentWidth).toBe(desktopGeometry.viewportWidth);
    await page.screenshot({ path: testInfo.outputPath('open-suggestion-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileGeometry = await page.locator('.suggestion-page').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            viewportWidth: window.innerWidth,
            documentWidth: document.documentElement.scrollWidth,
        };
    });
    expect(mobileGeometry.left).toBeGreaterThanOrEqual(0);
    expect(mobileGeometry.right).toBeLessThanOrEqual(mobileGeometry.viewportWidth);
    expect(mobileGeometry.documentWidth).toBe(mobileGeometry.viewportWidth);
    await writeFile(
        testInfo.outputPath('open-suggestion-geometry.json'),
        JSON.stringify({ desktop: desktopGeometry, mobile: mobileGeometry }, null, 2)
    );
    await page.screenshot({ path: testInfo.outputPath('open-suggestion-mobile.png'), fullPage: true });

    expect(operations).toContain('lobby.scenarios');
    expect(operations.every((operation) => ['me', 'lobby.notice', 'lobby.profiles', 'lobby.scenarios'].includes(operation))).toBe(
        true
    );
});
