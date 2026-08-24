import { describe, expect, it } from 'vitest';

import { buildTournamentKeys } from '../src/tournament/keys.js';
import { CorruptTournamentProjectionError, TournamentStore } from '../src/tournament/store.js';

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

    it('distinguishes missing projections from malformed JSON and invalid shapes', async () => {
        const redis = new AtomicMemoryRedis();
        const keys = buildTournamentKeys('corrupt:default');
        const store = new TournamentStore(redis, keys);

        await expect(store.getParticipants()).resolves.toEqual([]);
        await redis.set(keys.participantsKey, '{broken');
        await expect(store.getParticipants()).rejects.toBeInstanceOf(CorruptTournamentProjectionError);
        await redis.set(keys.participantsKey, JSON.stringify([{ id: 'not-a-number' }]));
        await expect(store.getParticipants()).rejects.toBeInstanceOf(CorruptTournamentProjectionError);
    });

    it('rejects corrupt settlement flags instead of silently skipping tournament settlement', async () => {
        const redis = new AtomicMemoryRedis();
        const keys = buildTournamentKeys('corrupt-settlement:default');
        const store = new TournamentStore(redis, keys);
        const canonicalState = {
            stage: 0,
            phase: 0,
            type: 0,
            auto: false,
            openYear: 185,
            openMonth: 2,
            termSeconds: 300,
            nextAt: '2026-08-17T00:00:00.000Z',
            bettingId: 123,
            bettingCloseAt: '2026-08-17T00:05:00.000Z',
            winnerId: 7,
            bettingSettled: false,
            rewardSettled: false,
            participantsLockedAt: '2026-08-17T00:01:00.000Z',
            lastError: 'retryable fixture',
            lastErrorAt: '2026-08-17T00:02:00.000Z',
        };

        await redis.set(keys.stateKey, JSON.stringify(canonicalState));
        await expect(store.getState()).resolves.toEqual(canonicalState);

        for (const [field, value] of [
            ['winnerId', '7'],
            ['bettingId', '123'],
            ['rewardSettled', 'yes'],
            ['bettingSettled', 1],
        ] as const) {
            await redis.set(keys.stateKey, JSON.stringify({ ...canonicalState, [field]: value }));
            await expect(store.getState(), field).rejects.toBeInstanceOf(CorruptTournamentProjectionError);
        }
    });

    it('validates known optional participant and match projection fields', async () => {
        const redis = new AtomicMemoryRedis();
        const keys = buildTournamentKeys('corrupt-optional:default');
        const store = new TournamentStore(redis, keys);
        const participant = {
            id: 7,
            name: '관우',
            leadership: 90,
            strength: 97,
            intel: 75,
            level: 5,
            groupId: 0,
            groupNo: 1,
            win: 2,
            draw: 1,
            lose: 0,
            gl: 10,
            seedRank: 1,
            finalRank: 2,
            preliminaryGroupId: 0,
            preliminaryGroupNo: 1,
            preliminaryRank: 2,
            preliminaryWin: 2,
            preliminaryDraw: 1,
            preliminaryLose: 0,
            preliminaryGl: 10,
        };
        const match = {
            id: 1,
            stage: 7,
            roundIndex: 0,
            groupId: 0,
            attackerId: 7,
            defenderId: 8,
            winnerId: 7,
            log: ['결과'],
            logEntries: [
                {
                    phase: 1,
                    attackerEnergy: 90,
                    defenderEnergy: 0,
                    attackerDamage: 10,
                    defenderDamage: 100,
                    text: '결과',
                },
            ],
            lastEnergy: { attacker: 90, defender: 0 },
        };

        await redis.set(keys.participantsKey, JSON.stringify([participant]));
        await redis.set(keys.matchesKey, JSON.stringify([match]));
        await expect(store.getParticipants()).resolves.toEqual([participant]);
        await expect(store.getMatches()).resolves.toEqual([match]);

        await redis.set(keys.participantsKey, JSON.stringify([{ ...participant, win: '2' }]));
        await expect(store.getParticipants()).rejects.toBeInstanceOf(CorruptTournamentProjectionError);
        await redis.set(keys.matchesKey, JSON.stringify([{ ...match, lastEnergy: { attacker: '90', defender: 0 } }]));
        await expect(store.getMatches()).rejects.toBeInstanceOf(CorruptTournamentProjectionError);
    });

});
