import { describe, expect, it, vi } from 'vitest';

import type { TurnDaemonCommand, TurnDaemonCommandResult } from '@sammo-ts/common';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { RedisConnector } from '@sammo-ts/infra';

import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import type { DatabaseClient, GameApiContext, GeneralRow } from '../src/context.js';
import type { TurnDaemonTransport } from '../src/daemon/transport.js';
import { appRouter } from '../src/router.js';

class MemoryRedis {
    private readonly values = new Map<string, string>();

    async get(key: string): Promise<string | null> {
        return this.values.get(key) ?? null;
    }

    async set(key: string, value: string, options?: { NX?: boolean }): Promise<string | null> {
        if (options?.NX && this.values.has(key)) {
            return null;
        }
        this.values.set(key, value);
        return 'OK';
    }

    async del(key: string): Promise<number> {
        return this.values.delete(key) ? 1 : 0;
    }

    async eval(_script: string, options: { keys: string[]; arguments: string[] }): Promise<string> {
        if (options.keys.length === 3 && options.keys[0]?.endsWith(':clock:active-revision')) {
            const current = options.keys.map((key) => this.values.get(key));
            if (current.every((value) => value === undefined)) {
                options.keys.forEach((key, index) => this.values.set(key, options.arguments[index]!));
                return '1';
            }
            return current.every((value, index) => value === options.arguments[index]) ? '2' : '0';
        }
        const fenced = options.keys.at(-1)?.endsWith(':clock:phase') === true;
        const writeCount = options.keys.length - (fenced ? 4 : 1);
        if (fenced) {
            const clockKeys = options.keys.slice(-3);
            const expected = options.arguments.slice(-3);
            if (!clockKeys.every((key, index) => this.values.get(key) === expected[index])) {
                return '__CLOCK_FENCE__';
            }
        }
        const valueKey = options.keys[0];
        const revisionKey = options.keys[writeCount];
        const value = options.arguments[0];
        if (!valueKey || !revisionKey || value === undefined) throw new Error('invalid eval arguments');
        const revision = Number(this.values.get(revisionKey) ?? '0') + 1;
        for (let index = 0; index < writeCount; index += 1) {
            this.values.set(options.keys[index]!, options.arguments[index]!);
        }
        this.values.set(revisionKey, String(revision));
        return String(revision);
    }

    async publish(): Promise<number> {
        return 0;
    }
}

class TournamentTransport implements TurnDaemonTransport {
    readonly commands: TurnDaemonCommand[] = [];
    readonly gold = new Map<number, number>();
    failNextRankUpdate = false;

    async sendCommand(command: TurnDaemonCommand): Promise<string> {
        this.commands.push(command);
        return `command-${this.commands.length}`;
    }

    async requestCommand(command: TurnDaemonCommand): Promise<TurnDaemonCommandResult | null> {
        this.commands.push(command);
        if (command.type === 'adjustGeneralResources') {
            const adjustment = command.adjustments[0];
            if (!adjustment) {
                return { type: 'adjustGeneralResources', ok: false, reason: '조정 대상이 없습니다.' };
            }
            const nextGold = (this.gold.get(adjustment.generalId) ?? 0) + (adjustment.goldDelta ?? 0);
            if (nextGold < (adjustment.minGoldAfter ?? 0)) {
                return { type: 'adjustGeneralResources', ok: false, reason: '자원이 부족합니다.' };
            }
            this.gold.set(adjustment.generalId, nextGold);
            return {
                type: 'adjustGeneralResources',
                ok: true,
                processed: 1,
                missing: 0,
                totalGoldDelta: adjustment.goldDelta ?? 0,
                totalRiceDelta: 0,
            };
        }
        if (command.type === 'setMySetting') {
            return { type: 'setMySetting', ok: true, generalId: command.generalId };
        }
        if (command.type === 'adjustGeneralMeta') {
            if (this.failNextRankUpdate) {
                this.failNextRankUpdate = false;
                return { type: 'adjustGeneralMeta', ok: false, reason: 'rank update failed' };
            }
            return { type: 'adjustGeneralMeta', ok: true, processed: 1, missing: 0 };
        }
        return null;
    }

    async requestStatus() {
        return null;
    }
}

