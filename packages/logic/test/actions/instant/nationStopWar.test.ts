import { describe, expect, it } from 'vitest';
import type { City, General, Nation } from '../../../src/domain/entities.js';
import type { ConstraintContext, RequirementKey, StateView } from '../../../src/constraints/types.js';
import { evaluateConstraints } from '../../../src/constraints/evaluate.js';
import { resolveGeneralAction } from '../../../src/actions/engine.js';
import type { TurnSchedule } from '../../../src/turn/calendar.js';
import { ActionDefinition as StopWarAcceptAction } from '../../../src/actions/instant/nation/che_종전수락.js';

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
            case 'city':
                return `city:${req.id}`;
            case 'nation':
                return `nation:${req.id}`;
            case 'destGeneral':
                return `destGeneral:${req.id}`;
            case 'destNation':
                return `destNation:${req.id}`;
            case 'diplomacy':
                return `diplomacy:${req.srcNationId}:${req.destNationId}`;
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
    meta: {},
});

const buildCity = (id: number, nationId: number): City => ({
    id,
    name: `City${id}`,
    nationId,
    level: 2,
    state: 0,
    population: 10000,
    populationMax: 10000,
    agriculture: 1000,
    agricultureMax: 1000,
    commerce: 1000,
    commerceMax: 1000,
    security: 1000,
    securityMax: 1000,
    supplyState: 1,
    frontState: 0,
    defence: 200,
    defenceMax: 400,
    wall: 200,
    wallMax: 400,
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
    meta: {},
});

const schedule: TurnSchedule = {
    entries: [{ startMinute: 0, tickMinutes: 60 }],
};

describe('Nation Instant Actions', () => {
    it('che_종전수락: blocks when not at war/declare', () => {
        const general = buildGeneral(1, 1, 1);
        const nation = buildNation(1);
        const destNation = buildNation(2);
        const destGeneral = buildGeneral(2, 2, 2, 'Dest');
        const city = buildCity(1, 1);
        const view = new TestStateView();
        view.set({ kind: 'general', id: general.id }, general);
        view.set({ kind: 'city', id: city.id }, city);
        view.set({ kind: 'nation', id: nation.id }, nation);
        view.set({ kind: 'destNation', id: destNation.id }, destNation);
        view.set({ kind: 'destGeneral', id: destGeneral.id }, destGeneral);
        view.set(
            {
                kind: 'diplomacy',
                srcNationId: nation.id,
                destNationId: destNation.id,
            },
            { state: 2, term: 0 }
        );

        const definition = new StopWarAcceptAction();
        const args = { destNationId: destNation.id, destGeneralId: destGeneral.id };
        const ctx: ConstraintContext = {
            actorId: general.id,
            nationId: nation.id,
            cityId: city.id,
            destNationId: destNation.id,
            destGeneralId: destGeneral.id,
            args,
            env: {},
            mode: 'full',
        };

        const result = evaluateConstraints(definition.buildConstraints(ctx, args), ctx, view);
        expect(result.kind).toBe('deny');
    });

    it('che_종전수락: patches diplomacy to neutral', () => {
        const general = buildGeneral(1, 1, 1);
        const nation = buildNation(1);
        const city = buildCity(1, 1);
        const destNation = buildNation(2);

        const definition = new StopWarAcceptAction();
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
            { destNationId: destNation.id, destGeneralId: 2 }
        );

        const patches = resolution.effects.filter((effect) => effect.type === 'diplomacy:patch');
        expect(patches).toHaveLength(2);
        for (const patch of patches) {
            expect(patch.patch.state).toBe(2);
            expect(patch.patch.term).toBe(0);
        }
    });
});
