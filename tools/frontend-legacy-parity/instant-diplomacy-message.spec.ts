import { expect, test, type Page, type Route } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { canonicalFrontendFixture as fixture } from './fixtures/canonical.js';

const artifactRoot = process.env.FRONTEND_PARITY_ARTIFACT_DIR;
const gamePort = process.env.FRONTEND_PARITY_GAME_PORT ?? '15102';
const response = (data: unknown) => ({ result: { data } });

const operationNames = (route: Route): string[] => {
    const pathname = new URL(route.request().url()).pathname;
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const general = {
    id: 1,
    name: '수락장수',
    npcState: 0,
    nationId: 1,
    cityId: 1,
    troopId: 0,
    picture: null,
    imageServer: 0,
    officerLevel: 5,
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
    nation: null,
    settings: {},
    penalties: {},
};

const diplomacyMessage = {
    id: 701,
    msgType: 'diplomacy',
    src: {
        generalId: 2,
        generalName: '제안장수',
        nationId: 2,
        nationName: '제안국',
        color: '#2457a6',
        icon: '',
    },
    dest: {
        generalId: 1,
        generalName: '수락장수',
        nationId: 1,
        nationName: '수락국',
        color: '#d32f2f',
        icon: '',
    },
    text: '제안국에서 191년 2월까지 불가침을 제안했습니다.',
    option: {
        action: 'noAggression',
        year: 191,
        month: 2,
        used: false,
        deletable: false,
    },
    time: '0190-03-01 00:00:00',
};

const messageBundle = (visible: boolean, canRespondDiplomacy = true, deleted = false) => ({
    result: true,
    private: [],
    public: [],
    national: [],
    diplomacy: visible
        ? [
              deleted
                  ? {
                        ...diplomacyMessage,
                        text: '삭제된 메시지입니다.',
                        option: { ...diplomacyMessage.option, invalid: true },
                    }
                  : diplomacyMessage,
          ]
        : [],
    sequence: visible ? diplomacyMessage.id : -1,
    nationId: 1,
    generalName: general.name,
    permission: canRespondDiplomacy ? 4 : 2,
    canRespondDiplomacy,
    latestRead: { diplomacy: 0, private: 0 },
});

const installFixture = async (
    page: Page,
    options: { acceptResponse: boolean; canRespondDiplomacy?: boolean; deleted?: boolean }
): Promise<Array<{ operation: string; body: unknown }>> => {
    let visible = true;
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
        const operations = operationNames(route);
        const requestBody = route.request().postDataJSON();
        const results = operations.map((operation) => {
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
                        data: {
                            canMeeting: true,
                            canSecret: true,
                            permission: options.canRespondDiplomacy === false ? 2 : 4,
                        },
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
                    currentYear: 190,
                    currentMonth: 3,
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
                    onlineNations: '수락국(1)',
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
                return response(messageBundle(visible, options.canRespondDiplomacy, options.deleted));
            }
            if (operation === 'messages.getContacts') return response({ nation: [] });
            if (operation === 'board.getAccess') return response({ canMeeting: true, canSecret: true });
            if (operation === 'tournament.getState') return response({ stage: 0 });
            if (operation === 'public.recordAccess') return response({ recorded: true });
            if (operation === 'messages.respond') {
                mutations.push({ operation, body: requestBody });
                if (options.acceptResponse) {
                    visible = false;
                    return response({ result: true, reason: '불가침 제의를 수락했습니다.' });
                }
                return response({ result: false, reason: '현재 외교 상태에서는 수락할 수 없습니다.' });
            }
            throw new Error(`Unhandled instant diplomacy fixture operation: ${operation}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(results),
        });
    });
    return mutations;
};

const openDiplomacyTab = async (page: Page) => {
    await page.goto(`http://127.0.0.1:${gamePort}/che/`);
    await expect(page.getByRole('heading', { name: '전장 현황' })).toBeVisible();
    await expect(page.locator('.DiplomacyTalk')).toBeVisible();
    await expect(page.getByText(diplomacyMessage.text)).toBeVisible();
};

test.describe('instant diplomacy response UI', () => {
    test('renders and accepts the actionable message in desktop Chromium', async ({ page }) => {
        const mutations = await installFixture(page, { acceptResponse: true });
        await page.setViewportSize({ width: 1365, height: 900 });
        await openDiplomacyTab(page);

        const responseRow = page.locator('.message-response');
        const accept = responseRow.getByRole('button', { name: '수락' });
        const decline = responseRow.getByRole('button', { name: '거절' });
        const geometry = await responseRow.evaluate((element) => {
            const row = element.getBoundingClientRect();
            const buttons = Array.from(element.querySelectorAll('button')).map((button) => {
                const rect = button.getBoundingClientRect();
                const style = getComputedStyle(button);
                return {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                    color: style.color,
                    fontSize: style.fontSize,
                    borderWidth: style.borderWidth,
                    cursor: style.cursor,
                };
            });
            return { row: { x: row.x, y: row.y, width: row.width, height: row.height }, buttons };
        });

        expect(geometry.buttons).toHaveLength(2);
        expect(geometry.buttons[1]!.x - (geometry.buttons[0]!.x + geometry.buttons[0]!.width)).toBeCloseTo(4, 0);
        expect(geometry.buttons[0]).toMatchObject({
            color: 'rgb(255, 255, 255)',
            fontSize: '12.5px',
            borderWidth: '0px 1px 4px',
            cursor: 'pointer',
        });
        expect(geometry.buttons[1]).toMatchObject({
            color: 'rgb(255, 255, 255)',
            fontSize: '12.5px',
            borderWidth: '0px 1px 4px',
            cursor: 'pointer',
        });
        expect(geometry.buttons.every((button) => button.height >= 28 && button.height <= 34)).toBe(true);

        await decline.hover();
        expect(await decline.evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer');
        await accept.focus();
        await expect(accept).toBeFocused();
        if (artifactRoot) {
            await mkdir(artifactRoot, { recursive: true });
            await responseRow.screenshot({
                path: resolve(artifactRoot, 'instant-diplomacy-response-core-desktop.png'),
                animations: 'disabled',
            });
        }

        page.once('dialog', async (dialog) => {
            expect(dialog.message()).toBe('수락하시겠습니까?');
            await dialog.dismiss();
        });
        await accept.click();
        expect(mutations).toHaveLength(0);
        await expect(page.getByText(diplomacyMessage.text)).toBeVisible();

        page.once('dialog', async (dialog) => {
            expect(dialog.message()).toBe('수락하시겠습니까?');
            await dialog.accept();
        });
        await accept.click();
        await expect(page.getByText(diplomacyMessage.text)).toHaveCount(0);
        expect(mutations).toHaveLength(1);
        expect(JSON.stringify(mutations[0]!.body)).toContain('"response":true');
    });

    test('keeps the message and exposes a rejected response on mobile Chromium', async ({ page }) => {
        const mutations = await installFixture(page, { acceptResponse: false });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`http://127.0.0.1:${gamePort}/che/`);
        await expect(page.getByRole('heading', { name: '전장 현황' })).toBeVisible();
        const mobileMessageButton = page.getByRole('button', { name: '메시지', exact: true });
        if ((await mobileMessageButton.count()) > 0) await mobileMessageButton.click();

        const responseRow = page.locator('.message-response');
        await expect(responseRow).toBeVisible();
        const itemWidth = await page
            .locator('.DiplomacyTalk .msg-plate')
            .evaluate((element) => element.getBoundingClientRect().width);
        expect(itemWidth).toBeCloseTo(500, 0);

        page.once('dialog', async (dialog) => {
            expect(dialog.message()).toBe('거절하시겠습니까?');
            await dialog.accept();
        });
        await responseRow.getByRole('button', { name: '거절' }).click();
        await expect(
            page.getByRole('alert').filter({ hasText: '현재 외교 상태에서는 수락할 수 없습니다.' })
        ).toBeVisible();
        await expect(page.getByText(diplomacyMessage.text)).toBeVisible();
        expect(mutations).toHaveLength(1);
        expect(JSON.stringify(mutations[0]!.body)).toContain('"response":false');

        if (artifactRoot) {
            await mkdir(artifactRoot, { recursive: true });
            await page.locator('.mobile-panel[data-mobile-panel-id="messages"]').screenshot({
                path: resolve(artifactRoot, 'instant-diplomacy-response-error-core-mobile.png'),
                animations: 'disabled',
            });
        }
    });

    test('shows but disables legacy response controls without diplomacy authority', async ({ page }) => {
        const mutations = await installFixture(page, {
            acceptResponse: true,
            canRespondDiplomacy: false,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`http://127.0.0.1:${gamePort}/che/`);
        await expect(page.getByRole('heading', { name: '전장 현황' })).toBeVisible();
        const mobileMessageButton = page.getByRole('button', { name: '메시지', exact: true });
        if ((await mobileMessageButton.count()) > 0) await mobileMessageButton.click();

        const accept = page.locator('.message-response').getByRole('button', { name: '수락' });
        await expect(accept).toBeDisabled();
        expect(
            await accept.evaluate((element) => {
                const style = getComputedStyle(element);
                return { cursor: style.cursor, opacity: style.opacity };
            })
        ).toEqual({ cursor: 'not-allowed', opacity: '0.65' });
        await accept.click({ force: true });
        expect(mutations).toHaveLength(0);
    });

    test('does not render response controls for a deleted diplomatic prompt', async ({ page }) => {
        const mutations = await installFixture(page, { acceptResponse: true, deleted: true });
        await page.setViewportSize({ width: 1365, height: 900 });
        await page.goto(`http://127.0.0.1:${gamePort}/che/`);
        await expect(page.getByText('삭제된 메시지입니다', { exact: true })).toBeVisible();
        await expect(page.locator('.message-response')).toHaveCount(0);
        await expect(page.getByRole('button', { name: '수락' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: '거절' })).toHaveCount(0);
        expect(mutations).toHaveLength(0);
        if (artifactRoot) {
            await mkdir(artifactRoot, { recursive: true });
            await page.locator('.DiplomacyTalk .msg-plate').screenshot({
                path: resolve(artifactRoot, 'deleted-diplomacy-message-core-desktop.png'),
                animations: 'disabled',
            });
        }
    });
});
