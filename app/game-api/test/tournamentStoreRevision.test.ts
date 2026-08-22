import { describe, expect, it } from 'vitest';

import { buildTournamentKeys } from '../src/tournament/keys.js';
import { TournamentStore } from '../src/tournament/store.js';

class AtomicMemoryRedis {
    readonly events: string[] = [];
    readonly published: Array<{ channel: string; message: string }> = [];
    failNextEval = false;
    private readonly values = new Map<string, string>();

    async get(key: string): Promise<string | null> {
        return this.values.get(key) ?? null;
    }

    async set(key: string, value: string): Promise<string> {
        this.values.set(key, value);
        return 'OK';
    }

    async eval(_script: string, options: { keys: string[]; arguments: string[] }): Promise<string> {
        if (this.failNextEval) {
            this.failNextEval = false;
            throw new Error('injected Redis write failure');
        }
        const [valueKey, revisionKey] = options.keys;
        const [value] = options.arguments;
        if (!valueKey || !revisionKey || value === undefined) throw new Error('invalid eval arguments');

        const revision = Number(this.values.get(revisionKey) ?? '0') + 1;
        this.values.set(valueKey, value);
        this.values.set(revisionKey, String(revision));
        this.events.push(`commit:${revision}`);
        return String(revision);
    }

    async publish(channel: string, message: string): Promise<number> {
        const payload = JSON.parse(message) as { sourceRevision?: string; type?: string };
        this.events.push(`publish:${payload.sourceRevision ?? payload.type ?? 'unknown'}`);
        this.published.push({ channel, message });
        return 1;
    }
}

describe('TournamentStore source revision', () => {
    it('publishes only after the payload and source revision commit atomically', async () => {
        const redis = new AtomicMemoryRedis();
        const keys = buildTournamentKeys('che:default');
        const store = new TournamentStore(redis, keys);

        await expect(
            store.setParticipants([{ id: 7, name: '관우', leadership: 90, strength: 97, intel: 75, level: 5 }])
        ).resolves.toBe('1');

        await expect(store.getSourceRevision()).resolves.toBe('1');
        await expect(store.getParticipants()).resolves.toHaveLength(1);
        expect(redis.events).toEqual(['commit:1', 'publish:1', 'publish:tournamentProjectionChanged']);
        expect(redis.published).toEqual([
            { channel: keys.sourceRevisionChannel, message: JSON.stringify({ sourceRevision: '1' }) },
            {
                channel: keys.realtimeEventChannel,
                message: JSON.stringify({
                    type: 'tournamentProjectionChanged',
                    invalidation: { snapshot: true, betting: false, rankings: false },
                }),
            },
        ]);
    });

    it('does not advance the source revision or publish when the atomic write fails', async () => {
        const redis = new AtomicMemoryRedis();
        const store = new TournamentStore(redis, buildTournamentKeys('hwe:default'));
        redis.failNextEval = true;

        await expect(
            store.setParticipants([{ id: 1, name: '실패', leadership: 1, strength: 1, intel: 1, level: 1 }])
        ).rejects.toThrow('injected Redis write failure');

        await expect(store.getParticipants()).resolves.toEqual([]);
        await expect(store.getSourceRevision()).resolves.toBeNull();
        expect(redis.published).toEqual([]);
    });

    it('wakes the main realtime channel only for shared state writes', async () => {
        const redis = new AtomicMemoryRedis();
        const keys = buildTournamentKeys('che:default');
        const store = new TournamentStore(redis, keys);

        await store.setState({
            stage: 1,
            phase: 0,
            type: 0,
            auto: true,
            openYear: 185,
            openMonth: 2,
            termSeconds: 10,
            nextAt: '2026-08-17T00:00:00.000Z',
        });

        expect(redis.events).toEqual([
            'commit:1',
            'publish:1',
            'publish:tournamentProjectionChanged',
            'publish:tournamentChanged',
        ]);
        expect(redis.published).toEqual([
            { channel: keys.sourceRevisionChannel, message: JSON.stringify({ sourceRevision: '1' }) },
            {
                channel: keys.realtimeEventChannel,
                message: JSON.stringify({
                    type: 'tournamentProjectionChanged',
                    invalidation: { snapshot: true, betting: true, rankings: false },
                }),
            },
            { channel: keys.realtimeEventChannel, message: JSON.stringify({ type: 'tournamentChanged' }) },
        ]);
    });

    it('serializes concurrent writes into monotonic per-profile revisions', async () => {
        const redis = new AtomicMemoryRedis();
        const store = new TournamentStore(redis, buildTournamentKeys('pwe:default'));

        const revisions = await Promise.all(
            Array.from({ length: 50 }, (_, index) =>
                store.setMatches([{ id: index + 1, stage: 7, roundIndex: index, attackerId: 1, defenderId: 2 }])
            )
        );

        expect(new Set(revisions).size).toBe(50);
        await expect(store.getSourceRevision()).resolves.toBe('50');
        expect(redis.published).toHaveLength(100);
    });
});
