import { createHash } from 'node:crypto';

import type { Pool as MariaPool } from 'mariadb';
import type { Pool as PgPool, PoolClient } from 'pg';

import {
    paginateSource,
    jsonParameter,
    toDate,
    toFloat,
    toNullableDate,
    toNullableString,
    toNumber,
    toStringValue,
    upsertRows,
    withMigrationLock,
    type SourceRow,
    type TargetRow,
} from './db.js';
import type { MigrationSummary } from './gateway.js';
import { legacyUserId } from './identity.js';
import {
    classifyGameStorage,
    parseInheritanceValue,
    parseJson,
    parseStorageUserId,
    type JsonValue,
} from './transform.js';

const batchSize = 250;

const parseNullableJson = (value: unknown, fallback: JsonValue, context: string): JsonValue =>
    value === null || value === undefined ? fallback : parseJson(value, context);

const parseJsonOrLegacyEmpty = (value: unknown, context: string): JsonValue =>
    value === '' ? '' : parseJson(value, context);

const ownerId = (value: unknown): string | null => {
    if (value === null || value === undefined) {
        return null;
    }
    const memberNo = toNumber(value, 'legacy owner');
    return memberNo > 0 ? legacyUserId(memberNo) : null;
};

const hashYearbook = (row: TargetRow): string =>
    createHash('sha256')
        .update(
            JSON.stringify({
                map: row.map,
                nations: row.nations,
                globalHistory: row.global_history,
                globalAction: row.global_action,
            })
        )
        .digest('hex');

const migrateSimpleTable = async (
    source: MariaPool,
    target: PoolClient | null,
    sourceTable: string,
    sourceIdColumn: string,
    targetTable: string,
    conflictColumns: readonly string[],
    mapper: (row: SourceRow) => TargetRow,
    counts: Record<string, number>,
    size = batchSize
): Promise<void> => {
    for await (const rows of paginateSource(source, sourceTable, sourceIdColumn, size)) {
        const mapped = rows.map(mapper);
        if (target) {
            await upsertRows(target, targetTable, mapped, conflictColumns);
        }
        counts[sourceTable] = (counts[sourceTable] ?? 0) + mapped.length;
    }
};

const migrateHall = (source: MariaPool, target: PoolClient | null, counts: Record<string, number>): Promise<void> =>
    migrateSimpleTable(
        source,
        target,
        'hall',
        'id',
        'hall',
        ['server_id', 'type', 'general_no'],
        (row) => {
            const sourceId = toNumber(row.id, 'hall.id');
            return {
                server_id: toStringValue(row.server_id, `hall.${sourceId}.server_id`),
                season: toNumber(row.season, `hall.${sourceId}.season`),
                scenario: toNumber(row.scenario, `hall.${sourceId}.scenario`),
                general_no: toNumber(row.general_no, `hall.${sourceId}.general_no`),
                type: toStringValue(row.type, `hall.${sourceId}.type`),
                value: toFloat(row.value, `hall.${sourceId}.value`),
                owner: ownerId(row.owner),
                aux: parseJson(row.aux, `hall.${sourceId}.aux`),
            };
        },
        counts
    );

const migrateGames = (source: MariaPool, target: PoolClient | null, counts: Record<string, number>): Promise<void> =>
    migrateSimpleTable(
        source,
        target,
        'ng_games',
        'id',
        'ng_games',
        ['server_id'],
        (row) => {
            const sourceId = toNumber(row.id, 'ng_games.id');
            return {
                server_id: toStringValue(row.server_id, `ng_games.${sourceId}.server_id`),
                date: toDate(row.date, `ng_games.${sourceId}.date`),
                winner_nation:
                    row.winner_nation === null
                        ? null
                        : toNumber(row.winner_nation, `ng_games.${sourceId}.winner_nation`),
                map: toNullableString(row.map),
                season: toNumber(row.season, `ng_games.${sourceId}.season`),
                scenario: toNumber(row.scenario, `ng_games.${sourceId}.scenario`),
                scenario_name: toStringValue(row.scenario_name, `ng_games.${sourceId}.scenario_name`),
                env: parseJson(row.env, `ng_games.${sourceId}.env`),
            };
        },
        counts
    );

