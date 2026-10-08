import type { UserRecord, UserSanctions } from './userRepository.js';

// 한 Gateway 로그인에서 여러 profile/탭을 사용하되 추적 자료는 유한하게 유지한다.
export const MAX_GAME_SESSIONS_PER_SESSION = 256;
export class GameSessionLimitError extends Error {
    constructor() {
        super('Game session limit reached.');
    }
}

export interface GatewaySessionInfo {
    sessionToken: string;
    userId: string;
    username: string;
    displayName: string;
    roles: string[];
    sanctions: UserSanctions;
    createdAt: string;
    issuedAt: string;
    authRevision?: number;
    legacyMemberNo?: number;
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
    authRevision?: number;
    legacyMemberNo?: number;
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
