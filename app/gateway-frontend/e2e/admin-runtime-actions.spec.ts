import { expect, test, type Page, type Route } from '@playwright/test';

const response = (data: unknown) => ({ result: { data } });
const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

type RuntimeAction = {
    id: string;
    action: 'ACCELERATE' | 'DELAY';
    durationMinutes: number;
    status: 'REQUESTED' | 'PARTIAL' | 'APPLIED' | 'FAILED' | 'IGNORED';
    detail: string;
    handler: string | null;
    handledAt: string | null;
    createdAt: string;
};

const runtimeAction = (status: RuntimeAction['status'], overrides: Partial<RuntimeAction> = {}): RuntimeAction => ({
    id: '68f1f0e4-3b95-4aeb-9925-c7e93caf1ba7',
    action: 'ACCELERATE',
    durationMinutes: 15,
    status,
    detail: `${status} 상세`,
    handler: status === 'REQUESTED' ? null : 'turn-daemon',
    handledAt: status === 'REQUESTED' ? null : '2026-07-30T01:00:01.000Z',
    createdAt: '2026-07-30T01:00:00.000Z',
    ...overrides,
});

const installFixture = async (
    page: Page,
    options: {
        deferRequest?: boolean;
        deferInstall?: boolean;
        initialActions?: RuntimeAction[];
        afterRequestActions?: RuntimeAction[];
        pendingProfileReads?: number;
    } = {}
) => {
    let requested = false;
    let installRequested = false;
    let installActive = false;
    let postRequestProfileReads = 0;
    const requestBodies: unknown[] = [];
    let releaseRequest = (): void => {};
    const requestGate = options.deferRequest
        ? new Promise<void>((resolve) => {
              releaseRequest = resolve;
          })
        : Promise.resolve();
    let releaseInstall = (): void => {};
    const installGate = options.deferInstall
        ? new Promise<void>((resolve) => {
              releaseInstall = resolve;
          })
        : Promise.resolve();
    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-session-token', 'playwright-admin-session');
    });
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const body = route.request().postDataJSON() as unknown;
        const operations = operationNames(route);
        if (operations.includes('admin.profiles.requestAction')) {
            requested = true;
            requestBodies.push(body);
            await requestGate;
        }
        if (operations.includes('admin.profiles.install')) {
            installRequested = true;
            requestBodies.push(body);
            await installGate;
            installActive = true;
        }
        const results = operations.map((operation) => {
            if (operation === 'me') {
                return response({
                    id: 'admin-user',
                    username: 'admin',
                    displayName: '관리자',
                    roles: ['superuser'],
                    createdAt: '2026-07-30T00:00:00.000Z',
                });
            }
            if (operation === 'admin.system.getNotice') {
                return response({ notice: '' });
            }
            if (operation === 'admin.users.getLocalAccountStatus') {
                return response({ enabled: true });
            }
            if (operation === 'admin.capabilities.list') {
                return response([
                    {
                        permission: 'admin.users.manage',
                        label: '사용자·제재 관리',
                        description: '계정 복구와 제재를 관리합니다.',
                        risk: 'CRITICAL',
                        scope: 'GLOBAL',
                    },
                ]);
            }
            if (operation === 'admin.profiles.listScenarios') {
                return response([
                    {
                        id: 1010,
                        title: '【테스트】황건의 난',
                        year: 184,
                        npcCount: 42,
                        npcExCount: 0,
                        npcNeutralCount: 0,
                        nations: [],
                    },
                ]);
            }
            if (operation === 'admin.profiles.list') {
                const keepPending = requested && postRequestProfileReads++ < (options.pendingProfileReads ?? 0);
                return response([
                    {
                        profileName: 'hwe:default',
                        profile: 'hwe',
                        scenario: '1010',
                        apiPort: 15015,
                        status: 'RUNNING',
                        buildStatus: 'SUCCEEDED',
                        meta: {},
                        activeOperation: installActive
                            ? {
                                  id: '77777777-7777-4777-8777-777777777777',
                                  status: 'QUEUED',
                              }
                            : null,
                        runtime: {
                            profileName: 'hwe:default',
                            frontendRunning: true,
                            apiRunning: true,
                            daemonRunning: true,
                            auctionRunning: true,
                            battleSimRunning: true,
                            tournamentRunning: true,
                        },
                        runtimeActions: keepPending
                            ? [runtimeAction('REQUESTED')]
                            : requested
                              ? (options.afterRequestActions ?? [
                                    runtimeAction('APPLIED', {
                                        detail: '15분 가속 · 장수 2명 · 경매 1건',
                                    }),
                                ])
                              : (options.initialActions ?? []),
                    },
                ]);
            }
            if (operation === 'admin.profiles.requestAction') {
                return response({
                    ok: true,
                    action: {
                        id: '68f1f0e4-3b95-4aeb-9925-c7e93caf1ba7',
                        action: 'ACCELERATE',
                        durationMinutes: 15,
                        status: 'REQUESTED',
                        detail: null,
                        handler: null,
                        handledAt: null,
                        createdAt: '2026-07-30T01:00:00.000Z',
                    },
                });
            }
            if (operation === 'admin.profiles.install') {
                return response({
                    ok: true,
                    operationId: '77777777-7777-4777-8777-777777777777',
                });
            }
            if (operation === 'admin.operations.list') {
                return response(
                    installRequested
                        ? [
                              {
                                  id: '77777777-7777-4777-8777-777777777777',
                                  profileName: 'hwe:default',
                                  type: 'RESET',
                                  status: installActive ? 'QUEUED' : 'RUNNING',
                                  sourceMode: 'COMMIT',
                                  sourceRef: '0123456789abcdef0123456789abcdef01234567',
                                  payload: {},
                                  requestedBy: 'admin-user',
                                  createdAt: '2026-07-30T02:00:00.000Z',
                                  updatedAt: '2026-07-30T02:00:00.000Z',
                              },
                          ]
                        : []
                );
            }
            if (operation === 'admin.releases.gatewayState') {
                return response({ id: 'gateway', updatedAt: '2026-08-01T00:00:00.000Z' });
            }
            if (operation === 'admin.releases.list') {
                return response([]);
            }
            throw new Error(`Unhandled tRPC operation: ${operation}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(results),
        });
    });
    return { releaseRequest, releaseInstall, requestBodies };
};

test('reports clock-shift acceptance separately from actual application', async ({ page }) => {
    const fixture = await installFixture(page, { deferRequest: true, pendingProfileReads: 1 });
    await page.goto('admin/servers');
    await expect(page.getByRole('heading', { name: '서버 관리' })).toBeVisible();

    const duration = page.locator('input[type="number"][min="1"][max="1440"]');
    const accelerate = page.getByRole('button', { name: '가속', exact: true });
    await expect(accelerate).toBeDisabled();
    await duration.fill('1.5');
    await expect(accelerate).toBeDisabled();
    await duration.fill('15');
    await expect(accelerate).toBeEnabled();

    const click = accelerate.click();
    await expect.poll(() => fixture.requestBodies.length).toBe(1);
    await expect(accelerate).toBeDisabled();
    await expect(page.getByRole('button', { name: '연기', exact: true })).toBeDisabled();
    fixture.releaseRequest();
    await click;

    await expect(page.getByText('APPLIED · ACCELERATE 15분')).toBeVisible();
    await expect(page.getByText('15분 가속 · 장수 2명 · 경매 1건')).toBeVisible();
    await expect(page.getByText(/요청 완료: ACCELERATE/)).toHaveCount(0);
    expect(fixture.requestBodies).toHaveLength(1);
    expect(JSON.stringify(fixture.requestBodies[0])).toContain('"ACCELERATE"');
    expect(JSON.stringify(fixture.requestBodies[0])).toContain('"durationMinutes":15');
    await expect(page.getByRole('button', { name: '설문 오픈 (게임 내 관리)' })).toBeDisabled();
    await expect(page.getByText('설문 생성은 해당 게임의 설문 관리 화면에서 진행해 주세요.')).toBeVisible();
});

test('blocks another clock shift while any recent action is pending', async ({ page }) => {
    await installFixture(page, {
        initialActions: [
            runtimeAction('APPLIED', { createdAt: '2026-07-30T01:00:02.000Z' }),
            runtimeAction('PARTIAL', {
                id: '5a971e6e-03e2-45ff-bcab-c5cbdacb21d3',
                createdAt: '2026-07-30T01:00:01.000Z',
            }),
        ],
    });
    await page.goto('admin/servers');
    await page.locator('input[type="number"][min="1"][max="1440"]').fill('15');

    await expect(page.getByRole('button', { name: '가속', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '연기', exact: true })).toBeDisabled();
});

test('renders a failed terminal outcome without calling it applied', async ({ page }) => {
    await installFixture(page, {
        initialActions: [
            runtimeAction('FAILED', {
                detail: 'DB 시간 조정 실패',
            }),
        ],
    });
    await page.goto('admin/servers');

    const failed = page.getByText('FAILED · ACCELERATE 15분');
    await expect(failed).toBeVisible();
    await expect(page.getByText('DB 시간 조정 실패')).toBeVisible();
    expect(await failed.evaluate((element) => getComputedStyle(element).color)).toBe('oklch(0.704 0.191 22.216)');
    await expect(page.getByText(/적용됨|요청 완료/)).toHaveCount(0);
});

test('renders an ignored terminal outcome without calling it applied', async ({ page }) => {
    await installFixture(page, {
        initialActions: [
            runtimeAction('IGNORED', {
                action: 'DELAY',
                detail: '지원하지 않는 요청',
            }),
        ],
    });
    await page.goto('admin/servers');

    const ignored = page.getByText('IGNORED · DELAY 15분');
    await expect(ignored).toBeVisible();
    expect(await ignored.evaluate((element) => getComputedStyle(element).color)).toBe('oklch(0.75 0.183 55.934)');
    await expect(page.getByText('지원하지 않는 요청')).toBeVisible();
    await expect(page.getByText(/적용됨|요청 완료/)).toHaveCount(0);
});

test('directs profile deployment to the centralized version page', async ({ page }) => {
    await installFixture(page);
    await page.goto('admin/servers');

    const releaseLink = page.getByRole('link', { name: '버전 업데이트 열기' });
    await expect(releaseLink).toBeVisible();
    await expect(releaseLink).toHaveAttribute('href', '/gateway/admin/releases');
    await expect(page.getByRole('button', { name: '설치 적용' })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    const linkGeometry = await releaseLink.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, viewportWidth: window.innerWidth };
    });
    expect(linkGeometry.left).toBeGreaterThanOrEqual(0);
    expect(linkGeometry.right).toBeLessThanOrEqual(linkGeometry.viewportWidth);
});
