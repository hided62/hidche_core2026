import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';

const sourceUrl = process.env.OPEN_REQUEST_DATABASE_URL;
if (!sourceUrl) throw new Error('OPEN_REQUEST_DATABASE_URL must point to a disposable fixture instance.');
const target = '20261022000000_add_open_requests';
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismaRoot = path.join(packageRoot, 'prisma');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'open-request-migration-'));
const schema = `open_request_upgrade_${Date.now()}`;
const url = new URL(sourceUrl);
url.searchParams.set('schema', schema);
const client = new pg.Client({ connectionString: sourceUrl });
const deploy = (config) => {
    const result = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--config', config], {
        cwd: packageRoot,
        env: { ...process.env, GATEWAY_DATABASE_URL: url.href },
        encoding: 'utf8',
    });
    if (result.status !== 0)
        throw new Error(`Migration deploy failed (exit ${result.status}); datasource output suppressed.`);
};
try {
    await fs.copyFile(path.join(prismaRoot, 'gateway.prisma'), path.join(temp, 'gateway.prisma'));
    await fs.cp(path.join(prismaRoot, 'gateway-migrations'), path.join(temp, 'gateway-migrations'), {
        recursive: true,
    });
    await fs.rm(path.join(temp, 'gateway-migrations', target), { recursive: true });
    // Keep config inside this package so Prisma's config import resolves normally.
    const config = path.join(packageRoot, `.open-request-migration-${process.pid}.config.mjs`);
    const configText = `export default { schema: ${JSON.stringify(path.join(temp, 'gateway.prisma'))}, migrations: { path: ${JSON.stringify(path.join(temp, 'gateway-migrations'))} }, datasource: { url: process.env.GATEWAY_DATABASE_URL } };\n`;
    await fs.writeFile(config, configText);
    try {
        deploy(config);
    } finally {
        await fs.rm(config);
    }
    await client.connect();
    await client.query(`SET search_path TO "${schema}", public`);
    const userId = randomUUID(),
        profileName = 'opening-upgrade:default';
    await client.query(
        'INSERT INTO app_user(id,login_id,display_name,password_hash,password_salt,updated_at) VALUES($1,$2,$2,$3,$3,NOW())',
        [userId, 'fixture-user', 'fixture-only']
    );
    await client.query(
        'INSERT INTO gateway_profile(profile_name,profile,instance_key,scenario,api_port,status,updated_at) VALUES($1,$2,$3,$3,15995,$4,NOW())',
        [profileName, 'opening-upgrade', 'default', 'STOPPED']
    );
    deploy(path.join(packageRoot, 'prisma.gateway.config.ts'));
    const after = await client.query('SELECT COUNT(*)::int AS count FROM _prisma_migrations');
    deploy(path.join(packageRoot, 'prisma.gateway.config.ts'));
    assert.deepEqual((await client.query('SELECT COUNT(*)::int AS count FROM _prisma_migrations')).rows, after.rows);
    assert.equal((await client.query('SELECT id FROM app_user WHERE id=$1', [userId])).rowCount, 1);
    const requestId = randomUUID();
    await client.query(
        `INSERT INTO gateway_open_request(id,profile_name,requested_by,install,announcement,season_key,expires_at,preopen_at,open_at,updated_at)
        VALUES($1,$2,$3,'{}','{}','fixture',NOW()+INTERVAL '1 day',NOW()+INTERVAL '2 days',NOW()+INTERVAL '3 days',NOW())`,
        [requestId, profileName, userId]
    );
    await client.query('INSERT INTO gateway_open_endorsement(request_id,user_id) VALUES($1,$2)', [requestId, userId]);
    await assert.rejects(
        () =>
            client.query('INSERT INTO gateway_open_endorsement(request_id,user_id) VALUES($1,$2)', [requestId, userId]),
        { code: '23505' }
    );
    await assert.rejects(
        () =>
            client.query(
                `INSERT INTO gateway_open_request(id,profile_name,requested_by,install,announcement,season_key,expires_at,preopen_at,open_at,updated_at)
        SELECT $1,profile_name,requested_by,install,announcement,season_key,expires_at,preopen_at,open_at,NOW() FROM gateway_open_request WHERE id=$2`,
                [randomUUID(), requestId]
            ),
        { code: '23505' }
    );
    await assert.rejects(
        () => client.query("UPDATE gateway_open_request SET status='RESERVED' WHERE id=$1", [requestId]),
        { code: '23514' }
    );
    await assert.rejects(
        () => client.query('UPDATE gateway_open_request SET open_at=preopen_at WHERE id=$1', [requestId]),
        { code: '23514' }
    );
    await assert.rejects(
        () =>
            client.query('INSERT INTO gateway_open_endorsement(request_id,user_id) VALUES($1,$2)', [
                randomUUID(),
                userId,
            ]),
        { code: '23503' }
    );
    console.log(
        `Opening migration: predecessor upgrade, preserved rows, repeated deploy no-op, unique/FK/CHECK constraints passed (${schema}).`
    );
} finally {
    await client.end();
    await fs.rm(temp, { recursive: true, force: true });
}
