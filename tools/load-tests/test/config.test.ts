import assert from 'node:assert/strict';
import { chmod, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { assertRuntimeMetadataFinalized, canonicalJson, expandWeightedOperations, loadTokens, validateLoadConfig } from '../src/config.js';

const samplePath = new URL('../config/300-users-900-npcs-5m.json', import.meta.url);
const oneMinuteProfilePaths = [
    new URL('../config/nya-10-users-800-npcs-1m.json', import.meta.url),
    new URL('../config/pya-10-users-800-npcs-1m.json', import.meta.url),
];

void test('the 300 viewer, 900 NPC, five-minute sample validates', async () => {
    const config = validateLoadConfig(JSON.parse(await readFile(samplePath, 'utf8')));
    assert.equal(config.capacity.authenticatedViewers, 300);
    assert.equal(config.capacity.npcGenerals, 900);
    assert.equal(config.capacity.humanGenerals, 300);
    assert.equal(config.capacity.turnIntervalMs, 300_000);
    assert.equal(config.isolation.redisDatabase, 15);
    assert.equal(config.isolation.profileName, 'load-tests:capacity-300-900-5m');
    assert.deepEqual(new Set(config.phases.map((phase) => phase.kind)), new Set(['idle', 'own', 'global', 'mixed']));
});

void test('nya and pya one-minute profiles use distinct database and Redis isolation', async () => {
    const configs = await Promise.all(
        oneMinuteProfilePaths.map(async (configPath) =>
            validateLoadConfig(JSON.parse(await readFile(configPath, 'utf8')))
        )
    );
    assert.deepEqual(
        configs.map((config) => config.capacity),
        [
            { authenticatedViewers: 10, npcGenerals: 800, humanGenerals: 10, turnIntervalMs: 60_000 },
            { authenticatedViewers: 10, npcGenerals: 800, humanGenerals: 10, turnIntervalMs: 60_000 },
        ]
    );
    assert.equal(new Set(configs.map((config) => config.isolation.postgresSchema)).size, 2);
    assert.equal(new Set(configs.map((config) => config.isolation.redisDatabase)).size, 2);
    assert.equal(new Set(configs.map((config) => config.isolation.profileName)).size, 2);
});

void test('validation rejects public, non-allowlisted, and mutating targets', async () => {
    const raw = JSON.parse(await readFile(samplePath, 'utf8')) as Record<string, any>;
    raw.target.publicProfile = true;
    raw.target.baseUrl = 'https://public.example.invalid';
    raw.phases[1].operations[0].type = 'mutation';
    assert.throws(() => validateLoadConfig(raw), /publicProfile must be false/u);
    assert.throws(() => validateLoadConfig(raw), /hostname is not explicitly allowlisted/u);
    assert.throws(() => validateLoadConfig(raw), /read-only query/u);
});

void test('a measurement run rejects sample metadata placeholders', async () => {
    const config = validateLoadConfig(JSON.parse(await readFile(samplePath, 'utf8')));
    assert.throws(() => assertRuntimeMetadataFinalized(config), /fixtureSha256, imageDigest, postgresVersion, redisVersion/u);
});

void test('canonical JSON and weighted scheduling do not depend on object insertion order', () => {
    assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
    const expanded = expandWeightedOperations([
        { name: 'a', procedure: 'a.read', type: 'query', weight: 2 },
        { name: 'b', procedure: 'b.read', type: 'query', weight: 1 },
    ]);
    assert.deepEqual(expanded.map((operation) => operation.name), ['a', 'a', 'b']);
});

void test('token loading requires an ignored 0600 file and returns no identity metadata', async () => {
    const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
    const tokenPath = path.join(workspaceRoot, 'tools/load-tests/secrets/unit-test-tokens.json');
    await writeFile(tokenPath, JSON.stringify({ tokens: ['ga_test_token_00000001'] }), { mode: 0o600 });
    await chmod(tokenPath, 0o600);
    try {
        assert.deepEqual(await loadTokens(tokenPath, workspaceRoot, 1), ['ga_test_token_00000001']);
        await chmod(tokenPath, 0o644);
        await assert.rejects(loadTokens(tokenPath, workspaceRoot, 1), /0600/u);
    } finally {
        await unlink(tokenPath).catch(() => undefined);
    }
});

void test('token loading rejects a symlink even when its link path is ignored', async () => {
    const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
    const tokenPath = path.join(workspaceRoot, 'tools/load-tests/secrets/unit-test-token-target.json');
    const linkPath = path.join(workspaceRoot, 'tools/load-tests/secrets/unit-test-token-link.json');
    await writeFile(tokenPath, JSON.stringify({ tokens: ['ga_test_token_00000001'] }), { mode: 0o600 });
    await chmod(tokenPath, 0o600);
    await symlink(tokenPath, linkPath);
    try {
        await assert.rejects(loadTokens(linkPath, workspaceRoot, 1), /symbolic link/u);
    } finally {
        await unlink(linkPath).catch(() => undefined);
        await unlink(tokenPath).catch(() => undefined);
    }
});