const migrateOldGenerals = (
    source: MariaPool,
    target: PoolClient | null,
    counts: Record<string, number>
): Promise<void> =>
    migrateSimpleTable(
        source,
        target,
        'ng_old_generals',
        'id',
        'ng_old_generals',
        ['server_id', 'general_no'],
        (row) => {
            const sourceId = toNumber(row.id, 'ng_old_generals.id');
            return {
                server_id: toStringValue(row.server_id, `ng_old_generals.${sourceId}.server_id`),
                general_no: toNumber(row.general_no, `ng_old_generals.${sourceId}.general_no`),
                owner: ownerId(row.owner),
                name: toStringValue(row.name, `ng_old_generals.${sourceId}.name`),
                last_yearmonth: toNumber(row.last_yearmonth, `ng_old_generals.${sourceId}.last_yearmonth`),
                turntime: toDate(row.turntime, `ng_old_generals.${sourceId}.turntime`),
                data: parseJson(row.data, `ng_old_generals.${sourceId}.data`),
            };
        },
        counts
    );

const migrateOldNations = (
    source: MariaPool,
    target: PoolClient | null,
    counts: Record<string, number>
): Promise<void> =>
    migrateSimpleTable(
        source,
        target,
        'ng_old_nations',
        'id',
        'ng_old_nations',
        ['server_id', 'nation', 'source_id'],
        (row) => {
            const sourceId = toNumber(row.id, 'ng_old_nations.id');
            return {
                server_id: toStringValue(row.server_id, `ng_old_nations.${sourceId}.server_id`),
                nation: toNumber(row.nation, `ng_old_nations.${sourceId}.nation`),
                source_id: sourceId,
                data: parseJson(row.data, `ng_old_nations.${sourceId}.data`),
                date: toDate(row.date, `ng_old_nations.${sourceId}.date`),
            };
        },
        counts
    );

const migrateEmperors = (source: MariaPool, target: PoolClient | null, counts: Record<string, number>): Promise<void> =>
    migrateSimpleTable(
        source,
        target,
        'emperior',
        'no',
        'emperior',
        ['legacy_id'],
        (row) => {
            const id = toNumber(row.no, 'emperior.no');
            return {
                legacy_id: id,
                server_id: toNullableString(row.server_id),
                phase: toNullableString(row.phase),
                nation_count: toNullableString(row.nation_count),
                nation_name: toNullableString(row.nation_name),
                nation_hist: toNullableString(row.nation_hist),
                gen_count: toNullableString(row.gen_count),
                personal_hist: toNullableString(row.personal_hist),
                special_hist: toNullableString(row.special_hist),
                name: toNullableString(row.name),
                type: toNullableString(row.type),
                color: toNullableString(row.color),
                year: row.year === null ? null : toNumber(row.year, `emperior.${id}.year`),
                month: row.month === null ? null : toNumber(row.month, `emperior.${id}.month`),
                power: row.power === null ? null : toNumber(row.power, `emperior.${id}.power`),
                gennum: row.gennum === null ? null : toNumber(row.gennum, `emperior.${id}.gennum`),
                citynum: row.citynum === null ? null : toNumber(row.citynum, `emperior.${id}.citynum`),
                pop: toNullableString(row.pop),
                poprate: toNullableString(row.poprate),
                gold: row.gold === null ? null : toNumber(row.gold, `emperior.${id}.gold`),
                rice: row.rice === null ? null : toNumber(row.rice, `emperior.${id}.rice`),
                l12name: toNullableString(row.l12name),
                l12pic: toNullableString(row.l12pic),
                l11name: toNullableString(row.l11name),
                l11pic: toNullableString(row.l11pic),
                l10name: toNullableString(row.l10name),
                l10pic: toNullableString(row.l10pic),
                l9name: toNullableString(row.l9name),
                l9pic: toNullableString(row.l9pic),
                l8name: toNullableString(row.l8name),
                l8pic: toNullableString(row.l8pic),
                l7name: toNullableString(row.l7name),
                l7pic: toNullableString(row.l7pic),
                l6name: toNullableString(row.l6name),
                l6pic: toNullableString(row.l6pic),
                l5name: toNullableString(row.l5name),
                l5pic: toNullableString(row.l5pic),
                tiger: toNullableString(row.tiger),
                eagle: toNullableString(row.eagle),
                gen: toNullableString(row.gen),
                history: parseNullableJson(row.history, [], `emperior.${id}.history`),
                aux: parseNullableJson(row.aux, {}, `emperior.${id}.aux`),
            };
        },
        counts
    );

