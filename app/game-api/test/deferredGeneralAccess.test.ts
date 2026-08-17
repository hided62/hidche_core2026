import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';

import {
    DeferredGeneralAccessWorker,
    enqueueDeferredGeneralAccess,
    flushDeferredGeneralAccessBatch,
    getDeferredGeneralAccessLimit,
} from '../src/services/deferredGeneralAccess.js';

const auth = (roles: string[] = []): GameSessionTokenPayload => ({
    version: 1,
    profile: 'hwe:default',
    issuedAt: '2026-08-17T00:00:00.000Z',
    expiresAt: '2026-08-18T00:00:00.000Z',
    sessionId: 'deferred-access-session',
    user: {
        id: 'deferred-user',
        username: 'deferred-user',
        displayName: '지연 접속 사용자',
        roles,
    },
    sanctions: {},
});

describe('deferred general access', () => {
    it('adds a server-owned access weight with one Redis script and skips admins', async () => {
        const evalScript = vi.fn(
            async (_script: string, _options: { keys: string[]; arguments: string[] }) => 1
        );
        const now = new Date('2026-08-17T03:00:00.000Z');

        await expect(
            enqueueDeferredGeneralAccess({ eval: evalScript }, 'hwe:default', auth(), 7, 1, now)
        ).resolves.toBe(true);
        expect(evalScript).toHaveBeenCalledTimes(1);
        expect(evalScript.mock.calls[0]?.[1]).toMatchObject({
            keys: ['sammo:game:general-access:pending:hwe:default'],
            arguments: ['7', 'deferred-user', '1', String(now.getTime()), String(24 * 60 * 60 * 1_000)],
        });

        await expect(
            enqueueDeferredGeneralAccess({ eval: evalScript }, 'hwe:default', auth(['admin']), 7, 1, now)
        ).resolves.toBe(false);
        expect(evalScript).toHaveBeenCalledTimes(1);
    });

    it('reads only an unexpired Redis limit marker', async () => {
        const nextAccessAt = '2026-08-17T03:10:00.000Z';
        await expect(
            getDeferredGeneralAccessLimit(
                { get: vi.fn(async () => JSON.stringify({ nextAccessAt })) },
                'hwe:default',
                auth(),
                new Date('2026-08-17T03:05:00.000Z')
            )
        ).resolves.toEqual({ nextAccessAt: new Date(nextAccessAt) });
        await expect(
            getDeferredGeneralAccessLimit(
                { get: vi.fn(async () => JSON.stringify({ nextAccessAt })) },
                'hwe:default',
                auth(),
                new Date(nextAccessAt)
            )
        ).resolves.toBeNull();
    });

    it('flushes an aggregated batch with one PostgreSQL write statement and no read-model journal', async () => {
        const queryRaw = vi.fn(async (_query: unknown) => [
            {
                generalId: 7,
                userId: 'deferred-user',
                refreshScore: 2,
                nextAccessAt: new Date('2026-08-17T03:10:00.000Z'),
            },
        ]);
        const db = {
            worldState: {
                findFirst: vi.fn(async () => ({
                    id: 1,
                    currentYear: 200,
                    currentMonth: 1,
                    tickSeconds: 600,
                    meta: { lastTurnTime: '2026-08-17T03:00:00.000Z', refreshLimit: 50 },
                })),
            },
            $queryRaw: queryRaw,
            $executeRaw: vi.fn(async () => 1),
        };

        await expect(
            flushDeferredGeneralAccessBatch(db as never, 'batch-1', [
                {
                    generalId: 7,
                    userId: 'deferred-user',
                    weight: 2,
                    lastRefresh: new Date('2026-08-17T03:05:00.000Z'),
                },
            ])
        ).resolves.toMatchObject({ refreshLimit: 50, states: [{ refreshScore: 2 }] });

        expect(queryRaw).toHaveBeenCalledTimes(1);
        const statement = queryRaw.mock.calls[0]?.[0] as { sql: string };
        expect(statement.sql).toContain('INSERT INTO "general_access_batch"');
        expect(statement.sql).toContain('jsonb_to_recordset');
        expect(statement.sql).toContain('INSERT INTO "traffic_period"');
        expect(statement.sql).toContain('INSERT INTO "traffic_period_general"');
        expect(statement.sql).toContain('INSERT INTO "general_access_log"');
        expect(statement.sql).not.toContain('read_model_revision');
        expect(statement.sql).not.toContain('read_model_outbox');
    });

    it('drops a rotated batch when profile status is unavailable instead of penalizing it later', async () => {
        const del = vi.fn(async (_key: string) => 1);
        const hGetAll = vi.fn(async (_key: string) => ({}));
        const redis = {
            scanIterator: async function* (_options: { MATCH: string; COUNT: number }) {
                yield [];
            },
            eval: vi.fn(async () => 1),
            hGetAll,
            get: vi.fn(async () => null),
            set: vi.fn(async () => 'OK'),
            del,
        };
        const worker = new DeferredGeneralAccessWorker(
            {} as never,
            redis,
            'hwe:default',
            { get: async () => Promise.reject(new Error('gateway unavailable')) },
            { createBatchId: () => 'status-failure-batch' }
        );

        await worker.flushOnce();

        expect(del).toHaveBeenCalledWith('sammo:game:general-access:batch:hwe:default:status-failure-batch');
        expect(hGetAll).not.toHaveBeenCalled();
    });
});
