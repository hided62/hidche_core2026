import { describe, expect, it, vi } from 'vitest';

import {
    InMemoryControlQueue,
    ManualClock,
    TurnDaemonLifecycle,
    type TurnDaemonCommandResult,
    type TurnProcessor,
    type TurnStateStore,
} from '../src/index.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';

const createStateStore = (): TurnStateStore => ({
    loadLastTurnTime: async () => new Date('2026-01-01T00:00:00.000Z'),
    loadNextGeneralTurnTime: async () => null,
    saveLastTurnTime: async () => {},
    loadCheckpoint: async () => undefined,
    saveCheckpoint: async () => {},
});

const processor: TurnProcessor = {
    run: async () => {
        throw new Error('scheduled turn must not run in this test');
    },
};

describe('input event atomicity', () => {
    it('keeps reserved-turn dirty state when persistence fails', async () => {
        let failCreate = true;
        const prisma = {
            generalTurn: {
                findMany: vi.fn(async () => []),
                deleteMany: vi.fn(async () => ({ count: 0 })),
                createMany: vi.fn(async () => {
                    if (failCreate) {
                        throw new Error('injected write failure');
                    }
                    return { count: 1 };
                }),
            },
            nationTurn: {
                findMany: vi.fn(async () => []),
                deleteMany: vi.fn(async () => ({ count: 0 })),
                createMany: vi.fn(async () => ({ count: 0 })),
            },
        };
        const store = new InMemoryReservedTurnStore(prisma, {
            maxGeneralTurns: 1,
            maxNationTurns: 1,
        });
        store.shiftGeneralTurns(7, -1);

        await expect(store.flushChanges()).rejects.toThrow('injected write failure');
        expect(store.peekDirtyState()).toEqual({ generalIds: [7], nationKeys: [] });

        failCreate = false;
        await store.flushChanges();
        expect(store.peekDirtyState()).toEqual({ generalIds: [], nationKeys: [] });
    });

    it('dispatches registry mutations that the old lifecycle switch dropped, then commits before responding', async () => {
        const queue = new InMemoryControlQueue();
        const order: string[] = [];
        const result: TurnDaemonCommandResult = {
            type: 'auctionBid',
            ok: true,
            auctionId: 3,
            closeAt: '2026-01-01T00:10:00.000Z',
        };
        let resolveResponse: (() => void) | undefined;
        const responded = new Promise<void>((resolve) => {
            resolveResponse = resolve;
        });
        const lifecycle = new TurnDaemonLifecycle(
            {
                clock: new ManualClock(new Date('2026-01-01T00:00:00.000Z').getTime()),
                controlQueue: queue,
                getNextTickTime: () => new Date('2026-01-01T01:00:00.000Z'),
                stateStore: createStateStore(),
                processor,
                commandHandler: {
                    handle: async (command) => {
                        order.push(`handle:${command.type}`);
                        return result;
                    },
                },
                hooks: {
                    commitCommand: async (requestId, committedResult) => {
                        order.push(`commit:${requestId}:${committedResult.type}`);
                    },
                },
                commandResponder: {
                    publishStatus: async () => {},
                    publishCommandResult: async (requestId, response) => {
                        order.push(`respond:${requestId}:${response.type}`);
                        resolveResponse?.();
                    },
                },
            },
            {
                profile: 'test',
                defaultBudget: { budgetMs: 100, maxGenerals: 1, catchUpCap: 1 },
            }
        );

        queue.enqueue({
            type: 'auctionBid',
            requestId: 'event-1',
            auctionId: 3,
            generalId: 7,
            amount: 1000,
        });
        const loop = lifecycle.start();
        await responded;

        expect(order).toEqual(['handle:auctionBid', 'commit:event-1:auctionBid', 'respond:event-1:auctionBid']);

        await lifecycle.stop('done');
        await loop;
    });

    it('runs a mutation inside the database-owned execution boundary before responding', async () => {
        const queue = new InMemoryControlQueue();
        const order: string[] = [];
        let resolveResponse: (() => void) | undefined;
        const responded = new Promise<void>((resolve) => {
            resolveResponse = resolve;
        });
        const lifecycle = new TurnDaemonLifecycle(
            {
                clock: new ManualClock(new Date('2026-01-01T00:00:00.000Z').getTime()),
                controlQueue: queue,
                getNextTickTime: () => new Date('2026-01-01T01:00:00.000Z'),
                stateStore: createStateStore(),
                processor,
                commandHandler: {
                    handle: async (command) => {
                        order.push(`handle:${command.type}`);
                        return { type: 'vacation', ok: true, generalId: 7 };
                    },
                },
                hooks: {
                    executeCommand: async (requestId, execute) => {
                        order.push(`transaction:${requestId}:begin`);
                        const result = await execute({});
                        order.push(`transaction:${requestId}:commit`);
                        return result;
                    },
                    commitCommand: async () => {
                        order.push('legacy-commit');
                    },
                },
                commandResponder: {
                    publishStatus: async () => {},
                    publishCommandResult: async () => {
                        order.push('respond');
                        resolveResponse?.();
                    },
                },
            },
            {
                profile: 'test',
                defaultBudget: { budgetMs: 100, maxGenerals: 1, catchUpCap: 1 },
            }
        );

        queue.enqueue({ type: 'vacation', requestId: 'event-uow', generalId: 7 });
        const loop = lifecycle.start();
        await responded;

        expect(order).toEqual([
            'transaction:event-uow:begin',
            'handle:vacation',
            'transaction:event-uow:commit',
            'respond',
        ]);

        await lifecycle.stop('done');
        await loop;
    });

    it('pauses without publishing success when the atomic command commit fails', async () => {
        const queue = new InMemoryControlQueue();
        let resolveError: (() => void) | undefined;
        const errorObserved = new Promise<void>((resolve) => {
            resolveError = resolve;
        });
        const publishCommandResult = vi.fn(async () => {});
        const lifecycle = new TurnDaemonLifecycle(
            {
                clock: new ManualClock(new Date('2026-01-01T00:00:00.000Z').getTime()),
                controlQueue: queue,
                getNextTickTime: () => new Date('2026-01-01T01:00:00.000Z'),
                stateStore: createStateStore(),
                processor,
                commandHandler: {
                    handle: async () => ({ type: 'vacation', ok: true, generalId: 7 }),
                },
                hooks: {
                    commitCommand: async () => {
                        throw new Error('injected commit failure');
                    },
                    onRunError: async () => {
                        resolveError?.();
                    },
                },
                commandResponder: {
                    publishStatus: async () => {},
                    publishCommandResult,
                },
            },
            {
                profile: 'test',
                defaultBudget: { budgetMs: 100, maxGenerals: 1, catchUpCap: 1 },
            }
        );

        queue.enqueue({ type: 'vacation', requestId: 'event-2', generalId: 7 });
        const loop = lifecycle.start();
        await errorObserved;

        expect(lifecycle.getStatus()).toMatchObject({
            state: 'paused',
            paused: true,
            lastError: 'injected commit failure',
        });
        expect(publishCommandResult).not.toHaveBeenCalled();

        await lifecycle.stop('done');
        await loop;
    });

    it('pauses without committing or acknowledging a handler that throws after changing memory', async () => {
        const queue = new InMemoryControlQueue();
        let resolveError: (() => void) | undefined;
        const errorObserved = new Promise<void>((resolve) => {
            resolveError = resolve;
        });
        const commitCommand = vi.fn(async () => {});
        const publishCommandResult = vi.fn(async () => {});
        const lifecycle = new TurnDaemonLifecycle(
            {
                clock: new ManualClock(new Date('2026-01-01T00:00:00.000Z').getTime()),
                controlQueue: queue,
                getNextTickTime: () => new Date('2026-01-01T01:00:00.000Z'),
                stateStore: createStateStore(),
                processor,
                commandHandler: {
                    handle: async () => {
                        throw new Error('injected handler failure');
                    },
                },
                hooks: {
                    commitCommand,
                    onRunError: async () => {
                        resolveError?.();
                    },
                },
                commandResponder: {
                    publishStatus: async () => {},
                    publishCommandResult,
                },
            },
            {
                profile: 'test',
                defaultBudget: { budgetMs: 100, maxGenerals: 1, catchUpCap: 1 },
            }
        );

        queue.enqueue({ type: 'vacation', requestId: 'event-3', generalId: 7 });
        const loop = lifecycle.start();
        await errorObserved;

        expect(lifecycle.getStatus()).toMatchObject({
            state: 'paused',
            paused: true,
            lastError: 'injected handler failure',
        });
        expect(commitCommand).not.toHaveBeenCalled();
        expect(publishCommandResult).not.toHaveBeenCalled();

        await lifecycle.stop('done');
        await loop;
    });
});
