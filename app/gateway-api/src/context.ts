import type { GatewayFlushPublisher } from './auth/flushPublisher.js';
import type { GatewaySessionService } from './auth/sessionService.js';
import type { UserRepository } from './auth/userRepository.js';

export interface GatewayApiContext {
    users: UserRepository;
    sessions: GatewaySessionService;
    flushPublisher: GatewayFlushPublisher;
    gameTokenSecret: string;
    gameSessionTtlSeconds: number;
}

export const createGatewayApiContext = (options: {
    users: UserRepository;
    sessions: GatewaySessionService;
    flushPublisher: GatewayFlushPublisher;
    gameTokenSecret: string;
    gameSessionTtlSeconds: number;
}): GatewayApiContext => ({
    users: options.users,
    sessions: options.sessions,
    flushPublisher: options.flushPublisher,
    gameTokenSecret: options.gameTokenSecret,
    gameSessionTtlSeconds: options.gameSessionTtlSeconds,
});
