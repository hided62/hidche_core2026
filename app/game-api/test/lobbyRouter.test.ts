import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient, GameApiContext } from '../src/context.js';
import { appRouter } from '../src/router.js';

const buildContext = (
    meta: Record<string, unknown>,
    clock: {
        baseTime?: Date;
        tick?: bigint;
        mode?: string;
        wallAnchor?: Date;
    } = {}
): GameApiContext =>
    ({
        auth: null,
        db: {
            worldState: {
                findFirst: vi.fn(async () => ({
                    id: 1,
                    scenarioCode: 'default',
                    currentYear: 200,
                    currentMonth: 1,
                    tickSeconds: 3_600,
                    config: {},
                    meta,
                    clockBaseTime: clock.baseTime ?? null,
                    clockTick: clock.tick ?? null,
                    clockMode: clock.mode ?? 'realtime',
                    clockWallAnchor: clock.wallAnchor ?? null,
                    updatedAt: new Date('2026-07-31T00:00:00.000Z'),
                })),
            },
            general: {
                count: vi.fn(async () => 0),
            },
            nation: {
                count: vi.fn(async () => 0),
            },
        } as unknown as DatabaseClient,
    }) as GameApiContext;

describe('lobby season state', () => {
    it.each([0, 1, 2, 3])('returns legacy isunited state %i', async (isunited) => {
        const result = await appRouter
            .createCaller(buildContext({ isUnited: isunited === 0 ? 2 : 0, isunited }))
            .lobby.info();

        expect(result.isUnited).toBe(isunited);
    });

    it('returns the projected server game time and whether the clock is running', async () => {
        const result = await appRouter
            .createCaller(
                buildContext(
                    {},
                    {
                        baseTime: new Date('2026-08-15T00:00:00.000Z'),
                        tick: 72_000_000n,
                        mode: 'manual',
                        wallAnchor: new Date('2026-08-15T17:00:00.000Z'),
                    }
                )
            )
            .lobby.info();

        expect(result.serverTime).toBe('2026-08-15T02:00:00.000Z');
        expect(result.clockMode).toBe('manual');
    });
});
