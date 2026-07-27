import { describe, expect, it } from 'vitest';
import type { City, Nation, NationTraitModule } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createProcessSemiAnnualHandler } from '../src/turn/monthlySemiAnnualAction.js';
import type { TurnEvent, TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const buildCity = (id: number, patch: Partial<City> = {}): City => ({
    id,
    name: `도시${id}`,
    nationId: 1,
    level: 4,
    state: 0,
    population: 10_000,
    populationMax: 50_000,
    agriculture: 1_001,
    agricultureMax: 5_000,
    commerce: 1_001,
    commerceMax: 5_000,
    security: 1_001,
    securityMax: 2_000,
    supplyState: 1,
    frontState: 0,
    defence: 1_001,
    defenceMax: 5_000,
    wall: 1_001,
    wallMax: 5_000,
    conflict: {},
    meta: { trust: 55, dead: 123, marker: id },
    ...patch,
});

const buildNation = (id: number, patch: Partial<Nation> = {}): Nation => ({
    id,
    name: `국가${id}`,
    color: '#777777',
    capitalCityId: null,
    chiefGeneralId: null,
    gold: 1_000,
    rice: 1_000,
    power: 0,
    level: 1,
    typeCode: 'che_중립',
    meta: { rate: 20 },
    ...patch,
});

const buildGeneral = (id: number, patch: Partial<TurnGeneral> = {}): TurnGeneral => ({
    id,
    name: `장수${id}`,
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    experience: 0,
    dedication: 0,
    officerLevel: 0,
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
    meta: { killturn: 1_000 },
    turnTime: new Date('0193-01-01T00:00:00.000Z'),
    ...patch,
});

const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [['ProcessSemiAnnual', 'gold']],
    meta: {},
};

const populationTrait: NationTraitModule = {
    key: 'test-population',
    name: '인구 보정 시험',
    info: '',
    kind: 'nation',
    onCalcNationalIncome: (_context, type, amount) => (type === 'pop' ? amount * 1.2 : amount),
};

const buildHarness = (
    options: {
        cities?: City[];
        nations?: Nation[];
        generals?: TurnGeneral[];
        configConst?: Record<string, unknown>;
        traits?: ReadonlyMap<string, NationTraitModule>;
    } = {}
) => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 193,
        currentMonth: 1,
        tickSeconds: 600,
        lastTurnTime: new Date('0193-01-01T00:00:00.000Z'),
        meta: {},
    };
    const snapshot: TurnWorldSnapshot = {
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: options.configConst ?? {},
            environment: { mapName: 'test', unitSet: 'default' },
        },
        map: {
            id: 'test',
            name: 'test',
            cities: [],
            defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
        },
        generals: options.generals ?? [],
        cities: options.cities ?? [],
        nations: options.nations ?? [],
        troops: [],
        diplomacy: [],
        events: [event],
        initialEvents: [],
    };
    const world = new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
    });
    const handler = createProcessSemiAnnualHandler({
        getWorld: () => world,
        nationTraits: options.traits,
    });
    return { world, handler };
};

const environment = {
    year: 193,
    month: 1,
    startyear: 190,
    currentEventID: 1,
    turnTime: new Date('0193-01-01T00:00:00.000Z'),
};

describe('ProcessSemiAnnual monthly action', () => {
    it('preserves the global popIncrease order, neutral double decay, supplied filtering, and nation trait', async () => {
        const { world, handler } = buildHarness({
            configConst: { basePopIncreaseAmount: 15_000 },
            cities: [buildCity(1), buildCity(2, { supplyState: 0 }), buildCity(3, { nationId: 0 })],
            nations: [buildNation(1, { typeCode: populationTrait.key })],
            traits: new Map([[populationTrait.key, populationTrait]]),
        });

        await handler(['gold'], environment, event);

        expect(world.getCityById(1)).toMatchObject({
            population: 25_630,
            agriculture: 991,
            commerce: 991,
            security: 991,
            defence: 991,
            wall: 991,
            meta: { trust: 55, dead: 0, marker: 1 },
        });
        expect(world.getCityById(2)).toMatchObject({
            population: 10_000,
            agriculture: 991,
            meta: { trust: 55, dead: 0, marker: 2 },
        });
        expect(world.getCityById(3)).toMatchObject({
            population: 10_000,
            agriculture: 981,
            commerce: 981,
            security: 981,
            defence: 981,
            wall: 981,
            meta: { trust: 50, dead: 0, marker: 3 },
        });
        expect(world.peekDirtyState().logs).toEqual([]);
    });

    it('uses the negative population security branch and clamps population, domestic stats, and trust', async () => {
        const { world, handler } = buildHarness({
            cities: [
                buildCity(1, {
                    population: 49_000,
                    populationMax: 50_000,
                    agriculture: 4_999,
                    agricultureMax: 5_000,
                    commerce: 4_999,
                    commerceMax: 5_000,
                    security: 1_500,
                    securityMax: 2_000,
                    defence: 4_999,
                    defenceMax: 5_000,
                    wall: 4_999,
                    wallMax: 5_000,
                    meta: { trust: 5, dead: 1 },
                }),
            ],
            nations: [buildNation(1, { meta: { rate: 50 } })],
        });

        await handler(['gold'], environment, event);

        expect(world.getCityById(1)).toMatchObject({
            population: 49_464,
            agriculture: 4_207,
            commerce: 4_207,
            security: 1_262,
            defence: 4_207,
            wall: 4_207,
            meta: { trust: 0, dead: 0 },
        });
    });

    it('uses the staged rate_tmp when the desired rate changes mid-period', async () => {
        const { world, handler } = buildHarness({
            cities: [buildCity(1)],
            nations: [buildNation(1, { meta: { rate: 50, rate_tmp: 20 } })],
        });

        await handler(['gold'], environment, event);

        expect(world.getCityById(1)).toMatchObject({
            population: 15_525,
            agriculture: 991,
            commerce: 991,
            security: 991,
            defence: 991,
            wall: 991,
            meta: { trust: 55, dead: 0 },
        });
    });

    it('applies strict legacy resource thresholds to generals and nations for either resource', async () => {
        const amounts = [1_000, 1_001, 10_000, 10_001, 100_000, 100_001];
        const { world, handler } = buildHarness({
            generals: amounts.map((amount, index) => buildGeneral(index + 1, { gold: amount, rice: amount })),
            nations: amounts.map((amount, index) =>
                buildNation(index + 1, { gold: amount, rice: amount, meta: { rate: 20 } })
            ),
        });

        await handler(['gold'], environment, event);
        await handler(['rice'], environment, event);

        expect(world.listGenerals().map((general) => general.gold)).toEqual([1_000, 991, 9_900, 9_701, 97_000, 97_001]);
        expect(world.listGenerals().map((general) => general.rice)).toEqual([1_000, 991, 9_900, 9_701, 97_000, 97_001]);
        expect(world.listNations().map((nation) => nation.gold)).toEqual([1_000, 991, 9_900, 9_701, 97_000, 95_001]);
        expect(world.listNations().map((nation) => nation.rice)).toEqual([1_000, 991, 9_900, 9_701, 97_000, 95_001]);
    });

    it('rejects resources outside the legacy enum', () => {
        const { handler } = buildHarness();

        expect(() => {
            void handler(['tech'], environment, event);
        }).toThrow('ProcessSemiAnnual requires resource "gold" or "rice".');
    });
});
