import { expect, test, type Page, type Route } from '@playwright/test';

const response = (data: unknown) => ({ result: { data } });
const errorResponse = (path: string, message: string) => ({
    error: {
        message,
        code: -32603,
        data: {
            code: 'INTERNAL_SERVER_ERROR',
            httpStatus: 500,
            path,
        },
    },
});

const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const fulfillTrpc = async (route: Route, results: unknown[]): Promise<void> => {
    await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
            'access-control-allow-origin': '*',
        },
        body: JSON.stringify(results),
    });
};

const profileInputAt = (body: string, index: number): string | null => {
    try {
        const parsed = JSON.parse(body) as Record<string, { profile?: unknown; json?: { profile?: unknown } }>;
        const input = parsed[String(index)];
        const profile = input?.profile ?? input?.json?.profile;
        return typeof profile === 'string' ? profile : null;
    } catch {
        return null;
    }
};

type FixtureOptions = {
    failHweAdjustOnce?: boolean;
    delayHweAdjust?: boolean;
};

const activeProfiles = [
    {
        profileName: 'che:903',
        profile: 'che',
        apiPort: 15003,
        korName: 'CHE 서버',
    },
    {
        profileName: 'hwe:903',
        profile: 'hwe',
        apiPort: 15015,
        korName: '훼',
    },
];

