import { createHmac } from 'node:crypto';

import fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { GatewayProfileRepository } from '../src/orchestrator/profileRepository.js';
import { registerProfileStatusInternalRoute } from '../src/lobby/profileStatusInternalRoute.js';

const secret = 'gateway-profile-status-test-secret';
const token = createHmac('sha256', secret).update('sammo:profile-status-source:v1').digest('hex');

describe('profile status internal route', () => {
    it('requires a purpose-derived token and returns only the durable status', async () => {
        const app = fastify();
        const profiles = {
            getProfile: vi.fn(async (profileName: string) => ({ profileName, status: 'PAUSED' })),
        } as unknown as GatewayProfileRepository;
        registerProfileStatusInternalRoute(app, { profiles, secret });

        const unauthorized = await app.inject({
            method: 'GET',
            url: '/internal/profile-status/che%3Adefault',
            headers: { 'x-sammo-internal-token': secret },
        });
        expect(unauthorized.statusCode).toBe(401);

        const response = await app.inject({
            method: 'GET',
            url: '/internal/profile-status/che%3Adefault',
            headers: { 'x-sammo-internal-token': token },
        });
        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.json()).toEqual({ profileName: 'che:default', status: 'PAUSED' });
        expect(Object.keys(response.json()).sort()).toEqual(['profileName', 'status']);
    });

    it('returns 404 for an unknown profile', async () => {
        const app = fastify();
        const profiles = { getProfile: vi.fn(async () => null) } as unknown as GatewayProfileRepository;
        registerProfileStatusInternalRoute(app, { profiles, secret });
        const response = await app.inject({
            method: 'GET',
            url: '/internal/profile-status/missing',
            headers: { 'x-sammo-internal-token': token },
        });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({ ok: false, error: 'not_found' });
    });
});
