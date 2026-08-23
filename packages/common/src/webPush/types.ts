export const WEB_PUSH_EVENT_TYPES = [
    'TROOP_ANNIHILATED',
    'PRIVATE_MESSAGE_RECEIVED',
    'AUTONOMOUS_ACTION_ENDED',
    'RESERVED_TURNS_ENDED',
    'PROFILE_PREOPENED',
    'PROFILE_OPEN_SCHEDULED',
    'PROFILE_OPENED',
    'NATION_DESTROYED',
    'TARGET_DATE_REACHED',
] as const;

export type WebPushEventType = (typeof WEB_PUSH_EVENT_TYPES)[number];

export const WEB_PUSH_TARGETED_EVENT_TYPES = [
    'TROOP_ANNIHILATED',
    'PRIVATE_MESSAGE_RECEIVED',
    'AUTONOMOUS_ACTION_ENDED',
    'RESERVED_TURNS_ENDED',
    'NATION_DESTROYED',
] as const satisfies readonly WebPushEventType[];

export type WebPushTargetedEventType = (typeof WEB_PUSH_TARGETED_EVENT_TYPES)[number];

export interface WebPushEventEnvelopeV1 {
    version: 1;
    eventId: string;
    eventType: WebPushEventType;
    profileName: string;
    userIds: string[];
    year?: number;
    month?: number;
    occurredAt: string;
}

export interface WebPushClientSubscription {
    endpoint: string;
    expirationTime: number | null;
    keys: {
        p256dh: string;
        auth: string;
    };
}

export const isWebPushEventType = (value: unknown): value is WebPushEventType =>
    typeof value === 'string' && (WEB_PUSH_EVENT_TYPES as readonly string[]).includes(value);
