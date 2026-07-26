import { expect, test, type Page, type Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

type OperationStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
type Operation = {
    id: string;
    profileName: string;
    type: 'RESET' | 'START' | 'STOP';
    status: OperationStatus;
    sourceMode?: 'BRANCH' | 'COMMIT';
    sourceRef?: string;
    resolvedCommitSha?: string;
    payload: Record<string, unknown>;
    requestedBy: string;
    createdAt: string;
    updatedAt: string;
};

type FixtureState = {
    operations: Operation[];
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
        apiRunning: runtimeRunning,
        daemonRunning: runtimeRunning,
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
    const state: FixtureState = { operations: [], runtimeRunning: false, requestBodies: [] };
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

    await expect(page.getByText('초기화 작업을 시작했습니다.')).toBeVisible();
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

test('starts and stops both runtime roles through the operation controls', async ({ page }) => {
    const state: FixtureState = { operations: [], runtimeRunning: false, requestBodies: [] };
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
