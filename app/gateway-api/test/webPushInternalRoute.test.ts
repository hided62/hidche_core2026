import fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { WebPushCoordinator } from '../src/webPush/coordinator.js';
import { deriveWebPushIngestToken, registerWebPushInternalRoute } from '../src/webPush/internalRoute.js';

const secret = 'web-push-route-test-secret';
const userId = '11111111-1111-4111-8111-111111111111';
const event = {
    version: 1,
    eventId: 'game:hwe:default:message:42',
    eventType: 'PRIVATE_MESSAGE_RECEIVED',
    profileName: 'hwe:default',
    userIds: [userId],
    occurredAt: '2026-08-23T00:00:00.000Z',
};

describe('web push internal event route', () => {
    it('accepts the strict privacy-safe envelope with a purpose-derived token', async () => {
        const app = fastify();
        const ingest = vi.fn().mockResolvedValue({ queued: true });
        registerWebPushInternalRoute(app, {
            secret,
            webPush: { ingest } as unknown as WebPushCoordinator,
        });

        const unauthorized = await app.inject({
            method: 'POST',
            url: '/internal/web-push-events',
            headers: { 'x-sammo-internal-token': secret },
            payload: event,
        });
        expect(unauthorized.statusCode).toBe(401);

        const response = await app.inject({
            method: 'POST',
            url: '/internal/web-push-events',
            headers: { 'x-sammo-internal-token': deriveWebPushIngestToken(secret) },
            payload: event,
        });
        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.json()).toEqual({ ok: true, queued: true });
        expect(ingest).toHaveBeenCalledWith(event);
    });

    it('rejects payload extensions such as private message text', async () => {
        const app = fastify();
        const ingest = vi.fn();
        registerWebPushInternalRoute(app, {
            secret,
            webPush: { ingest } as unknown as WebPushCoordinator,
        });
        const response = await app.inject({
            method: 'POST',
            url: '/internal/web-push-events',
            headers: { 'x-sammo-internal-token': deriveWebPushIngestToken(secret) },
            payload: { ...event, message: 'private message content' },
        });
        expect(response.statusCode).toBe(400);
        expect(ingest).not.toHaveBeenCalled();
    });
});
