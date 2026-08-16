import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRedisConnector, resolveRedisConfigFromEnv, type RedisConnector } from '@sammo-ts/infra';

import { buildTournamentKeys } from '../src/tournament/keys.js';
import { TournamentStore } from '../src/tournament/store.js';

const integration = describe.skipIf(!process.env.REDIS_URL);

integration('TournamentStore Redis source revision', () => {
    let connector: RedisConnector;
    const profile = `test:tournament-revision:${randomUUID()}`;
    const keys = buildTournamentKeys(profile);

    beforeAll(async () => {
        connector = createRedisConnector(resolveRedisConfigFromEnv());
        await connector.connect();
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
});
