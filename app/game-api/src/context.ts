import { z } from 'zod';
import type { GameSessionTokenPayload } from '@sammo-ts/common';
import type { DatabaseClient as InfraDatabaseClient, RedisConnector, GamePrisma } from '@sammo-ts/infra';

import type { TurnDaemonTransport } from './daemon/transport.js';
import type { BattleSimTransport } from './battleSim/transport.js';

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

export type WorldStateRow = GamePrisma.WorldStateGetPayload<{}>;
export type GeneralRow = GamePrisma.GeneralGetPayload<{}>;
export type GeneralTurnRow = GamePrisma.GeneralTurnGetPayload<{}>;
export type NationTurnRow = GamePrisma.NationTurnGetPayload<{}>;
export type CityRow = GamePrisma.CityGetPayload<{}>;
export type NationRow = GamePrisma.NationGetPayload<{}>;
export type TroopRow = GamePrisma.TroopGetPayload<{}>;

export type JsonValue = GamePrisma.JsonValue;
export type InputJsonValue = GamePrisma.InputJsonValue;

export type DatabaseClient = InfraDatabaseClient;

export interface GameApiContext {
    db: DatabaseClient;
    redis: RedisConnector['client'];
    turnDaemon: TurnDaemonTransport;
    battleSim: BattleSimTransport;
    profile: GameProfile;
    auth: GameSessionTokenPayload | null;
}

export const createGameApiContext = (options: {
    db: DatabaseClient;
    redis: RedisConnector['client'];
    turnDaemon: TurnDaemonTransport;
    battleSim: BattleSimTransport;
    profile: GameProfile;
    auth: GameSessionTokenPayload | null;
}): GameApiContext => {
    return {
        db: options.db,
        redis: options.redis,
        turnDaemon: options.turnDaemon,
        battleSim: options.battleSim,
        profile: options.profile,
        auth: options.auth,
    };
};