const installFixture = async (page: Page, options: FixtureOptions = {}) => {
    let deleteIconCount = 0;
    let preferredIconCount = 0;
    let retireIconCount = 0;
    let hweAdjustCount = 0;
    const operations = new Map<string, string[]>([
        ['che:903', []],
        ['hwe:903', []],
    ]);

    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-session-token', 'account-session');
    });
    await page.route('**/gateway/api/trpc/**', async (route) => {
        const body = route.request().postData() ?? '';
        const results = operationNames(route).map((operation, index) => {
            if (operation === 'account.get') {
                return response({
                    id: 'account-user',
                    username: 'account-user',
                    displayName: '계정 사용자',
                    roles: ['user'],
                    oauthType: 'NONE',
                    createdAt: '2026-07-30T00:00:00.000Z',
                    iconUrl: '/gateway/api/user-icons/old.png',
                    icons: [
                        {
                            id: '3f804277-584f-4f44-b39c-9ecf40d1ed31',
                            picture: 'old.png',
                            imageServer: 1,
                            createdAt: '2026-07-30T00:00:00.000Z',
                            retiredAt: null,
                            url: '/gateway/api/user-icons/old.png',
                        },
                        {
                            id: '9bc328b0-3fc8-44ec-a845-287e438e8edf',
                            picture: 'second.png',
                            imageServer: 1,
                            createdAt: '2026-07-31T00:00:00.000Z',
                            retiredAt: null,
                            url: '/gateway/api/user-icons/second.png',
                        },
                    ],
                    preferredPicture: 'old.png',
                    maxActiveIcons: 5,
                    nextUploadAt: null,
                    nextRetireAt: null,
                    thirdPartyUse: false,
                    deleteAfter: null,
                });
            }
            if (operation === 'account.notifications.get') {
                return response({
                    capability: { enabled: false, publicKey: null },
                    eventTypes: [
                        'TROOP_ANNIHILATED',
                        'PRIVATE_MESSAGE_RECEIVED',
                        'AUTONOMOUS_ACTION_ENDED',
                        'RESERVED_TURNS_ENDED',
                        'PROFILE_PREOPENED',
                        'PROFILE_OPEN_SCHEDULED',
                        'PROFILE_OPENED',
                        'NATION_DESTROYED',
                        'TARGET_DATE_REACHED',
                    ],
                    profiles: [],
                    preferences: [],
                    subscriptionCount: 0,
                    currentDeviceSubscribed: false,
                });
            }
            if (operation === 'account.changeIcon') {
                return response({
                    ok: true,
                    iconUrl: '/gateway/api/user-icons/new.png',
                    revision: '2026-07-31T09:00:00.001Z',
                    profiles: activeProfiles,
                    flushPublished: true,
                });
            }
            if (operation === 'account.setPreferredIcon') {
                preferredIconCount += 1;
                return response({ ok: true, revision: '2026-08-01T00:00:00.001Z', flushPublished: true });
            }
            if (operation === 'account.retireIcon') {
                retireIconCount += 1;
                return response({
                    ok: true,
                    revision: '2026-08-01T00:00:00.002Z',
                    preferredChanged: false,
                    iconUrl: '/gateway/api/user-icons/old.png',
                    flushPublished: true,
                });
            }
            if (operation === 'account.deleteIcon') {
                deleteIconCount += 1;
                return response({
                    ok: true,
                    iconUrl: null,
                    revision: '2026-07-31T09:00:00.002Z',
                    profiles: [activeProfiles[1]],
                    flushPublished: true,
                });
            }
            if (operation === 'account.prepareIconSync') {
                return response({
                    iconUrl: '/gateway/api/user-icons/new.png',
                    projection: {
                        revision: '2026-07-31T09:00:00.001Z',
                        picture: 'new.png',
                        imageServer: 1,
                    },
                    profiles: activeProfiles,
                });
            }
            if (operation === 'auth.issueGameSession') {
                const profileName = profileInputAt(body, index);
                expect(profileName === 'che:903' || profileName === 'hwe:903').toBe(true);
                if (profileName !== 'che:903' && profileName !== 'hwe:903') {
                    throw new Error('issueGameSession profile input was not encoded in the request.');
                }
                operations.get(profileName)?.push('issueGameSession');
                return response({
                    profile: profileName,
                    gameToken: `gateway-token-${profileName}`,
                    expiresAt: '2026-07-31T01:00:00.000Z',
                });
            }
            throw new Error(`Unhandled gateway tRPC operation: ${operation}`);
        });
        await fulfillTrpc(route, results);
    });

    const installGameRoute = async (profileName: 'che:903' | 'hwe:903'): Promise<void> => {
        const handle = async (route: Route): Promise<void> => {
            expect(new URL(route.request().url()).pathname).toBe(
                `/${profileName.split(':')[0]}/api/trpc/${operationNames(route).join(',')}`
            );
            const results = [];
            for (const operation of operationNames(route)) {
                if (operation === 'auth.exchangeGatewayToken') {
                    operations.get(profileName)?.push('exchangeGatewayToken');
                    results.push(
                        response({
                            accessToken: `access-token-${profileName}`,
                            profile: profileName,
                            expiresAt: '2026-07-31T01:00:00.000Z',
                        })
                    );
                    continue;
                }
                if (operation === 'general.adjustIcon') {
                    operations.get(profileName)?.push('adjustIcon');
                    if (profileName === 'hwe:903') {
                        hweAdjustCount += 1;
                        if (options.delayHweAdjust) {
                            await new Promise((resolve) => setTimeout(resolve, 200));
                        }
                        if (options.failHweAdjustOnce && hweAdjustCount === 1) {
                            results.push(errorResponse(operation, 'HWE 아이콘 적용 실패'));
                            continue;
                        }
                    }
                    expect(route.request().headers().authorization).toBe(`Bearer access-token-${profileName}`);
                    results.push(response({ generalId: 101, updated: true }));
                    continue;
                }
                throw new Error(`Unhandled ${profileName} tRPC operation: ${operation}`);
            }
            await fulfillTrpc(route, results);
        };
        await page.route(`**/${profileName.split(':')[0]}/api/trpc/**`, handle);
    };

    await installGameRoute('che:903');
    await installGameRoute('hwe:903');

    return {
        operations,
        deleteIconCount: () => deleteIconCount,
        preferredIconCount: () => preferredIconCount,
        retireIconCount: () => retireIconCount,
    };
};

test('chooses a preferred library icon and retires an icon only after confirmation', async ({ page }) => {
    const fixture = await installFixture(page);
    await page.goto('account');
    await expect(page.locator('.account-icon-card')).toHaveCount(2);
    await expect(page.getByText('2 / 5개')).toBeVisible();

    await page.getByRole('button', { name: '대표로 설정' }).click();
    await expect.poll(fixture.preferredIconCount).toBe(1);

    page.once('dialog', async (dialog) => {
        expect(dialog.message()).toContain('과거 기록의 이미지는 보존됩니다');
        await dialog.accept();
    });
    await page.getByRole('button', { name: '목록에서 내리기' }).first().click();
    await expect.poll(fixture.retireIconCount).toBe(1);
});

const uploadIcon = async (page: Page): Promise<void> => {
    await page.locator('input[type="file"]').setInputFiles({
        name: 'new-icon.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64'
        ),
    });
    await page.getByRole('button', { name: '아이콘 변경' }).click();
};

