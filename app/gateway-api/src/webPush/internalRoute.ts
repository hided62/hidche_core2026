import { createHmac, timingSafeEqual } from 'node:crypto';

import { WEB_PUSH_EVENT_TYPES, type WebPushEventEnvelopeV1 } from '@sammo-ts/common';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { WebPushCoordinator } from './coordinator.js';

const INTERNAL_TOKEN_HEADER = 'x-sammo-internal-token';
const INTERNAL_TOKEN_CONTEXT = 'sammo:web-push-event-ingest:v1';

const zEnvelope = z
    .object({
        version: z.literal(1),
        eventId: z.string().min(1).max(500),
        eventType: z.enum(WEB_PUSH_EVENT_TYPES),
        profileName: z.string().min(1).max(128),
        userIds: z.array(z.string().uuid()).max(5_000),
        year: z.number().int().min(0).max(9999).optional(),
        month: z.number().int().min(1).max(12).optional(),
        occurredAt: z.iso.datetime(),
    })
    .strict();

export const deriveWebPushIngestToken = (secret: string): string =>
    createHmac('sha256', secret).update(INTERNAL_TOKEN_CONTEXT).digest('hex');

const matchesSecret = (provided: string | string[] | undefined, expected: string): boolean => {
    const candidate = Array.isArray(provided) ? provided[0] : provided;
    if (!candidate) return false;
    const candidateBuffer = Buffer.from(candidate);
    const expectedBuffer = Buffer.from(expected);
    return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
};

export const registerWebPushInternalRoute = (
    app: FastifyInstance,
    options: { secret: string; webPush: WebPushCoordinator }
): void => {
    app.post('/internal/web-push-events', async (request, reply) => {
        void reply.header('Cache-Control', 'no-store');
        if (!matchesSecret(request.headers[INTERNAL_TOKEN_HEADER], deriveWebPushIngestToken(options.secret))) {
            await reply.status(401).send({ ok: false, error: 'unauthorized' });
            return;
        }
        const parsed = zEnvelope.safeParse(request.body);
        if (!parsed.success) {
            await reply.status(400).send({ ok: false, error: 'invalid_event' });
            return;
        }
        const result = await options.webPush.ingest(parsed.data as WebPushEventEnvelopeV1);
        await reply.send({ ok: true, queued: result.queued });
    });
};
