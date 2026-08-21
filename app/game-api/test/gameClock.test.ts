import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from '../src/context.js';
import { loadCurrentGameTime } from '../src/services/gameClock.js';

const buildDatabase = (mode: 'realtime' | 'manual' = 'realtime'): DatabaseClient =>
    ({
        worldState: {
            findFirst: vi.fn(async () => ({
                clockBaseTime: new Date('2026-08-21T09:50:00.000Z'),
                clockTick: 36_000_000n,
                clockMode: mode,
                clockWallAnchor: new Date('2026-08-21T11:00:00.000Z'),
                tickSeconds: 600,
            })),
        },
    }) as unknown as DatabaseClient;

describe('current game time projection', () => {
    it('holds a realtime clock at its persisted tick until the future wall anchor', async () => {
        const db = buildDatabase();

        const preopen = await loadCurrentGameTime(db, new Date('2026-08-21T10:30:00.000Z'));
        expect(preopen).toMatchObject({
            now: new Date('2026-08-21T10:00:00.000Z'),
            wallNow: new Date('2026-08-21T10:30:00.000Z'),
            tick: 36_000_000,
            mode: 'realtime',
            running: false,
            startsAt: new Date('2026-08-21T11:00:00.000Z'),
        });

        const opened = await loadCurrentGameTime(db, new Date('2026-08-21T11:00:05.000Z'));
        expect(opened).toMatchObject({
            now: new Date('2026-08-21T10:00:05.000Z'),
            tick: 36_300_000,
            running: true,
            startsAt: null,
        });
    });

    it('keeps a manual clock stopped without scheduling an automatic start', async () => {
        const result = await loadCurrentGameTime(buildDatabase('manual'), new Date('2026-08-21T12:00:00.000Z'));

        expect(result).toMatchObject({
            now: new Date('2026-08-21T10:00:00.000Z'),
            tick: 36_000_000,
            running: false,
            startsAt: null,
        });
    });
});
