import { describe, expect, it } from 'vitest';

import type { GameApiContext } from '../src/context.js';
import { appRouter } from '../src/router.js';

const context = {
    auth: null,
    generalAccessTracking: true,
    db: {},
    profile: { id: 'che', name: 'che:default', scenario: 'default' },
    profileStatusSource: { get: async () => 'RUNNING' as const },
} as unknown as GameApiContext;

describe('public.recordAccess endpoint', () => {
    it('keeps anonymous page telemetry as an accepted no-op outside input_event', async () => {
        await expect(appRouter.createCaller(context).public.recordAccess({ page: 'traffic' })).resolves.toEqual({
            recorded: false,
        });
    });

    it('rejects page names outside the server-owned Ref access inventory', async () => {
        await expect(
            appRouter.createCaller(context).public.recordAccess({ page: 'forged-page' } as never)
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
});
