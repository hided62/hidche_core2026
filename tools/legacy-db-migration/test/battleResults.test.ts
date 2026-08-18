import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Pool as PgPool, PoolClient, QueryResult } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { listBattleResultSeasons, type BattleResultSourceConfig } from '../src/battleResultSource.js';
import { migrateBattleResults } from '../src/battleResults.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
    );
});

const sourceFixture = async (): Promise<BattleResultSourceConfig> => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sammo-battle-results-migrate-'));
    temporaryDirectories.push(root);
    const season = path.join(root, 'che_190815_w0sU');
    await mkdir(season);
    await writeFile(path.join(season, 'batres17.txt'), '첫 전투\n둘째 전투\n');
    return {
        kind: 'local',
        directory: root,
        identity: { key: 'fixture:che:battle-results', fingerprint: 'b'.repeat(64) },
    };
};

const targetPool = (
    checkpointRows: Array<Record<string, unknown>> = [],
    failPattern?: string
): { pool: PgPool; queries: Array<{ sql: string; values: readonly unknown[] }> } => {
    const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: readonly unknown[] = []) => {
        queries.push({ sql, values });
        if (failPattern && sql.includes(failPattern)) {
            failPattern = undefined;
            throw new Error('synthetic battle-result write failure');
        }
        if (sql.includes('FROM "legacy_archive"."battle_result_import_checkpoint"')) {
            return { rows: checkpointRows, rowCount: checkpointRows.length } as unknown as QueryResult;
        }
        if (sql.includes('INSERT INTO "legacy_archive"."battle_result_import_run"')) {
            return { rows: [{ id: '91' }], rowCount: 1 } as QueryResult<{ id: string }>;
        }
        return { rows: [], rowCount: 0 } as unknown as QueryResult;
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    return { pool: { connect: vi.fn(async () => client) } as unknown as PgPool, queries };
};

describe('preserved battle-result migration', () => {
    it('rejects an execution identity different from the configured archive source', async () => {
        const source = await sourceFixture();
        await expect(
            migrateBattleResults(targetPool().pool, source, false, 'che', {
                mode: 'full',
                source: { key: 'different:source', fingerprint: 'c'.repeat(64) },
            })
        ).rejects.toThrow('execution identity does not match');
    });

    it('imports one immutable season transactionally and checkpoints it', async () => {
        const source = await sourceFixture();
        const target = targetPool();
        const summary = await migrateBattleResults(target.pool, source, true, 'che', {
            mode: 'full',
            source: source.identity,
        });
        const sql = target.queries.map((entry) => entry.sql).join('\n');

        expect(summary).toMatchObject({
            importRunId: '91',
            counts: { discoveredSeasons: 1, importedSeasons: 1, importedFiles: 1, importedLines: 2 },
        });
        expect(sql).toContain('INSERT INTO "legacy_archive"."general_battle_result"');
        expect(sql).toContain('DELETE FROM "legacy_archive"."general_battle_result"');
        expect(sql).toContain('INSERT INTO "legacy_archive"."battle_result_import_checkpoint"');
        expect(target.queries.some((entry) => entry.sql === 'BEGIN')).toBe(true);
        expect(target.queries.some((entry) => entry.sql === 'COMMIT')).toBe(true);
    });

    it('skips an unchanged checkpoint during incremental import', async () => {
        const source = await sourceFixture();
        const [manifest] = await listBattleResultSeasons(source, 'che');
        const target = targetPool([
            {
                source_fingerprint: source.identity.fingerprint,
                server_id: manifest!.serverId,
                manifest_hash: manifest!.manifestHash,
                file_count: manifest!.fileCount,
                total_bytes: String(manifest!.totalBytes),
            },
        ]);
        const summary = await migrateBattleResults(target.pool, source, false, 'che', {
            mode: 'incremental',
            source: source.identity,
        });

        expect(summary.counts).toMatchObject({ unchangedSeasons: 1, pendingSeasons: 0, importedFiles: 0 });
        expect(target.queries.some((entry) => entry.sql.includes('general_battle_result'))).toBe(false);
    });

    it('reuses manifests collected by plan preflight instead of scanning the source twice', async () => {
        const source = await sourceFixture();
        const manifests = await listBattleResultSeasons(source, 'che');
        await rename(source.directory, `${source.directory}-moved`);
        temporaryDirectories.push(`${source.directory}-moved`);
        const target = targetPool();

        const summary = await migrateBattleResults(
            target.pool,
            source,
            false,
            'che',
            { mode: 'full', source: source.identity },
            manifests
        );

        expect(summary.counts).toMatchObject({ discoveredSeasons: 1, pendingSeasons: 1 });
    });

    it('rejects changed checkpointed content in incremental mode', async () => {
        const source = await sourceFixture();
        const [manifest] = await listBattleResultSeasons(source, 'che');
        const target = targetPool([
            {
                source_fingerprint: source.identity.fingerprint,
                server_id: manifest!.serverId,
                manifest_hash: 'c'.repeat(64),
                file_count: manifest!.fileCount,
                total_bytes: String(manifest!.totalBytes),
            },
        ]);

        await expect(
            migrateBattleResults(target.pool, source, false, 'che', {
                mode: 'incremental',
                source: source.identity,
            })
        ).rejects.toThrow('changed after checkpoint');
    });

    it('rejects a disappeared checkpointed season in full mode instead of leaving stale target rows', async () => {
        const source = await sourceFixture();
        const target = targetPool([
            {
                source_fingerprint: source.identity.fingerprint,
                server_id: 'che_180101_missing',
                manifest_hash: 'c'.repeat(64),
                file_count: 1,
                total_bytes: '10',
            },
        ]);

        await expect(
            migrateBattleResults(target.pool, source, false, 'che', {
                mode: 'full',
                source: source.identity,
            })
        ).rejects.toThrow('seasons disappeared from the source');
    });

    it('rolls back the current season and records a failed run', async () => {
        const source = await sourceFixture();
        const target = targetPool([], 'general_battle_result');
        await expect(
            migrateBattleResults(target.pool, source, true, 'che', { mode: 'full', source: source.identity })
        ).rejects.toThrow('synthetic battle-result write failure');

        expect(target.queries.some((entry) => entry.sql === 'ROLLBACK')).toBe(true);
        expect(target.queries.some((entry) => entry.sql.includes(`"status" = 'FAILED'`))).toBe(true);
    });
});
