import type { GatewaySessionInfo } from './auth/sessionService.js';
import type { UserRecord } from './auth/userRepository.js';

export interface AdminAuthContext {
    session: GatewaySessionInfo;
    user: UserRecord;
    isSuperuser: boolean;
    roles: string[];
}
