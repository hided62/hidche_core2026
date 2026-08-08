import { expect, test, type Page, type Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const response = (data: unknown) => ({ result: { data } });
const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const installFixture = async (page: Page) => {
    const mutations: Array<{ operation: string; body: unknown }> = [];
    let deleteAfter: string | null = null;
    let graceUntil: string | null = null;
    const auditHistory = [
        {
            id: 'audit-1',
            correlationId: 'correlation-1',
            actorUsername: 'admin',
            action: 'admin.users.updateSanctions',
            outcome: 'SUCCEEDED',
            reason: '기존 제재 사유',
            summary: {},
            createdAt: '2026-08-06T01:00:00.000Z',
        },
    ];
    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-session-token', 'playwright-admin-session');
    });
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const operations = operationNames(route);
        const body = route.request().postDataJSON() as unknown;
        const results = operations.map((operation) => {
            if (route.request().method() === 'POST') mutations.push({ operation, body });
            if (operation === 'me') {
                return response({
                    id: 'admin-user',
                    username: 'admin',
                    displayName: '관리자',
                    roles: ['superuser'],
                    createdAt: '2026-08-01T00:00:00.000Z',
                });
            }
            if (operation === 'admin.capabilities.list') {
                return response([
                    {
                        permission: 'admin.users.manage',
                        label: '사용자·제재 관리',
                        description: '계정 복구, 제재, OAuth 유예와 예약 탈퇴를 관리합니다.',
                        risk: 'CRITICAL',
                        scope: 'GLOBAL',
                    },
                    {
                        permission: 'admin.profiles.manage',
                        label: 'Profile 운영',
                        description: '지정 profile을 관리합니다.',
                        risk: 'CRITICAL',
                        scope: 'PROFILE',
                    },
                    {
                        permission: 'admin.audit.read',
                        label: '관리자 감사 조회',
                        description: 'Gateway 관리자 변경 이력을 조회합니다.',
                        risk: 'HIGH',
                        scope: 'GLOBAL',
                    },
                ]);
            }
            if (operation === 'admin.audit.list') return response(auditHistory);
            if (operation === 'admin.users.getLocalAccountStatus') return response({ enabled: false });
            if (operation === 'admin.system.getNotice') return response({ notice: '' });
            if (operation === 'admin.profiles.list') return response([]);
            if (operation === 'admin.profiles.listScenarios') return response([]);
            if (operation === 'admin.users.lookup') {
                return response({
                    id: 'target-user',
                    username: 'target',
                    displayName: '대상 사용자',
                    roles: ['user'],
                    sanctions: {},
                    oauthType: 'NONE',
                    kakaoGraceStartedAt: '2026-07-20T00:00:00.000Z',
                    kakaoGraceUntil: graceUntil,
                    deleteAfter,
                    createdAt: '2026-07-20T00:00:00.000Z',
                });
            }
            if (operation === 'admin.users.getKakaoGracePolicies') {
                return response({
                    kakaoVerified: false,
                    kakaoGraceStartedAt: '2026-07-20T00:00:00.000Z',
                    kakaoGraceUntil: graceUntil,
                    profiles: [
                        {
                            profileName: 'che:default',
                            requiresKakaoVerification: true,
                            kakaoVerified: false,
                            accessAllowed: true,
                            canCreateGeneral: false,
                            graceEndsAt: graceUntil ?? '2026-08-10T00:00:00.000Z',
                            generalCreationGraceDays: 0,
                            accessGraceDays: 7,
                        },
                    ],
                });
            }
            if (operation === 'admin.users.listHistory') return response(auditHistory);
            if (operation === 'admin.users.updateKakaoGrace') {
                graceUntil = '2026-08-20T00:00:00.000Z';
                auditHistory.unshift({
                    ...auditHistory[0],
                    id: 'audit-2',
                    action: 'admin.users.updateKakaoGrace',
                    reason: '본인 확인 처리 중',
                });
                return response({ kakaoGraceUntil: graceUntil });
            }
            if (operation === 'admin.users.scheduleDeletion') {
                deleteAfter = '2026-09-05T00:00:00.000Z';
                auditHistory.unshift({
                    ...auditHistory[0],
                    id: 'audit-3',
                    action: 'admin.users.scheduleDeletion',
                    reason: '탈퇴 요청 접수',
                });
                return response({ ok: true, deleteAfter });
            }
            throw new Error(`Unhandled tRPC operation: ${operation}`);
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    });
    return mutations;
};

test('operates OAuth grace and scheduled deletion with reasoned audit history', async ({ page }, testInfo) => {
    const mutations = await installFixture(page);
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('admin/users');
    await page.getByPlaceholder('검색 값 입력').fill('target');
    await page.getByRole('button', { name: '조회', exact: true }).click();

    await expect(page.getByText('Kakao 인증: 미완료')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'che:default' })).toBeVisible();
    await expect(page.getByText('SUCCEEDED · admin.users.updateSanctions').first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('gateway-admin-account-controls-desktop.png'), fullPage: true });
    const deletionButton = page.getByRole('button', { name: '보존 기간 후 탈퇴 예약', exact: true });
    const baseDeleteColor = await deletionButton.evaluate((button) => getComputedStyle(button).backgroundColor);
    await deletionButton.hover();
    await expect
        .poll(() => deletionButton.evaluate((button) => getComputedStyle(button).backgroundColor))
        .not.toBe(baseDeleteColor);
    await page.screenshot({ path: testInfo.outputPath('gateway-admin-account-controls-hover.png'), fullPage: true });
    await page.getByPlaceholder('권한·제재·복구·탈퇴 조치 사유 (필수)').fill('본인 확인 처리 중');
    await page.locator('input[type="datetime-local"]').nth(0).fill('2026-08-20T00:00');
    await page.getByRole('button', { name: '유예 연장', exact: true }).click();
    await expect(page.getByText('OAuth 유예 연장 완료')).toBeVisible();
    await expect(page.getByText('SUCCEEDED · admin.users.updateKakaoGrace').first()).toBeVisible();

    await page.getByPlaceholder('권한·제재·복구·탈퇴 조치 사유 (필수)').fill('탈퇴 요청 접수');
    await page.getByLabel('탈퇴 전 보존 일수').fill('30');
    await deletionButton.click();
    await expect(page.getByText(/탈퇴 예약 완료/)).toBeVisible();
    expect(mutations.some(({ operation }) => operation === 'admin.users.updateKakaoGrace')).toBe(true);
    expect(mutations.some(({ operation }) => operation === 'admin.users.scheduleDeletion')).toBe(true);

    await page.getByRole('link', { name: '감사 로그' }).click();
    await expect(page).toHaveURL(/\/gateway\/admin\/audit$/);
    await expect(page.getByRole('heading', { name: '전체 관리자 감사 원장' })).toBeVisible();
    await expect(page.getByText('SUCCEEDED · admin.users.updateKakaoGrace').first()).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    const geometry = await page
        .getByRole('heading', { name: '전체 관리자 감사 원장' })
        .locator('..')
        .evaluate((panel) => {
            const rect = panel.getBoundingClientRect();
            return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: window.innerWidth };
        });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth);
    await writeFile(
        testInfo.outputPath('gateway-admin-account-controls-mobile-geometry.json'),
        JSON.stringify(geometry)
    );
    await page.screenshot({ path: testInfo.outputPath('gateway-admin-account-controls-mobile.png'), fullPage: true });
});
