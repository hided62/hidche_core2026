import { expect, test, type Page, type Route } from '@playwright/test';
import { gameBasePath, gameProfile } from './gameTestPaths.js';

const response = (data: unknown) => ({ result: { data } });
const basePath = gameBasePath;
const operationNames = (route: Route) =>
    decodeURIComponent(new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '').split(',');

type FixtureState = {
    reservationCalls: number;
    reservationInputs: Array<Record<string, unknown>>;
    rawBodies: unknown[];
    possessInputs: Array<Record<string, unknown>>;
    hasGeneral: boolean;
    injectTimeout: boolean;
};

const candidates = Array.from({ length: 5 }, (_, index) => ({
    id: index + 1,
    name: `빙의후보${index + 1}`,
    nation: { id: 0, name: '재야', color: '#aaaaaa' },
    stats: {
        leadership: 40 + index,
        strength: 50 + index,
        intelligence: 60 + index,
    },
    picture: 'default.jpg',
    imageServer: index === 0 ? 1 : 0,
    personality: { code: 'che_안전', name: '안전', info: '안전을 중시합니다.' },
    specialDomestic: { code: 'che_인덕', name: '인덕', info: '인덕 설명' },
    specialWar: { code: 'che_무쌍', name: '무쌍', info: '무쌍 설명' },
    keepCount: 3,
}));
const generalList = Array.from({ length: 55 }, (_, index) => {
    const candidate = candidates[index % candidates.length]!;
    return {
        id: index + 1,
        name: `전체장수${String(index + 1).padStart(2, '0')}`,
        picture: candidate.picture,
        imageServer: candidate.imageServer,
        npcState: index === 54 ? 1 : 2,
        ownerName: index === 54 ? '빙의자' : '',
        age: 25 + (index % 20),
        level: 3 + (index % 5),
        officerLevel: index % 5,
        killturn: index % 10,
        nationId: 0,
        nationName: '재야',
        nationLevel: 0,
        personality: { key: 'che_안전', name: '안전', info: '안전을 중시합니다.' },
        specialDomestic: { key: 'che_인덕', name: '인덕', info: '인덕 설명' },
        specialWar: { key: 'che_무쌍', name: '무쌍', info: '무쌍 설명' },
        statTotal: 150 + index,
        leadership: 40 + (index % 30),
        strength: 50 + (index % 20),
        intelligence: 60 + (index % 10),
        experience: 800 + index,
        experienceText: '무명',
        dedication: 700 + index,
        dedicationText: '28품관',
    };
});
generalList.push({
    ...generalList[0]!,
    id: 56,
    name: '사용자장수',
    npcState: 0,
    ownerName: '',
    statTotal: 230,
    leadership: 80,
    strength: 70,
    intelligence: 80,
    experience: 16_000,
    experienceText: '지역적',
    dedication: 10_000,
    dedicationText: '21품관',
});

const findInput = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object') return {};
    if ('json' in value && value.json && typeof value.json === 'object') {
        return value.json as Record<string, unknown>;
    }
    const record = value as Record<string, unknown>;
    if (
        ['refresh', 'keepIds', 'generalId', 'tokenNonce', 'clientRequestId'].some((key) => Object.hasOwn(record, key))
    ) {
        return record;
    }
    for (const nested of Object.values(value)) {
        const input = findInput(nested);
        if (Object.keys(input).length > 0) return input;
    }
    return {};
};

