import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createGamePostgresConnector } from '@sammo-ts/infra';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.PROFILE_SEED_CLI_DATABASE_URL;
const describeDatabase = describe.runIf(Boolean(databaseUrl));
const workspaceRoot = path.resolve(process.cwd(), '../..');

const runSeedCli = async (requestFile: string): Promise<{ code: number | null; output: string }> =>
    new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(workspaceRoot, 'app/gateway-api/dist/index.js')], {
            cwd: workspaceRoot,
            env: {
                ...process.env,
                DATABASE_URL: databaseUrl,
                GATEWAY_ROLE: 'profile-seed',
                PROFILE_SEED_REQUEST_FILE: requestFile,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (chunk) => {
            output += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            output += chunk.toString();
        });
        child.on('close', (code) => resolve({ code, output }));
    });

describeDatabase('selected workspace profile seed CLI', () => {
    it('seeds through the built gateway artifact with the serialized operation identity', async () => {
        if (!databaseUrl) {
            throw new Error('PROFILE_SEED_CLI_DATABASE_URL is required.');
        }
        const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-seed-cli-test-'));
        const requestFile = path.join(tempDirectory, 'request.json');
        const connector = createGamePostgresConnector({ url: databaseUrl });
        try {
            await connector.connect();
            const completedGameCount = await connector.prisma.gameHistory.count({ where: { status: 'COMPLETED' } });
            await fs.writeFile(
                requestFile,
                JSON.stringify({
                    scenarioId: 1010,
                    tickSeconds: 60,
                    now: '2036-03-03T00:00:00.000Z',
                    installOptions: {
                        serverId: 'selected-cli-seed',
                        firstGameIdx: 0,
                        installOperationId: 'selected-cli-operation',
                        installCommitSha: 'selected-cli-commit',
                    },
                    adminUser: {
                        id: 'selected-cli-admin',
                        username: 'selected-cli-admin',
                        displayName: '선택 CLI 관리자',
                    },
                }),
                { encoding: 'utf8', mode: 0o600 }
            );

            const result = await runSeedCli(requestFile);
            expect(result, result.output).toMatchObject({ code: 0 });
            const world = await connector.prisma.worldState.findFirstOrThrow();
            expect(world).toMatchObject({
                scenarioCode: '1010',
                meta: {
                    firstGameIdx: 0,
                    gameIdx: completedGameCount,
                    installOperationId: 'selected-cli-operation',
                    installCommitSha: 'selected-cli-commit',
                },
            });
            const adminGeneral = await connector.prisma.general.findFirstOrThrow({
                where: { userId: 'selected-cli-admin' },
            });
            expect(adminGeneral).toMatchObject({ meta: { createdBy: 'admin-seed' } });
            const history = await connector.prisma.gameHistory.findUniqueOrThrow({
                where: { serverId: 'selected-cli-seed' },
            });

            const retry = await runSeedCli(requestFile);
            expect(retry, retry.output).toMatchObject({ code: 0 });
            await expect(connector.prisma.worldState.findFirstOrThrow()).resolves.toEqual(world);
            await expect(
                connector.prisma.general.findFirstOrThrow({ where: { userId: 'selected-cli-admin' } })
            ).resolves.toEqual(adminGeneral);
            await expect(
                connector.prisma.gameHistory.findUniqueOrThrow({ where: { serverId: 'selected-cli-seed' } })
            ).resolves.toEqual(history);
            await expect(
                connector.prisma.gameHistory.count({ where: { serverId: 'selected-cli-seed' } })
            ).resolves.toBe(1);
        } finally {
            await connector.prisma.gameHistory.deleteMany({ where: { serverId: 'selected-cli-seed' } });
            await connector.disconnect();
            await fs.rm(tempDirectory, { recursive: true, force: true });
        }
    });
});
