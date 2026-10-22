import { expect, test, type Page, type Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const response = (data: unknown) => ({ result: { data } });

const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const installFixture = async (page: Page, opener = false): Promise<string[]> => {
    const operations: string[] = [];
    let savedRequest: Record<string, unknown> | null = null;
    let policy = { enabled: true, lifetimeDays: 7, buildLeadMinutes: 10, endorsementThreshold: 2 as number | null };
    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-session-token', 'regular-user-session');
    });
    await page.route('**/gateway/api/trpc/**', async (route) => {
        expect(route.request().headers()['x-session-token']).toBe('regular-user-session');
        const url = new URL(route.request().url());
        const raw =
            route.request().method() === 'POST'
                ? route.request().postDataJSON()
                : JSON.parse(url.searchParams.get('input') ?? '{}');
        const results = operationNames(route).map((operation, index) => {
            const input = url.searchParams.get('batch') === '1' ? raw[String(index)] : raw;
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
                expect(input).toEqual({ profileName: 'pya:default' });
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
            if (operation === 'openRequests.list') {
                expect(input).toEqual({ profileName: 'pya:default' });
                return response({ policy, canRequest: true, requests: savedRequest ? [savedRequest] : [] });
            }
            if (operation === 'admin.openRequests.permissions') {
                return response({ canAccept: opener, canManagePolicy: opener });
            }
            if (operation === 'openRequests.create') {
                expect(Object.keys(input).sort()).toEqual(['install', 'profileName']);
                expect(input.profileName).toBe('pya:default');
                expect(input.install.preopenAt).toBe('2099-08-18T02:30:00.000Z');
                expect(input.install.openAt).toBe('2099-08-18T03:00:00.000Z');
                expect(input.install.scenarioId).toBe(2701);
                expect(input.install).not.toHaveProperty('gitRef');
                savedRequest = {
                    id: '11111111-1111-4111-8111-111111111111',
                    status: 'PENDING',
                    requesterName: '일반유저',
                    isMine: true,
                    announcement: { scenarioTitle: '아시아 명장전', defaultStatTotal: 310 },
                    install: input.install,
                    expiresAt: '2099-08-18T02:20:00.000Z',
                    createdAt: '2099-08-17T00:00:00.000Z',
                    endorsementCount: 0,
                    endorsed: false,
                    canEndorse: false,
                    operationStatus: null,
                };
                return response({ id: savedRequest.id, status: savedRequest.status });
            }
            if (operation === 'admin.openRequests.decide') {
                expect(opener).toBe(true);
                expect(input).toEqual({ id: savedRequest?.id, action: 'ACCEPT' });
                savedRequest = { ...savedRequest, status: 'RESERVED', operationStatus: 'QUEUED' };
                return response({ id: savedRequest.id, status: 'RESERVED' });
            }
            if (operation === 'admin.openRequests.updatePolicy') {
                expect(opener).toBe(true);
                expect(input.reason).toBe('테스트 서버 정책 변경');
                policy = input.policy;
                return response(policy);
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
    const suggestionLink = page.getByRole('link', { name: '오픈 요청 · 목록' });
    await expect(suggestionLink).toBeVisible();
    await suggestionLink.hover();
    await suggestionLink.focus();
    await expect(suggestionLink).toBeFocused();
    await suggestionLink.click();

    await expect(page).toHaveURL(/\/gateway\/open-suggestion$/);
    await expect(page.getByRole('heading', { name: '오픈 요청', exact: true })).toBeVisible();
    await expect(
        page.getByText('복사는 문구만 복사하며, 오픈 요청 등록 버튼을 눌러야 요청이 저장됩니다.')
    ).toBeVisible();
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
    expect(
        operations.every((operation) =>
            [
                'me',
                'lobby.notice',
                'lobby.profiles',
                'lobby.scenarios',
                'openRequests.list',
                'admin.openRequests.permissions',
            ].includes(operation)
        )
    ).toBe(true);
});

test('registers a durable proposal and lets the opener accept and configure it across desktop/mobile', async ({
    page,
}, testInfo) => {
    const operations = await installFixture(page, true);
    await page.goto('open-suggestion');
    await expect(page.getByRole('heading', { name: '오픈 요청 목록' })).toBeVisible();
    await page.getByTestId('proposal-preopen').fill('2099-08-18T11:30');
    await page.getByTestId('proposal-open').fill('2099-08-18T12:00');
    const submit = page.getByTestId('submit-open-request');
    await submit.hover();
    await submit.focus();
    await expect(submit).toBeEnabled();
    await submit.click();
    const card = page.locator('.request-card');
    await expect(card).toContainText('일반유저');
    await expect(card).toContainText('수락 대기');
    await page.reload();
    await expect(card).toContainText('아시아 명장전');
    await card.getByText('요청 설정 전체').click();
    await expect(card).toContainText('시간 동기화');
    await card.getByRole('button', { name: '수락하여 오픈 예약' }).hover();
    await card.getByRole('button', { name: '수락하여 오픈 예약' }).click();
    await expect(card).toContainText('오픈 예약');
    await expect(card).toContainText('준비 예약');
    await expect(card.getByRole('button', { name: '요청 철회' })).toHaveCount(0);
    await page.getByText('서버 오픈 요청 정책', { exact: true }).click();
    const policy = page.locator('.request-policy');
    await policy.getByLabel('가오픈 전 준비 시간(분)').fill('25');
    await policy.getByLabel('동의로 자동 예약').uncheck();
    await expect(policy.getByLabel('필요 동의 수(요청자 제외)')).toHaveCount(0);
    await policy.getByLabel('변경 사유').fill('테스트 서버 정책 변경');
    await policy.getByRole('button', { name: '정책 저장' }).click();
    await expect(page.getByText('이 서버는 오프너가 수락하면 예약됩니다.')).toBeVisible();
    for (const viewport of [
        { width: 1200, height: 900 },
        { width: 390, height: 844 },
    ]) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => document.fonts.ready);
        const measurements = await page.locator('.request-list').evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                rect: rect.toJSON(),
                color: style.color,
                font: style.font,
                width: innerWidth,
                documentWidth: document.documentElement.scrollWidth,
                html: element.outerHTML,
            };
        });
        expect(measurements.documentWidth).toBe(viewport.width);
        expect(measurements.rect.right).toBeLessThanOrEqual(viewport.width);
        await writeFile(testInfo.outputPath(`requests-${viewport.width}.json`), JSON.stringify(measurements, null, 2));
        await page.screenshot({ path: testInfo.outputPath(`requests-${viewport.width}.png`), fullPage: true });
    }
    expect(operations).toContain('openRequests.create');
    expect(operations).toContain('admin.openRequests.decide');
    expect(operations).toContain('admin.openRequests.updatePolicy');
});