const migrateInheritanceResults = (
    source: MariaPool,
    target: PoolClient | null,
    counts: Record<string, number>
): Promise<void> =>
    migrateSimpleTable(
        source,
        target,
        'inheritance_result',
        'id',
        'inheritance_result',
        ['legacy_id'],
        (row) => {
            const id = toNumber(row.id, 'inheritance_result.id');
            return {
                legacy_id: id,
                server_id: toStringValue(row.server_id, `inheritance_result.${id}.server_id`),
                owner: legacyUserId(toNumber(row.owner, `inheritance_result.${id}.owner`)),
                general_id: toNumber(row.general_id, `inheritance_result.${id}.general_id`),
                year: toNumber(row.year, `inheritance_result.${id}.year`),
                month: toNumber(row.month, `inheritance_result.${id}.month`),
                value: jsonParameter(parseJsonOrLegacyEmpty(row.value, `inheritance_result.${id}.value`)),
                created_at: new Date(0),
            };
        },
        counts
    );

const migrateUserRecords = (
    source: MariaPool,
    target: PoolClient | null,
    counts: Record<string, number>
): Promise<void> =>
    migrateSimpleTable(
        source,
        target,
        'user_record',
        'id',
        'inheritance_log',
        ['legacy_id'],
        (row) => {
            const id = toNumber(row.id, 'user_record.id');
            return {
                legacy_id: id,
                user_id: legacyUserId(toNumber(row.user_id, `user_record.${id}.user_id`)),
                server_id: toStringValue(row.server_id, `user_record.${id}.server_id`),
                log_type: toStringValue(row.log_type, `user_record.${id}.log_type`),
                year: toNumber(row.year, `user_record.${id}.year`),
                month: toNumber(row.month, `user_record.${id}.month`),
                text: toStringValue(row.text, `user_record.${id}.text`),
                created_at: toNullableDate(row.date, `user_record.${id}.date`) ?? new Date(0),
            };
        },
        counts
    );

const migrateYearbook = async (
    source: MariaPool,
    target: PoolClient | null,
    counts: Record<string, number>
): Promise<void> => {
    await migrateSimpleTable(
        source,
        target,
        'ng_history',
        'no',
        'yearbook_history',
        ['profile_name', 'year', 'month', 'source_id'],
        (row) => {
            const id = toNumber(row.no, 'ng_history.no');
            const mapped: TargetRow = {
                profile_name: toStringValue(row.server_id, `ng_history.${id}.server_id`),
                source_id: id,
                year: toNumber(row.year, `ng_history.${id}.year`),
                month: toNumber(row.month, `ng_history.${id}.month`),
                map: parseNullableJson(row.map, {}, `ng_history.${id}.map`),
                nations: parseNullableJson(row.nations, [], `ng_history.${id}.nations`),
                global_history: parseNullableJson(row.global_history, [], `ng_history.${id}.global_history`),
                global_action: parseNullableJson(row.global_action, [], `ng_history.${id}.global_action`),
                hash: '',
                created_at: new Date(0),
            };
            mapped.hash = hashYearbook(mapped);
            return mapped;
        },
        counts,
        25
    );
};

