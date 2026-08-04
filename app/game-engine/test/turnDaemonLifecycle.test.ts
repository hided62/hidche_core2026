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
    it('runs manual game time to each monthly snapshot without waiting for wall time', async () => {
        const wallNow = new Date('2026-01-01T00:00:00.000Z');
        const operationalClock = new ManualClock(wallNow.getTime());
        const queue = new InMemoryControlQueue();
        let lastTurnTime = new Date('2042-01-01T00:00:00.000Z');
        let gameNow = new Date(lastTurnTime);
        const targets: string[] = [];
        const lifecycle = new TurnDaemonLifecycle(
            {
                clock: operationalClock,
                controlQueue: queue,
                getNextTickTime: (value) => addMinutes(value, 60),
                stateStore: {
                    loadLastTurnTime: async () => lastTurnTime,
                    loadNextGeneralTurnTime: async () => addMinutes(lastTurnTime, 30),
                    saveLastTurnTime: async (value) => {
                        lastTurnTime = value;
                    },
                    loadCheckpoint: async () => undefined,
                    saveCheckpoint: async () => {},
                    loadGameClock: async () => ({ mode: 'manual', now: gameNow }),
                    advanceGameClockTo: async (target) => {
                        gameNow = target;
                    },
                },
                processor: {
                    run: async (target): Promise<TurnRunResult> => {
                        targets.push(target.toISOString());
                        if (targets.length === 3) {
                            queue.enqueue({ type: 'shutdown', reason: 'verified' });
                        }
                        return {
                            lastTurnTime: target.toISOString(),
                            processedGenerals: 0,
                            processedTurns: 1,
                            durationMs: 0,
                            partial: false,
                        };
                    },
                },
            },
            {
                profile: 'manual-clock',
                defaultBudget: { budgetMs: 100, maxGenerals: 1, catchUpCap: 1 },
            }
        );

        await lifecycle.start();

        expect(targets).toEqual(['2042-01-01T01:00:00.000Z', '2042-01-01T02:00:00.000Z', '2042-01-01T03:00:00.000Z']);
        expect(operationalClock.nowMs()).toBe(wallNow.getTime());
    });

    it('drains restart-overdue generals without advancing or catching up a month', async () => {
        const gameNow = new Date('2042-01-01T03:00:00.000Z');
        const queue = new InMemoryControlQueue();
        const observedTargets: Date[] = [];
        const lifecycle = new TurnDaemonLifecycle(
            {
                clock: new ManualClock(new Date('2026-01-01T00:00:00.000Z').getTime()),
                controlQueue: queue,
                getNextTickTime: (value) => addMinutes(value, 60),
                stateStore: {
                    loadLastTurnTime: async () => gameNow,
                    loadNextGeneralTurnTime: async () => addMinutes(gameNow, -30),
                    saveLastTurnTime: async () => {},
                    loadCheckpoint: async () => undefined,
                    saveCheckpoint: async () => {},
                    loadGameClock: async () => ({ mode: 'manual', now: gameNow }),
                    advanceGameClockTo: async () => {},
                },
                processor: {
                    run: async (target): Promise<TurnRunResult> => {
                        observedTargets.push(target);
                        queue.enqueue({ type: 'shutdown', reason: 'verified' });
                        return {
                            lastTurnTime: gameNow.toISOString(),
                            processedGenerals: 1,
                            processedTurns: 0,
                            durationMs: 0,
                            partial: false,
                        };
                    },
                },
            },
            {
                profile: 'manual-overdue',
                defaultBudget: { budgetMs: 100, maxGenerals: 10, catchUpCap: 1 },
            }
        );

        await lifecycle.start();

        expect(observedTargets[0]?.toISOString()).toBe('2042-01-01T02:59:59.999Z');
    });

    it('produces the same command, RNG, and resource state in realtime and manual modes', async () => {
        const start = new Date('2042-01-01T00:00:00.000Z');
        const runMode = async (mode: 'realtime' | 'manual') => {
            const operationalClock = new ManualClock(
                mode === 'realtime' ? start.getTime() + 3 * 60 * 60_000 : start.getTime()
            );
            const queue = new InMemoryControlQueue();
            let lastTurnTime = new Date(start);
            let gameNow = new Date(start);
            let rng = 17;
            let resource = 100;
            const commands: string[] = [];
            const lifecycle = new TurnDaemonLifecycle(
                {
                    clock: operationalClock,
                    controlQueue: queue,
                    getNextTickTime: (value) => addMinutes(value, 60),
                    stateStore: {
                        loadLastTurnTime: async () => lastTurnTime,
                        loadNextGeneralTurnTime: async () => null,
                        saveLastTurnTime: async (value) => {
                            lastTurnTime = value;
                        },
                        loadCheckpoint: async () => undefined,
                        saveCheckpoint: async () => {},
                        loadGameClock: async (wallNow) => ({
                            mode,
                            now:
                                mode === 'manual'
                                    ? gameNow
                                    : new Date(start.getTime() + ((wallNow ?? start).getTime() - start.getTime())),
                        }),
                        advanceGameClockTo: async (target) => {
                            gameNow = target;
                        },
                    },
                    processor: {
                        run: async (target): Promise<TurnRunResult> => {
                            while (lastTurnTime.getTime() < target.getTime()) {
                                lastTurnTime = addMinutes(lastTurnTime, 60);
                                rng = (rng * 48_271) % 2_147_483_647;
                                const command = rng % 2 === 0 ? 'develop' : 'train';
                                commands.push(command);
                                resource += command === 'develop' ? 7 : -3;
                            }
                            if (commands.length >= 3) {
                                queue.enqueue({ type: 'shutdown', reason: `${mode} verified` });
                            }
                            return {
                                lastTurnTime: lastTurnTime.toISOString(),
                                processedGenerals: commands.length,
                                processedTurns: commands.length,
                                durationMs: 0,
                                partial: false,
                            };
                        },
                    },
                },
                {
                    profile: `${mode}-equivalence`,
                    defaultBudget: { budgetMs: 100, maxGenerals: 10, catchUpCap: 10 },
                }
            );

            await lifecycle.start();
            return { commands, rng, resource, lastTurnTime: lastTurnTime.toISOString() };
        };

        expect(await runMode('manual')).toEqual(await runMode('realtime'));
    });

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
