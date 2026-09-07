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

    it('preserves pre-start normal speed for an existing serialized window', () => {
        const old = new GameClock({
            baseTime: wall(0),
            tick: T / 3,
            wallAnchor: wall(4 + 1 / 3),
            mode: 'realtime',
            turnSeconds: 3600,
            recovery: { startTick: nextTurnBoundary(T), endTick: nextTurnBoundary(9 * T), startWallAt: wall(5) },
        });
        expect(old.nowTick(wall(4.5))).toBe(T / 2);
        expect(old.nowTick(wall(5))).toBe(T);
        expect(old.nowTick(wall(9))).toBe(9 * T);
        expect(old.normalNowTick(wall(4.5))).toBe(4.5 * T);
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

    it.each([
        [14, 11, 60],
        [49, 6, 120],
        [59, 26, 180],
        [100, 15, 240],
        [240, 25, 540],
        [400, 15, 840],
        [700, 15, 1440],
    ])('waits then runs 2x after stopping at 00:10 for %i minutes', (delay, wait, endMinute) => {
        const observed = T / 6;
        const resumed = wall((10 + delay) / 60);
        const plan = planTurnRecovery({
            observedTick: observed,
            normalTick: ((10 + delay) * T) / 60,
            wallNow: resumed,
            turnSeconds: 3600,
        });
        const recovery = plan.recovery!;
        const start = recovery.startWallAt;
        const end = wall(endMinute / 60);
        const clock = new GameClock({
            baseTime: wall(0),
            tick: plan.initialTick,
            wallAnchor: start,
            mode: 'realtime',
            turnSeconds: 3600,
            recovery,
        });
        expect(plan.initialTick).toBe(observed);
        expect(start.getTime() - resumed.getTime()).toBeCloseTo(wait * 60000, 0);
        expect(clock.nowTick(resumed)).toBe(observed);
        expect(clock.nowTick(new Date(start.getTime() - 1))).toBe(observed);
        expect(clock.nowTick(start)).toBe(observed);
        expect(clock.nowTick(new Date(start.getTime() + 1))).toBe(observed + 20);
        expect(clock.tickToWallDate(recovery.endTick)).toEqual(end);
        expect(recovery.endTick % T).toBe(0);
        expect(clock.nowTick(new Date(end.getTime() - 1))).toBe(recovery.endTick - 20);
        expect(clock.nowTick(end)).toBe(clock.normalNowTick(end));
        expect(clock.nowTick(new Date(end.getTime() + 1))).toBe(recovery.endTick + 10);
        expect(clock.executionRate(new Date(end.getTime() - 1))).toBe(2);
        expect(clock.executionRate(end)).toBe(1);
    });

    it.each([300, 3600, 6000, 7200])('uses the strict whole-delay threshold for a %i second turn', (turnSeconds) => {
        const rate = T / turnSeconds;
        const limitMs = Math.min(600, turnSeconds / 10) * 1000;
        for (const delta of [-1, 0, 1]) {
            const delayMs = limitMs + delta;
            const normal = Math.trunc((delayMs * rate) / 1000);
            const plan = planTurnRecovery({
                observedTick: 0,
                normalTick: normal,
                wallNow: new Date(base + delayMs),
                turnSeconds,
            });
            expect(plan.recovery === null).toBe(delta < 0);
            expect(plan.initialTick).toBe(delta < 0 ? normal : 0);
        }
        // 장시간 중단의 작은 나머지에는 즉시 처리 예외를 다시 적용하지 않는다.
        const long = planTurnRecovery({ observedTick: 0, normalTick: 12 * T + rate, wallNow: wall(20), turnSeconds });
        expect(long.skippedTurns).toBe(12);
        expect(long.initialTick).toBe(12 * T);
        expect(long.recovery).not.toBeNull();
    });

    it('keeps integer ticks and deadline ordering for sub-millisecond phases', () => {
        for (const turnSeconds of [300, 3600, 7200, 36000]) {
            const rate = T / turnSeconds;
            for (const observed of [1, T / 6 + 1, T - 1]) {
                const now = wall(4);
                const normal = observed + 4 * T + 1;
                const plan = planTurnRecovery({
                    observedTick: observed,
                    normalTick: normal,
                    wallNow: now,
                    turnSeconds,
                });
                const recovery = plan.recovery!;
                const clock = new GameClock({
                    baseTime: wall(0),
                    tick: observed,
                    wallAnchor: recovery.startWallAt,
                    mode: 'realtime',
                    turnSeconds,
                    recovery,
                });
                expect(recovery.startWallAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
                const end = clock.tickToWallDate(recovery.endTick);
                expect(clock.nowTick(end)).toBe(recovery.endTick);
                expect(clock.nowTick(new Date(end.getTime() - 1))).toBeLessThan(recovery.endTick);
                expect(Math.abs(clock.normalNowTick(now) - normal)).toBeLessThanOrEqual(Math.ceil(rate / 1000));
                for (const tick of [observed + 1, observed + T, recovery.endTick - 1, recovery.endTick + 1]) {
                    const deadline = clock.tickToWallDate(tick);
                    expect(clock.nowTick(deadline)).toBeGreaterThanOrEqual(tick);
                    expect(clock.nowTick(new Date(deadline.getTime() - 1))).toBeLessThan(tick);
                }
            }
        }
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