const migrateStorage = async (
    source: MariaPool,
    target: PoolClient | null,
    counts: Record<string, number>
): Promise<void> => {
    for await (const rows of paginateSource(source, 'storage', 'id', batchSize)) {
        const archives: TargetRow[] = [];
        const points: TargetRow[] = [];
        const userStates: TargetRow[] = [];
        for (const row of rows) {
            const sourceId = toNumber(row.id, 'storage.id');
            const namespace = toStringValue(row.namespace, `storage.${sourceId}.namespace`);
            const key = toStringValue(row.key, `storage.${sourceId}.key`);
            const value = parseJson(row.value, `storage.${sourceId}.value`);
            const scope = classifyGameStorage(namespace, key);
            counts.storage_inspected = (counts.storage_inspected ?? 0) + 1;
            if (scope === 'season-state') {
                counts.storage_season_excluded = (counts.storage_season_excluded ?? 0) + 1;
                continue;
            }
            archives.push({ source_id: sourceId, namespace, key, value: jsonParameter(value), scope });

            const inheritanceUserId = parseStorageUserId(namespace, 'inheritance');
            if (inheritanceUserId) {
                points.push({
                    user_id: inheritanceUserId,
                    key,
                    value: parseInheritanceValue(value, `storage.${sourceId}.value`),
                    aux: {
                        legacyNamespace: namespace,
                        legacySourceId: sourceId,
                        legacyAux: Array.isArray(value) ? (value[1] ?? null) : null,
                    },
                    updated_at: new Date(0),
                });
            }
            const stateUserId = parseStorageUserId(namespace, 'user');
            if (stateUserId && key === 'last_stat_reset') {
                userStates.push({
                    user_id: stateUserId,
                    meta: { lastStatReset: value, legacySourceId: sourceId },
                    updated_at: new Date(0),
                });
            }
        }
        if (target) {
            await upsertRows(target, 'legacy_game_storage', archives, ['source_id']);
            await upsertRows(target, 'inheritance_point', points, ['user_id', 'key']);
            await upsertRows(target, 'inheritance_user_state', userStates, ['user_id']);
        }
        counts.storage_archived = (counts.storage_archived ?? 0) + archives.length;
        counts.inheritance_point = (counts.inheritance_point ?? 0) + points.length;
        counts.inheritance_user_state = (counts.inheritance_user_state ?? 0) + userStates.length;
    }
};

export const migrateGame = async (
    source: MariaPool,
    targetPool: PgPool | null,
    apply: boolean,
    profile: string
): Promise<MigrationSummary> => {
    const counts: Record<string, number> = {};
    const excluded = {
        general: 'Current-season actor state is intentionally not transferred.',
        city: 'Current-season world state is intentionally not transferred.',
        nation: 'Current-season nation state is intentionally not transferred.',
        general_turn: 'Current-season command queue.',
        general_access_log: 'Current-season access counters.',
        nation_turn: 'Current-season nation command queue.',
        nation_env: 'Current-season nation KV state.',
        board: 'Current-season nation board.',
        comment: 'Current-season nation board comments.',
        diplomacy: 'Current-season diplomacy state.',
        event: 'Current-season scheduled events.',
        message: 'Current-season mailboxes.',
        rank_data: 'Current-season ranking counters.',
        statistic: 'Current-season statistics used to build permanent dynasty records.',
        world_history: 'Current-season history; completed-month snapshots come from ng_history.',
        general_record: 'Current-season general logs.',
        ng_auction: 'Current-season auction.',
        ng_auction_bid: 'Current-season auction bids.',
        ng_betting: 'Current-season betting.',
        ng_diplomacy: 'Current-season diplomacy letters.',
        plock: 'Legacy process lock.',
        reserved_open: 'Legacy opening schedule.',
        select_npc_token: 'Ephemeral selection token.',
        select_pool: 'Current-season selection pool.',
        tournament: 'Current-season tournament.',
        troop: 'Current-season troop state.',
        vote: 'Current-season vote.',
        vote_comment: 'Current-season vote comments.',
        'storage:season-state': 'Only inheritance_* and user_* long-lived namespaces are archived or projected.',
    };
    const client = apply && targetPool ? await targetPool.connect() : null;
    try {
        const run = async (): Promise<void> => {
            await migrateGames(source, client, counts);
            await migrateHall(source, client, counts);
            await migrateOldGenerals(source, client, counts);
            await migrateOldNations(source, client, counts);
            await migrateEmperors(source, client, counts);
            await migrateInheritanceResults(source, client, counts);
            await migrateUserRecords(source, client, counts);
            await migrateStorage(source, client, counts);
            await migrateYearbook(source, client, counts);
        };
        if (client) {
            await withMigrationLock(client, `sammo-legacy-game-v1:${profile}`, run);
        } else {
            await run();
        }
    } finally {
        client?.release();
    }
    return { command: 'game', apply, counts, excluded };
};
