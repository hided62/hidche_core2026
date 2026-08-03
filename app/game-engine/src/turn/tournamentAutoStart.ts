import { asRecord, LiteHashDRBG, RandUtil } from '@sammo-ts/common';
import type { RedisConnector } from '@sammo-ts/infra';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic';
import { simpleSerialize } from '@sammo-ts/logic/war/utils.js';

import type { InMemoryTurnWorld, TurnCalendarHandler } from './inMemoryWorld.js';

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

const TOURNAMENT_TEXT = [
    ['전력전', '영웅'],
    ['통솔전', '명사'],
    ['일기토', '용사'],
    ['설전', '책사'],
] as const;

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

const resolveTermSeconds = (tickSeconds: number): number => {
    const turnMinutes = Math.max(1, Math.round(tickSeconds / 60));
    // Ref calcTournamentTerm() receives the turn length in minutes but returns
    // that clamped numeric value as tournament seconds.
    return Math.min(120, Math.max(5, turnMinutes));
};

const readPattern = (world: InMemoryTurnWorld, config: Record<string, unknown>): number[] => {
    const raw = world.getState().meta.tournamentPattern ?? config.tournamentPattern;
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.filter(
        (value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3
    );
};

export const createTournamentAutoStartHandler = (options: {
    profileName: string;
    getWorld: () => InMemoryTurnWorld | null;
    getRedisClient: () => RedisConnector['client'] | null | undefined;
    getWorldConfig: () => Record<string, unknown> | null | undefined;
    getNationPowerRollCount: () => number;
    onTournamentRollConsumed?: (consumed: boolean) => void;
    now?: () => Date;
}): TurnCalendarHandler => {
    const keys = {
        state: `sammo:${options.profileName}:tournament:state`,
        participants: `sammo:${options.profileName}:tournament:participants`,
        matches: `sammo:${options.profileName}:tournament:matches`,
        betting: `sammo:${options.profileName}:tournament:betting`,
    };
    return {
        onMonthChanged: async (context) => {
            options.onTournamentRollConsumed?.(false);
            const world = options.getWorld();
            const redis = options.getRedisClient();
            const config = asRecord(options.getWorldConfig() ?? {});
            if (!world || !redis || config.tournamentTrig !== true) {
                return;
            }
            const previousState = safeJsonParse<TournamentState>(await redis.get(keys.state));
            if (previousState && previousState.stage > 0) {
                return;
            }

            const state = world.getState();
            const hiddenSeed =
                typeof state.meta.hiddenSeed === 'string' || typeof state.meta.hiddenSeed === 'number'
                    ? state.meta.hiddenSeed
                    : state.id;
            const rng = new RandUtil(
                new LiteHashDRBG(simpleSerialize(hiddenSeed, 'monthly', context.previousYear, context.previousMonth))
            );
            for (let index = 0; index < options.getNationPowerRollCount(); index += 1) {
                rng.nextRange(0.95, 1.05);
            }
            options.onTournamentRollConsumed?.(true);
            if (!rng.nextBool(0.4)) {
                return;
            }

            const pattern = readPattern(world, config);
            // The deterministic Ref comparison branch replaces PHP's global
            // shuffle() with this same already-advanced monthly RNG.
            const resolvedPattern = pattern.length > 0 ? pattern : rng.shuffle([0, 0, 1, 2, 3]);
            const type = resolvedPattern.pop() ?? 0;
            world.updateWorldMeta({ tournamentPattern: resolvedPattern });
            const now = options.now?.() ?? new Date();
            const termSeconds =
                previousState && Number.isFinite(previousState.termSeconds) && previousState.termSeconds > 0
                    ? previousState.termSeconds
                    : resolveTermSeconds(state.tickSeconds);
            const nextState: TournamentState = {
                stage: 1,
                phase: 0,
                type,
                auto: true,
                openYear: context.currentYear,
                openMonth: context.currentMonth,
                termSeconds,
                // Ref startTournament() passes calcTournamentTerm()'s seconds
                // value to DateInterval's minute field. Preserve that historical
                // initial enrollment delay; later tournament phases use seconds.
                nextAt: new Date(now.getTime() + termSeconds * 60_000).toISOString(),
                bettingId:
                    typeof previousState?.bettingId === 'number' && Number.isFinite(previousState.bettingId)
                        ? previousState.bettingId + 1
                        : 1,
                bettingCloseAt: undefined,
                winnerId: undefined,
                bettingSettled: false,
                rewardSettled: false,
                participantsLockedAt: undefined,
                lastError: undefined,
                lastErrorAt: undefined,
            };
            await redis.set(keys.participants, '[]');
            await redis.set(keys.matches, '[]');
            await redis.set(keys.betting, '[]');
            await redis.set(keys.state, JSON.stringify(nextState));

            const [typeText, generalTypeText] = TOURNAMENT_TEXT[type] ?? TOURNAMENT_TEXT[0];
            const emperor = world
                .listGenerals()
                .filter((general) => general.officerLevel === 12)
                .filter((general) => world.getNationById(general.nationId)?.level === 7)
                .sort((left, right) => left.id - right.id)[0];
            const previousWinner =
                typeof state.meta.prev_winner === 'string'
                    ? state.meta.prev_winner
                    : typeof state.meta.previousTournamentWinnerName === 'string'
                      ? state.meta.previousTournamentWinnerName
                      : '';
            const opener = emperor?.name ?? previousWinner;
            const openerText = opener ? `황제 <Y>${opener}</>의 명으로 ` : '';
            world.pushLog({
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                text: `<B><b>【대회】</b></>${openerText}<C>${typeText}</> 대회가 개최됩니다! 천하의 <span class='ev_highlight'>${generalTypeText}</span>들을 모집하고 있습니다!`,
                format: LogFormat.EVENT_YEAR_MONTH,
            });
        },
    };
};
