import { describe, expect, it } from 'vitest';
import { TournamentType } from '@sammo-ts/logic';
import type { TurnDaemonCommand } from '@sammo-ts/common';
import { createTournamentAutoStartHandler } from '@sammo-ts/common';

import { TournamentStore } from '../src/tournament/store.js';
import { buildTournamentKeys } from '../src/tournament/keys.js';
import type {
    TournamentBetEntry,
    TournamentMatchEntry,
    TournamentParticipantEntry,
    TournamentState,
} from '../src/tournament/types.js';
import { applyBattle, applyPreBattleStage, settleTournamentOutcome } from '../src/tournament/worker.js';
import { buildBettingPayouts, resolveBettingCloseAt, resolveNextAt } from '../src/tournament/workerHelpers.js';
import type { TurnDaemonTransport } from '../src/daemon/transport.js';

class MemoryRedis {
    private readonly store = new Map<string, string>();

    async get(key: string): Promise<string | null> {
        return this.store.get(key) ?? null;
    }

    async set(key: string, value: string): Promise<string> {
        this.store.set(key, value);
        return 'OK';
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const createNoopDaemonTransport = (): TurnDaemonTransport => ({
    sendCommand: async () => 'ok',
    requestCommand: async () => null,
    requestStatus: async () => null,
});

const createTournamentState = (overrides: Partial<TournamentState> = {}): TournamentState => {
    const now = new Date().toISOString();
    return {
        stage: 1,
        phase: 0,
        type: TournamentType.TOTAL,
        auto: true,
        openYear: 1,
        openMonth: 2,
        termSeconds: 10,
        nextAt: now,
        bettingId: undefined,
        bettingCloseAt: undefined,
        winnerId: undefined,
        bettingSettled: false,
        rewardSettled: false,
        participantsLockedAt: undefined,
        lastError: undefined,
        lastErrorAt: undefined,
        ...overrides,
    };
};

const createParticipants = (high: number, mid: number, low: number): TournamentParticipantEntry[] => {
    const result: TournamentParticipantEntry[] = [];
    let cursor = 1;
    for (let i = 0; i < high; i += 1) {
        result.push({
            id: cursor,
            name: `상급${cursor}`,
            leadership: 90,
            strength: 90,
            intel: 90,
            level: 50,
        });
        cursor += 1;
    }
    for (let i = 0; i < mid; i += 1) {
        result.push({
            id: cursor,
            name: `중급${cursor}`,
            leadership: 60,
            strength: 60,
            intel: 60,
            level: 30,
        });
        cursor += 1;
    }
    for (let i = 0; i < low; i += 1) {
        result.push({
            id: cursor,
            name: `하급${cursor}`,
            leadership: 30,
            strength: 30,
            intel: 30,
            level: 10,
        });
        cursor += 1;
    }
    return result;
};

const createPrismaMock = (options: {
    applicants?: Array<{
        id: number;
        name: string;
        leadership: number;
        strength: number;
        intel: number;
        meta: Record<string, unknown>;
        npcState: number;
    }>;
    npcs?: Array<{
        id: number;
        name: string;
        leadership: number;
        strength: number;
        intel: number;
        meta: Record<string, unknown>;
        npcState: number;
    }>;
    npcBetting?: Array<{
        id: number;
        name: string;
        leadership: number;
        strength: number;
        intel: number;
        meta: Record<string, unknown>;
        npcState: number;
        gold: number;
    }>;
    baseSeed?: string;
    currentYear?: number;
}) => {
    const applicants = options.applicants ?? [];
    const npcs = options.npcs ?? [];
    const npcBetting = options.npcBetting ?? [];

    return {
        general: {
            findMany: async (args: { where: Record<string, unknown>; select: Record<string, boolean> }) => {
                const where = args.where;
                if (isRecord(where) && 'meta' in where) {
                    return applicants.filter((entry) => {
                        const meta = isRecord(entry.meta) ? entry.meta : {};
                        return meta.tnmt === 1;
                    });
                }
                if (isRecord(where)) {
                    const npcState = isRecord(where.npcState) ? where.npcState : null;
                    if (isRecord(npcState) && typeof npcState.gte === 'number') {
                        const gold = isRecord(where.gold) ? where.gold : null;
                        if (isRecord(gold) && typeof gold.gte === 'number') {
                            return npcBetting;
                        }
                        return npcs;
                    }
                }
                return [];
            },
            update: async () => ({ ok: true }),
        },
        worldState: {
            findFirst: async () => ({
                meta: { hiddenSeed: options.baseSeed ?? 'seed' },
                config: { const: { startYear: 1 } },
                currentYear: options.currentYear ?? 1,
            }),
        },
        $transaction: async (actions: Promise<unknown>[]) => Promise.all(actions),
        errorLog: {
            create: async () => ({ ok: true }),
        },
    };
};

const runTournamentToCompletion = async (options: {
    store: TournamentStore;
    prisma: ReturnType<typeof createPrismaMock>;
    baseSeed: string;
    daemonTransport?: TurnDaemonTransport;
}): Promise<TournamentState> => {
    let state = await options.store.getState();
    if (!state) {
        throw new Error('토너먼트 상태가 없습니다.');
    }

    const daemonTransport = options.daemonTransport ?? createNoopDaemonTransport();

    for (let i = 0; i < 2000; i += 1) {
        if (state.stage === 0) {
            return state;
        }
        if (state.stage === 6) {
            const closedAt = new Date(Date.now() - 1000).toISOString();
            state = { ...state, bettingCloseAt: closedAt, nextAt: closedAt };
            await options.store.setState(state);
        }
        if (state.stage >= 1 && state.stage <= 6) {
            state = await applyPreBattleStage(options.store, options.prisma, state, options.baseSeed, daemonTransport);
            continue;
        }
        if (state.stage >= 7 && state.stage <= 10) {
            state = await applyBattle(options.store, state, options.baseSeed, daemonTransport);
            continue;
        }
        break;
    }

    throw new Error('토너먼트가 결승까지 진행되지 않았습니다.');
};

const delayTick = async (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('tournament worker schedule compatibility', () => {
    it('catches up from the stored schedule instead of discarding elapsed legacy phases', () => {
        const state = createTournamentState({
            termSeconds: 600,
            nextAt: '2026-08-02T10:00:00.000Z',
        });

        expect(resolveNextAt(state)).toBe('2026-08-02T10:10:00.000Z');
        expect(resolveBettingCloseAt(state)).toBe('2026-08-02T11:00:00.000Z');
    });
});

describe('tournament worker (in-memory)', () => {
    it('당첨자가 없으면 레거시와 같이 베팅금을 지급하거나 환불하지 않는다', () => {
        expect(
            buildBettingPayouts(10, [
                { generalId: 1, targetId: 11, amount: 100 },
                { generalId: 2, targetId: 12, amount: 200 },
            ])
        ).toEqual({ payouts: [], total: 300, refundAll: false });
    });

    it('locks 64 applicants into eight groups of eight', async () => {
        const redis = new MemoryRedis();
        const store = new TournamentStore(redis, buildTournamentKeys('test-groups'));
        const state = createTournamentState({ stage: 1 });
        await store.setParticipants(createParticipants(16, 16, 32));
        await store.setState(state);

        const next = await applyPreBattleStage(
            store,
            createPrismaMock({ baseSeed: 'seed' }),
            state,
            'seed',
            createNoopDaemonTransport()
        );
        const grouped = await store.getParticipants();

        expect(next).toMatchObject({ stage: 2, phase: 0 });
        expect(next.participantsLockedAt).toBeTruthy();
        for (let groupId = 0; groupId < 8; groupId += 1) {
            const entries = grouped.filter((entry) => entry.groupId === groupId);
            expect(entries).toHaveLength(8);
            expect(entries.map((entry) => entry.groupNo).sort((a, b) => Number(a) - Number(b))).toEqual([
                0, 1, 2, 3, 4, 5, 6, 7,
            ]);
        }
    });

    it('64명 고정 seed 대진에서 15번 참가자가 결승을 이긴다', async () => {
        const redis = new MemoryRedis();
        const store = new TournamentStore(redis, buildTournamentKeys('test'));
        const participants = createParticipants(16, 16, 32);
        const state = createTournamentState({ stage: 1 });
        await store.setParticipants(participants);
        await store.setState(state);

        const prisma = createPrismaMock({ baseSeed: 'seed' });
        const finalState = await runTournamentToCompletion({ store, prisma, baseSeed: 'seed' });
        const matches = await store.getMatches();
        const finalMatches = matches.filter((match) => match.stage === 10);

        expect(finalState.stage).toBe(0);
        expect(finalState.winnerId).toBe(15);
        expect(finalMatches).toHaveLength(1);
        expect(finalMatches[0]).toMatchObject({
            attackerId: 15,
            defenderId: 1,
            winnerId: 15,
            lastEnergy: { attacker: -90, defender: -92 },
        });
    });

    it('runs all four tournament types and emits enough rank and NPC-betting commands for a top ten', async () => {
        for (const type of [
            TournamentType.TOTAL,
            TournamentType.LEADERSHIP,
            TournamentType.STRENGTH,
            TournamentType.INTEL,
        ]) {
            const redis = new MemoryRedis();
            const store = new TournamentStore(redis, buildTournamentKeys(`ranking-audit-${type}`));
            const participants = createParticipants(16, 16, 32);
            await store.setParticipants(participants);
            await store.setState(createTournamentState({ stage: 1, type }));
            const npcBetting = participants.slice(0, 12).map((entry) => ({
                ...entry,
                meta: {},
                npcState: 2,
                gold: 10_000,
            }));
            const commands: TurnDaemonCommand[] = [];
            const transport: TurnDaemonTransport = {
                sendCommand: async (command) => {
                    commands.push(command);
                    return 'ok';
                },
                requestCommand: async () => null,
                requestStatus: async () => null,
            };

            await runTournamentToCompletion({
                store,
                prisma: createPrismaMock({ baseSeed: `ranking-audit-${type}`, npcBetting, currentYear: 10 }),
                baseSeed: `ranking-audit-${type}`,
                daemonTransport: transport,
            });

            const matchCommands = commands.filter((command) => command.type === 'tournamentMatchResult');
            const rankedGeneralIds = new Set(
                matchCommands.flatMap((command) =>
                    command.type === 'tournamentMatchResult' ? [command.attackerId, command.defenderId] : []
                )
            );
            expect(matchCommands.length).toBeGreaterThan(50);
            expect(rankedGeneralIds.size).toBeGreaterThanOrEqual(10);
            expect(commands).toContainEqual(
                expect.objectContaining({
                    type: 'adjustGeneralMeta',
                    reason: 'tournamentNpcBet',
                    adjustments: expect.arrayContaining([
                        expect.objectContaining({ metaDelta: { betgold: expect.any(Number) } }),
                    ]),
                })
            );
        }
    });

    it('우승 결과에 따라 베팅 정산 명령이 생성된다', async () => {
        const redis = new MemoryRedis();
        const store = new TournamentStore(redis, buildTournamentKeys('test-bet'));
        const matches: TournamentMatchEntry[] = [
            { id: 1, stage: 10, roundIndex: 0, attackerId: 10, defenderId: 11, winnerId: 10 },
        ];
        const entries: TournamentBetEntry[] = [
            { generalId: 1, targetId: 10, amount: 100 },
            { generalId: 2, targetId: 11, amount: 200 },
        ];
        const state = createTournamentState({
            stage: 0,
            auto: false,
            winnerId: 10,
            bettingId: 123,
            rewardSettled: false,
            bettingSettled: false,
        });
        await store.setMatches(matches);
        await store.setBettingEntries(entries);
        await store.setState(state);

        const sent: TurnDaemonCommand[] = [];
        const transport: TurnDaemonTransport = {
            sendCommand: async () => 'unused',
            requestCommand: async (command) => {
                sent.push(command);
                if (command.type === 'tournamentReward') {
                    return {
                        type: 'tournamentReward',
                        ok: true,
                        winnerId: command.winnerId,
                        runnerUpId: command.runnerUpId,
                        rewarded: 2,
                        missing: 0,
                        totalGold: 100,
                        totalExp: 10,
                    };
                }
                if (command.type === 'tournamentBettingPayout') {
                    return {
                        type: 'tournamentBettingPayout',
                        ok: true,
                        bettingId: command.bettingId,
                        processed: command.payouts.length,
                        missing: 0,
                        totalPayout: command.payouts.reduce((sum, payout) => sum + payout.amount, 0),
                    };
                }
                return null;
            },
            requestStatus: async () => null,
        };

        await settleTournamentOutcome({ store, daemonTransport: transport, state });

        const rewardCommand = sent.find((command) => command.type === 'tournamentReward');
        const bettingCommand = sent.find((command) => command.type === 'tournamentBettingPayout');

        expect(rewardCommand).toBeDefined();
        expect(bettingCommand).toBeDefined();
        if (bettingCommand && bettingCommand.type === 'tournamentBettingPayout') {
            expect(bettingCommand.payouts).toEqual([{ generalId: 1, amount: 300 }]);
        }
        expect(await store.getState()).toMatchObject({
            rewardSettled: true,
            bettingSettled: true,
        });
    });

    it('정산 응답 실패 시 완료 표시를 남기지 않고 성공한 보상만 재시도에서 제외한다', async () => {
        const redis = new MemoryRedis();
        const store = new TournamentStore(redis, buildTournamentKeys('test-bet-retry'));
        const state = createTournamentState({
            stage: 0,
            auto: false,
            winnerId: 10,
            bettingId: 124,
            rewardSettled: false,
            bettingSettled: false,
        });
        await store.setMatches([{ id: 1, stage: 10, roundIndex: 0, attackerId: 10, defenderId: 11, winnerId: 10 }]);
        await store.setBettingEntries([{ generalId: 1, targetId: 10, amount: 100 }]);
        await store.setState(state);

        let payoutAttempts = 0;
        const commands: TurnDaemonCommand[] = [];
        const transport: TurnDaemonTransport = {
            sendCommand: async () => 'unused',
            requestCommand: async (command) => {
                commands.push(command);
                if (command.type === 'tournamentReward') {
                    return {
                        type: 'tournamentReward',
                        ok: true,
                        winnerId: command.winnerId,
                        runnerUpId: command.runnerUpId,
                        rewarded: 2,
                        missing: 0,
                        totalGold: 100,
                        totalExp: 10,
                    };
                }
                if (command.type === 'tournamentBettingPayout') {
                    payoutAttempts += 1;
                    if (payoutAttempts === 1) {
                        return {
                            type: 'tournamentBettingPayout',
                            ok: false,
                            bettingId: command.bettingId,
                            reason: '일시적 실패',
                        };
                    }
                    return {
                        type: 'tournamentBettingPayout',
                        ok: true,
                        bettingId: command.bettingId,
                        processed: 1,
                        missing: 0,
                        totalPayout: 100,
                    };
                }
                return null;
            },
            requestStatus: async () => null,
        };

        await expect(settleTournamentOutcome({ store, daemonTransport: transport, state })).rejects.toThrow(
            '일시적 실패'
        );
        const afterFailure = await store.getState();
        expect(afterFailure).toMatchObject({ rewardSettled: true, bettingSettled: false });

        await settleTournamentOutcome({ store, daemonTransport: transport, state: afterFailure! });
        expect(await store.getState()).toMatchObject({ rewardSettled: true, bettingSettled: true });
        expect(commands.filter((command) => command.type === 'tournamentReward')).toHaveLength(1);
        expect(commands.filter((command) => command.type === 'tournamentBettingPayout')).toHaveLength(2);
        expect(
            commands.filter((command) => command.type === 'tournamentBettingPayout').map((command) => command.requestId)
        ).toEqual(['tournament:124:betting-payout', 'tournament:124:betting-payout']);
    });

    it('자동 오픈 후 참가자 보충(NPC/더미 포함)하고 결승까지 진행된다', async () => {
        const redis = new MemoryRedis();
        const handler = createTournamentAutoStartHandler({
            profileName: 'auto',
            getRedisClient: () => redis,
            getWorldConfig: () => ({ tournamentTrig: true }),
            getTickSeconds: () => 600,
        });
        handler.onMonthChanged?.({
            currentYear: 1,
            currentMonth: 2,
        });
        await delayTick();

        const store = new TournamentStore(redis, buildTournamentKeys('auto'));
        const state = await store.getState();
        expect(state?.stage).toBe(1);

        const autoApplicants = [
            {
                id: 1,
                name: '자동참가1',
                leadership: 70,
                strength: 70,
                intel: 70,
                meta: { tnmt: 1, explevel: 20 },
                npcState: 0,
            },
            {
                id: 2,
                name: '자동참가2',
                leadership: 65,
                strength: 65,
                intel: 65,
                meta: { tnmt: 1, explevel: 18 },
                npcState: 0,
            },
            {
                id: 99,
                name: '비자동참가',
                leadership: 80,
                strength: 80,
                intel: 80,
                meta: { tnmt: 0, explevel: 25 },
                npcState: 0,
            },
        ];
        const npcs = [
            {
                id: 1001,
                name: 'NPC1',
                leadership: 40,
                strength: 40,
                intel: 40,
                meta: { explevel: 12 },
                npcState: 2,
            },
            {
                id: 1002,
                name: 'NPC2',
                leadership: 35,
                strength: 35,
                intel: 35,
                meta: { explevel: 10 },
                npcState: 2,
            },
        ];

        const prisma = createPrismaMock({
            applicants: autoApplicants,
            npcs,
            baseSeed: 'seed',
        });

        const initialState = state ?? createTournamentState({ stage: 1 });
        await store.setState(initialState);
        const afterJoin = await applyPreBattleStage(store, prisma, initialState, 'seed', createNoopDaemonTransport());
        const participants = await store.getParticipants();

        expect(afterJoin.stage).toBe(2);
        expect(participants).toHaveLength(64);
        expect(participants.some((entry) => entry.id === 1)).toBe(true);
        expect(participants.some((entry) => entry.id === 2)).toBe(true);
        expect(participants.some((entry) => entry.id === 99)).toBe(false);
        expect(participants.some((entry) => entry.id === 1001)).toBe(true);
        expect(participants.some((entry) => entry.id < 0)).toBe(true);

        await store.setState(afterJoin);
        const finalState = await runTournamentToCompletion({ store, prisma, baseSeed: 'seed' });
        expect(finalState.stage).toBe(0);
        expect(finalState.winnerId).toBeDefined();
    });
});