test('selects every returned server and applies only checked servers in issue-exchange-adjust order', async ({
    page,
}) => {
    const fixture = await installFixture(page, { delayHweAdjust: true });
    await page.goto('account');
    await uploadIcon(page);

    const modal = page.getByTestId('icon-server-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('완료되었습니다.');
    await expect(page.getByTestId('icon-server-option-che:903')).toBeChecked();
    await expect(page.getByTestId('icon-server-option-hwe:903')).toBeChecked();
    await expect(page.getByTestId('icon-server-option-stopped:903')).toHaveCount(0);
    await expect(page.locator('.icon-server-dialog')).toBeFocused();

    await page.getByTestId('icon-server-apply').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('icon-server-close')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByTestId('icon-server-apply')).toBeFocused();

    await page.getByTestId('icon-server-option-che:903').uncheck();
    await page.getByTestId('icon-server-apply').click();
    await expect(page.getByTestId('icon-server-apply')).toBeDisabled();
    await expect(page.getByTestId('icon-server-close')).toBeDisabled();
    await expect
        .poll(() =>
            page.getByTestId('icon-server-apply').evaluate((element) => ({
                opacity: getComputedStyle(element).opacity,
                transitionDuration: getComputedStyle(element).transitionDuration,
            }))
        )
        .toEqual({
            opacity: '0.65',
            transitionDuration: '0.15s, 0.15s, 0.15s, 0.15s',
        });
    await expect
        .poll(() =>
            page.evaluate(() => {
                const dialog = document.querySelector<HTMLElement>('.icon-server-dialog');
                return Boolean(dialog && dialog.contains(document.activeElement));
            })
        )
        .toBe(true);
    await expect(page.getByTestId('icon-server-result-hwe:903')).toContainText('적용 중');
    await expect(page.getByTestId('icon-server-result-hwe:903')).toContainText('적용됨');

    expect(fixture.operations.get('che:903')).toEqual([]);
    expect(fixture.operations.get('hwe:903')).toEqual(['issueGameSession', 'exchangeGatewayToken', 'adjustIcon']);

    await page.keyboard.press('Escape');
    await expect(modal).toBeVisible();
    await page.getByTestId('icon-server-close').click();
    await expect(modal).toBeHidden();
    await expect(page.getByRole('button', { name: '아이콘 변경' })).toBeFocused();
});

test('keeps per-server failures visible and retries only failed servers', async ({ page }) => {
    const fixture = await installFixture(page, { failHweAdjustOnce: true });
    await page.goto('account');
    await uploadIcon(page);
    await page.getByTestId('icon-server-apply').click();

    await expect(page.getByTestId('icon-server-result-che:903')).toContainText('적용됨');
    await expect(page.getByTestId('icon-server-result-hwe:903')).toContainText('HWE 아이콘 적용 실패');
    await expect(page.getByTestId('icon-server-retry')).toBeVisible();

    await page.getByTestId('icon-server-retry').click();
    await expect(page.getByTestId('icon-server-result-hwe:903')).toContainText('적용됨');
    await expect(page.getByTestId('icon-server-retry')).toHaveCount(0);

    expect(fixture.operations.get('che:903')).toEqual(['issueGameSession', 'exchangeGatewayToken', 'adjustIcon']);
    expect(fixture.operations.get('hwe:903')).toEqual([
        'issueGameSession',
        'exchangeGatewayToken',
        'adjustIcon',
        'issueGameSession',
        'exchangeGatewayToken',
        'adjustIcon',
    ]);
});

