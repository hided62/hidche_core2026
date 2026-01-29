import { createTournamentRng } from '@sammo-ts/common';
import { resolveTournamentBattle } from '@sammo-ts/logic';
import {
    createGamePostgresConnector,
    createRedisConnector,
    resolvePostgresConfigFromEnv,
    resolveRedisConfigFromEnv,
} from '@sammo-ts/infra';

import { resolveGameApiConfigFromEnv } from '../config.js';
import { RedisTurnDaemonTransport } from '../daemon/redisTransport.js';
import { buildTurnDaemonStreamKeys } from '../daemon/streamKeys.js';
import type { TurnDaemonTransport } from '../daemon/transport.js';
import { buildTournamentKeys } from './keys.js';
import { TournamentStore } from './store.js';
import type { TournamentMatchEntry, TournamentState } from './types.js';
import {
    applyGroupMatch,
    assignGroupSlots,
    buildBettingPayouts,
    buildFinal16MatchesFromGroups,
    buildInitialMatches,
    buildNextMatches,
    buildTournamentRewardPayload,
    fillParticipants,
    isBattleStage,
    isPreBattleStage,
    nextStage,
    pickFinalists,
    resolveBettingCloseAt,
    resolveGroupPair,
    resolveNextAt,
    seedNpcBets,
    sleepMs,
    sortByRanking,
    type TournamentMatchOutcome,
    type TournamentPrismaClient,
} from './workerHelpers.js';

export const applyBattle = async (
    store: TournamentStore,
    state: TournamentState,
    baseSeed: string,
    daemonTransport?: TurnDaemonTransport
): Promise<TournamentState> => {
    const matches = await store.getMatches();
    const participants = await store.getParticipants();

    const pending = matches.filter((match) => match.stage === state.stage && !match.winnerId);
    if (pending.length === 0) {
        const next = nextStage(state.stage);
        if (next === 0) {
            const finalMatch = matches.find((match) => match.stage === state.stage && match.winnerId);
            const finished: TournamentState = {
                ...state,
                stage: 0,
                phase: 0,
                auto: false,
                winnerId: finalMatch?.winnerId,
                nextAt: resolveNextAt(state),
            };
            await store.setState(finished);
            return finished;
        }

        const nextMatches = buildNextMatches(state.stage, matches);
        await store.setMatches(matches.concat(nextMatches));

        const nextState: TournamentState = {
            ...state,
            stage: next,
            phase: 0,
            nextAt: resolveNextAt(state),
        };
        await store.setState(nextState);
        return nextState;
    }

    const target = pending[state.phase] ?? pending[0];
    if (!target) {
        throw new Error('토너먼트 매치가 없습니다.');
    }

    const attacker = participants.find((entry) => entry.id === target.attackerId);
    const defender = participants.find((entry) => entry.id === target.defenderId);
    if (!attacker || !defender) {
        throw new Error('토너먼트 참가자 정보를 찾을 수 없습니다.');
    }

    const result = resolveTournamentBattle({
        type: state.type,
        battleType: 1,
        attacker: {
            id: attacker.id,
            name: attacker.name,
            stats: {
                leadership: attacker.leadership,
                strength: attacker.strength,
                intel: attacker.intel,
            },
            level: attacker.level,
        },
        defender: {
            id: defender.id,
            name: defender.name,
            stats: {
                leadership: defender.leadership,
                strength: defender.strength,
                intel: defender.intel,
            },
            level: defender.level,
        },
        context: {
            openYear: state.openYear,
            openMonth: state.openMonth,
            stage: state.stage,
            phase: state.phase,
            matchIndex: target.id,
        },
        baseSeed,
    });

    const lastLogEntry = result.logEntries[result.logEntries.length - 1] ?? null;

    const updatedMatch: TournamentMatchEntry = {
        ...target,
        winnerId: result.winnerId ?? undefined,
        log: result.log,
        logEntries: result.logEntries,
        lastEnergy: lastLogEntry
            ? { attacker: lastLogEntry.attackerEnergy, defender: lastLogEntry.defenderEnergy }
            : undefined,
    };

    const nextMatches = matches.map((entry) => (entry.id === target.id ? updatedMatch : entry));
    await store.setMatches(nextMatches);

    if (daemonTransport && attacker.id > 0 && defender.id > 0) {
        await daemonTransport.sendCommand({
            type: 'tournamentMatchResult',
            tournamentType: state.type,
            attackerId: attacker.id,
            defenderId: defender.id,
            result: result.draw ? 'draw' : result.winnerId === attacker.id ? 'attacker' : 'defender',
        });
    }

    const nextPhase = state.phase + 1;
    const nextState: TournamentState = {
        ...state,
        phase: nextPhase,
        nextAt: resolveNextAt(state),
    };
    await store.setState(nextState);
    return nextState;
};

