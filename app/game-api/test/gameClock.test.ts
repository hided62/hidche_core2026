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
    it('keeps independent workers frozen until this clock revision has a ready daemon', async () => {
        const row = {
            clockBaseTime: new Date('2026-09-06T00:00:00Z'),
            clockTick: 0n,
            clockMode: 'realtime',
            clockWallAnchor: new Date('2026-09-06T00:00:00Z'),
            tickSeconds: 3600,
            clockPhase: 'RUNNING',
            clockRevision: 2n,
            deadlineGeneration: 2n,
            clockRecoveryStartTick: 0n,
            clockRecoveryEndTick: 288_000_000n,
            clockRecoveryStartWallAt: new Date('2026-09-06T04:00:00Z'),
        };
        let ready = false;
        const db = {
            worldState: { findFirst: vi.fn(async () => row) },
            $queryRaw: vi.fn(async () => [{ ready }]),
        } as unknown as DatabaseClient;
        const now = new Date('2026-09-06T05:00:00Z');
        expect(await loadCurrentGameTime(db, now)).toMatchObject({ tick: 0, running: false, runtimeReady: false });
        ready = true;
        expect(await loadCurrentGameTime(db, now)).toMatchObject({
            tick: 72_000_000,
            running: true,
            runtimeReady: true,
            recovery: { startsAt: '2026-09-06T04:00:00.000Z', endsAt: '2026-09-06T08:00:00.000Z' },
        });
    });

    it('exposes waiting, 2x and normal speed boundaries from a reloaded recovery', async () => {
        const db = {
            worldState: {
                findFirst: vi.fn(async () => ({
                    clockBaseTime: new Date('2026-09-07T00:00:00Z'),
                    clockTick: 6000000n,
                    clockMode: 'realtime',
                    clockWallAnchor: new Date('2026-09-07T00:35:00Z'),
                    tickSeconds: 3600,
                    clockPhase: 'RUNNING',
                    clockRevision: 2n,
                    deadlineGeneration: 2n,
                    clockRecoveryStartTick: 6000000n,
                    clockRecoveryEndTick: 36000000n,
                    clockRecoveryStartWallAt: new Date('2026-09-07T00:35:00Z'),
                })),
            },
            $queryRaw: vi.fn(async () => [{ ready: true }]),
        } as unknown as DatabaseClient;
        for (const now of ['00:24:00', '00:34:59.999']) {
            expect(await loadCurrentGameTime(db, new Date(`2026-09-07T${now}Z`))).toMatchObject({
                tick: 6000000,
                running: false,
                startsAt: new Date('2026-09-07T00:35:00Z'),
                recovery: { startsAt: '2026-09-07T00:35:00.000Z', endsAt: '2026-09-07T01:00:00.000Z' },
            });
        }
        expect(await loadCurrentGameTime(db, new Date('2026-09-07T00:35:00.001Z'))).toMatchObject({
            tick: 6000020,
            running: true,
            startsAt: null,
        });
        expect(await loadCurrentGameTime(db, new Date('2026-09-07T00:59:59.999Z'))).toMatchObject({ tick: 35999980 });
        expect(await loadCurrentGameTime(db, new Date('2026-09-07T01:00:00Z'))).toMatchObject({
            tick: 36000000,
            running: true,
            recovery: null,
        });
        expect(await loadCurrentGameTime(db, new Date('2026-09-07T01:00:00.001Z'))).toMatchObject({ tick: 36000010 });
    });

    it('holds an invader restart until its future turn boundary', async () => {
        const db = buildDatabase('realtime', 'RUNNING');
        const result = await loadCurrentGameTime(db, new Date('2026-08-21T10:59:59Z'));
        expect(result).toMatchObject({ tick: 0, running: false, startsAt: new Date('2026-08-21T11:00:00Z') });
    });
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
