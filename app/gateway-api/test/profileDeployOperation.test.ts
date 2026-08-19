import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { GatewayOrchestrator } from '../src/orchestrator/gatewayOrchestrator.js';
import type { BuildCommand } from '../src/orchestrator/buildRunner.js';
import type { ProcessManager } from '../src/orchestrator/processManager.js';
import type {
    GatewayClaimedProfileUpdate,
    GatewayOperationRecord,
    GatewayProfileRecord,
    GatewayProfileRepository,
} from '../src/orchestrator/profileRepository.js';
import type { GitWorkspaceManager } from '../src/orchestrator/workspaceManager.js';

const SHA = '1111111111111111111111111111111111111111';
const temporaryDirectories: string[] = [];

const createReleaseWorkspace = async (): Promise<string> => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-profile-deploy-'));
    temporaryDirectories.push(workspace);
    await fs.mkdir(path.join(workspace, 'packages/infra/prisma/gateway-migrations/20260801000000_gateway'), {
        recursive: true,
    });
    await fs.mkdir(path.join(workspace, 'packages/infra/prisma/migrations/20260801000000_game'), {
        recursive: true,
    });
    await fs.writeFile(
        path.join(workspace, 'release-manifest.json'),
        JSON.stringify({
            formatVersion: 1,
            controllerProtocol: 1,
            gatewaySchemaHead: '20260801000000_gateway',
            gameSchemaHead: '20260801000000_game',
            components: ['game-api', 'game-engine', 'game-frontend'],
        })
    );
    return workspace;
};

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })));
});