const buildGeneral = (id: number, userId: string, gold = 2_000): GeneralRow =>
    ({
        id,
        userId,
        name: `장수${id}`,
        picture: `${id}.jpg`,
        imageServer: id % 2,
        leadership: 70 + id,
        strength: 60 + id,
        intel: 50 + id,
        gold,
        meta: { explevel: 5 },
    }) as unknown as GeneralRow;

const buildAuth = (userId: string, roles: string[] = []): GameSessionTokenPayload => ({
    version: 1,
    profile: 'che:default',
    issuedAt: '2026-07-26T00:00:00.000Z',
    expiresAt: '2026-07-27T00:00:00.000Z',
    sessionId: `session-${userId}`,
    user: {
        id: userId,
        username: userId,
        displayName: userId,
        roles,
    },
    sanctions: {},
});

const buildContext = (options: {
    redis: MemoryRedis;
    transport: TournamentTransport;
    generals: GeneralRow[];
    userId: string;
    roles?: string[];
    develCost?: number;
    currentDevelCost?: number;
    rankRows?: Array<{ generalId: number; type: string; value: number }>;
    clockPhase?: 'PREOPEN' | 'RUNNING' | 'MANUAL' | 'SUSPENDED' | 'RECONCILING';
    requestId?: string;
}): GameApiContext => {
    const db = {
        general: {
            findFirst: async ({ where }: { where: { userId: string } }) =>
                options.generals.find((general) => general.userId === where.userId) ?? null,
            findMany: async ({ where }: { where: { id: { in: number[] } } }) =>
                options.generals.filter((general) => where.id.in.includes(general.id)),
        },
        rankData: {
            findMany: async () => options.rankRows ?? [],
        },
        worldState: {
            findFirst: async () => ({
                clockBaseTime: new Date('2026-01-01T00:00:00.000Z'),
                clockTick: 0n,
                clockMode: 'realtime',
                clockWallAnchor: new Date('2026-01-01T00:00:00.000Z'),
                clockPhase: options.clockPhase ?? 'RUNNING',
                clockRevision: 1n,
                deadlineGeneration: 1n,
                tickSeconds: 60,
                config: { const: { develCost: options.develCost ?? 200 } },
                ...(options.currentDevelCost === undefined ? {} : { meta: { develcost: options.currentDevelCost } }),
            }),
        },
    } as unknown as DatabaseClient;
    return {
        requestId: options.requestId,
        db,
        redis: options.redis as unknown as RedisConnector['client'],
        turnDaemon: options.transport,
        battleSim: {} as GameApiContext['battleSim'],
        profile: { id: 'che', scenario: 'default', name: 'che:default' },
        uploadDir: 'uploads',
        uploadPath: '/uploads',
        uploadPublicUrl: null,
        auth: buildAuth(options.userId, options.roles),
        accessTokenStore: new RedisAccessTokenStore(options.redis, 'che:default'),
        flushStore: new InMemoryFlushStore(),
        gameTokenSecret: 'test-secret',
    };
};

const setTournamentFixture = async (redis: MemoryRedis, state: Record<string, unknown>) => {
    const prefix = 'sammo:che:default:tournament';
    await redis.set(`${prefix}:state`, JSON.stringify(state));
    await redis.set(
        `${prefix}:participants`,
        JSON.stringify([
            { id: 11, name: '후보11', leadership: 80, strength: 70, intel: 60, level: 5 },
            { id: 12, name: '후보12', leadership: 70, strength: 80, intel: 60, level: 5 },
        ])
    );
    await redis.set(
        `${prefix}:matches`,
        JSON.stringify([{ id: 1, stage: 7, roundIndex: 0, attackerId: 11, defenderId: 12 }])
    );
    await redis.set(`${prefix}:betting`, '[]');
};

