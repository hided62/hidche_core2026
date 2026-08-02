import { describe, expect, it } from 'vitest';

import { loadTurnWorldFromDatabase } from '../src/turn/worldLoader.js';

const databaseUrl = process.env.CURRENT_SEASON_FIXTURE_DATABASE_URL;

describe.skipIf(!databaseUrl)('Ref current-season fixture loader', () => {
    it('loads the imported scenario 2601 year-186 world without semantic row loss', async () => {
        const loaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });

        expect(loaded.state).toMatchObject({ currentYear: 186, currentMonth: 1, tickSeconds: 600 });
        expect(loaded.snapshot.generals).toHaveLength(960);
        expect(loaded.snapshot.nations).toHaveLength(46);
        expect(loaded.snapshot.cities).toHaveLength(94);
        expect(loaded.snapshot.diplomacy).toHaveLength(2070);
        expect(loaded.snapshot.troops).toHaveLength(20);
        expect(loaded.snapshot.events).toHaveLength(9);
        expect(loaded.snapshot.initialEvents).toHaveLength(0);
    });
});
