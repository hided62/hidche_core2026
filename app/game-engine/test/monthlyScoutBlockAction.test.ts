import { describe, expect, it } from 'vitest';
import type { Nation } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { InMemoryTurnProcessor } from '../src/turn/inMemoryTurnProcessor.js';
import { createMonthlyEventHandler } from '../src/turn/monthlyEventHandler.js';
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

const buildWorld = (
    scout: number,
    blockChangeScout?: boolean,
    actionName?: 'BlockScoutAction' | 'UnblockScoutAction'
) => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 199,
        currentMonth: 12,
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
    const activeEvent: TurnEvent = {
        ...event,
        action: actionName ? [[actionName, false]] : [],
    };
    let world: InMemoryTurnWorld | null = null;
    const handler = createScoutBlockHandler({
        actionName: actionName ?? 'BlockScoutAction',
        getWorld: () => world,
    });
    world = new InMemoryTurnWorld(
        state,
        {
            scenarioConfig,
            map: { id: 'test', name: 'test', cities: [] },
            generals: [],
            cities: [],
            nations: [buildNation(1, scout), buildNation(2, scout)],
            troops: [],
            diplomacy: [],
            events: [activeEvent],
            initialEvents: [],
        },
        {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: createMonthlyEventHandler({
                getWorld: () => world,
                startYear: 190,
                actions: new Map([[actionName ?? 'BlockScoutAction', handler]]),
            }),
        }
    );
    return world;
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
        const world = buildWorld(1, true, 'UnblockScoutAction');
        await expect(world.advanceMonth(new Date('0200-01-01T00:00:00.000Z'))).rejects.toThrow(
            'update(): at least 3 arguments expected'
        );

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

    it('dispatches the destroy-nation event before the next turn after only one nation remains', async () => {
        const baseTime = new Date('0200-01-01T00:00:00.000Z');
        const destroyedNationEvent: TurnEvent = {
            id: 7,
            targetCode: 'destroy_nation',
            priority: 1_000,
            condition: ['and', ['Date', '>=', 183, 1], ['RemainNation', '==', 1]],
            action: [['BlockScoutAction'], ['DeleteEvent']],
            meta: {},
        };
        const general = {
            id: 1,
            name: '공격장',
            nationId: 1,
            cityId: 1,
            troopId: 0,
            stats: { leadership: 80, strength: 80, intelligence: 80 },
            experience: 0,
            dedication: 0,
            officerLevel: 1,
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: null },
            },
            injury: 0,
            gold: 1_000,
            rice: 1_000,
            crew: 0,
            crewTypeId: 0,
            train: 0,
            atmos: 0,
            age: 20,
            npcState: 0,
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: { killturn: 24 },
            turnTime: new Date(baseTime.getTime() + 60_000),
        } satisfies TurnWorldSnapshot['generals'][number];
        const buildCity = (id: number, nationId: number): TurnWorldSnapshot['cities'][number] => ({
            id,
            name: `도시${id}`,
            nationId,
            level: 5,
            state: 0,
            population: 10_000,
            populationMax: 20_000,
            agriculture: 1_000,
            agricultureMax: 2_000,
            commerce: 1_000,
            commerceMax: 2_000,
            security: 1_000,
            securityMax: 2_000,
            supplyState: 1,
            frontState: 0,
            defence: 1_000,
            defenceMax: 2_000,
            wall: 1_000,
            wallMax: 2_000,
            meta: {},
        });
        const nations = [buildNation(1, 0), buildNation(2, 0)];
        const snapshot: TurnWorldSnapshot = {
            generals: [general],
            cities: [buildCity(1, 1), buildCity(2, 2)],
            nations,
            troops: [],
            diplomacy: [],
            events: [destroyedNationEvent],
            initialEvents: [],
            map: {
                id: 'test',
                name: 'test',
                cities: [],
                defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
            },
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
                iconPath: '.',
                map: {},
                const: {},
                environment: { mapName: 'test', unitSet: 'default' },
            },
        };
        const state: TurnWorldState = {
            id: 1,
            currentYear: 200,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: baseTime,
            meta: {},
        };
        let world: InMemoryTurnWorld | null = null;
        const blockScout = createScoutBlockHandler({ actionName: 'BlockScoutAction', getWorld: () => world });
        const eventHandler = createMonthlyEventHandler({
            getWorld: () => world,
            startYear: 180,
            actions: new Map([['BlockScoutAction', blockScout]]),
        });
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            generalTurnHandler: {
                execute: ({ general: currentGeneral }) => ({
                    general: currentGeneral,
                    patches: {
                        generals: [],
                        cities: [{ id: 2, patch: { nationId: 1 } }],
                        nations: [{ id: 2, patch: { meta: { ...nations[1]!.meta, collapsed: true } } }],
                        troops: [],
                    },
                    destroyedNationIds: [2],
                }),
            },
        });

        const processor = new InMemoryTurnProcessor(world, {
            dispatchScenarioEvent: eventHandler.dispatchTarget,
        });
        await processor.run(new Date(baseTime.getTime() + 5 * 60_000), {
            budgetMs: 1_000,
            maxGenerals: 10,
            catchUpCap: 1,
        });

        expect(world.getNationById(2)).toBeNull();
        expect(world.getNationById(1)?.meta.scout).toBe(1);
        expect(world.listEvents('destroy_nation')).toEqual([]);
        expect(world.getState().meta.block_change_scout).toBeUndefined();
    });
});
