import { asGameTick, GAME_TICKS_PER_TURN, type GameTick } from './gameTimeUnits.js';

/** 정상 시간표를 유지하며 대기 후 두 배 속도로 월 경계에 합류한다. */
export interface TurnRecoveryWindow {
    startTick: GameTick;
    endTick: GameTick;
    startWallAt: Date;
}

export const readTurnRecovery = (row: {
    clockRecoveryStartTick?: bigint | number | null;
    clockRecoveryEndTick?: bigint | number | null;
    clockRecoveryStartWallAt?: Date | null;
}): TurnRecoveryWindow | null => {
    const values = [row.clockRecoveryStartTick, row.clockRecoveryEndTick, row.clockRecoveryStartWallAt];
    if (values.every((value) => value == null)) return null;
    if (values.some((value) => value == null)) throw new Error('Incomplete durable turn recovery window.');
    const window = {
        startTick: asGameTick(Number(row.clockRecoveryStartTick)),
        endTick: asGameTick(Number(row.clockRecoveryEndTick)),
        startWallAt: new Date(row.clockRecoveryStartWallAt!),
    };
    validateTurnRecovery(window);
    return window;
};

export const serializeTurnRecovery = (window: TurnRecoveryWindow | null) => ({
    clockRecoveryStartTick: window?.startTick ?? null,
    clockRecoveryEndTick: window?.endTick ?? null,
    clockRecoveryStartWallAt: window?.startWallAt.toISOString() ?? null,
});

