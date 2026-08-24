import { randomUUID } from 'node:crypto';

import {
    WEB_PUSH_EVENT_TYPES,
    isWebPushEventType,
    type WebPushClientSubscription,
    type WebPushEventEnvelopeV1,
    type WebPushEventType,
} from '@sammo-ts/common';
import { GatewayPrisma, type GatewayPrismaClient } from '@sammo-ts/infra';
import webPush from 'web-push';

import { resolveGatewayProfileDisplayName } from '../profileOrder.js';

export interface WebPushCoordinatorConfig {
    enabled: boolean;
    vapidSubject?: string;
    vapidPublicKey?: string;
    vapidPrivateKey?: string;
    pollIntervalMs?: number;
}

type GatewayTransaction = GatewayPrisma.TransactionClient;

const profileWideEvents = new Set<WebPushEventType>([
    'PROFILE_PREOPENED',
    'PROFILE_OPEN_SCHEDULED',
    'PROFILE_OPENED',
    'TARGET_DATE_REACHED',
]);

const uniqueUserIds = (values: readonly string[]): string[] => [...new Set(values.filter(Boolean))].sort();

const copyFor = (
    eventType: WebPushEventType,
    profileLabel: string,
    year?: number,
    month?: number
): { title: string; body: string } => {
    switch (eventType) {
        case 'TROOP_ANNIHILATED':
            return { title: '병력 전멸', body: `${profileLabel}에서 내 병력이 전멸했습니다.` };
        case 'PRIVATE_MESSAGE_RECEIVED':
            return { title: '새 개인 서신', body: `${profileLabel}에 새 개인 서신이 도착했습니다.` };
        case 'AUTONOMOUS_ACTION_ENDED':
            return { title: '자율행동 종료', body: `${profileLabel}의 자율행동 기간이 끝났습니다.` };
        case 'RESERVED_TURNS_ENDED':
            return { title: '예턴 종료', body: `${profileLabel}에서 등록한 예턴이 모두 실행되었습니다.` };
        case 'PROFILE_PREOPENED':
            return { title: '서버 가오픈', body: `${profileLabel} 서버가 가오픈되었습니다.` };
        case 'PROFILE_OPEN_SCHEDULED':
            return { title: '서버 오픈 예약', body: `${profileLabel} 서버의 오픈 시간이 예약되었습니다.` };
        case 'PROFILE_OPENED':
            return { title: '서버 오픈', body: `${profileLabel} 서버가 오픈되었습니다.` };
        case 'NATION_DESTROYED':
            return { title: '국가 멸망', body: `${profileLabel}에서 내 국가가 멸망했습니다.` };
        case 'TARGET_DATE_REACHED':
            return {
                title: '설정 연월 도달',
                body:
                    year !== undefined && month !== undefined
                        ? `${profileLabel}이 ${year}년 ${month}월에 도달했습니다.`
                        : `${profileLabel}이 설정한 연월에 도달했습니다.`,
            };
    }
};

const isConfigured = (config: WebPushCoordinatorConfig): boolean =>
    Boolean(config.enabled && config.vapidSubject && config.vapidPublicKey && config.vapidPrivateKey);

export class WebPushCoordinator {
    private readonly configured: boolean;
    private readonly owner = `gateway-web-push:${process.pid}:${randomUUID()}`;
    private readonly pollIntervalMs: number;
    private timer: NodeJS.Timeout | null = null;
    private inFlight: Promise<void> | null = null;
    private nextProfileReconcileAt = 0;
    private nextPruneAt = 0;

    constructor(
        private readonly prisma: GatewayPrismaClient,
        private readonly config: WebPushCoordinatorConfig,
        private readonly onError: (error: unknown) => void = () => undefined
    ) {
        this.configured = isConfigured(config);
        this.pollIntervalMs = Math.max(250, Math.floor(config.pollIntervalMs ?? 1_000));
        if (this.configured) {
            webPush.setVapidDetails(config.vapidSubject!, config.vapidPublicKey!, config.vapidPrivateKey!);
        }
    }

