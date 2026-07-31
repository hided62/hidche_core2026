import { describe, expect, it, vi } from 'vitest';

import { InMemoryTurnDaemonTransport } from '../src/daemon/inMemoryTransport.js';
import { createAdminProfileIconResetFlushHandler } from '../src/services/accountIconSync.js';

describe('administrator profile icon reset flush', () => {
    it('enqueues only the administrator reset projection', async () => {
        const transport = new InMemoryTurnDaemonTransport();
        const get = vi.fn(async () => ({
            revision: '2026-07-31T09:00:00.001Z',
            picture: 'default.jpg',
            imageServer: 0,
        }));
        const handler = createAdminProfileIconResetFlushHandler({ get }, transport);

        await handler({
            userId: 'user-1',
            flushedAt: '2026-07-31T09:00:00.000Z',
            reason: 'account-icon-changed',
        });
        expect(get).not.toHaveBeenCalled();
        expect(transport.commands).toHaveLength(0);

        await handler({
            userId: 'user-1',
            flushedAt: '2026-07-31T09:00:00.001Z',
            reason: 'admin-profile-icon-reset',
            iconRevision: '2026-07-31T09:00:00.001Z',
        });
        expect(transport.commands.at(-1)?.command).toEqual({
            type: 'adjustGeneralIcon',
            requestId: 'general:adjustIcon:user-1:2026-07-31T09:00:00.001Z',
            userId: 'user-1',
            picture: 'default.jpg',
            imageServer: 0,
            iconRevision: '2026-07-31T09:00:00.001Z',
        });

        get.mockResolvedValueOnce({
            revision: '2026-07-31T09:00:00.002Z',
            picture: 'default.jpg',
            imageServer: 0,
        });
        await handler({
            userId: 'user-1',
            flushedAt: '2026-07-31T09:00:00.003Z',
            reason: 'admin-profile-icon-reset',
            iconRevision: '2026-07-31T09:00:00.001Z',
        });
        expect(transport.commands).toHaveLength(1);
    });
});
