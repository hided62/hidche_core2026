import { describe, expect, it } from 'vitest';

import { ConstantRNG, RandUtil } from '@sammo-ts/common';

import type { City, General, Nation } from '../src/domain/entities.js';
import type { UnitSetDefinition } from '../src/world/types.js';
import { ActionLogger } from '../src/logging/actionLogger.js';
import { WarActionPipeline } from '../src/war/actions.js';
import { resolveWarBattle } from '../src/war/engine.js';
import type { WarEngineConfig } from '../src/war/types.js';
import { WarCrewType } from '../src/war/crewType.js';
import { loadWarTriggerModules } from '../src/war/triggers/index.js';
import { WarUnitCity, WarUnitGeneral } from '../src/war/units.js';

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
    meta: {
        tech: 3000,
    },
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

const buildGeneral = (strength: number): General => ({
    id: 1,
    name: 'Tester',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: {
        leadership: 70,
        strength,
        intelligence: 70,
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
    meta: {
        dex1: 5000,
    },
});

describe('war triggers', () => {
    it('activates and applies critical damage', async () => {
        const rng = new RandUtil(new ConstantRNG(0));
        const config = buildConfig();
        const crewType = new WarCrewType(buildUnitSet().crewTypes![0]!);
        const nation = buildNation();
        const city = buildCity();

        const attacker = new WarUnitGeneral(
            rng,
            config,
            buildGeneral(80),
            city,
            nation,
            true,
            crewType,
            new ActionLogger({ generalId: 1, nationId: 1 }),
            new WarActionPipeline([])
        );
        const defender = new WarUnitCity(
            rng,
            config,
            city,
            nation,
            new WarCrewType(buildUnitSet().crewTypes![1]!),
            new ActionLogger({}),
            200,
            180
        );

        attacker.setOppose(defender);
        defender.setOppose(attacker);

        attacker.beginPhase();

        const [module] = await loadWarTriggerModules(['che_필살']);
        if (!module) {
            throw new Error('Missing che_필살 trigger module');
        }
        const caller = module.createTriggerList(attacker);
        if (!caller) {
            throw new Error('Missing che_필살 trigger list');
        }
        caller.fire({ rng, attacker, defender }, { e_attacker: {}, e_defender: {} });

        expect(attacker.hasActivatedSkill('필살')).toBe(true);
        expect(attacker.getWarPowerMultiply()).toBeCloseTo(1.3);
    });
});

describe('resolveWarBattle', () => {
    it('handles supply rout when defender nation has no rice', () => {
        const rng = new RandUtil(new ConstantRNG(0));
        const config = buildConfig();
        const unitSet = buildUnitSet();
        const attackerNation = buildNation();
        const defenderNation = { ...buildNation(), rice: 0 };
        const city = buildCity();

        const outcome = resolveWarBattle({
            rng,
            unitSet,
            config,
            time: {
                year: 200,
                month: 1,
                startYear: 180,
            },
            attacker: {
                general: buildGeneral(80),
                city,
                nation: attackerNation,
            },
            defenders: [],
            defenderCity: city,
            defenderNation,
        });

        expect(outcome.conquered).toBe(true);
        expect(outcome.reports.length).toBeGreaterThan(0);
    });
});
