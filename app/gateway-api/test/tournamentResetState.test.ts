import { describe, expect, it } from 'vitest';

import {
    buildGameClockRuntimeKeys,
    buildProfileResetRuntimeKeys,
    buildTournamentRuntimeKeys,
    clearProfileResetRuntimeKeys,
    clearTournamentRuntimeKeys,
} from '../src/orchestrator/gatewayOrchestrator.js';

describe('tournament reset state', () => {
    it('targets every season-owned tournament key for the selected profile only', () => {
        expect(buildTournamentRuntimeKeys('che:1010')).toEqual([
            'sammo:che:1010:tournament:state',
            'sammo:che:1010:tournament:participants',
            'sammo:che:1010:tournament:matches',
            'sammo:che:1010:tournament:betting',
            'sammo:che:1010:tournament:source-revision',
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

        expect(deleted).toBe(5);
        expect(calls).toEqual([buildTournamentRuntimeKeys('che:1010')]);
    });

    it('clears stale clock authority together with tournament projection on season reset', async () => {
        expect(buildGameClockRuntimeKeys('hwe:default')).toEqual([
            'sammo:hwe:default:clock:active-revision',
            'sammo:hwe:default:clock:deadline-generation',
            'sammo:hwe:default:clock:phase',
        ]);
        expect(buildProfileResetRuntimeKeys('hwe:default')).toEqual([
            ...buildTournamentRuntimeKeys('hwe:default'),
            ...buildGameClockRuntimeKeys('hwe:default'),
        ]);

        const calls: string[][] = [];
        const deleted = await clearProfileResetRuntimeKeys(
            {
                del: async (keys) => {
                    calls.push(keys);
                    return keys.length;
                },
            },
            'hwe:default'
        );

        expect(deleted).toBe(8);
        expect(calls).toEqual([buildProfileResetRuntimeKeys('hwe:default')]);
        expect(calls[0]).not.toContain('sammo:che:default:clock:phase');
    });
});