export const applyPreBattleStage = async (
    store: TournamentStore,
    prisma: TournamentPrismaClient,
    state: TournamentState,
    baseSeed: string,
    daemonTransport: TurnDaemonTransport
): Promise<TournamentState> => {
    const participants = await store.getParticipants();

    if (state.stage === 1) {
        let nextParticipants = participants;
        if (participants.length < 64) {
            nextParticipants = await fillParticipants({
                prisma,
                state,
                baseSeed,
                current: participants,
                limit: 64,
            });
        }
        const grouped = assignGroupSlots(nextParticipants, 8, 8, 0).map((entry) => ({
            ...entry,
            win: 0,
            draw: 0,
            lose: 0,
            gl: 0,
            seedRank: 0,
            finalRank: 0,
        }));
        await store.setParticipants(grouped);
        const nextState: TournamentState = {
            ...state,
            stage: 2,
            phase: 0,
            participantsLockedAt: new Date().toISOString(),
            nextAt: resolveNextAt(state),
        };
        await store.setState(nextState);
        return nextState;
    }

    if (state.stage === 2) {
        const pair = resolveGroupPair(2, state.phase);
        if (!pair) {
            throw new Error('예선 매치 구성을 찾을 수 없습니다.');
        }
        let updated = participants.some((entry) => entry.groupId === undefined)
            ? assignGroupSlots(participants, 8, 8, 0)
            : participants;
        const outcomes: TournamentMatchOutcome[] = [];
        for (let groupId = 0; groupId < 8; groupId += 1) {
            const groupEntries = updated.filter((entry) => entry.groupId === groupId);
            const attacker = groupEntries.find((entry) => entry.groupNo === pair[0]);
            const defender = groupEntries.find((entry) => entry.groupNo === pair[1]);
            if (!attacker || !defender) {
                continue;
            }
            const result = applyGroupMatch(updated, attacker, defender, state, baseSeed, groupId);
            updated = result.participants;
            outcomes.push(result.outcome);
        }
        await store.setParticipants(updated);

        if (outcomes.length > 0) {
            await Promise.all(
                outcomes
                    .filter((outcome) => outcome.attackerId > 0 && outcome.defenderId > 0)
                    .map((outcome) =>
                        daemonTransport.sendCommand({
                            type: 'tournamentMatchResult',
                            tournamentType: state.type,
                            attackerId: outcome.attackerId,
                            defenderId: outcome.defenderId,
                            result: outcome.result,
                        })
                    )
            );
        }

        const maxPhase = 55;
        const isComplete = state.phase >= maxPhase;
        if (isComplete) {
            const ranked = updated;
            for (let groupId = 0; groupId < 8; groupId += 1) {
                const groupEntries = ranked.filter((entry) => entry.groupId === groupId);
                const ordered = sortByRanking(groupEntries);
                ordered.slice(0, 4).forEach((entry, idx) => {
                    const target = ranked.find((item) => item.id === entry.id);
                    if (target) {
                        target.seedRank = idx + 1;
                    }
                });
            }
            await store.setParticipants(ranked);
            const nextState: TournamentState = {
                ...state,
                stage: 3,
                phase: 0,
                nextAt: resolveNextAt(state),
            };
            await store.setState(nextState);
            return nextState;
        }

        const nextState: TournamentState = {
            ...state,
            phase: state.phase + 1,
            nextAt: resolveNextAt(state),
        };
        await store.setState(nextState);
        return nextState;
    }

    if (state.stage === 3) {
        const phase = state.phase;
        const groupId = 10 + (phase % 8);
        const groupNo = Math.floor(phase / 8);
        const seedTarget = phase < 8 ? 1 : phase < 16 ? 2 : 3;

        const candidates = participants.filter((entry) => {
            if (entry.groupId !== undefined && entry.groupId >= 10) {
                return false;
            }
            if (seedTarget === 3) {
                return (entry.seedRank ?? 0) > 2;
            }
            return (entry.seedRank ?? 0) === seedTarget;
        });

        if (candidates.length === 0) {
            throw new Error('본선 추첨 후보가 없습니다.');
        }

        const rng = createTournamentRng(baseSeed, {
            openYear: state.openYear,
            openMonth: state.openMonth,
            stage: 3,
            phase,
            matchIndex: groupId,
            participantIndex: 0,
            extraSeed: `selection:${seedTarget}:${candidates.map((c) => c.id).join('-')}`,
        });
        const picked = rng.choice(candidates);

        const nextParticipants = participants.map((entry) => {
            if (entry.id !== picked.id) {
                return entry;
            }
            return {
                ...entry,
                groupId,
                groupNo,
                win: 0,
                draw: 0,
                lose: 0,
                gl: 0,
            };
        });
        await store.setParticipants(nextParticipants);

        if (phase >= 31) {
            const nextState: TournamentState = {
                ...state,
                stage: 4,
                phase: 0,
                nextAt: resolveNextAt(state),
            };
            await store.setState(nextState);
            return nextState;
        }

        const nextState: TournamentState = {
            ...state,
            phase: phase + 1,
            nextAt: resolveNextAt(state),
        };
        await store.setState(nextState);
        return nextState;
    }

    if (state.stage === 4) {
        const pair = resolveGroupPair(4, state.phase);
        if (!pair) {
            throw new Error('본선 매치 구성을 찾을 수 없습니다.');
        }
        let updated = participants;
        const outcomes: TournamentMatchOutcome[] = [];
        for (let groupId = 10; groupId < 18; groupId += 1) {
            const groupEntries = updated.filter((entry) => entry.groupId === groupId);
            const attacker = groupEntries.find((entry) => entry.groupNo === pair[0]);
            const defender = groupEntries.find((entry) => entry.groupNo === pair[1]);
            if (!attacker || !defender) {
                continue;
            }
            const result = applyGroupMatch(updated, attacker, defender, state, baseSeed, groupId);
            updated = result.participants;
            outcomes.push(result.outcome);
        }
        await store.setParticipants(updated);

        if (outcomes.length > 0) {
            await Promise.all(
                outcomes
                    .filter((outcome) => outcome.attackerId > 0 && outcome.defenderId > 0)
                    .map((outcome) =>
                        daemonTransport.sendCommand({
                            type: 'tournamentMatchResult',
                            tournamentType: state.type,
                            attackerId: outcome.attackerId,
                            defenderId: outcome.defenderId,
                            result: outcome.result,
                        })
                    )
            );
        }

        const maxPhase = 5;
        if (state.phase >= maxPhase) {
            for (let groupId = 10; groupId < 18; groupId += 1) {
                const groupEntries = updated.filter((entry) => entry.groupId === groupId);
                const ordered = sortByRanking(groupEntries);
                ordered.slice(0, 2).forEach((entry, idx) => {
                    const target = updated.find((item) => item.id === entry.id);
                    if (target) {
                        target.finalRank = idx + 1;
                    }
                });
            }
            await store.setParticipants(updated);
            const nextState: TournamentState = {
                ...state,
                stage: 5,
                phase: 0,
                nextAt: resolveNextAt(state),
            };
            await store.setState(nextState);
            return nextState;
        }

        const nextState: TournamentState = {
            ...state,
            phase: state.phase + 1,
            nextAt: resolveNextAt(state),
        };
        await store.setState(nextState);
        return nextState;
    }

    if (state.stage === 5) {
        const matches = await store.getMatches();
        if (matches.length === 0) {
            const fixedMatches = buildFinal16MatchesFromGroups(participants);
            const participantIds = fixedMatches
                ? fixedMatches.flatMap((entry) => [entry.attackerId, entry.defenderId])
                : pickFinalists(state, participants);
            const initialMatches = fixedMatches ?? buildInitialMatches(state, baseSeed, participantIds);
            await store.setMatches(initialMatches);
        }
        const nextState: TournamentState = {
            ...state,
            stage: 6,
            phase: 0,
            bettingId: state.bettingId ?? Date.now(),
            bettingCloseAt: resolveBettingCloseAt(state),
            nextAt: resolveNextAt(state),
        };
        await store.setState(nextState);
        await seedNpcBets({ prisma, store, state: nextState, baseSeed, daemonTransport });
        return nextState;
    }

    if (state.stage === 6) {
        const bettingCloseAt = state.bettingCloseAt ?? resolveBettingCloseAt(state);
        const bettingCloseMs = new Date(bettingCloseAt).getTime();
        if (Number.isFinite(bettingCloseMs) && bettingCloseMs > Date.now()) {
            const waitingState: TournamentState = {
                ...state,
                bettingCloseAt,
                nextAt: bettingCloseAt,
            };
            await store.setState(waitingState);
            return waitingState;
        }
        const nextState: TournamentState = {
            ...state,
            stage: 7,
            phase: 0,
            bettingCloseAt,
            nextAt: resolveNextAt(state),
        };
        await store.setState(nextState);
        return nextState;
    }

    return state;
};

