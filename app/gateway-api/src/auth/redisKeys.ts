export interface GatewayRedisKeyBuilder {
    sessionKey(sessionToken: string): string;
    sessionGameSetKey(sessionToken: string): string;
    gameSessionKey(profile: string, gameToken: string): string;
}

export const createGatewayRedisKeyBuilder = (prefix: string): GatewayRedisKeyBuilder => ({
    sessionKey: (sessionToken: string) => `${prefix}:session:${sessionToken}`,
    sessionGameSetKey: (sessionToken: string) => `${prefix}:session-games:${sessionToken}`,
    gameSessionKey: (profile: string, gameToken: string) => `${prefix}:game-session:${profile}:${gameToken}`,
});
