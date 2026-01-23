import { resolveTournamentBattle } from '@sammo-ts/logic';
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

        if (!isBattleStage(state.stage)) {
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
            await applyBattle(store, state, String(baseSeed));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            const nextState: TournamentState = {
                ...state,
                auto: false,
                lastError: message,
                lastErrorAt: new Date().toISOString(),
            };
            await store.setState(nextState);
        }

        await sleepMs(config.tournamentPollMs);
    }
};
