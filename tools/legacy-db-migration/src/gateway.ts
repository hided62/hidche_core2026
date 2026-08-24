import type { Pool as MariaPool } from 'mariadb';
import type { Pool as PgPool, PoolClient } from 'pg';

import { legacyUserId } from './identity.js';
import {
    paginateSource,
    jsonParameter,
    querySource,
    sourceMaxId,
    toBigInt,
    toDate,
    toNullableDate,
    toNullableString,
    toNumber,
    toStringValue,
    upsertRows,
    withMigrationLock,
    type SourceRow,
    type TargetRow,
} from './db.js';
import {
    defaultExecutionOptions,
    loadCheckpoint,
    requireIncrementalCheckpoint,
    saveCheckpoint,
    validateSourceIdentity,
    type MigrationExecutionOptions,
    type MigrationProgress,
} from './incremental.js';
import {
    normalizeLegacyIconPicture,
    prepareLegacyUserIcons,
    syncImportedUserIcons,
    type LegacyUserIconPreparation,
    type LegacyUserIconTransferConfig,
    type PreparedLegacyUserIcon,
} from './legacyUserIcons.js';
import { mapLegacyRoles, mapLegacySanctions, parseJson, type JsonValue } from './transform.js';

export interface MigrationSummary {
    command: 'gateway' | 'game';
    apply: boolean;
    counts: Record<string, number>;
    excluded: Record<string, string>;
    importRunId?: string | null;
    sourceFormatSummary?: Record<string, number>;
    mode?: 'full' | 'incremental';
    sourceKey?: string;
    progress?: MigrationProgress;
}

const batchSize = 500;

export const MEMBER_PRESERVED_COLUMNS = [
    'login_id',
    'display_name',
    'password_hash',
    'password_salt',
    'password_reset_required',
    'roles',
    'sanctions',
    'oauth_type',
    'oauth_id',
    'email',
    'oauth_info',
    'picture',
    'image_server',
    'icon_updated_at',
    'third_party_use',
    'terms_accepted_at',
    'privacy_accepted_at',
    'kakao_verified_at',
    'kakao_talk_verified_until',
    'kakao_grace_started_at',
    'delete_after',
    'updated_at',
    'last_login_at',
    'created_at',
] as const;

export const preflightMemberConflicts = async (target: PoolClient, rows: readonly TargetRow[]): Promise<void> => {
    if (rows.length === 0) return;
    const ids = rows.map((row) => String(row.id));
    const loginIds = rows.map((row) => String(row.login_id));
    const displayNames = rows.map((row) => String(row.display_name));
    const emails = rows.map((row) => row.email).filter((value): value is string => typeof value === 'string');
    const existing = await target.query<{
        id: string;
        login_id: string;
        display_name: string;
        email: string | null;
    }>(
        `SELECT "id", "login_id", "display_name", "email"
         FROM "app_user"
         WHERE "id" = ANY($1::text[])
            OR "login_id" = ANY($2::text[])
            OR "display_name" = ANY($3::text[])
            OR "email" = ANY($4::text[])`,
        [ids, loginIds, displayNames, emails]
    );
    for (const row of rows) {
        const id = String(row.id);
        const collision = existing.rows.find(
            (candidate) =>
                candidate.id !== id &&
                (candidate.login_id === row.login_id ||
                    candidate.display_name === row.display_name ||
                    (row.email !== null && candidate.email === row.email))
        );
        if (collision) {
            throw new Error('Target account identity collision in legacy member batch');
        }
    }
};

export { normalizeLegacyIconPicture } from './legacyUserIcons.js';

