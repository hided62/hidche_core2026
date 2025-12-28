import { describe, expect, it, vi } from 'vitest';

import {
    FixedIntervalSchedule,
    InMemoryControlQueue,
    ManualClock,
    TurnDaemonLifecycle,
    type TurnProcessor,
    type TurnRunResult,
    type TurnStateStore,
} from '../src/index.js';

describe('TurnDaemonLifecycle', () => {
    it('runs once when requestRun is enqueued', async () => {
        const clock = new ManualClock(0);
        const controlQueue = new InMemoryControlQueue();
        const schedule = new FixedIntervalSchedule(1000);

        const stateStore: TurnStateStore = {
            loadLastTurnTime: async () => new Date(0),
            saveLastTurnTime: async () => {},
            loadCheckpoint: async () => undefined,
            saveCheckpoint: async () => {},
        };

        let resolveRun: (() => void) | null = null;
        const runCalled = new Promise<void>((resolve) => {
            resolveRun = resolve;
        });
        const processor: TurnProcessor = {
            run: vi.fn(async (): Promise<TurnRunResult> => {
                resolveRun?.();
                return {
                    lastTurnTime: new Date(0).toISOString(),
                    processedGenerals: 0,
                    processedTurns: 1,
                    durationMs: 0,
                    partial: false,
                };
            }),
        };

        const lifecycle = new TurnDaemonLifecycle(
            { clock, controlQueue, schedule, stateStore, processor },
            {
                profile: 'test',
                defaultBudget: { budgetMs: 1000, maxGenerals: 10, catchUpCap: 1 },
            },
        );

        const loop = lifecycle.start();
        lifecycle.requestRun('manual');
        await Promise.race([
            runCalled,
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('run was not called')), 50);
            }),
        ]);

        expect(processor.run).toHaveBeenCalledTimes(1);

        await lifecycle.stop('test done');
        await loop;
    });
});
