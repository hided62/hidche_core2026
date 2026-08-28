import { devices, expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gameProfile, gameTrpcRoute } from './gameTestPaths.js';
import { acceptAppConfirmation } from './appConfirmation.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const imageRoots = [
    ...(process.env.FRONTEND_PARITY_IMAGE_ROOT ? [resolve(process.env.FRONTEND_PARITY_IMAGE_ROOT, 'game')] : []),
    resolve(repositoryRoot, '../image/game'),
    resolve(repositoryRoot, '../../image/game'),
];

const readReferenceImage = async (filename: string): Promise<Buffer> => {
    for (const imageRoot of imageRoots) {
        try {
            return await readFile(resolve(imageRoot, filename));
        } catch {
            // The main checkout and nested feature worktrees have different parents.
        }
    }
    throw new Error(`Reference image not found: ${filename}`);
};

const readReferenceIcon = async (filename: string): Promise<Buffer> => {
    for (const gameImageRoot of imageRoots) {
        try {
            return await readFile(resolve(gameImageRoot, '..', 'icons', filename));
        } catch {
            // The main checkout and nested feature worktrees have different parents.
        }
    }
    throw new Error(`Reference icon not found: ${filename}`);
};

type Member = {
    id: number;
    name: string;
    cityId: number;
    cityName: string;
    stats: { leadership: number; strength: number; intelligence: number };
    experience: number;
    progression: {
        experienceLevel: number;
        statExperience: { leadership: number; strength: number; intelligence: number };
        statUpgradeLimit: number;
        dex: number[];
    };
    panel: {
        general: {
            id: number;
            name: string;
            picture: string | null;
            imageServer: number;
            npcState: number;
            officerLevel: number;
            officerLevelText: string;
            officerCityName: string | null;
            generalType: string;
            leadershipBonus: number;
            stats: { leadership: number; strength: number; intelligence: number };
            gold: number;
            rice: number;
            crew: number;
            train: number;
            atmos: number;
            injury: number;
            experience: number;
            dedication: number;
            age: number;
            retirementYear: number;
            turnTime: string;
            defenceTrain: number;
            killTurn: number;
            remainingMinutes: number;
            troopId: number;
            troop: { name: string; status: 'present' };
            refreshScore: { current: number; total: number; text: string };
            crewTypeId: number;
            crewTypeName: string;
            traits: { personal: string; specialDomestic: string; specialWar: string };
            progression: {
                experienceLevel: number;
                dedicationLevel: number;
                dedicationText: string;
                statExperience: { leadership: number; strength: number; intelligence: number };
                statUpgradeLimit: number;
                dex: number[];
            };
            itemNames: { horse: string; weapon: string; book: string; item: string };
        };
        summary: {
            available: true;
            experience: number;
            dedicationText: string;
            bill: number;
            warnum: number;
            wins: number;
            losses: number;
            strategies: number;
            serviceYears: number;
            killCrew: number;
            deathCrew: number;
            recentWar: string;
        };
    };
};

const member = (id: number, name: string, cityId: number, cityName: string, troopName = '백마대'): Member => {
    const stats = { leadership: 70, strength: 60, intelligence: 50 };
    const progression = {
        experienceLevel: 4,
        dedicationLevel: 3,
        dedicationText: '28품관',
        statExperience: { leadership: 7, strength: 8, intelligence: 9 },
        statUpgradeLimit: 20,
        dex: [350, 1_375, 3_500, 7_125, 1_275_975],
    };
    return {
        id,
        name,
        cityId,
        cityName,
        stats,
        experience: 450,
        progression,
        panel: {
            general: {
                id,
                name,
                picture: 'default.jpg',
                imageServer: 0,
                npcState: 0,
                officerLevel: 1,
                officerLevelText: '일반',
                officerCityName: null,
                generalType: '용장',
                leadershipBonus: 0,
                stats,
                gold: 1_234,
                rice: 4_321,
                crew: 987,
                train: 88,
                atmos: 77,
                injury: 0,
                experience: 450,
                dedication: 900,
                age: 31,
                retirementYear: 70,
                turnTime: '2026-07-25T08:22:33.000Z',
                defenceTrain: 90,
                killTurn: 7,
                remainingMinutes: 3,
                troopId: 1,
                troop: { name: troopName, status: 'present' },
                refreshScore: { current: 13, total: 800, text: '열심' },
                crewTypeId: 1100,
                crewTypeName: '보병',
                traits: { personal: '대담', specialDomestic: '농업', specialWar: '맹장' },
                progression,
                itemNames: { horse: '명마', weapon: '명검', book: '병서', item: '도구' },
            },
            summary: {
                available: true,
                experience: 450,
                dedicationText: '28품관',
                bill: 1_000,
                warnum: 17,
                wins: 11,
                losses: 6,
                strategies: 5,
                serviceYears: 11,
                killCrew: 1_234,
                deathCrew: 432,
                recentWar: '2026-07-25T08:12:34.000Z',
            },
        },
    };
};
type TroopFixture = {
    id: number;
    name: string;
    nationId: number;
    turnTime: string;
    reservedCommands: string[];
    leader: {
        id: number;
        name: string;
        cityId: number;
        cityName: string;
        picture: string | null;
        imageServer: number;
    };
    members: Member[];
};
type FixtureState = {
    me: { id: number; troopId: number };
    permission: number;
    troops: TroopFixture[];
    failCreate?: boolean;
};

