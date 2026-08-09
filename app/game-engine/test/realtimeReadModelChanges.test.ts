import { describe, expect, it } from 'vitest';
import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic';

import { summarizeRealtimeReadModelChanges } from '../src/turn/databaseHooks.js';
import type { TurnWorldChanges } from '../src/turn/inMemoryWorld.js';
import type { ReservedTurnChanges } from '../src/turn/reservedTurnStore.js';

describe('summarizeRealtimeReadModelChanges', () => {
    it('emits deterministic entity and record invalidations from committed changes', () => {
        const worldChanges = {
            generals: [{ id: 9 }, { id: 7 }],
            createdGenerals: [{ id: 8 }],
            deletedGenerals: [9],
            cities: [{ id: 4 }],
            nations: [{ id: 3 }],
            createdNations: [],
            deletedNations: [],
            deletedNationSnapshots: [],
            lifecycleEvents: [],
            logs: [
                {
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: 7,
                    format: LogFormat.PLAIN,
                    text: 'general',
                },
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.SUMMARY,
                    format: LogFormat.PLAIN,
                    text: 'summary',
                },
                {
                    scope: LogScope.SYSTEM,
                    category: LogCategory.HISTORY,
                    format: LogFormat.PLAIN,
                    text: 'history',
                },
            ],
        } as unknown as TurnWorldChanges;
        const reservedChanges: ReservedTurnChanges = {
            generalIds: [9],
            generalInitializationIds: [7],
            generalLeaseIds: [9, 8],
            nationKeys: [],
            nationInitializationKeys: [],
            nationLeaseKeys: [],
        };

        expect(summarizeRealtimeReadModelChanges(worldChanges, reservedChanges)).toEqual({
            generalIds: [7, 8, 9],
            cityIds: [4],
            nationIds: [3],
            reservedGeneralIds: [7, 8, 9],
            recordGeneralIds: [7],
            worldChanged: false,
            globalRecordsChanged: true,
            worldHistoryChanged: true,
            contactsChanged: true,
        });
    });
});
