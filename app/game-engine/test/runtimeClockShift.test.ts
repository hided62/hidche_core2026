import { describe, expect, it, vi } from 'vitest';

import type { GamePrismaClient } from '@sammo-ts/infra';
import { GAME_TICKS_PER_TURN } from '@sammo-ts/common';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { applyRuntimeClockShift } from '../src/turn/runtimeClockShift.js';
import { applyRuntimeGameSettings } from '../src/turn/runtimeGameSettings.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const buildGeneral = (id: number, turnTime: string): TurnGeneral =>
    ({
        id,
        name: `General_${id}`,
        nationId: 1,
        cityId: 1,
        troopId: 0,
        stats: { leadership: 50, strength: 50, intelligence: 50 },
        turnTime: new Date(turnTime),
        role: {
            items: { horse: null, weapon: null, book: null, item: null },
            personality: null,
            specialDomestic: null,
            specialWar: null,
        },
        triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
        meta: { killturn: 24 },
        officerLevel: 5,
        experience: 0,
        dedication: 0,
        injury: 0,
        gold: 1000,
        rice: 1000,
        crew: 0,
        crewTypeId: 0,
        train: 0,
        atmos: 0,
        age: 30,
        npcState: 0,
    }) as TurnGeneral;

const buildWorld = (stateOverride: Partial<TurnWorldState> = {}): InMemoryTurnWorld => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 190,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('2026-07-30T10:00:00.000Z'),
        meta: {
            lastTurnTime: '2026-07-30T10:00:00.000Z',
            turntime: '2026-07-30 10:00:00.123456',
            starttime: '2026-07-01 00:00:00',
            tnmt_time: '2026-07-30 11:30:00',
            untouched: 'keep',
        },
        ...stateOverride,
    };
    const snapshot: TurnWorldSnapshot = {
        generals: [buildGeneral(1, '2026-07-30T10:10:00.000Z'), buildGeneral(2, '2026-07-30T10:20:00.000Z')],
        cities: [],
        nations: [],
        troops: [],
        diplomacy: [],
        events: [],
        initialEvents: [],
        map: {
            id: 'test',
            name: 'test',
            cities: [],
            defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
        },
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: {},
            environment: { mapName: 'test', unitSet: 'default' },
        },
    };
    return new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
    });
};