describe('tournament router permissions and mutations', () => {
    it('returns persisted group fight logs to an authenticated tournament viewer', async () => {
        const redis = new MemoryRedis();
        const transport = new TournamentTransport();
        const general = buildGeneral(1, 'user-1');
        await setTournamentFixture(redis, {
            stage: 2,
            phase: 1,
            type: 0,
            auto: true,
            openYear: 193,
            openMonth: 1,
            termSeconds: 60,
            nextAt: '2026-07-26T01:00:00.000Z',
        });
        await redis.set(
            'sammo:che:default:tournament:matches',
            JSON.stringify([
                {
                    id: 201,
                    stage: 2,
                    roundIndex: 0,
                    groupId: 0,
                    attackerId: 11,
                    defenderId: 12,
                    winnerId: 11,
                    log: ['<S>●</> <Y>후보11</> <S>승리</>!'],
                },
            ])
        );
        const caller = appRouter.createCaller(
            buildContext({ redis, transport, generals: [general, buildGeneral(11, 'user-11')], userId: 'user-1' })
        );

        const snapshot = await caller.tournament.getSnapshot();

        expect(snapshot.matches).toEqual([
            expect.objectContaining({
                stage: 2,
                groupId: 0,
                attackerId: 11,
                defenderId: 12,
                winnerId: 11,
                log: ['<S>●</> <Y>후보11</> <S>승리</>!'],
            }),
        ]);
    });

    it('charges the authenticated general once when joining', async () => {
        const redis = new MemoryRedis();
        const transport = new TournamentTransport();
        const general = buildGeneral(1, 'user-1');
        transport.gold.set(general.id, general.gold);
        await setTournamentFixture(redis, {
            stage: 1,
            phase: 0,
            type: 0,
            auto: true,
            openYear: 193,
            openMonth: 1,
            termSeconds: 60,
            nextAt: '2026-07-26T01:00:00.000Z',
        });
        await redis.set('sammo:che:default:tournament:participants', '[]');
        const context = buildContext({
            redis,
            transport,
            generals: [general],
            userId: 'user-1',
            develCost: 200,
            requestId: 'http:tournament-join',
        });
        const outerApiTransaction = vi.fn(async () => {
            throw new Error('tournament join must not hold an API transaction while waiting for the daemon');
        });
        Object.assign(context.db, { $transaction: outerApiTransaction });
        const caller = appRouter.createCaller(context);

        await expect(caller.tournament.join()).resolves.toEqual({ ok: true, count: 1 });
        await expect(caller.tournament.join()).resolves.toEqual({ ok: true, count: 1 });

        expect(transport.gold.get(general.id)).toBe(1_800);
        expect(transport.commands.filter((command) => command.type === 'adjustGeneralResources')).toHaveLength(1);
        expect(transport.commands).toContainEqual(
            expect.objectContaining({
                type: 'adjustGeneralResources',
                requestId: 'http:tournament-join:tournamentJoin:resources',
                reason: 'tournamentJoin',
            })
        );
        expect(outerApiTransaction).not.toHaveBeenCalled();
        expect(transport.commands.filter((command) => command.type === 'setMySetting')).toHaveLength(0);
        const snapshot = await caller.tournament.getSnapshot();
        expect(snapshot.participants).toHaveLength(1);
        expect(snapshot.participants[0]).toMatchObject({
            id: general.id,
            groupId: expect.any(Number),
            groupNo: 0,
            win: 0,
            draw: 0,
            lose: 0,
            gl: 0,
        });
        expect(snapshot.participants[0]!.groupId).toBeGreaterThanOrEqual(0);
        expect(snapshot.participants[0]!.groupId).toBeLessThan(8);
    });

    it('charges the current game_env develcost instead of the scenario snapshot', async () => {
        const redis = new MemoryRedis();
        const transport = new TournamentTransport();
        const general = buildGeneral(1, 'user-1');
        transport.gold.set(general.id, general.gold);
        await setTournamentFixture(redis, {
            stage: 1,
            phase: 0,
            type: 0,
            auto: true,
            openYear: 193,
            openMonth: 1,
            termSeconds: 60,
            nextAt: '2026-07-26T01:00:00.000Z',
        });
        await redis.set('sammo:che:default:tournament:participants', '[]');
        const caller = appRouter.createCaller(
            buildContext({
                redis,
                transport,
                generals: [general],
                userId: 'user-1',
                develCost: 200,
                currentDevelCost: 64,
            })
        );

        await expect(caller.tournament.join()).resolves.toEqual({ ok: true, count: 1 });
        expect(transport.gold.get(general.id)).toBe(1_936);
        expect(transport.commands).toContainEqual({
            type: 'adjustGeneralResources',
            reason: 'tournamentJoin',
            adjustments: [{ generalId: general.id, goldDelta: -64, minGoldAfter: 0 }],
        });
    });

    it('serializes concurrent bets and enforces the legacy per-user 1000 limit', async () => {
        const redis = new MemoryRedis();
        const transport = new TournamentTransport();
        const general = buildGeneral(1, 'user-1', 3_000);
        transport.gold.set(general.id, general.gold);
        await setTournamentFixture(redis, {
            stage: 6,
            phase: 0,
            type: 0,
            auto: true,
            openYear: 193,
            openMonth: 1,
            termSeconds: 60,
            nextAt: '2026-07-26T01:00:00.000Z',
            bettingCloseAt: '2099-01-01T00:00:00.000Z',
        });
        const caller = appRouter.createCaller(
            buildContext({ redis, transport, generals: [general], userId: 'user-1' })
        );

        const results = await Promise.allSettled([
            caller.tournament.placeBet({ targetId: 11, amount: 600 }),
            caller.tournament.placeBet({ targetId: 12, amount: 600 }),
        ]);

        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
        const summary = await caller.tournament.getBettingSummary();
        expect(summary.myAmount).toBe(600);
        expect(Object.values(summary.myTotals)).toEqual([600]);
        expect(summary.totalAmount).toBe(600);
        expect(transport.gold.get(general.id)).toBe(2_400);
    });

    it('accepts a tournament bet against the frozen game deadline while the clock is suspended', async () => {
        const redis = new MemoryRedis();
        const transport = new TournamentTransport();
        const general = buildGeneral(1, 'user-1', 3_000);
        transport.gold.set(general.id, general.gold);
        await setTournamentFixture(redis, {
            stage: 6,
            phase: 0,
            type: 0,
            auto: true,
            openYear: 193,
            openMonth: 1,
            termSeconds: 60,
            nextAt: '2026-07-26T01:00:00.000Z',
            bettingCloseAt: '2099-01-01T00:00:00.000Z',
        });
        const context = buildContext({
            redis,
            transport,
            generals: [general],
            userId: 'user-1',
            clockPhase: 'SUSPENDED',
            requestId: 'http:suspended-tournament-bet',
        });
        const outerApiTransaction = vi.fn(async () => {
            throw new Error('tournament bet must not hold an API transaction while waiting for the daemon');
        });
        Object.assign(context.db, { $transaction: outerApiTransaction });
        const caller = appRouter.createCaller(context);

        await expect(caller.tournament.placeBet({ targetId: 11, amount: 600 })).resolves.toEqual({ ok: true });
        expect(transport.gold.get(general.id)).toBe(2_400);
        expect((await caller.tournament.getBettingSummary()).myAmount).toBe(600);
        expect(transport.commands).toContainEqual(
            expect.objectContaining({
                type: 'adjustGeneralResources',
                requestId: 'http:suspended-tournament-bet:tournamentBet:resources',
                reason: 'tournamentBet',
            })
        );
        expect(outerApiTransaction).not.toHaveBeenCalled();
        expect(transport.commands).toContainEqual(
            expect.objectContaining({
                type: 'adjustGeneralMeta',
                requestId: 'http:suspended-tournament-bet:tournamentBet:rank',
                reason: 'tournamentBet',
            })
        );
    });

    it('rejects a tournament bet during reconciliation without debiting gold', async () => {
        const redis = new MemoryRedis();
        const transport = new TournamentTransport();
        const general = buildGeneral(1, 'user-1', 3_000);
        transport.gold.set(general.id, general.gold);
        await setTournamentFixture(redis, {
            stage: 6,
            phase: 0,
            type: 0,
            auto: true,
            openYear: 193,
            openMonth: 1,
            termSeconds: 60,
            nextAt: '2026-07-26T01:00:00.000Z',
            bettingCloseAt: '2099-01-01T00:00:00.000Z',
        });
        const caller = appRouter.createCaller(
            buildContext({ redis, transport, generals: [general], userId: 'user-1', clockPhase: 'RECONCILING' })
        );

        await expect(caller.tournament.placeBet({ targetId: 11, amount: 600 })).rejects.toMatchObject({
            code: 'PRECONDITION_FAILED',
        });
        expect(transport.gold.get(general.id)).toBe(3_000);
        expect(transport.commands).toHaveLength(0);
    });

    it('keeps another user from reading my bet identity and requires that user to own a general', async () => {
        const redis = new MemoryRedis();
        const transport = new TournamentTransport();
        const owner = buildGeneral(1, 'user-1');
        const other = buildGeneral(2, 'user-2');
        await setTournamentFixture(redis, {
            stage: 6,
            phase: 0,
            type: 0,
            auto: true,
            openYear: 193,
            openMonth: 1,
            termSeconds: 60,
            nextAt: '2026-07-26T01:00:00.000Z',
        });
        await redis.set(
            'sammo:che:default:tournament:betting',
            JSON.stringify([{ generalId: owner.id, targetId: 11, amount: 300 }])
        );

        const otherCaller = appRouter.createCaller(
            buildContext({ redis, transport, generals: [owner, other], userId: 'user-2' })
        );
        const snapshot = await otherCaller.tournament.getSnapshot();
        expect(snapshot).toMatchObject({ betCount: 1 });
        expect(snapshot).not.toHaveProperty('bets');
        expect((await otherCaller.tournament.getBettingSummary()).myAmount).toBe(0);

        const generalLessCaller = appRouter.createCaller(
            buildContext({ redis, transport, generals: [owner], userId: 'user-3' })
        );
        await expect(generalLessCaller.tournament.getSnapshot()).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await expect(generalLessCaller.tournament.join()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('limits tournament administration to global or profile-scoped roles', async () => {
        const redis = new MemoryRedis();
        const transport = new TournamentTransport();
        const general = buildGeneral(1, 'user-1');
        const userCaller = appRouter.createCaller(
            buildContext({ redis, transport, generals: [general], userId: 'user-1', roles: ['user'] })
        );
        await expect(userCaller.tournament.getAdminStatus()).rejects.toMatchObject({ code: 'FORBIDDEN' });

        const adminCaller = appRouter.createCaller(
            buildContext({
                redis,
                transport,
                generals: [general],
                userId: 'user-1',
                roles: ['admin.tournament:che:default'],
            })
        );
        await expect(adminCaller.tournament.getAdminStatus()).resolves.toMatchObject({
            ok: true,
            clock: { reconciliationComplete: false, latestReconciliation: null },
        });
    });

    it('applies the admin role boundary to every tournament mutation', async () => {
        const redis = new MemoryRedis();
        const transport = new TournamentTransport();
        const general = buildGeneral(1, 'user-1');
        const caller = appRouter.createCaller(
            buildContext({ redis, transport, generals: [general], userId: 'user-1', roles: ['user'] })
        );
        const state = {
            stage: 1,
            phase: 0,
            type: 0,
            auto: false,
            openYear: 193,
            openMonth: 1,
            termSeconds: 60,
            nextAt: '2026-07-26T01:00:00.000Z',
        };

        await expect(caller.tournament.setState(state)).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(caller.tournament.patchState({ phase: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(caller.tournament.setParticipants([])).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(caller.tournament.setMatches([])).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(caller.tournament.setBettingEntries([])).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(caller.tournament.seedParticipants({ generalIds: [general.id] })).rejects.toMatchObject({
            code: 'FORBIDDEN',
        });
        await expect(caller.tournament.cancel()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('validates and executes every profile-scoped tournament admin mutation', async () => {
        const redis = new MemoryRedis();
        const transport = new TournamentTransport();
        const general = buildGeneral(1, 'user-1');
        const rival = buildGeneral(2, 'user-2');
        const caller = appRouter.createCaller(
            buildContext({
                redis,
                transport,
                generals: [general, rival],
                userId: 'user-1',
                roles: ['admin.tournament:che:default'],
            })
        );
        const state = {
            stage: 6,
            phase: 0,
            type: 0,
            auto: false,
            openYear: 193,
            openMonth: 1,
            termSeconds: 60,
            nextAt: '2026-07-26T01:00:00.000Z',
            bettingCloseAt: '2099-01-01T00:00:00.000Z',
        };

        await expect(caller.tournament.setState(state)).resolves.toEqual({ ok: true });
        await expect(caller.tournament.patchState({ phase: 2 })).resolves.toEqual({ ok: true });
        await expect(
            caller.tournament.setParticipants([
                {
                    id: general.id,
                    name: general.name,
                    leadership: general.leadership,
                    strength: general.strength,
                    intel: general.intel,
                    level: 5,
                    groupId: 0,
                },
            ])
        ).resolves.toEqual({ ok: true, count: 1 });
        await expect(
            caller.tournament.setMatches([
                {
                    id: 1,
                    stage: 7,
                    roundIndex: 0,
                    attackerId: general.id,
                    defenderId: rival.id,
                },
            ])
        ).resolves.toEqual({ ok: true, count: 1 });
        await expect(
            caller.tournament.setBettingEntries([{ generalId: general.id, targetId: rival.id, amount: 100 }])
        ).resolves.toEqual({ ok: true, count: 1 });
        await expect(caller.tournament.seedParticipants({ generalIds: [general.id, rival.id] })).resolves.toEqual({
            ok: true,
            count: 2,
        });

        await expect(caller.tournament.cancel()).resolves.toEqual({ ok: true });
        expect(transport.commands).toContainEqual({
            type: 'tournamentRefund',
            refunds: [{ generalId: general.id, amount: 100 }],
            reason: 'cancel',
        });
        await expect(caller.tournament.getState()).resolves.toMatchObject({ stage: 0, phase: 0, auto: false });
        await expect(caller.tournament.getSnapshot()).resolves.toMatchObject({
            participants: [],
            matches: [],
            betCount: 0,
        });
    });

    it('returns the legacy tournament rank ordering only to a user who owns a general', async () => {
        const redis = new MemoryRedis();
        const transport = new TournamentTransport();
        const first = buildGeneral(1, 'user-1');
        const second = buildGeneral(2, 'user-2');
        const rankRows = [
            { generalId: first.id, type: 'ttg', value: 20 },
            { generalId: first.id, type: 'ttw', value: 3 },
            { generalId: second.id, type: 'ttg', value: 20 },
            { generalId: second.id, type: 'ttw', value: 4 },
        ];
        const ownerCaller = appRouter.createCaller(
            buildContext({ redis, transport, generals: [first, second], userId: 'user-1', rankRows })
        );
        const sections = await ownerCaller.tournament.getRankings();
        expect(sections).toHaveLength(4);
        expect(sections[0]?.entries.map((entry) => entry.generalId)).toEqual([second.id, first.id]);
        expect(sections[0]?.entries[0]).toMatchObject({
            picture: '2.jpg',
            imageServer: 0,
        });

        const generalLessCaller = appRouter.createCaller(
            buildContext({ redis, transport, generals: [first, second], userId: 'user-3', rankRows })
        );
        await expect(generalLessCaller.tournament.getRankings()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('joins current dedicated icon metadata to the public tournament snapshot', async () => {
        const redis = new MemoryRedis();
        const transport = new TournamentTransport();
        const owner = buildGeneral(11, 'user-1');
        const rival = buildGeneral(12, 'user-2');
        await setTournamentFixture(redis, {
            stage: 7,
            phase: 0,
            type: 0,
            auto: true,
            openYear: 193,
            openMonth: 1,
            termSeconds: 60,
            nextAt: '2026-07-26T01:00:00.000Z',
        });
        await redis.set('sammo:che:default:tournament:source-revision', '41');
        const caller = appRouter.createCaller(
            buildContext({ redis, transport, generals: [owner, rival], userId: 'user-1' })
        );

        const snapshot = await caller.tournament.getSnapshot();

        expect(snapshot.participants).toEqual([
            expect.objectContaining({ id: 11, picture: '11.jpg', imageServer: 1 }),
            expect.objectContaining({ id: 12, picture: '12.jpg', imageServer: 0 }),
        ]);
        expect(snapshot.sourceRevision).toBe('41');
    });

    it('refunds gold when the tournament bet rank update fails', async () => {
        const redis = new MemoryRedis();
        const transport = new TournamentTransport();
        const general = buildGeneral(1, 'user-1', 2_000);
        transport.gold.set(general.id, general.gold);
        transport.failNextRankUpdate = true;
        await setTournamentFixture(redis, {
            stage: 6,
            phase: 0,
            type: 0,
            auto: true,
            openYear: 193,
            openMonth: 1,
            termSeconds: 60,
            nextAt: '2026-07-26T01:00:00.000Z',
            bettingCloseAt: '2099-01-01T00:00:00.000Z',
        });
        const caller = appRouter.createCaller(
            buildContext({ redis, transport, generals: [general], userId: 'user-1' })
        );

        await expect(caller.tournament.placeBet({ targetId: 11, amount: 100 })).rejects.toMatchObject({
            code: 'INTERNAL_SERVER_ERROR',
        });
        expect(transport.gold.get(general.id)).toBe(2_000);
        await expect(caller.tournament.getBettingSummary()).resolves.toMatchObject({
            totalAmount: 0,
            myAmount: 0,
        });
    });
});
