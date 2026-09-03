import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createGatewayPostgresConnector, type GatewayPrismaClient } from '@sammo-ts/infra';

import { createGatewayAdminActionConsumer } from '../src/turn/gatewayAdminActions.js';
import { createGatewayProfileGate } from '../src/turn/gatewayProfileGate.js';

const databaseUrl = process.env.GATEWAY_RUNTIME_ACTION_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const profileName = 'runtime:consumer-integration';
const actionId = '924f40ec-e9d2-432f-9867-e9fb3199f14a';

const assertDedicatedSchema = (): void => {
    const expected = process.env.GATEWAY_RUNTIME_INTEGRATION_SCHEMA;
    const actual = databaseUrl ? new URL(databaseUrl).searchParams.get('schema') : null;
    if (!expected || !expected.endsWith('_gateway_runtime_integration') || actual !== expected) {
        throw new Error('Refusing to mutate a Gateway database outside the runner-owned integration schema.');
    }
};

const waitForApplied = async (db: GatewayPrismaClient): Promise<void> => {
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
        const action = await db.gatewayRuntimeAction.findUnique({
            where: { id: actionId },
            select: { status: true },
        });
        if (action?.status === 'APPLIED') {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('gateway runtime action did not reach APPLIED');
};

integration('gateway runtime action consumer', () => {
    let db: GatewayPrismaClient;
    let closeDb: (() => Promise<void>) | undefined;
    let initialized = false;

    beforeAll(async () => {
        assertDedicatedSchema();
        const connector = createGatewayPostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        initialized = true;
        closeDb = () => connector.disconnect();
        await db.gatewayProfile.upsert({
            where: { profileName },
            update: { status: 'RUNNING' },
            create: {
                profileName,
                profile: 'runtime',
                instanceKey: 'consumer-integration',
                currentScenario: 'consumer-integration',
                scenario: 'consumer-integration',
                apiPort: 15998,
                status: 'RUNNING',
            },
        });
        await db.gatewayRuntimeAction.deleteMany({ where: { profileName } });
    });

    afterAll(async () => {
        if (initialized) {
            await db.gatewayRuntimeAction.deleteMany({ where: { profileName } });
            await db.gatewayProfile.deleteMany({ where: { profileName } });
        }
        await closeDb?.();
    });

    it('backs off a partial projection and publishes one terminal callback', async () => {
        await db.gatewayRuntimeAction.create({
            data: {
                id: actionId,
                profileName,
                action: 'ACCELERATE',
                durationMinutes: 15,
                requestedBy: 'integration-admin',
            },
        });
        const handler = vi
            .fn()
            .mockResolvedValueOnce({ status: 'PARTIAL', detail: 'redis unavailable' })
            .mockResolvedValue({ status: 'APPLIED', detail: 'projection complete' });
        const onActionApplied = vi.fn(async () => {});
        const consumer = await createGatewayAdminActionConsumer({
            databaseUrl: databaseUrl!,
            gatewayDatabaseUrl: databaseUrl!,
            profileName,
            pollIntervalMs: 10,
            handler,
            onActionApplied,
        });

        consumer.start();
        try {
            await waitForApplied(db);
        } finally {
            await consumer.stop();
        }

        expect(await db.gatewayRuntimeAction.findUniqueOrThrow({ where: { id: actionId } })).toMatchObject({
            status: 'APPLIED',
            attempts: 2,
            nextAttemptAt: null,
            detail: 'projection complete',
            handler: 'turn-daemon',
        });
        expect(handler).toHaveBeenCalledTimes(2);
        expect(onActionApplied).toHaveBeenCalledTimes(1);
    });

    it('does not overwrite a terminal operator status while reporting a daemon error', async () => {
        const gate = await createGatewayProfileGate({
            databaseUrl: databaseUrl!,
            gatewayDatabaseUrl: databaseUrl!,
            profileName,
        });
        try {
            await db.gatewayProfile.update({
                where: { profileName },
                data: { status: 'RUNNING', lastError: null },
            });
            await gate.markPaused(new Error('running failure'));
            expect(await db.gatewayProfile.findUniqueOrThrow({ where: { profileName } })).toMatchObject({
                status: 'PAUSED',
                lastError: 'running failure',
            });

            await db.gatewayProfile.update({
                where: { profileName },
                data: { status: 'STOPPED', lastError: null },
            });
            await gate.markPaused(new Error('late shutdown failure'));
            expect(await db.gatewayProfile.findUniqueOrThrow({ where: { profileName } })).toMatchObject({
                status: 'STOPPED',
                lastError: null,
            });
        } finally {
            await gate.close();
        }
    });
});
