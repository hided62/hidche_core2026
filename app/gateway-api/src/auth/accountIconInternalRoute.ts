import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { isCanonicalIsoTimestamp } from '@sammo-ts/common';

import type { UserRepository } from './userRepository.js';
import { resolveEffectiveAccountIcon } from './accountIconProjection.js';

const INTERNAL_TOKEN_HEADER = 'x-sammo-internal-token';
const INTERNAL_TOKEN_CONTEXT = 'sammo:account-icon-source:v1';

const deriveInternalToken = (secret: string): string =>
    createHmac('sha256', secret).update(INTERNAL_TOKEN_CONTEXT).digest('hex');

const matchesSecret = (provided: string | string[] | undefined, expected: string): boolean => {
    const candidate = Array.isArray(provided) ? provided[0] : provided;
    if (!candidate) {
        return false;
    }
    const candidateBuffer = Buffer.from(candidate);
    const expectedBuffer = Buffer.from(expected);
    return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
};

const parseUserIds = (body: unknown): string[] | null => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return null;
    }
    const record = body as Record<string, unknown>;
    if (Object.keys(record).length !== 1 || !Array.isArray(record.userIds)) {
        return null;
    }
    if (record.userIds.length === 0 || record.userIds.length > 500) {
        return null;
    }
    const userIds = record.userIds.filter(
        (value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128
    );
    return userIds.length === record.userIds.length && new Set(userIds).size === userIds.length ? userIds : null;
};

export const registerAccountIconInternalRoute = (
    app: FastifyInstance,
    options: {
        users: UserRepository;
        secret: string;
    }
): void => {
    app.get<{ Params: { userId: string } }>('/internal/account-icons/:userId', async (request, reply) => {
        void reply.header('Cache-Control', 'no-store');
        if (!matchesSecret(request.headers[INTERNAL_TOKEN_HEADER], deriveInternalToken(options.secret))) {
            await reply.status(401).send({ ok: false, error: 'unauthorized' });
            return;
        }
        const user = await options.users.findById(request.params.userId);
        if (!user) {
            await reply.status(404).send({ ok: false, error: 'not_found' });
            return;
        }
        await reply.send(resolveEffectiveAccountIcon(user));
    });

    app.post<{ Body: unknown }>('/internal/account-icon-resets', async (request, reply) => {
        void reply.header('Cache-Control', 'no-store');
        if (!matchesSecret(request.headers[INTERNAL_TOKEN_HEADER], deriveInternalToken(options.secret))) {
            await reply.status(401).send({ ok: false, error: 'unauthorized' });
            return;
        }
        const userIds = parseUserIds(request.body);
        if (!userIds) {
            await reply.status(400).send({ ok: false, error: 'invalid_request' });
            return;
        }
        const users = await options.users.findByIds(userIds);
        const byId = new Map(users.map((user) => [user.id, user]));
        const resets = userIds.flatMap((userId) => {
            const user = byId.get(userId);
            const resetRevision = user?.profileIconResetAt;
            if (!user || !resetRevision || !isCanonicalIsoTimestamp(resetRevision)) {
                return [];
            }
            return [{ userId, resetRevision, current: resolveEffectiveAccountIcon(user) }];
        });
        await reply.send({ resets });
    });
};