describe('runtime clock shift', () => {
    it('preserves the scenario config when the raw world config is unavailable', () => {
        const world = buildWorld();

        expect(world.getWorldConfig()).toMatchObject({
            stat: { total: 300 },
            iconPath: '',
            map: {},
            const: {},
            environment: { mapName: 'test', unitSet: 'default' },
        });
    });

    it.each([
        ['accelerates', -15, '2026-07-30T09:45:00.000Z', '2026-07-30T09:55:00.000Z'],
        ['delays', 15, '2026-07-30T10:15:00.000Z', '2026-07-30T10:25:00.000Z'],
    ] as const)('%s the world, every general, checkpoint, and pending auction together', (_, delta, last, general) => {
        const world = buildWorld();
        world.setCheckpoint({ turnTime: '2026-07-30T10:10:00.000Z', generalId: 1, year: 190, month: 1 });
        world.queueNeutralAuction({
            registrationKey: 'test',
            type: 'BUY_RICE',
            targetCode: 'rice',
            hostGeneralId: 0,
            hostName: '상인',
            detail: {},
            closeAt: new Date('2026-07-30T12:00:00.000Z'),
        });

        const result = world.shiftSchedule(delta);

        expect(result).toEqual({ shiftedGenerals: 2, lastTurnTime: last });
        expect(world.getState()).toMatchObject({
            currentYear: 190,
            currentMonth: 1,
            lastTurnTime: new Date(last),
            meta: {
                lastTurnTime: last,
                untouched: 'keep',
            },
        });
        expect(world.getGeneralById(1)?.turnTime.toISOString()).toBe(general);
        expect(world.getCheckpoint()?.turnTime).toBe(general);
        const pendingCloseAt = world.peekDirtyState().pendingNeutralAuctions[0]?.closeAt;
        expect(pendingCloseAt?.toISOString()).toBe(
            new Date(new Date('2026-07-30T12:00:00.000Z').getTime() + delta * 60_000).toISOString()
        );
        expect(world.peekDirtyState().generals.map((entry) => entry.id)).toEqual([1, 2]);
    });

    it.each([0, 1.5, Number.NaN])('rejects an invalid shift without mutation: %s', (delta) => {
        const world = buildWorld();
        expect(() => world.shiftSchedule(delta)).toThrow();
        expect(world.getState().lastTurnTime.toISOString()).toBe('2026-07-30T10:00:00.000Z');
        expect(world.peekDirtyState().generals).toEqual([]);
    });

    it('keeps legacy wall-clock metadata independent from the process timezone', () => {
        const world = buildWorld();

        world.shiftSchedule(-15);

        expect(world.getState().meta).toMatchObject({
            turntime: '2026-07-30 09:45:00.123456',
            starttime: '2026-06-30 23:45:00',
            tnmt_time: '2026-07-30 11:15:00',
        });
    });

    it('rebases after two years of downtime without catching up missed turns', () => {
        const wallAnchor = new Date('2026-07-30T10:00:00.000Z');
        const resumedAt = new Date('2028-07-29T10:00:00.000Z');
        const deltaMinutes = 2 * 365 * 24 * 60;
        const world = buildWorld({
            clockBaseTime: wallAnchor,
            clockTick: 0,
            clockMode: 'realtime',
            clockWallAnchor: wallAnchor,
            lastTurnTick: 0,
        });

        const beforeTurnTick = world.getGeneralById(1)?.turnTick;
        world.shiftSchedule(deltaMinutes, resumedAt);

        expect(world.getGameNow(resumedAt).toISOString()).toBe('2028-07-29T10:00:00.000Z');
        expect(world.getGameNow(new Date(resumedAt.getTime() + 10 * 60_000)).toISOString()).toBe(
            '2028-07-29T10:10:00.000Z'
        );
        expect(world.getGeneralById(1)?.turnTick).toBe(beforeTurnTick);
        expect(world.getGameClockState().wallAnchor).toEqual(resumedAt);
    });

    it('keeps runnable general scheduling at the future opening anchor during PREOPEN', () => {
        const gameBase = new Date('2026-07-30T10:00:00.000Z');
        const openAt = new Date('2026-09-02T23:30:00.000Z');
        const world = buildWorld({
            clockBaseTime: gameBase,
            clockTick: 0,
            clockMode: 'realtime',
            clockWallAnchor: openAt,
            lastTurnTick: 0,
        });
        const preopenAt = new Date('2026-09-02T23:03:00.000Z');

        expect(world.getGameNow(preopenAt).getTime()).toBeLessThan(gameBase.getTime());
        expect(world.getRunnableGameNow(preopenAt)).toEqual(gameBase);
        expect(world.getRunnableGameNow(openAt)).toEqual(gameBase);
        expect(world.getRunnableGameNow(new Date(openAt.getTime() + 60_000))).toEqual(
            new Date(gameBase.getTime() + 60_000)
        );
    });

    it.each([
        [5, 6],
        [10, 3],
        [20, 1],
    ])('uses the Ref catch-up threshold for a %i-minute turn', (turnMinutes, threshold) => {
        const wallAnchor = new Date('2026-07-30T10:00:00.000Z');
        const world = buildWorld({
            tickSeconds: turnMinutes * 60,
            clockBaseTime: wallAnchor,
            clockTick: 0,
            clockMode: 'realtime',
            clockWallAnchor: wallAnchor,
            lastTurnTick: 0,
            lastTurnTime: wallAnchor,
        });

        expect(
            world.shouldRebaseRealtimeBacklog(new Date(wallAnchor.getTime() + threshold * turnMinutes * 60_000))
        ).toBe(false);
        expect(
            world.shouldRebaseRealtimeBacklog(new Date(wallAnchor.getTime() + (threshold + 1) * turnMinutes * 60_000))
        ).toBe(true);
    });

    it('skips a long realtime backlog while preserving the turn phase and wall-clock display', () => {
        const wallAnchor = new Date('2026-07-30T10:00:00.000Z');
        const resumedAt = new Date('2026-07-30T10:35:00.000Z');
        const world = buildWorld({
            tickSeconds: 300,
            clockBaseTime: wallAnchor,
            clockTick: 0,
            clockMode: 'realtime',
            clockWallAnchor: wallAnchor,
            lastTurnTick: 0,
            lastTurnTime: wallAnchor,
        });
        world.setCheckpoint({
            turnTime: '2026-07-30T10:10:00.000Z',
            turnTick: 2 * GAME_TICKS_PER_TURN,
            generalId: 1,
            year: 190,
            month: 1,
        });

        const result = world.rebaseRealtimeBacklog(resumedAt);

        expect(result).toMatchObject({
            skippedTurns: 7,
            shiftedTicks: 7 * GAME_TICKS_PER_TURN,
            lastTurnTime: resumedAt.toISOString(),
        });
        expect(world.getGameNow(resumedAt)).toEqual(resumedAt);
        expect(world.getState()).toMatchObject({
            clockTick: 7 * GAME_TICKS_PER_TURN,
            clockWallAnchor: resumedAt,
            lastTurnTick: 7 * GAME_TICKS_PER_TURN,
            meta: {
                turntime: '2026-07-30 10:35:00.123456',
                starttime: '2026-07-01 00:35:00',
            },
        });
        expect(world.getGeneralById(1)).toMatchObject({
            turnTick: 9 * GAME_TICKS_PER_TURN,
            turnTime: new Date('2026-07-30T10:45:00.000Z'),
        });
        expect(world.getCheckpoint()).toMatchObject({
            turnTick: 9 * GAME_TICKS_PER_TURN,
            turnTime: '2026-07-30T10:45:00.000Z',
        });
        expect(world.peekDirtyState()).toMatchObject({
            realtimeBacklogShiftTicks: 7 * GAME_TICKS_PER_TURN,
            generals: [],
        });
    });

    it('repairs an already accumulated realtime projection lag during a long rebase', () => {
        const base = new Date('2026-07-30T10:00:00.000Z');
        const staleAnchor = new Date('2026-07-30T11:00:00.000Z');
        const resumedAt = new Date('2026-07-30T11:50:00.000Z');
        const world = buildWorld({
            tickSeconds: 300,
            clockBaseTime: base,
            clockTick: 5 * GAME_TICKS_PER_TURN,
            clockMode: 'realtime',
            clockWallAnchor: staleAnchor,
            lastTurnTick: 0,
            lastTurnTime: base,
        });

        expect(world.getGameNow(resumedAt).toISOString()).toBe('2026-07-30T11:15:00.000Z');
        expect(world.rebaseRealtimeBacklog(resumedAt)).toMatchObject({ skippedTurns: 22 });
        expect(world.getGameNow(resumedAt)).toEqual(resumedAt);
    });

    it('does not lose realtime elapsed time when an overdue target is committed later', () => {
        const base = new Date('2026-07-30T10:00:00.000Z');
        const world = buildWorld({
            tickSeconds: 300,
            clockBaseTime: base,
            clockTick: 0,
            clockMode: 'realtime',
            clockWallAnchor: base,
            lastTurnTick: 0,
            lastTurnTime: base,
        });
        const completedAt = new Date('2026-07-30T10:07:00.000Z');

        world.advanceGameClockTo(new Date('2026-07-30T10:05:00.000Z'), completedAt);

        expect(world.getGameNow(completedAt)).toEqual(completedAt);
        expect(world.getGameClockState().tick).toBe(50_400_000);
    });
});

