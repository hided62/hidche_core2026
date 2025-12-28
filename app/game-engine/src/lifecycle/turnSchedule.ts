import type { TurnSchedule } from './types.js';

export class FixedIntervalSchedule implements TurnSchedule {
    // 일정 간격으로 턴을 진행하는 스케줄러.
    private intervalMs: number;

    constructor(intervalMs: number) {
        if (intervalMs <= 0) {
            throw new Error('intervalMs must be positive');
        }
        this.intervalMs = intervalMs;
    }

    getNextTurnTime(lastTurnTime: Date): Date {
        return new Date(lastTurnTime.getTime() + this.intervalMs);
    }
}
