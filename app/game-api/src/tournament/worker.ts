import { createTournamentRng } from '@sammo-ts/common';
import { resolveTournamentBattle, TournamentType } from '@sammo-ts/logic';
import {
    createGamePostgresConnector,
    createRedisConnector,
    resolvePostgresConfigFromEnv,
    resolveRedisConfigFromEnv,
} from '@sammo-ts/infra';

import { resolveGameApiConfigFromEnv } from '../config.js';
import { buildTournamentKeys } from './keys.js';
import { TournamentStore } from './store.js';
import type { TournamentMatchEntry, TournamentState } from './types.js';

const sleepMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isBattleStage = (stage: number): boolean => stage >= 7 && stage <= 10;
const isPreBattleStage = (stage: number): boolean => stage >= 1 && stage <= 6;

const nextStage = (stage: number): number => {
    switch (stage) {
        case 7:
            return 8;
        case 8:
            return 9;
        case 9:
            return 10;
        default:
            return 0;
    }
};

const resolveNextAt = (state: TournamentState): string =>
    new Date(Date.now() + Math.max(1, state.termSeconds) * 1000).toISOString();

const resolveBettingCloseAt = (state: TournamentState): string => {
    const bettingTermMs = Math.min(state.termSeconds * 60, 3600) * 1000;
    return new Date(Date.now() + Math.max(1000, bettingTermMs)).toISOString();
};

const resolveStatValue = (type: TournamentType, entry: { leadership: number; strength: number; intel: number }): number => {
    switch (type) {
        case TournamentType.LEADERSHIP:
            return entry.leadership;
        case TournamentType.STRENGTH:
            return entry.strength;
        case TournamentType.INTEL:
            return entry.intel;
        case TournamentType.TOTAL:
        default:
            return entry.leadership + entry.strength + entry.intel;
    }
};

const pickFinalists = (state: TournamentState, participants: Array<{ id: number; leadership: number; strength: number; intel: number }>): number[] =>
    participants
        .slice()
        .sort((lhs, rhs) => {
            const lVal = resolveStatValue(state.type, lhs);
            const rVal = resolveStatValue(state.type, rhs);
            if (lVal !== rVal) {
                return rVal - lVal;
            }
            return lhs.id - rhs.id;
        })
        .slice(0, 16)
        .map((entry) => entry.id);

const buildInitialMatches = (
    state: TournamentState,
    baseSeed: string,
    participantIds: number[]
): TournamentMatchEntry[] => {
    const rng = createTournamentRng(baseSeed, {
        openYear: state.openYear,
        openMonth: state.openMonth,
        stage: 5,
        phase: state.phase,
        matchIndex: 0,
        participantIndex: 0,
        extraSeed: 'round16',
    });
    const shuffled = rng.shuffle(participantIds);
    const pairs = shuffled.slice(0, 16);
    if (pairs.length < 2 || pairs.length % 2 !== 0) {
        throw new Error('대진표를 구성할 참가자가 부족합니다.');
    }
    return pairs.reduce<TournamentMatchEntry[]>((acc, _id, idx) => {
        if (idx % 2 !== 0) {
            return acc;
        }
        const attackerId = pairs[idx];
        const defenderId = pairs[idx + 1];
        if (attackerId === undefined || defenderId === undefined) {
            return acc;
        }
        acc.push({
            id: acc.length + 1,
            stage: 7,
            roundIndex: acc.length,
            attackerId,
            defenderId,
        });
        return acc;
    }, []);
};

const buildNextMatches = (
    stage: number,
    matches: TournamentMatchEntry[]
): TournamentMatchEntry[] => {
    const stageMatches = matches.filter((match) => match.stage === stage);
    const winners = stageMatches
        .map((match) => match.winnerId)
        .filter((winner): winner is number => typeof winner === 'number');

    if (winners.length === 0 || winners.length % 2 !== 0) {
        throw new Error('다음 라운드를 만들 수 없습니다.');
    }

    const nextIdBase = matches.reduce((max, entry) => Math.max(max, entry.id), 0) + 1;
    const nextStageValue = nextStage(stage);
    const result: TournamentMatchEntry[] = [];

    for (let i = 0; i < winners.length; i += 2) {
        const attackerId = winners[i];
        const defenderId = winners[i + 1];
        if (attackerId === undefined || defenderId === undefined) {
            continue;
        }
        result.push({
            id: nextIdBase + result.length,
            stage: nextStageValue,
            roundIndex: i / 2,
            attackerId,
            defenderId,
        });
    }

    if (result.length === 0) {
        throw new Error('다음 라운드 대진 생성에 실패했습니다.');
    }
    return result;
};

