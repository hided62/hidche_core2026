import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseClient, GameApiContext } from '../src/context.js';
import { appRouter } from '../src/router.js';

const buildContext = (
    meta: Record<string, unknown>,
    clock: {
        baseTime?: Date;
        tick?: bigint;
        mode?: string;
        wallAnchor?: Date;
    } = {},
    config: Record<string, unknown> = {}
): GameApiContext =>
    ({
        auth: null,
        profile: { id: 'che', scenario: 'default', name: 'che:default' },
        db: {
            worldState: {
                findFirst: vi.fn(async () => ({
                    id: 1,
                    scenarioCode: 'default',
                    currentYear: 200,
                    currentMonth: 1,
                    tickSeconds: 3_600,
                    config,
                    meta,
                    clockBaseTime: clock.baseTime ?? null,
                    clockTick: clock.tick ?? null,
                    clockMode: clock.mode ?? 'realtime',
                    clockWallAnchor: clock.wallAnchor ?? null,
                    updatedAt: new Date('2026-07-31T00:00:00.000Z'),
                })),
            },
            general: {
                count: vi.fn(async () => 0),
            },
            nation: {
                count: vi.fn(async () => 0),
            },
            turnDaemonLease: {
                findUnique: vi.fn(async () => ({ leaseUntil: new Date('2099-01-01T00:00:00.000Z') })),
            },
        } as unknown as DatabaseClient,
        profileStatusSource: { get: vi.fn(async () => 'RUNNING' as const) },
    }) as unknown as GameApiContext;

describe('lobby season state', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([0, 1, 2, 3])('returns legacy isunited state %i', async (isunited) => {
        const result = await appRouter
            .createCaller(buildContext({ isUnited: isunited === 0 ? 2 : 0, isunited }))
            .lobby.info();

        expect(result.isUnited).toBe(isunited);
    });

    it('returns the projected server game time and whether the clock is running', async () => {
        const result = await appRouter
            .createCaller(
                buildContext(
                    {},
                    {
                        baseTime: new Date('2026-08-15T00:00:00.000Z'),
                        tick: 72_000_000n,
                        mode: 'manual',
                        wallAnchor: new Date('2026-08-15T17:00:00.000Z'),
                    }
                )
            )
            .lobby.info();

        expect(result.serverTime).toBe('2026-08-15T02:00:00.000Z');
        expect(result.clockMode).toBe('manual');
        expect(result.clockRunning).toBe(false);
        expect(result.clockStartsAt).toBeNull();
        expect(result.turnEngineRunning).toBe(true);
        expect(new Date(result.serverWallTime).getTime()).not.toBeNaN();
    });

    it('projects the explicit Gateway turn-running capability independently of the game clock mode', async () => {
        const context = buildContext(
            {},
            {
                baseTime: new Date('2026-08-15T00:00:00.000Z'),
                tick: 72_000_000n,
                mode: 'realtime',
                wallAnchor: new Date('2026-08-15T00:00:00.000Z'),
            }
        );
        context.profileStatusSource = { get: vi.fn(async () => 'PAUSED' as const) };

        const result = await appRouter.createCaller(context).lobby.info();

        expect(result.clockRunning).toBe(true);
        expect(result.turnEngineRunning).toBe(false);
    });

    it('exposes the future realtime wall anchor with a negative preopen tick', async () => {
        const wallAnchor = new Date('2099-08-21T11:00:00.000Z');
        const wallNow = new Date('2099-08-21T10:30:00.000Z');
        vi.useFakeTimers();
        vi.setSystemTime(wallNow);
        const result = await appRouter
            .createCaller(
                buildContext(
                    {},
                    {
                        baseTime: wallAnchor,
                        tick: 0n,
                        mode: 'realtime',
                        wallAnchor,
                    }
                )
            )
            .lobby.info();

        expect(result.serverTime).toBe(wallNow.toISOString());
        expect(result.clockMode).toBe('realtime');
        expect(result.clockRunning).toBe(false);
        expect(result.clockStartsAt).toBe(wallAnchor.toISOString());
        expect(new Date(result.serverWallTime).getTime()).toBeLessThan(wallAnchor.getTime());
    });

    it('reports direct creation and possession as independent acquisition modes', async () => {
        const result = await appRouter
            .createCaller(buildContext({}, {}, { blockGeneralCreate: 1, npcMode: 1 }))
            .lobby.info();

        expect(result.directGeneralCreationEnabled).toBe(false);
        expect(result.npcPossessionEnabled).toBe(true);
    });

    it('preserves zero as the first official game index', async () => {
        const result = await appRouter.createCaller(buildContext({ gameIdx: 0 })).lobby.info();

        expect(result.gameIdx).toBe(0);
    });

    it('projects the Ref-compatible opening announcement settings without exposing disabled autorun options', async () => {
        const result = await appRouter
            .createCaller(
                buildContext(
                    {
                        serverId: 'che_260819_season',
                        gameIdx: 101,
                        preopenAt: '2026-08-19 22:00:00',
                        opentime: '2026-08-19 23:00:00',
                        scenarioMeta: { title: '【가상모드27-b】 아시아 명장전(비급)' },
                        autorun_user: {
                            limit_minutes: 1_440,
                            options: {
                                develop: true,
                                warp: true,
                                recruit: false,
                                recruit_high: true,
                                train: true,
                                battle: true,
                                chief: true,
                            },
                        },
                    },
                    {},
                    {
                        fictionMode: '가상',
                        npcMode: 0,
                        stat: { total: 310, min: 10, max: 110 },
                    }
                )
            )
            .lobby.info();

        expect(result).toMatchObject({
            serverId: 'che_260819_season',
            profile: 'che',
            gameIdx: 101,
            preopenAt: '2026-08-19 22:00:00',
            opentime: '2026-08-19 23:00:00',
            scenarioTitle: '【가상모드27-b】 아시아 명장전(비급)',
            npcMode: 0,
            defaultStatTotal: 310,
            autorunUser: {
                limitMinutes: 1_440,
                options: ['develop', 'warp', 'recruit_high', 'train', 'battle', 'chief'],
            },
        });
    });
});