export const mapMember = (
    row: SourceRow,
    migratedAt: Date,
    lastLoginAt: Date | null,
    importedIcon?: PreparedLegacyUserIcon
): TargetRow => {
    const memberNo = toNumber(row.NO, 'member.NO');
    const grade = toNumber(row.GRADE, `member.${memberNo}.GRADE`);
    const acl = parseJson(row.acl, `member.${memberNo}.acl`);
    const penalty = parseJson(row.penalty, `member.${memberNo}.penalty`);
    const oauthInfo = parseJson(row.oauth_info, `member.${memberNo}.oauth_info`);
    const oauthType = row.oauth_type === 'KAKAO' ? 'KAKAO' : 'NONE';
    const oauthId = toNullableString(row.oauth_id)?.trim() || null;
    const passwordHash = toStringValue(row.PW, `member.${memberNo}.PW`);
    const rawPicture = toNullableString(row.PICTURE) ?? 'default.jpg';
    const imageServer = toNumber(row.IMGSVR ?? 0, `member.${memberNo}.IMGSVR`);
    const legacyData: JsonValue = {
        memberNo,
        grade,
        acl,
        penalty,
        picture: rawPicture,
        imageServer,
        ...(importedIcon ? { importedPicture: importedIcon.picture, importedPictureSha256: importedIcon.sha256 } : {}),
        tokenValidUntil: toNullableString(row.token_valid_until),
        regNum: toNumber(row.REG_NUM, `member.${memberNo}.REG_NUM`),
        blockNum: toNumber(row.BLOCK_NUM, `member.${memberNo}.BLOCK_NUM`),
        blockDate: toNullableString(row.BLOCK_DATE),
    };
    return {
        id: legacyUserId(memberNo),
        login_id: toStringValue(row.ID, `member.${memberNo}.ID`).toLowerCase(),
        display_name: toStringValue(row.NAME, `member.${memberNo}.NAME`),
        password_hash: passwordHash,
        password_salt: toStringValue(row.salt, `member.${memberNo}.salt`),
        password_reset_required: /^[a-f0-9]{128}$/i.test(passwordHash),
        roles: jsonParameter(mapLegacyRoles(grade, acl)),
        sanctions: jsonParameter(mapLegacySanctions(grade, penalty)),
        oauth_type: oauthType,
        oauth_id: oauthId,
        email: toNullableString(row.EMAIL)?.toLowerCase() ?? null,
        oauth_info: jsonParameter(oauthInfo),
        picture: importedIcon?.picture ?? normalizeLegacyIconPicture(rawPicture),
        image_server: importedIcon?.imageServer ?? imageServer,
        icon_updated_at: null,
        third_party_use: toNumber(row.third_use ?? 0, `member.${memberNo}.third_use`) !== 0,
        terms_accepted_at: null,
        privacy_accepted_at: null,
        kakao_verified_at: oauthType === 'KAKAO' && oauthId ? migratedAt : null,
        kakao_talk_verified_until:
            oauthType === 'KAKAO' && oauthId
                ? toNullableDate(row.token_valid_until, `member.${memberNo}.token_valid_until`)
                : null,
        kakao_grace_started_at: migratedAt,
        delete_after: toNullableDate(row.delete_after, `member.${memberNo}.delete_after`),
        created_at: toDate(row.REG_DATE, `member.${memberNo}.REG_DATE`),
        updated_at: migratedAt,
        last_login_at: lastLoginAt,
        legacy_data: jsonParameter(legacyData),
    };
};

const loadLastLogins = async (source: MariaPool): Promise<Map<number, Date>> => {
    const rows = await querySource(
        source,
        "SELECT member_no, MAX(`date`) AS last_login_at FROM member_log WHERE action_type = 'login' GROUP BY member_no"
    );
    return new Map(
        rows.map((row) => {
            const memberNo = toNumber(row.member_no, 'member_log.member_no');
            return [memberNo, toDate(row.last_login_at, `member_log.${memberNo}.last_login_at`)];
        })
    );
};

const processMembers = async (
    source: MariaPool,
    target: PoolClient | null,
    apply: boolean,
    migratedAt: Date,
    counts: Record<string, number>,
    preparedIcons: ReadonlyMap<number, PreparedLegacyUserIcon>
): Promise<void> => {
    const lastLogins = await loadLastLogins(source);
    for await (const rows of paginateSource(source, 'member', 'NO', batchSize)) {
        const mapped = rows.map((row) => {
            const memberNo = toNumber(row.NO, 'member.NO');
            const importedIcon = preparedIcons.get(memberNo);
            const sourcePicture = toNullableString(row.PICTURE) ?? 'default.jpg';
            if (
                (sourcePicture !== 'default.jpg' && !importedIcon) ||
                (importedIcon && importedIcon.sourcePicture !== sourcePicture)
            ) {
                throw new Error(`member.${memberNo}.PICTURE changed after user-icon preflight`);
            }
            return mapMember(row, migratedAt, lastLogins.get(memberNo) ?? null, importedIcon);
        });
        if (target) {
            await preflightMemberConflicts(target, mapped);
        }
        if (target && apply) {
            await upsertRows(target, 'app_user', mapped, ['id'], { preserveOnConflict: MEMBER_PRESERVED_COLUMNS });
            const synced = await syncImportedUserIcons(
                target,
                rows
                    .map((row) => preparedIcons.get(toNumber(row.NO, 'member.NO')))
                    .filter((icon): icon is PreparedLegacyUserIcon => Boolean(icon)),
                migratedAt
            );
            counts.user_icon_current_linked = (counts.user_icon_current_linked ?? 0) + synced.currentLinked;
            counts.user_icon_library_inserted = (counts.user_icon_library_inserted ?? 0) + synced.libraryInserted;
            counts.user_icon_library_retired = (counts.user_icon_library_retired ?? 0) + synced.libraryRetired;
            counts.user_icon_target_preserved = (counts.user_icon_target_preserved ?? 0) + synced.targetPreserved;
        }
        counts.member = (counts.member ?? 0) + mapped.length;
    }
};

