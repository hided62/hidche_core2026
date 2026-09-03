export const GAME_TICKS_PER_TURN = 36_000_000;
export const MAX_SAFE_GAME_TICK = Number.MAX_SAFE_INTEGER;

export type GameClockMode = 'realtime' | 'manual';
export type GameClockPhase = 'PREOPEN' | 'RUNNING' | 'SUSPENDED' | 'RECONCILING' | 'MANUAL' | 'COMPLETED';
export type ClockAlignmentPolicy = 'EXACT' | 'LEGACY_COMPLETE_TURNS' | 'CATCH_UP';

declare const gameTickBrand: unique symbol;
declare const observedGameInstantBrand: unique symbol;
declare const scheduleInstantBrand: unique symbol;
declare const clockRevisionBrand: unique symbol;
declare const wallInstantBrand: unique symbol;

export type GameTick = number & { readonly [gameTickBrand]: 'GameTick' };
export type ObservedGameInstant = GameTick & { readonly [observedGameInstantBrand]: 'ObservedGameInstant' };
export type ScheduleInstant = GameTick & { readonly [scheduleInstantBrand]: 'ScheduleInstant' };
export type ClockRevision = number & { readonly [clockRevisionBrand]: 'ClockRevision' };
export type WallInstant = Date & { readonly [wallInstantBrand]: 'WallInstant' };

export interface ClockAlignmentPlan {
    policy: ClockAlignmentPolicy;
    sourceRevision: ClockRevision;
    targetRevision: ClockRevision;
    cutTick: GameTick;
    gapTicks: GameTick;
    catchUpTicks: GameTick;
    shiftTicks: GameTick;
    alignedTick: GameTick;
}

export interface GameClockState {
    baseTime: Date;
    tick: number;
    mode: GameClockMode;
    wallAnchor: Date;
    turnSeconds: number;
    phase?: GameClockPhase;
    revision?: number;
}

const requireSafeTick = (tick: number): number => {
    if (!Number.isSafeInteger(tick)) {
        throw new Error(`Game tick must be a safe integer: ${tick}`);
    }
    return tick;
};

export const asGameTick = (tick: number): GameTick => requireSafeTick(tick) as GameTick;

export const asObservedGameInstant = (tick: number): ObservedGameInstant =>
    requireSafeTick(tick) as ObservedGameInstant;

export const asScheduleInstant = (tick: number): ScheduleInstant => requireSafeTick(tick) as ScheduleInstant;

export const asClockRevision = (revision: number): ClockRevision => {
    if (!Number.isSafeInteger(revision) || revision < 1) {
        throw new Error(`Clock revision must be a positive safe integer: ${revision}`);
    }
    return revision as ClockRevision;
};

export const asWallInstant = (instant: Date): WallInstant => {
    if (Number.isNaN(instant.getTime())) {
        throw new Error('Wall instant must be a valid date.');
    }
    return new Date(instant.getTime()) as WallInstant;
};

export const inferClockPhase = (mode: GameClockMode): GameClockPhase => (mode === 'manual' ? 'MANUAL' : 'RUNNING');

const GAME_CLOCK_PHASES: readonly GameClockPhase[] = [
    'PREOPEN',
    'RUNNING',
    'SUSPENDED',
    'RECONCILING',
    'MANUAL',
    'COMPLETED',
];

export const parseGameClockPhase = (value: string): GameClockPhase => {
    if ((GAME_CLOCK_PHASES as readonly string[]).includes(value)) {
        return value as GameClockPhase;
    }
    throw new Error(`Unknown game clock phase: ${value}`);
};

const CLOCK_ALIGNMENT_POLICIES: readonly ClockAlignmentPolicy[] = ['EXACT', 'LEGACY_COMPLETE_TURNS', 'CATCH_UP'];

export const parseClockAlignmentPolicy = (value: string): ClockAlignmentPolicy => {
    if ((CLOCK_ALIGNMENT_POLICIES as readonly string[]).includes(value)) {
        return value as ClockAlignmentPolicy;
    }
    throw new Error(`Unknown clock alignment policy: ${value}`);
};

export const scheduleNotBefore = (instant: ObservedGameInstant, phase: GameClockPhase): ScheduleInstant => {
    if (phase === 'PREOPEN') {
        return asScheduleInstant(Math.max(0, instant));
    }
    return asScheduleInstant(instant);
};

export const createDeadline = (
    instant: ObservedGameInstant,
    durationTicks: GameTick,
    phase: GameClockPhase
): ScheduleInstant => scheduleNotBefore(asObservedGameInstant(requireSafeTick(instant + durationTicks)), phase);

export const assertGameplayCommitAllowed = (phase: GameClockPhase): void => {
    if (phase !== 'RUNNING' && phase !== 'MANUAL') {
        throw new Error(`Gameplay commit is forbidden while the game clock phase is ${phase}.`);
    }
};

