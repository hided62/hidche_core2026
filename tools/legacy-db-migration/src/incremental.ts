import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';

export type MigrationMode = 'full' | 'incremental';

export interface MigrationSourceIdentity {
    key: string;
    fingerprint: string;
}

export interface MigrationExecutionOptions {
    mode: MigrationMode;
    source: MigrationSourceIdentity;
}

export interface MigrationTableProgress {
    strategy: 'append' | 'rescan';
    startAfterId: string | null;
    endAtId: string | null;
    processed: number;
}

export type MigrationProgress = Record<string, MigrationTableProgress>;

export interface StoredCheckpoint {
    sourceFingerprint: string;
    lastLegacyId: bigint;
}

export interface CheckpointStore {
    tableSql: '"legacy_import_checkpoint"' | '"legacy_archive"."import_checkpoint"';
    scope?: { columnSql: '"source_profile"'; value: string };
}

const SOURCE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export const validateSourceIdentity = (source: MigrationSourceIdentity): MigrationSourceIdentity => {
    if (!SOURCE_KEY.test(source.key)) {
        throw new Error('Legacy migration source key must use 1-128 safe characters');
    }
    if (!/^[a-f0-9]{64}$/u.test(source.fingerprint)) {
        throw new Error('Legacy migration source fingerprint must be a SHA-256 hex value');
    }
    return source;
};

export const fingerprintMariaConnection = (connectionString: string): string => {
    const url = new URL(connectionString);
    if (url.protocol !== 'mariadb:' && url.protocol !== 'mysql:') {
        throw new Error('Legacy source URL must use the mariadb or mysql protocol');
    }
    const query = [...url.searchParams.entries()]
        .filter(([key]) => !/pass(word)?|secret|token/iu.test(key))
        .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
            leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
        );
    const identity = {
        protocol: url.protocol,
        host: url.hostname.toLowerCase(),
        port: url.port || '3306',
        database: decodeURIComponent(url.pathname.replace(/^\//u, '')),
        user: decodeURIComponent(url.username),
        query,
    };
    return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
};

export const loadCheckpoint = async (
    client: PoolClient,
    store: CheckpointStore,
    sourceKey: string,
    sourceTable: string
): Promise<StoredCheckpoint | null> => {
    const scopePredicate = store.scope ? ` AND ${store.scope.columnSql} = $3` : '';
    const parameters = store.scope ? [sourceKey, sourceTable, store.scope.value] : [sourceKey, sourceTable];
    const result = await client.query<{ source_fingerprint: string; last_legacy_id: string }>(
        `SELECT "source_fingerprint", "last_legacy_id"
         FROM ${store.tableSql}
         WHERE "source_key" = $1 AND "source_table" = $2${scopePredicate}
         FOR UPDATE`,
        parameters
    );
    const row = result.rows[0];
    return row ? { sourceFingerprint: row.source_fingerprint, lastLegacyId: BigInt(row.last_legacy_id) } : null;
};

export const requireIncrementalCheckpoint = (
    checkpoint: StoredCheckpoint | null,
    source: MigrationSourceIdentity,
    sourceTable: string
): bigint => {
    if (!checkpoint) {
        throw new Error(`Incremental migration requires a completed full checkpoint for ${sourceTable}`);
    }
    if (checkpoint.sourceFingerprint !== source.fingerprint) {
        throw new Error(`Legacy source fingerprint changed for ${sourceTable}; run a reviewed full migration`);
    }
    return checkpoint.lastLegacyId;
};

export const saveCheckpoint = async (
    client: PoolClient,
    store: CheckpointStore,
    source: MigrationSourceIdentity,
    sourceTable: string,
    lastLegacyId: bigint,
    importRunId: string
): Promise<void> => {
    const scopeColumn = store.scope ? `${store.scope.columnSql}, ` : '';
    const scopeValue = store.scope ? '$1, ' : '';
    const parameterOffset = store.scope ? 1 : 0;
    const parameters: unknown[] = store.scope ? [store.scope.value] : [];
    parameters.push(source.key, source.fingerprint, sourceTable, lastLegacyId.toString(), importRunId);
    const conflictColumns = store.scope
        ? `${store.scope.columnSql}, "source_key", "source_table"`
        : '"source_key", "source_table"';
    await client.query(
        `INSERT INTO ${store.tableSql}
            (${scopeColumn}"source_key", "source_fingerprint", "source_table", "last_legacy_id", "import_run_id", "updated_at")
         VALUES (${scopeValue}$${parameterOffset + 1}, $${parameterOffset + 2}, $${parameterOffset + 3}, $${parameterOffset + 4}, $${parameterOffset + 5}, CURRENT_TIMESTAMP)
         ON CONFLICT (${conflictColumns}) DO UPDATE SET
            "source_fingerprint" = EXCLUDED."source_fingerprint",
            "last_legacy_id" = EXCLUDED."last_legacy_id",
            "import_run_id" = EXCLUDED."import_run_id",
            "updated_at" = CURRENT_TIMESTAMP`,
        parameters
    );
};

export const defaultExecutionOptions = (
    sourceKey: string,
    connectionString = `mariadb://legacy@localhost/${sourceKey}`
): MigrationExecutionOptions => ({
    mode: 'full',
    source: { key: sourceKey, fingerprint: fingerprintMariaConnection(connectionString) },
});