const processMemberLogs = async (
    source: MariaPool,
    target: PoolClient | null,
    counts: Record<string, number>,
    afterId = -1n
): Promise<void> => {
    for await (const rows of paginateSource(source, 'member_log', 'id', batchSize, afterId)) {
        const mapped = rows.map<TargetRow>((row) => {
            const id = toBigInt(row.id, 'member_log.id');
            const memberNo = toNumber(row.member_no, `member_log.${id}.member_no`);
            return {
                id: id.toString(),
                member_no: memberNo,
                user_id: legacyUserId(memberNo),
                date: toDate(row.date, `member_log.${id}.date`),
                action_type: toStringValue(row.action_type, `member_log.${id}.action_type`),
                action: row.action === null ? null : jsonParameter(parseJson(row.action, `member_log.${id}.action`)),
            };
        });
        if (target) {
            await upsertRows(target, 'legacy_member_log', mapped, ['id']);
        }
        counts.member_log = (counts.member_log ?? 0) + mapped.length;
    }
};

const processBannedMembers = async (
    source: MariaPool,
    target: PoolClient | null,
    counts: Record<string, number>
): Promise<void> => {
    const rows = await querySource(source, 'SELECT * FROM banned_member ORDER BY no');
    const mapped = rows.map<TargetRow>((row) => ({
        no: toNumber(row.no, 'banned_member.no'),
        hashed_email: toStringValue(row.hashed_email, 'banned_member.hashed_email'),
        info: toNullableString(row.info),
    }));
    if (target) {
        await upsertRows(target, 'legacy_banned_member', mapped, ['no']);
    }
    counts.banned_member = mapped.length;
};

const processRootKeyValues = async (
    source: MariaPool,
    target: PoolClient | null,
    counts: Record<string, number>
): Promise<void> => {
    const storage = await querySource(source, 'SELECT * FROM storage ORDER BY id');
    const rows: TargetRow[] = storage.map((row) => ({
        source_table: 'storage',
        namespace: toStringValue(row.namespace, 'storage.namespace'),
        key: toStringValue(row.key, 'storage.key'),
        value: jsonParameter(parseJson(row.value, `storage.${String(row.id)}.value`)),
    }));
    if (target) {
        for (let offset = 0; offset < rows.length; offset += batchSize) {
            await upsertRows(target, 'legacy_root_key_value', rows.slice(offset, offset + batchSize), [
                'source_table',
                'namespace',
                'key',
            ]);
        }
    }
    counts.root_key_value = rows.length;
};

const processSystem = async (
    source: MariaPool,
    target: PoolClient | null,
    counts: Record<string, number>
): Promise<void> => {
    const rows = await querySource(source, 'SELECT * FROM system ORDER BY NO');
    const mapped = rows.map<TargetRow>((row) => ({
        no: toNumber(row.NO, 'system.NO'),
        registration_enabled: row.REG === 'Y',
        login_enabled: row.LOGIN === 'Y',
        notice: toNullableString(row.NOTICE) ?? '',
        created_at: toNullableDate(row.CRT_DATE, 'system.CRT_DATE'),
        updated_at: toNullableDate(row.MDF_DATE, 'system.MDF_DATE'),
    }));
    if (target) {
        await upsertRows(target, 'system', mapped, ['no']);
    }
    counts.system = mapped.length;
};

