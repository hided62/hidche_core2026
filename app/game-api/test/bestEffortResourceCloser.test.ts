import { describe, expect, it, vi } from 'vitest';

import { createBestEffortResourceCloser } from '../src/services/bestEffortResourceCloser.js';

describe('createBestEffortResourceCloser', () => {
    it('continues after a failed step and retries only the unfinished step', async () => {
        const calls: string[] = [];
        let rejectMiddle = true;
        const close = createBestEffortResourceCloser([
            {
                name: 'first',
                run: async () => {
                    calls.push('first');
                },
            },
            {
                name: 'middle',
                run: async () => {
                    calls.push('middle');
                    if (rejectMiddle) throw new Error('temporary failure');
                },
            },
            {
                name: 'last',
                run: async () => {
                    calls.push('last');
                },
            },
        ]);

        await expect(close()).rejects.toThrow('One or more resources failed to close.');
        expect(calls).toEqual(['first', 'middle', 'last']);

        rejectMiddle = false;
        await close();
        await close();
        expect(calls).toEqual(['first', 'middle', 'last', 'middle']);
    });

    it('shares one in-flight close across concurrent callers', async () => {
        let release: (() => void) | undefined;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        const run = vi.fn(async () => pending);
        const close = createBestEffortResourceCloser([{ name: 'only', run }]);

        const first = close();
        const second = close();
        expect(run).toHaveBeenCalledTimes(1);
        release?.();
        await Promise.all([first, second]);
        expect(run).toHaveBeenCalledTimes(1);
    });
});
