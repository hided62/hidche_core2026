import { describe, expect, it } from 'vitest';

import { writeTournamentProjection } from '../src/tournament/sourceRevision.js';

describe('tournament source revision', () => {
    it('passes every payload and one profile revision key to a single atomic script', async () => {
        const calls: Array<{ keys: string[]; arguments: string[] }> = [];
        const published: string[] = [];
        const redis = {
            eval: async (_script: string, options: { keys: string[]; arguments: string[] }) => {
                calls.push(options);
                return '7';
            },
            publish: async (_channel: string, message: string) => {
                published.push(message);
                return 1;
            },
        };

        await expect(
            writeTournamentProjection(
                redis,
                { sourceRevisionKey: 'revision', sourceRevisionChannel: 'changed' },
                [
                    { key: 'state', value: { stage: 1 } },
                    { key: 'matches', value: [] },
                ]
            )
        ).resolves.toBe('7');

        expect(calls).toEqual([
            {
                keys: ['state', 'matches', 'revision'],
                arguments: [JSON.stringify({ stage: 1 }), '[]'],
            },
        ]);
        expect(published).toEqual([JSON.stringify({ sourceRevision: '7' })]);
    });

    it('rejects empty or duplicate writes before evaluating Redis', async () => {
        const redis = { eval: async () => '1' };
        await expect(
            writeTournamentProjection(redis, { sourceRevisionKey: 'revision', sourceRevisionChannel: 'changed' }, [])
        ).rejects.toThrow('at least one');
        await expect(
            writeTournamentProjection(
                redis,
                { sourceRevisionKey: 'revision', sourceRevisionChannel: 'changed' },
                [
                    { key: 'state', value: 1 },
                    { key: 'state', value: 2 },
                ]
            )
        ).rejects.toThrow('unique');
    });
});
