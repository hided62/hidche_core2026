import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from '../src/context.js';
import { loadCurrentGameTime } from '../src/services/gameClock.js';

const buildDatabase = (
    mode: 'realtime' | 'manual' = 'realtime',
    phase: 'PREOPEN' | 'RUNNING' | 'MANUAL' = mode === 'manual' ? 'MANUAL' : 'PREOPEN'
): DatabaseClient =>
    ({
        worldState: {
            findFirst: vi.fn(async () => ({
                clockBaseTime: new Date('2026-08-21T11:00:00.000Z'),
                clockTick: 0n,
                clockMode: mode,
                clockWallAnchor: new Date('2026-08-21T11:00:00.000Z'),
                tickSeconds: 600,
                clockPhase: phase,
                clockRevision: 1n,
                deadlineGeneration: 1n,
            })),
        },
    }) as unknown as DatabaseClient;

describe('current game time projection', () => {
    it('projects negative realtime ticks until the future opening anchor', async () => {
        const db = buildDatabase();

        const preopen = await loadCurrentGameTime(db, new Date('2026-08-21T10:30:00.000Z'));
        expect(preopen).toMatchObject({
            now: new Date('2026-08-21T10:30:00.000Z'),
            wallNow: new Date('2026-08-21T10:30:00.000Z'),
            tick: -108_000_000,
            mode: 'realtime',
            phase: 'PREOPEN',
            running: false,
            startsAt: new Date('2026-08-21T11:00:00.000Z'),
        });

        const opened = await loadCurrentGameTime(
            buildDatabase('realtime', 'RUNNING'),
            new Date('2026-08-21T11:00:05.000Z')
        );
        expect(opened).toMatchObject({
            now: new Date('2026-08-21T11:00:05.000Z'),
            tick: 300_000,
            running: true,
            startsAt: null,
        });
    });

    it('keeps a manual clock stopped without scheduling an automatic start', async () => {
        const result = await loadCurrentGameTime(buildDatabase('manual'), new Date('2026-08-21T12:00:00.000Z'));

        expect(result).toMatchObject({
            now: new Date('2026-08-21T11:00:00.000Z'),
            tick: 0,
            running: false,
            startsAt: null,
        });
    });
});