export const settleTournamentOutcome = async (options: {
    store: TournamentStore;
    daemonTransport: TurnDaemonTransport;
    state: TournamentState;
}): Promise<TournamentState | null> => {
    const { store, daemonTransport, state } = options;
    if (state.stage !== 0 || !state.winnerId) {
        return null;
    }

    let settledState: TournamentState | null = null;

    if (!state.rewardSettled) {
        const matches = await store.getMatches();
        const rewardPayload = buildTournamentRewardPayload(matches);
        await daemonTransport.sendCommand({
            type: 'tournamentReward',
            tournamentType: state.type,
            winnerId: rewardPayload.winnerId,
            runnerUpId: rewardPayload.runnerUpId,
            top16: rewardPayload.top16,
            top8: rewardPayload.top8,
            top4: rewardPayload.top4,
        });
        settledState = {
            ...(settledState ?? state),
            rewardSettled: true,
        };
    }

    if (state.bettingId && !state.bettingSettled) {
        const bettingEntries = await store.getBettingEntries();
        if (bettingEntries.length > 0) {
            const payoutInfo = buildBettingPayouts(state.winnerId, bettingEntries);
            if (payoutInfo.payouts.length > 0) {
                if (payoutInfo.refundAll) {
                    await daemonTransport.sendCommand({
                        type: 'tournamentRefund',
                        bettingId: state.bettingId,
                        refunds: payoutInfo.payouts,
                        reason: 'no_winner',
                    });
                } else {
                    await daemonTransport.sendCommand({
                        type: 'tournamentBettingPayout',
                        bettingId: state.bettingId,
                        payouts: payoutInfo.payouts,
                        reason: 'winner_payout',
                    });
                }
            }
        }

        settledState = {
            ...(settledState ?? state),
            bettingSettled: true,
        };
    }

    if (settledState) {
        await store.setState(settledState);
    }

    return settledState;
};


