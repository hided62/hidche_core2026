import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDeploymentVersionChecker,
    deploymentVersionAssetSource,
    parseDeploymentCommitSha,
} from '../src/config/deploymentVersion.ts';

const currentCommitSha = '0123456789abcdef0123456789abcdef01234567';
const nextCommitSha = '89abcdef0123456789abcdef0123456789abcdef';
const laterCommitSha = 'fedcba9876543210fedcba9876543210fedcba98';

const jsonResponse = (commitSha: string): Response =>
    new Response(JSON.stringify({ commitSha }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });

void test('accepts only full hexadecimal deployment commit values', () => {
    assert.equal(parseDeploymentCommitSha({ commitSha: nextCommitSha.toUpperCase() }), nextCommitSha);
    assert.equal(parseDeploymentCommitSha({ commitSha: 'main' }), null);
    assert.equal(parseDeploymentCommitSha({ version: nextCommitSha }), null);
    assert.equal(parseDeploymentCommitSha(null), null);
});

void test('exposes only the read-only build commit in the deployment version asset', () => {
    assert.deepEqual(JSON.parse(deploymentVersionAssetSource(currentCommitSha)), { commitSha: currentCommitSha });
});

void test('notifies once per available version and bypasses browser caches', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const stored = new Map<string, string>();
    const notifications: string[] = [];
    let availableCommitSha = currentCommitSha;
    const checker = createDeploymentVersionChecker({
        currentCommitSha,
        versionUrl: '/che/deployment-version.json',
        now: () => 1234,
        storage: {
            getItem: (key) => stored.get(key) ?? null,
            setItem: (key, value) => void stored.set(key, value),
        },
        fetchVersion: async (url, init) => {
            requests.push({ url: String(url), init });
            return jsonResponse(availableCommitSha);
        },
        onVersionChanged: (commitSha) => notifications.push(commitSha),
    });

    await checker.check();
    availableCommitSha = nextCommitSha;
    await checker.check();
    await checker.check();
    availableCommitSha = laterCommitSha;
    await checker.check();

    assert.deepEqual(notifications, [nextCommitSha, laterCommitSha]);
    assert.equal(requests.every(({ url }) => url === '/che/deployment-version.json?t=1234'), true);
    assert.equal(requests.every(({ init }) => init?.cache === 'no-store'), true);
    assert.equal(requests.every(({ init }) => new Headers(init?.headers).get('Cache-Control') === 'no-cache'), true);
});

void test('shares the once-only notice within the current tab session', async () => {
    const stored = new Map<string, string>();
    const storage = {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => void stored.set(key, value),
    };
    let notifications = 0;
    const options = {
        currentCommitSha,
        versionUrl: '/hwe/deployment-version.json',
        storage,
        fetchVersion: async () => jsonResponse(nextCommitSha),
        onVersionChanged: () => notifications++,
    };

    await createDeploymentVersionChecker(options).check();
    await createDeploymentVersionChecker(options).check();

    assert.equal(notifications, 1);
});

void test('ignores unavailable or malformed version documents without disrupting the page', async () => {
    let notifications = 0;
    const unavailable = createDeploymentVersionChecker({
        currentCommitSha,
        versionUrl: '/che/deployment-version.json',
        fetchVersion: async () => {
            throw new Error('offline');
        },
        onVersionChanged: () => notifications++,
    });
    const malformed = createDeploymentVersionChecker({
        currentCommitSha,
        versionUrl: '/che/deployment-version.json',
        fetchVersion: async () => new Response('{', { status: 200 }),
        onVersionChanged: () => notifications++,
    });

    await unavailable.check();
    await malformed.check();
    assert.equal(notifications, 0);
});