test('uses the Ref delete confirmation and opens the modal only after acceptance', async ({ page }, testInfo) => {
    const fixture = await installFixture(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('account');

    page.once('dialog', async (dialog) => {
        expect(dialog.message()).toBe('아이콘을 제거할까요?');
        await dialog.dismiss();
    });
    await page.getByRole('button', { name: '아이콘 제거' }).click();
    await expect(page.getByTestId('icon-server-modal')).toHaveCount(0);
    expect(fixture.deleteIconCount()).toBe(0);

    page.once('dialog', async (dialog) => {
        expect(dialog.message()).toBe('아이콘을 제거할까요?');
        await dialog.accept();
    });
    await page.getByRole('button', { name: '아이콘 제거' }).click();
    await expect(page.getByTestId('icon-server-modal')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByTestId('icon-server-option-hwe:903')).toBeChecked();
    await expect(page.getByTestId('icon-server-option-che:903')).toHaveCount(0);
    expect(fixture.deleteIconCount()).toBe(1);
    await page.locator('.icon-server-dialog').screenshot({
        path: testInfo.outputPath('core-icon-modal-desktop.png'),
        animations: 'disabled',
    });

    const geometry = await page.evaluate(() => {
        const rect = (selector: string) => {
            const value = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
            return { x: value.x, y: value.y, width: value.width, height: value.height };
        };
        const dialogStyle = getComputedStyle(document.querySelector<HTMLElement>('.icon-server-dialog')!);
        const titleStyle = getComputedStyle(document.querySelector<HTMLElement>('.icon-server-header h2')!);
        const closeStyle = getComputedStyle(document.querySelector<HTMLElement>('[data-testid="icon-server-close"]')!);
        const secondaryStyle = getComputedStyle(document.querySelector<HTMLElement>('.icon-server-footer .secondary')!);
        const applyStyle = getComputedStyle(document.querySelector<HTMLElement>('[data-testid="icon-server-apply"]')!);
        const backdropStyle = getComputedStyle(document.querySelector<HTMLElement>('.icon-server-backdrop')!);
        const motionStyle = getComputedStyle(document.querySelector<HTMLElement>('.icon-server-dialog')!);
        return {
            dialog: rect('.icon-server-dialog'),
            header: rect('.icon-server-header'),
            title: rect('.icon-server-header h2'),
            body: rect('.icon-server-body'),
            footer: rect('.icon-server-footer'),
            close: rect('[data-testid="icon-server-close"]'),
            secondary: rect('.icon-server-footer .secondary'),
            apply: rect('[data-testid="icon-server-apply"]'),
            dialogStyle: {
                color: dialogStyle.color,
                backgroundColor: dialogStyle.backgroundColor,
                borderColor: dialogStyle.borderColor,
                borderRadius: dialogStyle.borderRadius,
                boxShadow: dialogStyle.boxShadow,
                fontFamily: dialogStyle.fontFamily,
                fontSize: dialogStyle.fontSize,
                lineHeight: dialogStyle.lineHeight,
            },
            titleStyle: {
                fontSize: titleStyle.fontSize,
                fontWeight: titleStyle.fontWeight,
                lineHeight: titleStyle.lineHeight,
            },
            closeStyle: {
                color: closeStyle.color,
                backgroundColor: closeStyle.backgroundColor,
                borderColor: closeStyle.borderColor,
                borderRadius: closeStyle.borderRadius,
                fontSize: closeStyle.fontSize,
                fontWeight: closeStyle.fontWeight,
                lineHeight: closeStyle.lineHeight,
                padding: closeStyle.padding,
                opacity: closeStyle.opacity,
            },
            secondaryStyle: {
                color: secondaryStyle.color,
                backgroundColor: secondaryStyle.backgroundColor,
                borderColor: secondaryStyle.borderColor,
                borderRadius: secondaryStyle.borderRadius,
                fontSize: secondaryStyle.fontSize,
                fontWeight: secondaryStyle.fontWeight,
                lineHeight: secondaryStyle.lineHeight,
                padding: secondaryStyle.padding,
            },
            applyStyle: {
                color: applyStyle.color,
                backgroundColor: applyStyle.backgroundColor,
                borderColor: applyStyle.borderColor,
                borderRadius: applyStyle.borderRadius,
                fontSize: applyStyle.fontSize,
                fontWeight: applyStyle.fontWeight,
                lineHeight: applyStyle.lineHeight,
                padding: applyStyle.padding,
                transitionDuration: applyStyle.transitionDuration,
                transitionProperty: applyStyle.transitionProperty,
            },
            backdropStyle: {
                transitionDuration: backdropStyle.transitionDuration,
                transitionProperty: backdropStyle.transitionProperty,
            },
            motionStyle: {
                transitionDuration: motionStyle.transitionDuration,
                transitionProperty: motionStyle.transitionProperty,
                transitionTimingFunction: motionStyle.transitionTimingFunction,
            },
        };
    });
    expect(geometry.dialog).toEqual({ x: 470, y: 28, width: 500, height: 224 });
    expect(geometry.header).toEqual({ x: 471, y: 29, width: 498, height: 93 });
    expect(geometry.title).toEqual({ x: 487, y: 45, width: 297, height: 60 });
    expect(geometry.body).toEqual({ x: 471, y: 122, width: 498, height: 56 });
    expect(geometry.footer).toEqual({ x: 471, y: 178, width: 498, height: 73 });
    expect(geometry.close).toEqual({ x: 927, y: 60, width: 26, height: 30 });
    expect(geometry.secondary).toEqual({ x: 805, y: 195, width: 54, height: 40 });
    expect(geometry.apply).toEqual({ x: 867, y: 195, width: 86, height: 40 });
    expect(geometry.dialogStyle).toMatchObject({
        color: 'rgb(255, 255, 255)',
        backgroundColor: 'rgb(48, 48, 48)',
        borderColor: 'rgb(68, 68, 68)',
        borderRadius: '8px',
        boxShadow: 'none',
        fontSize: '16px',
        lineHeight: '24px',
    });
    expect(geometry.dialogStyle.fontFamily).toContain('Pretendard');
    expect(geometry.titleStyle).toEqual({ fontSize: '20px', fontWeight: '500', lineHeight: '30px' });
    expect(geometry.closeStyle).toEqual({
        color: 'rgb(255, 255, 255)',
        backgroundColor: 'rgb(107, 107, 107)',
        borderColor: 'rgb(255, 255, 255)',
        borderRadius: '0px',
        fontSize: '16px',
        fontWeight: '400',
        lineHeight: '24px',
        padding: '1px 6px',
        opacity: '1',
    });
    expect(geometry.secondaryStyle).toEqual({
        color: 'rgb(255, 255, 255)',
        backgroundColor: 'rgb(68, 68, 68)',
        borderColor: 'rgb(61, 61, 61)',
        borderRadius: '6px',
        fontSize: '16px',
        fontWeight: '700',
        lineHeight: '24px',
        padding: '6px 12px',
    });
    expect(geometry.applyStyle).toEqual({
        color: 'rgb(255, 255, 255)',
        backgroundColor: 'rgb(55, 90, 127)',
        borderColor: 'rgb(50, 81, 114)',
        borderRadius: '6px',
        fontSize: '16px',
        fontWeight: '700',
        lineHeight: '24px',
        padding: '6px 12px',
        transitionDuration: '0.15s, 0.15s, 0.15s, 0.15s',
        transitionProperty: 'color, background-color, border-color, box-shadow',
    });
    expect(geometry.backdropStyle).toEqual({
        transitionDuration: '0.15s',
        transitionProperty: 'opacity',
    });
    expect(geometry.motionStyle).toEqual({
        transitionDuration: '0.3s',
        transitionProperty: 'transform',
        transitionTimingFunction: 'ease-out',
    });
    const apply = page.getByTestId('icon-server-apply');
    const baseBackground = await apply.evaluate((element) => getComputedStyle(element).backgroundColor);
    await apply.hover();
    expect(await apply.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(baseBackground);
    await page.getByTestId('icon-server-option-hwe:903').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(apply).toBeFocused();
    expect(
        await apply.evaluate((element) => ({
            outlineStyle: getComputedStyle(element).outlineStyle,
            outlineWidth: getComputedStyle(element).outlineWidth,
        }))
    ).toEqual({ outlineStyle: 'none', outlineWidth: '0px' });
    const applyBox = await apply.boundingBox();
    expect(applyBox).not.toBeNull();
    await page.mouse.move(applyBox!.x + applyBox!.width / 2, applyBox!.y + applyBox!.height / 2);
    await page.mouse.down();
    expect(await apply.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(baseBackground);
    await page.mouse.move(5, 5);
    await page.mouse.up();
    await page.mouse.click(5, 5);
    await expect(page.getByTestId('icon-server-modal')).toBeVisible();
    await expect
        .poll(() =>
            page.locator('.icon-server-dialog').evaluate((element) => getComputedStyle(element).transform !== 'none')
        )
        .toBe(true);
    await expect
        .poll(() => page.locator('.icon-server-dialog').evaluate((element) => getComputedStyle(element).transform))
        .toBe('none');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('icon-server-modal')).toBeVisible();
});

test('contains focus and long failure content inside a 320px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await installFixture(page, { failHweAdjustOnce: true });
    await page.goto('account');
    await uploadIcon(page);
    await page.getByTestId('icon-server-apply').click();
    await expect(page.getByTestId('icon-server-result-hwe:903')).toContainText('HWE 아이콘 적용 실패');

    const containment = await page.evaluate(() => {
        const selectors = [
            '.icon-server-backdrop',
            '.icon-server-dialog',
            '.icon-server-header',
            '.icon-server-body',
            '.icon-server-footer',
        ];
        const dialog = document.querySelector<HTMLElement>('.icon-server-dialog')!;
        const rect = dialog.getBoundingClientRect();
        return {
            rect: {
                left: rect.left,
                right: rect.right,
            },
            regionsFit: selectors.every((selector) => {
                const element = document.querySelector<HTMLElement>(selector)!;
                return element.scrollWidth <= element.clientWidth;
            }),
            focusInside: dialog.contains(document.activeElement),
        };
    });
    expect(containment.rect.left).toBeGreaterThanOrEqual(0);
    expect(containment.rect.right).toBeLessThanOrEqual(320);
    expect(containment.regionsFit).toBe(true);
    expect(containment.focusInside).toBe(true);

    await page.getByRole('button', { name: '아이콘 변경' }).focus();
    await expect
        .poll(() =>
            page.evaluate(() =>
                document.querySelector<HTMLElement>('.icon-server-dialog')?.contains(document.activeElement)
            )
        )
        .toBe(true);
});

test('matches the Ref one-server modal geometry at 320px', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await installFixture(page);
    await page.goto('account');
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: '아이콘 제거' }).click();
    await expect(page.getByTestId('icon-server-modal')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.icon-server-dialog').screenshot({
        path: testInfo.outputPath('core-icon-modal-mobile.png'),
        animations: 'disabled',
    });

    const geometry = await page.evaluate(() => {
        const rect = (selector: string) => {
            const value = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
            return { x: value.x, y: value.y, width: value.width, height: value.height };
        };
        const textLines = (selector: string) => {
            const root = document.querySelector(selector)!;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            const lines = new Map<number, string>();
            let node = walker.nextNode();
            while (node) {
                for (let offset = 0; offset < (node.textContent?.length ?? 0); offset += 1) {
                    const range = document.createRange();
                    range.setStart(node, offset);
                    range.setEnd(node, offset + 1);
                    const box = range.getBoundingClientRect();
                    if (box.width > 0) {
                        const top = Math.round(box.top);
                        lines.set(top, `${lines.get(top) ?? ''}${node.textContent?.[offset] ?? ''}`);
                    }
                }
                node = walker.nextNode();
            }
            return [...lines.entries()].sort(([left], [right]) => left - right).map(([, text]) => text);
        };
        return {
            dialog: rect('.icon-server-dialog'),
            header: rect('.icon-server-header'),
            title: rect('.icon-server-header h2'),
            body: rect('.icon-server-body'),
            footer: rect('.icon-server-footer'),
            close: rect('[data-testid="icon-server-close"]'),
            apply: rect('[data-testid="icon-server-apply"]'),
            titleLines: textLines('.icon-server-header h2'),
            titleFontMetrics: (() => {
                const style = getComputedStyle(document.querySelector<HTMLElement>('.icon-server-header h2')!);
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d')!;
                context.font = style.font;
                return {
                    font: context.font,
                    textWidth: context.measureText('새 아이콘을 적용할 서버를 선택하세요.').width,
                    selectionPrefixWidth: context.measureText('새 아이콘을 적용할 서버를 선택').width,
                };
            })(),
        };
    });
    expect(geometry).toEqual({
        dialog: { x: 8, y: 8, width: 304, height: 254 },
        header: { x: 9, y: 9, width: 302, height: 123 },
        title: { x: 25, y: 25, width: 244, height: 90 },
        body: { x: 9, y: 132, width: 302, height: 56 },
        footer: { x: 9, y: 188, width: 302, height: 73 },
        close: { x: 269, y: 55, width: 26, height: 30 },
        apply: { x: 209, y: 205, width: 86, height: 40 },
        titleLines: ['완료되었습니다.', '새 아이콘을 적용할 서버를 선택', '하세요.'],
        titleFontMetrics: {
            font: '500 20px Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic"',
            textWidth: 297,
            selectionPrefixWidth: 241,
        },
    });
});

test('reopens server synchronization without consuming the daily icon change', async ({ page }) => {
    await installFixture(page);
    await page.goto('account');
    await page.getByRole('button', { name: '현재 아이콘 서버 적용' }).click();

    await expect(page.getByTestId('icon-server-modal')).toBeVisible();
    await expect(page.getByTestId('icon-server-option-che:903')).toBeChecked();
    await expect(page.getByTestId('icon-server-option-hwe:903')).toBeChecked();
});
