import { isCanonicalIsoTimestamp } from '@sammo-ts/common';

import type { GatewayUserFlushEvent } from '../auth/flushStore.js';
import type { TurnDaemonTransport } from '../daemon/transport.js';

export const enqueueAccountIdentityForUser = async (
    turnDaemon: TurnDaemonTransport,
    userId: string,
    displayName: string,
    identityRevision: string
): Promise<void> => {
    await turnDaemon.sendCommand({
        type: 'adjustGeneralIdentity',
        requestId: `general:adjustIdentity:${userId}:${identityRevision}`,
        userId,
        displayName,
        identityRevision,
    });
};

export const createAccountIdentityFlushHandler =
    (turnDaemon: TurnDaemonTransport) =>
    async (event: GatewayUserFlushEvent): Promise<void> => {
        if (event.reason !== 'admin-account-identity-updated') return;
        if (!event.displayName || !event.identityRevision || !isCanonicalIsoTimestamp(event.identityRevision)) return;
        await enqueueAccountIdentityForUser(turnDaemon, event.userId, event.displayName, event.identityRevision);
    };
