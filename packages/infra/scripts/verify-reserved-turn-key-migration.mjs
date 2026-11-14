import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const sourceUrl = process.env.RESERVED_TURN_MIGRATION_TEST_DATABASE_URL;
if (!sourceUrl) throw new Error('RESERVED_TURN_MIGRATION_TEST_DATABASE_URL is required (isolated development DB only)');
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = '20261114020000_reserved_turn_slot_primary_keys';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'reserved-slot-migration-'));
const schema = `reserved_slot_${randomUUID().replaceAll('-', '')}`;
const fresh = `${schema}_fresh`;
const config = path.join(packageRoot, `.reserved-slot-${process.pid}.config.mjs`);
const client = new pg.Client({ connectionString: sourceUrl });
const url = new URL(sourceUrl);
const deploy = (name) => {
    url.searchParams.set('schema', name);
    const result = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--config', config], {
        cwd: packageRoot,
        env: { ...process.env, DATABASE_URL: url.href },
        encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(`Migration failed (exit ${result.status}); datasource output suppressed`);
};
const snapshot = async () => ({
    general: (
        await client.query(
            'SELECT general_id,turn_idx,action_code,arg,created_at FROM general_turn ORDER BY general_id,turn_idx'
        )
    ).rows,
    nation: (
        await client.query(
            'SELECT nation_id,officer_level,turn_idx,action_code,arg,created_at FROM nation_turn ORDER BY nation_id,officer_level,turn_idx'
        )
    ).rows,
    generalRevision: (await client.query('SELECT * FROM general_turn_revision ORDER BY general_id')).rows,
    nationRevision: (await client.query('SELECT * FROM nation_turn_revision ORDER BY nation_id,officer_level')).rows,
});
const assertKeys = async (name) => {
    assert.equal(
        (
            await client.query(
                "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name IN ('general_turn','nation_turn') AND column_name='id'",
                [name]
            )
        ).rows[0].n,
        0
    );
    assert.equal(
        (
            await client.query(
                "SELECT count(*)::int AS n FROM pg_sequences WHERE schemaname=$1 AND sequencename IN ('general_turn_id_seq','nation_turn_id_seq')",
                [name]
            )
        ).rows[0].n,
        0
    );
    assert.deepEqual(
        (
            await client.query(
                "SELECT t.relname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid JOIN pg_namespace n ON t.relnamespace=n.oid WHERE n.nspname=$1 AND c.contype='p' AND t.relname IN ('general_turn','nation_turn') ORDER BY t.relname",
                [name]
            )
        ).rows,
        [
            { relname: 'general_turn', definition: 'PRIMARY KEY (general_id, turn_idx)' },
            { relname: 'nation_turn', definition: 'PRIMARY KEY (nation_id, officer_level, turn_idx)' },
        ]
    );
};
try {
    await fs.cp(path.join(packageRoot, 'prisma'), path.join(temp, 'prisma'), { recursive: true });
    await fs.rm(path.join(temp, 'prisma', 'migrations', target), { recursive: true });
    await fs.writeFile(
        config,
        `export default { schema: ${JSON.stringify(path.join(temp, 'prisma/game.prisma'))}, datasource: { url: process.env.DATABASE_URL } };\n`
    );
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`CREATE SCHEMA "${fresh}"`);
    deploy(schema);
    await client.query(`SET search_path TO "${schema}", public`);
    await client.query(
        `INSERT INTO general_turn(id,general_id,turn_idx,action_code,arg,created_at) VALUES(3000000001,7,0,'che_훈련','{"x":1}','2026-11-14'),(3000000002,7,1,'휴식','{}','2026-11-14')`
    );
    await client.query(
        `INSERT INTO nation_turn(id,nation_id,officer_level,turn_idx,action_code,arg,created_at) VALUES(3000000003,3,12,0,'che_포상','{"amount":10}','2026-11-14'),(3000000004,3,10,0,'휴식','{}','2026-11-14')`
    );
    await client.query(
        `INSERT INTO general_turn_revision(general_id,revision,lease_owner,lease_expires_at,updated_at) VALUES(7,29,'fixture-daemon','2026-11-15','2026-11-14')`
    );
    await client.query(
        `INSERT INTO nation_turn_revision(nation_id,officer_level,revision,lease_owner,lease_expires_at,updated_at) VALUES(3,12,41,'fixture-daemon','2026-11-15','2026-11-14')`
    );
    const before = await snapshot();
    await fs.cp(
        path.join(packageRoot, 'prisma', 'migrations', target),
        path.join(temp, 'prisma', 'migrations', target),
        { recursive: true }
    );
    deploy(schema);
    assert.deepEqual(await snapshot(), before);
    await assertKeys(schema);
    await assert.rejects(
        client.query("INSERT INTO general_turn(general_id,turn_idx,action_code) VALUES(7,0,'duplicate')"),
        { code: '23505' }
    );
    await assert.rejects(
        client.query(
            "INSERT INTO nation_turn(nation_id,officer_level,turn_idx,action_code) VALUES(3,12,0,'duplicate')"
        ),
        { code: '23505' }
    );
    await client.query('BEGIN');
    await client.query('DELETE FROM general_turn WHERE general_id=7');
    await client.query("INSERT INTO general_turn(general_id,turn_idx,action_code) VALUES(7,0,'replacement')");
    await client.query('ROLLBACK');
    assert.deepEqual(await snapshot(), before);
    const migrations = (
        await client.query('SELECT migration_name,checksum FROM _prisma_migrations ORDER BY migration_name')
    ).rows;
    deploy(schema);
    assert.deepEqual(
        (await client.query('SELECT migration_name,checksum FROM _prisma_migrations ORDER BY migration_name')).rows,
        migrations
    );
    deploy(fresh);
    await client.query(`SET search_path TO "${fresh}", public`);
    await assertKeys(fresh);
    await client.query("INSERT INTO general_turn(general_id,turn_idx,action_code) VALUES(7,0,'휴식')");
    await client.query("INSERT INTO nation_turn(nation_id,officer_level,turn_idx,action_code) VALUES(3,12,0,'휴식')");
    console.log(
        'PASS: populated predecessor and fresh migration, command/arg/timestamp/revision/lease preservation, natural PK uniqueness, queue replacement rollback, removed sequences, deploy no-op'
    );
} finally {
    await client.query('SET search_path TO public').catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS "${fresh}" CASCADE`).catch(() => {});
    await client.end();
    await fs.rm(config, { force: true });
    await fs.rm(temp, { recursive: true });
}
