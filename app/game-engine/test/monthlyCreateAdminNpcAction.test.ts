import { describe, expect, it } from 'vitest';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createCreateAdminNpcHandler } from '../src/turn/monthlyCreateAdminNpcAction.js';
import { createMonthlyEventHandler } from '../src/turn/monthlyEventHandler.js';
import type { TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

describe('CreateAdminNPC monthly action', () => {
    it('preserves the legacy NYI no-op while allowing the event to continue', async () => {
        const state: TurnWorldState = {
            id: 1,
            currentYear: 193,
            currentMonth: 11,
            tickSeconds: 600,
            lastTurnTime: new Date('0193-11-01T00:00:00.000Z'),
            meta: {},
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: 'test', unitSet: 'default' },
            },
            map: {
                id: 'test',
                name: 'test',
                cities: [],
                defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
            },
            generals: [],
            cities: [],
            nations: [],
            troops: [],
            diplomacy: [],
            events: [
                {
                    id: 77,
                    targetCode: 'month',
                    priority: 1_000,
                    condition: true,
                    action: [['CreateAdminNPC'], ['DeleteEvent']],
                    meta: { marker: true },
                },
            ],
            initialEvents: [],
        };
        let world: InMemoryTurnWorld | null = null;
        const calendarHandler = createMonthlyEventHandler({
            getWorld: () => world,
            startYear: 190,
            actions: new Map([['CreateAdminNPC', createCreateAdminNpcHandler()]]),
        });
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler,
        });

        await world.advanceMonth(new Date('0193-12-01T00:00:00.000Z'));

        expect(world.listGenerals()).toEqual([]);
        expect(world.peekDirtyState()).toMatchObject({
            generals: [],
            cities: [],
            nations: [],
            logs: [],
            deletedEvents: [77],
        });
    });
});
