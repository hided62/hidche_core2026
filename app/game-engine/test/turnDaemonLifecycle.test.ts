import { describe, expect, it, vi } from 'vitest';

import {
    InMemoryControlQueue,
    ManualClock,
    TurnDaemonLifecycle,
    getNextTickTime,
    type TurnProcessor,
    type TurnRunResult,
    type TurnStateStore,
} from '../src/index.js';

const addMinutes = (time: Date, minutes: number): Date => new Date(time.getTime() + minutes * 60_000);

describe('TurnDaemonLifecycle', () => {
    it('runs scheduled turn based on queue front and checkpoint context', async () => {
        const turnTermMinutes = 10;
        const lastTurnTime = new Date(2026, 0, 2, 2, 0, 0, 0);
        const generalTurnQueue = [addMinutes(lastTurnTime, 5), addMinutes(lastTurnTime, 20)];
        const nextTickTime = getNextTickTime(lastTurnTime, turnTermMinutes);
        const expectedRunTimeMs = Math.min(nextTickTime.getTime(), generalTurnQueue[0]!.getTime());
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

    it('runs scheduled turn when tick boundary arrives before queue front', async () => {
        const turnTermMinutes = 10;
        const lastTurnTime = new Date(2026, 0, 2, 2, 0, 0, 0);
        const generalTurnQueue = [addMinutes(lastTurnTime, 15), addMinutes(lastTurnTime, 30)];
        const nextTickTime = getNextTickTime(lastTurnTime, turnTermMinutes);
        const expectedRunTimeMs = Math.min(nextTickTime.getTime(), generalTurnQueue[0]!.getTime());
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