const buildAlignmentPlan = (input: {
    policy: ClockAlignmentPolicy;
    sourceRevision: number;
    cutTick: number;
    cutWall: Date;
    resumeWall: Date;
    ticksPerSecond: number;
    catchUpTicks?: number;
}): ClockAlignmentPlan => {
    const sourceRevision = asClockRevision(input.sourceRevision);
    const cutTick = asGameTick(input.cutTick);
    const cutWall = asWallInstant(input.cutWall);
    const resumeWall = asWallInstant(input.resumeWall);
    if (!Number.isSafeInteger(input.ticksPerSecond) || input.ticksPerSecond <= 0) {
        throw new Error(`ticksPerSecond must be a positive safe integer: ${input.ticksPerSecond}`);
    }
    const elapsedMilliseconds = Math.max(0, resumeWall.getTime() - cutWall.getTime());
    if (!Number.isSafeInteger(elapsedMilliseconds)) {
        throw new Error('Clock suspension wall gap is outside the safe integer range.');
    }
    const wholeSeconds = Math.trunc(elapsedMilliseconds / 1_000);
    const remainingMilliseconds = elapsedMilliseconds - wholeSeconds * 1_000;
    const gapTicks = asGameTick(
        requireSafeTick(
            wholeSeconds * input.ticksPerSecond +
                Math.trunc((remainingMilliseconds * input.ticksPerSecond) / 1_000)
        )
    );
    const catchUpTicks = asGameTick(input.catchUpTicks ?? 0);
    if (catchUpTicks < 0 || catchUpTicks > gapTicks) {
        throw new Error(`catchUpTicks must be between 0 and the wall gap (${gapTicks}): ${catchUpTicks}`);
    }
    const shiftTicks = asGameTick(gapTicks - catchUpTicks);
    return {
        policy: input.policy,
        sourceRevision,
        targetRevision: asClockRevision(sourceRevision + 1),
        cutTick,
        gapTicks,
        catchUpTicks,
        shiftTicks,
        alignedTick: asGameTick(cutTick + gapTicks),
    };
};

export const buildExactClockAlignmentPlan = (
    input: Omit<Parameters<typeof buildAlignmentPlan>[0], 'policy'>
): ClockAlignmentPlan => buildAlignmentPlan({ ...input, policy: 'EXACT' });

export const buildClockAlignmentPlan = (input: {
    policy: ClockAlignmentPolicy;
    sourceRevision: number;
    cutTick: number;
    cutWall: Date;
    resumeWall: Date;
    ticksPerSecond: number;
    catchUpTicks?: number;
}): ClockAlignmentPlan => {
    if (input.policy === 'EXACT') {
        if ((input.catchUpTicks ?? 0) !== 0) {
            throw new Error('EXACT alignment does not allow catch-up ticks.');
        }
        return buildAlignmentPlan({ ...input, policy: 'EXACT', catchUpTicks: 0 });
    }
    if (input.policy === 'CATCH_UP') {
        return buildAlignmentPlan({ ...input, policy: 'CATCH_UP' });
    }
    const exact = buildAlignmentPlan({ ...input, policy: 'LEGACY_COMPLETE_TURNS', catchUpTicks: 0 });
    const shiftTicks = asGameTick(Math.floor(exact.gapTicks / GAME_TICKS_PER_TURN) * GAME_TICKS_PER_TURN);
    return {
        ...exact,
        catchUpTicks: asGameTick(exact.gapTicks - shiftTicks),
        shiftTicks,
    };
};

const tickOffsetMilliseconds = (tick: number, ticksPerSecond: number): number => {
    const wholeSeconds = Math.floor(tick / ticksPerSecond);
    const remainingTicks = tick - wholeSeconds * ticksPerSecond;
    const milliseconds = wholeSeconds * 1_000 + Math.floor((remainingTicks * 1_000) / ticksPerSecond);
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
    readonly phase: GameClockPhase;
    readonly revision: ClockRevision;

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
        this.phase = state.phase ?? inferClockPhase(state.mode);
        this.revision = asClockRevision(state.revision ?? 1);
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
        if (this.mode === 'manual' || this.phase === 'MANUAL' || this.phase === 'COMPLETED') {
            return this.tick;
        }
        const elapsedTicks = this.ticksBetween(this.wallAnchor, wallNow);
        // A future realtime anchor represents the formal opening at anchor tick.
        // Before that instant Ref exposes the elapsed offset as a negative tick,
        // which lets PREOPEN-only actions keep their logical cooldowns moving.
        const projectedTick = this.addTicks(this.tick, elapsedTicks);
        // PREOPEN is the only phase where the opening anchor may project a
        // signed negative coordinate. Once a realtime game is running, an NTP
        // rewind must never make the observed coordinate decrease below the
        // last durable clock snapshot.
        return this.phase === 'PREOPEN' ? projectedTick : Math.max(this.tick, projectedTick);
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
            wholeSeconds * this.ticksPerSecond + Math.trunc((remainingMilliseconds * this.ticksPerSecond) / 1_000)
        );
    }
}