    getCapability(): { enabled: boolean; publicKey: string | null } {
        return {
            enabled: this.configured,
            publicKey: this.configured ? this.config.vapidPublicKey! : null,
        };
    }

    async getAccountState(userId: string, currentEndpoint?: string) {
        const now = new Date();
        const activeSubscriptionWhere: GatewayPrisma.WebPushSubscriptionWhereInput = {
            userId,
            disabledAt: null,
            OR: [{ expirationTime: null }, { expirationTime: { gt: now } }],
        };
        const [profiles, preferences, subscriptionCount, currentSubscription] = await Promise.all([
            this.prisma.gatewayProfile.findMany({
                orderBy: [{ profile: 'asc' }, { instanceKey: 'asc' }],
                select: {
                    profileName: true,
                    profile: true,
                    instanceKey: true,
                    currentScenario: true,
                    status: true,
                    meta: true,
                },
            }),
            this.prisma.webPushPreference.findMany({
                where: { userId },
                select: {
                    profileName: true,
                    eventType: true,
                    enabled: true,
                    targetYear: true,
                    targetMonth: true,
                },
            }),
            this.prisma.webPushSubscription.count({ where: activeSubscriptionWhere }),
            currentEndpoint
                ? this.prisma.webPushSubscription.findFirst({
                      where: { ...activeSubscriptionWhere, endpoint: currentEndpoint },
                      select: { id: true },
                  })
                : Promise.resolve(null),
        ]);
        return {
            capability: this.getCapability(),
            eventTypes: WEB_PUSH_EVENT_TYPES,
            profiles: profiles.map((profile) => ({
                profileName: profile.profileName,
                profile: profile.profile,
                instanceKey: profile.instanceKey,
                displayName: resolveGatewayProfileDisplayName(
                    profile.profile,
                    profile.instanceKey,
                    (profile.meta as Record<string, unknown> | null)?.korName
                ),
                currentScenario: profile.currentScenario,
                status: String(profile.status),
            })),
            preferences: preferences.filter((preference) => isWebPushEventType(preference.eventType)),
            subscriptionCount,
            currentDeviceSubscribed: Boolean(currentSubscription),
        };
    }

    async setPreference(
        userId: string,
        input: {
            profileName: string;
            eventType: WebPushEventType;
            enabled: boolean;
            targetYear?: number | null;
            targetMonth?: number | null;
        }
    ): Promise<void> {
        const profile = await this.prisma.gatewayProfile.findUnique({
            where: { profileName: input.profileName },
            select: { profileName: true },
        });
        if (!profile) throw new Error('알림 대상 서버를 찾을 수 없습니다.');
        const isTargetDate = input.eventType === 'TARGET_DATE_REACHED';
        if (isTargetDate && input.enabled && (input.targetYear == null || input.targetMonth == null)) {
            throw new Error('도달 알림의 연도와 월을 입력해 주세요.');
        }
        await this.prisma.webPushPreference.upsert({
            where: {
                userId_profileName_eventType: {
                    userId,
                    profileName: input.profileName,
                    eventType: input.eventType,
                },
            },
            create: {
                userId,
                profileName: input.profileName,
                eventType: input.eventType,
                enabled: input.enabled,
                targetYear: isTargetDate ? (input.targetYear ?? null) : null,
                targetMonth: isTargetDate ? (input.targetMonth ?? null) : null,
            },
            update: {
                enabled: input.enabled,
                targetYear: isTargetDate ? (input.targetYear ?? null) : null,
                targetMonth: isTargetDate ? (input.targetMonth ?? null) : null,
            },
        });
    }

    async subscribe(userId: string, subscription: WebPushClientSubscription, userAgent?: string): Promise<void> {
        if (!this.configured) throw new Error('웹 알림 전송이 아직 활성화되지 않았습니다.');
        const endpointUrl = new URL(subscription.endpoint);
        if (endpointUrl.protocol !== 'https:') throw new Error('보안 연결의 Push 구독만 저장할 수 있습니다.');
        const expirationTime = subscription.expirationTime ? new Date(subscription.expirationTime) : null;
        await this.prisma.webPushSubscription.upsert({
            where: { endpoint: subscription.endpoint },
            create: {
                userId,
                endpoint: subscription.endpoint,
                p256dh: subscription.keys.p256dh,
                auth: subscription.keys.auth,
                expirationTime,
                userAgent: userAgent?.slice(0, 500),
            },
            update: {
                userId,
                p256dh: subscription.keys.p256dh,
                auth: subscription.keys.auth,
                expirationTime,
                userAgent: userAgent?.slice(0, 500),
                disabledAt: null,
                lastSeenAt: new Date(),
            },
        });
    }

