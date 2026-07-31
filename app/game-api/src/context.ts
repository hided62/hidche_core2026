import { z } from 'zod';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { DatabaseClient as InfraDatabaseClient, RedisConnector, GamePrisma } from '@sammo-ts/infra';
import { normalizeScenarioEffect, SCENARIO_EFFECT_KEYS } from '@sammo-ts/logic';

import type { TurnDaemonTransport } from './daemon/transport.js';
import type { BattleSimTransport } from './battleSim/transport.js';
import type { FlushStore } from './auth/flushStore.js';
import type { RedisAccessTokenStore } from './auth/accessTokenStore.js';
import type { AccountIconSource } from './auth/accountIconSource.js';

export interface GameProfile {
    id: string;
    scenario: string;
    name: string;
}

export const zWorldStateConfig = z.object({
    maxUserCnt: z.number().optional(),
    fictionMode: z.string().optional(),
    fiction: z.number().optional(),
    joinMode: z.string().optional(),
    blockGeneralCreate: z.number().optional(),
    npcMode: z.number().optional(),
    showImgLevel: z.number().optional(),
    tournamentTrig: z.boolean().optional(),
    extendedGeneral: z.boolean().optional(),
    turnTermMinutes: z.number().optional(),
    syncTurnTime: z.boolean().optional(),
    environment: z
        .object({
            scenarioEffect: z
                .union([z.enum(SCENARIO_EFFECT_KEYS), z.literal(''), z.literal('None'), z.null()])
                .transform(normalizeScenarioEffect)
                .optional(),
        })
        .optional(),
});
export type WorldStateConfig = z.infer<typeof zWorldStateConfig>;

export const zWorldStateMeta = z.object({
    starttime: z.string().optional(),
    opentime: z.string().optional(),
    preopenAt: z.string().optional(),
    turntime: z.string().optional(),
    otherTextInfo: z.string().optional(),
    isUnited: z.number().optional(),
    autorun_user: z
        .object({
            limit_minutes: z.number().optional(),
            options: z.record(z.string(), z.boolean()).optional(),
        })
        .nullable()
        .optional(),
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
    requestId?: string;
    generalAccessTracking?: boolean;
    db: DatabaseClient;
    redis: RedisConnector['client'];
    turnDaemon: TurnDaemonTransport;
    battleSim: BattleSimTransport;
    profile: GameProfile;
    uploadDir: string;
    uploadPath: string;
    uploadPublicUrl: string | null;
    auth: GameSessionTokenPayload | null;
    accessTokenStore: RedisAccessTokenStore;
    flushStore: FlushStore;
    gameTokenSecret: string;
    accountIconSource?: AccountIconSource;
}

export const createGameApiContext = (options: {
    requestId?: string;
    db: DatabaseClient;
    redis: RedisConnector['client'];
    turnDaemon: TurnDaemonTransport;
    battleSim: BattleSimTransport;
    profile: GameProfile;
    uploadDir: string;
    uploadPath: string;
    uploadPublicUrl: string | null;
    auth: GameSessionTokenPayload | null;
    accessTokenStore: RedisAccessTokenStore;
    flushStore: FlushStore;
    gameTokenSecret: string;
    accountIconSource?: AccountIconSource;
}): GameApiContext => {
    return {
        requestId: options.requestId,
        generalAccessTracking: true,
        db: options.db,
        redis: options.redis,
        turnDaemon: options.turnDaemon,
        battleSim: options.battleSim,
        profile: options.profile,
        uploadDir: options.uploadDir,
        uploadPath: options.uploadPath,
        uploadPublicUrl: options.uploadPublicUrl,
        auth: options.auth,
        accessTokenStore: options.accessTokenStore,
        flushStore: options.flushStore,
        gameTokenSecret: options.gameTokenSecret,
        ...(options.accountIconSource ? { accountIconSource: options.accountIconSource } : {}),
    };
};
