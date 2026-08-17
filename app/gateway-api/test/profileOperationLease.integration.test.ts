import { createGatewayPostgresConnector } from '@sammo-ts/infra';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createGatewayReleaseRepository } from '../src/orchestrator/gatewayReleaseRepository.js';
import { createGatewayProfileRepository } from '../src/orchestrator/profileRepository.js';

const databaseUrl = process.env.GATEWAY_OPERATION_DATABASE_URL;
const describeDatabase = describe.runIf(Boolean(databaseUrl));
const profileName = 'lease-test:1010';
const secondProfileName = 'lease-test-2:1010';

describeDatabase('gateway operation lease and profile serialization', () => {
    const connector = createGatewayPostgresConnector({ url: databaseUrl ?? '' });
    const repository = createGatewayProfileRepository(connector.prisma);
    const releaseRepository = createGatewayReleaseRepository(connector.prisma);

    beforeAll(async () => {
        await connector.connect();
        await repository.upsertProfile({
            profile: 'lease-test',
            scenario: '1010',
            apiPort: 15999,
            status: 'STOPPED',
        });
        await repository.upsertProfile({
            profile: 'lease-test-2',
            scenario: '1010',
            apiPort: 15998,
            status: 'STOPPED',
        });
    });

    afterEach(async () => {
        await connector.prisma.gatewayReleaseOperation.deleteMany();
        await connector.prisma.gatewayReleaseState.deleteMany();
        await connector.prisma.gatewayOperation.deleteMany({
            where: { profileName: { in: [profileName, secondProfileName] } },
        });
        await connector.prisma.gatewayProfile.updateMany({
            where: { profileName: { in: [profileName, secondProfileName] } },
            data: { buildStatus: 'IDLE', buildError: null },
        });
    });

    afterAll(async () => {
        await connector.prisma.gatewayOperation.deleteMany({
            where: { profileName: { in: [profileName, secondProfileName] } },
        });
        await connector.prisma.gatewayProfile.deleteMany({
            where: { profileName: { in: [profileName, secondProfileName] } },
        });
        await connector.disconnect();
    });

    it('allows only one queued or running operation for a profile', async () => {
        const results = await Promise.allSettled([
            repository.createOperation({
                profileName,
                type: 'RESET',
                sourceMode: 'BRANCH',
                sourceRef: 'main',
                requestedBy: 'admin-a',
            }),
            repository.createOperation({
                profileName,
                type: 'STOP',
                requestedBy: 'admin-b',
            }),
        ]);

        expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
        await expect(repository.listOperations({ profileName })).resolves.toHaveLength(1);
    });

    it('stores durable cursor logs for profile operations', async () => {
        const operation = await repository.createOperation({
            profileName,
            type: 'DEPLOY',
            sourceMode: 'BRANCH',
            sourceRef: 'main',
            requestedBy: 'admin-a',
        });

        const queued = await repository.listOperationLogs(operation.id);
        expect(queued).toHaveLength(1);
        expect(queued[0]).toMatchObject({ phase: 'queue', level: 'INFO' });

        const build = await repository.appendOperationLog(operation.id, {
            level: 'OUTPUT',
            phase: 'build',
            message: 'game-frontend build complete',
        });
        await expect(repository.listOperationLogs(operation.id, queued[0]?.cursor)).resolves.toEqual([build]);
        await expect(repository.listOperationLogs(operation.id, build.cursor)).resolves.toEqual([]);
    });

    it('serializes running operations globally across profiles', async () => {
        const first = await repository.createOperation({
            profileName,
            type: 'STOP',
            requestedBy: 'admin-a',
        });
        const second = await repository.createOperation({
            profileName: secondProfileName,
            type: 'START',
            requestedBy: 'admin-b',
        });
        const now = new Date('2030-01-01T00:00:00.000Z');
        await expect(
            repository.claimNextOperation(now, { ownerId: 'worker-a', durationMs: 1_000 })
        ).resolves.toMatchObject({ id: first.id, leaseOwner: 'worker-a' });
        await expect(
            repository.claimNextOperation(now, { ownerId: 'worker-b', durationMs: 1_000 })
        ).resolves.toBeNull();
        await repository.completeOperation(first.id, 'SUCCEEDED', { error: null }, 'worker-a');
        await expect(
            repository.claimNextOperation(now, { ownerId: 'worker-b', durationMs: 1_000 })
        ).resolves.toMatchObject({ id: second.id, leaseOwner: 'worker-b' });
    });

    it('serializes profile and Gateway release claims under one control-plane lock', async () => {
        const profileOperation = await repository.createOperation({
            profileName,
            type: 'RESET',
            sourceMode: 'COMMIT',
            sourceRef: 'a'.repeat(40),
            requestedBy: 'profile-admin',
        });
        const releaseOperation = await releaseRepository.createOperation({
            type: 'DEPLOY',
            sourceMode: 'COMMIT',
            sourceRef: 'b'.repeat(40),
            requestedBy: 'release-admin',
        });
        const now = new Date('2030-01-01T00:00:00.000Z');

        const [profileClaim, releaseClaim] = await Promise.all([
            repository.claimNextOperation(now, { ownerId: 'profile-worker', durationMs: 1_000 }),
            releaseRepository.claimNextOperation(now, { ownerId: 'release-worker', durationMs: 1_000 }),
        ]);

        expect([profileClaim, releaseClaim].filter(Boolean)).toHaveLength(1);
        if (profileClaim) {
            expect(profileClaim.id).toBe(profileOperation.id);
            expect(releaseClaim).toBeNull();
            await repository.completeOperation(profileOperation.id, 'SUCCEEDED', { error: null }, 'profile-worker');
            await expect(
                releaseRepository.claimNextOperation(now, { ownerId: 'release-worker', durationMs: 1_000 })
            ).resolves.toMatchObject({ id: releaseOperation.id });
            return;
        }

        expect(releaseClaim?.id).toBe(releaseOperation.id);
        await releaseRepository.completeOperation(releaseOperation.id, 'SUCCEEDED', { error: null }, 'release-worker');
        await expect(
            repository.claimNextOperation(now, { ownerId: 'profile-worker', durationMs: 1_000 })
        ).resolves.toMatchObject({ id: profileOperation.id });
    });

    it('does not let a future queued operation suppress runtime reconciliation early', async () => {
        const now = new Date('2030-01-01T00:00:00.000Z');
        await repository.createOperation({
            profileName,
            type: 'RESET',
            sourceMode: 'COMMIT',
            sourceRef: 'abcdef',
            scheduledAt: new Date(now.getTime() + 60_000).toISOString(),
            requestedBy: 'admin',
        });

        await expect(repository.listActiveOperationProfileNames?.(now)).resolves.not.toContain(profileName);
        await expect(repository.listActiveOperationProfileNames?.(new Date(now.getTime() + 60_000))).resolves.toContain(
            profileName
        );
    });

    it('reclaims the same expired RUNNING operation without creating a second generation', async () => {
        const operation = await repository.createOperation({
            profileName,
            type: 'RESET',
            sourceMode: 'COMMIT',
            sourceRef: 'abcdef',
            payload: { install: { scenarioId: 1010 } },
            requestedBy: 'admin',
        });
        const startedAt = new Date('2030-01-01T00:00:00.000Z');
        const firstClaim = await repository.claimNextOperation(startedAt, {
            ownerId: 'worker-a',
            durationMs: 1_000,
        });
        expect(firstClaim).toMatchObject({ id: operation.id, attempts: 1, leaseOwner: 'worker-a' });
        await expect(
            repository.pinOperationResolvedCommit?.(operation.id, 'worker-a', 'pinned-commit-a')
        ).resolves.toBe(true);

        await expect(
            repository.claimNextOperation(new Date(startedAt.getTime() + 999), {
                ownerId: 'worker-b',
                durationMs: 1_000,
            })
        ).resolves.toBeNull();
        const reclaimed = await repository.claimNextOperation(new Date(startedAt.getTime() + 1_001), {
            ownerId: 'worker-b',
            durationMs: 1_000,
        });
        expect(reclaimed).toMatchObject({
            id: operation.id,
            attempts: 2,
            leaseOwner: 'worker-b',
            resolvedCommitSha: 'pinned-commit-a',
        });
        await expect(
            repository.pinOperationResolvedCommit?.(operation.id, 'worker-a', 'pinned-commit-a')
        ).resolves.toBe(false);
        await expect(
            repository.pinOperationResolvedCommit?.(operation.id, 'worker-b', 'pinned-commit-b')
        ).resolves.toBe(false);
        await expect(
            repository.updateProfileForOperation?.(operation.id, 'worker-b', profileName, {
                buildStatus: 'RUNNING',
                buildError: 'worker-b-marker',
            })
        ).resolves.toMatchObject({ buildStatus: 'RUNNING', buildError: 'worker-b-marker' });
        await expect(
            repository.updateProfileForOperation?.(operation.id, 'worker-a', profileName, {
                buildStatus: 'FAILED',
                buildError: 'stale-worker-a',
            })
        ).resolves.toBeNull();
        await expect(repository.getProfile(profileName)).resolves.toMatchObject({
            buildStatus: 'RUNNING',
            buildError: 'worker-b-marker',
        });
        await expect(repository.renewOperationLease?.(operation.id, 'worker-a', startedAt, 1_000)).resolves.toBe(false);
        await expect(repository.renewOperationLease?.(operation.id, 'worker-b', startedAt, 1_000)).resolves.toBe(true);
        await expect(
            repository.completeOperation(operation.id, 'FAILED', { error: 'stale worker' }, 'worker-a')
        ).rejects.toThrow('Operation lease lost before completion');
        await expect(repository.getOperation(operation.id)).resolves.toMatchObject({
            status: 'RUNNING',
            leaseOwner: 'worker-b',
        });
        await expect(repository.requeueOperation(operation.id, 'stale worker', undefined, 'worker-a')).rejects.toThrow(
            'Operation lease lost before requeue'
        );
        await expect(
            repository.completeOperation(operation.id, 'SUCCEEDED', { error: null }, 'worker-b')
        ).resolves.toMatchObject({ status: 'SUCCEEDED' });
    });

    it('pins retry to the first resolved commit and preserves its install generation', async () => {
        const operation = await repository.createOperation({
            profileName,
            type: 'RESET',
            sourceMode: 'BRANCH',
            sourceRef: 'main',
            payload: { install: { scenarioId: 1010 } },
            requestedBy: 'admin-a',
        });
        const claimed = await repository.claimNextOperation(new Date('2030-01-01T00:00:00.000Z'), {
            ownerId: 'worker-a',
            durationMs: 1_000,
        });
        expect(claimed?.id).toBe(operation.id);
        await repository.completeOperation(
            operation.id,
            'FAILED',
            {
                resolvedCommitSha: 'abcdef0123456789abcdef0123456789abcdef01',
                error: 'injected start failure',
            },
            'worker-a'
        );

        const retry = await repository.retryOperation(operation.id, 'admin-b');
        expect(retry).toMatchObject({
            sourceMode: 'COMMIT',
            sourceRef: 'abcdef0123456789abcdef0123456789abcdef01',
            payload: {
                installOperationId: operation.id,
                install: { scenarioId: 1010 },
            },
        });
    });
});
