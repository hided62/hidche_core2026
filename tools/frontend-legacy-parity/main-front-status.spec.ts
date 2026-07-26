import { randomUUID } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';
import {
    createGamePostgresConnector,
    createRedisConnector,
    GamePrisma,
    resolvePostgresConfigFromEnv,
    resolveRedisConfigFromEnv,
    type GamePrismaClient,
    type RedisConnector,
} from '../../packages/infra/src/index.js';

const marker = `main-front-status-live-${randomUUID()}`;
const accessToken = `ga_${randomUUID()}`;
let postgres: ReturnType<typeof createGamePostgresConnector>;
let redis: RedisConnector;
let prisma: GamePrismaClient;
let fixture: { generalId: number; nationId: number; userId: string; voteId: number } | null = null;

const accessKey = (token: string) => `sammo:game:access:che:default:${token}`;
const response = (data: unknown) => ({ result: { data } });
const errorResponse = (path: string, message: string) => ({
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

test.beforeAll(async () => {
    postgres = createGamePostgresConnector(resolvePostgresConfigFromEnv({ schema: 'che' }));
    redis = createRedisConnector(resolveRedisConfigFromEnv());
    await postgres.connect();
    await redis.connect();
    prisma = postgres.prisma;

    const world = await prisma.worldState.findFirst({ orderBy: { id: 'asc' }, select: { id: true } });
    if (!world) {
        throw new Error('The live che profile needs a world state.');
    }
    const [generalMax, nationMax] = await Promise.all([
        prisma.general.aggregate({ _max: { id: true } }),
        prisma.nation.aggregate({ _max: { id: true } }),
    ]);
    const nationId = (nationMax._max.id ?? 0) + 10_000;
    const generalId = (generalMax._max.id ?? 0) + 10_000;
    const userId = `main-front-status-${randomUUID()}`;
    await prisma.$executeRaw(
        GamePrisma.sql`
            INSERT INTO nation (id, name, color, meta)
            VALUES (
                ${nationId},
                ${'검증국'},
                ${'#336699'},
                ${JSON.stringify({ notice: `<p>${marker} 국가 방침</p>` })}::jsonb
            )
        `
    );
    await prisma.$executeRaw(
        GamePrisma.sql`
            INSERT INTO general (id, user_id, name, nation_id, city_id, turn_time)
            VALUES (${generalId}, ${userId}, ${'현황검증장수'}, ${nationId}, ${0}, ${new Date()})
        `
    );
    await prisma.generalAccessLog.create({
        data: {
            generalId,
            userId,
            lastRefresh: new Date(),
            refresh: 1,
            refreshTotal: 1,
            refreshScore: 1,
            refreshScoreTotal: 1,
        },
    });
    const poll = await prisma.votePoll.create({
        data: {
            title: '검증 설문',
            body: '',
            options: ['찬성', '반대'],
            multipleOptions: 1,
            revealMode: 'after_vote',
            openerGeneralId: generalId,
            openerName: '현황검증장수',
            startAt: new Date(Date.now() - 60_000),
            endAt: new Date(Date.now() + 3_600_000),
        },
        select: { id: true },
    });
    fixture = { generalId, nationId, userId, voteId: poll.id };

    const issuedAt = new Date();
    await redis.client.set(
        accessKey(accessToken),
        JSON.stringify({
            version: 1,
            profile: 'che:default',
            issuedAt: issuedAt.toISOString(),
            expiresAt: new Date(issuedAt.getTime() + 30 * 60 * 1000).toISOString(),
            sessionId: `main-front-status-${randomUUID()}`,
            user: {
                id: userId,
                username: 'main-front-status-live',
                displayName: '현황검증장수',
                roles: [],
            },
            sanctions: {},
        }),
        { EX: 1800 }
    );
});

test.afterAll(async () => {
    if (fixture) {
        await prisma.votePoll.deleteMany({ where: { id: fixture.voteId } });
        await prisma.generalAccessLog.deleteMany({ where: { generalId: fixture.generalId } });
        await prisma.$executeRaw(GamePrisma.sql`DELETE FROM general WHERE id = ${fixture.generalId}`);
        await prisma.$executeRaw(GamePrisma.sql`DELETE FROM nation WHERE id = ${fixture.nationId}`);
        const [generalCount, nationCount, voteCount, accessCount] = await Promise.all([
            prisma.general.count({ where: { id: fixture.generalId } }),
            prisma.nation.count({ where: { id: fixture.nationId } }),
            prisma.votePoll.count({ where: { id: fixture.voteId } }),
            prisma.generalAccessLog.count({ where: { generalId: fixture.generalId } }),
        ]);
        expect([generalCount, nationCount, voteCount, accessCount]).toEqual([0, 0, 0, 0]);
    }
    await redis.client.del(accessKey(accessToken));
    await redis.disconnect();
    await postgres.disconnect();
});

const installMainFixture = async (
    page: Page,
    liveStatus: {
        onlineUserCount: number;
        onlineNations: string;
        onlineGenerals: string;
        nationNotice: string;
        lastExecuted: string | null;
        latestVote: { id: number; title: string; hasVoted: boolean } | null;
    },
    failStatus: () => boolean
) => {
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
                return response({
                    general: {
                        id: fixture?.generalId ?? 1,
                        name: '현황검증장수',
                        npcState: 0,
                        nationId: fixture?.nationId ?? 1,
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
            if (operation === 'general.getFrontStatus') {
                return failStatus()
                    ? errorResponse(operation, '상단 현황을 불러오지 못했습니다.')
                    : response(liveStatus);
            }
            if (operation === 'general.getRecentRecords') return response({ global: [], general: [], history: [] });
            if (operation === 'lobby.info') {
                return response({
                    year: 190,
                    month: 1,
                    userCnt: 1,
                    npcCnt: 0,
                    nationCnt: 1,
                    maxUserCnt: 50,
                    turnTerm: 60,
                    fictionMode: '가상',
                    otherTextInfo: '',
                    starttime: '0190-01-01T00:00:00.000Z',
                    myGeneral: { name: '현황검증장수', picture: null },
                });
            }
            if (operation === 'world.getMapLayout') {
                return response({
                    mapName: 'che',
                    cityList: [{ id: 1, name: '낙양', level: 7, region: 1, x: 350, y: 245, path: [] }],
                    regionMap: { 1: '사예' },
                    levelMap: { 7: '수도' },
                });
            }
            if (operation === 'world.getMap') {
                return response({
                    year: 190,
                    month: 1,
                    startYear: 190,
                    cityList: [[1, 7, 0, 0, 1, 1]],
                    nationList: [],
                    spyList: {},
                    shownByGeneralList: [],
                    myCity: 1,
                    myNation: fixture?.nationId ?? 1,
                });
            }
            if (operation === 'turns.getCommandTable') return response({ general: [], nation: [] });
            if (operation === 'turns.reserved.getGeneral' || operation === 'turns.reserved.getNation') {
                return response([]);
            }
            if (operation === 'messages.getRecent') {
                return response({
                    private: [],
                    public: [],
                    national: [],
                    diplomacy: [],
                    permission: 0,
                    latestRead: { private: 0, diplomacy: 0 },
                    canRespondDiplomacy: false,
                });
            }
            if (operation === 'messages.getContacts') return response([]);
            if (operation === 'board.getAccess') {
                return response({ canMeeting: false, canSecret: false, permission: 0 });
            }
            if (operation === 'tournament.getState') return response({ stage: 0 });
            if (operation === 'public.recordAccess') return response({ recorded: true });
            throw new Error(`Unhandled main front status operation: ${operation}`);
        });
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(results),
        });
    });
};

