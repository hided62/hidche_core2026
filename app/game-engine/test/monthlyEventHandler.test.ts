import { describe, expect, it } from 'vitest';
import type { MapDefinition } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createMonthlyEventHandler, type MonthlyEventActionHandler } from '../src/turn/monthlyEventHandler.js';
import type { TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const map: MapDefinition = {
    id: 'event-test',
    name: 'event-test',
    cities: [],
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
};

const buildWorld = (
    events: TurnWorldSnapshot['events'],
    actions: Map<string, MonthlyEventActionHandler>
): InMemoryTurnWorld => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 189,
        currentMonth: 12,
        tickSeconds: 600,
        lastTurnTime: new Date('0189-12-01T00:00:00.000Z'),
        meta: {},
    };
    const snapshot: TurnWorldSnapshot = {
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: {},
            environment: { mapName: map.id, unitSet: 'default' },
        },
        scenarioMeta: {
            title: 'event test',
            startYear: 189,
            life: null,
            fiction: null,
            history: [],
            ignoreDefaultEvents: false,
        },
        map,
        diplomacy: [],
        events,
        initialEvents: [],
        generals: [],
        cities: [],
        nations: [],
        troops: [],
    };
    let world: InMemoryTurnWorld | null = null;
    const handler = createMonthlyEventHandler({
        getWorld: () => world,
        startYear: 189,
        actions,
    });
    world = new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        calendarHandler: handler,
    });
    return world;
};

describe('monthly event pipeline', () => {
    it('runs PRE_MONTH before the date change and MONTH after it in priority/id order', () => {
        const trace: string[] = [];
        const actions = new Map<string, MonthlyEventActionHandler>([
            [
                'Trace',
                (args, environment) => {
                    trace.push(`${String(args[0])}:${environment.year}-${environment.month}`);
                },
            ],
        ]);
        const world = buildWorld(
            [
                {
                    id: 2,
                    targetCode: 'month',
                    priority: 10,
                    condition: true,
                    action: [['Trace', 'month-low']],
                    meta: {},
                },
                {
                    id: 3,
                    targetCode: 'month',
                    priority: 20,
                    condition: ['DateRelative', '==', 1, 1],
                    action: [['Trace', 'month-high']],
                    meta: {},
                },
                {
                    id: 1,
                    targetCode: 'pre_month',
                    priority: 0,
                    condition: ['Date', '==', 189, 12],
                    action: [['Trace', 'pre']],
                    meta: {},
                },
            ],
            actions
        );

        world.advanceMonth(new Date('0190-01-01T00:00:00.000Z'));

        expect(trace).toEqual(['pre:189-12', 'month-high:190-1', 'month-low:190-1']);
    });

    it('supports logic conditions and persists DeleteEvent through dirty state', () => {
        const world = buildWorld(
            [
                {
                    id: 7,
                    targetCode: 'month',
                    priority: 0,
                    condition: ['and', ['Date', '==', null, 1], ['RemainNation', '==', 0]],
                    action: [['DeleteEvent']],
                    meta: {},
                },
            ],
            new Map()
        );

        world.advanceMonth(new Date('0190-01-01T00:00:00.000Z'));

        expect(world.listEvents('month')).toEqual([]);
        expect(world.peekDirtyState().deletedEvents).toEqual([7]);
        world.acknowledgeDirtyState(world.peekDirtyState());
        expect(world.peekDirtyState().deletedEvents).toEqual([]);
    });

    it('fails explicitly when a scenario action has not been migrated', () => {
        const world = buildWorld(
            [
                {
                    id: 9,
                    targetCode: 'month',
                    priority: 0,
                    condition: true,
                    action: [['RaiseInvader']],
                    meta: {},
                },
            ],
            new Map()
        );

        expect(() => world.advanceMonth(new Date('0190-01-01T00:00:00.000Z'))).toThrow(
            'Unsupported monthly event action: RaiseInvader (eventId=9)'
        );
    });
});
