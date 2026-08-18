import type { Pool as PgPool, PoolClient } from 'pg';

import {
    listBattleResultSeasons,
    readBattleResultSeason,
    type BattleResultSeasonManifest,
    type BattleResultSourceConfig,
} from './battleResultSource.js';
import { upsertRows, withMigrationLock, type TargetRow } from './db.js';
import type { LegacyArchiveProfile } from './game.js';
import { validateSourceIdentity, type MigrationExecutionOptions } from './incremental.js';

interface StoredSeasonCheckpoint {
    sourceFingerprint: string;
    serverId: string;
    manifestHash: string;
    fileCount: number;
    totalBytes: number;
}

export interface BattleResultMigrationSummary {
    command: 'battle-results';
    apply: boolean;
    mode: 'full' | 'incremental';
    sourceKey: string;
    importRunId: string | null;
    counts: {
        discoveredSeasons: number;
        discoveredFiles: number;
        discoveredBytes: number;
        unchangedSeasons: number;
        pendingSeasons: number;
        pendingFiles: number;
        pendingBytes: number;
        importedSeasons: number;
        importedFiles: number;
        importedLines: number;
        importedBytes: number;
    };
    progress: Record<string, { status: 'UNCHANGED' | 'PENDING' | 'IMPORTED'; files: number; bytes: number }>;
}

const loadCheckpoints = async (
    client: PoolClient,
    profile: LegacyArchiveProfile,
    sourceKey: string
): Promise<Map<string, StoredSeasonCheckpoint>> => {
    const result = await client.query<{
        source_fingerprint: string;
        server_id: string;
        manifest_hash: string;
        file_count: number;
        total_bytes: string;
    }>(
        `SELECT "source_fingerprint", "server_id", "manifest_hash", "file_count", "total_bytes"
         FROM "legacy_archive"."battle_result_import_checkpoint"
         WHERE "source_profile" = $1 AND "source_key" = $2`,
        [profile, sourceKey]
    );
    return new Map(
        result.rows.map((row) => [
            row.server_id,
            {
                sourceFingerprint: row.source_fingerprint,
                serverId: row.server_id,
                manifestHash: row.manifest_hash,
                fileCount: Number(row.file_count),
                totalBytes: Number(row.total_bytes),
            },
        ])
    );
};

const sameManifest = (checkpoint: StoredSeasonCheckpoint, manifest: BattleResultSeasonManifest): boolean =>
    checkpoint.manifestHash === manifest.manifestHash &&
    checkpoint.fileCount === manifest.fileCount &&
    checkpoint.totalBytes === manifest.totalBytes;

const upsertBattleResultRows = async (
    client: PoolClient,
    profile: LegacyArchiveProfile,
    manifest: BattleResultSeasonManifest,
    source: BattleResultSourceConfig,
    importRunId: string
): Promise<{ files: number; lines: number; bytes: number }> => {
    const loaded = await readBattleResultSeason(source, profile, manifest.serverId);
    if (
        loaded.manifest.manifestHash !== manifest.manifestHash ||
        loaded.manifest.fileCount !== manifest.fileCount ||
        loaded.manifest.totalBytes !== manifest.totalBytes
    ) {
        throw new Error(`Battle-result season changed after preflight: ${manifest.serverId}`);
    }

    await client.query(
        `DELETE FROM "legacy_archive"."general_battle_result"
         WHERE "source_profile" = $1 AND "server_id" = $2`,
        [profile, manifest.serverId]
    );

    let batch: TargetRow[] = [];
    let batchBytes = 0;
    let lines = 0;
    const flush = async (): Promise<void> => {
        await upsertRows(client, 'legacy_archive.general_battle_result', batch, [
            'source_profile',
            'server_id',
            'general_no',
        ]);
        batch = [];
        batchBytes = 0;
    };
    for (const file of loaded.files) {
        if (batch.length >= 100 || batchBytes + file.sourceBytes > 4 * 1024 * 1024) await flush();
        batch.push({
            source_profile: profile,
            server_id: file.serverId,
            general_no: file.generalNo,
            content: file.content,
            line_count: file.lineCount,
            source_bytes: file.sourceBytes,
            content_hash: file.contentHash,
            import_run_id: importRunId,
            updated_at: new Date(),
        });
        batchBytes += file.sourceBytes;
        lines += file.lineCount;
    }
    await flush();
    return { files: loaded.files.length, lines, bytes: loaded.manifest.totalBytes };
};

const saveCheckpoint = async (
    client: PoolClient,
    profile: LegacyArchiveProfile,
    source: BattleResultSourceConfig,
    manifest: BattleResultSeasonManifest,
    importRunId: string
): Promise<void> => {
    await client.query(
        `INSERT INTO "legacy_archive"."battle_result_import_checkpoint"
            ("source_profile", "source_key", "source_fingerprint", "server_id", "manifest_hash",
             "file_count", "total_bytes", "import_run_id", "updated_at")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
         ON CONFLICT ("source_profile", "source_key", "server_id") DO UPDATE SET
             "source_fingerprint" = EXCLUDED."source_fingerprint",
             "manifest_hash" = EXCLUDED."manifest_hash",
             "file_count" = EXCLUDED."file_count",
             "total_bytes" = EXCLUDED."total_bytes",
             "import_run_id" = EXCLUDED."import_run_id",
             "updated_at" = CURRENT_TIMESTAMP`,
        [
            profile,
            source.identity.key,
            source.identity.fingerprint,
            manifest.serverId,
            manifest.manifestHash,
            manifest.fileCount,
            manifest.totalBytes,
            importRunId,
        ]
    );
};

