import type { GatewaySessionService } from './auth/sessionService.js';
import type { UserRepository } from './auth/userRepository.js';

export interface GatewayApiContext {
    users: UserRepository;
    sessions: GatewaySessionService;
}

export const createGatewayApiContext = (options: {
    users: UserRepository;
    sessions: GatewaySessionService;
}): GatewayApiContext => ({
    users: options.users,
    sessions: options.sessions,
});
