import { describe, expect, it } from 'vitest';

import { LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import {
    ITEM_KEYS,
    buildVoteUniqueSeed,
    countOccupiedUniqueItems,
    createItemModuleRegistry,
    loadItemModules,
    resolveUniqueConfig,
    rollUniqueLottery,
} from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { normalizeTurnDaemonCommand } from '../src/turn/commandRegistry.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnDaemonCommandHandler, hasVotePollDeadlinePassed } from '../src/turn/worldCommandHandler.js';

const buildGeneral = (id: number): TurnGeneral => ({
    id,
    name: `General_${id}`,
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    turnTime: new Date('0180-01-01T00:00:00Z'),
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    officerLevel: 1,
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
});

describe('voteReward command', () => {
    it('keeps the wall-time fallback open at exact deadline equality', () => {
        const deadline = new Date('0180-01-01T00:00:00.000Z');

        expect(hasVotePollDeadlinePassed({ endAt: deadline, endTick: null, closedAt: null }, deadline, 0)).toBe(false);
        expect(
            hasVotePollDeadlinePassed(
                { endAt: deadline, endTick: null, closedAt: null },
                new Date(deadline.getTime() + 1),
                0
            )
        ).toBe(true);
    });

    it('preserves the server-accepted game tick through durable command normalization', () => {
        expect(
            normalizeTurnDaemonCommand({
                requestId: 'vote-accepted-tick',
                sentAt: '2026-08-23T00:00:00.000Z',
                command: {
                    type: 'voteReward',
                    voteId: 1,
                    generalId: 1,
                    selection: [0],
                    acceptedGameTick: 100,
                },
            })
        ).toMatchObject({
            type: 'voteReward',
            requestId: 'vote-accepted-tick',
            acceptedGameTick: 100,
        });
    });

    it('applies gold, unique item, logs, and idempotency', async () => {
        const generals = [buildGeneral(1)];
        const snapshot: TurnWorldSnapshot = {
            generals: generals as any,
            cities: [
                {
                    id: 1,
                    name: 'City_1',
                    nationId: 1,
                    viewName: 'City_1',
                    agriculture: 100,
                    agricultureMax: 2000,
                    commerce: 100,
                    commerceMax: 2000,
                    security: 100,
                    securityMax: 100,
                    def: 100,
                    defMax: 100,
                    wall: 100,
                    wallMax: 100,
                    pop: 10000,
                    popMax: 50000,
                    trust: 50,
                    supplyState: 1,
                    frontState: 0,
                    tradepoint: 0,
                    level: 1,
                    meta: {},
                },
            ] as any,
            nations: [
                {
                    id: 1,
                    name: 'TestNation',
                    color: '#FF0000',
                    capitalCityId: 1,
                    chiefGeneralId: 1,
                    gold: 10000,
                    rice: 10000,
                    power: 0,
                    level: 1,
                    typeCode: 'che_def',
                    meta: {},
                },
            ] as any,
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
            map: {
                id: 'test_map',
                name: 'TestMap',
                cities: [
                    {
                        id: 1,
                        name: 'City_1',
                        level: 1,
                        region: 1,
                        position: { x: 0, y: 0 },
                        connections: [],
                        max: {} as any,
                        initial: {} as any,
                    },
                ],
                defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
            } as any,
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {
                    develCost: 100,
                    allItems: {
                        weapon: {
                            che_무기_12_칠성검: 1,
                        },
                    },
                    maxUniqueItemLimit: [[-1, 1]],
                    uniqueTrialCoef: 10,
                    maxUniqueTrialProb: 10,
                    minMonthToAllowInheritItem: 0,
                },
                environment: { mapName: 'test_map', unitSet: 'default' },
            },
            scenarioMeta: {
                startYear: 180,
            } as any,
            unitSet: {} as any,
        };

        const state: TurnWorldState = {
            id: 1,
            currentYear: 180,
            currentMonth: 1,
            tickSeconds: 3600,
            lastTurnTime: new Date('0180-01-01T00:00:00Z'),
            clockBaseTime: new Date('0180-01-01T00:00:00Z'),
            clockTick: 10_000,
            clockMode: 'manual',
            clockWallAnchor: new Date('2026-08-23T00:00:00Z'),
            meta: {
                hiddenSeed: 'seed',
                scenarioId: 200,
                initYear: 180,
                initMonth: 1,
                scenarioMeta: { startYear: 180 },
                // Simulate ENGINE processing after the yearly develcost update.
                develcost: 120,
            },
        };

        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        });

        const itemRegistry = createItemModuleRegistry(await loadItemModules([...ITEM_KEYS]));
        const config = resolveUniqueConfig(snapshot.scenarioConfig.const as Record<string, unknown>);
        const occupied = countOccupiedUniqueItems(
            generals.map((general) => general.role.items),
            itemRegistry
        );
        const rng = new RandUtil(LiteHashDRBG.build(buildVoteUniqueSeed('seed', 1, 1)));
        const itemKey = rollUniqueLottery({
            rng,
            config,
            itemRegistry,
            generalItems: generals[0]!.role.items,
            occupiedUniqueCounts: occupied,
            scenarioId: 200,
            userCount: 1,
            currentYear: 180,
            currentMonth: 1,
            startYear: 180,
            initYear: 180,
            initMonth: 1,
            acquireType: '설문조사',
        });

        expect(itemKey).toBe('che_무기_12_칠성검');

        let voteInserted = false;
        let voteQueryCount = 0;
        let voteInsertQuery: { strings: readonly string[]; values: readonly unknown[] } | undefined;
        const commandDb = {
            auction: {
                findMany: async () => [],
            },
            $queryRaw: async (query: { strings: readonly string[]; values: readonly unknown[] }) => {
                voteQueryCount += 1;
                if (query.strings.join(' ').includes('SELECT options')) {
                    return [
                        {
                            options: ['찬성'],
                            multipleOptions: 1,
                            endAt: null,
                            endTick: 0n,
                            closedAt: null,
                        },
                    ];
                }
                voteInsertQuery = query;
                if (voteInserted) return [];
                voteInserted = true;
                return [{ id: 11 }];
            },
        };
        const handler = createTurnDaemonCommandHandler({ world });
        const command = {
            type: 'voteReward' as const,
            voteId: 1,
            generalId: 1,
            selection: [0],
            // Ref accepts the request at exact equality. Engine processing may
            // occur after the logical clock has advanced beyond the deadline.
            acceptedGameTick: 0,
        };

        const writerWindowStart = Date.now();
        const result = await handler.handle(command, { db: commandDb as any });
        const writerWindowEnd = Date.now();
        expect(result && result.type).toBe('voteReward');
        if (!result || result.type !== 'voteReward' || !result.ok) {
            throw new Error('voteReward result missing');
        }
        expect(result.awardedUnique).toBe(true);
        expect(voteInsertQuery?.strings.join(' ')).toContain('created_at');
        expect(
            voteInsertQuery?.values.filter(
                (value) =>
                    value instanceof Date &&
                    value.getTime() >= writerWindowStart &&
                    value.getTime() <= writerWindowEnd
            )
        ).toHaveLength(1);

        const updated = world.getGeneralById(1);
        // ENGINE is the single reward linearization point, so it uses the
        // processing world's develcost (120 * 5), not an API projection.
        expect(updated?.gold).toBe(1600);
        expect(updated?.role.items.weapon).toBe('che_무기_12_칠성검');
        const meta = updated?.meta as Record<string, unknown>;
        expect(meta.voteRewards).toMatchObject({
            1: {
                awarded: true,
                itemKey: 'che_무기_12_칠성검',
            },
        });

        const diff = world.consumeDirtyState();
        const logTexts = diff.logs.map((entry) => entry.text);
        expect(logTexts.some((text) => text.includes('【설문조사】'))).toBe(true);

        const second = await handler.handle(command, { db: commandDb as any });
        expect(second && second.type).toBe('voteReward');
        if (!second || second.type !== 'voteReward' || !second.ok) {
            throw new Error('voteReward second result missing');
        }
        expect(second.alreadyApplied).toBe(true);
        expect(second.itemKey).toBe('che_무기_12_칠성검');
        const afterSecond = world.getGeneralById(1);
        expect(afterSecond?.gold).toBe(1600);
        expect(voteQueryCount).toBe(2);

        const duplicateWorld = new InMemoryTurnWorld(
            { ...state, meta: { ...state.meta } },
            { ...snapshot, generals: [buildGeneral(1)] as any },
            { schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] } }
        );
        const duplicateHandler = createTurnDaemonCommandHandler({ world: duplicateWorld });
        const duplicateResult = await duplicateHandler.handle(command, {
            db: {
                auction: { findMany: async () => [] },
                $queryRaw: async (query: { strings: readonly string[] }) => {
                    const text = query.strings.join(' ');
                    if (text.includes('SELECT options')) {
                        return [
                            {
                                options: ['찬성'],
                                multipleOptions: 1,
                                endAt: null,
                                endTick: 0n,
                                closedAt: null,
                            },
                        ];
                    }
                    if (text.includes('SELECT selection')) return [{ selection: [0] }];
                    return [];
                },
            } as any,
        });
        expect(duplicateResult).toMatchObject({
            type: 'voteReward',
            ok: true,
            awardedUnique: true,
        });
        expect(duplicateWorld.getGeneralById(1)?.gold).toBe(1600);
        expect(duplicateWorld.getGeneralById(1)?.role.items.weapon).toBe('che_무기_12_칠성검');

        const mismatchWorld = new InMemoryTurnWorld(
            { ...state, meta: { ...state.meta } },
            { ...snapshot, generals: [buildGeneral(1)] as any },
            { schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] } }
        );
        const mismatchHandler = createTurnDaemonCommandHandler({ world: mismatchWorld });
        const mismatchResult = await mismatchHandler.handle(command, {
            db: {
                auction: { findMany: async () => [] },
                $queryRaw: async (query: { strings: readonly string[] }) => {
                    const text = query.strings.join(' ');
                    if (text.includes('SELECT options')) {
                        return [
                            {
                                options: ['찬성'],
                                multipleOptions: 1,
                                endAt: null,
                                endTick: 0n,
                                closedAt: null,
                            },
                        ];
                    }
                    if (text.includes('SELECT selection')) return [{ selection: [1] }];
                    return [];
                },
            } as any,
        });
        expect(mismatchResult).toMatchObject({
            type: 'voteReward',
            ok: false,
            reason: '이미 설문조사를 완료하였습니다.',
        });
        expect(mismatchWorld.getGeneralById(1)?.gold).toBe(1000);
        expect(mismatchWorld.getGeneralById(1)?.role.items.weapon).toBeNull();
        expect(mismatchWorld.consumeDirtyState().logs).toEqual([]);

        const legacyLateWorld = new InMemoryTurnWorld(
            { ...state, meta: { ...state.meta } },
            { ...snapshot, generals: [buildGeneral(1)] as any },
            { schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] } }
        );
        const legacyLateHandler = createTurnDaemonCommandHandler({ world: legacyLateWorld });
        const { acceptedGameTick: _acceptedGameTick, ...legacyLateCommand } = command;
        const legacyLateResult = await legacyLateHandler.handle(legacyLateCommand, {
            db: {
                $queryRaw: async (query: { strings: readonly string[] }) =>
                    query.strings.join(' ').includes('SELECT options')
                        ? [
                              {
                                  options: ['찬성'],
                                  multipleOptions: 1,
                                  endAt: null,
                                  endTick: 0n,
                                  closedAt: null,
                              },
                          ]
                        : [],
            } as any,
        });
        expect(legacyLateResult).toMatchObject({
            type: 'voteReward',
            ok: false,
            reason: '설문조사가 종료되었습니다.',
        });
    });

    it('treats an active unique auction as occupied when revalidating the lottery', async () => {
        const general = buildGeneral(1);
        const snapshot: TurnWorldSnapshot = {
            generals: [general] as any,
            cities: [] as any,
            nations: [] as any,
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
            map: {
                id: 'test_map',
                name: 'TestMap',
                cities: [],
                defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
            } as any,
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {
                    develCost: 100,
                    allItems: { weapon: { che_무기_12_칠성검: 1 } },
                    maxUniqueItemLimit: [[-1, 1]],
                    uniqueTrialCoef: 10,
                    maxUniqueTrialProb: 10,
                    minMonthToAllowInheritItem: 0,
                },
                environment: { mapName: 'test_map', unitSet: 'default' },
            },
            scenarioMeta: { startYear: 180 } as any,
            unitSet: {} as any,
        };
        const state: TurnWorldState = {
            id: 1,
            currentYear: 180,
            currentMonth: 1,
            tickSeconds: 3600,
            lastTurnTime: new Date('0180-01-01T00:00:00Z'),
            meta: {
                hiddenSeed: 'seed',
                scenarioId: 200,
                initYear: 180,
                initMonth: 1,
                scenarioMeta: { startYear: 180 },
            },
        };
        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        });
        const handler = createTurnDaemonCommandHandler({ world });
        const commandDb = {
            auction: {
                findMany: async () => [{ targetCode: 'che_무기_12_칠성검' }],
            },
            $queryRaw: async (query: { strings: readonly string[] }) =>
                query.strings.join(' ').includes('SELECT options')
                    ? [
                          {
                              options: ['찬성'],
                              multipleOptions: 1,
                              endAt: null,
                              endTick: 0n,
                              closedAt: null,
                          },
                      ]
                    : [{ id: 12 }],
        };

        const result = await handler.handle(
            {
                type: 'voteReward',
                voteId: 1,
                generalId: 1,
                selection: [0],
            },
            { db: commandDb as any }
        );

        expect(result).toMatchObject({
            type: 'voteReward',
            ok: true,
            awardedUnique: false,
        });
        expect(world.getGeneralById(1)?.gold).toBe(1500);
        expect(world.getGeneralById(1)?.role.items.weapon).toBeNull();
    });
});
