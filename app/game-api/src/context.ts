import { z } from 'zod';
import type { ChangeJournal } from '@sammo-ts/common';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import type { DatabaseClient as InfraDatabaseClient, RedisConnector, GamePrisma } from '@sammo-ts/infra';
import { normalizeScenarioEffect, SCENARIO_EFFECT_KEYS } from '@sammo-ts/logic';

import type { TurnDaemonTransport } from './daemon/transport.js';
import type { BattleSimTransport } from './battleSim/transport.js';
import type { FlushStore } from './auth/flushStore.js';
import type { RedisAccessTokenStore } from './auth/accessTokenStore.js';
import type { AccountIconSource } from './auth/accountIconSource.js';
import type { ProfileStatusSource } from './auth/profileStatusSource.js';
import type { ContentImageUploadStore } from './services/remoteContentImageStore.js';
import type { ReadModelOutboxWakeup } from './realtime/outboxWorker.js';

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
    isunited: z.number().optional(),
    autorun_user: z
        .object({
            limit_minutes: z.number().optional(),
            options: z.record(z.string(), z.boolean()).optional(),
        })
        .nullable()
        .optional(),
});
export type WorldStateMeta = z.infer<typeof zWorldStateMeta>;

type PrismaWorldStateRow = GamePrisma.WorldStateGetPayload<Record<string, never>>;
type PrismaGeneralRow = GamePrisma.GeneralGetPayload<Record<string, never>>;
type WorldClockFields = 'clockBaseTime' | 'clockTick' | 'clockMode' | 'clockWallAnchor' | 'lastTurnTick';
type GeneralClockFields = 'turnTick' | 'recentWarTick';

// Transitional API fixtures may still model the pre-clock row. Runtime Prisma
// rows always include these nullable columns after migration.
export type WorldStateRow = Omit<PrismaWorldStateRow, WorldClockFields> &
    Partial<Pick<PrismaWorldStateRow, WorldClockFields>>;
export type GeneralRow = Omit<PrismaGeneralRow, GeneralClockFields> &
    Partial<Pick<PrismaGeneralRow, GeneralClockFields>>;
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
    /** Validated server-issued proof for one realtime refresh burst. */
    realtimeAccessGranted?: boolean;
    /** Set only while an API input-event transaction owns the mutation. */
    changeJournal?: ChangeJournal;
    /** Post-commit scheduling hint for the durable outbox dispatcher. */
    readModelOutbox?: ReadModelOutboxWakeup;
    db: DatabaseClient;
    redis: RedisConnector['client'];
    turnDaemon: TurnDaemonTransport;
    battleSim: BattleSimTransport;
    profile: GameProfile;
    uploadDir: string;
    uploadPath: string;
    uploadPublicUrl: string | null;
    contentImageUpload?: ContentImageUploadStore;
    auth: GameSessionTokenPayload | null;
    accessToken?: string;
    accessTokenStore: RedisAccessTokenStore;
    flushStore: FlushStore;
    gameTokenSecret: string;
    accountIconSource?: AccountIconSource;
    // Runtime context always supplies this. Partial router fixtures may omit it;
    // access scoring then fails open and never penalizes a test-only request.
    profileStatusSource?: ProfileStatusSource;
}

export const createGameApiContext = (options: {
    requestId?: string;
    realtimeAccessGranted?: boolean;
    db: DatabaseClient;
    redis: RedisConnector['client'];
    turnDaemon: TurnDaemonTransport;
    battleSim: BattleSimTransport;
    profile: GameProfile;
    uploadDir: string;
    uploadPath: string;
    uploadPublicUrl: string | null;
    contentImageUpload?: ContentImageUploadStore;
    auth: GameSessionTokenPayload | null;
    accessToken?: string;
    accessTokenStore: RedisAccessTokenStore;
    flushStore: FlushStore;
    gameTokenSecret: string;
    accountIconSource?: AccountIconSource;
    profileStatusSource: ProfileStatusSource;
    readModelOutbox?: ReadModelOutboxWakeup;
}): GameApiContext => {
    return {
        requestId: options.requestId,
        generalAccessTracking: true,
        ...(options.realtimeAccessGranted ? { realtimeAccessGranted: true } : {}),
        db: options.db,
        redis: options.redis,
        turnDaemon: options.turnDaemon,
        battleSim: options.battleSim,
        profile: options.profile,
        uploadDir: options.uploadDir,
        uploadPath: options.uploadPath,
        uploadPublicUrl: options.uploadPublicUrl,
        ...(options.contentImageUpload ? { contentImageUpload: options.contentImageUpload } : {}),
        auth: options.auth,
        ...(options.accessToken ? { accessToken: options.accessToken } : {}),
        accessTokenStore: options.accessTokenStore,
        flushStore: options.flushStore,
        gameTokenSecret: options.gameTokenSecret,
        ...(options.accountIconSource ? { accountIconSource: options.accountIconSource } : {}),
        profileStatusSource: options.profileStatusSource,
        ...(options.readModelOutbox ? { readModelOutbox: options.readModelOutbox } : {}),
    };
};
