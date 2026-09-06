import { asGameTick, GAME_TICKS_PER_TURN, type GameTick } from './gameTimeUnits.js';

/** 정상 시간표는 바꾸지 않고, 정수 턴의 지연만 두 배 속도로 소진한다. */
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

/**
 * observedTick은 중단 전에 저장한 관측 지점, normalTick은 기존 시간표의 현재 지점이다.
 * 잔여 한 턴 미만은 정상 실행하고, 다음 경계부터 정수 턴 지연을 두 배속으로 처리한다.
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
    const overdueTurns = Math.max(0, Math.floor((normalTick - observedTick) / GAME_TICKS_PER_TURN));
    const skippedTurns = Math.floor(overdueTurns / 12) * 12;
    const recoveryTurns = overdueTurns % 12;
    const initialTick = asGameTick(
        Math.max(observedTick + turnShiftTicks(skippedTurns), normalTick - turnShiftTicks(recoveryTurns))
    );
    if (recoveryTurns === 0) return { skippedTurns, recoveryTurns, initialTick, recovery: null };
    const boundary = nextTurnBoundary(normalTick);
    const startWallAt = new Date(
        wallNow.getTime() + Math.ceil(((boundary - normalTick) * turnSeconds * 1_000) / GAME_TICKS_PER_TURN)
    );
    return {
        skippedTurns,
        recoveryTurns,
        initialTick,
        recovery: {
            startTick: asGameTick(boundary - turnShiftTicks(recoveryTurns)),
            endTick: asGameTick(boundary + turnShiftTicks(recoveryTurns)),
            startWallAt,
        },
    };
};

export const validateTurnRecovery = (window: TurnRecoveryWindow): void => {
    asGameTick(window.startTick);
    asGameTick(window.endTick);
    const span = window.endTick - window.startTick;
    if (
        !Number.isFinite(window.startWallAt.getTime()) ||
        window.startTick % GAME_TICKS_PER_TURN !== 0 ||
        window.endTick % GAME_TICKS_PER_TURN !== 0 ||
        span <= 0 ||
        span % (2 * GAME_TICKS_PER_TURN) !== 0 ||
        span >= 24 * GAME_TICKS_PER_TURN
    )
        throw new Error('Recovery must join turn boundaries after one to eleven turns at double speed.');
};

/** 경계 전에는 정상 속도, 복구 구간은 두 배, 합류 경계 이후는 정상 속도이다. */
export const observeTurnRecovery = (window: TurnRecoveryWindow, wallNow: Date, ticksPerSecond: number): GameTick => {
    validateTurnRecovery(window);
    const elapsed = asGameTick(
        Math.trunc(((wallNow.getTime() - window.startWallAt.getTime()) * ticksPerSecond) / 1_000)
    );
    const halfSpan = (window.endTick - window.startTick) / 2;
    return asGameTick(window.startTick + elapsed + Math.max(0, Math.min(elapsed, halfSpan)));
};

/** 게임 좌표의 예정 시각을 사용자에게 표시할 실제 실행 시각으로 투영한다. */
export const projectRecoveryDeadline = (window: TurnRecoveryWindow, tick: number, ticksPerSecond: number): Date => {
    validateTurnRecovery(window);
    asGameTick(tick);
    const offset = tick - window.startTick;
    const span = window.endTick - window.startTick;
    const elapsed = offset < 0 ? offset : offset <= span ? offset / 2 : offset - span / 2;
    return new Date(window.startWallAt.getTime() + Math.ceil((elapsed * 1_000) / ticksPerSecond));
};
