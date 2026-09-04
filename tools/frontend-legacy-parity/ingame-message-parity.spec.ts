import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { canonicalFrontendFixture as fixture } from './fixtures/canonical.js';

const gamePort = process.env.FRONTEND_PARITY_GAME_PORT ?? '15102';
const artifactRoot = process.env.FRONTEND_PARITY_ARTIFACT_DIR;
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
    city: null,
    nation: {
        id: 1,
        name: '테스트국',
        color: '#d32f2f',
        level: 1,
        levelName: '군벌',
        gold: 1000,
        rice: 1000,
        tech: 1000,
        typeCode: 'test',
        typeName: '테스트',
        typePros: '-',
        typeCons: '-',
        capitalCityId: 1,
        capitalCityName: '낙양',
        population: { cityCount: 1, current: 10000, max: 20000 },
        crew: { generalCount: 2, current: 1000, max: 16000 },
        power: 100,
        bill: 10,
        taxRate: 10,
        strategicCommandLimit: 0,
        diplomaticLimit: 0,
        prohibitScout: false,
        prohibitWar: false,
        techLevel: 1,
        techLimited: false,
        topChiefs: { 12: null, 11: null },
        impossibleStrategicCommands: [],
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

const buildMessages = (permission: number, tombstonedMessageIds: ReadonlySet<number> = new Set()) => ({
    result: true,
    public: [
        {
            id: 101,
            msgType: 'public',
            src: ownTarget,
            dest: null,
            text: tombstonedMessageIds.has(101) ? '삭제된 메시지입니다.' : '전체 메시지 본문',
            option: tombstonedMessageIds.has(101) ? { invalid: true } : {},
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
            src: target(9, '상대일반', 2, '상대국', '#2457a6'),
            dest: ownTarget,
            text: '개인 메시지 본문',
            option: {},
            time: messageTime,
        },
        {
            id: 105,
            msgType: 'private',
            src: foreignTarget,
            dest: ownTarget,
            text: '상대국으로 망명 권유 서신',
            option: { action: 'scout', used: false },
            time: messageTime,
        },
        {
            id: 106,
            msgType: 'private',
            src: target(0, '', 0, 'System', '#000000'),
            dest: ownTarget,
            text: '이벤트 게임으로 이민족[보통]을 소환',
            option: { action: 'raiseInvader', args: [-2, -1.2, -1, -0.5], used: false },
            time: messageTime,
        },
    ],
    diplomacy: [
        {
            id: 104,
            msgType: 'diplomacy',
            src: foreignTarget,
            dest: target(0, '', 1, '테스트국', '#d32f2f'),
            text: permission >= 3 ? '외교 메시지 본문' : '조회 권한이 없는 외교 메시지입니다.',
            option:
                permission >= 3
                    ? { action: 'noAggression', deletable: false }
                    : { action: 'noAggression', deletable: false, permissionRedacted: true },
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
    const tombstonedMessageIds = new Set<number>();
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
            if (operation === 'dashboard.getContextBundleDelta') {
                return response({
                    context: {
                        kind: 'snapshot',
                        revision: 'AAAAAAAAAAAAAAAAAAAAAA',
                        data: generalContext,
                    },
                    commandTable: {
                        kind: 'snapshot',
                        revision: 'BBBBBBBBBBBBBBBBBBBBBB',
                        data: { general: [], nation: [] },
                    },
                    boardAccess: {
                        kind: 'snapshot',
                        revision: 'CCCCCCCCCCCCCCCCCCCCCC',
                        data: { canMeeting: true, canSecret: true, permission: options.permission },
                    },
                });
            }
            if (operation === 'auth.status') return response({ userId: 'frontend-parity-user' });
            if (operation === 'lobby.info') {
                return response({ ...fixture.game.lobby, myGeneral: general });
            }
            if (operation === 'general.me') return response(generalContext);
            if (operation === 'world.getMapLayout') return response(fixture.game.mapLayout);
            if (operation === 'world.getState') {
                return response({
                    currentYear: 197,
                    currentMonth: 7,
                    tickSeconds: 3600,
                    config: { npcMode: 0, const: {}, environment: {} },
                    meta: {},
                });
            }
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
            if (operation === 'messages.getRecent') {
                return response(buildMessages(options.permission, tombstonedMessageIds));
            }
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
                if (operation === 'messages.delete') {
                    tombstonedMessageIds.add(101);
                    return response({ ok: true, deletedIds: [101] });
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
        const mobileMessageButton = page.getByRole('button', { name: '메시지', exact: true });
        if ((await mobileMessageButton.count()) > 0) {
            await mobileMessageButton.click();
        }
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

        if (artifactRoot) {
            await mkdir(artifactRoot, { recursive: true });
            await page.locator('.MessagePanel').screenshot({
                path: resolve(artifactRoot, `message-panel-${viewport.width}.png`),
                animations: 'disabled',
            });
        }
    });
}

test('exposes nation targets including wanderers, reply, read, delete, and successful send interactions', async ({
    page,
}) => {
    const mutations = await installFixture(page, { permission: 4 });
    await openMessages(page, { width: 500, height: 900 });

    const select = page.getByLabel('메시지 수신 대상');
    await expect(select.locator('optgroup[label="외교메시지"] option[value="9000"]')).toHaveText('재야');
    await expect(select.locator('option[value="9002"]')).toHaveCount(1);
    await expect(select.locator('option[value="8"]')).toBeDisabled();
    await expect(select.locator('option[value="9"]')).toBeEnabled();

    await page.locator('.PrivateTalk .msg-target').filter({ hasText: '상대일반' }).click();
    await expect(select).toHaveValue('9');

    await page.locator('.PrivateTalk').getByRole('button', { name: '모두 읽음' }).click();
    await expect.poll(() => mutations.filter((entry) => entry.operation === 'messages.readLatest').length).toBe(1);

    const deleteButton = page.locator('.PublicTalk .delete-message');
    page.once('dialog', (dialog) => dialog.accept());
    await deleteButton.click();
    await expect.poll(() => mutations.filter((entry) => entry.operation === 'messages.delete').length).toBe(1);
    await expect(page.locator('.PublicTalk .msg-plate').filter({ hasText: '삭제된 메시지입니다' })).toBeVisible();
    await expect(page.locator('.PublicTalk')).not.toContainText('전체 메시지 본문');
    await expect(page.locator('.PublicTalk .delete-message')).toHaveCount(0);
    if (artifactRoot) {
        await mkdir(artifactRoot, { recursive: true });
        await page.locator('.PublicTalk').screenshot({
            path: resolve(artifactRoot, 'message-delete-tombstone-500.png'),
            animations: 'disabled',
        });
    }

    await select.selectOption('9000');
    await page.getByLabel('메시지 입력').fill('우리 나라로 와주세요');
    if (artifactRoot) {
        await mkdir(artifactRoot, { recursive: true });
        await page.locator('.MessageInputForm').screenshot({
            path: resolve(artifactRoot, 'wanderer-recruitment-target-500.png'),
            animations: 'disabled',
        });
    }
    await page.getByRole('button', { name: '서신전달&갱신' }).click();
    await expect(page.getByLabel('메시지 입력')).toHaveValue('');
    await expect.poll(() => mutations.filter((entry) => entry.operation === 'messages.send').length).toBe(1);
    expect(JSON.stringify(mutations.find((entry) => entry.operation === 'messages.send')?.body)).toContain(
        '"mailbox":9000'
    );
});

test('accepts recruitment and declines invader prompts through private-message controls', async ({ page }) => {
    const mutations = await installFixture(page, { permission: 4 });
    await openMessages(page, { width: 500, height: 900 });

    const recruitment = page.locator('.PrivateTalk .msg-plate').filter({ hasText: '망명 권유 서신' });
    const invader = page.locator('.PrivateTalk .msg-plate').filter({ hasText: '이민족[보통]을 소환' });
    await expect(recruitment.getByRole('button', { name: '수락' })).toBeVisible();
    await expect(invader.getByRole('button', { name: '거절' })).toBeVisible();

    page.once('dialog', async (dialog) => {
        expect(dialog.message()).toBe('수락하시겠습니까?');
        await dialog.accept();
    });
    await recruitment.getByRole('button', { name: '수락' }).click();
    await expect.poll(() => mutations.filter((entry) => entry.operation === 'messages.respond').length).toBe(1);

    page.once('dialog', async (dialog) => {
        expect(dialog.message()).toBe('거절하시겠습니까?');
        await dialog.accept();
    });
    await invader.getByRole('button', { name: '거절' }).click();
    await expect.poll(() => mutations.filter((entry) => entry.operation === 'messages.respond').length).toBe(2);

    const responses = mutations.filter((entry) => entry.operation === 'messages.respond');
    expect(responses).toHaveLength(2);
    expect(JSON.stringify(responses[0]!.body)).toContain('"messageId":105');
    expect(JSON.stringify(responses[0]!.body)).toContain('"response":true');
    expect(JSON.stringify(responses[1]!.body)).toContain('"messageId":106');
    expect(JSON.stringify(responses[1]!.body)).toContain('"response":false');
});

test('redacts diplomacy for a low-permission general and preserves the failed-send error flow', async ({ page }) => {
    const mutations = await installFixture(page, {
        permission: 2,
        sendError: '공개 메세지를 보낼 수 없습니다.',
    });
    await openMessages(page, { width: 500, height: 900 });

    const select = page.getByLabel('메시지 수신 대상');
    await expect(select.locator('option[value="9000"]')).toHaveCount(0);
    await expect(select.locator('option[value="9002"]')).toHaveCount(0);
    await expect(page.locator('.DiplomacyTalk')).toContainText('조회 권한이 없는 외교 메시지입니다.');
    await expect(page.locator('.DiplomacyTalk')).not.toContainText('삭제된 메시지입니다');
    await expect(page.locator('.DiplomacyTalk')).not.toContainText('외교 메시지 본문');
    const redactedPlate = page.locator('.DiplomacyTalk .msg-plate-permission-redacted');
    await expect(redactedPlate).toBeVisible();
    await expect(redactedPlate).toContainText('권한 제한');
    await expect(redactedPlate).toHaveCSS('outline-style', 'dashed');
    await expect(redactedPlate.locator('.general-icon')).toHaveCSS('filter', 'grayscale(1)');
    await expect(page.locator('.DiplomacyTalk .message-response button').first()).toBeDisabled();
    if (artifactRoot) {
        await mkdir(artifactRoot, { recursive: true });
        await page.locator('.DiplomacyTalk').screenshot({
            path: resolve(artifactRoot, 'diplomacy-permission-redaction-500.png'),
            animations: 'disabled',
        });
    }

    await select.selectOption('9999');
    await page.getByLabel('메시지 입력').fill('차단될 메시지');
    await page.getByRole('button', { name: '서신전달&갱신' }).click();
    await expect(page.getByLabel('메시지 입력')).toHaveValue('');
    await expect(page.getByRole('alert').filter({ hasText: '공개 메세지를 보낼 수 없습니다.' })).toBeVisible();
    await expect.poll(() => mutations.filter((entry) => entry.operation === 'messages.send').length).toBe(1);
});
