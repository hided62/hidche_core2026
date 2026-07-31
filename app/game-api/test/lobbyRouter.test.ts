import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient, GameApiContext } from '../src/context.js';
import { appRouter } from '../src/router.js';

const buildContext = (meta: Record<string, unknown>): GameApiContext =>
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
});
