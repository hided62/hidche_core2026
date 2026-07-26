import { describe, expect, it, vi } from 'vitest';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { DatabaseClient } from '../src/context.js';

import { recordGeneralAccess, resolveAccessWindows } from '../src/services/generalAccess.js';

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
    const findGeneral = vi.fn(async () => ({ id: 7, userId: 'user-7' }));
    const findWorld = vi.fn(async () => ({
        tickSeconds: 600,
        meta: {
            opentime: '2026-07-25T00:00:00.000Z',
            lastTurnTime: '2026-07-26T03:00:00.000Z',
            ...meta,
        },
    }));
    const db = {
        $executeRaw: executeRaw,
        general: { findFirst: findGeneral },
        worldState: { findFirst: findWorld },
    } as unknown as DatabaseClient;
    return { db, executeRaw, findGeneral, findWorld };
};

describe('general access tracking', () => {
    it('resolves the UTC day and latest processed turn windows', () => {
        expect(
            resolveAccessWindows(new Date('2026-07-26T03:14:15.000Z'), 600, {
                lastTurnTime: '2026-07-26T03:10:00.000Z',
            })
        ).toEqual({
            dayStartedAt: new Date('2026-07-26T00:00:00.000Z'),
            scoreStartedAt: new Date('2026-07-26T03:10:00.000Z'),
        });
    });

    it('uses the session user actor and the legacy page weight in one atomic upsert', async () => {
        const { db, executeRaw, findGeneral } = buildDb();
        const now = new Date('2026-07-26T03:05:00.000Z');

        await expect(recordGeneralAccess({ auth: auth(), db }, 'npc-list', now)).resolves.toBe(true);
        expect(findGeneral).toHaveBeenCalledWith({
            where: { userId: 'user-7' },
            orderBy: { id: 'asc' },
            select: { id: true, userId: true },
        });
        expect(executeRaw).toHaveBeenCalledTimes(1);

        const statement = executeRaw.mock.calls[0]![0] as { sql: string; values: unknown[] };
        expect(statement.sql).toContain('ON CONFLICT (general_id) DO UPDATE');
        expect(statement.sql).toContain('general_access_log.refresh + EXCLUDED.refresh');
        expect(statement.values).toEqual([
            7,
            'user-7',
            now,
            2,
            2,
            2,
            2,
            new Date('2026-07-26T00:00:00.000Z'),
            new Date('2026-07-26T03:00:00.000Z'),
        ]);
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
        expect(future.executeRaw).not.toHaveBeenCalled();

        const united = buildDb({ isUnited: 2 });
        await expect(recordGeneralAccess({ auth: auth(), db: united.db }, 'traffic')).resolves.toBe(false);
        expect(united.executeRaw).not.toHaveBeenCalled();
    });
});
