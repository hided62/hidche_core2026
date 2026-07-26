import { randomUUID } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';
import {
    createGamePostgresConnector,
    createRedisConnector,
    resolvePostgresConfigFromEnv,
    resolveRedisConfigFromEnv,
    type GamePrismaClient,
    type RedisConnector,
} from '../../packages/infra/src/index.js';

const RECORD_MARKER = `main-records-live-${randomUUID()}`;
const accessToken = `ga_${randomUUID()}`;
let postgres: ReturnType<typeof createGamePostgresConnector>;
let redis: RedisConnector;
let prisma: GamePrismaClient;
let createdIds: number[] = [];

const accessKey = (token: string) => `sammo:game:access:che:default:${token}`;
const trpcResponse = (data: unknown) => ({ result: { data } });
const trpcError = (path: string, message: string) => ({
    error: {
        message,
        code: -32000,
        data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, path },
    },
});
const operationNames = (route: Route): string[] => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    return pathname.slice(pathname.lastIndexOf('/trpc/') + 6).split(',');
};

const inspectRecordLayout = async (page: Page) =>
    page.evaluate(() => {
        const inspect = (selector: string) => {
            const element = document.querySelector(selector);
            if (!(element instanceof HTMLElement)) {
                throw new Error(`missing ${selector}`);
            }
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                rect: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                },
                padding: style.padding,
                color: style.color,
                backgroundImage: style.backgroundImage,
                borderTop: style.borderTop,
                borderBottom: style.borderBottom,
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                fontWeight: style.fontWeight,
                lineHeight: style.lineHeight,
                textAlign: style.textAlign,
            };
        };
        const buckets = [...document.querySelectorAll<HTMLElement>('[data-record-bucket]')];
        const mobileZone = document.querySelector<HTMLElement>('.record-zone-mobile');
        const zoneSelector =
            mobileZone && getComputedStyle(mobileZone).display !== 'none' ? '.record-zone-mobile' : '.record-zone';
        return {
            zone: inspect(zoneSelector),
            global: inspect('[data-record-bucket="global"]'),
            general: inspect('[data-record-bucket="general"]'),
            history: inspect('[data-record-bucket="history"]'),
            title: inspect('[data-record-bucket="global"]'),
            firstLine: inspect('[data-record-bucket="global"] .record-line'),
            panels: buckets.map((bucket) => {
                const panel = bucket.closest<HTMLElement>('.record-panel');
                const title = panel?.querySelector<HTMLElement>('.record-title');
                if (!panel || !title) throw new Error('record panel structure missing');
                return {
                    bucket: bucket.dataset.recordBucket,
                    panel: panel.getBoundingClientRect().toJSON(),
                    title: title.getBoundingClientRect().toJSON(),
                    lineCount: bucket.querySelectorAll('.record-line').length,
                    titleStyle: {
                        fontSize: getComputedStyle(title).fontSize,
                        fontWeight: getComputedStyle(title).fontWeight,
                        lineHeight: getComputedStyle(title).lineHeight,
                        textAlign: getComputedStyle(title).textAlign,
                        borderTop: getComputedStyle(title).borderTop,
                        borderBottom: getComputedStyle(title).borderBottom,
                    },
                };
            }),
        };
    });

