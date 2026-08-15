import { expect, test, type Page, type Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

type OperationStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
type Operation = {
    id: string;
    profileName: string;
    type: 'RESET' | 'DEPLOY' | 'START' | 'STOP';
    status: OperationStatus;
    sourceMode?: 'BRANCH' | 'COMMIT';
    sourceRef?: string;
    resolvedCommitSha?: string;
    completedAt?: string;
    error?: string;
    payload: Record<string, unknown>;
    requestedBy: string;
    createdAt: string;
    updatedAt: string;
};

type LogEntry = {
    cursor: string;
    operationId: string;
    level: 'INFO' | 'OUTPUT' | 'ERROR';
    phase: string;
    message: string;
    createdAt: string;
};

type FixtureState = {
    operations: Operation[];
    gatewayOperations: Array<{
        id: string;
        type: 'DEPLOY' | 'ROLLBACK';
        status: OperationStatus;
        sourceMode?: 'BRANCH' | 'COMMIT';
        sourceRef?: string;
        resolvedCommitSha?: string;
        completedAt?: string;
        error?: string;
        payload: Record<string, unknown>;
        requestedBy: string;
        createdAt: string;
        updatedAt: string;
    }>;
    runtimeRunning: boolean;
    requestBodies: Array<{ operation: string; body: unknown }>;
    profileLogPollCount?: number;
    profileLogProgress?: boolean;
    profileLogsEmpty?: boolean;
    profileLogBatches?: LogEntry[][];
    profileLogPollGate?: (pollCount: number) => Promise<void>;
    gatewayLogPollCount?: number;
    gatewayLogsEmpty?: boolean;
    gatewayLogBatches?: LogEntry[][];
    gatewayLogPollGate?: (pollCount: number) => Promise<void>;
    gatewayStateFailuresAfterRequest?: number;
    gatewayStateFailuresRemaining?: number;
    gatewayStateFailureCount?: number;
    capabilities?: Array<{ permission: string; scope: 'GLOBAL' | 'PROFILE'; scopes: string[] }>;
    profileListDelayMs?: number;
    profileNavigationDelayMs?: number;
    profileNavigationRequests?: number;
    profileNavigationResolved?: boolean;
    scenarioFailuresRemaining?: number;
    resetDefaults?: Record<string, unknown>;
    updateMetaFails?: boolean;
};

const profile = (runtimeRunning: boolean, resetDefaults?: Record<string, unknown>) => ({
    profileName: 'che:default',
    profile: 'che',
    instanceKey: 'default',
    currentScenario: '2',
    scenario: '2',
    apiPort: 15003,
    status: runtimeRunning ? 'RUNNING' : 'STOPPED',
    buildStatus: 'SUCCEEDED',
    buildCommitSha: '0123456789abcdef0123456789abcdef01234567',
    buildWorkspace: '/srv/sammo/worktrees/0123456789abcdef0123456789abcdef01234567',
    meta: resetDefaults ? { resetDefaults } : {},
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    activeOperation: null,
    runtimeActions: [],
    runtime: {
        profileName: 'che:default',
        frontendRunning: runtimeRunning,
        apiRunning: runtimeRunning,
        daemonRunning: runtimeRunning,
        auctionRunning: runtimeRunning,
        battleSimRunning: runtimeRunning,
        tournamentRunning: runtimeRunning,
    },
});

const scenarios = [
    {
        id: 0,
        title: '【테스트】공백지',
        year: null,
        npcCount: 0,
        npcExCount: 0,
        npcNeutralCount: 0,
        nations: [],
        isCurrent: false,
    },
    {
        id: 2,
        title: '【테스트】황건의 난',
        year: 184,
        npcCount: 42,
        npcExCount: 0,
        npcNeutralCount: 0,
        nations: [],
        isCurrent: true,
    },
    {
        id: 5,
        title: '【테스트】군웅할거',
        year: 190,
        npcCount: 55,
        npcExCount: 0,
        npcNeutralCount: 0,
        nations: [],
        isCurrent: false,
    },
];

const response = (data: unknown) => ({ result: { data } });
const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const installFixture = async (page: Page, state: FixtureState) => {
    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-session-token', 'playwright-admin-session');
    });
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const names = operationNames(route);
        const body = route.request().postDataJSON() as unknown;
        if (names.includes('admin.profiles.listNavigation')) {
            expect(names).toEqual(['admin.profiles.listNavigation']);
            state.profileNavigationRequests = (state.profileNavigationRequests ?? 0) + 1;
            if (state.profileNavigationDelayMs) {
                await new Promise((resolve) => setTimeout(resolve, state.profileNavigationDelayMs));
            }
            state.profileNavigationResolved = true;
        }
        if (names.includes('admin.profiles.list') && state.profileListDelayMs) {
            await new Promise((resolve) => setTimeout(resolve, state.profileListDelayMs));
        }
        if (names.includes('admin.profiles.listScenarios') && (state.scenarioFailuresRemaining ?? 0) > 0) {
            state.scenarioFailuresRemaining = (state.scenarioFailuresRemaining ?? 0) - 1;
            await route.abort('failed');
            return;
        }
        if (names.includes('admin.profiles.updateMeta') && state.updateMetaFails) {
            await route.abort('failed');
            return;
        }
        if (names.includes('admin.releases.gatewayState') && (state.gatewayStateFailuresRemaining ?? 0) > 0) {
            state.gatewayStateFailuresRemaining = (state.gatewayStateFailuresRemaining ?? 0) - 1;
            state.gatewayStateFailureCount = (state.gatewayStateFailureCount ?? 0) + 1;
            await route.fulfill({
                status: 502,
                contentType: 'application/json',
                body: '',
            });
            return;
        }
        if (names.includes('admin.operations.logs') && !state.profileLogProgress) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (names.includes('admin.operations.logs') && state.profileLogPollGate) {
            await state.profileLogPollGate((state.profileLogPollCount ?? 0) + 1);
        }
        if (names.includes('admin.releases.logs') && state.gatewayLogPollGate) {
            await state.gatewayLogPollGate((state.gatewayLogPollCount ?? 0) + 1);
        }
        const results = names.map((name) => {
            if (route.request().method() === 'POST') {
                state.requestBodies.push({ operation: name, body });
            }
            if (name === 'admin.profiles.list') {
                return response([profile(state.runtimeRunning, state.resetDefaults)]);
            }
            if (name === 'admin.profiles.listNavigation') {
                return response([
                    {
                        profileName: 'che:default',
                        profile: 'che',
                        instanceKey: 'default',
                        currentScenario: '2',
                        meta: { korName: '천하서버' },
                    },
                ]);
            }
            if (name === 'admin.capabilities.list') {
                return response(
                    state.capabilities ?? [
                        { permission: 'admin.profiles.runtime', scope: 'PROFILE', scopes: ['*'] },
                        { permission: 'admin.profiles.settings', scope: 'PROFILE', scopes: ['*'] },
                        { permission: 'admin.profiles.deploy', scope: 'PROFILE', scopes: ['*'] },
                        { permission: 'admin.scenarios.reset', scope: 'PROFILE', scopes: ['*'] },
                        { permission: 'admin.reset.schedule', scope: 'PROFILE', scopes: ['*'] },
                        { permission: 'admin.releases.manage', scope: 'GLOBAL', scopes: ['*'] },
                    ]
                );
            }
            if (name === 'admin.operations.list') {
                return response(state.operations);
            }
            if (name === 'admin.operations.logs') {
                const operation = state.operations[0];
                if (!operation) throw new Error('Profile operation fixture is missing');
                state.profileLogPollCount = (state.profileLogPollCount ?? 0) + 1;
                if (state.profileLogBatches) {
                    const entries = state.profileLogBatches[state.profileLogPollCount - 1] ?? [];
                    const completed = state.profileLogPollCount >= state.profileLogBatches.length;
                    const nextOperation = {
                        ...operation,
                        status: completed ? ('SUCCEEDED' as const) : ('RUNNING' as const),
                    };
                    state.operations[0] = nextOperation;
                    return response({
                        operation: nextOperation,
                        entries,
                        nextCursor: entries.at(-1)?.cursor,
                    });
                }
                if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(operation.status)) {
                    return response({ operation, entries: [] });
                }
                if (!state.profileLogProgress) {
                    return response({ operation, entries: [] });
                }
                if (state.profileLogsEmpty) {
                    return response({ operation, entries: [] });
                }
                const completed = state.profileLogPollCount > 1;
                const nextOperation = {
                    ...operation,
                    status: completed ? ('SUCCEEDED' as const) : ('RUNNING' as const),
                };
                if (completed) state.operations[0] = nextOperation;
                return response({
                    operation: nextOperation,
                    entries: completed
                        ? [
                              {
                                  cursor: '2',
                                  operationId: operation.id,
                                  level: 'OUTPUT',
                                  phase: operation.type === 'RESET' ? 'seed' : 'build',
                                  message:
                                      operation.type === 'RESET'
                                          ? '시나리오 초기 데이터 생성을 완료했습니다.'
                                          : 'game-frontend build complete',
                                  createdAt: '2026-08-01T01:00:02.000Z',
                              },
                          ]
                        : [
                              {
                                  cursor: '1',
                                  operationId: operation.id,
                                  level: 'INFO',
                                  phase: 'build',
                                  message: `${operation.profileName} 구성 요소를 빌드합니다.`,
                                  createdAt: '2026-08-01T01:00:01.000Z',
                              },
                          ],
                    nextCursor: completed ? '2' : '1',
                });
            }
            if (name === 'admin.releases.gatewayState') {
                return response({
                    id: 'gateway',
                    activeCommitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    activeWorkspace: '/srv/sammo/current',
                    previousCommitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                    previousWorkspace: '/srv/sammo/previous',
                    updatedAt: '2026-08-01T00:00:00.000Z',
                });
            }
            if (name === 'admin.releases.list') {
                return response(state.gatewayOperations);
            }
            if (name === 'admin.releases.logs') {
                const releaseOperation = state.gatewayOperations[0];
                if (!releaseOperation) throw new Error('Release operation fixture is missing');
                state.gatewayLogPollCount = (state.gatewayLogPollCount ?? 0) + 1;
                if (state.gatewayLogBatches) {
                    const entries = state.gatewayLogBatches[state.gatewayLogPollCount - 1] ?? [];
                    const completed = state.gatewayLogPollCount >= state.gatewayLogBatches.length;
                    const nextOperation = {
                        ...releaseOperation,
                        status: completed ? ('SUCCEEDED' as const) : ('RUNNING' as const),
                    };
                    state.gatewayOperations[0] = nextOperation;
                    return response({
                        operation: nextOperation,
                        entries,
                        nextCursor: entries.at(-1)?.cursor,
                    });
                }
                if (state.gatewayLogsEmpty) {
                    return response({ operation: releaseOperation, entries: [] });
                }
                const completed = state.gatewayLogPollCount > 1;
                return response({
                    operation: { ...releaseOperation, status: completed ? 'SUCCEEDED' : 'RUNNING' },
                    entries: completed
                        ? [
                              {
                                  cursor: '2',
                                  operationId: releaseOperation.id,
                                  level: 'OUTPUT',
                                  phase: 'build',
                                  message: 'gateway-frontend build complete',
                                  createdAt: '2026-08-01T02:00:02.000Z',
                              },
                          ]
                        : [
                              {
                                  cursor: '1',
                                  operationId: releaseOperation.id,
                                  level: 'INFO',
                                  phase: 'build',
                                  message: 'Gateway 구성 요소를 빌드합니다.',
                                  createdAt: '2026-08-01T02:00:01.000Z',
                              },
                          ],
                    nextCursor: completed ? '2' : '1',
                });
            }
            if (name === 'admin.profiles.listScenarios') {
                expect(names).toEqual(['admin.profiles.listScenarios']);
                return response(scenarios);
            }
            if (name === 'admin.profiles.getResetDefaults') {
                return response({
                    source: state.resetDefaults ? 'PROFILE' : 'SYSTEM',
                    defaults: state.resetDefaults ?? {
                        turnTermMinutes: 60,
                        sync: true,
                        fiction: 1,
                        extend: true,
                        blockGeneralCreate: 0,
                        npcMode: 0,
                        showImgLevel: 3,
                        tournamentTrig: true,
                        joinMode: 'full',
                        autorunUser: null,
                    },
                });
            }
            if (name === 'admin.profiles.updateMeta') {
                return response(profile(state.runtimeRunning, state.resetDefaults));
            }
            if (name === 'admin.operations.requestReset') {
                const operation: Operation = {
                    id: '11111111-1111-4111-8111-111111111111',
                    profileName: 'che:default',
                    type: 'RESET',
                    status: 'QUEUED',
                    sourceMode: 'COMMIT',
                    sourceRef: '0123456789abcdef0123456789abcdef01234567',
                    payload: {},
                    requestedBy: 'admin',
                    createdAt: '2026-07-25T02:00:00.000Z',
                    updatedAt: '2026-07-25T02:00:00.000Z',
                };
                state.operations = [operation];
                return response(operation);
            }
            if (name === 'admin.operations.requestDeploy') {
                const operation: Operation = {
                    id: '66666666-6666-4666-8666-666666666666',
                    profileName: 'che:default',
                    type: 'DEPLOY',
                    status: 'QUEUED',
                    sourceMode: 'BRANCH',
                    sourceRef: 'main',
                    payload: {},
                    requestedBy: 'admin',
                    createdAt: '2026-08-01T01:00:00.000Z',
                    updatedAt: '2026-08-01T01:00:00.000Z',
                };
                state.operations = [operation];
                return response(operation);
            }
            if (name === 'admin.releases.requestGatewayDeploy' || name === 'admin.releases.requestGatewayRollback') {
                const releaseOperation = {
                    id: '77777777-7777-4777-8777-777777777777',
                    type: name.endsWith('Rollback') ? ('ROLLBACK' as const) : ('DEPLOY' as const),
                    status: 'QUEUED' as const,
                    sourceMode: 'BRANCH' as const,
                    sourceRef: 'main',
                    payload: {},
                    requestedBy: 'admin',
                    createdAt: '2026-08-01T02:00:00.000Z',
                    updatedAt: '2026-08-01T02:00:00.000Z',
                };
                state.gatewayOperations = [releaseOperation];
                state.gatewayStateFailuresRemaining = state.gatewayStateFailuresAfterRequest;
                return response(releaseOperation);
            }
            if (name === 'admin.operations.requestRuntime') {
                const serialized = JSON.stringify(body);
                const type = serialized.includes('"STOP"') ? 'STOP' : 'START';
                state.runtimeRunning = type === 'START';
                const operation: Operation = {
                    id:
                        type === 'START'
                            ? '22222222-2222-4222-8222-222222222222'
                            : '33333333-3333-4333-8333-333333333333',
                    profileName: 'che:default',
                    type,
                    status: 'SUCCEEDED',
                    payload: {},
                    requestedBy: 'admin',
                    createdAt: '2026-07-25T03:00:00.000Z',
                    updatedAt: '2026-07-25T03:00:00.000Z',
                };
                state.operations = [operation];
                return response(operation);
            }
            if (name === 'admin.operations.retry') {
                const operation: Operation = {
                    id: '44444444-4444-4444-8444-444444444444',
                    profileName: 'che:default',
                    type: 'RESET',
                    status: 'QUEUED',
                    sourceMode: 'COMMIT',
                    sourceRef: 'fedcba9876543210fedcba9876543210fedcba98',
                    payload: { installOperationId: 'failed-generation' },
                    requestedBy: 'admin',
                    createdAt: '2026-07-25T04:00:00.000Z',
                    updatedAt: '2026-07-25T04:00:00.000Z',
                };
                state.operations = [operation, ...state.operations];
                return response(operation);
            }
            throw new Error(`Unhandled tRPC operation: ${name}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
                new URL(route.request().url()).searchParams.get('batch') === '1' ? results : results[0]
            ),
        });
    });
};

const makeLogEntries = (operationId: string, prefix: string, startCursor: number, count: number): LogEntry[] =>
    Array.from({ length: count }, (_, index) => {
        const cursor = startCursor + index;
        return {
            cursor: String(cursor),
            operationId,
            level: 'OUTPUT',
            phase: 'build',
            message: `${prefix} ${cursor}`,
            createdAt: '2026-08-01T01:00:00.000Z',
        };
    });

const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
};

test('separates branch and commit semantics and submits a reset from the dedicated page', async ({
    page,
}, testInfo) => {
    const state: FixtureState = {
        operations: [],
        gatewayOperations: [],
        runtimeRunning: false,
        requestBodies: [],
        profileLogProgress: true,
    };
    await installFixture(page, state);
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('admin/servers/che%3Adefault/scenario');
    await expect(page.getByTestId('server-operations-page')).toBeVisible();
    await expect(page).toHaveURL(/\/gateway\/admin\/servers\/che%3Adefault\/scenario$/);
    await expect(page.getByTestId('source-current')).toBeChecked();
    await expect(page.getByTestId('source-help')).toContainText('현재 서버에 배포된 커밋');
    await expect(page.getByTestId('scenario-select')).toHaveValue('2');
    await expect(page.getByTestId('request-reset')).toBeEnabled();
    await expect(page.getByTestId('scenario-select').locator('option:checked')).toContainText('현재 시나리오');
    const catalogGeometry = await page.getByTestId('scenario-select').evaluate((select) => {
        const scenarioSelect = select as HTMLSelectElement;
        const rect = select.getBoundingClientRect();
        return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            optionCount: scenarioSelect.options.length,
            value: scenarioSelect.value,
        };
    });
    expect(catalogGeometry.optionCount).toBe(3);
    expect(catalogGeometry.value).toBe('2');
    expect(catalogGeometry.width).toBeGreaterThan(300);
    await page.screenshot({ path: testInfo.outputPath('current-scenario-catalog.png'), fullPage: true });
    await page.getByTestId('scenario-select').selectOption('0');
    await expect(page.getByTestId('request-reset')).toBeEnabled();
    await expect(page.getByTestId('server-profile-tabs')).toBeVisible();
    await expect(page.getByRole('link', { name: '시나리오 초기화', exact: true })).toHaveAttribute(
        'aria-current',
        'page'
    );
    await expect(page.getByText('운영 프로필', { exact: true })).toHaveCount(0);

    const desktopGeometry = await page
        .getByTestId('server-operations-page')
        .locator('section')
        .first()
        .evaluate((section) => {
            const children = Array.from(section.children).map((child) => {
                const rect = child.getBoundingClientRect();
                return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
            });
            return children;
        });
    expect(desktopGeometry).toHaveLength(1);
    expect(desktopGeometry[0]!.width).toBeGreaterThan(800);
    await page.getByTestId('source-commit').check();
    const sourceInput = page.getByTestId('source-ref');
    await sourceInput.focus();
    const focusedInputStyle = await sourceInput.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            borderColor: style.borderColor,
            backgroundColor: style.backgroundColor,
            color: style.color,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            outlineStyle: style.outlineStyle,
        };
    });
    await writeFile(
        testInfo.outputPath('layout-metrics.json'),
        JSON.stringify({ catalogGeometry, desktopGeometry, focusedInputStyle }, null, 2)
    );
    await page.screenshot({ path: testInfo.outputPath('desktop-operations.png'), fullPage: true });

    await expect(page.getByTestId('source-help')).toContainText('전체 SHA로 고정');
    await page.getByTestId('source-ref').fill('0123456789abcdef0123456789abcdef01234567');
    await page.getByTestId('load-scenarios').click();
    await page.getByTestId('scenario-select').selectOption('5');
    await page.getByLabel('작업 예약 (서버 시간 UTC+9)').fill('2026-08-13T09:30');
    await page.getByTestId('request-reset').hover();
    await page.getByTestId('request-reset').click();

    await expect(page.getByText('초기화 작업을 등록했습니다.').first()).toBeVisible();
    await expect(page.getByTestId('operations-table')).toContainText('RESET');
    await expect(page.getByTestId('profile-operation-log-panel')).toBeVisible();
    await expect(page.getByTestId('profile-operation-log')).toContainText('che:default 구성 요소를 빌드합니다.');
    await expect(page.getByTestId('profile-operation-log')).toContainText('시나리오 초기 데이터 생성을 완료했습니다.');
    await expect(page.getByTestId('profile-operation-log-status')).toContainText('SUCCEEDED');
    const operationTableGeometry = await page.getByTestId('operations-table').evaluate((table) => {
        const columnWidths = Array.from(table.querySelectorAll('thead th')).map(
            (heading) => heading.getBoundingClientRect().width
        );
        const rowHeight = table.querySelector('tbody tr')?.getBoundingClientRect().height ?? 0;
        return {
            columnWidths,
            rowHeight,
            tableWidth: table.getBoundingClientRect().width,
            scrollerWidth: table.parentElement?.getBoundingClientRect().width ?? 0,
            tableLayout: getComputedStyle(table).tableLayout,
        };
    });
    const sourceRefGeometry = await page.getByTestId('operation-source-ref').evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            title: element.getAttribute('title'),
            overflow: style.overflow,
            textOverflow: style.textOverflow,
            whiteSpace: style.whiteSpace,
        };
    });
    expect(operationTableGeometry.tableLayout).toBe('fixed');
    expect(operationTableGeometry.tableWidth).toBeGreaterThanOrEqual(1_300);
    expect(operationTableGeometry.tableWidth).toBeGreaterThan(operationTableGeometry.scrollerWidth);
    expect(operationTableGeometry.columnWidths[0]).toBeGreaterThanOrEqual(159);
    expect(operationTableGeometry.columnWidths[1]).toBeGreaterThanOrEqual(263);
    expect(operationTableGeometry.columnWidths[5]).toBeLessThanOrEqual(113);
    expect(operationTableGeometry.columnWidths[7]).toBeGreaterThanOrEqual(175);
    expect(operationTableGeometry.columnWidths[1]).toBeGreaterThan(operationTableGeometry.columnWidths[5]! * 2);
    expect(operationTableGeometry.rowHeight).toBeLessThanOrEqual(50);
    expect(sourceRefGeometry).toEqual({
        title: '0123456789abcdef0123456789abcdef01234567',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    });
    await writeFile(
        testInfo.outputPath('operation-table-metrics.json'),
        JSON.stringify({ operationTableGeometry, sourceRefGeometry }, null, 2)
    );
    const resetRequest = state.requestBodies.find((entry) => entry.operation === 'admin.operations.requestReset');
    expect(JSON.stringify(resetRequest?.body)).toContain('"sourceMode":"COMMIT"');
    expect(JSON.stringify(resetRequest?.body)).toContain('0123456789abcdef0123456789abcdef01234567');
    expect(JSON.stringify(resetRequest?.body)).toContain('"scenarioId":5');
    expect(JSON.stringify(resetRequest?.body)).toContain('"scheduledAt":"2026-08-13T00:30:00.000Z"');
    await page.screenshot({ path: testInfo.outputPath('reset-operation-log-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileGeometry = await page
        .getByTestId('server-operations-page')
        .locator('section')
        .first()
        .evaluate((section) => {
            const children = Array.from(section.children).map((child) => {
                const rect = child.getBoundingClientRect();
                return { x: rect.x, y: rect.y, width: rect.width };
            });
            return children;
        });
    expect(mobileGeometry[0]!.width).toBeLessThanOrEqual(390);
    const mobileTabs = await page
        .getByTestId('server-profile-tabs')
        .locator('a')
        .evaluateAll((links) =>
            links.map((link) => {
                const rect = link.getBoundingClientRect();
                return { top: rect.top, width: rect.width, height: rect.height };
            })
        );
    expect(mobileTabs).toHaveLength(3);
    expect(mobileTabs[1]!.top).toBeGreaterThan(mobileTabs[0]!.top);
    expect(mobileTabs.every((tab) => tab.height >= 44)).toBe(true);
    const mobileOperationTableGeometry = await page.getByTestId('operations-table').evaluate((table) => {
        const scroller = table.parentElement!;
        const scrollerRect = scroller.getBoundingClientRect();
        return {
            tableWidth: table.getBoundingClientRect().width,
            scrollerX: scrollerRect.x,
            scrollerWidth: scrollerRect.width,
            scrollerScrollWidth: scroller.scrollWidth,
            viewportWidth: document.documentElement.clientWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
        };
    });
    expect(mobileOperationTableGeometry.tableWidth).toBeGreaterThanOrEqual(1_300);
    expect(mobileOperationTableGeometry.scrollerScrollWidth).toBeGreaterThan(
        mobileOperationTableGeometry.scrollerWidth
    );
    expect(mobileOperationTableGeometry.scrollerX).toBeGreaterThanOrEqual(0);
    expect(mobileOperationTableGeometry.scrollerX + mobileOperationTableGeometry.scrollerWidth).toBeLessThanOrEqual(
        mobileOperationTableGeometry.viewportWidth
    );
    expect(mobileOperationTableGeometry.documentScrollWidth).toBeLessThanOrEqual(
        mobileOperationTableGeometry.viewportWidth
    );
    await writeFile(
        testInfo.outputPath('operation-table-mobile-metrics.json'),
        JSON.stringify(mobileOperationTableGeometry, null, 2)
    );
    await page.screenshot({ path: testInfo.outputPath('mobile-operations.png'), fullPage: true });
});

test('separates DB-preserving profile deployment from DB reset', async ({ page }) => {
    const state: FixtureState = {
        operations: [],
        gatewayOperations: [],
        runtimeRunning: true,
        requestBodies: [],
        profileLogProgress: true,
    };
    await installFixture(page, state);
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('admin/servers/che%3Adefault/version');
    await expect(page.getByRole('heading', { name: 'DB 보존 버전 업데이트' })).toBeVisible();
    await expect(page.getByText('운영 프로필', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '버전 업데이트', exact: true })).toHaveAttribute(
        'aria-current',
        'page'
    );
    await page.getByTestId('request-deploy').click();

    await expect(page.getByText('DB 보존 배포 작업을 등록했습니다.').first()).toBeVisible();
    await expect(page.getByTestId('operations-table')).toContainText('DEPLOY');
    await expect(page.getByTestId('profile-operation-log-panel')).toBeVisible();
    await expect(page.getByTestId('profile-operation-log')).toContainText('che:default 구성 요소를 빌드합니다.');
    await expect(page.getByTestId('profile-operation-log')).toContainText('game-frontend build complete');
    await expect(page.getByTestId('profile-operation-log-status')).toContainText('SUCCEEDED');
    expect(state.requestBodies.some((entry) => entry.operation === 'admin.operations.requestDeploy')).toBe(true);
    expect(state.requestBodies.some((entry) => entry.operation === 'admin.operations.requestReset')).toBe(false);
});

for (const viewportSize of [
    { name: 'desktop', width: 1280, height: 720 },
    { name: 'mobile', width: 390, height: 844 },
]) {
    test(`follows new profile and Gateway logs only while each viewport is near the end on ${viewportSize.name}`, async ({
        page,
    }, testInfo) => {
        await page.setViewportSize(viewportSize);
        const profileOperationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const gatewayOperationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        const profileSecondPoll = deferred();
        const profileThirdPoll = deferred();
        const gatewaySecondPoll = deferred();
        const gatewayThirdPoll = deferred();
        const state: FixtureState = {
            operations: [
                {
                    id: profileOperationId,
                    profileName: 'che:default',
                    type: 'DEPLOY',
                    status: 'RUNNING',
                    sourceMode: 'BRANCH',
                    sourceRef: 'main',
                    payload: {},
                    requestedBy: 'admin',
                    createdAt: '2026-08-01T01:00:00.000Z',
                    updatedAt: '2026-08-01T01:00:00.000Z',
                },
            ],
            gatewayOperations: [
                {
                    id: gatewayOperationId,
                    type: 'DEPLOY',
                    status: 'RUNNING',
                    sourceMode: 'BRANCH',
                    sourceRef: 'main',
                    payload: {},
                    requestedBy: 'admin',
                    createdAt: '2026-08-01T02:00:00.000Z',
                    updatedAt: '2026-08-01T02:00:00.000Z',
                },
            ],
            runtimeRunning: true,
            requestBodies: [],
            profileLogProgress: true,
            profileLogBatches: [
                makeLogEntries(profileOperationId, 'profile history', 1, 80),
                makeLogEntries(profileOperationId, 'profile while reading', 81, 1),
                makeLogEntries(profileOperationId, 'profile near end', 82, 1),
            ],
            profileLogPollGate: async (pollCount) => {
                if (pollCount === 2) await profileSecondPoll.promise;
                if (pollCount === 3) await profileThirdPoll.promise;
            },
            gatewayLogBatches: [
                makeLogEntries(gatewayOperationId, 'gateway history', 1, 80),
                makeLogEntries(gatewayOperationId, 'gateway while reading', 81, 1),
                makeLogEntries(gatewayOperationId, 'gateway near end', 82, 1),
            ],
            gatewayLogPollGate: async (pollCount) => {
                if (pollCount === 2) await gatewaySecondPoll.promise;
                if (pollCount === 3) await gatewayThirdPoll.promise;
            },
        };
        await installFixture(page, state);

        const verifyViewport = async (
            url: string,
            testId: 'profile-operation-log' | 'gateway-release-log',
            historyText: string,
            readingText: string,
            nearEndText: string,
            releaseSecondPoll: () => void,
            releaseThirdPoll: () => void,
            screenshotName: string
        ) => {
            await page.goto(url);
            const viewport = page.getByTestId(testId);
            await expect(viewport).toContainText(historyText);
            await expect
                .poll(() =>
                    viewport.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)
                )
                .toBeLessThanOrEqual(1);

            const readingPosition = await viewport.evaluate((element) => {
                element.scrollTop = 200;
                return element.scrollTop;
            });
            expect(readingPosition).toBe(200);
            releaseSecondPoll();
            await expect(viewport).toContainText(readingText);
            await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(readingPosition);

            const nearEndGap = await viewport.evaluate((element) => {
                element.scrollTop = element.scrollHeight - element.clientHeight - 20;
                return element.scrollHeight - element.clientHeight - element.scrollTop;
            });
            expect(nearEndGap).toBeGreaterThan(0);
            expect(nearEndGap).toBeLessThanOrEqual(40);
            releaseThirdPoll();
            await expect(viewport).toContainText(nearEndText);
            await expect
                .poll(() =>
                    viewport.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)
                )
                .toBeLessThanOrEqual(1);
            await page.screenshot({
                path: testInfo.outputPath(`${viewportSize.name}-${screenshotName}`),
                fullPage: true,
            });
        };

        await verifyViewport(
            'admin/servers/che%3Adefault/version',
            'profile-operation-log',
            'profile history 80',
            'profile while reading 81',
            'profile near end 82',
            profileSecondPoll.resolve,
            profileThirdPoll.resolve,
            'profile-log-scroll-follow.png'
        );
        await verifyViewport(
            'admin/releases',
            'gateway-release-log',
            'gateway history 80',
            'gateway while reading 81',
            'gateway near end 82',
            gatewaySecondPoll.resolve,
            gatewayThirdPoll.resolve,
            'gateway-log-scroll-follow.png'
        );
    });
}

test('loads server metadata defaults into the reset form and submits them', async ({ page }) => {
    const state: FixtureState = {
        operations: [],
        gatewayOperations: [],
        runtimeRunning: true,
        requestBodies: [],
        resetDefaults: {
            turnTermMinutes: 20,
            sync: false,
            fiction: 0,
            extend: false,
            blockGeneralCreate: 2,
            npcMode: 1,
            showImgLevel: 1,
            tournamentTrig: false,
            joinMode: 'onlyRandom',
            autorunUser: { limitMinutes: 720, options: ['develop', 'train'] },
        },
    };
    await installFixture(page, state);
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('admin/servers/che%3Adefault/scenario');
    await expect(page.getByTestId('reset-turn-term')).toHaveValue('20');
    await page.getByText('고급 시나리오 옵션').click();
    await expect(page.getByTestId('reset-defaults-source')).toContainText('서버의 메타');
    await expect(page.getByTestId('reset-npc-mode')).toHaveValue('1');
    await page.getByTestId('request-reset').click();

    await expect
        .poll(() => state.requestBodies.find((entry) => entry.operation === 'admin.operations.requestReset'))
        .toBeTruthy();
    const request = JSON.stringify(
        state.requestBodies.find((entry) => entry.operation === 'admin.operations.requestReset')?.body
    );
    expect(request).toContain('"turnTermMinutes":20');
    expect(request).toContain('"npcMode":1');
    expect(request).toContain('"joinMode":"onlyRandom"');
    expect(request).toContain('"limitMinutes":720');
    expect(request).toContain('"options":["develop","train"]');
});

test('edits server reset defaults through profile metadata settings', async ({ page }, testInfo) => {
    const state: FixtureState = { operations: [], gatewayOperations: [], runtimeRunning: true, requestBodies: [] };
    await installFixture(page, state);

    await page.goto('admin/servers/che%3Adefault');
    await page.getByText('서버 리셋 기본 옵션').click();
    await page.getByTestId('meta-reset-turn-term').selectOption('10');
    await page.getByTestId('meta-reset-npc-mode').selectOption('2');

    await page.getByRole('button', { name: '메타 저장' }).click();
    const validationToast = page.getByTestId('action-toast').filter({ hasText: '변경 사유를 입력하세요.' });
    await expect(validationToast).toHaveAttribute('data-toast-kind', 'error');
    await expect(validationToast).toHaveAttribute('role', 'alert');

    await page.getByPlaceholder('변경 사유 (필수)').fill('set reset defaults');
    await page.getByRole('button', { name: '메타 저장' }).click();

    await expect(page.getByText('메타 저장 완료').first()).toBeVisible();
    const successToast = page.getByTestId('action-toast').filter({ hasText: '메타 저장 완료' });
    await expect(successToast).toHaveAttribute('data-toast-kind', 'success');
    await expect(successToast).toHaveAttribute('role', 'status');
    const toastGeometry = await successToast.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const viewport = element.parentElement?.parentElement;
        return {
            right: Math.round(window.innerWidth - rect.right),
            width: Math.round(rect.width),
            viewportPosition: viewport ? getComputedStyle(viewport).position : '',
        };
    });
    expect(toastGeometry.right).toBeGreaterThanOrEqual(0);
    expect(toastGeometry.width).toBeGreaterThan(250);
    expect(toastGeometry.viewportPosition).toBe('fixed');
    await page.screenshot({ path: testInfo.outputPath('meta-save-toast-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileToastGeometry = await successToast.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            left: Math.round(rect.left),
            right: Math.round(window.innerWidth - rect.right),
            bottom: Math.round(window.innerHeight - rect.bottom),
        };
    });
    expect(mobileToastGeometry.left).toBeGreaterThanOrEqual(0);
    expect(mobileToastGeometry.right).toBeGreaterThanOrEqual(0);
    expect(mobileToastGeometry.bottom).toBeGreaterThanOrEqual(0);
    expect(mobileToastGeometry.bottom).toBeLessThanOrEqual(20);
    await page.screenshot({ path: testInfo.outputPath('meta-save-toast-mobile.png'), fullPage: true });
    const request = JSON.stringify(
        state.requestBodies.find((entry) => entry.operation === 'admin.profiles.updateMeta')?.body
    );
    expect(request).toContain('"resetDefaults"');
    expect(request).toContain('"turnTermMinutes":10');
    expect(request).toContain('"npcMode":2');
});

test('shows a dismissible error toast when profile metadata persistence fails', async ({ page }, testInfo) => {
    const state: FixtureState = {
        operations: [],
        gatewayOperations: [],
        runtimeRunning: true,
        requestBodies: [],
        updateMetaFails: true,
    };
    await installFixture(page, state);

    await page.goto('admin/servers/che%3Adefault');
    await page.getByPlaceholder('변경 사유 (필수)').fill('exercise persistence error');
    await page.getByRole('button', { name: '메타 저장' }).click();

    const errorToast = page.getByTestId('action-toast').filter({ hasText: '메타 저장 실패' });
    await expect(errorToast).toBeVisible();
    await expect(errorToast).toHaveAttribute('data-toast-kind', 'error');
    await page.screenshot({ path: testInfo.outputPath('meta-save-toast-error.png'), fullPage: true });
    await errorToast.getByRole('button', { name: '알림 닫기' }).click();
    await expect(errorToast).toHaveCount(0);
});

test('renders the fixed-profile version form without waiting for the server list', async ({ page }) => {
    const state: FixtureState = {
        operations: [],
        gatewayOperations: [],
        runtimeRunning: true,
        requestBodies: [],
        profileNavigationDelayMs: 3000,
        profileNavigationResolved: false,
    };
    await installFixture(page, state);

    await page.goto('admin/servers/che%3Adefault/version');
    await expect(page.getByTestId('request-deploy')).toBeVisible({ timeout: 900 });
    expect(state.profileNavigationResolved).toBe(false);
    await expect.poll(() => state.profileNavigationResolved).toBe(true);
    expect(state.profileNavigationRequests).toBe(1);
});

test('recovers the current-version scenario catalog after the initial request fails', async ({ page }) => {
    const state: FixtureState = {
        operations: [],
        gatewayOperations: [],
        runtimeRunning: true,
        requestBodies: [],
        scenarioFailuresRemaining: 1,
    };
    await installFixture(page, state);

    await page.goto('admin/servers/che%3Adefault/scenario');
    await expect(page.getByTestId('scenario-select')).toContainText('선택할 수 있는 시나리오가 없습니다.');
    await expect(page.getByTestId('request-reset')).toBeDisabled();
    await page.getByTestId('load-scenarios').click();
    await expect(page.getByTestId('scenario-select')).toHaveValue('2');
    await expect(page.getByTestId('request-reset')).toBeEnabled();
});

test('renders the stable server identity without exposing the default suffix as the display name', async ({
    page,
}, testInfo) => {
    const state: FixtureState = {
        operations: [],
        gatewayOperations: [],
        runtimeRunning: true,
        requestBodies: [],
        profileListDelayMs: 1500,
    };
    await installFixture(page, state);

    await page.goto('admin/servers/che%3Adefault');
    const navigation = page.getByRole('navigation', { name: '관리자 메뉴' });
    const profileLink = navigation.getByRole('link', { name: '천하서버' });
    await expect(profileLink).toBeVisible({ timeout: 900 });
    await expect(profileLink).toHaveAttribute('title', '서버 ID: che:default');
    await expect(navigation).not.toContainText('천하서버 (che:default)');
    await expect(navigation.getByRole('link', { name: 'Gateway 릴리스' })).toBeVisible({ timeout: 900 });
    await expect(page.getByText('서버 ID: che:default · 인스턴스: default')).toBeVisible();
    await expect(page.getByText('현재 시나리오: 2')).toBeVisible();
    await profileLink.focus();
    const desktop = await profileLink.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
            x: rect.x,
            width: rect.width,
            height: rect.height,
            overflow: element.scrollWidth - element.clientWidth,
            backgroundColor: style.backgroundColor,
            color: style.color,
        };
    });
    expect(desktop.width).toBeGreaterThan(100);
    expect(desktop.height).toBeGreaterThan(30);
    expect(desktop.overflow).toBeLessThanOrEqual(0);
    expect(desktop.backgroundColor).toBe('rgb(45, 27, 8)');
    expect(desktop.color).toBe('rgb(253, 230, 138)');
    await page.screenshot({ path: testInfo.outputPath('profile-identity-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '관리자 메뉴' }).click();
    await expect(profileLink).toBeVisible();
    expect(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    ).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath('profile-identity-mobile.png'), fullPage: true });
    expect(state.profileNavigationRequests).toBe(1);
});

test('scenario-only operator resets the current version without Git or Gateway controls', async ({ page }) => {
    const state: FixtureState = {
        operations: [],
        gatewayOperations: [],
        runtimeRunning: true,
        requestBodies: [],
        capabilities: [{ permission: 'admin.scenarios.reset', scope: 'PROFILE', scopes: ['che:default'] }],
    };
    await installFixture(page, state);
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('admin/servers/che%3Adefault/scenario');
    await expect(page.getByTestId('source-current')).toBeChecked();
    await expect(page.getByTestId('source-branch')).toHaveCount(0);
    await expect(page.getByTestId('source-commit')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Gateway 릴리스' })).toHaveCount(0);
    await page.getByTestId('request-reset').click();
    await expect(page.getByText('초기화 작업을 등록했습니다.').first()).toBeVisible();
    await expect
        .poll(() => state.requestBodies.some((entry) => entry.operation === 'admin.operations.requestReset'))
        .toBe(true);

    const request = state.requestBodies.find((entry) => entry.operation === 'admin.operations.requestReset');
    expect(JSON.stringify(request?.body)).toContain('"sourceMode":"CURRENT"');
    expect(JSON.stringify(request?.body)).not.toContain('"sourceRef"');
});

test('controls gateway deployment and rollback through the external controller queue', async ({ page }, testInfo) => {
    const state: FixtureState = {
        operations: [],
        gatewayOperations: [],
        runtimeRunning: true,
        requestBodies: [],
        gatewayStateFailuresAfterRequest: 1,
    };
    await installFixture(page, state);
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('admin/releases');
    const panel = page.getByTestId('gateway-release-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('aaaaaaaaaaaa');
    await expect(panel).toContainText('bbbbbbbbbbbb');
    await page.getByTestId('gateway-source-ref').fill('release/2026-08');
    await page.getByTestId('request-gateway-deploy').click();

    await expect(page.getByText(/Gateway 배포 작업을 등록했습니다/).first()).toBeVisible();
    expect(state.gatewayStateFailureCount).toBe(1);
    await expect(page.getByTestId('server-operations-page')).not.toContainText('Unexpected end of JSON input');
    await expect(page.getByTestId('action-toast').filter({ hasText: 'Unexpected end of JSON input' })).toHaveCount(0);
    await expect(page.getByTestId('gateway-release-table')).toContainText('DEPLOY');
    await expect(page.getByTestId('gateway-release-log-panel')).toBeVisible();
    await expect(page.getByTestId('gateway-release-log')).toContainText('Gateway 구성 요소를 빌드합니다.');
    await expect(page.getByTestId('gateway-release-log')).toContainText('gateway-frontend build complete');
    await expect(page.getByTestId('gateway-release-log-status')).toContainText('SUCCEEDED');
    expect(state.gatewayLogPollCount).toBeGreaterThanOrEqual(2);
    expect(state.requestBodies.some((entry) => entry.operation === 'admin.releases.requestGatewayDeploy')).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('gateway-release-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileLogGeometry = await page.getByTestId('gateway-release-log-panel').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, width: rect.width, viewportWidth: document.documentElement.clientWidth };
    });
    expect(mobileLogGeometry.x).toBeGreaterThanOrEqual(0);
    expect(mobileLogGeometry.x + mobileLogGeometry.width).toBeLessThanOrEqual(mobileLogGeometry.viewportWidth);
    await page.screenshot({ path: testInfo.outputPath('gateway-release-mobile.png'), fullPage: true });

    state.gatewayOperations = [];
    await page.getByTestId('refresh-operations').click();
    await page.getByTestId('request-gateway-rollback').click();
    await expect(page.getByText('Gateway rollback 작업을 등록했습니다.').first()).toBeVisible();
    expect(state.requestBodies.some((entry) => entry.operation === 'admin.releases.requestGatewayRollback')).toBe(true);
});

test('moves long Gateway release errors out of the table column into an expandable detail row', async ({
    page,
}, testInfo) => {
    const longError = [
        'Gateway release did not become ready before the timeout.',
        'Error: gateway-frontend readiness check failed after 30 attempts',
        '    at waitForGatewayReadiness (/srv/core/release-controller/dist/releaseController.js:842:19)',
        'controller-output-without-breaks-'.repeat(12),
    ].join('\n');
    const operationId = '88888888-8888-4888-8888-888888888888';
    const state: FixtureState = {
        operations: [],
        gatewayOperations: [
            {
                id: operationId,
                type: 'DEPLOY',
                status: 'FAILED',
                sourceMode: 'COMMIT',
                sourceRef: 'cccccccccccccccccccccccccccccccccccccccc',
                resolvedCommitSha: 'cccccccccccccccccccccccccccccccccccccccc',
                completedAt: '2026-08-01T02:03:00.000Z',
                error: longError,
                payload: {},
                requestedBy: 'admin',
                createdAt: '2026-08-01T02:00:00.000Z',
                updatedAt: '2026-08-01T02:03:00.000Z',
            },
        ],
        gatewayLogsEmpty: true,
        runtimeRunning: true,
        requestBodies: [],
    };
    await installFixture(page, state);

    await page.goto('admin/releases');
    const table = page.getByTestId('gateway-release-table');
    await expect(table.getByRole('columnheader')).toHaveCount(6);
    await expect(table.getByRole('columnheader', { name: '오류', exact: true })).toHaveCount(0);
    await expect(table.getByRole('columnheader', { name: '상세', exact: true })).toBeVisible();

    const errorToggle = page.getByTestId('gateway-release-error-toggle');
    await expect(errorToggle).toHaveText('오류 보기');
    await expect(errorToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('gateway-release-error-detail')).toBeHidden();

    await errorToggle.focus();
    const focusedToggleStyle = await errorToggle.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            outlineStyle: style.outlineStyle,
            outlineWidth: style.outlineWidth,
            color: style.color,
        };
    });
    expect(focusedToggleStyle.outlineStyle).not.toBe('none');
    expect(parseFloat(focusedToggleStyle.outlineWidth)).toBeGreaterThanOrEqual(2);

    await errorToggle.hover();
    await errorToggle.click();
    await expect(errorToggle).toHaveText('오류 닫기');
    await expect(errorToggle).toHaveAttribute('aria-expanded', 'true');
    const errorDetail = page.getByTestId('gateway-release-error-detail');
    await expect(errorDetail).toContainText('Gateway release did not become ready');
    await expect(errorDetail).toContainText('controller-output-without-breaks');
    const desktopGeometry = await table.evaluate((element) => {
        const headings = Array.from(element.querySelectorAll('thead th'));
        const detail = element.querySelector('[data-testid="gateway-release-error-detail"]');
        const detailCell = detail?.querySelector('td');
        const errorText = detail?.querySelector('pre');
        return {
            tableWidth: element.getBoundingClientRect().width,
            scrollerWidth: element.parentElement?.getBoundingClientRect().width ?? 0,
            tableLayout: getComputedStyle(element).tableLayout,
            columnCount: headings.length,
            detailColSpan: detailCell?.getAttribute('colspan'),
            detailWidth: detailCell?.getBoundingClientRect().width ?? 0,
            errorWhiteSpace: errorText ? getComputedStyle(errorText).whiteSpace : '',
            errorOverflowWrap: errorText ? getComputedStyle(errorText).overflowWrap : '',
        };
    });
    expect(desktopGeometry).toMatchObject({
        tableLayout: 'fixed',
        columnCount: 6,
        detailColSpan: '6',
        errorWhiteSpace: 'pre-wrap',
    });
    expect(desktopGeometry.tableWidth).toBeGreaterThanOrEqual(680);
    expect(desktopGeometry.detailWidth).toBeGreaterThanOrEqual(desktopGeometry.tableWidth - 1);
    await page.screenshot({ path: testInfo.outputPath('gateway-release-error-expanded-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(table.getByRole('columnheader')).toHaveCount(4);
    await expect(table.getByRole('columnheader', { name: '소스', exact: true })).toHaveCount(0);
    await expect(table.getByRole('columnheader', { name: '해석 커밋', exact: true })).toHaveCount(0);
    const mobileGeometry = await table.evaluate((element) => {
        const scroller = element.parentElement!;
        const scrollerRect = scroller.getBoundingClientRect();
        const detailRect = element
            .querySelector('[data-testid="gateway-release-error-detail"]')!
            .getBoundingClientRect();
        return {
            tableWidth: element.getBoundingClientRect().width,
            scrollerX: scrollerRect.x,
            scrollerWidth: scrollerRect.width,
            scrollerScrollWidth: scroller.scrollWidth,
            detailWidth: detailRect.width,
            viewportWidth: document.documentElement.clientWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
        };
    });
    expect(mobileGeometry.tableWidth).toBeLessThanOrEqual(mobileGeometry.scrollerWidth + 1);
    expect(mobileGeometry.detailWidth).toBeGreaterThanOrEqual(mobileGeometry.tableWidth - 1);
    expect(mobileGeometry.scrollerScrollWidth).toBeLessThanOrEqual(mobileGeometry.scrollerWidth + 1);
    expect(mobileGeometry.scrollerX).toBeGreaterThanOrEqual(0);
    expect(mobileGeometry.scrollerX + mobileGeometry.scrollerWidth).toBeLessThanOrEqual(mobileGeometry.viewportWidth);
    expect(mobileGeometry.documentScrollWidth).toBeLessThanOrEqual(mobileGeometry.viewportWidth);
    await page.screenshot({ path: testInfo.outputPath('gateway-release-error-expanded-mobile.png'), fullPage: true });

    await errorToggle.click();
    await expect(errorToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('gateway-release-error-detail')).toBeHidden();
});

test('explains terminal releases created before controller progress logging', async ({ page }) => {
    const state: FixtureState = {
        operations: [],
        gatewayOperations: [
            {
                id: '99999999-9999-4999-8999-999999999999',
                type: 'DEPLOY',
                status: 'SUCCEEDED',
                sourceMode: 'COMMIT',
                sourceRef: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                payload: {},
                requestedBy: 'admin',
                createdAt: '2026-08-01T02:00:00.000Z',
                updatedAt: '2026-08-01T02:02:00.000Z',
            },
        ],
        gatewayLogsEmpty: true,
        runtimeRunning: true,
        requestBodies: [],
    };
    await installFixture(page, state);

    await page.goto('admin/releases');
    await expect(page.getByTestId('gateway-release-log')).toContainText(
        '로그 지원 controller 적용 전 작업일 수 있습니다.'
    );
    await expect(page.getByTestId('gateway-release-log')).not.toContainText('controller 로그를 기다리고 있습니다');
});

test('renders a failed reset, retries it as a new operation, and reaches success', async ({ page }, testInfo) => {
    const longError =
        '선택한 커밋의 프로필 프로세스를 시작하지 못했습니다. 실패 원인을 확인한 뒤 동일 generation으로 재시도해 주세요.';
    const state: FixtureState = {
        operations: [
            {
                id: '55555555-5555-4555-8555-555555555555',
                profileName: 'che:default',
                type: 'RESET',
                status: 'FAILED',
                sourceMode: 'COMMIT',
                sourceRef: 'fedcba9876543210fedcba9876543210fedcba98',
                resolvedCommitSha: 'fedcba9876543210fedcba9876543210fedcba98',
                payload: { installOperationId: 'failed-generation' },
                requestedBy: 'admin',
                completedAt: '2026-07-25T03:30:00.000Z',
                error: longError,
                createdAt: '2026-07-25T03:00:00.000Z',
                updatedAt: '2026-07-25T03:30:00.000Z',
            },
        ],
        gatewayOperations: [],
        runtimeRunning: false,
        requestBodies: [],
    };
    await installFixture(page, state);
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('admin/servers/che%3Adefault/scenario');
    await expect(page.getByTestId('operations-table').getByText('FAILED', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'fedcba987654', exact: true })).toBeVisible();
    const failure = page.getByTestId('operations-table').getByText(longError);
    await expect(failure).toBeVisible();
    expect(await failure.evaluate((element) => getComputedStyle(element).color)).toBe('oklch(0.704 0.191 22.216)');

    await page.getByRole('button', { name: '재시도' }).click();
    await expect(page.getByText('재시도 작업을 등록했습니다.').first()).toBeVisible();
    await expect(page.getByTestId('operations-table').getByText('FAILED', { exact: true })).toBeVisible();
    await expect(page.getByTestId('operations-table').getByText('QUEUED', { exact: true })).toBeVisible();
    await expect(page.getByTestId('operations-table').locator('tbody tr')).toHaveCount(2);

    state.operations[0] = {
        ...state.operations[0]!,
        status: 'SUCCEEDED',
        resolvedCommitSha: 'fedcba9876543210fedcba9876543210fedcba98',
        completedAt: '2026-07-25T04:05:00.000Z',
        updatedAt: '2026-07-25T04:05:00.000Z',
    };
    state.runtimeRunning = true;
    await page.getByTestId('refresh-operations').click();
    await expect(page.getByTestId('operations-table').getByText('SUCCEEDED', { exact: true })).toBeVisible();
    await expect(page.getByText('운영 프로필', { exact: true })).toHaveCount(0);

    await page.screenshot({ path: testInfo.outputPath('failed-retry-succeeded-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    const tableGeometry = await page.getByTestId('operations-table').evaluate((table) => {
        const tableRect = table.getBoundingClientRect();
        const scrollerRect = table.parentElement!.getBoundingClientRect();
        return { tableWidth: tableRect.width, scrollerWidth: scrollerRect.width };
    });
    expect(tableGeometry.tableWidth).toBeGreaterThan(tableGeometry.scrollerWidth);
    await page.screenshot({ path: testInfo.outputPath('failed-retry-succeeded-mobile.png'), fullPage: true });
});
