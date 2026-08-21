import { describe, expect, it } from 'vitest';

import { parseProfileSeedRequest } from '../src/orchestrator/profileSeedCli.js';

describe('parseProfileSeedRequest', () => {
    it('accepts the serializable selected-workspace seed contract', () => {
        expect(
            parseProfileSeedRequest({
                scenarioId: 1010,
                tickSeconds: 60,
                now: '2030-01-01T00:00:00.000Z',
                installOptions: {
                    installOperationId: 'operation-id',
                    installCommitSha: 'abcdef',
                    preopenAt: null,
                    openAt: '2030-01-01T02:00:00.000Z',
                },
                adminUser: { id: 'admin', username: 'admin' },
            })
        ).toMatchObject({
            scenarioId: 1010,
            tickSeconds: 60,
            installOptions: {
                installOperationId: 'operation-id',
                installCommitSha: 'abcdef',
                openAt: '2030-01-01T02:00:00.000Z',
            },
        });
    });

    it('rejects an invalid timestamp before touching the database', () => {
        expect(() => parseProfileSeedRequest({ scenarioId: 1010, now: 'not-a-date' })).toThrow(
            'Profile seed now must be an ISO date-time.'
        );
    });
});
