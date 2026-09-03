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
            keys.activeClockRevisionKey,
            keys.deadlineGenerationKey,
            keys.clockPhaseKey,
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
                store.setMatches([{ id: index + 1, stage: 7, roundIndex: index, attackerId: 1, defenderId: 2 }])
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
        await waitForLength(realtimeMessages, realtimeBefore + 2);

        await store.setState({ ...baseState, phase: 1 });
        await waitForLength(sourceMessages, sourceBefore + 2);
        await waitForLength(realtimeMessages, realtimeBefore + 3);

        await store.setState({ ...baseState, stage: 2, phase: 0 });
        await waitForLength(sourceMessages, sourceBefore + 3);
        await waitForLength(realtimeMessages, realtimeBefore + 5);
        expect(
            realtimeMessages
                .slice(realtimeBefore)
                .filter((message) => (JSON.parse(message) as { type?: string }).type === 'tournamentChanged')
        ).toEqual([JSON.stringify({ type: 'tournamentChanged' }), JSON.stringify({ type: 'tournamentChanged' })]);
    });

    it('selects rankings only on the first committed reward settlement', async () => {
        const store = new TournamentStore(connector.client, keys);
        const realtimeBefore = realtimeMessages.length;
        const state = await store.getState();
        expect(state).not.toBeNull();

        await store.setState({ ...state!, rewardSettled: true, bettingSettled: false });
        await store.setState({ ...state!, rewardSettled: true, bettingSettled: true });
        await waitForLength(realtimeMessages, realtimeBefore + 2);

        const pageEvents = realtimeMessages.slice(realtimeBefore).map(
            (message) =>
                JSON.parse(message) as {
                    type: string;
                    invalidation?: { rankings?: boolean };
                }
        );
        expect(pageEvents).toEqual([
            expect.objectContaining({
                type: 'tournamentProjectionChanged',
                invalidation: expect.objectContaining({ rankings: true }),
            }),
            expect.objectContaining({
                type: 'tournamentProjectionChanged',
                invalidation: expect.objectContaining({ rankings: false }),
            }),
        ]);
    });

    it('dual-writes deadline ticks and rejects a Redis clock revision race atomically', async () => {
        const store = new TournamentStore(connector.client, keys);
        await Promise.all([
            connector.client.set(keys.activeClockRevisionKey, '7'),
            connector.client.set(keys.deadlineGenerationKey, '3'),
            connector.client.set(keys.clockPhaseKey, 'RUNNING'),
        ]);
        const clockContext = {
            phase: 'RUNNING' as const,
            revision: 7,
            deadlineGeneration: 3,
            dateToTick: (date: Date) => Math.trunc(date.getTime() / 1_000),
        };
        const nextAt = '2026-09-03T10:00:00.000Z';
        await store.withClockContext(clockContext, () =>
            store.setState({
                stage: 6,
                phase: 0,
                type: 0,
                auto: true,
                openYear: 200,
                openMonth: 1,
                termSeconds: 10,
                nextAt,
                bettingCloseAt: '2026-09-03T09:59:50.000Z',
            })
        );
        await expect(store.getState()).resolves.toMatchObject({
            nextTick: Math.trunc(new Date(nextAt).getTime() / 1_000),
            bettingCloseTick: Math.trunc(new Date('2026-09-03T09:59:50.000Z').getTime() / 1_000),
            clockRevision: 7,
            deadlineGeneration: 3,
        });

        const beforeRevision = await store.getSourceRevision();
        await connector.client.set(keys.activeClockRevisionKey, '8');
        await expect(
            store.withClockContext(clockContext, () =>
                store.setMatches([{ id: 99, stage: 7, roundIndex: 0, attackerId: 1, defenderId: 2 }])
            )
        ).rejects.toThrow('clock revision fence failed');
        await expect(store.getSourceRevision()).resolves.toBe(beforeRevision);
    });
});