const baseTroops = (): TroopFixture[] => [
    {
        id: 1,
        name: '백마대',
        nationId: 1,
        turnTime: '2026-07-25T08:20:30.000Z',
        reservedCommands: ['집합', '-'],
        leader: {
            id: 1,
            name: '공손찬',
            cityId: 1,
            cityName: '북평',
            picture: 'default.jpg',
            imageServer: 0,
        },
        members: [member(1, '공손찬', 1, '북평'), member(3, '조운', 1, '북평'), member(4, '전예', 2, '계')],
    },
    {
        id: 2,
        name: '청룡대',
        nationId: 1,
        turnTime: '2026-07-25T08:30:30.000Z',
        reservedCommands: ['-'],
        leader: {
            id: 2,
            name: '관우',
            cityId: 2,
            cityName: '계',
            picture: 'default.jpg',
            imageServer: 0,
        },
        members: [member(2, '관우', 2, '계', '청룡대')],
    },
];

const response = (data: unknown) => ({ result: { data } });
const errorResponse = (path: string, message: string) => ({
    error: {
        message,
        code: -32000,
        data: { code: 'BAD_REQUEST', httpStatus: 400, path },
    },
});
const operationName = (route: Route): string => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6));
};
const responseHasOperation = (url: string, operation: string): boolean => {
    const pathname = decodeURIComponent(new URL(url).pathname);
    return pathname
        .slice(pathname.lastIndexOf('/trpc/') + 6)
        .split(',')
        .includes(operation);
};

const fulfillJson = async (route: Route, body: unknown) => {
    await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
};

const gotoTroop = async (page: Page) => {
    const lobbyResponse = page.waitForResponse((response) => responseHasOperation(response.url(), 'lobby.info'));
    await page.goto('troop');
    await lobbyResponse;
};

const installApiFixture = async (page: Page, state: FixtureState) => {
    await page.addInitScript((profile) => {
        window.localStorage.setItem('sammo-game-token', 'ga_playwright');
        window.localStorage.setItem('sammo-game-profile', profile);
    }, gameProfile);
    for (const filename of ['back_walnut.jpg', 'back_green.jpg', 'pr5.gif', 'pb5.gif', 'pr8.gif', 'pb8.gif']) {
        await page.route(`**/image/game/${filename}`, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: filename.endsWith('.gif') ? 'image/gif' : 'image/jpeg',
                body: await readReferenceImage(filename),
            });
        });
    }
    await page.route('**/game/crewtype1100.png', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'image/png',
            body: await readReferenceImage('crewtype1100.png'),
        });
    });
    await page.route('**/icons/**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'image/jpeg',
            body: await readReferenceIcon('default.jpg'),
        });
    });
    await page.route(gameTrpcRoute, async (route) => {
        const operations = operationName(route).split(',');
        const results = operations.map((operation) => {
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') {
                return response({ myGeneral: { id: state.me.id, name: '테스트 장수' } });
            }
            if (operation === 'join.getConfig') {
                return response({});
            }
            if (operation === 'troop.getList') {
                return response({
                    nation: { id: 1, name: '테스트국', color: '#123456' },
                    me: state.me,
                    permission: state.permission,
                    troops: state.troops,
                });
            }
            if (operation === 'troop.create') {
                if (state.failCreate) {
                    state.failCreate = false;
                    return errorResponse(operation, '부대 이름이 없습니다.');
                }
                const createdId = state.me.id;
                state.me.troopId = createdId;
                state.troops.push({
                    id: createdId,
                    name: '신규대',
                    nationId: 1,
                    turnTime: '2026-07-25T08:40:30.000Z',
                    reservedCommands: [],
                    leader: {
                        id: createdId,
                        name: '유비',
                        cityId: 1,
                        cityName: '북평',
                        picture: 'default.jpg',
                        imageServer: 0,
                    },
                    members: [member(createdId, '유비', 1, '북평', '신규대')],
                });
                return response({ ok: true, troopId: createdId, troopName: '신규대' });
            }
            if (operation === 'troop.rename') {
                state.troops[0]!.name = '백마의종';
                return response({ ok: true, troopName: '백마의종' });
            }
            if (operation === 'troop.kick') {
                state.troops[0]!.members = state.troops[0]!.members.filter((member) => member.id !== 3);
                return response({ ok: true });
            }
            if (operation === 'troop.exit') {
                state.me.troopId = 0;
                state.troops = state.troops.filter((troop) => troop.id !== state.me.id);
                return response({ ok: true });
            }
            return errorResponse(operation, `Unhandled fixture operation: ${operation}`);
        });
        await fulfillJson(route, results);
    });
};

