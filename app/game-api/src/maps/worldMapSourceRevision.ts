import { GamePrisma } from '@sammo-ts/infra';

import type { DatabaseClient } from '../context.js';

/** Reserved until every map.world producer is reconciled; runtime coverage remains 0. */
export const MAP_WORLD_SOURCE_COVERAGE_VERSION = 1;

interface MapWorldSourceRevisionRow {
    coverageVersion: number;
    revision: bigint | number | string | null;
}

const parseRevision = (value: unknown): string | null => {
    if (typeof value === 'bigint') return value >= 0n ? value.toString() : null;
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
    }
    return typeof value === 'string' && /^(?:0|[1-9]\d*)$/u.test(value) ? value : null;
};

/**
 * Returns an authoritative PostgreSQL map.world head only after coverage is
 * explicitly enabled. Missing meta/revision rows, malformed results, and query
 * failures disable the shared cache instead of reusing a potentially stale key.
 */
export const readMapWorldSourceRevision = async (
    db: Pick<DatabaseClient, '$queryRaw'>
): Promise<string | null> => {
    let rows: MapWorldSourceRevisionRow[];
    try {
        rows = await db.$queryRaw<MapWorldSourceRevisionRow[]>(GamePrisma.sql`
            SELECT
                meta."coverage_version" AS "coverageVersion",
                revision."revision" AS "revision"
            FROM "read_model_revision_meta" AS meta
            LEFT JOIN "read_model_revision" AS revision
                ON revision."domain" = 'map.world'
               AND revision."entity_id" = 0
            WHERE meta."id" = 1
        `);
    } catch {
        return null;
    }

    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : undefined;
    if (
        !row ||
        !Number.isSafeInteger(row.coverageVersion) ||
        row.coverageVersion < MAP_WORLD_SOURCE_COVERAGE_VERSION
    ) {
        return null;
    }
    return parseRevision(row.revision);
};
