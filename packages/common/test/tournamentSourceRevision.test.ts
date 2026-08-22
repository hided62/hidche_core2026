import { describe, expect, it } from 'vitest';

import { writeTournamentProjection } from '../src/tournament/sourceRevision.js';

const keys = {
    stateKey: 'state',
    participantsKey: 'participants',
    matchesKey: 'matches',
    bettingKey: 'betting',
    sourceRevisionKey: 'revision',
    sourceRevisionChannel: 'changed',
    realtimeEventChannel: 'realtime',
};

describe('tournament source revision', () => {
    it('passes every payload and one profile revision key to a single atomic script', async () => {
        const calls: Array<{ keys: string[]; arguments: string[] }> = [];
        const published: Array<{ channel: string; message: string }> = [];
        const redis = {
            eval: async (_script: string, options: { keys: string[]; arguments: string[] }) => {
                calls.push(options);
                return '7:1';
            },
            publish: async (channel: string, message: string) => {
                published.push({ channel, message });
                return 1;
            },
        };

        await expect(
            writeTournamentProjection(redis, keys, [
                { key: 'state', value: { stage: 1 } },
                { key: 'matches', value: [] },
            ])
        ).resolves.toBe('7');

        expect(calls).toEqual([
            {
                keys: ['state', 'matches', 'revision'],
                arguments: [JSON.stringify({ stage: 1 }), '[]'],
            },
        ]);
        expect(published).toEqual([
            { channel: 'changed', message: JSON.stringify({ sourceRevision: '7' }) },
            {
                channel: 'realtime',
                message: JSON.stringify({
                    type: 'tournamentProjectionChanged',
                    invalidation: { snapshot: true, betting: true, rankings: false },
                }),
            },
            { channel: 'realtime', message: JSON.stringify({ type: 'tournamentChanged' }) },
        ]);
    });

    it('rejects empty or duplicate writes before evaluating Redis', async () => {
        const redis = { eval: async () => '1' };
        await expect(writeTournamentProjection(redis, keys, [])).rejects.toThrow('at least one');
        await expect(
            writeTournamentProjection(redis, keys, [
                { key: 'state', value: 1 },
                { key: 'state', value: 2 },
            ])
        ).rejects.toThrow('unique');
    });

    it('does not wake the main dashboard for participant-only writes', async () => {
        const published: string[] = [];
        const redis = {
            eval: async () => '8',
            publish: async (channel: string) => {
                published.push(channel);
                return 1;
            },
        };

        await writeTournamentProjection(redis, keys, [{ key: 'participants', value: [{ id: 7 }] }]);

        expect(published).toEqual(['changed', 'realtime']);
    });

    it('does not wake the main dashboard when tournament state keeps the same stage', async () => {
        const published: string[] = [];
        const redis = {
            eval: async () => '10:0',
            publish: async (channel: string) => {
                published.push(channel);
                return 1;
            },
        };

        await expect(
            writeTournamentProjection(redis, keys, [{ key: 'state', value: { stage: 1, phase: 2 } }])
        ).resolves.toBe('10');
        expect(published).toEqual(['changed', 'realtime']);
    });

    it('keeps both post-commit wake-up channels independently best effort', async () => {
        const published: string[] = [];
        const redis = {
            eval: async () => '9',
            publish: async (channel: string) => {
                published.push(channel);
                if (channel === 'changed') throw new Error('source subscriber unavailable');
                return 1;
            },
        };

        await expect(writeTournamentProjection(redis, keys, [{ key: 'state', value: { stage: 1 } }])).resolves.toBe(
            '9'
        );
        expect(published).toEqual(['changed', 'realtime', 'realtime']);
    });

    it('selects only the betting slice for a same-stage bet write', async () => {
        const published: Array<{ channel: string; message: string }> = [];
        const redis = {
            eval: async () => '11:0',
            publish: async (channel: string, message: string) => {
                published.push({ channel, message });
                return 1;
            },
        };

        await writeTournamentProjection(redis, keys, [{ key: 'betting', value: [{ targetId: 3, amount: 10 }] }]);

        expect(published.at(-1)).toEqual({
            channel: 'realtime',
            message: JSON.stringify({
                type: 'tournamentProjectionChanged',
                invalidation: { snapshot: false, betting: true, rankings: false },
            }),
        });
        expect(published.some(({ message }) => message.includes('tournamentChanged'))).toBe(false);
    });

    it('refreshes rankings after reward persistence without waking the main dashboard', async () => {
        const published: Array<{ channel: string; message: string }> = [];
        const redis = {
            eval: async () => '12:0',
            publish: async (channel: string, message: string) => {
                published.push({ channel, message });
                return 1;
            },
        };

        await writeTournamentProjection(redis, keys, [
            { key: 'state', value: { stage: 0, rewardSettled: true, bettingSettled: false } },
        ]);

        expect(published.at(-1)).toEqual({
            channel: 'realtime',
            message: JSON.stringify({
                type: 'tournamentProjectionChanged',
                invalidation: { snapshot: true, betting: false, rankings: true },
            }),
        });
        expect(published.some(({ message }) => message.includes('tournamentChanged'))).toBe(false);
    });
});
