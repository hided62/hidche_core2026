import type { GatewayFlushPublisher } from './auth/flushPublisher.js';
import type { GatewaySessionService } from './auth/sessionService.js';
import type { UserRepository } from './auth/userRepository.js';
import type { KakaoOAuthClient } from './auth/kakaoClient.js';
import type { OAuthSessionStore } from './auth/oauthSessionStore.js';
import type { GatewayProfileRepository } from './orchestrator/profileRepository.js';
import {
    createGatewayReleaseRepository,
    type GatewayReleaseRepository,
} from './orchestrator/gatewayReleaseRepository.js';
import type { GatewayOrchestratorHandle } from './orchestrator/gatewayOrchestrator.js';
import type { GatewayProfileStatusService } from './lobby/profileStatusService.js';
import type { GatewayPrismaClient } from '@sammo-ts/infra';
import type { AdminAuthContext } from './adminAuth.js';
import type { PasswordEnvelopeService } from './auth/passwordEnvelope.js';

export interface GatewayApiContext {
    users: UserRepository;
    sessions: GatewaySessionService;
    flushPublisher: GatewayFlushPublisher;
    gameTokenSecret: string;
    gameSessionTtlSeconds: number;
    kakaoClient: KakaoOAuthClient;
    oauthSessions: OAuthSessionStore;
    publicBaseUrl: string;
    userIconDir: string;
    userIconPublicUrl: string;
    adminLocalAccountEnabled: boolean;
    localRegistrationEnabled: boolean;
    localAccountGraceDays: number;
    passwordEnvelope: PasswordEnvelopeService;
    profiles: GatewayProfileRepository;
    releases: GatewayReleaseRepository;
    orchestrator: GatewayOrchestratorHandle;
    profileStatus: GatewayProfileStatusService;
    requestHeaders: Record<string, string | string[] | undefined>;
    prisma: GatewayPrismaClient;
    adminAuth?: AdminAuthContext;
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
    userIconDir?: string;
    userIconPublicUrl?: string;
    adminLocalAccountEnabled: boolean;
    localRegistrationEnabled: boolean;
    localAccountGraceDays: number;
    passwordEnvelope: PasswordEnvelopeService;
    profiles: GatewayProfileRepository;
    releases?: GatewayReleaseRepository;
    orchestrator: GatewayOrchestratorHandle;
    profileStatus: GatewayProfileStatusService;
    requestHeaders?: Record<string, string | string[] | undefined>;
    prisma: GatewayPrismaClient;
}): GatewayApiContext => ({
    users: options.users,
    sessions: options.sessions,
    flushPublisher: options.flushPublisher,
    gameTokenSecret: options.gameTokenSecret,
    gameSessionTtlSeconds: options.gameSessionTtlSeconds,
    kakaoClient: options.kakaoClient,
    oauthSessions: options.oauthSessions,
    publicBaseUrl: options.publicBaseUrl,
    userIconDir: options.userIconDir ?? 'uploads/user-icons',
    userIconPublicUrl: options.userIconPublicUrl ?? `${options.publicBaseUrl.replace(/\/$/, '')}/user-icons`,
    adminLocalAccountEnabled: options.adminLocalAccountEnabled,
    localRegistrationEnabled: options.localRegistrationEnabled,
    localAccountGraceDays: options.localAccountGraceDays,
    passwordEnvelope: options.passwordEnvelope,
    profiles: options.profiles,
    releases: options.releases ?? createGatewayReleaseRepository(options.prisma),
    orchestrator: options.orchestrator,
    profileStatus: options.profileStatus,
    requestHeaders: options.requestHeaders ?? {},
    prisma: options.prisma,
});