export const runTournamentWorker = async (): Promise<void> => {
    const config = resolveGameApiConfigFromEnv();
    const postgres = createGamePostgresConnector(resolvePostgresConfigFromEnv({ schema: config.profile }));
    const redis = createRedisConnector(resolveRedisConfigFromEnv());

    await postgres.connect();
    await redis.connect();

    const store = new TournamentStore(redis.client, buildTournamentKeys(config.profileName));
    const daemonTransport = new RedisTurnDaemonTransport(redis.client, {
        keys: buildTurnDaemonStreamKeys(config.profileName),
        requestTimeoutMs: config.daemonRequestTimeoutMs,
    });

    const handleExit = async () => {
        await redis.disconnect();
        await postgres.disconnect();
    };
    process.on('SIGINT', handleExit);
    process.on('SIGTERM', handleExit);

    while (true) {
        const state = await store.getState();
        if (!state || !state.auto) {
            await sleepMs(config.tournamentPollMs);
            continue;
        }

        const nextAt = new Date(state.nextAt).getTime();
        const now = Date.now();
        if (Number.isFinite(nextAt) && nextAt > now) {
            await sleepMs(Math.min(config.tournamentPollMs, nextAt - now));
            continue;
        }

        try {
            const worldState = await postgres.prisma.worldState.findFirst();
            const baseSeed = (worldState?.meta as Record<string, unknown> | null)?.hiddenSeed ?? 'tournament';
            let nextState = state;
            if (isBattleStage(state.stage)) {
                nextState = await applyBattle(store, state, String(baseSeed), daemonTransport);
            } else if (isPreBattleStage(state.stage)) {
                nextState = await applyPreBattleStage(
                    store,
                    postgres.prisma,
                    state,
                    String(baseSeed),
                    daemonTransport
                );
            }

            await settleTournamentOutcome({
                store,
                daemonTransport,
                state: nextState,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            const trace = error instanceof Error ? error.stack : undefined;
            const now = new Date().toISOString();
            await postgres.prisma.errorLog.create({
                data: {
                    category: 'TOURNAMENT',
                    source: 'tournament-worker',
                    message,
                    trace,
                    context: {
                        stage: state.stage,
                        phase: state.phase,
                        bettingId: state.bettingId ?? null,
                        nextAt: state.nextAt,
                    },
                },
            });
            const nextState: TournamentState = {
                ...state,
                auto: false,
                lastError: message,
                lastErrorAt: now,
            };
            await store.setState(nextState);
        }

        await sleepMs(config.tournamentPollMs);
    }
};