describe('runtime turn term change', () => {
    it('preserves the current game display while reprojecting tick-owned dates', () => {
        const wallAnchor = new Date('2026-07-30T10:00:00.000Z');
        const changedAt = new Date('2026-07-30T10:05:00.000Z');
        const world = buildWorld({
            clockBaseTime: wallAnchor,
            clockTick: 0,
            clockMode: 'realtime',
            clockWallAnchor: wallAnchor,
            lastTurnTick: 0,
        });
        world.setCheckpoint({
            turnTime: '2026-07-30T10:10:00.000Z',
            turnTick: 36_000_000,
            generalId: 1,
            year: 190,
            month: 1,
        });

        const before = world.getGameNow(changedAt);
        const result = world.changeTurnTerm(20, changedAt);

        expect(result).toMatchObject({
            changed: true,
            previousTurnTermMinutes: 10,
            turnTermMinutes: 20,
            previousClockBaseTime: '2026-07-30T10:00:00.000Z',
            clockBaseTime: '2026-07-30T09:55:00.000Z',
            lastTurnTime: '2026-07-30T09:55:00.000Z',
            shiftedGenerals: 2,
        });
        expect(world.getGameNow(changedAt)).toEqual(before);
        expect(world.getGeneralById(1)?.turnTime.toISOString()).toBe('2026-07-30T10:15:00.000Z');
        expect(world.getGeneralById(1)?.turnTick).toBe(36_000_000);
        expect(world.getCheckpoint()?.turnTime).toBe('2026-07-30T10:15:00.000Z');
        expect(world.getState()).toMatchObject({
            tickSeconds: 1200,
            clockTick: 18_000_000,
            lastTurnTick: 0,
        });
        expect(world.getWorldConfig()).toMatchObject({ turnTermMinutes: 20 });
    });

    it('updates all three live settings and only emits a new history log', async () => {
        const changedAt = new Date('2026-07-30T10:05:00.000Z');
        const world = buildWorld({
            clockBaseTime: new Date('2026-07-30T10:00:00.000Z'),
            clockTick: 0,
            clockMode: 'realtime',
            clockWallAnchor: new Date('2026-07-30T10:00:00.000Z'),
            lastTurnTick: 0,
        });
        const executeRaw = vi.fn(async () => 1);
        const db = {
            inputEvent: {
                findUnique: vi.fn(async () => ({
                    createdAt: changedAt,
                    target: 'ENGINE',
                    eventType: 'updateRuntimeSettings',
                })),
            },
            $executeRaw: executeRaw,
        } as unknown as GamePrismaClient;
        const handler = createTurnDaemonCommandHandler({ world });

        const result = await handler.handle(
            {
                type: 'updateRuntimeSettings',
                requestId: 'runtime-settings:test',
                actionId: 'action-test',
                settings: {
                    turnTermMinutes: 20,
                    blockGeneralCreate: 2,
                    autorunUser: { limitMinutes: 720, options: ['develop', 'recruit_high', 'chief'] },
                },
            },
            { db }
        );

        expect(result).toMatchObject({
            type: 'updateRuntimeSettings',
            ok: true,
            termChanged: true,
            reprojectedAuctions: 1,
            reprojectedMessages: 1,
            reprojectedVotes: 1,
        });
        expect(executeRaw).toHaveBeenCalledTimes(3);
        expect(world.getWorldConfig()).toMatchObject({ turnTermMinutes: 20, blockGeneralCreate: 2 });
        expect(world.getState().meta).toMatchObject({
            autorun_user: {
                limit_minutes: 720,
                options: { develop: true, recruit_high: true, chief: true },
            },
        });
        expect(world.peekDirtyState().logs).toEqual([
            expect.objectContaining({ text: '<R>★</>턴시간이 <C>20분</>으로 변경됩니다.' }),
        ]);
    });
});

