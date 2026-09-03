import { describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { z } from 'zod';
import type { GameApiContext } from '../src/context.js';
import type { DatabaseClient } from '../src/context.js';
import { createApiInputPayloadIdentity } from '../src/inputEventBoundary.js';

import {
    accessAuthedProcedure,
    accessAuthedInputProcedure,
    accessLimitAuthedProcedure,
    deferredAccessLimitAuthedProcedure,
    router,
} from '../src/trpc.js';
import {
    accessPageWeights,
    generalAccessEndpointWeights,
    getGeneralAccessState,
    recordGeneralAccess,
    recordGeneralAccessWeight,
    resolveGeneralAccessEndpointWeight,
    resolveAccessWindows,
    resolveGeneralScoreStartedAt,
    shouldRecordGeneralAccessEndpoint,
} from '../src/services/generalAccess.js';

const profile = { id: 'che', name: 'che:default', scenario: 'default' };
const profileStatusSource = { get: vi.fn(async () => 'RUNNING' as const) };
const accessContext = (db: DatabaseClient, token: GameSessionTokenPayload | null = auth()) => ({
    auth: token,
    db,
    profile,
    profileStatusSource,
    generalAccessTracking: true as const,
});

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

const buildDb = (
    meta: Record<string, unknown> = {},
    access: { lastRefresh: Date | null; refreshScore: number } | null = null
) => {
    const executeRaw = vi.fn(async (_query: unknown) => 1);
    const queryRaw = vi.fn(async (query: unknown) => {
        const sql = (query as { sql?: string }).sql ?? '';
        if (sql.includes('read_model_revision')) {
            return [{ domain: 'access.general', entityId: 7, revision: 1n, outboxId: 1n }];
        }
        return [{ id: 41 }];
    });
    const transaction = vi.fn(
        async (
            callback: (client: { $executeRaw: typeof executeRaw; $queryRaw: typeof queryRaw }) => Promise<unknown>
        ) => callback({ $executeRaw: executeRaw, $queryRaw: queryRaw })
    );
    const findGeneral = vi.fn(async () => ({
        id: 7,
        userId: 'user-7',
        turnTime: new Date('2026-07-26T03:10:00.000Z'),
    }));
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
        generalAccessLog: { findUnique: vi.fn(async () => access) },
        worldState: { findFirst: findWorld },
    } as unknown as DatabaseClient;
    return { db, executeRaw, queryRaw, transaction, findGeneral, findWorld };
};