test('renders actual online, nation policy, and survey data with ref geometry and preserves it on error', async ({
    page,
}) => {
    const liveResponse = await page.request.get(
        'http://127.0.0.1:15113/che/api/trpc/general.getFrontStatus?input=%7B%22json%22%3Anull%7D',
        { headers: { authorization: `Bearer ${accessToken}` } }
    );
    expect(liveResponse.ok()).toBe(true);
    const liveStatus = (
        (await liveResponse.json()) as {
            result: {
                data: {
                    onlineUserCount: number;
                    onlineNations: string;
                    onlineGenerals: string;
                    nationNotice: string;
                    lastExecuted: string | null;
                    latestVote: { id: number; title: string; hasVoted: boolean } | null;
                };
            };
        }
    ).result.data;
    expect(liveStatus.onlineGenerals).toContain('현황검증장수');
    expect(liveStatus.nationNotice).toContain(marker);
    expect(liveStatus.latestVote).toMatchObject({ title: '검증 설문', hasVoted: false });

    let failStatus = false;
    await installMainFixture(page, liveStatus, () => failStatus);
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('./', { waitUntil: 'networkidle' });

    const status = page.locator('.front-status');
    await expect(status).toContainText(marker);
    await expect(page.locator('.online-users')).toContainText('현황검증장수');
    await expect(page.locator('.survey-notice')).toContainText('새로운 설문조사가 있습니다.');
    const desktop = await status.evaluate((element) => {
        const style = getComputedStyle(element);
        const onlineRow = element.querySelector<HTMLElement>('.online-nations');
        const voteRow = element.querySelector<HTMLElement>('.vote-status');
        if (!onlineRow || !voteRow) throw new Error('status row missing');
        return {
            rect: element.getBoundingClientRect().toJSON(),
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            backgroundImage: style.backgroundImage,
            onlineRow: {
                rect: onlineRow.getBoundingClientRect().toJSON(),
                borderTop: getComputedStyle(onlineRow).borderTop,
                padding: getComputedStyle(onlineRow).padding,
            },
            voteRow: voteRow.getBoundingClientRect().toJSON(),
        };
    });
    expect(desktop.rect).toMatchObject({ x: 0, width: 1000 });
    expect(desktop).toMatchObject({
        fontSize: '14px',
        lineHeight: '21px',
        onlineRow: {
            borderTop: '1px solid rgb(128, 128, 128)',
            padding: '7px',
        },
    });
    expect(desktop.onlineRow.rect.height).toBeCloseTo(36, 0);
    expect(desktop.voteRow.x).toBeCloseTo(666.67, 0);
    expect(desktop.voteRow.width).toBeCloseTo(333.33, 0);
    expect(desktop.voteRow.height).toBeCloseTo(36, 0);
    expect(desktop.backgroundImage).toContain('/image/game/back_walnut.jpg');

    await page.setViewportSize({ width: 500, height: 900 });
    await expect(status).toHaveCSS('width', '500px');
    await expect(page.locator('.vote-status')).toHaveCSS('width', '250px');

    failStatus = true;
    await page.getByRole('button', { name: '새로고침', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '상단 현황을 불러오지 못했습니다.' })).toBeVisible();
    await expect(status).toContainText(marker);

    failStatus = false;
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('.front-status')).toContainText(marker);
    await expect(page.locator('.survey-notice')).toHaveCount(0);
});
