import { type GeneralActionModule, type TriggerValue, type TurnSchedule } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnDaemonCommandHandler } from '../src/turn/worldCommandHandler.js';

const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };

export const buildGeneral = (id: number, overrides: Partial<TurnGeneral> = {}): TurnGeneral => ({
    id,
    userId: `user-${id}`,
    name: `장수${id}`,
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 70, strength: 70, intelligence: 70 },
    turnTime: new Date('0185-01-01T00:00:00Z'),
    recentWarTime: null,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 12, belong: 5, permission: 'normal', explevel: 10, dedlevel: 5 },
    penalty: {},
    officerLevel: 1,
    experience: 1_000,
    dedication: 2_000,
    injury: 0,
    gold: 1_500,
    rice: 1_600,
    crew: 100,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
    ...overrides,
});

export const buildWorld = (options: {
    generals?: TurnGeneral[];
    nationMeta?: Record<string, TriggerValue>;
    nationChiefGeneralId?: number | null;
    cityMeta?: Record<string, TriggerValue>;
    currentYear?: number;
    scenarioConst?: Record<string, unknown>;
    generalActionModules?: ReadonlyArray<GeneralActionModule>;
    clock?: Pick<TurnWorldState, 'clockBaseTime' | 'clockTick' | 'clockMode' | 'clockWallAnchor' | 'lastTurnTick'>;
}) => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: options.currentYear ?? 185,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0185-01-01T00:00:00Z'),
        meta: { killturn: 24, scenarioMeta: { startYear: 180 } },
        ...options.clock,
    };
    const snapshot: TurnWorldSnapshot = {
        generals: options.generals ?? [
            buildGeneral(1, { officerLevel: 12 }),
            buildGeneral(2, { officerLevel: 5 }),
            buildGeneral(3),
        ],
        cities: [
            {
                id: 1,
                name: '허창',
                nationId: 1,
                level: 7,
                state: 0,
                population: 1_000,
                populationMax: 2_000,
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
                meta: options.cityMeta ?? {},
            },
        ],
        nations: [
            {
                id: 1,
                name: '위',
                color: '#777777',
                capitalCityId: 1,
                chiefGeneralId: options.nationChiefGeneralId === undefined ? 1 : options.nationChiefGeneralId,
                gold: 10_000,
                rice: 20_000,
                power: 0,
                level: 3,
                typeCode: 'che_법가',
                meta: options.nationMeta ?? {},
            },
        ],
        troops: [],
        diplomacy: [],
        events: [],
        initialEvents: [],
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 65 },
            iconPath: '',
            map: {},
            const: { defaultGold: 1000, defaultRice: 1000, ...options.scenarioConst },
            environment: { mapName: 'test', unitSet: 'test' },
        },
        scenarioMeta: {
            title: 'test',
            startYear: 180,
            life: null,
            fiction: null,
            history: [],
            ignoreDefaultEvents: false,
        },
        map: {
            id: 'test',
            name: 'test',
            cities: [],
            defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
        },
    };
    const world = new InMemoryTurnWorld(state, snapshot, { schedule });
    return {
        snapshot,
        state,
        world,
        handler: createTurnDaemonCommandHandler({ world, generalActionModules: options.generalActionModules }),
    };
};