describe('general access tracking', () => {
    it('owns every migrated Ref call at one explicit server endpoint weight', () => {
        expect(generalAccessEndpointWeights).toEqual({
            'world.getGeneralDirectory': 2,
            'public.getNpcList': 2,
            'ranking.getBestGeneral': 1,
            'ranking.getHallOfFame': 1,
            'tournament.getSnapshot': 1,
            'nation.getSecretGeneralList': 1,
            'nation.getPersonnelInfo': 1,
            'nation.getGeneralList': 1,
            'general.ensureDieOnPrestartStatus': 1,
            'nation.getStratFinan': 1,
            'board.getArticles': 1,
            'diplomacy.getLetters': 2,
            'battle.getGeneralDetail': 1,
            'betting.getList': 1,
            'yearbook.getHistory': 1,
            'world.getGlobalInfo': 1,
            'nation.getBattleCenter': 1,
            'nation.getChiefCenter': 1,
            'troop.getList': 1,
            'board.writeArticle': 1,
            'board.writeComment': 1,
            'diplomacy.sendLetter': 1,
            'diplomacy.respondLetter': 1,
            'diplomacy.rollbackLetter': 1,
            'diplomacy.destroyLetter': 1,
            'general.buildNationCandidate': 1,
            'general.dieOnPrestart': 1,
            'general.instantRetreat': 1,
            'messages.send': 1,
            'turns.getCommandTable': 1,
            'general.setMySetting': 0,
            'npc.setNationPolicy': 0,
            'npc.setNationPriority': 0,
            'npc.setGeneralPriority': 0,
            'battle.prepareSimulation': 0,
            'battle.simulate': 0,
        });
    });

    it('counts only current-profile yearbook reads like Ref Global.GetHistory', () => {
        expect(resolveGeneralAccessEndpointWeight('yearbook.getHistory', {}, 'che')).toBe(1);
        expect(resolveGeneralAccessEndpointWeight('yearbook.getHistory', { serverID: 'che' }, 'che')).toBe(1);
        expect(resolveGeneralAccessEndpointWeight('yearbook.getHistory', { serverID: 'hwe' }, 'che')).toBeNull();
        expect(resolveGeneralAccessEndpointWeight('general.getFrontStatus', {}, 'che')).toBeUndefined();
        expect(resolveGeneralAccessEndpointWeight('unknown.path', {}, 'che')).toBeUndefined();
    });

    it('keeps the legacy route weight while endpoint-owned directories use the server map', () => {
        expect(accessPageWeights['nation-list']).toBe(2);
        expect(generalAccessEndpointWeights['world.getGeneralDirectory']).toBe(2);
    });

    it('waives score only for a server-proven tournament snapshot refresh', () => {
        expect(shouldRecordGeneralAccessEndpoint('tournament.getSnapshot', true)).toBe(false);
        expect(shouldRecordGeneralAccessEndpoint('tournament.getSnapshot', false)).toBe(true);
        expect(shouldRecordGeneralAccessEndpoint('world.getGeneralDirectory', true)).toBe(true);
    });

    it('keeps the existing hard limit gate on a granted tournament refresh', async () => {
        const now = new Date();
        const fixture = buildDb({ lastTurnTime: now.toISOString() }, { lastRefresh: now, refreshScore: 999 });
        const tournamentBoundary = router({
            tournament: router({ getSnapshot: accessAuthedProcedure.query(() => ({ ok: true })) }),
        });
        const caller = tournamentBoundary.createCaller({
            ...accessContext(fixture.db),
            realtimeAccessGranted: true,
        } as unknown as GameApiContext);

        await expect(caller.tournament.getSnapshot()).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
        expect(fixture.executeRaw).not.toHaveBeenCalled();
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
        expect(resolveGeneralScoreStartedAt(600, new Date('2026-07-26T03:20:00.000Z'))).toEqual(
            new Date('2026-07-26T03:10:00.000Z')
        );
    });

    it('uses the session user actor and the legacy page weight in one atomic upsert', async () => {
        const { db, executeRaw, queryRaw, transaction, findGeneral } = buildDb();
        const now = new Date('2026-07-26T03:05:00.000Z');

        await expect(recordGeneralAccess(accessContext(db), 'nation-list', now)).resolves.toBe(true);
        expect(findGeneral).toHaveBeenCalledWith({
            where: { userId: 'user-7' },
            orderBy: { id: 'asc' },
            select: { id: true, userId: true, turnTime: true },
        });
        expect(transaction).toHaveBeenCalledTimes(1);
        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(executeRaw).toHaveBeenCalledTimes(3);

        const lockStatement = executeRaw.mock.calls[0]![0] as { sql: string; values: unknown[] };
        expect(lockStatement.sql).toContain('pg_advisory_xact_lock');
        expect(lockStatement.values).toContain('general-access:persistence');

        const periodStatement = queryRaw.mock.calls[0]![0] as { sql: string; values: unknown[] };
        expect(periodStatement.sql).toContain('INSERT INTO traffic_period');
        expect(periodStatement.sql).toContain('generate_series');
        expect(periodStatement.sql).toContain('ON CONFLICT (world_state_id, year, month) DO UPDATE');
        expect(periodStatement.values).toContain(3);
        expect(periodStatement.values).toContain(185);
        expect(periodStatement.values).toContain(4);
        expect(periodStatement.values).toContain(600);
        expect(periodStatement.values).toContain(2);
        expect(periodStatement.values).toContain(now);
        expect(periodStatement.values).toContainEqual(new Date('2026-07-26T03:00:00.000Z'));

        const memberStatement = executeRaw.mock.calls[1]![0] as { sql: string; values: unknown[] };
        expect(memberStatement.sql).toContain('INSERT INTO traffic_period_general');
        expect(memberStatement.sql).toContain('ON CONFLICT (period_id, general_id) DO NOTHING');
        expect(memberStatement.sql).toContain('SET online = traffic_period.online');

        const accessStatement = executeRaw.mock.calls[2]![0] as { sql: string; values: unknown[] };
        expect(accessStatement.sql).toContain('ON CONFLICT (general_id) DO UPDATE');
        expect(accessStatement.sql).toContain('general_access_log.refresh + EXCLUDED.refresh');
        expect(accessStatement.values).toContain(7);
        expect(accessStatement.values).toContain('user-7');
        expect(accessStatement.values).toContain(2);
        expect(accessStatement.values).toContain(now);
        expect(accessStatement.values).toContainEqual(new Date('2026-07-26T03:00:00.000Z'));
    });

    it('accepts legacy weight zero to refresh timestamps without incrementing counters', async () => {
        const { db, executeRaw, queryRaw, transaction } = buildDb();
        const now = new Date('2026-07-26T03:06:00.000Z');

        await expect(recordGeneralAccessWeight(accessContext(db), 0, now)).resolves.toBe(true);
        expect(transaction).toHaveBeenCalledTimes(1);
        expect((queryRaw.mock.calls[0]![0] as { values: unknown[] }).values).toContain(0);
        expect((executeRaw.mock.calls[1]![0] as { values: unknown[] }).values).toContain(0);
        expect((executeRaw.mock.calls[2]![0] as { values: unknown[] }).values).toContain(0);
        expect((executeRaw.mock.calls[2]![0] as { values: unknown[] }).values).toContain(now);
    });

    it('blocks above the strict limit and lazily clears a score from before the own turn', async () => {
        const blocked = buildDb(
            { refreshLimit: 120 },
            { lastRefresh: new Date('2026-07-26T03:05:00.000Z'), refreshScore: 121 }
        );
        await expect(getGeneralAccessState(accessContext(blocked.db))).resolves.toMatchObject({
            refreshScore: 121,
            refreshLimit: 120,
            level: 2,
            nextAccessAt: new Date('2026-07-26T03:10:00.000Z'),
        });

        const stale = buildDb(
            { refreshLimit: 120 },
            { lastRefresh: new Date('2026-07-26T02:59:59.999Z'), refreshScore: 999 }
        );
        await expect(getGeneralAccessState(accessContext(stale.db))).resolves.toMatchObject({
            refreshScore: 0,
            level: 0,
        });

        const resolver = vi.fn(() => ({ ok: true }));
        const limitedRouter = router({ read: accessLimitAuthedProcedure.query(resolver) });
        await expect(
            limitedRouter.createCaller(accessContext(blocked.db) as unknown as GameApiContext).read()
        ).rejects.toMatchObject({
            code: 'TOO_MANY_REQUESTS',
            message: expect.stringContaining('자신의 턴이 되면 다시 접속 가능합니다.'),
        });
        expect(resolver).not.toHaveBeenCalled();
    });

    it('checks a deferred limit with Redis only and does not query PostgreSQL', async () => {
        const fixture = buildDb();
        const resolver = vi.fn(() => ({ ok: true }));
        const limitedRouter = router({ read: deferredAccessLimitAuthedProcedure.query(resolver) });
        const get = vi.fn(async () => JSON.stringify({ nextAccessAt: '2099-07-26T03:10:00.000Z' }));

        await expect(
            limitedRouter
                .createCaller({
                    ...accessContext(fixture.db),
                    redis: { get },
                } as unknown as GameApiContext)
                .read()
        ).rejects.toMatchObject({
            code: 'TOO_MANY_REQUESTS',
            message: expect.stringContaining('다음 접속 가능 시각'),
        });
        expect(get).toHaveBeenCalledTimes(1);
        expect(fixture.findGeneral).not.toHaveBeenCalled();
        expect(fixture.findWorld).not.toHaveBeenCalled();
        expect(fixture.db.generalAccessLog.findUnique).not.toHaveBeenCalled();
        expect(resolver).not.toHaveBeenCalled();
    });

    it('rejects weights that cannot come from a server-owned Ref call boundary', async () => {
        const fixture = buildDb();
        await expect(recordGeneralAccessWeight(accessContext(fixture.db), -1)).rejects.toBeInstanceOf(RangeError);
        await expect(recordGeneralAccessWeight(accessContext(fixture.db), 0.5)).rejects.toBeInstanceOf(RangeError);
        expect(fixture.findGeneral).not.toHaveBeenCalled();
    });

    it('parses input, commits access, and only then opens the failing business event boundary', async () => {
        const events: string[] = [];
        let transactionCount = 0;
        const transactionClient = {
            $queryRaw: vi.fn(async (query: unknown) => {
                const sql = (query as { sql?: string }).sql ?? '';
                if (sql.includes('FROM input_event')) {
                    return [
                        {
                            target: 'API',
                            eventType: 'board.writeArticle',
                            payload: createApiInputPayloadIdentity({ value: 'ok' }),
                            actorUserId: 'user-7',
                            status: 'PENDING',
                            result: null,
                            attempts: 0,
                        },
                    ];
                }
                return sql.includes('read_model_revision')
                    ? [{ domain: 'access.general', entityId: 7, revision: 1n, outboxId: 1n }]
                    : [{ id: 41 }];
            }),
            $executeRaw: vi.fn(async (query: unknown) => {
                if (((query as { sql?: string }).sql ?? '').includes('INSERT INTO input_event')) {
                    events.push('input-event-create');
                }
                return 1;
            }),
            $executeRawUnsafe: vi.fn(async () => 0),
            inputEvent: {
                update: vi.fn(async (args: { data: { status: string } }) => {
                    if (args.data.status === 'FAILED') events.push('input-event-failed');
                    return {};
                }),
            },
        };
        const db = {
            general: {
                findFirst: vi.fn(async () => ({
                    id: 7,
                    userId: 'user-7',
                    turnTime: new Date('2026-07-26T03:10:00.000Z'),
                })),
            },
            generalAccessLog: {
                findUnique: vi.fn(async () => ({
                    lastRefresh: new Date('2026-07-26T03:05:00.000Z'),
                    refreshScore: 1,
                })),
            },
            worldState: {
                findFirst: vi.fn(async () => ({
                    id: 3,
                    currentYear: 185,
                    currentMonth: 4,
                    tickSeconds: 600,
                    meta: {
                        opentime: '2026-07-25T00:00:00.000Z',
                        lastTurnTime: '2026-07-26T03:00:00.000Z',
                    },
                })),
            },
            $transaction: vi.fn(async (callback: (client: typeof transactionClient) => Promise<unknown>) => {
                transactionCount += 1;
                events.push(transactionCount === 1 ? 'access-transaction' : 'business-transaction');
                return callback(transactionClient);
            }),
        };
        const trackedRouter = router({
            board: router({
                writeArticle: accessAuthedInputProcedure(
                    z.object({
                        value: z.string().transform((value) => {
                            events.push('input-parse');
                            return value;
                        }),
                    })
                ).mutation(() => {
                    events.push('resolver');
                    throw new TRPCError({ code: 'BAD_REQUEST', message: 'business rejected' });
                }),
            }),
        });
        const context = {
            auth: auth(),
            db,
            generalAccessTracking: true,
            requestId: 'access-boundary-test',
            profile: { id: 'che:default', name: 'che' },
            profileStatusSource,
        } as unknown as GameApiContext;

        await expect(trackedRouter.createCaller(context).board.writeArticle({ value: 'ok' })).rejects.toMatchObject({
            message: 'business rejected',
        });
        expect(events).toEqual([
            'input-parse',
            'access-transaction',
            'business-transaction',
            'input-event-create',
            'resolver',
            'input-event-failed',
        ]);

        events.length = 0;
        transactionCount = 0;
        await expect(
            trackedRouter.createCaller(context).board.writeArticle({ value: 7 } as never)
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
        });
        expect(events).toEqual([]);
    });

    it('does not write for anonymous/admin users, a future opening, or a finished world', async () => {
        const anonymous = buildDb();
        await expect(recordGeneralAccess(accessContext(anonymous.db, null), 'traffic')).resolves.toBe(false);
        expect(anonymous.findGeneral).not.toHaveBeenCalled();

        const admin = buildDb();
        await expect(recordGeneralAccess(accessContext(admin.db, auth(['admin'])), 'traffic')).resolves.toBe(false);
        expect(admin.findGeneral).not.toHaveBeenCalled();

        const future = buildDb({ opentime: '2026-07-27T00:00:00.000Z' });
        await expect(
            recordGeneralAccess(accessContext(future.db), 'traffic', new Date('2026-07-26T03:05:00.000Z'))
        ).resolves.toBe(false);
        expect(future.transaction).not.toHaveBeenCalled();

        const united = buildDb({ isUnited: 2 });
        await expect(recordGeneralAccess(accessContext(united.db), 'traffic')).resolves.toBe(false);
        expect(united.transaction).not.toHaveBeenCalled();

        const paused = buildDb();
        const pausedContext = {
            ...accessContext(paused.db),
            profileStatusSource: { get: vi.fn(async () => 'PAUSED' as const) },
        };
        await expect(recordGeneralAccess(pausedContext, 'traffic')).resolves.toBe(false);
        expect(paused.findGeneral).not.toHaveBeenCalled();

        const unavailable = buildDb();
        const unavailableContext = {
            ...accessContext(unavailable.db),
            profileStatusSource: { get: vi.fn(async () => Promise.reject(new Error('gateway unavailable'))) },
        };
        await expect(recordGeneralAccess(unavailableContext, 'traffic')).resolves.toBe(false);
        expect(unavailable.findGeneral).not.toHaveBeenCalled();
    });
});
