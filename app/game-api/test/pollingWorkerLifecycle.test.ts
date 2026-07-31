import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPollingWorkerControl, waitForWorkerPoll } from '../src/services/pollingWorkerLifecycle.js';

afterEach(() => {
    vi.useRealTimers();
});

describe('polling worker lifecycle', () => {
    it('merges repeated process signals and external abort into one idempotent stop signal', () => {
        const external = new AbortController();
        const control = createPollingWorkerControl(external.signal);
        const aborts = vi.fn();
        control.signal.addEventListener('abort', aborts);

        process.emit('SIGTERM');
        process.emit('SIGINT');
        external.abort();

        expect(control.signal.aborted).toBe(true);
        expect(aborts).toHaveBeenCalledTimes(1);
        control.dispose();
    });

    it('interrupts an idle poll without canceling caller-owned in-flight work', async () => {
        vi.useFakeTimers();
        const external = new AbortController();
        const control = createPollingWorkerControl(external.signal);
        const wait = waitForWorkerPoll(control.signal, 60_000);

        external.abort();
        await expect(wait).resolves.toBeUndefined();
        control.dispose();
    });
});
