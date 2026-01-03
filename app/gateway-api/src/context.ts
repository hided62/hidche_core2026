import type { GatewayFlushPublisher } from './auth/flushPublisher.js';
import type { GatewaySessionService } from './auth/sessionService.js';
import type { UserRepository } from './auth/userRepository.js';
import type { KakaoOAuthClient } from './auth/kakaoClient.js';
import type { OAuthSessionStore } from './auth/oauthSessionStore.js';
import type { GatewayProfileRepository } from './orchestrator/profileRepository.js';
import type { GatewayOrchestratorHandle } from './orchestrator/gatewayOrchestrator.js';
import type { GatewayProfileStatusService } from './lobby/profileStatusService.js';

export interface GatewayApiContext {
    users: UserRepository;
    sessions: GatewaySessionService;
    flushPublisher: GatewayFlushPublisher;
    gameTokenSecret: string;
    gameSessionTtlSeconds: number;
    kakaoClient: KakaoOAuthClient;
    oauthSessions: OAuthSessionStore;
    publicBaseUrl: string;
    profiles: GatewayProfileRepository;
    orchestrator: GatewayOrchestratorHandle;
    profileStatus: GatewayProfileStatusService;
    adminToken?: string;
    requestHeaders: Record<string, string | string[] | undefined>;
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
    profiles: GatewayProfileRepository;
    orchestrator: GatewayOrchestratorHandle;
    profileStatus: GatewayProfileStatusService;
    adminToken?: string;
    requestHeaders?: Record<string, string | string[] | undefined>;
}): GatewayApiContext => ({
    users: options.users,
    sessions: options.sessions,
    flushPublisher: options.flushPublisher,
    gameTokenSecret: options.gameTokenSecret,
    gameSessionTtlSeconds: options.gameSessionTtlSeconds,
    kakaoClient: options.kakaoClient,
    oauthSessions: options.oauthSessions,
    publicBaseUrl: options.publicBaseUrl,
    profiles: options.profiles,
    orchestrator: options.orchestrator,
    profileStatus: options.profileStatus,
    adminToken: options.adminToken,
    requestHeaders: options.requestHeaders ?? {},
});
