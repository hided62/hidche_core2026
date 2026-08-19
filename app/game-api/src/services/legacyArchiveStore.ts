import { GamePrisma } from '@sammo-ts/infra';
import { isLegacyArchiveProfile, LEGACY_ARCHIVE_PROFILES, type LegacyArchiveProfile } from '@sammo-ts/common';

import type { DatabaseClient } from '../context.js';

export { isLegacyArchiveProfile, LEGACY_ARCHIVE_PROFILES, type LegacyArchiveProfile };

export type LegacyArchiveDatabase = Pick<DatabaseClient, '$queryRaw'>;

export interface LegacyGameHistoryRow {
    sourceProfile: LegacyArchiveProfile;
    serverId: string;
    legacyId: number;
    openedAt: Date;
    completedAt: Date | null;
    legacyDate: Date;
    winnerNation: number | null;
    map: string | null;
    season: number;
    scenario: number;
    scenarioName: string;
    rawEnv: unknown;
}

export interface LegacyGeneralRow {
    sourceProfile: LegacyArchiveProfile;
    serverId: string;
    generalNo: number;
    legacyId: number;
    owner: string | null;
    name: string;
    lastYearMonth: number;
    turnTime: Date;
    schemaVersion: number;
    sourceFormat: string;
    data: unknown;
}

export interface LegacyGeneralBattleResultRow {
    content: string;
    lineCount: number;
    contentHash: string;
}

export const LEGACY_GENERAL_HALL_TYPES = [
    'firenum',
    'warnum',
    'killnum',
    'winrate',
    'occupied',
    'killcrew',
    'killrate',
    'killcrew_person',
    'killrate_person',
] as const;

export type LegacyGeneralHallType = (typeof LEGACY_GENERAL_HALL_TYPES)[number];

export interface LegacyGeneralHallRow {
    type: LegacyGeneralHallType;
    value: number;
}

export interface LegacyNationRow {
    sourceProfile: LegacyArchiveProfile;
    legacyId: number;
    serverId: string;
    nation: number;
    data: unknown;
    archivedAt: Date;
}

export interface LegacyEmperorRow {
    id: bigint;
    sourceProfile: LegacyArchiveProfile;
    legacyId: number;
    serverId: string | null;
    data: unknown;
}

export interface LegacyHallOptionRow {
    sourceProfile: LegacyArchiveProfile;
    season: number;
    scenario: number;
    scenarioName: string;
    count: bigint;
}

export interface LegacyHallRow {
    sourceProfile: LegacyArchiveProfile;
    serverId: string;
    generalNo: number;
    type: string;
    value: number;
    owner: string | null;
    aux: unknown;
}

export const findLegacyGeneralsByOwner = async (
    db: LegacyArchiveDatabase,
    input: { owner: string; sourceProfile: LegacyArchiveProfile }
): Promise<LegacyGeneralRow[]> =>
    db.$queryRaw<LegacyGeneralRow[]>(GamePrisma.sql`
        SELECT
            "source_profile" AS "sourceProfile",
            "server_id" AS "serverId",
            "general_no" AS "generalNo",
            "legacy_id" AS "legacyId",
            "owner",
            "name",
            "last_yearmonth" AS "lastYearMonth",
            "turntime" AS "turnTime",
            "schema_version" AS "schemaVersion",
            "source_format" AS "sourceFormat",
            "data"
        FROM "legacy_archive"."general"
        WHERE "owner" = ${input.owner}
          AND "source_profile" = ${input.sourceProfile}
        ORDER BY "last_yearmonth" DESC, "server_id" DESC, "general_no"
    `);

