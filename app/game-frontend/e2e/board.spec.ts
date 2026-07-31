import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const imageRoots = [
    ...(process.env.FRONTEND_PARITY_IMAGE_ROOT ? [resolve(process.env.FRONTEND_PARITY_IMAGE_ROOT)] : []),
    resolve(repositoryRoot, '../image'),
    resolve(repositoryRoot, '../../image'),
];
const artifactRoot = process.env.BOARD_ARTIFACT_DIR;

type Article = {
    id: number;
    title: string;
    content: string;
    authorName: string;
    authorPicture: string | null;
    authorImageServer: number;
    createdAt: string;
    comments: Array<{
        id: number;
        authorName: string;
        content: string;
        createdAt: string;
    }>;
};

type BoardFixture = {
    permission: number;
    canMeeting: boolean;
    canSecret: boolean;
    articles: Article[];
    failArticle?: boolean;
    failComment?: boolean;
    requests: string[];
};

const response = (data: unknown) => ({ result: { data } });
const errorResponse = (path: string, message: string) => ({
    error: {
        message,
        code: -32000,
        data: { code: 'BAD_REQUEST', httpStatus: 400, path },
    },
});

const operationNames = (route: Route): string[] => {
    const url = new URL(route.request().url());
    return decodeURIComponent(url.pathname.slice(url.pathname.lastIndexOf('/trpc/') + 6)).split(',');
};

const initialArticles = (): Article[] => [
    {
        id: 11,
        title: '첫 작전 회의',
        content: '낙양을 지킵시다.\n병력은 서문에 배치합니다.',
        authorName: '유비',
        authorPicture: '22.jpg',
        authorImageServer: 0,
        createdAt: '2026-07-26T10:20:00.000Z',
        comments: [
            {
                id: 21,
                authorName: '관우',
                content: '확인했습니다.',
                createdAt: '2026-07-26T10:25:00.000Z',
            },
        ],
    },
];

const readImage = async (relative: string): Promise<Buffer> => {
    for (const root of imageRoots) {
        try {
            return await readFile(resolve(root, relative));
        } catch {
            // Main checkout and feature worktrees have different image-root parents.
        }
    }
    throw new Error(`Reference image not found: ${relative}`);
};

const installImages = async (page: Page) => {
    for (const filename of ['back_walnut.jpg', 'back_green.jpg', 'back_blue.jpg']) {
        await page.route(`**/image/game/${filename}`, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'image/jpeg',
                body: await readImage(`game/${filename}`),
            });
        });
    }
    await page.route('**/image/icons/**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'image/jpeg',
            body: await readImage('icons/22.jpg'),
        });
    });
};

const generalContext = {
    general: {
        id: 1,
        name: '유비',
        npcState: 0,
        nationId: 1,
        cityId: 1,
        troopId: 0,
        picture: '22.jpg',
        imageServer: 0,
        officerLevel: 1,
        stats: { leadership: 80, strength: 70, intelligence: 75 },
        gold: 1000,
        rice: 1000,
        crew: 500,
        train: 100,
        atmos: 100,
        injury: 0,
        experience: 100,
        dedication: 100,
        items: { horse: 'None', weapon: 'None', book: 'None', item: 'None' },
    },
    city: null,
    nation: null,
    settings: {},
    penalties: {},
};

const emptyMessages = {
    private: [],
    national: [],
    public: [],
    diplomacy: [],
    sequence: -1,
    hasMore: { private: false, national: false, public: false, diplomacy: false },
    latestRead: { private: 0, national: 0, public: 0, diplomacy: 0 },
    canRespondDiplomacy: false,
};

