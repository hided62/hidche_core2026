import { randomUUID } from 'node:crypto';

import { buildGameEventChannel, createEmptyRealtimeReadModelChanges, type RealtimeEvent } from '@sammo-ts/common';
import { createRedisConnector, resolveRedisConfigFromEnv } from '@sammo-ts/infra';
import { describe, expect, it } from 'vitest';

import { RedisRealtimeEventHub } from '../src/realtime/eventHub.js';
import { publishRealtimeEvent } from '../src/realtime/publisher.js';

const liveDescribe = process.env.REDIS_URL ? describe : describe.skip;

liveDescribe('realtime event hub with live Redis', () => {
    it('forwards committed global record, history, and month-boundary flags intact', async () => {
        const publisher = createRedisConnector(resolveRedisConfigFromEnv());
        const subscriber = createRedisConnector(resolveRedisConfigFromEnv());
        await Promise.all([publisher.connect(), subscriber.connect()]);

        const runId = process.env.CONDITIONAL_INTEGRATION_RUN_ID ?? randomUUID();
        const profileName = `hwe:global-events-${runId}-${randomUUID()}`;
        const hub = new RedisRealtimeEventHub(subscriber.client, buildGameEventChannel(profileName));
        let unsubscribe = () => {};

        try {
            const received = new Promise<RealtimeEvent>((resolve) => {
                unsubscribe = hub.subscribe(resolve);
            });
            await hub.start();
            await publishRealtimeEvent(publisher.client, profileName, {
                type: 'turnCompleted',
                at: '2026-08-12T00:00:00.000Z',
                lastTurnTime: '0185-02-01T00:00:00.000Z',
                changes: {
                    ...createEmptyRealtimeReadModelChanges(),
                    worldChanged: true,
                    globalRecordsChanged: true,
                    worldHistoryChanged: true,
                },
                revision: 12,
            });

            await expect(
                Promise.race([
                    received,
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error('Redis realtime event timeout')), 2_000)
                    ),
                ])
            ).resolves.toMatchObject({
                type: 'turnCompleted',
                changes: {
                    worldChanged: true,
                    globalRecordsChanged: true,
                    worldHistoryChanged: true,
                },
                revision: 12,
            });
        } finally {
            unsubscribe();
            await hub.stop();
            await publisher.disconnect();
        }
    });
});
