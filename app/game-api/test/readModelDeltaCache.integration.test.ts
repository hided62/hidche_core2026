import { randomUUID } from 'node:crypto';

import { applyReadModelDelta } from '@sammo-ts/common';
import { createRedisConnector, resolveRedisConfigFromEnv } from '@sammo-ts/infra';
import { describe, expect, it } from 'vitest';

import { buildReadModelDeltaCacheKey, createReadModelDelta } from '../src/services/readModelDeltaCache.js';

const liveDescribe = process.env.REDIS_URL ? describe : describe.skip;

liveDescribe('read-model delta cache with live Redis', () => {
    it('stores a private expiring baseline and serves an applicable patch', async () => {
        const connector = createRedisConnector(resolveRedisConfigFromEnv());
        await connector.connect();

        const runId = process.env.CONDITIONAL_INTEGRATION_RUN_ID ?? randomUUID();
        const profile = `hwe:dashboard-delta-${runId}`;
        const viewerId = `viewer-${randomUUID()}`;
        const slice = 'main-command-table:7';
        const initialValue = {
            general: Array.from({ length: 48 }, (_, index) => ({
                key: `command-${index}`,
                name: `명령 ${index}`,
                possible: true,
                inputFields: [{ key: 'amount', kind: 'number', required: true }],
            })),
        };
        const keys: string[] = [];

        try {
            const initial = await createReadModelDelta({
                store: connector.client,
                profile,
                viewerId,
                slice,
                value: initialValue,
                forceSnapshot: true,
            });
            const initialKey = buildReadModelDeltaCacheKey(profile, viewerId, slice, initial.revision);
            keys.push(initialKey);
            expect(await connector.client.get(initialKey)).not.toBeNull();
            expect(await connector.client.ttl(initialKey)).toBeGreaterThan(0);

            const nextValue = structuredClone(initialValue);
            const first = nextValue.general[0];
            if (!first) throw new Error('command fixture is empty');
            first.possible = false;
            const changed = await createReadModelDelta({
                store: connector.client,
                profile,
                viewerId,
                slice,
                value: nextValue,
                knownRevision: initial.revision,
            });
            expect(changed.kind).toBe('patch');
            expect(applyReadModelDelta(initialValue, initial.revision, changed).data).toEqual(nextValue);
            expect(Buffer.byteLength(JSON.stringify(changed))).toBeLessThan(1_000);

            const changedKey = buildReadModelDeltaCacheKey(profile, viewerId, slice, changed.revision);
            keys.push(changedKey);
            expect(await connector.client.get(changedKey)).not.toBeNull();
        } finally {
            if (keys.length > 0) await connector.client.del(keys);
            await connector.disconnect();
        }
    });
});