    async unsubscribe(userId: string, endpoint: string): Promise<void> {
        await this.prisma.webPushSubscription.updateMany({
            where: { userId, endpoint },
            data: { disabledAt: new Date() },
        });
    }

    private async enqueueEventTx(tx: GatewayTransaction, event: WebPushEventEnvelopeV1): Promise<boolean> {
        if (!this.configured) return false;
        const profile = await tx.gatewayProfile.findUnique({
            where: { profileName: event.profileName },
            select: { profile: true, profileName: true, instanceKey: true, meta: true },
        });
        if (!profile) return false;
        const receipt = await tx.webPushEventReceipt.createMany({
            data: [{ eventId: event.eventId, profileName: event.profileName, eventType: event.eventType }],
            skipDuplicates: true,
        });
        if (receipt.count === 0) return false;

        const preferenceWhere: GatewayPrisma.WebPushPreferenceWhereInput = {
            profileName: event.profileName,
            eventType: event.eventType,
            enabled: true,
            ...(event.eventType === 'TARGET_DATE_REACHED'
                ? { targetYear: event.year, targetMonth: event.month }
                : profileWideEvents.has(event.eventType)
                  ? {}
                  : { userId: { in: uniqueUserIds(event.userIds) } }),
        };
        const preferences = await tx.webPushPreference.findMany({
            where: preferenceWhere,
            select: { userId: true },
        });
        const selectedUserIds = uniqueUserIds(preferences.map((preference) => preference.userId));
        if (selectedUserIds.length === 0) return true;

        const subscriptions = await tx.webPushSubscription.findMany({
            where: {
                userId: { in: selectedUserIds },
                disabledAt: null,
                OR: [{ expirationTime: null }, { expirationTime: { gt: new Date() } }],
            },
            select: { id: true, userId: true },
        });
        const subscriptionIdsByUser = new Map<string, string[]>();
        for (const subscription of subscriptions) {
            const ids = subscriptionIdsByUser.get(subscription.userId) ?? [];
            ids.push(subscription.id);
            subscriptionIdsByUser.set(subscription.userId, ids);
        }
        const copy = copyFor(
            event.eventType,
            resolveGatewayProfileDisplayName(
                profile.profile,
                profile.instanceKey,
                (profile.meta as Record<string, unknown> | null)?.korName
            ),
            event.year,
            event.month
        );
        for (const userId of selectedUserIds) {
            const subscriptionIds = subscriptionIdsByUser.get(userId) ?? [];
            if (subscriptionIds.length === 0) continue;
            const dedupeKey = `${event.eventId}:${userId}`;
            const notification = await tx.webPushNotification.upsert({
                where: { dedupeKey },
                create: {
                    dedupeKey,
                    userId,
                    profileName: event.profileName,
                    eventType: event.eventType,
                    title: copy.title,
                    body: copy.body,
                    url: `/${encodeURIComponent(profile.profile)}/`,
                    tag: `sammo-${event.profileName}-${event.eventType}`,
                },
                update: {},
                select: { id: true },
            });
            await tx.webPushDelivery.createMany({
                data: subscriptionIds.map((subscriptionId) => ({
                    notificationId: notification.id,
                    subscriptionId,
                })),
                skipDuplicates: true,
            });
        }
        return true;
    }

    async ingest(event: WebPushEventEnvelopeV1): Promise<{ queued: boolean }> {
        if (!this.configured) return { queued: false };
        const queued = await this.prisma.$transaction((tx) => this.enqueueEventTx(tx, event));
        this.wake();
        return { queued };
    }

