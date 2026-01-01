import { describe, expect, it } from 'vitest';

import { planProfileReconcile } from '../src/orchestrator/gatewayOrchestrator.js';

describe('planProfileReconcile', () => {
    it('starts missing processes for running profiles', () => {
        expect(
            planProfileReconcile('RUNNING', {
                apiRunning: true,
                daemonRunning: false,
            })
        ).toEqual({ shouldStart: true, shouldStop: false });
    });

    it('starts processes for preopen profiles', () => {
        expect(
            planProfileReconcile('PREOPEN', {
                apiRunning: false,
                daemonRunning: false,
            })
        ).toEqual({ shouldStart: true, shouldStop: false });
    });

    it('does nothing when running profile is healthy', () => {
        expect(
            planProfileReconcile('RUNNING', {
                apiRunning: true,
                daemonRunning: true,
            })
        ).toEqual({ shouldStart: false, shouldStop: false });
    });

    it('stops processes for non-running profiles', () => {
        expect(
            planProfileReconcile('STOPPED', {
                apiRunning: false,
                daemonRunning: true,
            })
        ).toEqual({ shouldStart: false, shouldStop: true });
    });

    it('keeps reserved profiles off', () => {
        expect(
            planProfileReconcile('RESERVED', {
                apiRunning: false,
                daemonRunning: false,
            })
        ).toEqual({ shouldStart: false, shouldStop: false });
    });
});
