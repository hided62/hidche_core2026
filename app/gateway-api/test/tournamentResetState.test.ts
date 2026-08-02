import { describe, expect, it } from 'vitest';

import {
    buildTournamentRuntimeKeys,
    clearTournamentRuntimeKeys,
} from '../src/orchestrator/gatewayOrchestrator.js';

describe('tournament reset state', () => {
    it('targets every season-owned tournament key for the selected profile only', () => {
        expect(buildTournamentRuntimeKeys('che:1010')).toEqual([
            'sammo:che:1010:tournament:state',
            'sammo:che:1010:tournament:participants',
            'sammo:che:1010:tournament:matches',
            'sammo:che:1010:tournament:betting',
        ]);
        expect(buildTournamentRuntimeKeys('hwe:915')).not.toContain('sammo:che:1010:tournament:state');
    });

    it('deletes the tournament state as one profile-scoped reset operation', async () => {
        const calls: string[][] = [];
        const deleted = await clearTournamentRuntimeKeys(
            {
                del: async (keys) => {
                    calls.push(keys);
                    return keys.length;
                },
            },
            'che:1010'
        );

        expect(deleted).toBe(4);
        expect(calls).toEqual([buildTournamentRuntimeKeys('che:1010')]);
    });
});
