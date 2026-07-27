import type { Pool as MariaPool } from 'mariadb';
import type { Pool as PgPool, PoolClient } from 'pg';

import { legacyUserId } from './identity.js';
import {
    paginateSource,
    jsonParameter,
    querySource,
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
import { mapLegacyRoles, mapLegacySanctions, parseJson, type JsonValue } from './transform.js';

export interface MigrationSummary {
    command: 'gateway' | 'game';
    apply: boolean;
    counts: Record<string, number>;
    excluded: Record<string, string>;
}

const batchSize = 500;

const mapMember = (row: SourceRow, migratedAt: Date, lastLoginAt: Date | null): TargetRow => {
    const memberNo = toNumber(row.NO, 'member.NO');
    const grade = toNumber(row.GRADE, `member.${memberNo}.GRADE`);
    const acl = parseJson(row.acl, `member.${memberNo}.acl`);
    const penalty = parseJson(row.penalty, `member.${memberNo}.penalty`);
    const oauthInfo = parseJson(row.oauth_info, `member.${memberNo}.oauth_info`);
    const oauthType = row.oauth_type === 'KAKAO' ? 'KAKAO' : 'NONE';
    const legacyData: JsonValue = {
        memberNo,
        grade,
        acl,
        penalty,
        tokenValidUntil: toNullableString(row.token_valid_until),
        regNum: toNumber(row.REG_NUM, `member.${memberNo}.REG_NUM`),
        blockNum: toNumber(row.BLOCK_NUM, `member.${memberNo}.BLOCK_NUM`),
        blockDate: toNullableString(row.BLOCK_DATE),
    };
    return {
        id: legacyUserId(memberNo),
        login_id: toStringValue(row.ID, `member.${memberNo}.ID`).toLowerCase(),
        display_name: toStringValue(row.NAME, `member.${memberNo}.NAME`),
        password_hash: toStringValue(row.PW, `member.${memberNo}.PW`),
        password_salt: toStringValue(row.salt, `member.${memberNo}.salt`),
        roles: jsonParameter(mapLegacyRoles(grade, acl)),
        sanctions: jsonParameter(mapLegacySanctions(grade, penalty)),
        oauth_type: oauthType,
        oauth_id: toNullableString(row.oauth_id),
        email: toNullableString(row.EMAIL)?.toLowerCase() ?? null,
        oauth_info: jsonParameter(oauthInfo),
        picture: toNullableString(row.PICTURE) ?? 'default.jpg',
        image_server: toNumber(row.IMGSVR ?? 0, `member.${memberNo}.IMGSVR`),
        icon_updated_at: null,
        third_party_use: toNumber(row.third_use ?? 0, `member.${memberNo}.third_use`) !== 0,
        terms_accepted_at: null,
        privacy_accepted_at: null,
        kakao_verified_at: oauthType === 'KAKAO' ? migratedAt : null,
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
    migratedAt: Date,
    counts: Record<string, number>
): Promise<void> => {
    const lastLogins = await loadLastLogins(source);
    for await (const rows of paginateSource(source, 'member', 'NO', batchSize)) {
        const mapped = rows.map((row) => {
            const memberNo = toNumber(row.NO, 'member.NO');
            return mapMember(row, migratedAt, lastLogins.get(memberNo) ?? null);
        });
        if (target) {
            await upsertRows(target, 'app_user', mapped, ['id']);
        }
        counts.member = (counts.member ?? 0) + mapped.length;
    }
};

const processMemberLogs = async (
    source: MariaPool,
    target: PoolClient | null,
    counts: Record<string, number>
): Promise<void> => {
    for await (const rows of paginateSource(source, 'member_log', 'id', batchSize)) {
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
    migratedAt: Date
): Promise<MigrationSummary> => {
    const counts: Record<string, number> = {};
    const excluded = {
        login_token:
            'Legacy bearer tokens, IP addresses, and expired sessions are not valid in the Redis session model.',
    };
    const client = apply && targetPool ? await targetPool.connect() : null;
    try {
        const run = async (): Promise<void> => {
            await processMembers(source, client, migratedAt, counts);
            await processMemberLogs(source, client, counts);
            await processBannedMembers(source, client, counts);
            await processRootKeyValues(source, client, counts);
            await processSystem(source, client, counts);
        };
        if (client) {
            await withMigrationLock(client, 'sammo-legacy-gateway-v1', run);
        } else {
            await run();
        }
    } finally {
        client?.release();
    }
    return { command: 'gateway', apply, counts, excluded };
};
