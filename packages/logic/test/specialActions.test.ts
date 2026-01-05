import { describe, expect, it } from 'vitest';

import { ConstantRNG, RandUtil } from '@sammo-ts/common';

import type { City, General, Nation } from '../src/domain/entities.js';
import type { RandomGenerator } from '../src/index.js';
import type { UnitSetDefinition } from '../src/world/types.js';
import { GeneralActionPipeline } from '../src/triggers/general-action.js';
import { createGeneralTriggerContext } from '../src/triggers/general.js';
import {
    createTraitModuleRegistry,
    createTraitModules,
    loadDomesticTraitModules,
    loadWarTraitModules,
} from '../src/triggers/special/index.js';
import { ActionLogger } from '../src/logging/actionLogger.js';
import { WarActionPipeline } from '../src/war/actions.js';
import { WarCrewType } from '../src/war/crewType.js';
import { createWarTriggerEnv } from '../src/war/triggers.js';
import type { WarEngineConfig } from '../src/war/types.js';
import { WarUnitCity, WarUnitGeneral } from '../src/war/units.js';

const buildGeneral = (overrides: Partial<General> = {}): General => ({
    id: 1,
    name: 'Tester',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: {
        leadership: 80,
        strength: 70,
        intelligence: 60,
    },
    experience: 0,
    dedication: 0,
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
    rice: 1000,
    crew: 1000,
    crewTypeId: 100,
    train: 80,
    atmos: 80,
    age: 20,
    npcState: 0,
    triggerState: {
        flags: {},
        counters: {},
        modifiers: {},
        meta: {},
    },
    meta: {},
    ...overrides,
});

const buildCity = (): City => ({
    id: 1,
    name: 'TestCity',
    nationId: 1,
    level: 2,
    state: 0,
    population: 10000,
    populationMax: 10000,
    agriculture: 500,
    agricultureMax: 1000,
    commerce: 500,
    commerceMax: 1000,
    security: 500,
    securityMax: 1000,
    defence: 100,
    defenceMax: 200,
    supplyState: 1,
    frontState: 0,
    wall: 100,
    wallMax: 200,
    meta: {},
});

const buildNation = (): Nation => ({
    id: 1,
    name: 'TestNation',
    color: '#000000',
    capitalCityId: 1,
    chiefGeneralId: null,
    gold: 1000,
    rice: 1000,
    power: 0,
    level: 1,
    typeCode: 'test',
    meta: {},
});

const buildConfig = (): WarEngineConfig => ({
    armPerPhase: 500,
    maxTrainByCommand: 100,
    maxAtmosByCommand: 100,
    maxTrainByWar: 110,
    maxAtmosByWar: 150,
    castleCrewTypeId: 999,
    armTypes: {
        footman: 1,
        wizard: 4,
        siege: 5,
        misc: 6,
        castle: 9,
    },
});

const buildUnitSet = (): UnitSetDefinition => ({
    id: 'test',
    name: 'test',
    crewTypes: [
        {
            id: 100,
            armType: 1,
            name: '보병',
            attack: 100,
            defence: 100,
            speed: 7,
            avoid: 10,
            magicCoef: 0,
            cost: 9,
            rice: 9,
            requirements: [],
            attackCoef: {},
            defenceCoef: {},
            info: [],
            initSkillTrigger: null,
            phaseSkillTrigger: null,
            iActionList: null,
        },
        {
            id: 999,
            armType: 9,
            name: '성벽',
            attack: 0,
            defence: 0,
            speed: 1,
            avoid: 0,
            magicCoef: 0,
            cost: 0,
            rice: 0,
            requirements: [],
            attackCoef: {},
            defenceCoef: {},
            info: [],
            initSkillTrigger: null,
            phaseSkillTrigger: null,
            iActionList: null,
        },
    ],
});

