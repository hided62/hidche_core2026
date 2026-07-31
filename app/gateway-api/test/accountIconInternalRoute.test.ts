import { createHmac, randomUUID } from 'node:crypto';

import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerAccountIconInternalRoute } from '../src/auth/accountIconInternalRoute.js';
import { createInMemoryUserRepository } from '../src/auth/inMemoryUserRepository.js';

const secret = 'gateway-test-secret';
const token = createHmac('sha256', secret).update('sammo:account-icon-source:v1').digest('hex');

describe('account icon internal route', () => {
    const app = fastify();
    const users = createInMemoryUserRepository();
    let userId = '';

    beforeEach(async () => {
        if (!app.hasRoute({ method: 'GET', url: '/internal/account-icons/:userId' })) {
            registerAccountIconInternalRoute(app, { users, secret });
        }
        const user = await users.createUser({
            username: `internal-${randomUUID()}`,
            password: 'password',
            displayName: `내부-${randomUUID()}`,
        });
        userId = user.id;
        await users.updateIcon(userId, 'latest.png', 1, new Date('2026-07-31T09:00:00.000Z'));
    });

    afterEach(async () => {
        if (userId) {
            await users.deleteUser(userId);
        }
    });

    it('requires the purpose-derived token and exposes only the projection', async () => {
        const unauthorized = await app.inject({
            method: 'GET',
            url: `/internal/account-icons/${userId}`,
            headers: { 'x-sammo-internal-token': secret },
        });
        expect(unauthorized.statusCode).toBe(401);

        const response = await app.inject({
            method: 'GET',
            url: `/internal/account-icons/${userId}`,
            headers: { 'x-sammo-internal-token': token },
        });
        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.json()).toEqual({
            revision: '2026-07-31T09:00:00.000Z',
            picture: 'latest.png',
            imageServer: 1,
        });
        expect(Object.keys(response.json()).sort()).toEqual(['imageServer', 'picture', 'revision']);
    });

    it('returns 404 for a missing account without leaking account fields', async () => {
        const response = await app.inject({
            method: 'GET',
            url: `/internal/account-icons/${randomUUID()}`,
            headers: { 'x-sammo-internal-token': token },
        });
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({ ok: false, error: 'not_found' });
    });

    it('returns the durable reset marker even after a newer ordinary icon change', async () => {
        const resetRevision = await users.resetProfileIcon(userId, new Date('2099-07-31T09:00:00.001Z'));
        await users.updateIcon(userId, 'newer.png', 1, new Date('2099-07-31T09:00:00.002Z'));

        const response = await app.inject({
            method: 'POST',
            url: '/internal/account-icon-resets',
            headers: { 'x-sammo-internal-token': token },
            payload: { userIds: [userId, randomUUID()] },
        });
        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.json()).toEqual({
            resets: [
                {
                    userId,
                    resetRevision,
                    current: {
                        revision: '2099-07-31T09:00:00.002Z',
                        picture: 'newer.png',
                        imageServer: 1,
                    },
                },
            ],
        });

        const invalid = await app.inject({
            method: 'POST',
            url: '/internal/account-icon-resets',
            headers: { 'x-sammo-internal-token': token },
            payload: { userIds: [userId], extra: true },
        });
        expect(invalid.statusCode).toBe(400);
    });
});