describe('runtime clock shift projection', () => {
    it('waits for the durable engine event and applies Redis projections idempotently', async () => {
        const actionId = '68f1f0e4-3b95-4aeb-9925-c7e93caf1ba7';
        let eventStatus: 'PENDING' | 'SUCCEEDED' = 'PENDING';
        let created = false;
        const inputEventCreate = vi.fn(async () => {
            if (created) {
                throw { code: 'P2002' };
            }
            created = true;
            return {};
        });
        const db = {
            inputEvent: {
                create: inputEventCreate,
                findUniqueOrThrow: vi.fn(async () =>
                    eventStatus === 'PENDING'
                        ? {
                              eventType: 'shiftSchedule',
                              payload: {
                                  type: 'shiftSchedule',
                                  actionId,
                                  deltaMinutes: -15,
                              },
                              status: 'PENDING',
                              result: null,
                              error: null,
                          }
                        : {
                              eventType: 'shiftSchedule',
                              payload: {
                                  type: 'shiftSchedule',
                                  actionId,
                                  deltaMinutes: -15,
                              },
                              status: 'SUCCEEDED',
                              result: {
                                  type: 'shiftSchedule',
                                  ok: true,
                                  actionId,
                                  deltaMinutes: -15,
                                  lastTurnTime: '2026-07-30T09:45:00.000Z',
                                  shiftedGenerals: 2,
                                  shiftedAuctions: 1,
                              },
                              error: null,
                          }
                ),
            },
            auction: {
                findMany: vi.fn(async () => [
                    { id: 7, closeAt: new Date('2026-07-30T11:45:00.000Z'), closeTick: null },
                ]),
            },
        } as unknown as GamePrismaClient;
        const values = new Map<string, string>([
            [
                'sammo:hwe:default:tournament:state',
                JSON.stringify({
                    stage: 1,
                    nextAt: '2026-07-30T12:00:00.000Z',
                    bettingCloseAt: '2026-07-30T11:30:00.000Z',
                }),
            ],
        ]);
        const zAdd = vi.fn(async () => 1);
        const redis = {
            get: async (key: string) => values.get(key) ?? null,
            set: async (
                key: string,
                value: string,
                options?: {
                    NX?: boolean;
                    PX?: number;
                }
            ) => {
                if (options?.NX && values.has(key)) {
                    return null;
                }
                values.set(key, value);
                return 'OK';
            },
            del: async (key: string) => (values.delete(key) ? 1 : 0),
            zAdd,
            eval: async (_script: string, options: { keys: string[]; arguments: string[] }) => {
                const revisionKey = options.keys.at(-1)!;
                options.arguments.forEach((value, index) => values.set(options.keys[index]!, value));
                const revision = Number(values.get(revisionKey) ?? '0') + 1;
                values.set(revisionKey, String(revision));
                return String(revision);
            },
        };
        const action = {
            id: actionId,
            profileName: 'hwe:default',
            action: 'ACCELERATE',
            durationMinutes: 15,
        };

        await expect(applyRuntimeClockShift({ action, profileName: 'hwe:default', db, redis })).resolves.toMatchObject({
            status: 'REQUESTED',
        });
        expect(zAdd).not.toHaveBeenCalled();

        eventStatus = 'SUCCEEDED';
        await expect(applyRuntimeClockShift({ action, profileName: 'hwe:default', db, redis })).resolves.toMatchObject({
            status: 'APPLIED',
        });
        await expect(applyRuntimeClockShift({ action, profileName: 'hwe:default', db, redis })).resolves.toMatchObject({
            status: 'APPLIED',
        });

        const tournament = JSON.parse(values.get('sammo:hwe:default:tournament:state') ?? '{}') as Record<
            string,
            unknown
        >;
        expect(tournament).toMatchObject({
            nextAt: '2026-07-30T11:45:00.000Z',
            bettingCloseAt: '2026-07-30T11:15:00.000Z',
            runtimeClockShiftActionIds: [actionId],
        });
        expect(zAdd).toHaveBeenCalledTimes(2);
        expect(inputEventCreate).toHaveBeenCalledTimes(3);
    });
});

