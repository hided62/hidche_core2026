import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import type { GatewayProfileRepository } from '../orchestrator/profileRepository.js';

const INTERNAL_TOKEN_HEADER = 'x-sammo-internal-token';
const INTERNAL_TOKEN_CONTEXT = 'sammo:profile-status-source:v1';

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

export const registerProfileStatusInternalRoute = (
    app: FastifyInstance,
    options: {
        profiles: GatewayProfileRepository;
        secret: string;
    }
): void => {
    app.get<{ Params: { profileName: string } }>('/internal/profile-status/:profileName', async (request, reply) => {
        void reply.header('Cache-Control', 'no-store');
        if (!matchesSecret(request.headers[INTERNAL_TOKEN_HEADER], deriveInternalToken(options.secret))) {
            await reply.status(401).send({ ok: false, error: 'unauthorized' });
            return;
        }
        const profileName = request.params.profileName;
        const profile = await options.profiles.getProfile(profileName);
        if (!profile) {
            await reply.status(404).send({ ok: false, error: 'not_found' });
            return;
        }
        await reply.send({ profileName: profile.profileName, status: profile.status });
    });
};
