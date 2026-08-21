import { GAME_TICKS_PER_TURN } from '@sammo-ts/common';

export interface GeneralBasicStats {
    leadership: number;
    strength: number;
    intelligence: number;
}

export const resolveGeneralTypeCall = (stats: GeneralBasicStats, chiefStatMin: number, statGradeLevel = 5): string => {
    const { leadership, strength, intelligence } = stats;
    if (leadership < 40) {
        if (strength + intelligence < 40) return '아둔';
        if (intelligence >= chiefStatMin && strength < intelligence * 0.8) return '학자';
        if (strength >= chiefStatMin && intelligence < strength * 0.8) return '장사';
        return '명사';
    }

    const maxStat = Math.max(leadership, strength, intelligence);
    const sumTwoStats = Math.min(leadership + strength, strength + intelligence, intelligence + leadership);
    if (maxStat >= chiefStatMin + statGradeLevel && sumTwoStats >= maxStat * 1.7) return '만능';
    if (strength >= chiefStatMin - statGradeLevel && intelligence < strength * 0.8) return '용장';
    if (intelligence >= chiefStatMin - statGradeLevel && strength < intelligence * 0.8) return '명장';
    if (leadership >= chiefStatMin - statGradeLevel && strength + intelligence < leadership) return '차장';
    return '평범';
};

export const resolveLeadershipBonus = (officerLevel: number, nationLevel: number): number => {
    if (officerLevel === 12) return nationLevel * 2;
    if (officerLevel >= 5) return nationLevel;
    return 0;
};

export const resolveRefreshScoreText = (score: number): string => {
    if (score < 50) return '안함';
    if (score < 100) return '무관심';
    if (score < 200) return '보통';
    if (score < 400) return '가끔';
    if (score < 800) return '자주';
    if (score < 1_600) return '열심';
    if (score < 3_200) return '중독';
    if (score < 6_400) return '폐인';
    if (score < 12_800) return '경고';
    return '헐...';
};

export const resolveRemainingMinutes = (
    turnTime: Date,
    lastExecuted: Date | null,
    turnTermSeconds: number
): number | null => {
    if (!lastExecuted || !Number.isFinite(lastExecuted.getTime()) || turnTermSeconds <= 0) return null;
    let nextTurnMillis = turnTime.getTime();
    if (nextTurnMillis < lastExecuted.getTime()) {
        nextTurnMillis += turnTermSeconds * 1_000;
    }
    return Math.floor(Math.min(999, Math.max(0, (nextTurnMillis - lastExecuted.getTime()) / 60_000)));
};

export interface NextTurnMonthOffsetInput {
    turnTime: Date;
    turnTick?: bigint | number | null;
    lastExecuted: Date | null;
    lastTurnTick?: bigint | number | null;
    turnSeconds: number;
}

const normalizeTick = (value: bigint | number | null | undefined): bigint | null => {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
    return null;
};

const turnBucket = (tick: bigint): bigint => {
    const ticksPerTurn = BigInt(GAME_TICKS_PER_TURN);
    const quotient = tick / ticksPerTurn;
    return tick % ticksPerTurn < 0 ? quotient - 1n : quotient;
};

/**
 * Ref Command.GetReservedCommand cuts both clocks to a gameplay-turn bucket.
 * A general in the next bucket has already acted in the displayed world month,
 * so the first reserved command belongs to the following month.
 */
export const resolveNextTurnMonthOffset = (input: NextTurnMonthOffsetInput): 0 | 1 => {
    const turnTick = normalizeTick(input.turnTick);
    const lastTurnTick = normalizeTick(input.lastTurnTick);
    if (turnTick !== null && lastTurnTick !== null) {
        return turnBucket(turnTick) > turnBucket(lastTurnTick) ? 1 : 0;
    }

    const turnTimeMs = input.turnTime.getTime();
    const lastExecutedMs = input.lastExecuted?.getTime() ?? Number.NaN;
    if (!Number.isFinite(turnTimeMs) || !Number.isFinite(lastExecutedMs) || input.turnSeconds <= 0) return 0;
    return turnTimeMs >= lastExecutedMs + input.turnSeconds * 1_000 ? 1 : 0;
};
