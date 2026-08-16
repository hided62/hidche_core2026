import { describe, expect, it, vi } from 'vitest';

import type { GamePrismaClient } from '@sammo-ts/infra';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { applyRuntimeClockShift } from '../src/turn/runtimeClockShift.js';
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
