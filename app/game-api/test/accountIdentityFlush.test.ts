import { describe, expect, it } from 'vitest';

import { InMemoryTurnDaemonTransport } from '../src/daemon/inMemoryTransport.js';
import {
    createAccountIdentityFlushHandler,
    enqueueAccountIdentityForUser,
} from '../src/services/accountIdentitySync.js';

describe('account identity projection', () => {
    it('enqueues only a complete administrator identity update event', async () => {
        const transport = new InMemoryTurnDaemonTransport();
        const handler = createAccountIdentityFlushHandler(transport);
        const revision = '2026-08-24T12:00:00.000Z';

        await handler({ userId: 'user-1', flushedAt: revision, reason: 'admin-roles-updated' });
        await handler({
            userId: 'user-1',
            flushedAt: revision,
            reason: 'admin-account-identity-updated',
            displayName: '새닉네임',
        });
        expect(transport.commands).toHaveLength(0);

        await handler({
            userId: 'user-1',
            flushedAt: revision,
            reason: 'admin-account-identity-updated',
            displayName: '새닉네임',
            identityRevision: revision,
        });
        expect(transport.commands.at(-1)?.command).toEqual({
            type: 'adjustGeneralIdentity',
            requestId: `general:adjustIdentity:user-1:${revision}`,
            userId: 'user-1',
            displayName: '새닉네임',
            identityRevision: revision,
        });
    });

    it('uses the same idempotency key at the next authentication boundary', async () => {
        const transport = new InMemoryTurnDaemonTransport();
        const revision = '2026-08-24T12:00:00.000Z';

        await enqueueAccountIdentityForUser(transport, 'user-1', '새닉네임', revision);

        expect(transport.commands.at(-1)?.command.requestId).toBe(`general:adjustIdentity:user-1:${revision}`);
    });
});
