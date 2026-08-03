import { describe, expect, it, vi } from 'vitest';

import {
    InMemoryControlQueue,
    EngineStateManager,
    ManualClock,
    TurnDaemonLifecycle,
    getNextTickTime,
    type TurnProcessor,
    type TurnRunResult,
    type TurnStateStore,
} from '../src/index.js';

const addMinutes = (time: Date, minutes: number): Date => new Date(time.getTime() + minutes * 60_000);

describe('TurnDaemonLifecycle', () => {
    it('restores engine state when a scheduled calculation throws', async () => {
        const now = new Date('2026-01-01T00:10:00.000Z');
        const queue = new InMemoryControlQueue();
        let engineState = { value: 'before' };
        const stateManager = new EngineStateManager();
        stateManager.register('test', {
            capture: () => structuredClone(engineState),
            restore: (snapshot) => {
                engineState = snapshot;
            },
        });
        let resolveError: (() => void) | undefined;
        const errorObserved = new Promise<void>((resolve) => {
            resolveError = resolve;
        });
        const lifecycle = new TurnDaemonLifecycle(
            {
                clock: new ManualClock(now.getTime()),
                controlQueue: queue,
                getNextTickTime: () => new Date('2026-01-01T00:05:00.000Z'),
                stateStore: {
                    loadLastTurnTime: async () => new Date('2026-01-01T00:00:00.000Z'),
                    loadNextGeneralTurnTime: async () => null,
                    saveLastTurnTime: async () => {},
                    loadCheckpoint: async () => undefined,
                    saveCheckpoint: async () => {},
                },
                processor: {
                    run: async () => {
                        engineState.value = 'partial';
                        throw new Error('scheduled calculation failed');
                    },
                },
                stateManager,
                hooks: {
                    onRunError: async () => {
                        resolveError?.();
                    },
                },
            },
            {
                profile: 'test',
                defaultBudget: { budgetMs: 100, maxGenerals: 1, catchUpCap: 1 },
            }
        );

        const loop = lifecycle.start();
        await errorObserved;

        expect(engineState).toEqual({ value: 'before' });
        expect(stateManager.getRevision()).toBe(0);
        expect(lifecycle.getStatus()).toMatchObject({
            state: 'paused',
            paused: true,
            lastError: 'scheduled calculation failed',
        });

        await lifecycle.stop('done');
        await loop;
    });

    it('restores processor and state-store mutations when scheduled flush fails', async () => {
        const now = new Date('2026-01-01T00:10:00.000Z');
        const previousCheckpoint = {
            turnTime: '2026-01-01T00:00:00.000Z',
            generalId: 7,
            year: 203,
            month: 1,
        };
        const nextCheckpoint = {
            turnTime: now.toISOString(),
            generalId: 8,
            year: 203,
            month: 2,
        };
        let engineState: {
            value: string;
            lastTurnTime: string;
            checkpoint: TurnRunResult['checkpoint'];
        } = {
            value: 'before',
            lastTurnTime: previousCheckpoint.turnTime,
            checkpoint: previousCheckpoint,
        };
        const stateManager = new EngineStateManager();
        stateManager.register('test', {
            capture: () => structuredClone(engineState),
            restore: (snapshot) => {
                engineState = snapshot;
            },
        });
        const published = vi.fn();
        let resolveError: (() => void) | undefined;
        const errorObserved = new Promise<void>((resolve) => {
            resolveError = resolve;
        });
        const lifecycle = new TurnDaemonLifecycle(
            {
                clock: new ManualClock(now.getTime()),
                controlQueue: new InMemoryControlQueue(),
                getNextTickTime: () => new Date('2026-01-01T00:05:00.000Z'),
                stateStore: {
                    loadLastTurnTime: async () => new Date(engineState.lastTurnTime),
                    loadNextGeneralTurnTime: async () => null,
                    saveLastTurnTime: async (turnTime) => {
                        engineState.lastTurnTime = turnTime.toISOString();
                    },
                    loadCheckpoint: async () => engineState.checkpoint,
                    saveCheckpoint: async (checkpoint) => {
                        engineState.checkpoint = checkpoint;
                    },
                },
                processor: {
                    run: async (): Promise<TurnRunResult> => {
                        engineState.value = 'calculated';
                        return {
                            lastTurnTime: now.toISOString(),
                            processedGenerals: 1,
                            processedTurns: 1,
                            durationMs: 0,
                            partial: false,
                            checkpoint: nextCheckpoint,
                        };
                    },
                },
                stateManager,
                hooks: {
                    flushChanges: async () => {
                        expect(engineState).toMatchObject({
                            value: 'calculated',
                            lastTurnTime: now.toISOString(),
                            checkpoint: nextCheckpoint,
                        });
                        throw new Error('scheduled flush failed');
                    },
                    publishEvents: published,
                    onRunError: async () => {
                        resolveError?.();
                    },
                },
            },
            {
                profile: 'test',
                defaultBudget: { budgetMs: 100, maxGenerals: 1, catchUpCap: 1 },
            }
        );

        const loop = lifecycle.start();
        await errorObserved;

        expect(engineState).toEqual({
            value: 'before',
            lastTurnTime: previousCheckpoint.turnTime,
            checkpoint: previousCheckpoint,
        });
        expect(stateManager.getRevision()).toBe(0);
        expect(published).not.toHaveBeenCalled();
        expect(lifecycle.getStatus()).toMatchObject({
            state: 'paused',
            paused: true,
            lastError: 'scheduled flush failed',
        });

        await lifecycle.stop('done');
        await loop;
    });

    it('keeps processor and state-store mutations after flush succeeds and publishes afterward', async () => {
        const now = new Date('2026-01-01T00:10:00.000Z');
        const previousCheckpoint = {
            turnTime: '2026-01-01T00:00:00.000Z',
            generalId: 7,
            year: 203,
            month: 1,
        };
        const nextCheckpoint = {
            turnTime: now.toISOString(),
            generalId: 8,
            year: 203,
            month: 2,
        };
        let engineState: {
            value: string;
            lastTurnTime: string;
            checkpoint: TurnRunResult['checkpoint'];
        } = {
            value: 'before',
            lastTurnTime: previousCheckpoint.turnTime,
            checkpoint: previousCheckpoint,
        };
        const stateManager = new EngineStateManager();
        stateManager.register('test', {
            capture: () => structuredClone(engineState),
            restore: (snapshot) => {
                engineState = snapshot;
            },
        });
        const callOrder: string[] = [];
        let resolvePublished: (() => void) | undefined;
        const published = new Promise<void>((resolve) => {
            resolvePublished = resolve;
        });
        const lifecycle = new TurnDaemonLifecycle(
            {
                clock: new ManualClock(now.getTime()),
                controlQueue: new InMemoryControlQueue(),
                getNextTickTime: (lastTurnTime) => addMinutes(lastTurnTime, 10),
                stateStore: {
                    loadLastTurnTime: async () => new Date(engineState.lastTurnTime),
                    loadNextGeneralTurnTime: async () => null,
                    saveLastTurnTime: async (turnTime) => {
                        callOrder.push('save-last-turn');
                        engineState.lastTurnTime = turnTime.toISOString();
                    },
                    loadCheckpoint: async () => engineState.checkpoint,
                    saveCheckpoint: async (checkpoint) => {
                        callOrder.push('save-checkpoint');
                        engineState.checkpoint = checkpoint;
                    },
                },
                processor: {
                    run: async (): Promise<TurnRunResult> => {
                        callOrder.push('processor');
                        engineState.value = 'calculated';
                        return {
                            lastTurnTime: now.toISOString(),
                            processedGenerals: 1,
                            processedTurns: 1,
                            durationMs: 0,
                            partial: false,
                            checkpoint: nextCheckpoint,
                        };
                    },
                },
                stateManager,
                hooks: {
                    flushChanges: async () => {
                        callOrder.push('flush');
                    },
                    publishEvents: async () => {
                        callOrder.push('publish');
                        resolvePublished?.();
                    },
                },
            },
            {
                profile: 'test',
                defaultBudget: { budgetMs: 100, maxGenerals: 1, catchUpCap: 1 },
            }
        );

        const loop = lifecycle.start();
        await published;

        expect(engineState).toEqual({
            value: 'calculated',
            lastTurnTime: now.toISOString(),
            checkpoint: nextCheckpoint,
        });
        expect(stateManager.getRevision()).toBe(1);
        expect(callOrder).toEqual(['processor', 'save-last-turn', 'save-checkpoint', 'flush', 'publish']);

        await lifecycle.stop('done');
        await loop;
    });

    it('catches up through the observed clock with queue and checkpoint context', async () => {
        const turnTermMinutes = 10;
        const lastTurnTime = new Date(2026, 0, 2, 2, 0, 0, 0);
        const generalTurnQueue = [addMinutes(lastTurnTime, 5), addMinutes(lastTurnTime, 20)];
        const expectedRunTimeMs = addMinutes(lastTurnTime, 30).getTime();
        const checkpoint = {
            turnTime: lastTurnTime.toISOString(),
            generalId: 101,
            year: 203,
            month: 4,
        };
        const clock = new ManualClock(addMinutes(lastTurnTime, 30).getTime());
        const controlQueue = new InMemoryControlQueue();
        const getNextTickTimeResolver = (currentLastTurnTime: Date) =>
            getNextTickTime(currentLastTurnTime, turnTermMinutes);

        let hasRun = false;
        const stateStore: TurnStateStore = {
            loadLastTurnTime: async () => new Date(lastTurnTime.getTime()),
            loadNextGeneralTurnTime: async () => {
                if (hasRun) {
                    return null;
                }
                return generalTurnQueue[0] ? new Date(generalTurnQueue[0].getTime()) : null;
            },
            saveLastTurnTime: async () => {},
            loadCheckpoint: async () => checkpoint,
            saveCheckpoint: async () => {},
        };

        let resolveRun: (() => void) | null = null;
        const runCalled = new Promise<void>((resolve) => {
            resolveRun = resolve;
        });
        const processor: TurnProcessor = {
            run: vi.fn(async (targetTime): Promise<TurnRunResult> => {
                resolveRun?.();
                hasRun = true;
                return {
                    lastTurnTime: targetTime.toISOString(),
                    processedGenerals: 2,
                    processedTurns: 1,
                    durationMs: 0,
                    partial: false,
                    checkpoint,
                };
            }),
        };

        const budget = { budgetMs: 1000, maxGenerals: 10, catchUpCap: 1 };
        const lifecycle = new TurnDaemonLifecycle(
            { clock, controlQueue, getNextTickTime: getNextTickTimeResolver, stateStore, processor },
            {
                profile: 'test',
                defaultBudget: budget,
            }
        );

        const loop = lifecycle.start();
        await Promise.race([
            runCalled,
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('run was not called')), 50);
            }),
        ]);

        expect(processor.run).toHaveBeenCalledTimes(1);
        const runMock = processor.run as ReturnType<typeof vi.fn>;
        const [targetTime, budgetArg, checkpointArg] = runMock.mock.calls[0] ?? [];
        expect((targetTime as Date).getTime()).toBe(expectedRunTimeMs);
        expect(budgetArg).toEqual(budget);
        expect(checkpointArg).toEqual(checkpoint);

        await lifecycle.stop('test done');
        await loop;
    });

    it('catches up through the observed clock when tick boundary precedes the queue front', async () => {
        const turnTermMinutes = 10;
        const lastTurnTime = new Date(2026, 0, 2, 2, 0, 0, 0);
        const generalTurnQueue = [addMinutes(lastTurnTime, 15), addMinutes(lastTurnTime, 30)];
        const expectedRunTimeMs = addMinutes(lastTurnTime, 30).getTime();
        const checkpoint = {
            turnTime: lastTurnTime.toISOString(),
            generalId: 102,
            year: 203,
            month: 4,
        };
        const clock = new ManualClock(addMinutes(lastTurnTime, 30).getTime());
        const controlQueue = new InMemoryControlQueue();
        const getNextTickTimeResolver = (currentLastTurnTime: Date) =>
            getNextTickTime(currentLastTurnTime, turnTermMinutes);

        let hasRun = false;
        const stateStore: TurnStateStore = {
            loadLastTurnTime: async () => new Date(lastTurnTime.getTime()),
            loadNextGeneralTurnTime: async () => {
                if (hasRun) {
                    return null;
                }
                return generalTurnQueue[0] ? new Date(generalTurnQueue[0].getTime()) : null;
            },
            saveLastTurnTime: async () => {},
            loadCheckpoint: async () => checkpoint,
            saveCheckpoint: async () => {},
        };

        let resolveRun: (() => void) | null = null;
        const runCalled = new Promise<void>((resolve) => {
            resolveRun = resolve;
        });
        const processor: TurnProcessor = {
            run: vi.fn(async (targetTime): Promise<TurnRunResult> => {
                resolveRun?.();
                hasRun = true;
                return {
                    lastTurnTime: targetTime.toISOString(),
                    processedGenerals: 2,
                    processedTurns: 1,
                    durationMs: 0,
                    partial: false,
                    checkpoint,
                };
            }),
        };

        const budget = { budgetMs: 1000, maxGenerals: 10, catchUpCap: 1 };
        const lifecycle = new TurnDaemonLifecycle(
            { clock, controlQueue, getNextTickTime: getNextTickTimeResolver, stateStore, processor },
            {
                profile: 'test',
                defaultBudget: budget,
            }
        );

        const loop = lifecycle.start();
        await Promise.race([
            runCalled,
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('run was not called')), 50);
            }),
        ]);

        expect(processor.run).toHaveBeenCalledTimes(1);
        const runMock = processor.run as ReturnType<typeof vi.fn>;
        const [targetTime, budgetArg, checkpointArg] = runMock.mock.calls[0] ?? [];
        expect((targetTime as Date).getTime()).toBe(expectedRunTimeMs);
        expect(budgetArg).toEqual(budget);
        expect(checkpointArg).toEqual(checkpoint);

        await lifecycle.stop('test done');
        await loop;
    });
});
