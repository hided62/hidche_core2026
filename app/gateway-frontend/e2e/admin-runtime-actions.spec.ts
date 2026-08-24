import { expect, test, type Page, type Route } from '@playwright/test';

const response = (data: unknown) => ({ result: { data } });
const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

type RuntimeAction = {
    id: string;
    action: 'ACCELERATE' | 'DELAY' | 'UPDATE_RUNTIME_SETTINGS';
    durationMinutes: number | null;
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
        profileStatus?: 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'STOPPED';
        currentScenario?: string | null;
        gameIsUnited?: number;
        openerOnly?: boolean;
    } = {}
) => {
    let requested = false;
    let installRequested = false;
    let installActive = false;
    let postRequestProfileReads = 0;
    let requestedRuntimeSettings = false;
    let completedCloseRequested = false;
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
            const requestJson = JSON.stringify(body);
            requestedRuntimeSettings = requestJson.includes('UPDATE_RUNTIME_SETTINGS');
            completedCloseRequested = requestJson.includes('CLOSE_COMPLETED');
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
                const capabilities = [
                    {
                        permission: 'admin.users.manage',
                        label: '사용자·제재 관리',
                        description: '계정 복구와 제재를 관리합니다.',
                        risk: 'CRITICAL',
                        scope: 'GLOBAL',
                    },
                    {
                        permission: 'admin.profiles.runtime',
                        label: 'Profile 실행 관리',
                        description: '실행 상태를 관리합니다.',
                        risk: 'HIGH',
                        scope: 'PROFILE',
                        scopes: ['*'],
                    },
                    {
                        permission: 'admin.profiles.settings',
                        label: 'Profile 설정 관리',
                        description: '설정을 관리합니다.',
                        risk: 'HIGH',
                        scope: 'PROFILE',
                        scopes: ['*'],
                    },
                    {
                        permission: 'admin.profiles.deploy',
                        label: 'Profile 버전 배포',
                        description: '버전을 배포합니다.',
                        risk: 'CRITICAL',
                        scope: 'PROFILE',
                        scopes: ['*'],
                    },
                    {
                        permission: 'admin.scenarios.reset',
                        label: '시나리오 초기화',
                        description: '시나리오를 초기화합니다.',
                        risk: 'CRITICAL',
                        scope: 'PROFILE',
                        scopes: ['*'],
                    },
                ];
                return response(
                    options.openerOnly
                        ? capabilities.filter((entry) => entry.permission === 'admin.scenarios.reset')
                        : capabilities
                );
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
            if (operation === 'admin.profiles.listNavigation') {
                return response([
                    {
                        profileName: 'hwe:default',
                        profile: 'hwe',
                        instanceKey: 'default',
                        displayName: '훼',
                        currentScenario: options.currentScenario === undefined ? '1010' : options.currentScenario,
                        meta: {},
                    },
                ]);
            }
            if (operation === 'admin.profiles.list') {
                const keepPending = requested && postRequestProfileReads++ < (options.pendingProfileReads ?? 0);
                return response([
                    {
                        profileName: 'hwe:default',
                        profile: 'hwe',
                        instanceKey: 'default',
                        displayName: '훼',
                        currentScenario: options.currentScenario === undefined ? '1010' : options.currentScenario,
                        scenario: options.currentScenario ?? 'default',
                        apiPort: 15015,
                        status: completedCloseRequested ? 'STOPPED' : (options.profileStatus ?? 'RUNNING'),
                        buildStatus: 'SUCCEEDED',
                        meta: {},
                        runtimeSettings: requestedRuntimeSettings
                            ? {
                                  isUnited: options.gameIsUnited ?? 0,
                                  turnTermMinutes: 20,
                                  blockGeneralCreate: 1,
                                  autorunUser: {
                                      limitMinutes: 720,
                                      options: ['develop', 'recruit_high', 'chief'],
                                  },
                              }
                            : {
                                  isUnited: options.gameIsUnited ?? 0,
                                  turnTermMinutes: 10,
                                  blockGeneralCreate: 2,
                                  autorunUser: null,
                              },
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
                              ? (options.afterRequestActions ??
                                (requestedRuntimeSettings
                                    ? [
                                          runtimeAction('APPLIED', {
                                              action: 'UPDATE_RUNTIME_SETTINGS',
                                              durationMinutes: null,
                                              detail: '턴 20분 · 장수 생성 불가 · 유저 자동턴 적용',
                                          }),
                                      ]
                                    : [
                                          runtimeAction('APPLIED', {
                                              detail: '15분 가속 · 장수 2명 · 경매 1건',
                                          }),
                                      ]))
                              : (options.initialActions ?? []),
                    },
                ]);
            }
            if (operation === 'admin.profiles.requestAction') {
                return response({
                    ok: true,
                    action: {
                        id: '68f1f0e4-3b95-4aeb-9925-c7e93caf1ba7',
                        action: requestedRuntimeSettings ? 'UPDATE_RUNTIME_SETTINGS' : 'ACCELERATE',
                        durationMinutes: requestedRuntimeSettings ? null : 15,
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
            body: JSON.stringify(
                new URL(route.request().url()).searchParams.get('batch') === '1' ? results : results[0]
            ),
        });
    });
    return { releaseRequest, releaseInstall, requestBodies };
};

