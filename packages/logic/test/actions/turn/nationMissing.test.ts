import { describe, expect, it } from 'vitest';
import type { City, General, Nation } from '../../../src/domain/entities.js';
import type { ConstraintContext, RequirementKey, StateView } from '../../../src/constraints/types.js';
import { evaluateConstraints } from '../../../src/constraints/evaluate.js';
import { resolveGeneralAction } from '../../../src/actions/engine.js';
import type { MapDefinition } from '../../../src/world/types.js';
import type { TurnSchedule } from '../../../src/turn/calendar.js';
import type { TurnCommandEnv } from '../../../src/actions/turn/commandEnv.js';
import { ActionDefinition as StopWarProposalAction } from '../../../src/actions/turn/nation/che_종전제의.js';
import { ActionDefinition as ScorchedEarthAction } from '../../../src/actions/turn/nation/che_초토화.js';
import { ActionDefinition as CounterStrategyAction } from '../../../src/actions/turn/nation/che_피장파장.js';
import { ActionDefinition as PopulationMoveAction } from '../../../src/actions/turn/nation/cr_인구이동.js';
import { ActionDefinition as EventWonyungAction } from '../../../src/actions/turn/nation/event_원융노병연구.js';
import { ActionDefinition as EventHwasibyeongAction } from '../../../src/actions/turn/nation/event_화시병연구.js';
import { ActionDefinition as EventEumgwiAction } from '../../../src/actions/turn/nation/event_음귀병연구.js';
import { ActionDefinition as EventDaegeomAction } from '../../../src/actions/turn/nation/event_대검병연구.js';
import { ActionDefinition as EventHwarunAction } from '../../../src/actions/turn/nation/event_화륜차연구.js';
import { ActionDefinition as EventSanjeoAction } from '../../../src/actions/turn/nation/event_산저병연구.js';
import { ActionDefinition as EventGeukAction } from '../../../src/actions/turn/nation/event_극병연구.js';
import { ActionDefinition as EventSangAction } from '../../../src/actions/turn/nation/event_상병연구.js';
import { ActionDefinition as EventMuheeAction } from '../../../src/actions/turn/nation/event_무희연구.js';

class TestStateView implements StateView {
    private readonly store = new Map<string, unknown>();

    has(req: RequirementKey): boolean {
        return this.store.has(this.getKey(req));
    }

    get(req: RequirementKey): unknown | null {
        return this.store.get(this.getKey(req)) ?? null;
    }

    set(req: RequirementKey, value: unknown): void {
        this.store.set(this.getKey(req), value);
    }

    private getKey(req: RequirementKey): string {
        switch (req.kind) {
            case 'general':
                return `general:${req.id}`;
            case 'generalList':
                return 'general:list';
            case 'city':
                return `city:${req.id}`;
            case 'nation':
                return `nation:${req.id}`;
            case 'destGeneral':
                return `destGeneral:${req.id}`;
            case 'destCity':
                return `destCity:${req.id}`;
            case 'destNation':
                return `destNation:${req.id}`;
            case 'diplomacy':
                return `diplomacy:${req.srcNationId}:${req.destNationId}`;
            case 'diplomacyList':
                return 'diplomacy:list';
            case 'arg':
                return `arg:${req.key}`;
            case 'env':
                return `env:${req.key}`;
            default:
                return 'unknown';
        }
    }
}

const buildGeneral = (id: number, nationId: number, cityId: number, name = 'TestGeneral'): General => ({
    id,
    name,
    nationId,
    cityId,
    troopId: 0,
    stats: {
        leadership: 70,
        strength: 70,
        intelligence: 70,
    },
    experience: 100,
    dedication: 100,
    officerLevel: 3,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: {
            horse: null,
            weapon: null,
            book: null,
            item: null,
        },
    },
    injury: 0,
    gold: 1000,
    rice: 2000,
    crew: 1500,
    crewTypeId: 100,
    train: 80,
    atmos: 80,
    age: 25,
    npcState: 0,
    triggerState: {
        flags: {},
        counters: {},
        modifiers: {},
        meta: {},
    },
    meta: { killturn: 24 },
});

