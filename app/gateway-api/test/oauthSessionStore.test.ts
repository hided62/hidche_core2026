import { randomUUID } from 'node:crypto';

import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RedisOAuthSessionStore } from '../src/auth/oauthSessionStore.js';

const redisUrl = process.env.GATEWAY_OAUTH_REDIS_TEST_URL;

describe.skipIf(!redisUrl)('RedisOAuthSessionStore Kakao state', () => {
    const prefix = `gateway-oauth-test:${randomUUID()}`;
    const client = createClient({ url: redisUrl });
    const store = new RedisOAuthSessionStore(client, prefix, 300);
    const userIds = new Set<string>();
    const challengeIds = new Set<string>();
    const sessionIds = new Set<string>();

    beforeAll(async () => {
        await client.connect();
    });

    afterAll(async () => {
        const keys = [
            ...[...challengeIds].map((id) => `${prefix}:kakao-login-challenge:${id}`),
            ...[...userIds].map((id) => `${prefix}:kakao-login-challenge-user:${id}`),
            ...[...sessionIds].map((id) => `${prefix}:oauth-session:${id}`),
        ];
        if (keys.length > 0) {
            await client.del(keys);
        }
        await client.quit();
    });

    const createChallenge = async () => {
        const userId = randomUUID();
        userIds.add(userId);
        const challenge = await store.createLoginChallenge({
            userId,
            code: '4321',
            attemptsRemaining: 3,
            expiresAt: new Date(Date.now() + 180_000).toISOString(),
            createdAt: new Date().toISOString(),
        });
        challengeIds.add(challenge.id);
        return challenge;
    };

    it('preserves and consumes a retained-email recovery target once', async () => {
        const targetUserId = randomUUID();
        const session = await store.createSession({
            mode: 'login',
            intent: 'link_existing',
            targetUserId,
            kakaoId: 'replacement-kakao-id',
            email: 'retained@example.test',
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            accessTokenValidUntil: new Date(Date.now() + 60_000).toISOString(),
            refreshTokenValidUntil: new Date(Date.now() + 86_400_000).toISOString(),
            createdAt: new Date().toISOString(),
        });
        sessionIds.add(session.id);

        await expect(client.ttl(`${prefix}:oauth-session:${session.id}`)).resolves.toBeGreaterThan(0);
        const consumed = await Promise.all([store.consumeSession(session.id), store.consumeSession(session.id)]);
        expect(consumed.filter((value) => value !== null)).toHaveLength(1);
        expect(consumed.find((value) => value !== null)).toMatchObject({
            id: session.id,
            intent: 'link_existing',
            targetUserId,
            email: 'retained@example.test',
        });
    });

    it('atomically consumes a successful code once', async () => {
        const challenge = await createChallenge();

        const results = await Promise.all([
            store.verifyLoginChallenge(challenge.id, challenge.code),
            store.verifyLoginChallenge(challenge.id, challenge.code),
        ]);

        expect(results.filter((result) => result.status === 'verified')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'expired')).toHaveLength(1);
        expect(await store.getLoginChallengeForUser(challenge.userId)).toBeNull();
    });

    it('atomically limits parallel wrong-code submissions to three attempts', async () => {
        const challenge = await createChallenge();

        const results = await Promise.all(
            Array.from({ length: 4 }, () => store.verifyLoginChallenge(challenge.id, '0000'))
        );

        expect(results.filter((result) => result.status === 'mismatch')).toHaveLength(3);
        expect(results.filter((result) => result.status === 'locked')).toHaveLength(1);
        expect(
            results
                .filter((result) => result.status === 'mismatch')
                .map((result) => result.attemptsRemaining)
                .sort()
        ).toEqual([0, 1, 2]);
        await expect(store.verifyLoginChallenge(challenge.id, challenge.code)).resolves.toMatchObject({
            status: 'locked',
        });
    });
});