test.beforeAll(async () => {
    postgres = createGamePostgresConnector(resolvePostgresConfigFromEnv({ schema: 'che' }));
    redis = createRedisConnector(resolveRedisConfigFromEnv());
    await postgres.connect();
    await redis.connect();
    prisma = postgres.prisma;

    const general = await prisma.general.findFirst({
        where: { userId: { not: null } },
        orderBy: { id: 'asc' },
        select: { id: true, userId: true, name: true },
    });
    if (!general?.userId) {
        throw new Error('The live che profile needs an owned general.');
    }
    const world = await prisma.worldState.findFirst({
        orderBy: { id: 'asc' },
        select: { currentYear: true, currentMonth: true },
    });
    if (!world) {
        throw new Error('The live che profile needs a world state.');
    }

    const drafts = [
        ...Array.from({ length: 15 }, (_, index) => ({
            scope: 'SYSTEM' as const,
            category: 'SUMMARY' as const,
            text: `<C>●</>${RECORD_MARKER} 장수 동향 ${15 - index}`,
        })),
        ...Array.from({ length: 7 }, (_, index) => ({
            scope: 'GENERAL' as const,
            category: 'ACTION' as const,
            generalId: general.id,
            text: `<Y>●</>${RECORD_MARKER} 개인 기록 ${7 - index}`,
        })),
        ...Array.from({ length: 15 }, (_, index) => ({
            scope: 'SYSTEM' as const,
            category: 'HISTORY' as const,
            text: `<R>●</>${RECORD_MARKER} 중원 정세 ${15 - index}`,
        })),
    ];
    const rows = await Promise.all(
        drafts.map((draft) =>
            prisma.logEntry.create({
                data: {
                    ...draft,
                    year: world.currentYear,
                    month: world.currentMonth,
                    meta: { fixture: RECORD_MARKER },
                },
                select: { id: true },
            })
        )
    );
    createdIds = rows.map((row: { id: number }) => row.id);

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 30 * 60 * 1000);
    await redis.client.set(
        accessKey(accessToken),
        JSON.stringify({
            version: 1,
            profile: 'che:default',
            issuedAt: issuedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
            sessionId: `main-records-${randomUUID()}`,
            user: {
                id: general.userId,
                username: 'main-records-live',
                displayName: general.name,
                roles: [],
            },
            sanctions: {},
        }),
        { EX: 1800 }
    );
});

test.afterAll(async () => {
    if (createdIds.length > 0) {
        await prisma.logEntry.deleteMany({ where: { id: { in: createdIds } } });
    }
    await redis.client.del(accessKey(accessToken));
    await redis.disconnect();
    await postgres.disconnect();
});

