import { describe, expect, it } from 'vitest';

import { ManualClock, StepClock } from '../src/time/Clock.js';

describe('ManualClock', () => {
    it('returns current time without advancing', () => {
        const clock = new ManualClock(1000);
        expect(clock.nowMs()).toBe(1000);
        expect(clock.nowMs()).toBe(1000);
    });

    it('advances with sleep and manual advance', async () => {
        const clock = new ManualClock(0);
        await clock.sleepMs(250);
        expect(clock.nowMs()).toBe(250);
        clock.advanceMs(750);
        expect(clock.nowMs()).toBe(1000);
    });

    it('can set time explicitly', () => {
        const clock = new ManualClock(10);
        clock.setMs(5000);
        expect(clock.nowMs()).toBe(5000);
    });
});

describe('StepClock', () => {
    it('advances on each nowMs call', () => {
        const clock = new StepClock(100, 0);
        expect(clock.nowMs()).toBe(100);
        expect(clock.nowMs()).toBe(200);
        expect(clock.nowMs()).toBe(300);
    });

    it('advances with sleep', async () => {
        const clock = new StepClock(50, 1000);
        await clock.sleepMs(200);
        expect(clock.nowMs()).toBe(1250);
    });

    it('advances manually', () => {
        const clock = new StepClock(10, 0);
        clock.advanceMs(50);
        expect(clock.nowMs()).toBe(60);
    });

    it('rejects non-positive step', () => {
        expect(() => new StepClock(0)).toThrow('stepMs must be positive');
        expect(() => new StepClock(-5)).toThrow('stepMs must be positive');
    });
});
