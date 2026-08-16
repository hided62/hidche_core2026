import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { validateLoadConfig } from '../src/config.js';
import { assertFixtureIsolation } from '../src/fixture.js';

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
                databaseUrl: 'postgresql://fixture:secret@database.example.com:5432/sammo?schema=load_capacity_300_900_5m',
                redisUrl: 'redis://127.0.0.1:16379/15',
            }),
        /loopback or private/u
    );
});