test('reports clock-shift acceptance separately from actual application', async ({ page }) => {
    const fixture = await installFixture(page, { deferRequest: true, pendingProfileReads: 1 });
    await page.goto('admin/servers');
    await expect(page.getByRole('heading', { name: '서버 관리', level: 1 })).toBeVisible();

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
    await expect(page.getByRole('button', { name: '설문 오픈 (게임 내 관리)' })).toHaveCount(0);
    await expect(page.getByText('설문 생성은 해당 게임의 설문 관리 화면에서 진행해 주세요.')).toHaveCount(0);
});

test('updates live game options from the authoritative database snapshot', async ({ page }, testInfo) => {
    const fixture = await installFixture(page);
    await page.goto('/gateway/admin/servers/hwe%3Adefault');

    const settings = page.getByTestId('runtime-settings');
    await expect(settings).toBeVisible();
    await expect(page.getByTestId('runtime-turn-term')).toHaveValue('10');
    await expect(page.getByTestId('runtime-block-general-create')).toHaveValue('2');
    await expect(page.getByTestId('runtime-autorun-enabled')).not.toBeChecked();
    await expect(page.getByRole('button', { name: '설문 오픈 (게임 내 관리)' })).toHaveCount(0);

    await page.getByTestId('runtime-turn-term').selectOption('20');
    await page.getByTestId('runtime-block-general-create').selectOption('1');
    await page.getByTestId('runtime-autorun-enabled').check();
    await page.getByTestId('runtime-autorun-minutes').fill('720');
    for (const label of ['이동', '징병', '훈련', '전투']) {
        await settings.getByLabel(label, { exact: true }).uncheck();
    }
    await page.getByPlaceholder('사유 / 메모').fill('운영 중 설정 변경');

    const submit = page.getByTestId('runtime-settings-submit');
    await submit.hover();
    const hoverBackground = await submit.evaluate((element) => getComputedStyle(element).backgroundColor);
    await submit.focus();
    await expect(submit).toBeFocused();
    const click = submit.click();
    await expect.poll(() => fixture.requestBodies.length).toBe(1);
    await click;

    const requestJson = JSON.stringify(fixture.requestBodies[0]);
    expect(requestJson).toContain('UPDATE_RUNTIME_SETTINGS');
    expect(requestJson).toContain('"turnTermMinutes":20');
    expect(requestJson).toContain('"blockGeneralCreate":1');
    expect(requestJson).toContain('"limitMinutes":720');
    expect(requestJson).toContain('"recruit_high"');
    expect(requestJson).toContain('"chief"');
    expect(hoverBackground).not.toBe('rgba(0, 0, 0, 0)');
    await expect(page.getByText('APPLIED · UPDATE_RUNTIME_SETTINGS')).toBeVisible();
    await expect(page.getByTestId('runtime-turn-term')).toHaveValue('20');
    await expect(page.getByTestId('runtime-block-general-create')).toHaveValue('1');
    await expect(page.getByTestId('runtime-autorun-enabled')).toBeChecked();

    const geometry = await settings.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, viewport: window.innerWidth };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.width).toBeGreaterThan(250);
    await page.screenshot({ path: testInfo.outputPath('runtime-settings-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileGeometry = await settings.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, viewport: window.innerWidth };
    });
    expect(mobileGeometry.left).toBeGreaterThanOrEqual(0);
    expect(mobileGeometry.right).toBeLessThanOrEqual(mobileGeometry.viewport);
    await page.screenshot({ path: testInfo.outputPath('runtime-settings-mobile.png'), fullPage: true });
});

test('distinguishes a turn pause from an inaccessible stopped server in operator controls', async ({ page }) => {
    await installFixture(page, { profileStatus: 'PAUSED' });

    await page.goto('/gateway/admin/servers/hwe%3Adefault');
    await expect(page.getByTestId('profile-lifecycle-description')).toContainText('게임 조회와 예약턴 입력 가능');
    await expect(page.getByRole('button', { name: '턴 재개' })).toBeEnabled();
    await expect(page.getByRole('button', { name: '일시정지' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '중지', exact: true })).toBeEnabled();
});

