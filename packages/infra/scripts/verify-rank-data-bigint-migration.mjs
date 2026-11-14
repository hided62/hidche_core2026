import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const sourceUrl = process.env.RANK_DATA_MIGRATION_TEST_DATABASE_URL;
if (!sourceUrl) throw new Error('RANK_DATA_MIGRATION_TEST_DATABASE_URL is required (isolated development DB only)');
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['20261114000000_rank_data_bigint_id', '20261114010000_high_churn_bigint_ids'];
const fixtures = [
    ['rank_data', 'general_id, nation_id, type, value', "7, 3, 'warnum', 19"],
    ['general_turn', 'general_id, turn_idx, action_code', "7, 0, 'fixture'"],
    ['nation_turn', 'nation_id, officer_level, turn_idx, action_code', "3, 12, 0, 'fixture'"],
    [
        'traffic_period',
        'world_state_id, year, month, started_at, last_refresh',
        "1, 200, 1, '2026-11-14', '2026-11-14'",
    ],
    ['general_access_log', 'general_id', '7'],
    ['diplomacy', 'src_nation_id, dest_nation_id, state_code', '3, 4, 0'],
    ['inheritance_point', 'user_id, key, value', "'fixture-user', 'previous', 123"],
    ['log_entry', 'scope, category, year, month, text', "'SYSTEM', 'HISTORY', 200, 1, 'fixture'"],
    ['error_log', 'category, message', "'fixture', 'fixture'"],
    ['inheritance_log', 'user_id, year, month, text', "'fixture-user', 200, 1, 'fixture'"],
];
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'rank-bigint-migration-'));
const schema = `rank_bigint_upgrade_${randomUUID().replaceAll('-', '')}`;
const freshSchema = `${schema}_fresh`;
const client = new pg.Client({ connectionString: sourceUrl });
const config = path.join(packageRoot, `.rank-bigint-${process.pid}.config.mjs`);
const url = new URL(sourceUrl);
const deploy = (schemaName) => {
    url.searchParams.set('schema', schemaName);
    const result = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--config', config], {
        cwd: packageRoot,
        env: { ...process.env, DATABASE_URL: url.href },
        encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(`Migration failed (exit ${result.status}); datasource output suppressed`);
};
const snapshots = new Map();
const readIndexes = async (table) =>
    (
        await client.query(
            'SELECT indexname, indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename=$2 ORDER BY indexname',
            [schema, table]
        )
    ).rows;
try {
    await fs.cp(path.join(packageRoot, 'prisma'), path.join(temp, 'prisma'), { recursive: true });
    for (const target of targets) await fs.rm(path.join(temp, 'prisma', 'migrations', target), { recursive: true });
    await fs.writeFile(
        config,
        `export default { schema: ${JSON.stringify(path.join(temp, 'prisma/game.prisma'))}, datasource: { url: process.env.DATABASE_URL } };\n`
    );
    await client.connect();
    // UUID schemas belong only to this invocation; caller's schema is never changed.
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`CREATE SCHEMA "${freshSchema}"`);
    deploy(schema);
    await client.query(`SET search_path TO "${schema}", public`);
    await client.query(`INSERT INTO world_state(id, scenario_code, current_year, current_month, tick_seconds, updated_at)
        VALUES(1, 'fixture', 200, 1, 600, CURRENT_TIMESTAMP)`);
    for (const [table, columns, values] of fixtures) {
        await client.query(`INSERT INTO "${table}" (id, ${columns}) VALUES(2147483647, ${values})`);
        await client.query(`SELECT setval('${table}_id_seq', 2147483647)`);
        await assert.rejects(client.query(`SELECT nextval('${table}_id_seq')`), { code: '2200H' });
        snapshots.set(table, {
            rows: (await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows,
            indexes: await readIndexes(table),
        });
    }
    await client.query(`INSERT INTO traffic_period_general(period_id, general_id, refresh, last_refresh)
        VALUES(2147483647, 7, 2, CURRENT_TIMESTAMP)`);
    const trafficMembers = (await client.query('SELECT * FROM traffic_period_general')).rows;
    for (const target of targets)
        await fs.cp(
            path.join(packageRoot, 'prisma', 'migrations', target),
            path.join(temp, 'prisma', 'migrations', target),
            { recursive: true }
        );
    deploy(schema);
    for (const [table] of fixtures) {
        const before = snapshots.get(table);
        const after = (await client.query(`SELECT * FROM "${table}" ORDER BY id`)).rows;
        assert.deepEqual(
            after.map((row) => ({ ...row, id: Number(row.id) })),
            before.rows
        );
        assert.deepEqual(await readIndexes(table), before.indexes);
        assert.equal((await client.query(`SELECT last_value FROM "${table}_id_seq"`)).rows[0].last_value, '2147483647');
        assert.equal(
            (
                await client.query(
                    "SELECT data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name='id'",
                    [schema, table]
                )
            ).rows[0].data_type,
            'bigint'
        );
        assert.deepEqual(
            (
                await client.query(
                    'SELECT data_type, max_value::text, cycle FROM pg_sequences WHERE schemaname=$1 AND sequencename=$2',
                    [schema, `${table}_id_seq`]
                )
            ).rows[0],
            { data_type: 'bigint', max_value: '9223372036854775807', cycle: false }
        );
        assert.equal((await client.query(`SELECT nextval('${table}_id_seq')`)).rows[0].nextval, '2147483648');
    }
    assert.equal(
        (await client.query("INSERT INTO rank_data(general_id, type) VALUES(8, 'warnum') RETURNING id")).rows[0].id,
        '2147483649'
    );
    await assert.rejects(client.query("INSERT INTO rank_data(general_id, type) VALUES(8, 'warnum')"), {
        code: '23505',
    });
    assert.deepEqual(
        (await client.query('SELECT * FROM traffic_period_general')).rows.map((row) => ({
            ...row,
            period_id: Number(row.period_id),
        })),
        trafficMembers
    );
    await assert.rejects(
        client.query(`INSERT INTO traffic_period_general(period_id, general_id, last_refresh)
        VALUES(999, 8, CURRENT_TIMESTAMP)`),
        { code: '23503' }
    );
    await client.query('BEGIN');
    await client.query('DELETE FROM traffic_period WHERE id=2147483647');
    assert.equal((await client.query('SELECT * FROM traffic_period_general')).rowCount, 0);
    await client.query('ROLLBACK');
    const migrations = (
        await client.query('SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name')
    ).rows;
    deploy(schema);
    assert.deepEqual(
        (await client.query('SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name')).rows,
        migrations
    );
    deploy(freshSchema);
    await client.query(`SET search_path TO "${freshSchema}", public`);
    await client.query(`INSERT INTO world_state(id, scenario_code, current_year, current_month, tick_seconds, updated_at)
        VALUES(1, 'fixture', 200, 1, 600, CURRENT_TIMESTAMP)`);
    for (const [table, columns, values] of fixtures) {
        assert.equal(
            (await client.query(`INSERT INTO "${table}" (${columns}) VALUES(${values}) RETURNING id`)).rows[0].id,
            '1'
        );
    }
    console.log(
        `PASS: ${fixtures.length} exhausted int4 tables upgraded; rows/IDs/indexes preserved, bigint allocation, unique constraint, deploy no-op, fresh full migration`
    );
} finally {
    await client.query('SET search_path TO public').catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS "${freshSchema}" CASCADE`).catch(() => {});
    await client.end();
    await fs.rm(config, { force: true });
    await fs.rm(temp, { recursive: true });
}