export const findLegacyGeneral = async (
    db: LegacyArchiveDatabase,
    input: { owner: string; sourceProfile: LegacyArchiveProfile; serverId: string; generalNo: number }
): Promise<LegacyGeneralRow | null> => {
    const rows = await db.$queryRaw<LegacyGeneralRow[]>(GamePrisma.sql`
        SELECT
            "source_profile" AS "sourceProfile",
            "server_id" AS "serverId",
            "general_no" AS "generalNo",
            "legacy_id" AS "legacyId",
            "owner",
            "name",
            "last_yearmonth" AS "lastYearMonth",
            "turntime" AS "turnTime",
            "schema_version" AS "schemaVersion",
            "source_format" AS "sourceFormat",
            "data"
        FROM "legacy_archive"."general"
        WHERE "owner" = ${input.owner}
          AND "source_profile" = ${input.sourceProfile}
          AND "server_id" = ${input.serverId}
          AND "general_no" = ${input.generalNo}
        LIMIT 1
    `);
    return rows[0] ?? null;
};

export const findLegacyGeneralBattleResult = async (
    db: LegacyArchiveDatabase,
    input: { sourceProfile: LegacyArchiveProfile; serverId: string; generalNo: number }
): Promise<LegacyGeneralBattleResultRow | null> => {
    const rows = await db.$queryRaw<LegacyGeneralBattleResultRow[]>(GamePrisma.sql`
        SELECT
            "content",
            "line_count" AS "lineCount",
            "content_hash" AS "contentHash"
        FROM "legacy_archive"."general_battle_result"
        WHERE "source_profile" = ${input.sourceProfile}
          AND "server_id" = ${input.serverId}
          AND "general_no" = ${input.generalNo}
        LIMIT 1
    `);
    return rows[0] ?? null;
};

export const findLegacyGeneralHallRows = async (
    db: LegacyArchiveDatabase,
    input: { sourceProfile: LegacyArchiveProfile; serverId: string; generalNo: number }
): Promise<LegacyGeneralHallRow[]> =>
    db.$queryRaw<LegacyGeneralHallRow[]>(GamePrisma.sql`
        SELECT
            "type",
            "value"
        FROM "legacy_archive"."hall"
        WHERE "source_profile" = ${input.sourceProfile}
          AND "server_id" = ${input.serverId}
          AND "general_no" = ${input.generalNo}
          AND "type" IN (${GamePrisma.join(LEGACY_GENERAL_HALL_TYPES)})
        ORDER BY "type"
    `);

export const findLegacyGeneralsForServer = async (
    db: LegacyArchiveDatabase,
    input: { sourceProfile: LegacyArchiveProfile; serverId: string; generalNos: number[] }
): Promise<Array<Pick<LegacyGeneralRow, 'generalNo' | 'name' | 'lastYearMonth'>>> => {
    if (input.generalNos.length === 0) return [];
    return db.$queryRaw<Array<Pick<LegacyGeneralRow, 'generalNo' | 'name' | 'lastYearMonth'>>>(GamePrisma.sql`
        SELECT
            "general_no" AS "generalNo",
            "name",
            "last_yearmonth" AS "lastYearMonth"
        FROM "legacy_archive"."general"
        WHERE "source_profile" = ${input.sourceProfile}
          AND "server_id" = ${input.serverId}
          AND "general_no" IN (${GamePrisma.join(input.generalNos)})
    `);
};

export const findLegacyGames = async (
    db: LegacyArchiveDatabase,
    keys?: Array<{ sourceProfile: LegacyArchiveProfile; serverId: string }>
): Promise<LegacyGameHistoryRow[]> => {
    if (keys && keys.length === 0) return [];
    const condition = keys
        ? GamePrisma.sql`WHERE ("source_profile", "server_id") IN (${GamePrisma.join(
              keys.map(({ sourceProfile, serverId }) => GamePrisma.sql`(${sourceProfile}, ${serverId})`)
          )})`
        : GamePrisma.empty;
    return db.$queryRaw<LegacyGameHistoryRow[]>(GamePrisma.sql`
        SELECT
            "source_profile" AS "sourceProfile",
            "server_id" AS "serverId",
            "legacy_id" AS "legacyId",
            "opened_at" AS "openedAt",
            "completed_at" AS "completedAt",
            "legacy_date" AS "legacyDate",
            "winner_nation" AS "winnerNation",
            "map",
            "season",
            "scenario",
            "scenario_name" AS "scenarioName",
            "raw_env" AS "rawEnv"
        FROM "legacy_archive"."game_history"
        ${condition}
    `);
};

