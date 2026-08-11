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
    let specialGrants: Array<Record<string, unknown>> = [];
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
            if (operation === 'admin.users.list') {
                return response({
                    total: 3,
                    users: [
                        {
                            id: 'target-user',
                            username: 'target',
                            displayName: '대상 사용자',
                            email: 'target@example.test',
                            oauthType: 'NONE',
                            roles: ['user'],
                            hasActiveSanction: false,
                            deleteAfter,
                            createdAt: '2026-07-20T00:00:00.000Z',
                        },
                        {
                            id: 'viewer-user',
                            username: 'viewer',
                            displayName: '조회 사용자',
                            oauthType: 'KAKAO',
                            roles: ['user'],
                            hasActiveSanction: true,
                            createdAt: '2026-07-19T00:00:00.000Z',
                        },
                        {
                            id: 'admin-user',
                            username: 'admin',
                            displayName: '관리자',
                            oauthType: 'NONE',
                            roles: ['superuser'],
                            hasActiveSanction: false,
                            createdAt: '2026-07-18T00:00:00.000Z',
                        },
                    ],
                });
            }
            if (operation === 'admin.system.getNotice') return response({ notice: '' });
            if (operation === 'admin.profiles.listNavigation') return response([]);
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
                    specialAccessGrants: specialGrants,
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
                            specialAccess: specialGrants.length
                                ? {
                                      kind: 'RECOVERY',
                                      grantId: '11111111-1111-4111-8111-111111111111',
                                      expiresAt: '2026-08-20T00:00:00.000Z',
                                      allowsGeneralCreation: true,
                                  }
                                : null,
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
            if (operation === 'admin.users.grantSpecialAccess') {
                specialGrants = [
                    {
                        id: '11111111-1111-4111-8111-111111111111',
                        userId: 'target-user',
                        kind: 'RECOVERY',
                        profiles: ['che'],
                        allowsGeneralCreation: true,
                        expiresAt: '2026-08-20T00:00:00.000Z',
                        reason: '휴대폰 분실 임시 복구',
                        grantedByUserId: 'admin-user',
                        createdAt: '2026-08-08T00:00:00.000Z',
                    },
                ];
                auditHistory.unshift({
                    ...auditHistory[0],
                    id: 'audit-special',
                    action: 'admin.users.grantSpecialAccess',
                    reason: '휴대폰 분실 임시 복구',
                });
                return response(specialGrants[0]);
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
        const isBatch = new URL(route.request().url()).searchParams.get('batch') === '1';
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(isBatch ? results : results[0]),
        });
    });
    return mutations;
};

test('operates OAuth grace and scheduled deletion with reasoned audit history', async ({ page }, testInfo) => {
    const mutations = await installFixture(page);
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('admin/users');
    await expect(page.getByRole('region', { name: '계정 목록' })).toBeVisible();
    await expect(page.getByText('총 3개')).toBeVisible();
    await page.getByRole('button', { name: /target.*대상 사용자/ }).click();

    await expect(page.getByText('Kakao 인증: 미완료')).toBeVisible();
    await expect(page.getByRole('navigation', { name: '사용자 관리 기능' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '비밀번호 리셋' })).toBeHidden();
    await page.getByRole('button', { name: /접근 · 권한/ }).click();
    await expect(page.getByRole('cell', { name: 'che:default' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('gateway-admin-account-controls-desktop.png'), fullPage: true });
    await page.getByPlaceholder('권한·제재·복구·탈퇴 조치 사유 (필수)').fill('본인 확인 처리 중');
    await page.getByLabel('특수 접근 만료 시각').fill('2026-08-20T00:00');
    await page.getByPlaceholder('che 또는 che:2 (쉼표 구분, 비우면 전체)').fill('che');
    await page.getByPlaceholder('권한·제재·복구·탈퇴 조치 사유 (필수)').fill('휴대폰 분실 임시 복구');
    await page.getByRole('button', { name: '특수 접근 부여', exact: true }).click();
    await expect(page.getByText('특수 접근 자격을 부여했습니다.').first()).toBeVisible();
    await expect(page.getByText(/RECOVERY · che/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('gateway-admin-special-access-granted.png'), fullPage: true });

    const gracePanel = page.getByRole('heading', { name: 'Kakao 인증 유예' }).locator('..');
    await page.getByPlaceholder('권한·제재·복구·탈퇴 조치 사유 (필수)').fill('본인 확인 처리 중');
    await gracePanel.locator('input[type="datetime-local"]').fill('2026-08-20T00:00');
    await page.getByRole('button', { name: '유예 연장', exact: true }).click();
    await expect(page.getByText('OAuth 유예 연장 완료').first()).toBeVisible();

    await page.getByRole('button', { name: /탈퇴 · 이력/ }).click();
    await expect(page.getByText('SUCCEEDED · admin.users.updateKakaoGrace').first()).toBeVisible();
    const deletionButton = page.getByRole('button', { name: '보존 기간 후 탈퇴 예약', exact: true });
    const baseDeleteColor = await deletionButton.evaluate((button) => getComputedStyle(button).backgroundColor);
    await deletionButton.hover();
    await expect
        .poll(() => deletionButton.evaluate((button) => getComputedStyle(button).backgroundColor))
        .not.toBe(baseDeleteColor);
    await page.screenshot({ path: testInfo.outputPath('gateway-admin-account-controls-hover.png'), fullPage: true });
    await page.getByPlaceholder('권한·제재·복구·탈퇴 조치 사유 (필수)').fill('탈퇴 요청 접수');
    await page.getByLabel('탈퇴 전 보존 일수').fill('30');
    await deletionButton.click();
    await expect(page.getByText(/탈퇴 예약 완료/).first()).toBeVisible();
    expect(mutations.some(({ operation }) => operation === 'admin.users.updateKakaoGrace')).toBe(true);
    expect(mutations.some(({ operation }) => operation === 'admin.users.grantSpecialAccess')).toBe(true);
    expect(mutations.some(({ operation }) => operation === 'admin.users.scheduleDeletion')).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    const userDirectoryGeometry = await page.getByRole('region', { name: '계정 목록' }).evaluate((directory) => {
        const rect = directory.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: window.innerWidth };
    });
    expect(userDirectoryGeometry.left).toBeGreaterThanOrEqual(0);
    expect(userDirectoryGeometry.right).toBeLessThanOrEqual(userDirectoryGeometry.viewportWidth);
    await writeFile(
        testInfo.outputPath('gateway-admin-user-directory-mobile-geometry.json'),
        JSON.stringify(userDirectoryGeometry)
    );
    await page.screenshot({ path: testInfo.outputPath('gateway-admin-user-directory-mobile.png'), fullPage: true });

    await page.getByRole('button', { name: '관리자 메뉴' }).click();
    await page.getByRole('link', { name: '감사 로그' }).click();
    await expect(page).toHaveURL(/\/gateway\/admin\/audit$/);
    await expect(page.getByRole('heading', { name: '전체 관리자 감사 원장' })).toBeVisible();
    await expect(page.getByText('SUCCEEDED · admin.users.updateKakaoGrace').first()).toBeVisible();

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
