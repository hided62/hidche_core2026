import { describe, expect, it, vi } from 'vitest';
import type { RedisConnector } from '@sammo-ts/infra';
import type { Nation } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createTournamentAutoStartHandler } from '../src/turn/tournamentAutoStart.js';
import type { TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const buildNation = (id: number): Nation => ({
    id,
    name: `국가${id}`,
    color: '#777777',
    capitalCityId: null,
    chiefGeneralId: null,
    gold: 0,
    rice: 0,
    power: 0,
    level: 1,
    typeCode: 'che_중립',
    meta: {},
});

describe('monthly tournament auto start', () => {
    it('uses the legacy monthly RNG after nation power rolls and persists the remaining pattern', async () => {
        const state: TurnWorldState = {
            id: 1,
            currentYear: 193,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('0193-01-01T00:00:00.000Z'),
            meta: {
                hiddenSeed: 'monthly-post-tail-2',
                tournamentPattern: [0, 1, 2, 3],
            },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: 'test', unitSet: 'default' },
            },
            map: { id: 'test', name: 'test', cities: [] },
            diplomacy: [],
            events: [],
            initialEvents: [],
            generals: [],
            cities: [],
            nations: [buildNation(1), buildNation(2)],
            troops: [],
        };
        const values = new Map<string, string>();
        const redis = {
            get: async (key: string) => values.get(key) ?? null,
            set: async (key: string, value: string) => {
                values.set(key, value);
                return 'OK';
            },
        } as unknown as RedisConnector['client'];
        let world: InMemoryTurnWorld | null = null;
        const consumed: boolean[] = [];
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: createTournamentAutoStartHandler({
                profileName: 'test',
                getWorld: () => world,
                getRedisClient: () => redis,
                getWorldConfig: () => ({ tournamentTrig: true }),
                getNationPowerRollCount: () => 2,
                onTournamentRollConsumed: (value) => consumed.push(value),
                now: () => new Date('2026-07-25T00:00:00.000Z'),
            }),
        });

        await world.advanceMonth(new Date('0193-02-01T00:00:00.000Z'));

        expect(consumed).toEqual([false, true]);
        expect(JSON.parse(values.get('sammo:test:tournament:state') ?? '{}')).toMatchObject({
            stage: 1,
            phase: 0,
            type: 3,
            auto: true,
            openYear: 193,
            openMonth: 2,
            termSeconds: 10,
            nextAt: '2026-07-25T00:10:00.000Z',
        });
        expect(world.getState().meta.tournamentPattern).toEqual([0, 1, 2]);
        expect(world.peekDirtyState().logs).toEqual([
            expect.objectContaining({
                text: "<B><b>【대회】</b></><C>설전</> 대회가 개최됩니다! 천하의 <span class='ev_highlight'>책사</span>들을 모집하고 있습니다!",
            }),
        ]);
    });

    it('does not consume a tournament roll while a tournament is active', async () => {
        const state: TurnWorldState = {
            id: 1,
            currentYear: 193,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('0193-01-01T00:00:00.000Z'),
            meta: { hiddenSeed: 'active-tournament' },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: 'test', unitSet: 'default' },
            },
            map: { id: 'test', name: 'test', cities: [] },
            diplomacy: [],
            events: [],
            initialEvents: [],
            generals: [],
            cities: [],
            nations: [buildNation(1)],
            troops: [],
        };
        const redis = {
            get: async () => JSON.stringify({ stage: 1 }),
            set: async () => 'OK',
        } as unknown as RedisConnector['client'];
        let world: InMemoryTurnWorld | null = null;
        const consumed: boolean[] = [];
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: createTournamentAutoStartHandler({
                profileName: 'test',
                getWorld: () => world,
                getRedisClient: () => redis,
                getWorldConfig: () => ({ tournamentTrig: true }),
                getNationPowerRollCount: () => 1,
                onTournamentRollConsumed: (value) => consumed.push(value),
            }),
        });

        await world.advanceMonth(new Date('0193-02-01T00:00:00.000Z'));

        expect(consumed).toEqual([false]);
        expect(world.peekDirtyState().logs).toEqual([]);
    });

    it('derives an empty tournament pattern from the monthly seed without Math.random', async () => {
        const run = async () => {
            const state: TurnWorldState = {
                id: 1,
                currentYear: 193,
                currentMonth: 1,
                tickSeconds: 600,
                lastTurnTime: new Date('0193-01-01T00:00:00.000Z'),
                meta: { hiddenSeed: 'monthly-post-tail-2' },
            };
            const snapshot: TurnWorldSnapshot = {
                scenarioConfig: {
                    stat: {
                        total: 300,
                        min: 10,
                        max: 100,
                        npcTotal: 150,
                        npcMax: 50,
                        npcMin: 10,
                        chiefMin: 70,
                    },
                    iconPath: '',
                    map: {},
                    const: {},
                    environment: { mapName: 'test', unitSet: 'default' },
                },
                map: { id: 'test', name: 'test', cities: [] },
                diplomacy: [],
                events: [],
                initialEvents: [],
                generals: [],
                cities: [],
                nations: [buildNation(1), buildNation(2)],
                troops: [],
            };
            const values = new Map<string, string>();
            const redis = {
                get: async (key: string) => values.get(key) ?? null,
                set: async (key: string, value: string) => {
                    values.set(key, value);
                    return 'OK';
                },
            } as unknown as RedisConnector['client'];
            let world: InMemoryTurnWorld | null = null;
            world = new InMemoryTurnWorld(state, snapshot, {
                schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
                calendarHandler: createTournamentAutoStartHandler({
                    profileName: 'test',
                    getWorld: () => world,
                    getRedisClient: () => redis,
                    getWorldConfig: () => ({ tournamentTrig: true }),
                    getNationPowerRollCount: () => 2,
                    now: () => new Date('2026-07-25T00:00:00.000Z'),
                }),
            });

            await world.advanceMonth(new Date('0193-02-01T00:00:00.000Z'));

            return {
                tournamentState: JSON.parse(values.get('sammo:test:tournament:state') ?? '{}') as {
                    type?: number;
                },
                remainingPattern: world.getState().meta.tournamentPattern,
            };
        };

        const random = vi.spyOn(Math, 'random').mockImplementation(() => {
            throw new Error('tournament fallback must not use Math.random');
        });
        try {
            const first = await run();
            const second = await run();
            expect(second).toEqual(first);
            expect(first).toEqual({
                tournamentState: expect.objectContaining({ type: 0, bettingId: 1 }),
                remainingPattern: [1, 3, 2, 0],
            });
        } finally {
            random.mockRestore();
        }
    });
});