export const migrateBattleResults = async (
    targetPool: PgPool,
    source: BattleResultSourceConfig,
    apply: boolean,
    profile: LegacyArchiveProfile,
    execution: MigrationExecutionOptions,
    prefetchedManifests?: readonly BattleResultSeasonManifest[]
): Promise<BattleResultMigrationSummary> => {
    validateSourceIdentity(source.identity);
    validateSourceIdentity(execution.source);
    if (execution.source.key !== source.identity.key || execution.source.fingerprint !== source.identity.fingerprint) {
        throw new Error('Preserved battle-result execution identity does not match its configured source');
    }
    const manifests = prefetchedManifests ? [...prefetchedManifests] : await listBattleResultSeasons(source, profile);
    const counts: BattleResultMigrationSummary['counts'] = {
        discoveredSeasons: manifests.length,
        discoveredFiles: manifests.reduce((sum, item) => sum + item.fileCount, 0),
        discoveredBytes: manifests.reduce((sum, item) => sum + item.totalBytes, 0),
        unchangedSeasons: 0,
        pendingSeasons: 0,
        pendingFiles: 0,
        pendingBytes: 0,
        importedSeasons: 0,
        importedFiles: 0,
        importedLines: 0,
        importedBytes: 0,
    };
    const progress: BattleResultMigrationSummary['progress'] = {};
    const client = await targetPool.connect();
    let importRunId: string | null = null;
    try {
        const checkpoints = await loadCheckpoints(client, profile, source.identity.key);
        const currentServerIds = new Set(manifests.map((manifest) => manifest.serverId));
        const missing = [...checkpoints.keys()].filter((serverId) => !currentServerIds.has(serverId));
        if (missing.length) {
            throw new Error(`Preserved battle-result seasons disappeared from the source: ${missing.join(', ')}`);
        }
        if (execution.mode === 'incremental') {
            if (manifests.length > 0 && checkpoints.size === 0) {
                throw new Error('Incremental preserved battle-result migration requires a completed full checkpoint');
            }
        }
        const pending: BattleResultSeasonManifest[] = [];
        for (const manifest of manifests) {
            const checkpoint = checkpoints.get(manifest.serverId);
            if (checkpoint && checkpoint.sourceFingerprint !== source.identity.fingerprint) {
                throw new Error(`Preserved battle-result source fingerprint changed for ${manifest.serverId}`);
            }
            if (checkpoint && sameManifest(checkpoint, manifest)) {
                counts.unchangedSeasons += 1;
                progress[manifest.serverId] = {
                    status: 'UNCHANGED',
                    files: manifest.fileCount,
                    bytes: manifest.totalBytes,
                };
                continue;
            }
            if (checkpoint && execution.mode === 'incremental') {
                throw new Error(`Preserved battle-result season changed after checkpoint: ${manifest.serverId}`);
            }
            pending.push(manifest);
            counts.pendingSeasons += 1;
            counts.pendingFiles += manifest.fileCount;
            counts.pendingBytes += manifest.totalBytes;
            progress[manifest.serverId] = { status: 'PENDING', files: manifest.fileCount, bytes: manifest.totalBytes };
        }

        if (!apply) {
            return {
                command: 'battle-results',
                apply,
                mode: execution.mode,
                sourceKey: source.identity.key,
                importRunId,
                counts,
                progress,
            };
        }

        await withMigrationLock(
            client,
            `sammo-legacy-battle-results-v1:${profile}:${source.identity.key}`,
            async () => {
                const created = await client.query<{ id: string }>(
                    `INSERT INTO "legacy_archive"."battle_result_import_run"
                    ("source_profile", "source_key", "source_fingerprint", "mode", "status")
                 VALUES ($1, $2, $3, $4, 'RUNNING') RETURNING "id"`,
                    [profile, source.identity.key, source.identity.fingerprint, execution.mode]
                );
                importRunId = created.rows[0]?.id ?? null;
                if (!importRunId) throw new Error('Failed to create preserved battle-result import run');
                try {
                    for (const manifest of pending) {
                        await client.query('BEGIN');
                        try {
                            const imported = await upsertBattleResultRows(
                                client,
                                profile,
                                manifest,
                                source,
                                importRunId
                            );
                            await saveCheckpoint(client, profile, source, manifest, importRunId);
                            await client.query('COMMIT');
                            counts.importedSeasons += 1;
                            counts.importedFiles += imported.files;
                            counts.importedLines += imported.lines;
                            counts.importedBytes += imported.bytes;
                            progress[manifest.serverId] = {
                                status: 'IMPORTED',
                                files: imported.files,
                                bytes: imported.bytes,
                            };
                        } catch (error) {
                            await client.query('ROLLBACK');
                            throw error;
                        }
                    }
                    await client.query(
                        `UPDATE "legacy_archive"."battle_result_import_run"
                     SET "status" = 'COMPLETED', "finished_at" = CURRENT_TIMESTAMP,
                         "counts" = $2::jsonb, "progress" = $3::jsonb
                     WHERE "id" = $1`,
                        [importRunId, JSON.stringify(counts), JSON.stringify(progress)]
                    );
                } catch (error) {
                    const message =
                        error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000);
                    await client.query(
                        `UPDATE "legacy_archive"."battle_result_import_run"
                     SET "status" = 'FAILED', "finished_at" = CURRENT_TIMESTAMP,
                         "counts" = $2::jsonb, "progress" = $3::jsonb, "error" = $4
                     WHERE "id" = $1`,
                        [importRunId, JSON.stringify(counts), JSON.stringify(progress), message]
                    );
                    throw error;
                }
            }
        );
        return {
            command: 'battle-results',
            apply,
            mode: execution.mode,
            sourceKey: source.identity.key,
            importRunId,
            counts,
            progress,
        };
    } finally {
        client.release();
    }
};
