import { describe, expect, it } from 'vitest';
import { GAME_TICKS_PER_TURN as T, GameClock, buildClockAlignmentPlan } from '../src/time/GameClock.js';
import {
    nextTurnBoundary,
    observeTurnRecovery,
    planTurnRecovery,
    projectRecoveryDeadline,
    turnShiftTicks,
} from '../src/time/TurnRecovery.js';

const base = Date.parse('2026-09-06T00:00:00Z');
const wall = (hours: number) => new Date(base + hours * 3_600_000);

describe('turn-aligned double-speed recovery', () => {
    it('reloads midway through acceleration without restarting the recovery duration', () => {
        const { recovery } = planTurnRecovery({
            observedTick: 0,
            normalTick: 4 * T,
            wallNow: wall(4),
            turnSeconds: 3600,
        });
        const reloaded = new GameClock({
            baseTime: wall(0),
            tick: 2 * T,
            wallAnchor: wall(5),
            mode: 'realtime',
            turnSeconds: 3600,
            recovery,
        });
        expect(reloaded.nowTick(wall(6))).toBe(4 * T);
        expect(reloaded.nowTick(wall(8))).toBe(8 * T);
        expect(reloaded.nowTick(wall(9))).toBe(9 * T);
        expect(reloaded.normalNowTick(wall(6))).toBe(6 * T);
        expect(reloaded.executionRate(wall(7))).toBe(2);
        expect(reloaded.executionRate(wall(8))).toBe(1);
    });

    it('resumes a planned wait at a whole-turn boundary without changing purchased phase', () => {
        const plan = buildClockAlignmentPlan({
            policy: 'TURN_BOUNDARY',
            sourceRevision: 1,
            cutTick: 0,
            cutWall: wall(0),
            resumeWall: wall(4 + 1 / 3),
            ticksPerSecond: 10_000,
        });
        expect(plan.shiftTicks).toBe(5 * T);
        expect(plan.alignedTick).toBe(5 * T);
        expect(plan.resumeAnchor).toEqual(wall(5));
        expect((199_020 + plan.shiftTicks) % T).toBe(199_020);
    });

    it('preserves a normal schedule whose game epoch differs from the real opening date', () => {
        const plan = buildClockAlignmentPlan({
            policy: 'RECOVER_TURNS',
            sourceRevision: 1,
            cutTick: 0,
            cutWall: wall(100),
            resumeWall: wall(104),
            ticksPerSecond: 10_000,
            normalTick: 4 * T,
        });
        expect(plan.shiftTicks).toBe(0);
        const clock = new GameClock({
            baseTime: wall(0),
            tick: plan.alignedTick,
            wallAnchor: wall(104),
            turnSeconds: 3600,
            mode: 'realtime',
            recovery: plan.recovery,
        });
        expect(clock.nowTick(wall(108))).toBe(8 * T);
        expect(clock.tickToWallDate(8 * T + 199_020)).toEqual(new Date(wall(108).getTime() + 19_902));
    });
    it.each([0, 1, 4, 11, 12, 13, 23, 24, 28])('preserves twelve-turn blocks for %i overdue turns', (turns) => {
        const plan = planTurnRecovery({
            observedTick: 0,
            normalTick: turns * T,
            wallNow: wall(turns),
            turnSeconds: 3600,
        });
        expect(plan.skippedTurns).toBe(Math.floor(turns / 12) * 12);
        expect(plan.recoveryTurns).toBe(turns % 12);
        expect(plan.initialTick).toBe(plan.skippedTurns * T);
        if (!plan.recovery) return;
        const end = turns + plan.recoveryTurns;
        expect(observeTurnRecovery(plan.recovery, wall(end), 10_000)).toBe(end * T);
        expect(observeTurnRecovery(plan.recovery, wall(end + 1), 10_000)).toBe((end + 1) * T);
    });

    it('executes four delayed turns over four hours and meets the original eight-hour boundary', () => {
        const { recovery } = planTurnRecovery({
            observedTick: 0,
            normalTick: 4 * T,
            wallNow: wall(4),
            turnSeconds: 3600,
        });
        expect(recovery).not.toBeNull();
        expect(observeTurnRecovery(recovery!, wall(4), 10_000)).toBe(0);
        expect(observeTurnRecovery(recovery!, wall(5), 10_000)).toBe(2 * T);
        expect(observeTurnRecovery(recovery!, wall(8), 10_000)).toBe(8 * T);
        expect(observeTurnRecovery(recovery!, wall(9), 10_000)).toBe(9 * T);
    });

    it('retains the fractional phase and begins acceleration at the next boundary', () => {
        const plan = planTurnRecovery({
            observedTick: 0,
            normalTick: 4 * T + T / 3,
            wallNow: wall(4 + 1 / 3),
            turnSeconds: 3600,
        });
        expect(plan.initialTick).toBe(T / 3);
        expect(plan.recovery!.startWallAt).toEqual(wall(5));
        expect(observeTurnRecovery(plan.recovery!, wall(4.5), 10_000)).toBe(T / 2);
        expect(observeTurnRecovery(plan.recovery!, wall(5), 10_000)).toBe(T);
        expect(observeTurnRecovery(plan.recovery!, wall(9), 10_000)).toBe(9 * T);
    });

    it('preserves purchased phase coordinates while projecting compressed wall deadlines', () => {
        const { recovery } = planTurnRecovery({
            observedTick: 0,
            normalTick: 4 * T,
            wallNow: wall(4),
            turnSeconds: 3600,
        });
        const phase = 199_020; // 00:19.902 at normal speed
        expect(projectRecoveryDeadline(recovery!, phase, 10_000).getTime()).toBe(wall(4).getTime() + 9951);
        expect(projectRecoveryDeadline(recovery!, 8 * T + phase, 10_000).getTime()).toBe(wall(8).getTime() + 19902);
    });

    it('does not rewind a persisted observation when wall time moves backwards', () => {
        const plan = planTurnRecovery({ observedTick: 5 * T, normalTick: 4 * T, wallNow: wall(4), turnSeconds: 3600 });
        expect(plan.initialTick).toBe(5 * T);
        expect(plan.recovery).toBeNull();
    });

    it('accepts signed whole-turn shifts and rejects fractional movement', () => {
        expect(turnShiftTicks(-4)).toBe(-4 * T);
        expect(turnShiftTicks(12)).toBe(12 * T);
        expect(() => turnShiftTicks(0.5)).toThrow();
        expect(nextTurnBoundary(4 * T + 1)).toBe(5 * T);
        expect(nextTurnBoundary(4 * T)).toBe(4 * T);
    });
});