const buildCity = (id: number, nationId: number, name = `City${id}`): City => ({
    id,
    name,
    nationId,
    level: 2,
    state: 0,
    population: 60000,
    populationMax: 100000,
    agriculture: 1000,
    agricultureMax: 2000,
    commerce: 1000,
    commerceMax: 2000,
    security: 1000,
    securityMax: 2000,
    supplyState: 1,
    frontState: 0,
    defence: 400,
    defenceMax: 800,
    wall: 300,
    wallMax: 600,
    meta: {},
});

const buildNation = (id: number, name = 'Nation'): Nation => ({
    id,
    name: `${name}${id}`,
    color: '#000000',
    capitalCityId: id,
    chiefGeneralId: id,
    gold: 5000,
    rice: 5000,
    power: 0,
    level: 1,
    typeCode: 'test',
    meta: {
        tech: 1000,
        strategic_cmd_limit: 0,
        surlimit: 0,
    },
});

const buildMap = (fromId: number, toId: number): MapDefinition => ({
    id: 'test',
    name: 'test',
    cities: [
        {
            id: fromId,
            name: `City${fromId}`,
            connections: [toId],
            level: 1,
            region: 1,
            position: { x: 0, y: 0 },
            max: {} as any,
            initial: {} as any,
        },
        {
            id: toId,
            name: `City${toId}`,
            connections: [fromId],
            level: 1,
            region: 1,
            position: { x: 1, y: 1 },
            max: {} as any,
            initial: {} as any,
        },
    ],
});

const schedule: TurnSchedule = {
    entries: [{ startMinute: 0, tickMinutes: 60 }],
};

const buildEnv = (): TurnCommandEnv => ({
    develCost: 1000,
    trainDelta: 0,
    atmosDelta: 0,
    maxTrainByCommand: 0,
    maxAtmosByCommand: 0,
    sabotageDefaultProb: 0,
    sabotageProbCoefByStat: 0,
    sabotageDefenceCoefByGeneralCount: 0,
    sabotageDamageMin: 0,
    sabotageDamageMax: 0,
    openingPartYear: 0,
    maxGeneral: 0,
    defaultNpcGold: 0,
    defaultNpcRice: 0,
    defaultCrewTypeId: 0,
    defaultSpecialDomestic: null,
    defaultSpecialWar: null,
    initialNationGenLimit: 10,
    maxTechLevel: 0,
    baseGold: 0,
    baseRice: 0,
    maxResourceActionAmount: 100000,
});

const setupDiplomacy = (
    view: TestStateView,
    srcNationId: number,
    destNationId: number,
    state: number,
    term = 0
) => {
    view.set(
        {
            kind: 'diplomacy',
            srcNationId,
            destNationId,
        },
        {
            state,
            term,
        }
    );
};

