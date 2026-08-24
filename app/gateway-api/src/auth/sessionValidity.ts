import type { GatewaySessionInfo } from './sessionService.js';
import type { UserRecord } from './userRepository.js';

export const isGatewaySessionCurrent = (session: GatewaySessionInfo, user: UserRecord): boolean => {
    if ((session.authRevision ?? 0) !== (user.authRevision ?? 0)) return false;
    if (!user.sessionRevokedBefore) return true;
    const issuedAt = new Date(session.issuedAt).getTime();
    const revokedBefore = new Date(user.sessionRevokedBefore).getTime();
    return Number.isFinite(issuedAt) && Number.isFinite(revokedBefore) && issuedAt >= revokedBefore;
};
