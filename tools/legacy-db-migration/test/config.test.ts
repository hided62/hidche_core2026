import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadMigrationPlan } from '../src/config.js';

const workDirectories: string[] = [];

afterEach(async () => {
    delete process.env.TEST_GATEWAY_DATABASE_URL;
    await Promise.all(workDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const writeFixture = async (mode = 0o600): Promise<string> => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sammo-legacy-plan-'));
    workDirectories.push(directory);
    await writeFile(path.join(directory, 'mysql-password'), 'secret-value\n', { mode: 0o600 });
    const configPath = path.join(directory, 'migration-plan.json');
    await writeFile(
        configPath,
        JSON.stringify({
            version: 1,
            sourceSet: 'fixture-cutover',
            gateway: {
                source: {
                    host: '127.0.0.1',
                    database: 'root_dump',
                    user: 'migration_reader',
                    passwordFile: './mysql-password',
                },
                targetUrlEnv: 'TEST_GATEWAY_DATABASE_URL',
            },
        }),
        { mode }
    );
    await chmod(configPath, mode);
    return configPath;
};

describe('legacy migration plan config', () => {
    it('resolves a mode-0600 structured source without placing its password in arguments', async () => {
        process.env.TEST_GATEWAY_DATABASE_URL = 'postgresql://target@127.0.0.1/gateway';
        const plan = await loadMigrationPlan(await writeFixture());
        const source = new URL(plan.stages[0]!.sourceUrl);

        expect(plan.sourceSet).toBe('fixture-cutover');
        expect(plan.stages.map((stage) => stage.name)).toEqual(['gateway']);
        expect(source.hostname).toBe('127.0.0.1');
        expect(source.username).toBe('migration_reader');
        expect(source.password).toBe('secret-value');
        expect(plan.stages[0]!.sourceIdentity.key).toBe('fixture-cutover:gateway');
    });

    it('rejects a config readable by group or other users', async () => {
        process.env.TEST_GATEWAY_DATABASE_URL = 'postgresql://target@127.0.0.1/gateway';
        await expect(loadMigrationPlan(await writeFixture(0o644))).rejects.toThrow('expected mode 0600');
    });
});
