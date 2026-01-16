import { z } from 'zod';
import type { GameSessionTokenPayload } from '@sammo-ts/common';
import type { DatabaseClient as InfraDatabaseClient, RedisConnector, GamePrisma } from '@sammo-ts/infra';

import type { TurnDaemonTransport } from './daemon/transport.js';
import type { BattleSimTransport } from './battleSim/transport.js';
import type { FlushStore } from './auth/flushStore.js';
import type { RedisAccessTokenStore } from './auth/accessTokenStore.js';

export interface GameProfile {
    id: string;
    scenario: string;
    name: string;
}

export const zWorldStateConfig = z.object({
    maxUserCnt: z.number().optional(),
    fictionMode: z.string().optional(),
});
export type WorldStateConfig = z.infer<typeof zWorldStateConfig>;

export const zWorldStateMeta = z.object({
    starttime: z.string().optional(),
    opentime: z.string().optional(),
    turntime: z.string().optional(),
    otherTextInfo: z.string().optional(),
    isUnited: z.number().optional(),
});
export type WorldStateMeta = z.infer<typeof zWorldStateMeta>;

export type WorldStateRow = GamePrisma.WorldStateGetPayload<Record<string, never>>;
export type GeneralRow = GamePrisma.GeneralGetPayload<Record<string, never>>;
export type GeneralTurnRow = GamePrisma.GeneralTurnGetPayload<Record<string, never>>;
export type NationTurnRow = GamePrisma.NationTurnGetPayload<Record<string, never>>;
export type CityRow = GamePrisma.CityGetPayload<Record<string, never>>;
export type NationRow = GamePrisma.NationGetPayload<Record<string, never>>;
export type TroopRow = GamePrisma.TroopGetPayload<Record<string, never>>;

export type JsonValue = GamePrisma.JsonValue;
export type JsonObject = GamePrisma.JsonObject;
export type JsonArray = GamePrisma.JsonArray;
export type InputJsonValue = GamePrisma.InputJsonValue;

export type DatabaseClient = InfraDatabaseClient;

export interface GameApiContext {
    db: DatabaseClient;
    redis: RedisConnector['client'];
    turnDaemon: TurnDaemonTransport;
    battleSim: BattleSimTransport;
    profile: GameProfile;
    auth: GameSessionTokenPayload | null;
    accessTokenStore: RedisAccessTokenStore;
    flushStore: FlushStore;
    gameTokenSecret: string;
}

export const createGameApiContext = (options: {
    db: DatabaseClient;
    redis: RedisConnector['client'];
    turnDaemon: TurnDaemonTransport;
    battleSim: BattleSimTransport;
    profile: GameProfile;
    auth: GameSessionTokenPayload | null;
    accessTokenStore: RedisAccessTokenStore;
    flushStore: FlushStore;
    gameTokenSecret: string;
}): GameApiContext => {
    return {
        db: options.db,
        redis: options.redis,
        turnDaemon: options.turnDaemon,
        battleSim: options.battleSim,
        profile: options.profile,
        auth: options.auth,
        accessTokenStore: options.accessTokenStore,
        flushStore: options.flushStore,
        gameTokenSecret: options.gameTokenSecret,
    };
};