test('shows only the Ref-safe first-five troop command labels on desktop and mobile', async ({ page }) => {
    await installApiFixture(page, {
        me: { id: 1, troopId: 1 },
        permission: 4,
        troops: baseTroops(),
    });

    for (const viewport of [
        { width: 1000, height: 800 },
        { width: 500, height: 800 },
    ]) {
        await page.setViewportSize(viewport);
        await gotoTroop(page);

        const firstTroopCommands = page.locator('.troopReservedCommand').first();
        await expect(firstTroopCommands).toContainText('1: 집합');
        await expect(firstTroopCommands).toContainText('2: -');
        await expect(page.locator('#troopList')).not.toContainText('che_');
    }
});

test('renders the legacy desktop grid with matching computed geometry and states', async ({ page }) => {
    await installApiFixture(page, {
        me: { id: 1, troopId: 1 },
        permission: 4,
        troops: baseTroops(),
    });
    await page.setViewportSize({ width: 1000, height: 800 });
    await gotoTroop(page);
    await expect(page.locator('.troopInfo').filter({ hasText: '백마대' })).toBeVisible();
    await expect(page.locator('.troopReservedCommand').first()).toContainText('1: 집합');
    await expect(page.locator('.troopReservedCommand').first()).toContainText('2: -');
    await expect(page.locator('#troopList')).not.toContainText('che_');

    const geometry = await page
        .locator('.troopItem')
        .first()
        .evaluate((item) => {
            const origin = item.getBoundingClientRect();
            const box = (selector: string) => {
                const rect = item.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
                return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
            };
            const members = item.querySelector<HTMLElement>('.troopMembers')!;
            const style = getComputedStyle(members);
            return {
                item: { x: origin.x, y: origin.y, width: origin.width, height: origin.height },
                info: box('.troopInfo'),
                icon: box('.troopLeaderIcon'),
                reserved: box('.troopReservedCommand'),
                members: box('.troopMembers'),
                action: box('.troopAction'),
                membersStyle: {
                    paddingTop: style.paddingTop,
                    paddingLeft: style.paddingLeft,
                    textAlign: style.textAlign,
                    fontFamily: style.fontFamily,
                    fontSize: style.fontSize,
                    lineHeight: style.lineHeight,
                },
            };
        });
    expect(geometry.item).toEqual({ x: 0, y: 32, width: 1000, height: 127.5 });
    expect(geometry.info.width).toBeCloseTo(130, 0);
    expect(geometry.info.height).toBeCloseTo(65, 0);
    expect(geometry.icon.x - geometry.info.x).toBeCloseTo(130, 0);
    expect(geometry.reserved.x - geometry.info.x).toBeCloseTo(260, 0);
    expect(geometry.members.x - geometry.info.x).toBeCloseTo(360, 0);
    expect(geometry.members.width).toBeCloseTo(639, 0);
    expect(geometry.members.height).toBeCloseTo(93, 0);
    expect(geometry.action.x - geometry.info.x).toBeCloseTo(65, 0);
    expect(geometry.action.y - geometry.info.y).toBeCloseTo(93, 0);
    expect(geometry.action.width).toBeCloseTo(934, 0);
    expect(geometry.membersStyle).toEqual({
        paddingTop: '7px',
        paddingLeft: '9.8px',
        textAlign: 'left',
        fontFamily: 'Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif',
        fontSize: '14px',
        lineHeight: '21px',
    });

    const kickButton = page.getByRole('button', { name: '부대원 추방...' }).first();
    expect(await kickButton.evaluate((button) => getComputedStyle(button).backgroundColor)).toBe('rgb(68, 68, 68)');
    await kickButton.hover();
    const hoverStyle = await kickButton.evaluate((button) => ({
        cursor: getComputedStyle(button).cursor,
        borderBottomWidth: getComputedStyle(button).borderBottomWidth,
    }));
    expect(hoverStyle.cursor).toBe('pointer');
    expect(hoverStyle.borderBottomWidth).toBe('3px');

    await page.locator('.troopMember').nth(1).hover();
    const popup = page.getByRole('tooltip');
    await expect(popup).toContainText('조운');
    await expect(popup.locator('[data-general-information-panel]')).toHaveCount(1);
    await expect(popup.locator('[data-general-basic-card]')).toHaveCount(1);
    await expect(popup.locator('[data-general-battle-summary]')).toHaveCount(1);
    await expect(popup).toContainText('봉급1,000');
    await expect(popup).toContainText('승률64.71%');
    await expect(popup).toContainText('살상률285.65%');
    await expect(popup.locator('[role="progressbar"]')).toHaveCount(14);
    await expect(popup.locator('[aria-label*="1,275,975 (EX+)"]')).toHaveCount(5);
    expect(
        await page
            .getByRole('tooltip')
            .locator('[role="progressbar"]')
            .first()
            .evaluate((bar) => getComputedStyle(bar).backgroundImage)
    ).toContain('/game/pr8.gif');
    const popupGeometry = await popup.evaluate((tooltip) => {
        const rect = tooltip.getBoundingClientRect();
        const generalIcon = tooltip.querySelector<HTMLElement>('.general-icon')!.getBoundingClientRect();
        const crewIcon = tooltip.querySelector<HTMLElement>('.general-crew-type-icon')!.getBoundingClientRect();
        return {
            width: rect.width,
            generalIcon: { width: generalIcon.width, height: generalIcon.height },
            crewIcon: { width: crewIcon.width, height: crewIcon.height },
            backgroundImage: getComputedStyle(tooltip.querySelector<HTMLElement>('.general-icon')!).backgroundImage,
        };
    });
    expect(popupGeometry.width).toBeCloseTo(500, 0);
    expect(popupGeometry.generalIcon).toEqual({ width: 64, height: 64 });
    expect(popupGeometry.crewIcon).toEqual({ width: 64, height: 64 });
    expect(popupGeometry.backgroundImage).toContain('/icons/default.jpg');
    await page.screenshot({ path: 'test-results/troop/desktop-leader.png', fullPage: true });
});