    async reconcileProfiles(now = new Date()): Promise<void> {
        const profiles = await this.prisma.gatewayProfile.findMany({
            select: {
                profileName: true,
                status: true,
                preopenAt: true,
                openAt: true,
                updatedAt: true,
            },
        });
        for (const profile of profiles) {
            await this.prisma.$transaction(async (tx) => {
                const previous = await tx.webPushProfileCursor.findUnique({
                    where: { profileName: profile.profileName },
                });
                await tx.webPushProfileCursor.upsert({
                    where: { profileName: profile.profileName },
                    create: {
                        profileName: profile.profileName,
                        status: String(profile.status),
                        preopenAt: profile.preopenAt,
                        openAt: profile.openAt,
                    },
                    update: {
                        status: String(profile.status),
                        preopenAt: profile.preopenAt,
                        openAt: profile.openAt,
                    },
                });
                if (!previous || !this.configured) return;
                const events: WebPushEventEnvelopeV1[] = [];
                const eventBase = `gateway:${profile.profileName}:${profile.updatedAt.toISOString()}`;
                if (previous.status !== String(profile.status) && profile.status === 'PREOPEN') {
                    events.push({
                        version: 1,
                        eventId: `${eventBase}:preopen`,
                        eventType: 'PROFILE_PREOPENED',
                        profileName: profile.profileName,
                        userIds: [],
                        occurredAt: now.toISOString(),
                    });
                }
                if (previous.status !== String(profile.status) && profile.status === 'RUNNING') {
                    events.push({
                        version: 1,
                        eventId: `${eventBase}:opened`,
                        eventType: 'PROFILE_OPENED',
                        profileName: profile.profileName,
                        userIds: [],
                        occurredAt: now.toISOString(),
                    });
                }
                if (
                    profile.openAt &&
                    profile.openAt.getTime() > now.getTime() &&
                    previous.openAt?.getTime() !== profile.openAt.getTime()
                ) {
                    events.push({
                        version: 1,
                        eventId: `${eventBase}:open-scheduled:${profile.openAt.toISOString()}`,
                        eventType: 'PROFILE_OPEN_SCHEDULED',
                        profileName: profile.profileName,
                        userIds: [],
                        occurredAt: now.toISOString(),
                    });
                }
                for (const event of events) await this.enqueueEventTx(tx, event);
            });
        }
        this.wake();
    }