describe('Nation Missing Actions', () => {
    it('che_종전제의: blocks when not at war/declare', () => {
        const general = buildGeneral(1, 1, 1);
        const nation = buildNation(1);
        const destNation = buildNation(2);
        const city = buildCity(1, 1);
        const view = new TestStateView();
        view.set({ kind: 'general', id: general.id }, general);
        view.set({ kind: 'city', id: city.id }, city);
        view.set({ kind: 'nation', id: nation.id }, nation);
        view.set({ kind: 'destNation', id: destNation.id }, destNation);
        setupDiplomacy(view, nation.id, destNation.id, 2);

        const definition = new StopWarProposalAction();
        const args = { destNationId: destNation.id };
        const ctx: ConstraintContext = {
            actorId: general.id,
            nationId: nation.id,
            cityId: city.id,
            destNationId: destNation.id,
            args,
            env: {},
            mode: 'full',
        };

        const result = evaluateConstraints(definition.buildConstraints(ctx, args), ctx, view);
        expect(result.kind).toBe('deny');
    });

    it('che_종전제의: emits proposal log', () => {
        const general = buildGeneral(1, 1, 1);
        const nation = buildNation(1);
        const city = buildCity(1, 1);
        const destNation = buildNation(2);

        const definition = new StopWarProposalAction();
        const resolution = resolveGeneralAction(
            definition,
            {
                general,
                city,
                nation,
                rng: {} as any,
                addLog: () => {},
            } as any,
            { now: new Date(), schedule },
            { destNationId: destNation.id }
        );

        expect(resolution.logs.some((log) => log.text.includes('종전 제의'))).toBe(true);
    });

    it('che_피장파장: blocks when not at war/declare', () => {
        const general = buildGeneral(1, 1, 1);
        const nation = buildNation(1);
        const destNation = buildNation(2);
        const city = buildCity(1, 1);
        const view = new TestStateView();
        view.set({ kind: 'general', id: general.id }, general);
        view.set({ kind: 'city', id: city.id }, city);
        view.set({ kind: 'nation', id: nation.id }, nation);
        view.set({ kind: 'destNation', id: destNation.id }, destNation);
        setupDiplomacy(view, nation.id, destNation.id, 2);

        const definition = new CounterStrategyAction();
        const args = { destNationId: destNation.id, commandType: 'che_허보' } as const;
        const ctx: ConstraintContext = {
            actorId: general.id,
            nationId: nation.id,
            cityId: city.id,
            destNationId: destNation.id,
            args,
            env: {},
            mode: 'full',
        };

        const result = evaluateConstraints(definition.buildConstraints(ctx, args), ctx, view);
        expect(result.kind).toBe('deny');
    });

    it('che_피장파장: applies strategic delay and experience gain', () => {
        const general = buildGeneral(1, 1, 1);
        const nation = buildNation(1);
        const destNation = buildNation(2);
        const city = buildCity(1, 1);
        const otherGeneral = buildGeneral(2, 1, 1, 'Ally');
        const enemyGeneral = buildGeneral(3, 2, 2, 'Enemy');

        const definition = new CounterStrategyAction();
        const resolution = resolveGeneralAction(
            definition,
            {
                general,
                city,
                nation,
                destNation,
                friendlyGenerals: [general, otherGeneral],
                destNationGenerals: [enemyGeneral],
                rng: {} as any,
                addLog: () => {},
            } as any,
            { now: new Date(), schedule },
            { destNationId: destNation.id, commandType: 'che_허보' } as const
        );

        expect(resolution.general.experience).toBeGreaterThan(100);
        expect(resolution.nation?.meta?.strategic_cmd_limit).toBe(8);
    });

    it('che_초토화: blocks when diplomacy limit exists', () => {
        const general = buildGeneral(1, 1, 1);
        const nation = buildNation(1);
        nation.meta.surlimit = 1;
        const destNation = buildNation(2);
        const city = buildCity(1, 1);
        const destCity = buildCity(2, 2);
        const view = new TestStateView();
        view.set({ kind: 'general', id: general.id }, general);
        view.set({ kind: 'city', id: city.id }, city);
        view.set({ kind: 'nation', id: nation.id }, nation);
        view.set({ kind: 'destCity', id: destCity.id }, destCity);
        view.set({ kind: 'destNation', id: destNation.id }, destNation);
        setupDiplomacy(view, nation.id, destNation.id, 1);

        const definition = new ScorchedEarthAction();
        const args = { destCityId: destCity.id };
        const ctx: ConstraintContext = {
            actorId: general.id,
            nationId: nation.id,
            cityId: city.id,
            destCityId: destCity.id,
            destNationId: destNation.id,
            args,
            env: {},
            mode: 'full',
        };

        const result = evaluateConstraints(definition.buildConstraints(ctx, args), ctx, view);
        expect(result.kind).toBe('deny');
    });

    it('che_초토화: neutralizes city and increases nation resources', () => {
        const general = buildGeneral(1, 1, 1);
        const nation = buildNation(1);
        const destNation = buildNation(2);
        const city = buildCity(1, 1);
        const destCity = buildCity(2, 2);

        const definition = new ScorchedEarthAction();
        const resolution = resolveGeneralAction(
            definition,
            {
                general,
                city,
                nation,
                destCity,
                destNation,
                rng: {} as any,
                addLog: () => {},
            } as any,
            { now: new Date(), schedule },
            { destCityId: destCity.id }
        );

        const destPatch = resolution.patches?.cities.find((patch) => patch.id === destCity.id);
        expect(destPatch?.patch.nationId).toBe(0);
        expect(resolution.nation?.gold).toBeGreaterThan(nation.gold);
        expect((resolution.nation?.meta?.surlimit as number) ?? 0).toBeGreaterThan(0);
    });

    it('cr_인구이동: blocks without enough gold', () => {
        const general = buildGeneral(1, 1, 1);
        const nation = buildNation(1);
        nation.gold = 0;
        const destNation = buildNation(2);
        const city = buildCity(1, 1);
        const destCity = buildCity(2, 1);
        const view = new TestStateView();
        view.set({ kind: 'general', id: general.id }, general);
        view.set({ kind: 'city', id: city.id }, city);
        view.set({ kind: 'nation', id: nation.id }, nation);
        view.set({ kind: 'destCity', id: destCity.id }, destCity);
        view.set({ kind: 'destNation', id: destNation.id }, destNation);
        view.set({ kind: 'env', key: 'map' }, buildMap(city.id, destCity.id));

        const definition = new PopulationMoveAction(buildEnv());
        const args = { destCityId: destCity.id, amount: 10000 };
        const ctx: ConstraintContext = {
            actorId: general.id,
            nationId: nation.id,
            cityId: city.id,
            destCityId: destCity.id,
            args,
            env: {
                map: buildMap(city.id, destCity.id),
            },
            mode: 'full',
        };

        const result = evaluateConstraints(definition.buildConstraints(ctx, args), ctx, view);
        expect(result.kind).toBe('deny');
    });

    it('cr_인구이동: moves population and pays cost', () => {
        const general = buildGeneral(1, 1, 1);
        const nation = buildNation(1);
        const city = buildCity(1, 1);
        const destCity = buildCity(2, 1);

        const definition = new PopulationMoveAction(buildEnv());
        const resolution = resolveGeneralAction(
            definition,
            {
                general,
                city,
                nation,
                destCity,
                rng: {} as any,
                addLog: () => {},
            } as any,
            { now: new Date(), schedule },
            { destCityId: destCity.id, amount: 10000 }
        );

        const destPatch = resolution.patches?.cities.find((patch) => patch.id === destCity.id);
        expect(destPatch?.patch.population).toBe(destCity.population + 10000);
        expect(resolution.city?.population).toBe(city.population - 10000);
        expect(resolution.nation?.gold).toBeLessThan(nation.gold);
    });

    const eventCommands = [
        { Action: EventWonyungAction, auxKey: 'can_원융노병사용', cost: 100000 },
        { Action: EventHwasibyeongAction, auxKey: 'can_화시병사용', cost: 50000 },
        { Action: EventEumgwiAction, auxKey: 'can_음귀병사용', cost: 50000 },
        { Action: EventDaegeomAction, auxKey: 'can_대검병사용', cost: 50000 },
        { Action: EventHwarunAction, auxKey: 'can_화륜차사용', cost: 100000 },
        { Action: EventSanjeoAction, auxKey: 'can_산저병사용', cost: 50000 },
        { Action: EventGeukAction, auxKey: 'can_극병사용', cost: 100000 },
        { Action: EventSangAction, auxKey: 'can_상병사용', cost: 100000 },
        { Action: EventMuheeAction, auxKey: 'can_무희사용', cost: 100000 },
    ];

    for (const entry of eventCommands) {
        it(`${entry.auxKey}: blocks when already researched`, () => {
            const general = buildGeneral(1, 1, 1);
            const nation = buildNation(1);
            nation.meta[entry.auxKey] = 1;
            const city = buildCity(1, 1);
            const view = new TestStateView();
            view.set({ kind: 'general', id: general.id }, general);
            view.set({ kind: 'city', id: city.id }, city);
            view.set({ kind: 'nation', id: nation.id }, nation);

            const definition = new entry.Action(buildEnv());
            const args = {};
            const ctx: ConstraintContext = {
                actorId: general.id,
                nationId: nation.id,
                cityId: city.id,
                args,
                env: {},
                mode: 'full',
            };

            const result = evaluateConstraints(definition.buildConstraints(ctx, args), ctx, view);
            expect(result.kind).toBe('deny');
        });

        it(`${entry.auxKey}: applies nation meta`, () => {
            const general = buildGeneral(1, 1, 1);
            const nation = buildNation(1);
            const city = buildCity(1, 1);
            const definition = new entry.Action(buildEnv());

            const resolution = resolveGeneralAction(
                definition,
                {
                    general,
                    city,
                    nation,
                    rng: {} as any,
                    addLog: () => {},
                } as any,
                { now: new Date(), schedule },
                {}
            );

            expect(resolution.nation?.meta?.[entry.auxKey]).toBe(1);
            expect(resolution.nation?.gold).toBe(nation.gold - entry.cost);
        });
    }
});