const applyBattle = async (
    store: TournamentStore,
    state: TournamentState,
    baseSeed: string
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

    const updatedMatch: TournamentMatchEntry = {
        ...target,
        winnerId: result.winnerId ?? undefined,
        log: result.log,
    };

    const nextMatches = matches.map((entry) => (entry.id === target.id ? updatedMatch : entry));
    await store.setMatches(nextMatches);

    const nextPhase = state.phase + 1;
    const nextState: TournamentState = {
        ...state,
        phase: nextPhase,
        nextAt: resolveNextAt(state),
    };
    await store.setState(nextState);
    return nextState;
};

const applyPreBattleStage = async (
    store: TournamentStore,
    state: TournamentState,
    baseSeed: string
): Promise<TournamentState> => {
    const participants = await store.getParticipants();

    if (state.stage === 1) {
        if (participants.length < 64) {
            const waitingState: TournamentState = {
                ...state,
                nextAt: resolveNextAt(state),
            };
            await store.setState(waitingState);
            return waitingState;
        }
        const nextState: TournamentState = {
            ...state,
            stage: 2,
            phase: 0,
            nextAt: resolveNextAt(state),
        };
        await store.setState(nextState);
        return nextState;
    }

    if (state.stage === 2) {
        const maxPhase = 27;
        const nextPhase = Math.min(maxPhase, state.phase + 1);
        const isComplete = nextPhase >= maxPhase;
        const nextState: TournamentState = {
            ...state,
            stage: isComplete ? 3 : state.stage,
            phase: isComplete ? 0 : nextPhase,
            nextAt: resolveNextAt(state),
        };
        await store.setState(nextState);
        return nextState;
    }

    if (state.stage === 3) {
        const nextState: TournamentState = {
            ...state,
            stage: 4,
            phase: 0,
            nextAt: resolveNextAt(state),
        };
        await store.setState(nextState);
        return nextState;
    }

    if (state.stage === 4) {
        const maxPhase = 5;
        const nextPhase = Math.min(maxPhase, state.phase + 1);
        const isComplete = nextPhase >= maxPhase;
        const nextState: TournamentState = {
            ...state,
            stage: isComplete ? 5 : state.stage,
            phase: isComplete ? 0 : nextPhase,
            nextAt: resolveNextAt(state),
        };
        await store.setState(nextState);
        return nextState;
    }

    if (state.stage === 5) {
        const matches = await store.getMatches();
        if (matches.length === 0) {
            const participantIds = pickFinalists(state, participants);
            const initialMatches = buildInitialMatches(state, baseSeed, participantIds);
            await store.setMatches(initialMatches);
        }
        const nextState: TournamentState = {
            ...state,
            stage: 6,
            phase: 0,
            bettingCloseAt: resolveBettingCloseAt(state),
            nextAt: resolveNextAt(state),
        };
        await store.setState(nextState);
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

export const runTournamentWorker = async (): Promise<void> => {
    const config = resolveGameApiConfigFromEnv();
    const postgres = createGamePostgresConnector(resolvePostgresConfigFromEnv({ schema: config.profile }));
    const redis = createRedisConnector(resolveRedisConfigFromEnv());

    await postgres.connect();
    await redis.connect();

    const store = new TournamentStore(redis.client, buildTournamentKeys(config.profileName));

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
            if (isBattleStage(state.stage)) {
                await applyBattle(store, state, String(baseSeed));
            } else if (isPreBattleStage(state.stage)) {
                await applyPreBattleStage(store, state, String(baseSeed));
            }
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
