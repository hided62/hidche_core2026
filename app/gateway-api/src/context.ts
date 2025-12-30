import type { GatewayFlushPublisher } from './auth/flushPublisher.js';
import type { GatewaySessionService } from './auth/sessionService.js';
import type { UserRepository } from './auth/userRepository.js';
import type { KakaoOAuthClient } from './auth/kakaoClient.js';
import type { OAuthSessionStore } from './auth/oauthSessionStore.js';

export interface GatewayApiContext {
    users: UserRepository;
    sessions: GatewaySessionService;
    flushPublisher: GatewayFlushPublisher;
    gameTokenSecret: string;
    gameSessionTtlSeconds: number;
    kakaoClient: KakaoOAuthClient;
    oauthSessions: OAuthSessionStore;
    publicBaseUrl: string;
}

export const createGatewayApiContext = (options: {
    users: UserRepository;
    sessions: GatewaySessionService;
    flushPublisher: GatewayFlushPublisher;
    gameTokenSecret: string;
    gameSessionTtlSeconds: number;
    kakaoClient: KakaoOAuthClient;
    oauthSessions: OAuthSessionStore;
    publicBaseUrl: string;
}): GatewayApiContext => ({
    users: options.users,
    sessions: options.sessions,
    flushPublisher: options.flushPublisher,
    gameTokenSecret: options.gameTokenSecret,
    gameSessionTtlSeconds: options.gameSessionTtlSeconds,
    kakaoClient: options.kakaoClient,
    oauthSessions: options.oauthSessions,
    publicBaseUrl: options.publicBaseUrl,
});