    private async dispatchBatch(): Promise<void> {
        if (!this.configured) return;
        const claimed = await this.prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<Array<{ id: bigint }>>(GatewayPrisma.sql`
                SELECT "id"
                FROM "web_push_delivery"
                WHERE "status" = 'PENDING'
                  AND "available_at" <= CURRENT_TIMESTAMP
                  AND ("locked_at" IS NULL OR "locked_at" <= CURRENT_TIMESTAMP - INTERVAL '30 seconds')
                ORDER BY "id"
                FOR UPDATE SKIP LOCKED
                LIMIT 25
            `);
            if (rows.length === 0) return [];
            const ids = rows.map((row) => row.id);
            await tx.webPushDelivery.updateMany({
                where: { id: { in: ids } },
                data: { lockedAt: new Date(), lockOwner: this.owner, attempts: { increment: 1 } },
            });
            return tx.webPushDelivery.findMany({
                where: { id: { in: ids }, lockOwner: this.owner },
                include: { notification: true, subscription: true },
                orderBy: { id: 'asc' },
            });
        });

        for (const delivery of claimed) {
            if (delivery.subscription.expirationTime && delivery.subscription.expirationTime.getTime() <= Date.now()) {
                await this.prisma.$transaction(async (tx) => {
                    await tx.webPushDelivery.updateMany({
                        where: { id: delivery.id, lockOwner: this.owner },
                        data: {
                            status: 'FAILED',
                            lockedAt: null,
                            lockOwner: null,
                            lastError: 'Push subscription expired.',
                        },
                    });
                    await tx.webPushSubscription.update({
                        where: { id: delivery.subscriptionId },
                        data: { disabledAt: new Date() },
                    });
                });
                continue;
            }
            try {
                await webPush.sendNotification(
                    {
                        endpoint: delivery.subscription.endpoint,
                        keys: { p256dh: delivery.subscription.p256dh, auth: delivery.subscription.auth },
                    },
                    JSON.stringify({
                        title: delivery.notification.title,
                        body: delivery.notification.body,
                        url: delivery.notification.url,
                        tag: delivery.notification.tag,
                    }),
                    { TTL: 60 * 60 }
                );
                await this.prisma.webPushDelivery.updateMany({
                    where: { id: delivery.id, lockOwner: this.owner },
                    data: {
                        status: 'DELIVERED',
                        deliveredAt: new Date(),
                        lockedAt: null,
                        lockOwner: null,
                        lastError: null,
                    },
                });
            } catch (error) {
                const statusCode =
                    typeof error === 'object' && error !== null && 'statusCode' in error
                        ? Number((error as { statusCode?: unknown }).statusCode)
                        : 0;
                const terminal =
                    statusCode === 404 ||
                    statusCode === 410 ||
                    (statusCode >= 400 && statusCode < 500 && statusCode !== 429);
                const attempts = delivery.attempts;
                const exhausted = attempts >= 8;
                const delaySeconds = Math.min(300, 2 ** Math.min(attempts, 8));
                const safeError =
                    statusCode > 0 ? `Push service returned HTTP ${statusCode}.` : 'Push service request failed.';
                await this.prisma.$transaction(async (tx) => {
                    await tx.webPushDelivery.updateMany({
                        where: { id: delivery.id, lockOwner: this.owner },
                        data: {
                            status: terminal || exhausted ? 'FAILED' : 'PENDING',
                            availableAt: new Date(Date.now() + delaySeconds * 1_000),
                            lockedAt: null,
                            lockOwner: null,
                            lastError: safeError,
                        },
                    });
                    if (statusCode === 404 || statusCode === 410) {
                        await tx.webPushSubscription.update({
                            where: { id: delivery.subscriptionId },
                            data: { disabledAt: new Date() },
                        });
                    }
                });
                if (!terminal) this.onError(new Error(safeError));
            }
        }
        if (Date.now() >= this.nextPruneAt) {
            this.nextPruneAt = Date.now() + 60_000;
            await this.prisma.$transaction(async (tx) => {
                await tx.$executeRaw(GatewayPrisma.sql`
                    WITH expired AS (
                        SELECT "event_id"
                        FROM "web_push_event_receipt"
                        WHERE "created_at" < CURRENT_TIMESTAMP - INTERVAL '30 days'
                        ORDER BY "created_at"
                        LIMIT 500
                    )
                    DELETE FROM "web_push_event_receipt"
                    WHERE "event_id" IN (SELECT "event_id" FROM expired)
                `);
                await tx.$executeRaw(GatewayPrisma.sql`
                    WITH expired AS (
                        SELECT notification."id"
                        FROM "web_push_notification" AS notification
                        WHERE notification."created_at" < CURRENT_TIMESTAMP - INTERVAL '30 days'
                          AND NOT EXISTS (
                              SELECT 1 FROM "web_push_delivery" AS delivery
                              WHERE delivery."notification_id" = notification."id"
                                AND delivery."status" = 'PENDING'
                          )
                        ORDER BY notification."created_at"
                        LIMIT 500
                    )
                    DELETE FROM "web_push_notification"
                    WHERE "id" IN (SELECT "id" FROM expired)
                `);
            });
        }
    }

    private run(): void {
        if (!this.configured || this.inFlight) return;
        const now = Date.now();
        const shouldReconcileProfiles = now >= this.nextProfileReconcileAt;
        if (shouldReconcileProfiles) this.nextProfileReconcileAt = now + 5_000;
        this.inFlight = (shouldReconcileProfiles ? this.reconcileProfiles() : Promise.resolve())
            .then(() => this.dispatchBatch())
            .catch(this.onError)
            .finally(() => {
                this.inFlight = null;
            });
    }

    start(): void {
        if (!this.configured || this.timer) return;
        this.timer = setInterval(() => this.run(), this.pollIntervalMs);
        this.timer.unref?.();
        this.run();
    }

    wake(): void {
        this.run();
    }

    async stop(): Promise<void> {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        await this.inFlight;
    }
}
