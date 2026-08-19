import { describe, expect, it } from 'vitest';

import { InMemoryTurnProcessor } from '../src/turn/inMemoryTurnProcessor.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const buildWorld = (isunited: number): InMemoryTurnWorld => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 200,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0200-01-01T00:00:00.000Z'),
        meta: { isunited },
    };
    const snapshot: TurnWorldSnapshot = {
        generals: [],
        cities: [],
        nations: [],
        troops: [],
        diplomacy: [],
        events: [],
        initialEvents: [],
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: {},
            environment: { mapName: 'test', unitSet: 'default' },
        },
        map: { id: 'test', name: 'test', cities: [] },
    };
    return new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
    });
};

describe('invader event-game month progression', () => {
    it('continues monthly processing while the invader game is active', async () => {
        const world = buildWorld(1);
        const result = await new InMemoryTurnProcessor(world).run(new Date('0200-01-01T00:10:00.000Z'), {
            budgetMs: 1_000,
            maxGenerals: 10,
            catchUpCap: 1,
        });

        expect(result.processedTurns).toBe(1);
        expect(world.getState()).toMatchObject({ currentYear: 200, currentMonth: 2 });
    });

    it.each([2, 3])('stops monthly processing at terminal united state %s', async (isunited) => {
        const world = buildWorld(isunited);
        const result = await new InMemoryTurnProcessor(world).run(new Date('0200-01-01T00:10:00.000Z'), {
            budgetMs: 1_000,
            maxGenerals: 10,
            catchUpCap: 1,
        });

        expect(result.processedTurns).toBe(0);
        expect(world.getState()).toMatchObject({ currentYear: 200, currentMonth: 1 });
    });
});
