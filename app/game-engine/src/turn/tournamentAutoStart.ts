import { asRecord } from '@sammo-ts/common';
import type { RedisConnector } from '@sammo-ts/infra';

import type { TurnCalendarHandler } from './inMemoryWorld.js';

interface TournamentState {
    stage: number;
    phase: number;
    type: number;
    auto: boolean;
    openYear: number;
    openMonth: number;
    termSeconds: number;
    nextAt: string;
    bettingId?: number;
    bettingCloseAt?: string;
    winnerId?: number;
    bettingSettled?: boolean;
    rewardSettled?: boolean;
    participantsLockedAt?: string;
    lastError?: string;
    lastErrorAt?: string;
}

const safeJsonParse = <T>(raw: string | null): T | null => {
    if (!raw) {
        return null;
    }
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
};

const buildTournamentKeys = (profileName: string) => ({
    stateKey: `sammo:${profileName}:tournament:state`,
    participantsKey: `sammo:${profileName}:tournament:participants`,
    matchesKey: `sammo:${profileName}:tournament:matches`,
    bettingKey: `sammo:${profileName}:tournament:betting`,
});

const resolveTermSeconds = (tickSeconds: number): number => {
    const turnMinutes = Math.max(1, Math.round(tickSeconds / 60));
    const clampedMinutes = Math.min(120, Math.max(5, turnMinutes));
    return clampedMinutes * 60;
};

export const createTournamentAutoStartHandler = (options: {
    profileName: string;
    getRedisClient: () => RedisConnector['client'] | null | undefined;
    getWorldConfig: () => Record<string, unknown> | null | undefined;
    getTickSeconds: () => number | null | undefined;
}): TurnCalendarHandler => {
    const profileName = options.profileName;
    const keys = buildTournamentKeys(profileName);
    const triggerAutoStart = async (currentYear: number, currentMonth: number): Promise<void> => {
        if (currentMonth % 2 !== 0) {
            return;
        }
        const config = asRecord(options.getWorldConfig() ?? {});
        if (config.tournamentTrig !== true) {
            return;
        }
        const redis = options.getRedisClient();
        if (!redis) {
            return;
        }

        const state = safeJsonParse<TournamentState>(await redis.get(keys.stateKey));
        if (state && state.stage > 0) {
            return;
        }

        const now = new Date().toISOString();
        const tickSeconds = options.getTickSeconds() ?? 0;
        const termSeconds =
            state && Number.isFinite(state.termSeconds) && state.termSeconds > 0
                ? state.termSeconds
                : resolveTermSeconds(tickSeconds);
        const nextState: TournamentState = {
            stage: 1,
            phase: 0,
            type: state && typeof state.type === 'number' ? state.type : 0,
            auto: true,
            openYear: currentYear,
            openMonth: currentMonth,
            termSeconds,
            nextAt: now,
            bettingId: undefined,
            bettingCloseAt: undefined,
            winnerId: undefined,
            bettingSettled: false,
            rewardSettled: false,
            participantsLockedAt: undefined,
            lastError: undefined,
            lastErrorAt: undefined,
        };

        await redis.set(keys.participantsKey, '[]');
        await redis.set(keys.matchesKey, '[]');
        await redis.set(keys.bettingKey, '[]');
        await redis.set(keys.stateKey, JSON.stringify(nextState));
    };

    return {
        onMonthChanged: (context) => {
            void triggerAutoStart(context.currentYear, context.currentMonth);
        },
    };
};