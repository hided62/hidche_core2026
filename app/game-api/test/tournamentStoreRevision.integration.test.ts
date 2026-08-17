import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRedisConnector, resolveRedisConfigFromEnv, type RedisConnector } from '@sammo-ts/infra';

import { buildTournamentKeys } from '../src/tournament/keys.js';
import { TournamentStore } from '../src/tournament/store.js';

const integration = describe.skipIf(!process.env.REDIS_URL);

integration('TournamentStore Redis source revision', () => {
    let connector: RedisConnector;
    let subscriber: RedisConnector;
    const profile = `test:tournament-revision:${randomUUID()}`;
    const keys = buildTournamentKeys(profile);
    const sourceMessages: string[] = [];
    const realtimeMessages: string[] = [];

    const waitForLength = async (values: readonly string[], length: number): Promise<void> => {
        const deadline = Date.now() + 1_000;
        while (values.length < length && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(values).toHaveLength(length);
    };

    beforeAll(async () => {
        connector = createRedisConnector(resolveRedisConfigFromEnv());
        subscriber = createRedisConnector(resolveRedisConfigFromEnv());
        await connector.connect();
        await subscriber.connect();
        await subscriber.client.subscribe(keys.sourceRevisionChannel, (message) => sourceMessages.push(message));
        await subscriber.client.subscribe(keys.realtimeEventChannel, (message) => realtimeMessages.push(message));
    });

    afterAll(async () => {
        if (!connector) return;
        await connector.client.del([
            keys.stateKey,
            keys.participantsKey,
            keys.matchesKey,
            keys.bettingKey,
            keys.sourceRevisionKey,
        ]);
        if (subscriber) {
            await subscriber.client.unsubscribe(keys.sourceRevisionChannel);
            await subscriber.client.unsubscribe(keys.realtimeEventChannel);
            await subscriber.disconnect();
        }
        await connector.disconnect();
    });

    it('commits concurrent payload writes with unique monotonic revisions', async () => {
        const store = new TournamentStore(connector.client, keys);
        const revisions = await Promise.all(
            Array.from({ length: 20 }, (_, index) =>
                store.setMatches([
                    { id: index + 1, stage: 7, roundIndex: index, attackerId: 1, defenderId: 2 },
                ])
            )
        );

        expect(new Set(revisions).size).toBe(20);
        await expect(store.getSourceRevision()).resolves.toBe('20');
        await expect(store.getMatches()).resolves.toHaveLength(1);
    });

    it('publishes the main wake-up only when the atomic state write changes stage', async () => {
        const store = new TournamentStore(connector.client, keys);
        const sourceBefore = sourceMessages.length;
        const realtimeBefore = realtimeMessages.length;
        const baseState = {
            stage: 1,
            phase: 0,
            type: 0 as const,
            auto: true,
            openYear: 185,
            openMonth: 2,
            termSeconds: 10,
            nextAt: '2026-08-17T00:00:00.000Z',
        };

        await store.setState(baseState);
        await waitForLength(sourceMessages, sourceBefore + 1);
        await waitForLength(realtimeMessages, realtimeBefore + 1);

        await store.setState({ ...baseState, phase: 1 });
        await waitForLength(sourceMessages, sourceBefore + 2);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(realtimeMessages).toHaveLength(realtimeBefore + 1);

        await store.setState({ ...baseState, stage: 2, phase: 0 });
        await waitForLength(sourceMessages, sourceBefore + 3);
        await waitForLength(realtimeMessages, realtimeBefore + 2);
        expect(realtimeMessages.slice(realtimeBefore)).toEqual([
            JSON.stringify({ type: 'tournamentChanged' }),
            JSON.stringify({ type: 'tournamentChanged' }),
        ]);
    });
});
