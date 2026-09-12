import { describe, expect, it, vi } from 'vitest';
import type { GameClockPhase } from '@sammo-ts/common';
import { createRuntimePauseGate } from '../src/turn/runtimePauseGate.js';

describe('runtime pause clock boundary', () => {
    it('freezes a live error pause before commands, resumes without restart, and does not freeze twice', async () => {
        let phase: GameClockPhase = 'RUNNING';
        let paused = true;
        const calls: string[] = [];
        const gate = createRuntimePauseGate({
            assertLease: () => calls.push('lease'),
            shouldPause: async () => paused,
            isExplicitlyPaused: () => paused,
            getPhase: () => phase,
            prepareRecovery: async ({ paused }) => {
                calls.push(paused ? 'freeze' : 'resume');
                phase = paused ? 'SUSPENDED' : 'RECONCILING';
            },
            synchronize: async () => calls.push('sync'),
        });
        expect(await gate()).toBe(true);
        expect(phase).toBe('SUSPENDED');
        expect(calls).toEqual(['lease', 'freeze', 'sync']);
        await gate();
        expect(calls.filter((call) => call === 'freeze')).toHaveLength(1);
        paused = false;
        expect(await gate()).toBe(false);
        expect(phase).toBe('RECONCILING');
        expect(calls.slice(-3)).toEqual(['lease', 'resume', 'sync']);
    });

    it.each(['PREOPEN', 'RUNNING', 'COMPLETED'] as const)(
        'preserves the planned opening when the Gateway is PREOPEN and the clock is %s',
        async (phase) => {
            const prepareRecovery = vi.fn();
            const gate = createRuntimePauseGate({
                assertLease: () => {},
                shouldPause: async () => true,
                isExplicitlyPaused: () => false,
                getPhase: () => phase,
                prepareRecovery,
                synchronize: async () => {},
            });
            expect(await gate()).toBe(true);
            expect(prepareRecovery).not.toHaveBeenCalled();
        }
    );

    it('does not touch the clock after lease loss', async () => {
        const prepareRecovery = vi.fn();
        const gate = createRuntimePauseGate({
            assertLease: () => {
                throw new Error('lease lost');
            },
            shouldPause: async () => true,
            isExplicitlyPaused: () => true,
            getPhase: () => 'RUNNING',
            prepareRecovery,
            synchronize: async () => {},
        });
        await expect(gate()).rejects.toThrow('lease lost');
        expect(prepareRecovery).not.toHaveBeenCalled();
    });
});
