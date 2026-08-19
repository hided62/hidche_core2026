import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';

import type { GameApiContext } from '../src/context.js';
import { authedProcedure, router, sessionActivityProcedure } from '../src/trpc.js';

const auth = (roles: string[] = ['user']): GameSessionTokenPayload => ({
    version: 1,
    profile: 'che:default',
    issuedAt: '2026-08-19T00:00:00.000Z',
    expiresAt: '2026-08-20T00:00:00.000Z',
    sessionId: 'activity-session',
    user: {
        id: 'activity-user',
        username: 'activity-user',
        displayName: '활동 사용자',
        roles,
    },
    sanctions: {},
});

const buildContext = (executeRaw = vi.fn(async (_query: unknown) => 1), token = auth()) =>
    ({
        auth: token,
        db: { $executeRaw: executeRaw },
        generalAccessTracking: true,
        profile: { id: 'che:default', name: 'che', scenario: 'default' },
    }) as unknown as GameApiContext;

const activityRouter = router({
    read: authedProcedure.query(() => 'read'),
    act: authedProcedure.mutation(() => 'acted'),
    rejected: authedProcedure.mutation(() => {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'rejected' });
    }),
    pageRefresh: sessionActivityProcedure.mutation(() => 'refreshed'),
});

describe('general action tracking', () => {
    it('records only a completed authenticated mutation, not reads, page refreshes, or rejected actions', async () => {
        const executeRaw = vi.fn(async (_query: unknown) => 1);
        const caller = activityRouter.createCaller(buildContext(executeRaw));

        await expect(caller.read()).resolves.toBe('read');
        await expect(caller.pageRefresh()).resolves.toBe('refreshed');
        await expect(caller.rejected()).rejects.toMatchObject({ code: 'BAD_REQUEST' });
        expect(executeRaw).not.toHaveBeenCalled();

        await expect(caller.act()).resolves.toBe('acted');
        expect(executeRaw).toHaveBeenCalledTimes(1);
        const statement = executeRaw.mock.calls[0]![0] as { sql: string; values: unknown[] };
        expect(statement.sql).toContain('INSERT INTO general_access_log');
        expect(statement.sql).toContain('last_action_at');
        expect(statement.sql).toContain('FROM "general"');
        expect(statement.values).toContain('activity-user');
    });

    it('does not mark admin mutations and never overturns a completed action when presence persistence fails', async () => {
        const adminWrite = vi.fn(async (_query: unknown) => 1);
        await expect(activityRouter.createCaller(buildContext(adminWrite, auth(['admin']))).act()).resolves.toBe(
            'acted'
        );
        expect(adminWrite).not.toHaveBeenCalled();

        const failedWrite = vi.fn(async (_query: unknown) => Promise.reject(new Error('presence unavailable')));
        await expect(activityRouter.createCaller(buildContext(failedWrite)).act()).resolves.toBe('acted');
        expect(failedWrite).toHaveBeenCalledTimes(1);
    });
});
