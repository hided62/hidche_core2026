import type { Pool as MariaPool } from 'mariadb';
import type { Pool as PgPool, PoolClient, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { isLegacyArchiveProfile, migrateGame, resolveLegacyGameOpenedAt } from '../src/game.js';

const sourceRows = {
    ng_games: [
        {
            id: 1,
            server_id: 'che_fixture_001',
            date: new Date('2020-01-01T00:00:00.000Z'),
            winner_nation: 3,
            map: 'che',
            season: 1,
            scenario: 2,
            scenario_name: 'fixture',
            env: JSON.stringify({ opentime: '2020-01-02T00:00:00.000Z', starttime: '2020-01-03T00:00:00.000Z' }),
        },
    ],
    ng_old_generals: [
        {
            id: 2,
            server_id: 'che_fixture_001',
            general_no: 10,
            owner: 42,
            name: 'fixture-general',
            last_yearmonth: 22012,
            turntime: new Date('2020-02-01T00:00:00.000Z'),
            data: JSON.stringify({ leader: 80, power: 70, intel: 60, history: 'first<br>second<br>' }),
        },
    ],
} satisfies Record<string, Array<Record<string, unknown>>>;

const sourcePool = (): MariaPool => {
    const seen = new Set<string>();
    return {
        query: vi.fn(async (sql: string, values: readonly unknown[] = []) => {
            const table = /FROM `([a-z_]+)`/u.exec(sql)?.[1] ?? '';
            if (sql.includes('SELECT MAX(')) {
                const rows = (sourceRows[table as keyof typeof sourceRows] ?? []) as Array<Record<string, unknown>>;
                const idColumn = /MAX\(`([a-z_]+)`\)/u.exec(sql)?.[1] ?? 'id';
                return [{ max_id: rows.length ? rows.at(-1)?.[idColumn] : null }];
            }
            if (seen.has(table)) return [];
            seen.add(table);
            const afterId = BigInt(String(values[0] ?? -1));
            return ((sourceRows[table as keyof typeof sourceRows] ?? []) as Array<Record<string, unknown>>).filter(
                (row) => {
                    const idColumn = /WHERE `([a-z_]+)` >/u.exec(sql)?.[1] ?? 'id';
                    return BigInt(String(row[idColumn])) > afterId;
                }
            );
        }),
    } as unknown as MariaPool;
};

const targetPool = (
    failPattern?: string,
    checkpoints?: Record<string, { fingerprint: string; lastLegacyId: string }>
) => {
    const queries: Array<{ sql: string; values: readonly unknown[] }> = [];
    const query = vi.fn(async (sql: string, values: readonly unknown[] = []) => {
        queries.push({ sql, values });
        if (failPattern && sql.includes(failPattern)) {
            failPattern = undefined;
            throw new Error('synthetic archive write failure');
        }
        if (sql.includes('INSERT INTO "legacy_archive"."import_run"')) {
            return { rows: [{ id: '77' }], rowCount: 1 } as QueryResult<{ id: string }>;
        }
        if (sql.includes('FROM "legacy_archive"."import_checkpoint"')) {
            const checkpoint = checkpoints?.[String(values[1])];
            return {
                rows: checkpoint
                    ? [
                          {
                              source_fingerprint: checkpoint.fingerprint,
                              last_legacy_id: checkpoint.lastLegacyId,
                          },
                      ]
                    : [],
                rowCount: checkpoint ? 1 : 0,
            } as unknown as QueryResult;
        }
        return { rows: [], rowCount: 0 } as unknown as QueryResult;
    });
    const client = { query, release: vi.fn() } as unknown as PoolClient;
    return {
        pool: { connect: vi.fn(async () => client) } as unknown as PgPool,
        queries,
    };
};

describe('legacy archive game migration', () => {
    it('uses the official profile allowlist and resolves the best opening timestamp', () => {
        expect(isLegacyArchiveProfile('che')).toBe(true);
        expect(isLegacyArchiveProfile('hwe')).toBe(true);
        expect(isLegacyArchiveProfile('custom')).toBe(false);
        expect(
            resolveLegacyGameOpenedAt(
                { opentime: '2020-01-02T00:00:00.000Z', starttime: '2020-01-03T00:00:00.000Z' },
                new Date('2020-01-01T00:00:00.000Z'),
                'fixture'
            ).toISOString()
        ).toBe('2020-01-02T00:00:00.000Z');
        expect(
            resolveLegacyGameOpenedAt(
                { starttime: '2020-01-03T00:00:00.000Z' },
                new Date('2020-01-01T00:00:00.000Z'),
                'fixture'
            ).toISOString()
        ).toBe('2020-01-03T00:00:00.000Z');
        expect(resolveLegacyGameOpenedAt({}, new Date('2020-01-01T00:00:00.000Z'), 'fixture').toISOString()).toBe(
            '2020-01-01T00:00:00.000Z'
        );
        expect(
            resolveLegacyGameOpenedAt(
                { opentime: -324000000, starttime: 0 },
                new Date('2026-08-10T22:00:00.000Z'),
                'fixture'
            ).toISOString()
        ).toBe('2026-08-10T22:00:00.000Z');
        expect(
            resolveLegacyGameOpenedAt(
                { opentime: 'not-a-date' },
                new Date('2026-08-10T22:00:00.000Z'),
                'fixture'
            ).toISOString()
        ).toBe('2026-08-10T22:00:00.000Z');
    });

    it('keeps dry-run target-read-only while reporting normalized formats', async () => {
        const summary = await migrateGame(sourcePool(), null, false, 'che');
        expect(summary).toMatchObject({
            apply: false,
            importRunId: null,
            counts: { ng_games: 1, ng_old_generals: 1 },
            sourceFormatSummary: { 'legacy-flat-v0': 1 },
        });
    });

    it('records a completed import run and writes only archive tables for historical snapshots', async () => {
        const target = targetPool();
        const summary = await migrateGame(sourcePool(), target.pool, true, 'che');
        const sql = target.queries.map((entry) => entry.sql).join('\n');

        expect(summary.importRunId).toBe('77');
        expect(sql).toContain('INSERT INTO "legacy_archive"."game_history"');
        expect(sql).toContain('INSERT INTO "legacy_archive"."general"');
        expect(sql).not.toContain('INSERT INTO "ng_games"');
        expect(sql).not.toContain('INSERT INTO "ng_old_generals"');
        expect(sql).toContain(`SET "status" = 'COMPLETED'`);
        expect(target.queries.some((entry) => entry.sql === 'BEGIN')).toBe(true);
        expect(target.queries.some((entry) => entry.sql === 'COMMIT')).toBe(true);
        expect(target.queries.findIndex((entry) => entry.sql.includes(`SET "status" = 'COMPLETED'`))).toBeLessThan(
            target.queries.findIndex((entry) => entry.sql === 'COMMIT')
        );
    });

    it('rolls back archive writes and records a failed import run', async () => {
        const target = targetPool('INSERT INTO "legacy_archive"."general"');
        await expect(migrateGame(sourcePool(), target.pool, true, 'che')).rejects.toThrow(
            'synthetic archive write failure'
        );
        const sql = target.queries.map((entry) => entry.sql).join('\n');
        expect(target.queries.some((entry) => entry.sql === 'ROLLBACK')).toBe(true);
        expect(sql).toContain(`SET "status" = 'FAILED'`);
        expect(sql).not.toContain(`SET "status" = 'COMPLETED'`);
    });

    it('rolls back archive writes when completing the import run fails', async () => {
        const target = targetPool(`SET "status" = 'COMPLETED'`);
        await expect(migrateGame(sourcePool(), target.pool, true, 'che')).rejects.toThrow(
            'synthetic archive write failure'
        );

        expect(target.queries.some((entry) => entry.sql === 'COMMIT')).toBe(false);
        expect(target.queries.some((entry) => entry.sql === 'ROLLBACK')).toBe(true);
        expect(target.queries.some((entry) => entry.sql.includes(`SET "status" = 'FAILED'`))).toBe(true);
    });

    it('rejects an unsupported profile before reading or writing', async () => {
        await expect(migrateGame(sourcePool(), null, false, 'custom')).rejects.toThrow(
            'Unsupported legacy archive profile'
        );
    });

    it('uses checkpoints for append-only tables while rescanning mutable game history', async () => {
        const fingerprint = 'a'.repeat(64);
        const checkpoints = Object.fromEntries(
            ['hall', 'ng_old_nations', 'emperior', 'inheritance_result', 'user_record', 'ng_history'].map((table) => [
                table,
                { fingerprint, lastLegacyId: '-1' },
            ])
        );
        checkpoints.ng_old_generals = { fingerprint, lastLegacyId: '1' };
        const target = targetPool(undefined, checkpoints);

        const summary = await migrateGame(sourcePool(), target.pool, false, 'che', {
            mode: 'incremental',
            source: { key: 'fixture:che', fingerprint },
        });

        expect(summary.counts).toMatchObject({ ng_games: 1, ng_old_generals: 1 });
        expect(summary.progress).toMatchObject({
            ng_games: { strategy: 'rescan', startAfterId: null, processed: 1 },
            ng_old_generals: { strategy: 'append', startAfterId: '1', endAtId: '2', processed: 1 },
        });
        expect(target.queries.some((entry) => entry.sql.includes('INSERT INTO "legacy_archive"."general"'))).toBe(
            false
        );
    });

    it('refuses incremental mode without a completed full checkpoint', async () => {
        await expect(
            migrateGame(sourcePool(), targetPool().pool, false, 'che', {
                mode: 'incremental',
                source: { key: 'fixture:che', fingerprint: 'a'.repeat(64) },
            })
        ).rejects.toThrow('requires a completed full checkpoint');
    });
});
