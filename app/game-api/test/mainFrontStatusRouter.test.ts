import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';

import type { DatabaseClient, GameApiContext } from '../src/context.js';
import { appRouter } from '../src/router.js';

const auth: GameSessionTokenPayload = {
    version: 1,
    profile: 'che:default',
    issuedAt: '2026-07-26T00:00:00.000Z',
    expiresAt: '2026-07-27T00:00:00.000Z',
    sessionId: 'front-status-owner',
    user: {
        id: 'owner',
        username: 'owner',
        displayName: 'Owner',
        roles: [],
    },
    sanctions: {},
};

const buildContext = (
    options: { auth?: GameSessionTokenPayload | null; hasVoted?: boolean; preopenClock?: boolean } = {}
) =>
    ({
        auth: options.auth === undefined ? auth : options.auth,
        db: {
            general: {
                findFirst: vi.fn(async () => ({
                    id: 7,
                    userId: 'owner',
                    nationId: 2,
                })),
                findMany: vi.fn(async () => [
                    { id: 7, name: '유비', nationId: 2 },
                    { id: 8, name: '관우', nationId: 2 },
                    { id: 9, name: '조조', nationId: 3 },
                    { id: 10, name: '재야장수', nationId: 0 },
                ]),
            },
            worldState: {
                findFirst: vi.fn(async () => ({
                    tickSeconds: 3600,
                    ...(options.preopenClock
                        ? {
                              clockBaseTime: new Date('2026-08-27T16:00:00.000Z'),
                              clockTick: -180_000_000n,
                              clockMode: 'realtime',
                              clockWallAnchor: new Date('2026-08-27T11:00:00.000Z'),
                          }
                        : {}),
                    meta: {
                        serverId: 'che_260819_front',
                        lastTurnTime: '2026-07-26T10:00:00.000Z',
                    },
                })),
            },
            generalAccessLog: {
                findMany: vi.fn(async () => [{ generalId: 7 }, { generalId: 8 }, { generalId: 9 }, { generalId: 10 }]),
            },
            nation: {
                findUnique: vi.fn(async () => ({
                    meta: {
                        notice: '<p>북벌 준비</p>',
                    },
                })),
                findMany: vi.fn(async () => [
                    { id: 2, name: '촉' },
                    { id: 3, name: '위' },
                ]),
            },
            votePoll: {
                findMany: vi.fn(async () => [
                    {
                        id: 12,
                        title: '다음 시즌 턴 시간',
                        startAt: new Date(
                            options.preopenClock ? '2026-08-27T11:00:00.000Z' : '2026-07-26T10:00:00.000Z'
                        ),
                        startTick: options.preopenClock ? -180_000_000n : null,
                        endAt: null,
                        endTick: null,
                        closedAt: null,
                    },
                ]),
            },
            vote: {
                findFirst: vi.fn(async () => (options.hasVoted ? { id: 21 } : null)),
            },
        } as unknown as DatabaseClient,
    }) as GameApiContext;

describe('general.getFrontStatus', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-26T10:30:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns action-based current-turn online data without listing the free nation', async () => {
        const context = buildContext();
        const caller = appRouter.createCaller(context);

        const result = await caller.general.getFrontStatus();

        expect(result).toEqual({
            serverId: 'che_260819_front',
            onlineUserCount: 4,
            onlineNations: '【촉】, 【위】',
            onlineGenerals: '유비, 관우',
            nationNotice: '<p>북벌 준비</p>',
            lastExecuted: '2026-07-26T10:00:00.000Z',
            latestVote: {
                id: 12,
                title: '다음 시즌 턴 시간',
                hasVoted: false,
            },
        });
        expect(context.db.generalAccessLog.findMany).toHaveBeenCalledWith({
            where: {
                lastActionAt: {
                    gte: new Date('2026-07-26T10:00:00.000Z'),
                },
            },
            select: { generalId: true },
        });
    });

    it('reports that the session-owned general already voted', async () => {
        const caller = appRouter.createCaller(buildContext({ hasVoted: true }));

        await expect(caller.general.getFrontStatus()).resolves.toMatchObject({
            latestVote: {
                id: 12,
                hasVoted: true,
            },
        });
    });

    it('keeps a PREOPEN logical-time survey active after the authenticated general voted', async () => {
        vi.setSystemTime(new Date('2026-08-27T05:56:00.000Z'));
        const context = buildContext({ hasVoted: true, preopenClock: true });

        await expect(appRouter.createCaller(context).general.getFrontStatus()).resolves.toMatchObject({
            latestVote: {
                id: 12,
                title: '다음 시즌 턴 시간',
                hasVoted: true,
            },
        });
        expect(context.db.votePoll.findMany).toHaveBeenCalledWith({
            where: { closedAt: null },
            orderBy: { id: 'desc' },
            select: {
                id: true,
                title: true,
                startAt: true,
                startTick: true,
                endAt: true,
                endTick: true,
                closedAt: true,
            },
        });
    });

    it('requires a game session and does not expose names or policy publicly', async () => {
        const caller = appRouter.createCaller(buildContext({ auth: null }));

        await expect(caller.general.getFrontStatus()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });
});
