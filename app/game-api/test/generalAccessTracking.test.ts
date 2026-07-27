import { describe, expect, it, vi } from 'vitest';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { DatabaseClient } from '../src/context.js';

import { accessPageWeights, recordGeneralAccess, resolveAccessWindows } from '../src/services/generalAccess.js';

const auth = (roles = ['user']): GameSessionTokenPayload => ({
    version: 1,
    profile: 'che:default',
    issuedAt: '2026-07-26T00:00:00.000Z',
    expiresAt: '2026-07-27T00:00:00.000Z',
    sessionId: 'access-session',
    user: {
        id: 'user-7',
        username: 'user7',
        displayName: '사용자7',
        roles,
    },
    sanctions: {},
});

const buildDb = (meta: Record<string, unknown> = {}) => {
    const executeRaw = vi.fn(async (_query: unknown) => 1);
    const queryRaw = vi.fn(async (_query: unknown) => [{ id: 41 }]);
    const transaction = vi.fn(
        async (
            callback: (client: { $executeRaw: typeof executeRaw; $queryRaw: typeof queryRaw }) => Promise<unknown>
        ) => callback({ $executeRaw: executeRaw, $queryRaw: queryRaw })
    );
    const findGeneral = vi.fn(async () => ({ id: 7, userId: 'user-7' }));
    const findWorld = vi.fn(async () => ({
        id: 3,
        currentYear: 185,
        currentMonth: 4,
        tickSeconds: 600,
        meta: {
            opentime: '2026-07-25T00:00:00.000Z',
            lastTurnTime: '2026-07-26T03:00:00.000Z',
            ...meta,
        },
    }));
    const db = {
        $transaction: transaction,
        general: { findFirst: findGeneral },
        worldState: { findFirst: findWorld },
    } as unknown as DatabaseClient;
    return { db, executeRaw, queryRaw, transaction, findGeneral, findWorld };
};

describe('general access tracking', () => {
    it('uses the legacy weight two for both global directory pages', () => {
        expect(accessPageWeights['nation-list']).toBe(2);
        expect(accessPageWeights['general-list']).toBe(2);
    });

    it('uses the latest processed game turn as the traffic period and score window', () => {
        expect(
            resolveAccessWindows(new Date('2026-07-26T03:14:15.000Z'), 600, {
                lastTurnTime: '2026-07-26T03:10:00.000Z',
            })
        ).toEqual({
            periodStartedAt: new Date('2026-07-26T03:10:00.000Z'),
            scoreStartedAt: new Date('2026-07-26T03:10:00.000Z'),
        });
    });

    it('uses the session user actor and the legacy page weight in one atomic upsert', async () => {
        const { db, executeRaw, queryRaw, transaction, findGeneral } = buildDb();
        const now = new Date('2026-07-26T03:05:00.000Z');

        await expect(recordGeneralAccess({ auth: auth(), db }, 'npc-list', now)).resolves.toBe(true);
        expect(findGeneral).toHaveBeenCalledWith({
            where: { userId: 'user-7' },
            orderBy: { id: 'asc' },
            select: { id: true, userId: true },
        });
        expect(transaction).toHaveBeenCalledTimes(1);
        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(executeRaw).toHaveBeenCalledTimes(2);

        const periodStatement = queryRaw.mock.calls[0]![0] as { sql: string; values: unknown[] };
        expect(periodStatement.sql).toContain('INSERT INTO traffic_period');
        expect(periodStatement.sql).toContain('ON CONFLICT (world_state_id, year, month) DO UPDATE');
        expect(periodStatement.values).toEqual([3, 185, 4, new Date('2026-07-26T03:00:00.000Z'), now, 2]);

        const memberStatement = executeRaw.mock.calls[0]![0] as { sql: string; values: unknown[] };
        expect(memberStatement.sql).toContain('INSERT INTO traffic_period_general');
        expect(memberStatement.sql).toContain('ON CONFLICT (period_id, general_id) DO NOTHING');
        expect(memberStatement.sql).toContain('SET online = traffic_period.online');

        const accessStatement = executeRaw.mock.calls[1]![0] as { sql: string; values: unknown[] };
        expect(accessStatement.sql).toContain('ON CONFLICT (general_id) DO UPDATE');
        expect(accessStatement.sql).toContain('general_access_log.refresh + EXCLUDED.refresh');
        expect(accessStatement.values).toContain(7);
        expect(accessStatement.values).toContain('user-7');
        expect(accessStatement.values).toContain(2);
        expect(accessStatement.values).toContain(now);
        expect(accessStatement.values).toContainEqual(new Date('2026-07-26T03:00:00.000Z'));
    });

    it('does not write for anonymous/admin users, a future opening, or a finished world', async () => {
        const anonymous = buildDb();
        await expect(recordGeneralAccess({ auth: null, db: anonymous.db }, 'traffic')).resolves.toBe(false);
        expect(anonymous.findGeneral).not.toHaveBeenCalled();

        const admin = buildDb();
        await expect(recordGeneralAccess({ auth: auth(['admin']), db: admin.db }, 'traffic')).resolves.toBe(false);
        expect(admin.findGeneral).not.toHaveBeenCalled();

        const future = buildDb({ opentime: '2026-07-27T00:00:00.000Z' });
        await expect(
            recordGeneralAccess({ auth: auth(), db: future.db }, 'traffic', new Date('2026-07-26T03:05:00.000Z'))
        ).resolves.toBe(false);
        expect(future.transaction).not.toHaveBeenCalled();

        const united = buildDb({ isUnited: 2 });
        await expect(recordGeneralAccess({ auth: auth(), db: united.db }, 'traffic')).resolves.toBe(false);
        expect(united.transaction).not.toHaveBeenCalled();
    });
});