test('renders all three real database record buckets with legacy computed geometry', async ({ page }) => {
    const liveResponse = await page.request.get(
        `http://127.0.0.1:15113/che/api/trpc/general.getRecentRecords?input=${encodeURIComponent(
            JSON.stringify({
                json: {
                    lastGeneralRecordId: 0,
                    lastWorldHistoryId: 0,
                },
            })
        )}`,
        { headers: { authorization: `Bearer ${accessToken}` } }
    );
    expect(liveResponse.ok()).toBe(true);
    const livePayload = (await liveResponse.json()) as {
        result: { data: { global: unknown[]; general: unknown[]; history: unknown[] } };
    };
    const liveRecords = livePayload.result.data;
    expect([liveRecords.global.length, liveRecords.general.length, liveRecords.history.length]).toEqual([15, 7, 15]);
    let failRecords = false;

    await page.addInitScript(
        ({ token }) => {
            window.localStorage.setItem('sammo-game-token', token);
            window.localStorage.setItem('sammo-game-profile', 'che:default');
        },
        { token: accessToken }
    );
    await page.route('**/che/api/trpc/**', async (route) => {
        const results = operationNames(route).map((operation) => {
            if (operation === 'general.me') {
                return trpcResponse({
                    general: {
                        id: 1,
                        name: '관리자',
                        npcState: 0,
                        nationId: 0,
                        cityId: 1,
                        troopId: 0,
                        picture: null,
                        imageServer: 0,
                        officerLevel: 0,
                        stats: { leadership: 55, strength: 55, intelligence: 55 },
                        gold: 1000,
                        rice: 1000,
                        crew: 0,
                        train: 0,
                        atmos: 0,
                        injury: 0,
                        experience: 0,
                        dedication: 0,
                        items: { horse: null, weapon: null, book: null, item: null },
                    },
                    city: null,
                    nation: null,
                    settings: {},
                    penalties: {},
                });
            }
            if (operation === 'general.getRecentRecords') {
                return failRecords
                    ? trpcError(operation, '동향 정보를 불러오지 못했습니다.')
                    : trpcResponse(liveRecords);
            }
            if (operation === 'lobby.info') {
                return trpcResponse({
                    year: 190,
                    month: 1,
                    userCnt: 1,
                    npcCnt: 0,
                    nationCnt: 0,
                    maxUserCnt: 50,
                    turnTerm: 60,
                    fictionMode: '가상',
                    otherTextInfo: '',
                    starttime: '0190-01-01T00:00:00.000Z',
                    myGeneral: { id: 1, name: '관리자', nationId: 0 },
                });
            }
            if (operation === 'world.getMapLayout') {
                return trpcResponse({
                    mapName: 'che',
                    cityList: [{ id: 1, name: '낙양', level: 7, region: 1, x: 350, y: 245, path: [] }],
                    regionMap: { 1: '사예' },
                    levelMap: { 7: '수도' },
                });
            }
            if (operation === 'world.getMap') {
                return trpcResponse({
                    year: 190,
                    month: 1,
                    startYear: 190,
                    cityList: [[1, 7, 0, 0, 1, 1]],
                    nationList: [],
                    spyList: {},
                    shownByGeneralList: [],
                    myCity: 1,
                    myNation: 0,
                });
            }
            if (operation === 'turns.getCommandTable') return trpcResponse({ general: [], nation: [] });
            if (operation === 'turns.reserved.getGeneral' || operation === 'turns.reserved.getNation') {
                return trpcResponse([]);
            }
            if (operation === 'messages.getRecent') {
                return trpcResponse({
                    private: [],
                    public: [],
                    national: [],
                    diplomacy: [],
                    permission: 0,
                    latestRead: { private: 0, diplomacy: 0 },
                    canRespondDiplomacy: false,
                });
            }
            if (operation === 'messages.getContacts') return trpcResponse([]);
            if (operation === 'board.getAccess') {
                return trpcResponse({ canMeeting: false, canSecret: false, permission: 0 });
            }
            if (operation === 'tournament.getState') return trpcResponse({ stage: 0 });
            if (operation === 'public.recordAccess') return trpcResponse({ recorded: true });
            throw new Error(`Unhandled live main operation: ${operation}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(results),
        });
    });
    await page.route('**/image/**', async (route) => {
        const source = new URL(route.request().url());
        const response = await route.fetch({
            url: `https://dev-sam-ref.hided.net${source.pathname}`,
        });
        await route.fulfill({ response });
    });

    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('./', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-record-bucket="global"] .record-line')).toHaveCount(15);
    await expect(page.locator('[data-record-bucket="general"] .record-line')).toHaveCount(7);
    await expect(page.locator('[data-record-bucket="history"] .record-line')).toHaveCount(15);
    await expect(page.locator('[data-record-bucket="global"]')).toContainText(RECORD_MARKER);

    const desktop = await inspectRecordLayout(page);
    expect(desktop.panels.map((panel) => panel.lineCount)).toEqual([15, 7, 15]);
    expect(desktop.panels[0]?.panel.width).toBeCloseTo(500, 0);
    expect(desktop.panels[1]?.panel.x).toBeCloseTo(500, 0);
    expect(desktop.panels[2]?.panel.width).toBeCloseTo(1000, 0);
    expect(desktop.panels[0]?.panel.height).toBeCloseTo(338, 0);
    expect(desktop.panels[2]?.panel.height).toBeCloseTo(338, 0);
    expect(desktop.panels[0]?.title.height).toBeCloseTo(23, 0);
    expect(desktop.panels[0]?.titleStyle).toMatchObject({
        fontSize: '14px',
        fontWeight: '400',
        lineHeight: '21px',
        textAlign: 'center',
        borderTop: '1px solid rgb(128, 128, 128)',
        borderBottom: '1px solid rgb(128, 128, 128)',
    });

    await page.setViewportSize({ width: 500, height: 900 });
    await page.getByRole('button', { name: '동향', exact: true }).click();
    await expect(page.locator('.record-zone-mobile')).toBeVisible();
    const mobile = await inspectRecordLayout(page);
    expect(mobile.panels.map((panel) => panel.lineCount)).toEqual([15, 7, 15]);
    expect(mobile.panels.every((panel) => Math.round(panel.panel.width) === 500)).toBe(true);
    expect(mobile.panels[0]?.panel.height).toBeCloseTo(338, 0);
    expect(mobile.panels[1]?.panel.height).toBeCloseTo(170, 0);
    expect(mobile.panels[2]?.panel.height).toBeCloseTo(338, 0);

    failRecords = true;
    await page.getByRole('button', { name: '새로고침', exact: true }).click();
    await expect(page.getByRole('alert').first()).toContainText('동향 정보를 불러오지 못했습니다.');
    await expect(page.getByRole('heading', { name: '장수 동향', exact: true })).toBeVisible();
});