const installFixture = async (page: Page, state: FixtureState): Promise<void> => {
    await page.addInitScript((profile) => {
        localStorage.setItem('sammo-game-token', 'ga_npc_possession');
        localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    await page.route('**/image/**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#777"/></svg>',
        });
    });
    await page.route('https://sam-image.hided.net/icons/**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#777"/></svg>',
        });
    });
    await page.route('**/gateway/api/user-icons/default.jpg', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#8855aa"/></svg>',
        });
    });
    await page.route('**/events**', async (route) => route.abort());
    await page.route(`**${basePath}/api/trpc/**`, async (route) => {
        const operations = operationNames(route);
        const rawBody: unknown = route.request().postData() ? route.request().postDataJSON() : {};
        state.rawBodies.push(rawBody);
        const body = rawBody && typeof rawBody === 'object' ? (rawBody as Record<string, unknown>) : {};
        const results = operations.map((operation, index) => {
            const input = findInput(body[String(index)] ?? body);
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') {
                return response({
                    myGeneral: state.hasGeneral ? { id: 1, name: '빙의후보1' } : null,
                    year: 180,
                    month: 1,
                    turnTerm: 5,
                });
            }
            if (operation === 'join.getConfig') {
                return response({
                    rules: {
                        stat: { total: 165, min: 15, max: 80, bonusMin: 3, bonusMax: 5 },
                        allowCustomName: true,
                    },
                    user: { id: 'npc-user', displayName: '빙의사용자', canCreateGeneral: true },
                    personalities: [{ key: 'Random', name: '???', info: '' }],
                    warSpecials: [],
                    nations: [],
                    serverInfo: {
                        currentYear: 180,
                        currentMonth: 1,
                        tickMinutes: 5,
                        maxGeneral: 500,
                        userGeneralCount: 0,
                        npcGeneralCount: 12,
                    },
                    inherit: {
                        totalPoint: 0,
                        costs: {
                            inheritBornSpecialPoint: 0,
                            inheritBornTurntimePoint: 0,
                            inheritBornCityPoint: 0,
                            inheritBornStatPoint: 0,
                        },
                        availableCities: [],
                        turnTimeZones: [],
                        availableSpecialWar: [],
                    },
                    selectionPool: { enabled: false },
                    npcPossession: { enabled: true },
                });
            }
            if (operation === 'join.listPossessCandidates') {
                state.reservationCalls += 1;
                state.reservationInputs.push(input);
                const refresh = input.refresh === true;
                const now = Date.now();
                const keepIds = Array.isArray(input.keepIds) ? input.keepIds : [];
                return response({
                    tokenNonce: refresh ? 202 : 101,
                    validUntil: new Date(now + 90_000).toISOString(),
                    pickMoreFrom: new Date(refresh ? now + 1_200 : now - 1_000).toISOString(),
                    pickMoreSeconds: refresh ? 2 : 0,
                    candidates: candidates.map((candidate) => ({
                        ...candidate,
                        keepCount: refresh && keepIds.includes(candidate.id) ? 2 : 3,
                    })),
                });
            }
            if (operation === 'public.getNpcList') {
                return response({
                    sort: 1,
                    generals: generalList,
                    tokenKeepCounts: { 1: 2, 2: 1 },
                });
            }
            if (operation === 'join.possessGeneral') {
                state.possessInputs.push(input);
                if (state.injectTimeout) {
                    state.injectTimeout = false;
                    return {
                        error: {
                            message:
                                'NPC 빙의 요청은 접수됐지만 처리 결과를 아직 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.',
                            code: -32008,
                            data: {
                                code: 'TIMEOUT',
                                httpStatus: 408,
                                path: 'join.possessGeneral',
                            },
                        },
                    };
                }
                state.hasGeneral = true;
                return response({ ok: true, generalId: Number(input.generalId) });
            }
            return response({});
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(operations.length === 1 ? results[0] : results),
        });
    });
};