describe('runtime game settings projection', () => {
    it('waits for the engine result and reprojects tournament tick dates idempotently', async () => {
        const actionId = '98f1f0e4-3b95-4aeb-9925-c7e93caf1ba7';
        let eventStatus: 'PENDING' | 'SUCCEEDED' = 'PENDING';
        let created = false;
        const db = {
            inputEvent: {
                create: vi.fn(async () => {
                    if (created) throw { code: 'P2002' };
                    created = true;
                    return {};
                }),
                findUniqueOrThrow: vi.fn(async () =>
                    eventStatus === 'PENDING'
                        ? {
                              eventType: 'updateRuntimeSettings',
                              payload: {
                                  type: 'updateRuntimeSettings',
                                  actionId,
                                  settings: {
                                      turnTermMinutes: 20,
                                      blockGeneralCreate: 2,
                                      autorunUser: { limitMinutes: 720, options: ['develop', 'chief'] },
                                  },
                              },
                              status: 'PENDING',
                              result: null,
                              error: null,
                          }
                        : {
                              eventType: 'updateRuntimeSettings',
                              payload: {
                                  type: 'updateRuntimeSettings',
                                  actionId,
                                  settings: {
                                      turnTermMinutes: 20,
                                      blockGeneralCreate: 2,
                                      autorunUser: { limitMinutes: 720, options: ['develop', 'chief'] },
                                  },
                              },
                              status: 'SUCCEEDED',
                              result: {
                                  type: 'updateRuntimeSettings',
                                  ok: true,
                                  actionId,
                                  settings: {
                                      turnTermMinutes: 20,
                                      blockGeneralCreate: 2,
                                      autorunUser: { limitMinutes: 720, options: ['develop', 'chief'] },
                                  },
                                  termChanged: true,
                                  previousTurnTermMinutes: 10,
                                  turnTermMinutes: 20,
                                  previousClockBaseTime: '2026-07-30T10:00:00.000Z',
                                  clockBaseTime: '2026-07-30T09:55:00.000Z',
                                  lastTurnTime: '2026-07-30T09:55:00.000Z',
                                  shiftedGenerals: 2,
                                  reprojectedAuctions: 1,
                                  reprojectedMessages: 1,
                                  reprojectedVotes: 1,
                              },
                              error: null,
                          }
                ),
            },
        } as unknown as GamePrismaClient;
        const stateKey = 'sammo:hwe:default:tournament:state';
        const values = new Map<string, string>([
            [
                stateKey,
                JSON.stringify({
                    stage: 1,
                    nextAt: '2026-07-30T10:10:00.000Z',
                    bettingCloseAt: '2026-07-30T10:05:00.000Z',
                }),
            ],
        ]);
        const redis = {
            get: async (key: string) => values.get(key) ?? null,
            set: async (key: string, value: string, options?: { NX?: boolean }) => {
                if (options?.NX && values.has(key)) return null;
                values.set(key, value);
                return 'OK';
            },
            del: async (key: string) => (values.delete(key) ? 1 : 0),
            eval: async (_script: string, options: { keys: string[]; arguments: string[] }) => {
                options.arguments.forEach((value, index) => values.set(options.keys[index]!, value));
                return '1';
            },
        };
        const action = {
            id: actionId,
            profileName: 'hwe:default',
            action: 'UPDATE_RUNTIME_SETTINGS',
            durationMinutes: null,
            payload: {
                settings: {
                    turnTermMinutes: 20,
                    blockGeneralCreate: 2,
                    autorunUser: { limitMinutes: 720, options: ['develop', 'chief'] },
                },
            },
        };

        await expect(
            applyRuntimeGameSettings({ action, profileName: 'hwe:default', db, redis })
        ).resolves.toMatchObject({ status: 'REQUESTED' });
        eventStatus = 'SUCCEEDED';
        await expect(
            applyRuntimeGameSettings({ action, profileName: 'hwe:default', db, redis })
        ).resolves.toMatchObject({ status: 'APPLIED' });
        await expect(
            applyRuntimeGameSettings({ action, profileName: 'hwe:default', db, redis })
        ).resolves.toMatchObject({ status: 'APPLIED' });

        expect(JSON.parse(values.get(stateKey) ?? '{}')).toMatchObject({
            nextAt: '2026-07-30T10:15:00.000Z',
            bettingCloseAt: '2026-07-30T10:05:00.000Z',
            runtimeSettingsActionIds: [actionId],
        });
    });
});