export const readSerializedTurnRecovery = (value: unknown): TurnRecoveryWindow | null => {
    if (value == null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid serialized recovery window.');
    const row = value as Record<string, unknown>;
    if (row.clockRecoveryStartTick == null && row.clockRecoveryEndTick == null && row.clockRecoveryStartWallAt == null)
        return null;
    if (
        typeof row.clockRecoveryStartTick !== 'number' ||
        typeof row.clockRecoveryEndTick !== 'number' ||
        typeof row.clockRecoveryStartWallAt !== 'string'
    ) {
        throw new Error('Incomplete serialized recovery window.');
    }
    return readTurnRecovery({
        clockRecoveryStartTick: row.clockRecoveryStartTick,
        clockRecoveryEndTick: row.clockRecoveryEndTick,
        clockRecoveryStartWallAt: new Date(row.clockRecoveryStartWallAt),
    });
};

export interface TurnRecoveryPlan {
    skippedTurns: number;
    recoveryTurns: number;
    initialTick: GameTick;
    recovery: TurnRecoveryWindow | null;
}

export const nextTurnBoundary = (tick: number): GameTick => {
    asGameTick(tick);
    return asGameTick(Math.ceil(tick / GAME_TICKS_PER_TURN) * GAME_TICKS_PER_TURN);
};

/** 운영자 이동은 정수 턴으로만 받는다. 과거 실행의 취소를 뜻하지 않는다. */
export const turnShiftTicks = (turns: number): GameTick => {
    if (!Number.isSafeInteger(turns)) throw new Error('Schedule movement requires an integer number of turns.');
    return asGameTick(turns * GAME_TICKS_PER_TURN);
};

/** 즉시 처리 여부는 12턴 묶음 생략 전의 전체 지연으로 판정한다. */
export const immediateRecoveryLimitSeconds = (turnSeconds: number): number => Math.min(600, turnSeconds / 10);

/**
 * observedTick은 중단 전에 저장한 관측 지점, normalTick은 기존 시간표의 현재 지점이다.
 * 짧은 전체 지연만 즉시 처리한다. 그 외에는 나머지도 생략하지 않고 대기 후 두 배속으로 처리한다.
 * 반환한 skip은 호출자가 미래 일정과 실행 cursor에 원자적으로 적용해야 한다.
 */
export const planTurnRecovery = (input: {
    observedTick: number;
    normalTick: number;
    wallNow: Date;
    turnSeconds: number;
}): TurnRecoveryPlan => {
    const { observedTick, normalTick, wallNow, turnSeconds } = input;
    asGameTick(observedTick);
    asGameTick(normalTick);
    if (!Number.isInteger(turnSeconds) || turnSeconds <= 0 || GAME_TICKS_PER_TURN % turnSeconds !== 0) {
        throw new Error('Recovery requires a representable positive turn length.');
    }
    if (!Number.isFinite(wallNow.getTime())) throw new Error('Recovery wall instant is invalid.');
    const gap = Math.max(0, normalTick - observedTick);
    const ticksPerSecond = GAME_TICKS_PER_TURN / turnSeconds;
    const immediateLimit = immediateRecoveryLimitSeconds(turnSeconds) * ticksPerSecond;
    if (gap < immediateLimit) {
        return {
            skippedTurns: 0,
            recoveryTurns: 0,
            initialTick: asGameTick(Math.max(observedTick, normalTick)),
            recovery: null,
        };
    }
    const skippedTurns = Math.floor(gap / (12 * GAME_TICKS_PER_TURN)) * 12;
    const initialTick = asGameTick(observedTick + turnShiftTicks(skippedTurns));
    const remaining = normalTick - initialTick;
    if (remaining === 0) return { skippedTurns, recoveryTurns: 0, initialTick, recovery: null };

    // 즉시 2배속으로 따라잡을 수 있는 가장 이른 지점 이후의 월 경계를 고른다.
    // 대기도 추가 지연이므로 경계까지 여유의 절반만 기다린다. 밀리초 반올림은 종료 시각을 보존한다.
    const endTick = nextTurnBoundary(normalTick + remaining);
    const endWallMs = wallNow.getTime() + Math.ceil(((endTick - normalTick) * 1_000) / ticksPerSecond);
    const durationMs = Math.ceil(((endTick - initialTick) * 1_000) / (2 * ticksPerSecond));
    return {
        skippedTurns,
        recoveryTurns: remaining / GAME_TICKS_PER_TURN,
        initialTick,
        recovery: { startTick: initialTick, endTick, startWallAt: new Date(endWallMs - durationMs) },
    };
};

export const validateTurnRecovery = (window: TurnRecoveryWindow): void => {
    asGameTick(window.startTick);
    asGameTick(window.endTick);
    const span = window.endTick - window.startTick;
    if (
        !Number.isFinite(window.startWallAt.getTime()) ||
        window.endTick % GAME_TICKS_PER_TURN !== 0 ||
        span <= 0 ||
        span >= 25 * GAME_TICKS_PER_TURN
    )
        throw new Error('Recovery must end at a turn boundary with a positive span below twenty-five turns.');
};

/** 경계 전에는 정상 속도, 복구 구간은 두 배, 합류 경계 이후는 정상 속도이다. */
export const observeTurnRecovery = (window: TurnRecoveryWindow, wallNow: Date, ticksPerSecond: number): GameTick => {
    validateTurnRecovery(window);
    const elapsed = asGameTick(
        Math.trunc(
            ((wallNow.getTime() - window.startWallAt.getTime()) *
                ticksPerSecond *
                (wallNow < window.startWallAt ? 1 : 2)) /
                1_000
        )
    );
    const endWallAt = projectRecoveryDeadline(window, window.endTick, ticksPerSecond);
    if (wallNow >= endWallAt) {
        return asGameTick(
            window.endTick + Math.trunc(((wallNow.getTime() - endWallAt.getTime()) * ticksPerSecond) / 1_000)
        );
    }
    // 이전 복구 창은 시작 전 1배속이었다. 새 창은 GameClock의 저장 tick 하한으로 대기한다.
    return asGameTick(Math.min(window.endTick, window.startTick + elapsed));
};

/** 게임 좌표의 예정 시각을 사용자에게 표시할 실제 실행 시각으로 투영한다. */
export const projectRecoveryDeadline = (window: TurnRecoveryWindow, tick: number, ticksPerSecond: number): Date => {
    validateTurnRecovery(window);
    asGameTick(tick);
    const offset = tick - window.startTick;
    const span = window.endTick - window.startTick;
    if (offset > span) {
        const endWallMs = window.startWallAt.getTime() + Math.ceil((span * 1_000) / (2 * ticksPerSecond));
        return new Date(endWallMs + Math.ceil(((offset - span) * 1_000) / ticksPerSecond));
    }
    const elapsed = offset < 0 ? offset : offset / 2;
    return new Date(window.startWallAt.getTime() + Math.ceil((elapsed * 1_000) / ticksPerSecond));
};