test('renders Ref-shaped token cards, preserves keep cooldown and retries possession with one ID', async ({
    page,
}, testInfo) => {
    const state: FixtureState = {
        reservationCalls: 0,
        reservationInputs: [],
        rawBodies: [],
        possessInputs: [],
        hasGeneral: false,
        injectTimeout: true,
    };
    await installFixture(page, state);
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto('join?tab=possess');
    await expect(page.getByRole('button', { name: 'NPC 빙의' })).toHaveClass(/active/);

    await expect(page.locator('.npc-card')).toHaveCount(5);
    await expect(page.getByText(/까지 유효/)).toBeVisible();
    const geometry = await page.locator('.npc-possession-section').evaluate((section) => {
        const sectionRect = section.getBoundingClientRect();
        const cards = [...section.querySelectorAll<HTMLElement>('.npc-card')];
        const image = section.querySelector<HTMLImageElement>('.npc-card-image');
        return {
            sectionWidth: sectionRect.width,
            cardWidths: cards.map((card) => card.getBoundingClientRect().width),
            imageWidth: image?.getBoundingClientRect().width,
            imageHeight: image?.getBoundingClientRect().height,
            imageNaturalWidth: image?.naturalWidth,
            imageNaturalHeight: image?.naturalHeight,
        };
    });
    expect(geometry).toEqual({
        sectionWidth: 1000,
        cardWidths: [125, 125, 125, 125, 125],
        imageWidth: 64,
        imageHeight: 64,
        imageNaturalWidth: 64,
        imageNaturalHeight: 64,
    });
    const tooltip = page.locator('.npc-tooltip').first();
    const tooltipPopup = tooltip.getByRole('tooltip');
    await expect(tooltipPopup).toBeHidden();
    await tooltip.hover();
    await expect(tooltipPopup).toBeVisible();
    await tooltip.focus();
    await expect(tooltip).toBeFocused();
    await expect(tooltipPopup).toHaveText('안전을 중시합니다.');
    await expect(page.locator('.npc-card-image').first()).toHaveAttribute(
        'src',
        'https://sam-image.hided.net/icons/default.jpg'
    );

    await page.locator('#btn-load-general-list').click();
    await expect(page.locator('#tb-general-list')).toBeVisible();
    await expect(page.locator('#tb-general-list tbody tr')).toHaveCount(50);
    await expect(page.locator('#tb-general-list tbody tr').first()).toHaveAttribute('data-general-id', '56');
    await expect(page.locator('#tb-general-list tbody tr').first()).toHaveAttribute('data-reservation-state', '2');
    const selectedRow = page.locator('#tb-general-list tbody tr[data-general-id="1"]');
    await expect(selectedRow).toHaveAttribute('data-reservation-state', '1');
    await expect(selectedRow.locator('.npc-general-name')).toHaveCSS('color', 'rgb(238, 130, 238)');
    await expect(selectedRow.locator('.npc-general-name')).toContainText('(2회)');
    const listGeometry = await page.locator('#tb-general-list').evaluate((table) => {
        const rect = table.getBoundingClientRect();
        const icon = table.querySelector<HTMLImageElement>('.npc-general-icon');
        return {
            width: rect.width,
            iconWidth: icon?.getBoundingClientRect().width,
            iconHeight: icon?.getBoundingClientRect().height,
            iconNaturalWidth: icon?.naturalWidth,
            iconNaturalHeight: icon?.naturalHeight,
        };
    });
    expect(listGeometry).toEqual({
        width: 970,
        iconWidth: 64,
        iconHeight: 64,
        iconNaturalWidth: 64,
        iconNaturalHeight: 64,
    });
    await page.locator('#btn-print-more-generals').click();
    await expect(page.locator('#tb-general-list tbody tr')).toHaveCount(56);
    await expect(page.locator('#btn-print-more-generals')).toHaveCount(0);
    await page.screenshot({
        path: testInfo.outputPath('npc-possession-candidates-and-list.png'),
        fullPage: true,
    });

    await page.locator('.npc-keep input').first().check();
    await page.getByRole('button', { name: '다른 장수 보기' }).click();
    await expect.poll(() => state.reservationCalls).toBe(2);
    expect(state.reservationInputs.at(-1), JSON.stringify(state.rawBodies.at(-1))).toMatchObject({
        refresh: true,
        keepIds: [1],
    });
    await expect(page.locator('.npc-keep').first()).toContainText('보관(2회)');
    const refreshButton = page.locator('#btn-pick-more');
    await expect(refreshButton).toBeDisabled();
    await expect(refreshButton).toContainText(/다른 장수 보기\([12]초\)/);
    await expect(refreshButton).toBeEnabled({ timeout: 3_000 });

    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
        dialogs.push(dialog.message());
        if (
            dialog.type() === 'confirm' &&
            dialogs.filter((message) => message.startsWith('빙의할까요?')).length === 1
        ) {
            await dialog.dismiss();
            return;
        }
        await dialog.accept();
    });
    const possessButton = page.locator('.npc-action').first();
    await possessButton.click();
    expect(state.possessInputs).toHaveLength(0);

    await possessButton.click();
    await expect(page.locator('.join-error')).toContainText('같은 요청으로 다시 시도해 주세요.');
    expect(state.possessInputs).toHaveLength(1);
    const firstRequestId = state.possessInputs[0]?.clientRequestId;
    expect(firstRequestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await page.evaluate(() => window.sessionStorage.getItem('sammo-npc-possess-pending-action'))).toContain(
        firstRequestId as string
    );

    await page.evaluate(() => {
        const expiredNow = Date.now() + 120_000;
        Date.now = () => expiredNow;
    });
    await expect(page.locator('.npc-token-expired')).toBeVisible();
    await expect(possessButton).toBeEnabled();
    await expect(refreshButton).toBeDisabled();
    await page.setViewportSize({ width: 390, height: 844 });
    const documentWidthBeforeDialog = await page.evaluate(() => document.documentElement.scrollWidth);
    await page.locator('#btn-retry-possession').click();
    const successDialog = page.getByRole('alertdialog', { name: '완료' });
    await expect(successDialog).toContainText('빙의에 성공했습니다.');
    await expect(successDialog.getByRole('button', { name: '확인' })).toBeFocused();
    const dialogGeometry = await successDialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            left: rect.left,
            right: window.innerWidth - rect.right,
            bottom: window.innerHeight - rect.bottom,
            width: rect.width,
            documentWidth: document.documentElement.scrollWidth,
        };
    });
    expect(dialogGeometry.left).toBeGreaterThanOrEqual(0);
    expect(dialogGeometry.right).toBeGreaterThanOrEqual(0);
    expect(dialogGeometry.bottom).toBeGreaterThanOrEqual(0);
    expect(dialogGeometry.documentWidth).toBe(documentWidthBeforeDialog);
    await page.screenshot({ path: testInfo.outputPath('game-notice-dialog.png') });
    await successDialog.getByRole('button', { name: '확인' }).click();
    await expect(page).toHaveURL(new RegExp(`${basePath}/$`));
    expect(state.possessInputs).toHaveLength(2);
    expect(state.possessInputs[1]?.clientRequestId).toBe(firstRequestId);
    expect(await page.evaluate(() => window.sessionStorage.getItem('sammo-npc-possess-pending-action'))).toBeNull();

    await page.screenshot({
        path: testInfo.outputPath('npc-possession-success.png'),
        fullPage: true,
    });
});