const installApi = async (page: Page, state: BoardFixture) => {
    await installImages(page);
    await page.addInitScript(() => {
        window.localStorage.setItem('sammo-game-token', 'ga_board_playwright');
        window.localStorage.setItem('sammo-game-profile', 'che:default');
    });
    await page.route('**/che/api/trpc/**', async (route) => {
        const operations = operationNames(route);
        const results = operations.map((operation) => {
            state.requests.push(operation);
            if (operation === 'auth.status') return response({ ok: true });
            if (operation === 'lobby.info') {
                return response({
                    year: 197,
                    month: 7,
                    userCnt: 2,
                    maxUserCnt: 50,
                    npcCnt: 0,
                    nationCnt: 1,
                    turnTerm: 60,
                    fictionMode: '가상',
                    starttime: '',
                    opentime: '',
                    turntime: '',
                    otherTextInfo: '',
                    isUnited: 0,
                    myGeneral: { name: '유비', picture: '22.jpg' },
                });
            }
            if (operation === 'join.getConfig') return response({});
            if (operation === 'board.getAccess') {
                return response({
                    permission: state.permission,
                    canMeeting: state.canMeeting,
                    canSecret: state.canSecret,
                });
            }
            if (operation === 'board.getArticles') return response(state.articles);
            if (operation === 'board.writeArticle') {
                if (state.failArticle) {
                    state.failArticle = false;
                    return errorResponse(operation, '접속 제한입니다.');
                }
                state.articles.unshift({
                    id: 12,
                    title: '새 제목',
                    content: '새 내용',
                    authorName: '유비',
                    authorPicture: '22.jpg',
                    authorImageServer: 0,
                    createdAt: '2026-07-26T11:00:00.000Z',
                    comments: [],
                });
                return response({ id: 12 });
            }
            if (operation === 'board.writeComment') {
                if (state.failComment) {
                    state.failComment = false;
                    return errorResponse(operation, '접속 제한입니다.');
                }
                state.articles[0]?.comments.push({
                    id: 22,
                    authorName: '유비',
                    content: '새 댓글',
                    createdAt: '2026-07-26T11:05:00.000Z',
                });
                return response({ id: 22 });
            }
            if (operation === 'general.me') return response(generalContext);
            if (operation === 'world.getMapLayout') {
                return response({ mapName: 'che', cityList: [], regionMap: {}, levelMap: {} });
            }
            if (operation === 'world.getMap') {
                return response({
                    year: 197,
                    month: 7,
                    startYear: 190,
                    cityList: [],
                    nationList: [],
                    myCity: 1,
                    myNation: 1,
                });
            }
            if (operation === 'turns.getCommandTable') return response({ general: [], nation: [] });
            if (operation === 'messages.getRecent') return response(emptyMessages);
            if (operation === 'messages.getContacts') return response({ nation: [] });
            if (operation === 'turns.reserved.getGeneral') return response({ turns: [], revision: 0 });
            if (operation === 'turns.reserved.getNation') return response({ turns: [], revision: 0 });
            if (operation === 'general.getRecentRecords') return response({ global: [], general: [], history: [] });
            if (operation === 'general.getFrontStatus')
                return response({
                    onlineUserCount: 1,
                    onlineNations: '아국(1)',
                    onlineGenerals: '유비',
                    nationNotice: '',
                    lastExecuted: null,
                    latestVote: null,
                });
            if (operation === 'tournament.getState') return response({ stage: 0 });
            return errorResponse(operation, `Unhandled board fixture operation: ${operation}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(results),
        });
    });
};

const gotoBoard = async (page: Page, path = 'board') => {
    const articlesResponse = page.waitForResponse(
        (result) => result.url().includes('/trpc/board.getArticles') && result.ok()
    );
    await page.goto(path);
    await articlesResponse;
    await expect(page.locator('.article-frame')).toBeVisible();
};

test('matches the ref meeting-room geometry, typography, textures, and controls', async ({ page }) => {
    const state: BoardFixture = {
        permission: 0,
        canMeeting: true,
        canSecret: false,
        articles: initialArticles(),
        requests: [],
    };
    await installApi(page, state);
    await page.setViewportSize({ width: 1000, height: 800 });
    await gotoBoard(page);
    if (artifactRoot) {
        await page.screenshot({
            path: resolve(artifactRoot, 'board-core-desktop.png'),
            fullPage: true,
            animations: 'disabled',
        });
    }

    const geometry = await page.evaluate(() => {
        const rect = (selector: string) => {
            const box = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, height: box.height };
        };
        const pageStyle = getComputedStyle(document.querySelector<HTMLElement>('.legacy-board-page')!);
        const articleText = getComputedStyle(document.querySelector<HTMLElement>('.article-text')!);
        return {
            container: rect('#container'),
            topBar: rect('.top-back-bar'),
            titleLabel: rect('.form-label'),
            submitArticle: rect('#submitArticle'),
            articleAuthor: rect('.article-header .author-name'),
            articleDate: rect('.article-header .date'),
            icon: rect('.general-icon'),
            commentAuthor: rect('.comment-row .author-name'),
            submitComment: rect('.submit-comment'),
            bottomButton: rect('.bottom-bar .back-button'),
            font: {
                family: pageStyle.fontFamily,
                size: pageStyle.fontSize,
                lineHeight: pageStyle.lineHeight,
            },
            whiteSpace: articleText.whiteSpace,
            walnut: getComputedStyle(document.querySelector<HTMLElement>('#newArticle')!).backgroundImage,
            green: getComputedStyle(document.querySelector<HTMLElement>('.article-header')!).backgroundImage,
            blue: getComputedStyle(document.querySelector<HTMLElement>('.new-article-header')!).backgroundImage,
            submitStyle: {
                backgroundColor: getComputedStyle(document.querySelector<HTMLElement>('#submitArticle')!)
                    .backgroundColor,
                borderColor: getComputedStyle(document.querySelector<HTMLElement>('#submitArticle')!).borderColor,
            },
        };
    });

    expect(geometry.container).toMatchObject({ width: 1000, height: 397.3125 });
    expect(geometry.topBar.height).toBe(32);
    expect(geometry.titleLabel.width).toBeCloseTo(83.33, 1);
    expect(geometry.titleLabel).toMatchObject({ y: 64.1875, height: 22.1875 });
    expect(geometry.submitArticle).toMatchObject({ y: 132.5625, height: 35.5 });
    expect(geometry.submitArticle.width).toBeCloseTo(149.16, 1);
    expect(geometry.submitComment.width).toBeCloseTo(83.33, 1);
    expect(geometry.articleAuthor.width).toBe(120);
    expect(geometry.articleAuthor).toMatchObject({ y: 188.0625, height: 18.1875 });
    expect(geometry.articleDate.width).toBeCloseTo(83.33, 1);
    expect(geometry.icon).toMatchObject({ x: 28, y: 206.25, width: 64, height: 64 });
    expect(geometry.commentAuthor.width).toBe(120);
    expect(geometry.commentAuthor).toMatchObject({ y: 271.25, height: 20.1875 });
    expect(geometry.submitComment).toMatchObject({ y: 292.4375, height: 29.375 });
    expect(geometry.bottomButton).toMatchObject({ x: 0, y: 361.8125, width: 71, height: 35.5 });
    expect(geometry.font.family).toContain('Pretendard');
    expect(geometry.font).toMatchObject({ size: '14px', lineHeight: '18.2px' });
    expect(geometry.whiteSpace).toBe('pre');
    expect(geometry.walnut).toContain('back_walnut.jpg');
    expect(geometry.green).toContain('back_green.jpg');
    expect(geometry.blue).toContain('back_blue.jpg');
    expect(geometry.submitStyle).toEqual({
        backgroundColor: 'rgb(68, 68, 68)',
        borderColor: 'rgb(61, 61, 61)',
    });

    const button = page.locator('#submitArticle');
    const before = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
    await button.hover();
    const hover = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
    await button.focus();
    await expect(button).toBeFocused();
    const focusOutline = await button.evaluate((element) => getComputedStyle(element).outline);
    expect(hover).toBe(before);
    expect(focusOutline).toContain('none');
});

test('uses the ref 500px responsive form widths', async ({ page }) => {
    const state: BoardFixture = {
        permission: 2,
        canMeeting: true,
        canSecret: true,
        articles: initialArticles(),
        requests: [],
    };
    await installApi(page, state);
    await page.setViewportSize({ width: 500, height: 800 });
    await gotoBoard(page, 'board/secret');
    if (artifactRoot) {
        await page.screenshot({
            path: resolve(artifactRoot, 'board-core-mobile-secret.png'),
            fullPage: true,
            animations: 'disabled',
        });
    }

    const geometry = await page.evaluate(() => {
        const width = (selector: string) =>
            document.querySelector<HTMLElement>(selector)!.getBoundingClientRect().width;
        return {
            container: width('#container'),
            label: width('.form-label'),
            submitArticle: width('#submitArticle'),
            author: width('.article-header .author-name'),
            date: width('.article-header .date'),
        };
    });
    expect(geometry.container).toBe(500);
    expect(geometry.label).toBeCloseTo(83.33, 1);
    expect(geometry.submitArticle).toBeCloseTo(152.66, 1);
    expect(geometry.author).toBe(120);
    expect(geometry.date).toBeCloseTo(83.33, 1);
    await expect(page.getByRole('heading', { name: '기밀실' })).toBeVisible();
});

test('retains article and comment input after a failed mutation, then reloads after success', async ({ page }) => {
    const state: BoardFixture = {
        permission: 2,
        canMeeting: true,
        canSecret: true,
        articles: initialArticles(),
        failArticle: true,
        failComment: true,
        requests: [],
    };
    await installApi(page, state);
    await gotoBoard(page);

    await page.locator('#board-title').fill('새 제목');
    await page.locator('#board-content').fill('새 내용');
    page.once('dialog', async (dialog) => {
        expect(dialog.message()).toBe('실패했습니다. :접속 제한입니다.');
        await dialog.accept();
    });
    await page.locator('#submitArticle').click();
    await expect(page.locator('#board-title')).toHaveValue('새 제목');
    await expect(page.locator('#board-content')).toHaveValue('새 내용');

    await page.locator('#submitArticle').click();
    await expect(page.getByText('새 제목', { exact: true })).toBeVisible();
    await expect(page.locator('#board-title')).toHaveValue('');

    const commentInput = page.locator('.comment-input').first();
    await commentInput.fill('새 댓글');
    page.once('dialog', async (dialog) => {
        expect(dialog.message()).toBe('실패했습니다: 접속 제한입니다.');
        await dialog.accept();
    });
    await commentInput.press('Enter');
    await expect(commentInput).toHaveValue('새 댓글');

    await commentInput.press('Enter');
    await expect(page.getByText('새 댓글', { exact: true })).toBeVisible();
});

test('denies direct secret-room rendering and disables its in-game menu for an ordinary member', async ({ page }) => {
    const state: BoardFixture = {
        permission: 0,
        canMeeting: true,
        canSecret: false,
        articles: initialArticles(),
        requests: [],
    };
    await installApi(page, state);
    await page.goto('board/secret');
    await expect(page.getByRole('alert')).toHaveText('권한이 부족합니다. 수뇌부가 아닙니다.');
    await expect(page.locator('#newArticle')).toHaveCount(0);
    expect(state.requests).not.toContain('board.getArticles');

    state.requests.length = 0;
    await page.goto('');
    const nationMenu = page.locator('.main-nation-menu').first();
    await expect(nationMenu.locator('[data-navigation-id="meeting"]')).toHaveAttribute('href', '/che/board');
    await expect(nationMenu.locator('[data-navigation-id="secret-board"]')).toHaveAttribute('aria-disabled', 'true');
});

test('enables both in-game menu entries for a chief or delegated secret role', async ({ page }) => {
    const state: BoardFixture = {
        permission: 3,
        canMeeting: true,
        canSecret: true,
        articles: initialArticles(),
        requests: [],
    };
    await installApi(page, state);
    await page.goto('');
    const nationMenu = page.locator('.main-nation-menu').first();
    await expect(nationMenu.locator('[data-navigation-id="meeting"]')).toHaveAttribute('href', '/che/board');
    await expect(nationMenu.locator('[data-navigation-id="secret-board"]')).toHaveAttribute(
        'href',
        '/che/board/secret'
    );
});