describe('trait modules', () => {
    it('loads trait modules by key', async () => {
        const domestic = await loadDomesticTraitModules(['che_인덕', 'che_발명']);
        const war = await loadWarTraitModules(['che_의술', 'che_징병']);

        expect(domestic.map((module) => module.key)).toEqual(['che_인덕', 'che_발명']);
        expect(war.map((module) => module.key)).toEqual(['che_의술', 'che_징병']);
    });

    it('applies domestic and war modifiers in general pipeline', async () => {
        const domestic = await loadDomesticTraitModules(['che_인덕', 'che_발명']);
        const war = await loadWarTraitModules(['che_의술', 'che_징병']);
        const registry = createTraitModuleRegistry({ domestic, war });
        const traitModules = createTraitModules(registry);

        const pipeline = new GeneralActionPipeline(traitModules.general);
        const general = buildGeneral({
            role: {
                personality: null,
                specialDomestic: 'che_인덕',
                specialWar: 'che_징병',
                items: {
                    horse: null,
                    weapon: null,
                    book: null,
                    item: null,
                },
            },
        });

        const context = { general };
        expect(pipeline.onCalcDomestic(context, '민심', 'score', 100)).toBeCloseTo(110);
        expect(pipeline.onCalcDomestic(context, '징병', 'train', 40)).toBe(70);
        expect(pipeline.onCalcStat(context, 'leadership', 80)).toBe(100);
    });

    it('heals city generals with 의술 pre-turn trigger', async () => {
        const domestic = await loadDomesticTraitModules(['che_인덕', 'che_발명']);
        const war = await loadWarTraitModules(['che_의술', 'che_징병']);
        const registry = createTraitModuleRegistry({ domestic, war });
        const traitModules = createTraitModules(registry);
        const pipeline = new GeneralActionPipeline(traitModules.general);

        const general = buildGeneral({
            injury: 20,
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: 'che_의술',
                items: {
                    horse: null,
                    weapon: null,
                    book: null,
                    item: null,
                },
            },
        });
        const patient = buildGeneral({
            id: 2,
            name: 'Patient',
            injury: 15,
        });
        const worldView = {
            listGeneralsByCity: (_cityId: number) => [general, patient],
            listGenerals: () => [general, patient],
        };
        const rng: RandomGenerator = {
            nextFloat: () => 0,
            nextBool: () => true,
            nextInt: (minInclusive: number, _maxExclusive: number) => minInclusive,
        };

        const caller = pipeline.getPreTurnExecuteTriggerList({
            general,
            worldView,
        });
        const triggerContext = createGeneralTriggerContext({
            general,
            rng,
            worldView,
            log: { push: () => {} },
        });
        caller.fire(triggerContext, {});

        expect(general.injury).toBe(0);
        expect(patient.injury).toBe(0);
        expect(general.triggerState.flags['pre.치료']).toBe(true);
    });

    it('activates 의술 battle trigger and reduces damage', async () => {
        const domestic = await loadDomesticTraitModules(['che_인덕', 'che_발명']);
        const war = await loadWarTraitModules(['che_의술', 'che_징병']);
        const registry = createTraitModuleRegistry({ domestic, war });
        const traitModules = createTraitModules(registry);

        const rng = new RandUtil(new ConstantRNG(0));
        const config = buildConfig();
        const unitSet = buildUnitSet();
        const crewType = new WarCrewType(unitSet.crewTypes![0]!);
        const city = buildCity();
        const nation = buildNation();
        const general = buildGeneral({
            injury: 10,
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: 'che_의술',
                items: {
                    horse: null,
                    weapon: null,
                    book: null,
                    item: null,
                },
            },
        });

        const attacker = new WarUnitGeneral(
            rng,
            config,
            general,
            city,
            nation,
            true,
            crewType,
            new ActionLogger({ generalId: 1, nationId: 1 }),
            new WarActionPipeline(traitModules.war)
        );
        const defender = new WarUnitCity(
            rng,
            config,
            city,
            nation,
            new WarCrewType(unitSet.crewTypes![1]!),
            new ActionLogger({}),
            200,
            180
        );

        attacker.setOppose(defender);
        defender.setOppose(attacker);
        attacker.beginPhase();

        const caller = attacker.getActionPipeline().getBattlePhaseTriggerList(attacker.getActionContext());
        caller.fire({ rng, attacker, defender }, createWarTriggerEnv());

        expect(defender.getWarPowerMultiply()).toBeCloseTo(0.7);
        expect(general.injury).toBe(0);
    });
});
