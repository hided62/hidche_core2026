import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken.js';

import type { TurnDaemonTransport } from './daemon/transport.js';

export interface GameProfile {
    id: string;
    scenario: string;
    name: string;
}

export interface WorldStateRow {
    scenarioCode: string;
    currentYear: number;
    currentMonth: number;
    tickSeconds: number;
    config: unknown;
    meta: unknown;
    updatedAt: Date;
}

export interface DatabaseClient {
    worldState: {
        findFirst(args?: unknown): Promise<WorldStateRow | null>;
    };
}

export interface GameApiContext {
    db: DatabaseClient;
    turnDaemon: TurnDaemonTransport;
    profile: GameProfile;
    auth: GameSessionTokenPayload | null;
}

export const createGameApiContext = (options: {
    db: DatabaseClient;
    turnDaemon: TurnDaemonTransport;
    profile: GameProfile;
    auth: GameSessionTokenPayload | null;
}): GameApiContext => {
    return {
        db: options.db,
        turnDaemon: options.turnDaemon,
        profile: options.profile,
        auth: options.auth,
    };
};
