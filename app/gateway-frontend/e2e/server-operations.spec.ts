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

type FixtureState = {
    operations: Operation[];
    gatewayOperations: Array<{
        id: string;
        type: 'DEPLOY' | 'ROLLBACK';
        status: OperationStatus;
        sourceMode?: 'BRANCH' | 'COMMIT';
        sourceRef?: string;
        payload: Record<string, unknown>;
        requestedBy: string;
        createdAt: string;
        updatedAt: string;
    }>;
    runtimeRunning: boolean;
    requestBodies: Array<{ operation: string; body: unknown }>;
};

const profile = (runtimeRunning: boolean) => ({
    profileName: 'che:2',
    profile: 'che',
    scenario: '2',
    apiPort: 15003,
    status: runtimeRunning ? 'RUNNING' : 'STOPPED',
    buildStatus: 'SUCCEEDED',
    buildCommitSha: '0123456789abcdef0123456789abcdef01234567',
    buildWorkspace: '/srv/sammo/worktrees/0123456789abcdef0123456789abcdef01234567',
    meta: {},
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    runtime: {
        profileName: 'che:2',
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
        id: 2,
        title: '【테스트】황건의 난',
        year: 184,
        npcCount: 42,
        npcExCount: 0,
        npcNeutralCount: 0,
        nations: [],
    },
    {
        id: 5,
        title: '【테스트】군웅할거',
        year: 190,
        npcCount: 55,
        npcExCount: 0,
        npcNeutralCount: 0,
        nations: [],
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
        const results = names.map((name) => {
            if (route.request().method() === 'POST') {
                state.requestBodies.push({ operation: name, body });
            }
            if (name === 'admin.profiles.list') {
                return response([profile(state.runtimeRunning)]);
            }
            if (name === 'admin.operations.list') {
                return response(state.operations);
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
            if (name === 'admin.profiles.listScenarios') {
                return response(scenarios);
            }
            if (name === 'admin.operations.requestReset') {
                const operation: Operation = {
                    id: '11111111-1111-4111-8111-111111111111',
                    profileName: 'che:2',
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
                    profileName: 'che:2',
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
                    profileName: 'che:2',
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
                    profileName: 'che:2',
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
            body: JSON.stringify(results),
        });
    });
};

test('separates branch and commit semantics and submits a reset from the dedicated page', async ({
    page,
}, testInfo) => {
    const state: FixtureState = { operations: [], gatewayOperations: [], runtimeRunning: false, requestBodies: [] };
    await installFixture(page, state);
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('admin/server-operations');
    await expect(page.getByTestId('server-operations-page')).toBeVisible();
    await expect(page).toHaveURL(/\/gateway\/admin\/server-operations$/);
    await expect(page.getByTestId('source-help')).toContainText('실제로 시작될 때');
    await expect(page.getByTestId('scenario-select')).toHaveValue('2');

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
    expect(desktopGeometry).toHaveLength(2);
    expect(desktopGeometry[1]!.x).toBeGreaterThan(desktopGeometry[0]!.x);
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
        JSON.stringify({ desktopGeometry, focusedInputStyle }, null, 2)
    );
    await page.screenshot({ path: testInfo.outputPath('desktop-operations.png'), fullPage: true });

    await page.getByTestId('source-commit').check();
    await expect(page.getByTestId('source-help')).toContainText('전체 SHA로 고정');
    await page.getByTestId('source-ref').fill('0123456789abcdef0123456789abcdef01234567');
    await page.getByTestId('load-scenarios').click();
    await page.getByTestId('scenario-select').selectOption('5');
    await page.getByTestId('request-reset').hover();
    await page.getByTestId('request-reset').click();

    await expect(page.getByText('초기화 작업을 등록했습니다.')).toBeVisible();
    await expect(page.getByTestId('operations-table')).toContainText('RESET');
    const resetRequest = state.requestBodies.find((entry) => entry.operation === 'admin.operations.requestReset');
    expect(JSON.stringify(resetRequest?.body)).toContain('"sourceMode":"COMMIT"');
    expect(JSON.stringify(resetRequest?.body)).toContain('0123456789abcdef0123456789abcdef01234567');
    expect(JSON.stringify(resetRequest?.body)).toContain('"scenarioId":5');

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
    expect(mobileGeometry[1]!.y).toBeGreaterThan(mobileGeometry[0]!.y);
    expect(mobileGeometry[0]!.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath('mobile-operations.png'), fullPage: true });
});

test('starts and stops all runtime roles through the operation controls', async ({ page }) => {
    const state: FixtureState = { operations: [], gatewayOperations: [], runtimeRunning: false, requestBodies: [] };
    await installFixture(page, state);
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('admin/server-operations');
    await page.getByTestId('start-server').click();
    await expect(page.getByText('시작 작업을 요청했습니다.')).toBeVisible();
    await expect(page.getByText('RUNNING', { exact: true }).first()).toBeVisible();

    await page.getByTestId('stop-server').click();
    await expect(page.getByText('정지 작업을 요청했습니다.')).toBeVisible();
    await expect(page.getByText('STOPPED', { exact: true }).first()).toBeVisible();

    const serializedRequests = state.requestBodies.map((entry) => JSON.stringify(entry.body)).join('\n');
    expect(serializedRequests).toContain('"action":"START"');
    expect(serializedRequests).toContain('"action":"STOP"');
});

test('separates DB-preserving profile deployment from DB reset', async ({ page }) => {
    const state: FixtureState = { operations: [], gatewayOperations: [], runtimeRunning: true, requestBodies: [] };
    await installFixture(page, state);
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('admin/server-operations');
    await expect(page.getByText('Game frontend')).toBeVisible();
    await page.getByTestId('request-deploy').click();

    await expect(page.getByText('DB 보존 배포 작업을 등록했습니다.')).toBeVisible();
    await expect(page.getByTestId('operations-table')).toContainText('DEPLOY');
    expect(state.requestBodies.some((entry) => entry.operation === 'admin.operations.requestDeploy')).toBe(true);
    expect(state.requestBodies.some((entry) => entry.operation === 'admin.operations.requestReset')).toBe(false);
});

test('controls gateway deployment and rollback through the external controller queue', async ({ page }, testInfo) => {
    const state: FixtureState = { operations: [], gatewayOperations: [], runtimeRunning: true, requestBodies: [] };
    await installFixture(page, state);
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('admin/server-operations');
    const panel = page.getByTestId('gateway-release-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('aaaaaaaaaaaa');
    await expect(panel).toContainText('bbbbbbbbbbbb');
    await page.getByTestId('gateway-source-ref').fill('release/2026-08');
    await page.getByTestId('request-gateway-deploy').click();

    await expect(page.getByText(/Gateway 배포 작업을 등록했습니다/)).toBeVisible();
    await expect(page.getByTestId('gateway-release-table')).toContainText('DEPLOY');
    expect(state.requestBodies.some((entry) => entry.operation === 'admin.releases.requestGatewayDeploy')).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('gateway-release-desktop.png'), fullPage: true });

    state.gatewayOperations = [];
    await page.getByTestId('refresh-operations').click();
    await page.getByTestId('request-gateway-rollback').click();
    await expect(page.getByText('Gateway rollback 작업을 등록했습니다.')).toBeVisible();
    expect(state.requestBodies.some((entry) => entry.operation === 'admin.releases.requestGatewayRollback')).toBe(true);
});

test('renders a failed reset, retries it as a new operation, and reaches success', async ({ page }, testInfo) => {
    const longError =
        '선택한 커밋의 프로필 프로세스를 시작하지 못했습니다. 실패 원인을 확인한 뒤 동일 generation으로 재시도해 주세요.';
    const state: FixtureState = {
        operations: [
            {
                id: '55555555-5555-4555-8555-555555555555',
                profileName: 'che:2',
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

    await page.goto('admin/server-operations');
    await expect(page.getByText('FAILED', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'fedcba987654', exact: true })).toBeVisible();
    const failure = page.getByText(longError);
    await expect(failure).toBeVisible();
    expect(await failure.evaluate((element) => getComputedStyle(element).color)).toBe('oklch(0.704 0.191 22.216)');

    await page.getByRole('button', { name: '재시도' }).click();
    await expect(page.getByText('재시도 작업을 등록했습니다.')).toBeVisible();
    await expect(page.getByText('FAILED', { exact: true })).toBeVisible();
    await expect(page.getByText('QUEUED', { exact: true })).toBeVisible();
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
    await expect(page.getByText('SUCCEEDED', { exact: true })).toBeVisible();
    await expect(page.getByText('RUNNING', { exact: true }).first()).toBeVisible();

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