export const findLegacyNations = async (
    db: LegacyArchiveDatabase,
    keys: Array<{ sourceProfile: LegacyArchiveProfile; serverId: string }>
): Promise<LegacyNationRow[]> => {
    if (keys.length === 0) return [];
    return db.$queryRaw<LegacyNationRow[]>(GamePrisma.sql`
        SELECT
            "source_profile" AS "sourceProfile",
            "legacy_id" AS "legacyId",
            "server_id" AS "serverId",
            "nation",
            "data",
            "archived_at" AS "archivedAt"
        FROM "legacy_archive"."nation"
        WHERE ("source_profile", "server_id") IN (${GamePrisma.join(
            keys.map(({ sourceProfile, serverId }) => GamePrisma.sql`(${sourceProfile}, ${serverId})`)
        )})
        ORDER BY "archived_at" DESC, "legacy_id" DESC
    `);
};

export const findLegacyEmperors = async (
    db: LegacyArchiveDatabase,
    keys?: Array<{ sourceProfile: LegacyArchiveProfile; serverId: string }>
): Promise<LegacyEmperorRow[]> => {
    if (keys && keys.length === 0) return [];
    const condition = keys
        ? GamePrisma.sql`WHERE ("source_profile", "server_id") IN (${GamePrisma.join(
              keys.map(({ sourceProfile, serverId }) => GamePrisma.sql`(${sourceProfile}, ${serverId})`)
          )})`
        : GamePrisma.empty;
    return db.$queryRaw<LegacyEmperorRow[]>(GamePrisma.sql`
        SELECT
            "id",
            "source_profile" AS "sourceProfile",
            "legacy_id" AS "legacyId",
            "server_id" AS "serverId",
            "data"
        FROM "legacy_archive"."emperor"
        ${condition}
        ORDER BY "id" DESC
    `);
};

export const findLegacyEmperor = async (db: LegacyArchiveDatabase, id: number): Promise<LegacyEmperorRow | null> => {
    const rows = await db.$queryRaw<LegacyEmperorRow[]>(GamePrisma.sql`
        SELECT
            "id",
            "source_profile" AS "sourceProfile",
            "legacy_id" AS "legacyId",
            "server_id" AS "serverId",
            "data"
        FROM "legacy_archive"."emperor"
        WHERE "id" = ${id}
        LIMIT 1
    `);
    return rows[0] ?? null;
};

export const findLegacyHallOptions = async (db: LegacyArchiveDatabase): Promise<LegacyHallOptionRow[]> =>
    db.$queryRaw<LegacyHallOptionRow[]>(GamePrisma.sql`
        SELECT
            "source_profile" AS "sourceProfile",
            "season",
            "scenario",
            MAX("scenario_name") AS "scenarioName",
            COUNT(*)::bigint AS "count"
        FROM "legacy_archive"."game_history"
        GROUP BY "source_profile", "season", "scenario"
        ORDER BY "season" DESC, "source_profile", "scenario"
    `);

export const findLegacyHallRows = async (
    db: LegacyArchiveDatabase,
    input: { sourceProfile: LegacyArchiveProfile; season: number; scenario?: number; type: string; take: number }
): Promise<LegacyHallRow[]> => {
    const scenarioCondition =
        input.scenario === undefined ? GamePrisma.empty : GamePrisma.sql`AND "scenario" = ${input.scenario}`;
    return db.$queryRaw<LegacyHallRow[]>(GamePrisma.sql`
        SELECT
            "source_profile" AS "sourceProfile",
            "server_id" AS "serverId",
            "general_no" AS "generalNo",
            "type",
            "value",
            "owner",
            "aux"
        FROM "legacy_archive"."hall"
        WHERE "source_profile" = ${input.sourceProfile}
          AND "season" = ${input.season}
          ${scenarioCondition}
          AND "type" = ${input.type}
        ORDER BY "value" DESC
        LIMIT ${input.take}
    `);
};
