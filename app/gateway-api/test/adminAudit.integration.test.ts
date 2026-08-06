import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGatewayPostgresConnector, type GatewayPrismaClient } from '@sammo-ts/infra';

import { createAdminAuditStore } from '../src/adminAudit.js';

const databaseUrl = process.env.GATEWAY_RUNTIME_ACTION_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

const assertDedicatedSchema = (): void => {
    const expected = process.env.GATEWAY_RUNTIME_INTEGRATION_SCHEMA;
    const actual = databaseUrl ? new URL(databaseUrl).searchParams.get('schema') : null;
    if (!expected || !expected.endsWith('_gateway_runtime_integration') || actual !== expected) {
        throw new Error('Refusing to mutate a Gateway database outside the runner-owned integration schema.');
    }
};

integration('administrator audit PostgreSQL store', () => {
    let db: GatewayPrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        assertDedicatedSchema();
        const connector = createGatewayPostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
    });

    afterAll(async () => {
        await closeDb?.();
    });

    it('appends and filters immutable target history', async () => {
        const audit = createAdminAuditStore(db);
        const correlationId = randomUUID();
        const targetId = randomUUID();
        await audit.append({
            correlationId,
            actorUserId: randomUUID(),
            actorUsername: 'integration-admin',
            capability: 'admin.users.manage',
            action: 'admin.users.updateSanctions',
            targetType: 'USER',
            targetId,
            reason: 'integration verification',
            outcome: 'SUCCEEDED',
            summary: { patch: { warningCount: 1 } },
        });

        await expect(audit.list({ targetType: 'USER', targetId })).resolves.toEqual([
            expect.objectContaining({
                correlationId,
                actorUsername: 'integration-admin',
                outcome: 'SUCCEEDED',
                summary: { patch: { warningCount: 1 } },
            }),
        ]);
        await expect(
            db.adminAuditEvent.update({
                where: { id: (await audit.list({ targetId }))[0]!.id },
                data: { action: 'tampered' },
            })
        ).rejects.toThrow(/append-only/);
    });
});