describe('profile DEPLOY operation', () => {
    it('migrates and switches the selected release without executing the reset seed path', async () => {
        const workspace = await createReleaseWorkspace();
        const profile: GatewayProfileRecord = {
            profileName: 'che:1010',
            profile: 'che',
            instanceKey: '1010',
            currentScenario: '1010',
            scenario: '1010',
            apiPort: 15003,
            status: 'RUNNING',
            buildStatus: 'SUCCEEDED',
            buildCommitSha: '2222222222222222222222222222222222222222',
            buildWorkspace: '/srv/sammo/old',
            meta: {},
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
        };
        const operation: GatewayOperationRecord = {
            id: '33333333-3333-4333-8333-333333333333',
            profileName: profile.profileName,
            type: 'DEPLOY',
            status: 'RUNNING',
            sourceMode: 'COMMIT',
            sourceRef: SHA,
            payload: {},
            requestedBy: 'admin',
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
        };
        let nextOperation: GatewayOperationRecord | null = operation;
        const patches: GatewayClaimedProfileUpdate[] = [];
        const completions: string[] = [];
        const logs: Array<{ phase: string; message: string; level: string }> = [];
        const repository: GatewayProfileRepository = {
            listProfiles: async () => [profile],
            getProfile: async () => profile,
            upsertProfile: async () => profile,
            updateCurrentScenario: async () => profile,
            updateStatus: async () => profile,
            updateBuildStatus: async () => profile,
            updateMeta: async () => profile,
            listReservedToStart: async () => [],
            findQueuedBuild: async () => null,
            updateLastError: async () => {},
            updateWorkspaceUsage: async () => {},
            clearWorkspaceUsage: async () => {},
            listOperations: async () => [],
            getOperation: async () => operation,
            listOperationLogs: async () => [],
            appendOperationLog: async (operationId, input) => {
                logs.push(input);
                return {
                    cursor: String(logs.length),
                    operationId,
                    createdAt: '2026-08-11T00:00:00.000Z',
                    ...input,
                };
            },
            createOperation: async () => operation,
            claimNextOperation: async () => {
                const value = nextOperation;
                nextOperation = null;
                return value;
            },
            renewOperationLease: async () => true,
            pinOperationResolvedCommit: async () => true,
            updateProfileForOperation: async (_id, _owner, _profileName, patch) => {
                patches.push(patch);
                return { ...profile, ...patch } as GatewayProfileRecord;
            },
            completeOperation: async (_id, status) => {
                completions.push(status);
                return { ...operation, status };
            },
            requeueOperation: async () => operation,
            cancelOperation: async () => false,
            retryOperation: async () => null,
        };
        const processNames = [
            'sammo:che:1010:game-frontend',
            'sammo:che:1010:game-api',
            'sammo:che:1010:turn-daemon',
            'sammo:che:1010:auction-worker',
            'sammo:che:1010:battle-sim-worker',
            'sammo:che:1010:tournament-worker',
        ];
        const running = new Set(processNames);
        const processManager: ProcessManager = {
            list: async () => [...running].map((name) => ({ name, status: 'online' })),
            start: async (definition) => {
                running.add(definition.name);
            },
            stop: async () => {},
            delete: async (name) => {
                running.delete(name);
            },
        };
        const commandGroups: BuildCommand[][] = [];
        const workspaceManager = {
            resolveCommit: async () => SHA,
            prepare: async () => ({ root: workspace, created: true, needsInstall: true }),
        } as unknown as GitWorkspaceManager;
        const orchestrator = new GatewayOrchestrator({
            repository,
            processManager,
            buildRunner: {
                run: async (commands, onProgress) => {
                    commandGroups.push(commands);
                    for (const command of commands) {
                        await onProgress?.({ type: 'COMMAND_START', command });
                        await onProgress?.({
                            type: 'OUTPUT',
                            stream: 'stdout',
                            message: 'built profile with postgresql://user:pass@integration.invalid/sammo',
                        });
                        await onProgress?.({ type: 'COMMAND_END', command, exitCode: 0 });
                    }
                    return { ok: true, exitCode: 0, output: '' };
                },
            },
            workspaceManager,
            processConfig: {
                workspaceRoot: '/srv/sammo/controller',
                redisKeyPrefix: 'sammo:test',
                gameTokenSecret: 'test-secret',
                gatewayInternalApiUrl: 'http://127.0.0.1:15001',
                baseEnv: { DATABASE_URL: 'postgresql://user:pass@integration.invalid/sammo' },
            },
            reconcileIntervalMs: 60_000,
            scheduleIntervalMs: 60_000,
            buildIntervalMs: 60_000,
            adminActionIntervalMs: 60_000,
            profileReadinessTimeoutMs: 10,
            fetchImpl: async () => new Response('', { status: 200 }),
        });

        await orchestrator.runOperationsNow();

        expect(commandGroups).toHaveLength(2);
        expect(commandGroups[0]?.[0]?.args).toEqual(['install', '--frozen-lockfile']);
        expect(commandGroups[0]?.[1]?.args).toContain('--filter=@sammo-ts/game-api');
        expect(commandGroups[0]?.[1]?.args).not.toContain('--filter=@sammo-ts/gateway-api');
        expect(commandGroups[0]?.[2]?.args).toContain('build:release');
        expect(commandGroups[0]?.[2]?.args).toContain('--cache-dir=/srv/sammo/controller/.turbo/release-cache');
        expect(commandGroups[0]?.[2]?.args).toContain('--concurrency=1');
        expect(commandGroups[0]?.[3]?.args).toEqual([
            'tools/build-scripts/materialize-profile-frontend.mjs',
            'che:1010',
        ]);
        expect(commandGroups[1]?.map((command) => command.args)).toEqual([
            ['--filter', '@sammo-ts/infra', 'prisma:migrate:deploy:game'],
        ]);
        expect(commandGroups.flat().some((command) => command.env?.GATEWAY_ROLE === 'profile-seed')).toBe(false);
        expect(patches.at(-1)).toMatchObject({
            buildStatus: 'SUCCEEDED',
            buildCommitSha: SHA,
            buildWorkspace: workspace,
            meta: { releaseSource: { mode: 'COMMIT', ref: SHA } },
        });
        expect(completions).toEqual(['SUCCEEDED']);
        expect(logs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ phase: 'resolve', message: `대상 커밋을 ${SHA}로 고정했습니다.` }),
                expect.objectContaining({ phase: 'build', level: 'OUTPUT' }),
                expect.objectContaining({ phase: 'migration', level: 'OUTPUT' }),
                expect.objectContaining({ phase: 'readiness', message: 'profile readiness 확인을 통과했습니다.' }),
                expect.objectContaining({ phase: 'complete', message: 'DB 보존 버전 업데이트가 완료되었습니다.' }),
            ])
        );
        expect(logs.map((entry) => entry.message).join('\n')).not.toContain('pass@integration.invalid');
        expect(logs.map((entry) => entry.message).join('\n')).toContain('[REDACTED]');
        expect([...running].sort()).toEqual([...processNames].sort());
    });
});