test('matches the legacy 500px responsive placement', async ({ page }) => {
    await installApiFixture(page, {
        me: { id: 1, troopId: 1 },
        permission: 4,
        troops: baseTroops(),
    });
    await page.setViewportSize({ width: 500, height: 800 });
    await gotoTroop(page);
    await expect(page.locator('.troopInfo').filter({ hasText: '백마대' })).toBeVisible();
    await expect(page.locator('.troopReservedCommand').first()).toContainText('1: 집합');
    await expect(page.locator('.troopReservedCommand').first()).toContainText('2: -');
    await expect(page.locator('#troopList')).not.toContainText('che_');

    const geometry = await page
        .locator('.troopItem')
        .first()
        .evaluate((item) => {
            const origin = item.getBoundingClientRect();
            const relative = (selector: string) => {
                const rect = item.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
                return { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width };
            };
            return {
                item: { width: origin.width, height: origin.height },
                info: relative('.troopInfo'),
                icon: relative('.troopLeaderIcon'),
                reserved: relative('.troopReservedCommand'),
                action: relative('.troopAction'),
                members: relative('.troopMembers'),
            };
        });
    expect(geometry.item).toEqual({ width: 500, height: 129 });
    expect(geometry.info).toMatchObject({ x: 0, y: 0, width: 130 });
    expect(geometry.icon).toMatchObject({ x: 130, y: 0, width: 130 });
    expect(geometry.reserved).toMatchObject({ x: 260, y: 0, width: 100 });
    expect(geometry.action).toMatchObject({ x: 360, y: 0, width: 140 });
    expect(geometry.members).toMatchObject({ x: 130, y: 93, width: 370 });
    await page.locator('.troopMember').nth(1).hover();
    const mobilePopup = page.getByRole('tooltip');
    await expect(mobilePopup.locator('[data-general-information-panel]')).toHaveCount(1);
    await expect(mobilePopup.locator('[role="progressbar"]')).toHaveCount(14);
    expect(await mobilePopup.evaluate((tooltip) => tooltip.getBoundingClientRect().width)).toBeCloseTo(500, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(500);
    await page.screenshot({ path: 'test-results/troop/mobile-leader.png', fullPage: true });
});

test('shows API failure then creates a troop successfully', async ({ page }) => {
    const state: FixtureState = {
        me: { id: 7, troopId: 0 },
        permission: 0,
        troops: baseTroops(),
        failCreate: true,
    };
    await installApiFixture(page, state);
    await gotoTroop(page);

    const input = page.getByRole('textbox', { name: '부대명' });
    await input.fill('실패대');
    await page.getByRole('button', { name: '부대 창설', exact: true }).click();
    await expect(page.locator('[data-testid="game-toast"][data-feedback-kind="error"]')).toContainText(
        '부대 이름이 없습니다.'
    );
    expect(state.me.troopId).toBe(0);

    await input.fill('신규대');
    await page.getByRole('button', { name: '부대 창설', exact: true }).click();
    await expect(page.locator('[data-testid="game-toast"][data-feedback-kind="success"]')).toContainText(
        '신규대 부대가 생성되었습니다.'
    );
    await expect(page.locator('.troopInfo').filter({ hasText: '신규대' })).toBeVisible();
    await expect(input).toBeHidden();
});

test('renames and kicks through app confirmation dialogs, then refreshes state', async ({ page }) => {
    const state: FixtureState = {
        me: { id: 1, troopId: 1 },
        permission: 4,
        troops: baseTroops(),
    };
    await installApiFixture(page, state);
    await gotoTroop(page);

    await page.getByRole('button', { name: '부대명 변경...' }).first().click();
    await page.getByRole('textbox', { name: '새 부대명' }).fill('백마의종');
    await page.getByRole('button', { name: '변경', exact: true }).click();
    await acceptAppConfirmation(page, '백마대 부대의 이름을 백마의종으로 바꾸시겠습니까?');
    await expect(page.locator('[data-testid="game-toast"][data-feedback-kind="success"]')).toContainText(
        '부대명을 변경했습니다.'
    );
    await expect(page.locator('.troopInfo').filter({ hasText: '백마의종' })).toBeVisible();

    await page.getByRole('button', { name: '부대원 추방...' }).click();
    await page.getByRole('combobox', { name: '추방할 부대원' }).selectOption('3');
    await page.getByRole('button', { name: '추방', exact: true }).click();
    await acceptAppConfirmation(page, '백마의종 부대에서 조운을 추방하시겠습니까?');
    await expect(
        page.locator('[data-testid="game-toast"][data-feedback-kind="success"]').filter({ hasText: '조운' })
    ).toContainText('조운을 추방했습니다.');
    await expect(page.locator('.troopMembers').first()).not.toContainText('조운');
});

test('@ios-webkit iPhone touch renames and disbands a troop through app confirmations', async ({
    browser,
}, testInfo) => {
    const configuredBaseUrl = testInfo.project.use.baseURL;
    if (typeof configuredBaseUrl !== 'string') throw new Error('Playwright baseURL is required');
    const context = await browser.newContext({ ...devices['iPhone 15'], baseURL: configuredBaseUrl });
    const page = await context.newPage();
    const state: FixtureState = {
        me: { id: 1, troopId: 1 },
        permission: 4,
        troops: baseTroops(),
    };
    try {
        await installApiFixture(page, state);
        await gotoTroop(page);
        await page.getByRole('button', { name: '부대명 변경...' }).first().click();
        await page.getByRole('textbox', { name: '새 부대명' }).fill('백마의종');
        await page.getByRole('button', { name: '변경', exact: true }).click();
        await acceptAppConfirmation(page, '백마대 부대의 이름을 백마의종으로 바꾸시겠습니까?');
        await expect(page.locator('.troopInfo').filter({ hasText: '백마의종' })).toBeVisible();

        await page.getByRole('button', { name: '부대 해산' }).click();
        await acceptAppConfirmation(page, '백마의종 부대를 해산하겠습니까?');
        await expect(page.getByTestId('game-toast').filter({ hasText: '부대를 해산했습니다.' })).toBeVisible();
        expect(state.me.troopId).toBe(0);
        await expect(page.locator('[data-troop-id="1"]')).toHaveCount(0);
    } finally {
        await context.close();
    }
});

test('does not render management controls for an unauthorized member', async ({ page }) => {
    await installApiFixture(page, {
        me: { id: 3, troopId: 1 },
        permission: 1,
        troops: baseTroops(),
    });
    await gotoTroop(page);
    await expect(page.getByRole('button', { name: '부대 탈퇴' })).toBeVisible();
    await expect(page.getByRole('button', { name: '부대원 추방...' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '부대명 변경...' })).toHaveCount(0);
});