test('lets a scenario opener close only a unified server and keeps the control usable on mobile', async ({
    page,
}, testInfo) => {
    const fixture = await installFixture(page, { gameIsUnited: 2, openerOnly: true });

    await page.goto('/gateway/admin/servers/hwe%3Adefault');
    await expect(page.getByTestId('profile-lifecycle-description')).toContainText('천하통일 완료');
    await expect(page.getByTestId('runtime-settings')).toHaveCount(0);
    const cleanup = page.getByTestId('completed-profile-cleanup');
    await expect(cleanup).toContainText('현재 기수 DB와 완료 기록은 보존');
    const submit = page.getByTestId('completed-profile-cleanup-submit');
    const desktopGeometry = await cleanup.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            left: rect.left,
            right: rect.right,
            viewport: window.innerWidth,
            fontSize: style.fontSize,
            color: style.color,
        };
    });
    expect(desktopGeometry.left).toBeGreaterThanOrEqual(0);
    expect(desktopGeometry.right).toBeLessThanOrEqual(desktopGeometry.viewport);
    expect(desktopGeometry.fontSize).toBe('14px');
    expect(desktopGeometry.color).not.toBe('rgba(0, 0, 0, 0)');
    const buttonBackground = await submit.evaluate((element) => getComputedStyle(element).backgroundColor);
    await submit.hover();
    const hoverBackground = await submit.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(hoverBackground).not.toBe(buttonBackground);
    await submit.focus();
    await expect(submit).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('completed-profile-cleanup-desktop.png'), fullPage: true });

    await submit.click();
    await expect.poll(() => JSON.stringify(fixture.requestBodies)).toContain('CLOSE_COMPLETED');
    await expect(page.getByTestId('completed-profile-cleanup')).toHaveCount(0);
    await expect(page.getByTestId('profile-lifecycle-description')).toContainText('게임 접근 불가');

    await page.setViewportSize({ width: 390, height: 844 });
    const lifecycle = page.getByTestId('profile-lifecycle-description');
    const geometry = await lifecycle.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, viewport: window.innerWidth };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    await page.screenshot({ path: testInfo.outputPath('completed-profile-cleanup-mobile.png'), fullPage: true });
});

test('does not offer completed cleanup to a scenario opener before unification', async ({ page }) => {
    await installFixture(page, { gameIsUnited: 0, openerOnly: true });

    await page.goto('/gateway/admin/servers/hwe%3Adefault');
    await expect(page.getByTestId('completed-profile-cleanup')).toHaveCount(0);
});

test('shows an initialized STOPPED server as inaccessible and only restartable', async ({ page }) => {
    await installFixture(page, { profileStatus: 'STOPPED' });

    await page.goto('/gateway/admin/servers/hwe%3Adefault');
    await expect(page.getByTestId('profile-lifecycle-description')).toContainText('게임 접근 불가');
    await expect(page.getByRole('button', { name: '서버 재개' })).toBeEnabled();
    await expect(page.getByRole('button', { name: '일시정지' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '중지', exact: true })).toBeDisabled();
});

test('separates an uninitialized database from an initialized stopped server', async ({ page }) => {
    await installFixture(page, { profileStatus: 'STOPPED', currentScenario: null });

    await page.goto('/gateway/admin/servers/hwe%3Adefault');
    await expect(page.getByTestId('profile-lifecycle-description')).toHaveText('DB 초기화 전 · 게임 접근 불가');
    await expect(page.getByRole('button', { name: '서버 재개' })).toBeDisabled();
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
    await expect(page.getByText('DB 시간 조정 실패').first()).toBeVisible();
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

test('directs profile deployment to the selected server version tab', async ({ page }, testInfo) => {
    await installFixture(page);
    await page.goto('admin/servers');

    const tabs = page.getByTestId('server-profile-tabs');
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole('link', { name: '상태 설정', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByText('버전과 시즌 수명주기', { exact: true })).toHaveCount(0);
    const versionTab = tabs.getByRole('link', { name: '버전 업데이트', exact: true });
    const idleTabBackground = await versionTab.evaluate((element) => getComputedStyle(element).backgroundColor);
    await versionTab.hover();
    await expect
        .poll(() => versionTab.evaluate((element) => getComputedStyle(element).backgroundColor))
        .not.toBe(idleTabBackground);
    await versionTab.focus();
    await expect(versionTab).toBeFocused();
    const tabAndHeaderGeometry = await Promise.all([
        tabs.evaluate((element) => element.getBoundingClientRect().top),
        page
            .getByText('현재 시나리오: 1010', { exact: true })
            .evaluate((element) => element.getBoundingClientRect().top),
    ]);
    expect(tabAndHeaderGeometry[0]).toBeLessThan(tabAndHeaderGeometry[1]);
    await page.screenshot({ path: testInfo.outputPath('status-tabs-desktop.png'), fullPage: true });

    const releaseLink = page.getByRole('link', { name: '버전 업데이트', exact: true }).last();
    await expect(releaseLink).toBeVisible();
    await expect(releaseLink).toHaveAttribute('href', '/gateway/admin/servers/hwe%3Adefault/version');
    await expect(page.getByRole('button', { name: '설치 적용' })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    const linkGeometry = await releaseLink.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, viewportWidth: window.innerWidth };
    });
    expect(linkGeometry.left).toBeGreaterThanOrEqual(0);
    expect(linkGeometry.right).toBeLessThanOrEqual(linkGeometry.viewportWidth);
    await page.screenshot({ path: testInfo.outputPath('status-tabs-mobile.png'), fullPage: true });
});
