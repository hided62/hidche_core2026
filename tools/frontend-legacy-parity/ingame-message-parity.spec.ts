import { expect, test, type Page, type Route } from '@playwright/test';

import { canonicalFrontendFixture as fixture } from './fixtures/canonical';

const gamePort = process.env.FRONTEND_PARITY_GAME_PORT ?? '15102';
const response = (data: unknown) => ({ result: { data } });
const errorResponse = (path: string, message: string) => ({
    error: {
        message,
        code: -32000,
        data: { code: 'BAD_REQUEST', httpStatus: 400, path },
    },
});

const operationNames = (route: Route): string[] => {
    const pathname = new URL(route.request().url()).pathname;
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const general = {
    id: 1,
    name: '테스트장수',
    npcState: 0,
    nationId: 1,
    cityId: 1,
    troopId: 0,
    picture: 'default.jpg',
    imageServer: 0,
    officerLevel: 1,
    stats: { leadership: 80, strength: 70, intelligence: 90 },
    gold: 1000,
    rice: 1000,
    crew: 500,
    train: 100,
    atmos: 100,
    injury: 0,
    experience: 1200,
    dedication: 900,
    items: { horse: null, weapon: null, book: null, item: null },
};

const generalContext = {
    general,
    city: {
        id: 1,
        name: '낙양',
        level: 7,
        nationId: 1,
        population: 50000,
        agriculture: 5000,
        commerce: 5000,
        security: 5000,
        defence: 5000,
        wall: 5000,
        supplyState: 1,
        frontState: 2,
    },
    nation: {
        id: 1,
        name: '테스트국',
        color: '#d32f2f',
        level: 5,
        gold: 10000,
        rice: 10000,
        tech: 1200,
        typeCode: 'che_군벌',
        capitalCityId: 1,
    },
    settings: {},
    penalties: {},
};

const target = (generalId: number, generalName: string, nationId: number, nationName: string, color: string) => ({
    generalId,
    generalName,
    nationId,
    nationName,
    color,
    icon: '/image/icons/default.jpg',
});

const ownTarget = target(1, '테스트장수', 1, '테스트국', '#d32f2f');
const foreignTarget = target(8, '상대장수', 2, '상대국', '#2457a6');
const messageTime = new Date().toISOString().replace('T', ' ').slice(0, 19);

const buildMessages = (permission: number) => ({
    result: true,
    public: [
        {
            id: 101,
            msgType: 'public',
            src: ownTarget,
            dest: null,
            text: '전체 메시지 본문',
            option: {},
            time: messageTime,
        },
    ],
    national: [
        {
            id: 102,
            msgType: 'national',
            src: ownTarget,
            dest: target(0, '', 1, '테스트국', '#d32f2f'),
            text: '국가 메시지 본문',
            option: {},
            time: messageTime,
        },
    ],
    private: [
        {
            id: 103,
            msgType: 'private',
            src: foreignTarget,
            dest: ownTarget,
            text: '개인 메시지 본문',
            option: {},
            time: messageTime,
        },
    ],
    diplomacy: [
        {
            id: 104,
            msgType: 'diplomacy',
            src: foreignTarget,
            dest: target(0, '', 1, '테스트국', '#d32f2f'),
            text: permission >= 3 ? '외교 메시지 본문' : '(외교 메시지입니다)',
            option:
                permission >= 3
                    ? { action: 'noAggression', deletable: false }
                    : { action: 'noAggression', deletable: false, invalid: true },
            time: messageTime,
        },
    ],
    sequence: 104,
    nationId: 1,
    generalName: general.name,
    permission,
    canRespondDiplomacy: permission >= 4 && general.officerLevel > 4,
    latestRead: { private: 0, diplomacy: 0 },
});

const contacts = {
    nation: [
        {
            nationId: 0,
            mailbox: 9000,
            name: '재야',
            color: '#000000',
            general: [],
        },
        {
            nationId: 1,
            mailbox: 9001,
            name: '테스트국',
            color: '#d32f2f',
            general: [
                [1, '테스트장수', 4],
                [2, '아군군주', 1],
            ],
        },
        {
            nationId: 2,
            mailbox: 9002,
            name: '상대국',
            color: '#2457a6',
            general: [
                [8, '상대외교관', 4],
                [9, '상대일반', 0],
            ],
        },
    ],
};

const installFixture = async (
    page: Page,
    options: { permission: number; sendError?: string }
): Promise<Array<{ operation: string; body: unknown }>> => {
    const mutations: Array<{ operation: string; body: unknown }> = [];
    await page.addInitScript(
        ({ gameToken, profile }) => {
            window.localStorage.setItem('sammo-game-token', gameToken);
            window.localStorage.setItem('sammo-game-profile', profile);
        },
        {
            gameToken: fixture.game.session.gameToken,
            profile: fixture.game.session.profile,
        }
    );
    await page.route('**/image/**', (route) => route.fulfill({ status: 204, body: '' }));
    await page.route('**/che/api/events**', (route) => route.abort());
    await page.route('**/che/api/trpc/**', async (route) => {
        const body = route.request().postDataJSON();
        const results = operationNames(route).map((operation) => {
            if (operation === 'auth.status') return response({ userId: 'frontend-parity-user' });
            if (operation === 'lobby.info') {
                return response({ ...fixture.game.lobby, myGeneral: general });
            }
            if (operation === 'general.me') return response(generalContext);
            if (operation === 'world.getMapLayout') return response(fixture.game.mapLayout);
            if (operation === 'world.getMap') {
                return response({ ...fixture.game.map, myCity: 1, myNation: 1 });
            }
            if (operation === 'turns.getCommandTable') return response({ general: [], nation: [] });
            if (operation === 'turns.reserved.getGeneral' || operation === 'turns.reserved.getNation') {
                return response({ turns: [], revision: 0 });
            }
            if (operation === 'general.getFrontStatus') {
                return response({
                    onlineUserCount: 1,
                    onlineNations: '테스트국(1)',
                    onlineGenerals: general.name,
                    nationNotice: '',
                    lastExecuted: null,
                    latestVote: null,
                });
            }
            if (operation === 'general.getRecentRecords') {
                return response({ global: [], general: [], history: [] });
            }
            if (operation === 'messages.getRecent') return response(buildMessages(options.permission));
            if (operation === 'messages.getContacts') return response(contacts);
            if (operation === 'board.getAccess') return response({ canMeeting: true, canSecret: true });
            if (operation === 'tournament.getState') return response({ stage: 0 });
            if (operation === 'public.recordAccess') return response({ recorded: true });
            if (
                operation === 'messages.send' ||
                operation === 'messages.readLatest' ||
                operation === 'messages.delete' ||
                operation === 'messages.respond'
            ) {
                mutations.push({ operation, body });
                if (operation === 'messages.send' && options.sendError) {
                    return errorResponse(operation, options.sendError);
                }
                return response(operation === 'messages.respond' ? { result: true, reason: 'success' } : { ok: true });
            }
            return errorResponse(operation, `Unhandled message fixture operation: ${operation}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(results),
        });
    });
    return mutations;
};

const openMessages = async (page: Page, viewport: { width: number; height: number }) => {
    await page.setViewportSize(viewport);
    await page.goto(`http://127.0.0.1:${gamePort}/che/`);
    await expect(page.getByRole('heading', { name: '전장 현황' })).toBeVisible();
    if (viewport.width <= 1024) {
        await page.getByRole('button', { name: '메시지', exact: true }).click();
    }
    await expect(page.locator('.MessagePanel')).toBeVisible();
};

for (const viewport of [
    { width: 1000, height: 900 },
    { width: 500, height: 900 },
]) {
    test(`matches the reference message computed DOM at ${viewport.width}px Chromium viewport`, async ({ page }) => {
        await installFixture(page, { permission: 4 });
        await openMessages(page, viewport);
        const geometry = await page.locator('.MessagePanel').evaluate((panel) => {
            const required = (selector: string) => panel.querySelector<HTMLElement>(selector)!;
            const rect = (element: Element) => {
                const box = element.getBoundingClientRect();
                return { x: box.x, y: box.y, width: box.width, height: box.height };
            };
            const panelStyle = getComputedStyle(panel);
            const header = required('.BoardHeader');
            const plate = required('.msg-plate');
            const icon = required('.general-icon');
            return {
                panel: rect(panel),
                inputForm: rect(required('.MessageInputForm')),
                select: rect(required('.message-select')),
                input: rect(required('.message-text')),
                submit: rect(required('.message-send')),
                publicSection: rect(required('.PublicTalk')),
                nationalSection: rect(required('.NationalTalk')),
                firstHeader: rect(header),
                firstPlate: rect(plate),
                firstIcon: rect(icon),
                computed: {
                    panelDisplay: panelStyle.display,
                    panelColumns: panelStyle.gridTemplateColumns,
                    panelFontSize: panelStyle.fontSize,
                    headerColor: getComputedStyle(header).color,
                    headerOutlineWidth: getComputedStyle(header).outlineWidth,
                    plateBackgroundColor: getComputedStyle(plate).backgroundColor,
                    plateFontSize: getComputedStyle(plate).fontSize,
                    plateMinHeight: getComputedStyle(plate).minHeight,
                    iconObjectFit: getComputedStyle(icon).objectFit,
                },
            };
        });

        expect(geometry.panel.x).toBeCloseTo(0, 0);
        expect(geometry.panel.width).toBeCloseTo(viewport.width, 0);
        expect(geometry.inputForm.width).toBeCloseTo(viewport.width, 0);
        expect(geometry.select.height).toBeCloseTo(35.5, 0);
        expect(geometry.submit.height).toBeCloseTo(35.5, 0);
        expect(geometry.firstHeader.height).toBeCloseTo(25, 0);
        expect(geometry.firstPlate.height).toBeGreaterThanOrEqual(64);
        expect(geometry.firstIcon).toMatchObject({ width: 64, height: 64 });
        expect(geometry.computed).toMatchObject({
            panelFontSize: '14px',
            headerColor: 'rgb(255, 255, 255)',
            headerOutlineWidth: '1px',
            plateBackgroundColor: 'rgb(20, 28, 101)',
            plateFontSize: '12.5px',
            plateMinHeight: '64px',
            iconObjectFit: 'fill',
        });

        if (viewport.width === 1000) {
            expect(geometry.computed.panelDisplay).toBe('grid');
            expect(geometry.computed.panelColumns).toBe('500px 500px');
            expect(geometry.select.width).toBeCloseTo(166.66, 0);
            expect(geometry.input.width).toBeCloseTo(666.66, 0);
            expect(geometry.submit.width).toBeCloseTo(166.66, 0);
            expect(geometry.publicSection.width).toBeCloseTo(500, 0);
            expect(geometry.nationalSection.x).toBeCloseTo(500, 0);
        } else {
            expect(geometry.computed.panelDisplay).toBe('block');
            expect(geometry.select.width).toBeCloseTo(250, 0);
            expect(geometry.input.width).toBeCloseTo(500, 0);
            expect(geometry.input.height).toBeCloseTo(33.5, 0);
            expect(geometry.submit.width).toBeCloseTo(250, 0);
        }

        const submit = page.locator('.message-send');
        await submit.hover();
        expect(
            await submit.evaluate((element) => ({
                cursor: getComputedStyle(element).cursor,
                backgroundColor: getComputedStyle(element).backgroundColor,
            }))
        ).toEqual({ cursor: 'pointer', backgroundColor: 'rgb(55, 90, 127)' });
        await submit.focus();
        expect(
            await submit.evaluate((element) => ({
                outlineWidth: getComputedStyle(element).outlineWidth,
                boxShadow: getComputedStyle(element).boxShadow,
            }))
        ).toEqual({ outlineWidth: '0px', boxShadow: 'none' });
    });
}

test('exposes ambassador targets, reply, read, delete, and successful send interactions', async ({ page }) => {
    const mutations = await installFixture(page, { permission: 4 });
    await openMessages(page, { width: 500, height: 900 });

    const select = page.getByLabel('메시지 수신 대상');
    await expect(select.locator('option[value="9002"]')).toHaveCount(1);
    await expect(select.locator('option[value="8"]')).toBeDisabled();
    await expect(select.locator('option[value="9"]')).toBeEnabled();

    await page.locator('.PrivateTalk .msg-target').filter({ hasText: '상대장수' }).click();
    await expect(select).toHaveValue('8');

    await page.locator('.PrivateTalk').getByRole('button', { name: '모두 읽음' }).click();
    await expect.poll(() => mutations.filter((entry) => entry.operation === 'messages.readLatest').length).toBe(1);

    const deleteButton = page.locator('.PublicTalk .delete-message');
    page.once('dialog', (dialog) => dialog.accept());
    await deleteButton.click();
    await expect.poll(() => mutations.filter((entry) => entry.operation === 'messages.delete').length).toBe(1);

    await select.selectOption('9999');
    await page.getByLabel('메시지 입력').fill('전송 성공');
    await page.getByRole('button', { name: '서신전달&갱신' }).click();
    await expect(page.getByLabel('메시지 입력')).toHaveValue('');
    await expect.poll(() => mutations.filter((entry) => entry.operation === 'messages.send').length).toBe(1);
});

test('redacts diplomacy for a low-permission general and preserves the failed-send error flow', async ({ page }) => {
    const mutations = await installFixture(page, {
        permission: 2,
        sendError: '공개 메세지를 보낼 수 없습니다.',
    });
    await openMessages(page, { width: 500, height: 900 });

    const select = page.getByLabel('메시지 수신 대상');
    await expect(select.locator('option[value="9002"]')).toHaveCount(0);
    await expect(page.locator('.DiplomacyTalk')).toContainText('삭제된 메시지입니다');
    await expect(page.locator('.DiplomacyTalk')).not.toContainText('외교 메시지 본문');
    await expect(page.locator('.DiplomacyTalk .message-response button').first()).toBeDisabled();

    await select.selectOption('9999');
    await page.getByLabel('메시지 입력').fill('차단될 메시지');
    await page.getByRole('button', { name: '서신전달&갱신' }).click();
    await expect(page.getByLabel('메시지 입력')).toHaveValue('');
    await expect(page.getByRole('alert').filter({ hasText: '공개 메세지를 보낼 수 없습니다.' })).toBeVisible();
    await expect.poll(() => mutations.filter((entry) => entry.operation === 'messages.send').length).toBe(1);
});
