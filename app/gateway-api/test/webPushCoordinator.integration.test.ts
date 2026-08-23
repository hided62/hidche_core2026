import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import webPush from 'web-push';

import { createGatewayPostgresConnector, type GatewayPrismaClient } from '@sammo-ts/infra';

import { WebPushCoordinator } from '../src/webPush/coordinator.js';

const databaseUrl = process.env.WEB_PUSH_GATEWAY_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const schema = process.env.WEB_PUSH_GATEWAY_INTEGRATION_SCHEMA;
const userId = '8c770c8d-3515-4f6c-8a54-5f17330d9f66';
const profileName = 'hwe:web-push-integration';

const assertDedicatedSchema = (): void => {
    const actual = databaseUrl ? new URL(databaseUrl).searchParams.get('schema') : null;
    if (!schema?.endsWith('_web_push_integration') || actual !== schema) {
        throw new Error('Refusing to mutate a Gateway database outside the web-push integration schema.');
    }
};

integration('web push Gateway persistence boundary', () => {
    let db: GatewayPrismaClient;
    let closeDb: (() => Promise<void>) | undefined;
    let coordinator: WebPushCoordinator;

    beforeAll(async () => {
        assertDedicatedSchema();
        const connector = createGatewayPostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.webPushEventReceipt.deleteMany({ where: { profileName } });
        await db.webPushProfileCursor.deleteMany({ where: { profileName } });
        await db.gatewayProfile.deleteMany({ where: { profileName } });
        await db.appUser.deleteMany({ where: { id: userId } });
        await db.appUser.create({
            data: {
                id: userId,
                loginId: 'web-push-integration',
                displayName: '웹 푸시 통합',
                passwordHash: 'not-used',
                passwordSalt: 'not-used',
                roles: ['user'],
                sanctions: {},
            },
        });
        await db.gatewayProfile.create({
            data: {
                profileName,
                profile: 'hwe',
                instanceKey: 'web-push-integration',
                currentScenario: 'default',
                scenario: 'default',
                apiPort: 15015,
                status: 'RESERVED',
            },
        });
        await db.webPushSubscription.create({
            data: {
                userId,
                endpoint: 'https://push.example.invalid/subscription/integration',
                p256dh: 'public-key-placeholder',
                auth: 'auth-placeholder',
            },
        });
        const vapid = webPush.generateVAPIDKeys();
        coordinator = new WebPushCoordinator(db, {
            enabled: true,
            vapidSubject: 'mailto:web-push-test@example.invalid',
            vapidPublicKey: vapid.publicKey,
            vapidPrivateKey: vapid.privateKey,
        });
    });

    afterAll(async () => {
        if (db) {
            await db.webPushEventReceipt.deleteMany({ where: { profileName } });
            await db.webPushProfileCursor.deleteMany({ where: { profileName } });
            await db.gatewayProfile.deleteMany({ where: { profileName } });
            await db.appUser.deleteMany({ where: { id: userId } });
        }
        await closeDb?.();
    });

    it('fans out an enabled private-message event once without persisting its content', async () => {
        await coordinator.setPreference(userId, {
            profileName,
            eventType: 'PRIVATE_MESSAGE_RECEIVED',
            enabled: true,
        });
        const event = {
            version: 1 as const,
            eventId: 'integration:private-message:1',
            eventType: 'PRIVATE_MESSAGE_RECEIVED' as const,
            profileName,
            userIds: [userId],
            occurredAt: '2026-08-23T00:00:00.000Z',
        };
        await expect(coordinator.ingest(event)).resolves.toEqual({ queued: true });
        await expect(coordinator.ingest(event)).resolves.toEqual({ queued: false });

        const notifications = await db.webPushNotification.findMany({
            where: { profileName, eventType: 'PRIVATE_MESSAGE_RECEIVED' },
            include: { deliveries: true },
        });
        expect(notifications).toHaveLength(1);
        expect(notifications[0]).toMatchObject({
            userId,
            title: '새 개인 서신',
            url: '/hwe/',
            deliveries: [expect.objectContaining({ status: 'PENDING' })],
        });
        expect(
            JSON.stringify(notifications.map(({ title, body, url, tag }) => ({ title, body, url, tag })))
        ).not.toContain('private message content');
    });

    it('matches a target-date preference and records profile lifecycle transitions', async () => {
        await coordinator.setPreference(userId, {
            profileName,
            eventType: 'TARGET_DATE_REACHED',
            enabled: true,
            targetYear: 201,
            targetMonth: 3,
        });
        await coordinator.setPreference(userId, {
            profileName,
            eventType: 'PROFILE_PREOPENED',
            enabled: true,
        });
        await coordinator.ingest({
            version: 1,
            eventId: 'integration:calendar:201:3',
            eventType: 'TARGET_DATE_REACHED',
            profileName,
            userIds: [],
            year: 201,
            month: 3,
            occurredAt: '2026-08-23T00:00:00.000Z',
        });
        await coordinator.reconcileProfiles(new Date('2026-08-23T00:00:00.000Z'));
        await db.gatewayProfile.update({ where: { profileName }, data: { status: 'PREOPEN' } });
        await coordinator.reconcileProfiles(new Date('2026-08-23T00:01:00.000Z'));

        const rows = await db.webPushNotification.findMany({
            where: { profileName, eventType: { in: ['TARGET_DATE_REACHED', 'PROFILE_PREOPENED'] } },
            orderBy: { eventType: 'asc' },
        });
        expect(rows.map((row) => row.eventType).sort()).toEqual(['PROFILE_PREOPENED', 'TARGET_DATE_REACHED']);
        expect(rows.find((row) => row.eventType === 'TARGET_DATE_REACHED')?.body).toContain('201년 3월');
    });

    it('drops events while globally disabled instead of creating a future backlog', async () => {
        const disabled = new WebPushCoordinator(db, { enabled: false });
        await expect(
            disabled.ingest({
                version: 1,
                eventId: 'integration:disabled:1',
                eventType: 'PRIVATE_MESSAGE_RECEIVED',
                profileName,
                userIds: [userId],
                occurredAt: '2026-08-23T00:00:00.000Z',
            })
        ).resolves.toEqual({ queued: false });
        await expect(
            db.webPushEventReceipt.findUnique({ where: { eventId: 'integration:disabled:1' } })
        ).resolves.toBeNull();
    });
});
