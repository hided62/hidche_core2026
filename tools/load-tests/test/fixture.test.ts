import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateLoadConfig } from '../src/config.js';
import { activateCapacityCoverage, assertFixtureIsolation, prepareCapacitySecrets } from '../src/fixture.js';

const samplePath = new URL('../config/300-users-900-npcs-5m.json', import.meta.url);

void test('fixture accepts only the configured private schema and dedicated Redis database', async () => {
    const config = validateLoadConfig(JSON.parse(await readFile(samplePath, 'utf8')));
    assert.doesNotThrow(() =>
        assertFixtureIsolation(config, {
            databaseUrl: 'postgresql://fixture:secret@127.0.0.1:15432/sammo?schema=load_capacity_300_900_5m',
            redisUrl: 'redis://127.0.0.1:16379/15',
        })
    );
});

void test('fixture refuses a shared schema, shared Redis database, and public host', async () => {
    const config = validateLoadConfig(JSON.parse(await readFile(samplePath, 'utf8')));
    assert.throws(
        () =>
            assertFixtureIsolation(config, {
                databaseUrl: 'postgresql://fixture:secret@127.0.0.1:15432/sammo?schema=public',
                redisUrl: 'redis://127.0.0.1:16379/15',
            }),
        /schema must exactly match/u
    );
    assert.throws(
        () =>
            assertFixtureIsolation(config, {
                databaseUrl: 'postgresql://fixture:secret@127.0.0.1:15432/sammo?schema=load_capacity_300_900_5m',
                redisUrl: 'redis://127.0.0.1:16379/0',
            }),
        /database must exactly match/u
    );
    assert.throws(
        () =>
            assertFixtureIsolation(config, {
                databaseUrl:
                    'postgresql://fixture:secret@database.example.com:5432/sammo?schema=load_capacity_300_900_5m',
                redisUrl: 'redis://127.0.0.1:16379/15',
            }),
        /loopback or private/u
    );
});

void test('coverage activation requires the exact dedicated schema confirmation before connecting', async () => {
    const config = validateLoadConfig(JSON.parse(await readFile(samplePath, 'utf8')));
    await assert.rejects(activateCapacityCoverage(config, 'load_wrong_schema', {}), /confirmation must exactly equal/u);
});

void test('prepare creates only three 0600 ignored-secret inputs without returning their values', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sammo-capacity-prepare-'));
    try {
        await mkdir(path.join(workspaceRoot, 'tools/load-tests/secrets'), { recursive: true });
        const config = validateLoadConfig(JSON.parse(await readFile(samplePath, 'utf8')));
        const result = await prepareCapacitySecrets({
            config,
            workspaceRoot,
            env: { CAPACITY_POSTGRES_PORT: '25442', CAPACITY_REDIS_PORT: '26379' },
        });

        assert.deepEqual(result, { prepared: true, secretFilesWritten: 3, mode: '0600' });
        for (const name of ['postgres-password.txt', 'image-upload-secret.txt', 'capacity.env']) {
            const info = await stat(path.join(workspaceRoot, 'tools/load-tests/secrets', name));
            assert.equal(info.mode & 0o777, 0o600);
        }
        const envText = await readFile(path.join(workspaceRoot, 'tools/load-tests/secrets/capacity.env'), 'utf8');
        assert.match(envText, /127\.0\.0\.1:25442/u);
        assert.match(envText, /127\.0\.0\.1:26379\/15/u);
        assert.equal(JSON.stringify(result).includes('postgresql://'), false);
    } finally {
        await rm(workspaceRoot, { recursive: true, force: true });
    }
});
