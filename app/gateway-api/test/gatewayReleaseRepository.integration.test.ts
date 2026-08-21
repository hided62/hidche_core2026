import { createGatewayPostgresConnector } from '@sammo-ts/infra';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createGatewayReleaseRepository } from '../src/orchestrator/gatewayReleaseRepository.js';

const databaseUrl = process.env.GATEWAY_RELEASE_DATABASE_URL;
const describeDatabase = describe.runIf(Boolean(databaseUrl));

describeDatabase('gateway release operation persistence', () => {
    const connector = createGatewayPostgresConnector({ url: databaseUrl ?? '' });
    const repository = createGatewayReleaseRepository(connector.prisma);

    beforeAll(async () => {
        await connector.connect();
    });

    afterEach(async () => {
        await connector.prisma.gatewayReleaseOperation.deleteMany();
        await connector.prisma.gatewayReleaseState.deleteMany();
    });

    afterAll(async () => {
        await connector.disconnect();
    });

    it('serializes releases, fences publication by lease owner, and records rollback state', async () => {
        const operation = await repository.createOperation({
            type: 'DEPLOY',
            sourceMode: 'BRANCH',
            sourceRef: 'main',
            requestedBy: 'admin-a',
        });
        await expect(
            repository.createOperation({
                type: 'ROLLBACK',
                sourceMode: 'COMMIT',
                sourceRef: '2222222222222222222222222222222222222222',
                requestedBy: 'admin-b',
            })
        ).rejects.toMatchObject({ code: 'P2002' });

        const now = new Date('2030-01-01T00:00:00.000Z');
        await expect(
            repository.claimNextOperation(now, { ownerId: 'controller-a', durationMs: 1_000 })
        ).resolves.toMatchObject({
            id: operation.id,
            attempts: 1,
            leaseOwner: 'controller-a',
        });
        await expect(repository.pinOperationResolvedCommit(operation.id, 'controller-a', 'a'.repeat(40))).resolves.toBe(
            true
        );
        const firstLog = await repository.appendOperationLog(operation.id, {
            level: 'INFO',
            phase: 'build',
            message: 'build started',
        });
        const secondLog = await repository.appendOperationLog(operation.id, {
            level: 'OUTPUT',
            phase: 'build',
            message: 'gateway-api build complete',
        });
        await expect(repository.listOperationLogs(operation.id, firstLog.cursor)).resolves.toEqual([secondLog]);
        await expect(
            repository.publishRelease(operation.id, 'stale-controller', {
                commitSha: 'a'.repeat(40),
                workspace: '/srv/sammo/new',
            })
        ).rejects.toThrow('lease lost before publish');

        await expect(
            repository.publishRelease(operation.id, 'controller-a', {
                commitSha: 'a'.repeat(40),
                workspace: '/srv/sammo/new',
                previousCommitSha: 'b'.repeat(40),
                previousWorkspace: '/srv/sammo/old',
            })
        ).resolves.toMatchObject({
            activeCommitSha: 'a'.repeat(40),
            activeWorkspace: '/srv/sammo/new',
            previousCommitSha: 'b'.repeat(40),
            previousWorkspace: '/srv/sammo/old',
        });
        await expect(
            repository.completeOperation(
                operation.id,
                'SUCCEEDED',
                { resolvedCommitSha: 'a'.repeat(40), error: null },
                'controller-a'
            )
        ).resolves.toMatchObject({ status: 'SUCCEEDED' });
    });

    it('reclaims an expired release while preserving its pinned commit', async () => {
        const operation = await repository.createOperation({
            type: 'DEPLOY',
            sourceMode: 'BRANCH',
            sourceRef: 'main',
            requestedBy: 'admin',
        });
        const now = new Date('2030-01-01T00:00:00.000Z');
        await repository.claimNextOperation(now, { ownerId: 'controller-a', durationMs: 1_000 });
        await repository.pinOperationResolvedCommit(operation.id, 'controller-a', 'c'.repeat(40));

        await expect(
            repository.claimNextOperation(new Date(now.getTime() + 1_001), {
                ownerId: 'controller-b',
                durationMs: 1_000,
            })
        ).resolves.toMatchObject({
            id: operation.id,
            attempts: 2,
            leaseOwner: 'controller-b',
            resolvedCommitSha: 'c'.repeat(40),
        });
        await expect(repository.renewOperationLease(operation.id, 'controller-a', now, 1_000)).resolves.toBe(false);
    });

    it('stores direct SQL defaults as the same instant in a Seoul database session', async () => {
        const operationId = randomUUID();
        const beforeInsert = Date.now();
        const [session] = await connector.prisma.$queryRaw<Array<{ timezone: string }>>`
            SELECT current_setting('TimeZone') AS "timezone"
        `;
        expect(session?.timezone).toBe('UTC');
        await connector.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SET LOCAL TIME ZONE 'Asia/Seoul'`;
            await tx.$executeRaw`
                INSERT INTO "gateway_release_operation" (
                    "id", "type", "status", "source_mode", "source_ref", "payload",
                    "requested_by", "attempts", "updated_at"
                ) VALUES (
                    ${operationId}, 'DEPLOY', 'QUEUED', 'BRANCH', 'main', '{}'::jsonb,
                    'direct-sql-test', 0, CURRENT_TIMESTAMP
                )
            `;
            await tx.$executeRaw`
                INSERT INTO "gateway_release_log" ("operation_id", "level", "phase", "message")
                VALUES (${operationId}, 'INFO', 'queue', 'direct SQL timestamp test')
            `;
        });
        const afterInsert = Date.now();

        const operation = await repository.getOperation(operationId);
        const [log] = await repository.listOperationLogs(operationId);
        expect(operation).toBeDefined();
        const createdAt = Date.parse(operation?.createdAt ?? '');
        const updatedAt = Date.parse(operation?.updatedAt ?? '');
        expect(createdAt).toBeGreaterThanOrEqual(beforeInsert);
        expect(createdAt).toBeLessThanOrEqual(afterInsert);
        expect(updatedAt).toBeGreaterThanOrEqual(beforeInsert);
        expect(updatedAt).toBeLessThanOrEqual(afterInsert);
        expect(log?.createdAt).toBe(operation?.createdAt);
    });
});