export const migrateGateway = async (
    source: MariaPool,
    targetPool: PgPool | null,
    apply: boolean,
    migratedAt: Date,
    execution: MigrationExecutionOptions = defaultExecutionOptions('legacy-root'),
    userIconConfig?: LegacyUserIconTransferConfig
): Promise<MigrationSummary> => {
    validateSourceIdentity(execution.source);
    if (execution.mode === 'incremental' && !targetPool) {
        throw new Error('Incremental gateway migration requires the target database to read checkpoints');
    }
    const counts: Record<string, number> = {};
    const progress: MigrationProgress = {};
    const excluded = {
        login_token:
            'Legacy bearer tokens, IP addresses, and expired sessions are not valid in the Redis session model.',
    };
    const client = targetPool ? await targetPool.connect() : null;
    let importRunId: string | null = null;
    try {
        const sourceIconRows = await querySource(
            source,
            `SELECT NO, PICTURE, IMGSVR, REG_DATE
             FROM member WHERE PICTURE <> 'default.jpg' ORDER BY NO`
        );
        const recordIconCounts = (prepared: LegacyUserIconPreparation): void => {
            counts.user_icon_source = prepared.counts.custom;
            counts.user_icon_legacy_file = prepared.counts.legacyFiles;
            counts.user_icon_existing_upload = prepared.counts.existingUploads;
            counts.user_icon_uploaded = prepared.counts.uploaded;
        };
        const run = async (runId: string | null, prepared: LegacyUserIconPreparation): Promise<void> => {
            recordIconCounts(prepared);
            await processMembers(source, client, apply, migratedAt, counts, prepared.icons);
            progress.member = {
                strategy: 'rescan',
                startAfterId: null,
                endAtId: null,
                processed: counts.member ?? 0,
            };

            const maxMemberLogId = (await sourceMaxId(source, 'member_log', 'id')) ?? -1n;
            const checkpoint =
                execution.mode === 'incremental' && client
                    ? await loadCheckpoint(
                          client,
                          { tableSql: '"legacy_import_checkpoint"' },
                          execution.source.key,
                          'member_log'
                      )
                    : null;
            const memberLogAfter =
                execution.mode === 'incremental'
                    ? requireIncrementalCheckpoint(checkpoint, execution.source, 'member_log')
                    : -1n;
            if (maxMemberLogId < memberLogAfter) {
                throw new Error('Legacy source member_log maximum ID regressed; run a reviewed full migration');
            }
            await processMemberLogs(source, apply ? client : null, counts, memberLogAfter);
            progress.member_log = {
                strategy: 'append',
                startAfterId: memberLogAfter < 0n ? null : memberLogAfter.toString(),
                endAtId: maxMemberLogId < 0n ? null : maxMemberLogId.toString(),
                processed: counts.member_log ?? 0,
            };
            await processBannedMembers(source, apply ? client : null, counts);
            await processRootKeyValues(source, apply ? client : null, counts);
            await processSystem(source, apply ? client : null, counts);
            for (const table of ['banned_member', 'root_key_value', 'system'] as const) {
                progress[table] = {
                    strategy: 'rescan',
                    startAfterId: null,
                    endAtId: null,
                    processed: counts[table] ?? 0,
                };
            }
            if (apply && client && runId) {
                await saveCheckpoint(
                    client,
                    { tableSql: '"legacy_import_checkpoint"' },
                    execution.source,
                    'member_log',
                    maxMemberLogId,
                    runId
                );
            }
        };
        if (client && apply) {
            await withMigrationLock(client, `sammo-legacy-gateway-v2:${execution.source.key}`, async () => {
                const created = await client.query<{ id: string }>(
                    `INSERT INTO "legacy_import_run"
                        ("source_key", "source_fingerprint", "mode", "status")
                     VALUES ($1, $2, $3, 'RUNNING') RETURNING "id"`,
                    [execution.source.key, execution.source.fingerprint, execution.mode]
                );
                importRunId = created.rows[0]?.id ?? null;
                if (!importRunId) throw new Error('Failed to create legacy gateway import run');
                let transactionStarted = false;
                try {
                    const prepared = await prepareLegacyUserIcons(sourceIconRows, userIconConfig, true);
                    recordIconCounts(prepared);
                    await client.query('BEGIN');
                    transactionStarted = true;
                    await run(importRunId, prepared);
                    await client.query(
                        `UPDATE "legacy_import_run"
                         SET "status" = 'COMPLETED', "finished_at" = CURRENT_TIMESTAMP,
                             "counts" = $2::jsonb, "progress" = $3::jsonb
                         WHERE "id" = $1`,
                        [importRunId, JSON.stringify(counts), JSON.stringify(progress)]
                    );
                    await client.query('COMMIT');
                    transactionStarted = false;
                } catch (error) {
                    if (transactionStarted) await client.query('ROLLBACK');
                    const message =
                        error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000);
                    await client.query(
                        `UPDATE "legacy_import_run"
                         SET "status" = 'FAILED', "finished_at" = CURRENT_TIMESTAMP,
                             "counts" = $2::jsonb, "progress" = $3::jsonb, "error" = $4
                         WHERE "id" = $1`,
                        [importRunId, JSON.stringify(counts), JSON.stringify(progress), message]
                    );
                    throw error;
                }
            });
        } else {
            const prepared = await prepareLegacyUserIcons(sourceIconRows, userIconConfig, false);
            await run(null, prepared);
        }
    } finally {
        client?.release();
    }
    return {
        command: 'gateway',
        apply,
        counts,
        excluded,
        importRunId,
        mode: execution.mode,
        sourceKey: execution.source.key,
        progress,
    };
};
