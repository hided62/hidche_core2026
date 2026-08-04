export const GAME_TICKS_PER_TURN = 36_000_000;
export const MAX_SAFE_GAME_TICK = Number.MAX_SAFE_INTEGER;

export type GameClockMode = 'realtime' | 'manual';

export interface GameClockState {
    baseTime: Date;
    tick: number;
    mode: GameClockMode;
    wallAnchor: Date;
    turnSeconds: number;
}

const requireSafeTick = (tick: number): number => {
    if (!Number.isSafeInteger(tick)) {
        throw new Error(`Game tick must be a safe integer: ${tick}`);
    }
    return tick;
};

const tickOffsetMilliseconds = (tick: number, ticksPerSecond: number): number => {
    const wholeSeconds = Math.trunc(tick / ticksPerSecond);
    const remainingTicks = tick - wholeSeconds * ticksPerSecond;
    const milliseconds = wholeSeconds * 1_000 + Math.round((remainingTicks * 1_000) / ticksPerSecond);
    if (!Number.isSafeInteger(milliseconds)) {
        throw new Error(`Game tick offset is outside the safe millisecond range: ${milliseconds}`);
    }
    return milliseconds;
};

export class GameClock {
    readonly baseTime: Date;
    readonly tick: number;
    readonly mode: GameClockMode;
    readonly wallAnchor: Date;
    readonly turnSeconds: number;
    readonly ticksPerSecond: number;

    constructor(state: GameClockState) {
        if (!Number.isInteger(state.turnSeconds) || state.turnSeconds <= 0) {
            throw new Error('turnSeconds must be a positive integer.');
        }
        if (GAME_TICKS_PER_TURN % state.turnSeconds !== 0) {
            throw new Error(`turnSeconds ${state.turnSeconds} cannot be represented as integer game ticks.`);
        }
        if (state.mode !== 'realtime' && state.mode !== 'manual') {
            throw new Error(`Unknown game clock mode: ${String(state.mode)}`);
        }
        if (Number.isNaN(state.baseTime.getTime()) || Number.isNaN(state.wallAnchor.getTime())) {
            throw new Error('Game clock anchors must be valid dates.');
        }
        this.baseTime = new Date(state.baseTime.getTime());
        this.tick = requireSafeTick(state.tick);
        this.mode = state.mode;
        this.wallAnchor = new Date(state.wallAnchor.getTime());
        this.turnSeconds = state.turnSeconds;
        this.ticksPerSecond = GAME_TICKS_PER_TURN / state.turnSeconds;
    }

    static baseTimeForProjection(projectedTime: Date, tick: number, turnSeconds: number): Date {
        requireSafeTick(tick);
        if (!Number.isInteger(turnSeconds) || turnSeconds <= 0 || GAME_TICKS_PER_TURN % turnSeconds !== 0) {
            throw new Error(`turnSeconds ${turnSeconds} cannot be represented as integer game ticks.`);
        }
        const ticksPerSecond = GAME_TICKS_PER_TURN / turnSeconds;
        const offsetMs = tickOffsetMilliseconds(tick, ticksPerSecond);
        const baseMs = projectedTime.getTime() - offsetMs;
        if (!Number.isSafeInteger(baseMs)) {
            throw new Error(`Projected game clock base is outside the safe Date range: ${baseMs}`);
        }
        const baseTime = new Date(baseMs);
        if (Number.isNaN(baseTime.getTime())) {
            throw new Error(`Projected game clock base is invalid: ${baseMs}`);
        }
        return baseTime;
    }

    nowTick(wallNow: Date): number {
        if (this.mode === 'manual') {
            return this.tick;
        }
        // A wall-clock correction must never rewind already-observed gameplay.
        const elapsedTicks = this.ticksBetween(this.wallAnchor, wallNow);
        return elapsedTicks <= 0 ? this.tick : this.addTicks(this.tick, elapsedTicks);
    }

    now(wallNow: Date): Date {
        return this.tickToDate(this.nowTick(wallNow));
    }

    dateToTick(date: Date): number {
        return requireSafeTick(this.ticksBetween(this.baseTime, date));
    }

    tickToDate(tick: number): Date {
        requireSafeTick(tick);
        const milliseconds = tickOffsetMilliseconds(tick, this.ticksPerSecond);
        const projected = this.baseTime.getTime() + milliseconds;
        if (!Number.isSafeInteger(projected)) {
            throw new Error(`Projected game time is outside the safe Date range: ${projected}`);
        }
        const result = new Date(projected);
        if (Number.isNaN(result.getTime())) {
            throw new Error(`Projected game time is invalid: ${projected}`);
        }
        return result;
    }

    addTicks(tick: number, delta: number): number {
        requireSafeTick(delta);
        return requireSafeTick(tick + delta);
    }

    private ticksBetween(from: Date, to: Date): number {
        const milliseconds = to.getTime() - from.getTime();
        if (!Number.isSafeInteger(milliseconds)) {
            throw new Error('Game clock date difference is outside the safe integer range.');
        }
        const wholeSeconds = Math.trunc(milliseconds / 1_000);
        const remainingMilliseconds = milliseconds - wholeSeconds * 1_000;
        return requireSafeTick(
            wholeSeconds * this.ticksPerSecond + Math.round((remainingMilliseconds * this.ticksPerSecond) / 1_000)
        );
    }
}
