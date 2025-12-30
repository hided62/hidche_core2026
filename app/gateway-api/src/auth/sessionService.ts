import type { UserRecord, UserSanctions } from './userRepository.js';

export interface GatewaySessionInfo {
    sessionToken: string;
    userId: string;
    username: string;
    displayName: string;
    roles: string[];
    sanctions: UserSanctions;
    createdAt: string;
    issuedAt: string;
}

export interface GameSessionInfo {
    profile: string;
    gameToken: string;
    sessionToken: string;
    userId: string;
    username: string;
    displayName: string;
    roles: string[];
    sanctions: UserSanctions;
    createdAt: string;
    issuedAt: string;
}

export interface GatewaySessionConfig {
    sessionTtlSeconds: number;
    gameSessionTtlSeconds: number;
}

export interface SessionRevocationOptions {
    revokeGames?: boolean;
}

export interface GatewaySessionService {
    createSession(user: UserRecord): Promise<GatewaySessionInfo>;
    getSession(sessionToken: string): Promise<GatewaySessionInfo | null>;
    revokeSession(sessionToken: string, options?: SessionRevocationOptions): Promise<void>;
    createGameSession(sessionToken: string, profile: string): Promise<GameSessionInfo | null>;
    getGameSession(profile: string, gameToken: string): Promise<GameSessionInfo | null>;
}
