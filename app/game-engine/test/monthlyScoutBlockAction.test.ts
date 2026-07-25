import { describe, expect, it } from 'vitest';
import type { Nation } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createScoutBlockHandler } from '../src/turn/monthlyScoutBlockAction.js';
import type { TurnEvent, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const buildNation = (id: number, scout: number): Nation => ({
    id,
    name: `국가${id}`,
    color: '#777777',
    capitalCityId: null,
    chiefGeneralId: null,
    gold: 0,
    rice: 0,
    power: 0,
    level: 2,
    typeCode: 'che_중립',
    meta: { scout, marker: id },
});

const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [],
    meta: {},
};

const buildWorld = (scout: number, blockChangeScout?: boolean) => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 200,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0200-01-01T00:00:00.000Z'),
        meta: blockChangeScout === undefined ? {} : { block_change_scout: blockChangeScout },
    };
    const scenarioConfig: TurnWorldSnapshot['scenarioConfig'] = {
        stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
        iconPath: '.',
        map: {},
        const: {},
        environment: { mapName: 'test', unitSet: 'default' },
    };
    return new InMemoryTurnWorld(
        state,
        {
            scenarioConfig,
            map: { id: 'test', name: 'test', cities: [] },
            generals: [],
            cities: [],
            nations: [buildNation(1, scout), buildNation(2, scout)],
            troops: [],
            diplomacy: [],
            events: [event],
            initialEvents: [],
        },
        { schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] } }
    );
};

describe('monthly scout block actions', () => {
    it('blocks joining for all nations and globally locks policy changes', async () => {
        const world = buildWorld(0);
        await createScoutBlockHandler({ actionName: 'BlockScoutAction', getWorld: () => world })(
            [true],
            { year: 200, month: 1, startyear: 190, currentEventID: 1, turnTime: new Date() },
            event
        );

        expect(world.listNations().map((nation) => nation.meta)).toEqual([
            { scout: 1, marker: 1 },
            { scout: 1, marker: 2 },
        ]);
        expect(world.getState().meta.block_change_scout).toBe(true);
    });

    it('preserves the legacy UnblockScoutAction missing-WHERE failure without mutations', async () => {
        const world = buildWorld(1, true);
        expect(() =>
            createScoutBlockHandler({ actionName: 'UnblockScoutAction', getWorld: () => world })(
                [false],
                { year: 200, month: 1, startyear: 190, currentEventID: 1, turnTime: new Date() },
                event
            )
        ).toThrow('update(): at least 3 arguments expected');

        expect(world.listNations().map((nation) => nation.meta.scout)).toEqual([1, 1]);
        expect(world.getState().meta.block_change_scout).toBe(true);
        expect(world.peekDirtyState().nations).toEqual([]);
    });

    it('rejects non-boolean global flag arguments', async () => {
        const world = buildWorld(0);
        expect(() =>
            createScoutBlockHandler({ actionName: 'BlockScoutAction', getWorld: () => world })(
                [1],
                { year: 200, month: 1, startyear: 190, currentEventID: 1, turnTime: new Date() },
                event
            )
        ).toThrow('BlockScoutAction blockChangeScout must be a boolean or null.');
    });
});
