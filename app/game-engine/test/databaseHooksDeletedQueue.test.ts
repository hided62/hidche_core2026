import { describe, expect, it } from 'vitest';

import { excludeDeletedReservedTurnQueues } from '../src/turn/databaseHooks.js';

describe('excludeDeletedReservedTurnQueues', () => {
    it('omits dirty, initialization, and leased queues owned by deleted entities', () => {
        expect(
            excludeDeletedReservedTurnQueues(
                {
                    generalIds: [1, 2],
                    generalInitializationIds: [2, 3],
                    generalLeaseIds: [1, 2, 3],
                    nationKeys: ['10:12', '20:11'],
                    nationInitializationKeys: ['20:9', '30:12'],
                    nationLeaseKeys: ['10:12', '20:11', '30:12'],
                },
                [2],
                [20]
            )
        ).toEqual({
            generalIds: [1],
            generalInitializationIds: [3],
            generalLeaseIds: [1, 3],
            nationKeys: ['10:12'],
            nationInitializationKeys: ['30:12'],
            nationLeaseKeys: ['10:12', '30:12'],
        });
    });
});
