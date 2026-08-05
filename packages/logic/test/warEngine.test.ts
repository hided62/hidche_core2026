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
import {
    createItemActionModules,
    createItemModuleRegistry,
    equipNewItem,
    getEquippedItemInstance,
    loadItemModules,
} from '../src/items/index.js';

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
        killturn: 24,
        dex1: 5000,
    },
});

describe('war triggers', () => {
    it('normalizes accumulated dexterity to the PHP SQL float precision', () => {
        const general = buildGeneral(80);
        general.meta.dex4 = 14_677.199999999997;
        const wizard = new WarCrewType({
            ...buildUnitSet().crewTypes![0]!,
            id: 104,
            armType: 4,
            name: '귀병',
        });
        const unit = new WarUnitGeneral(
            new RandUtil(new ConstantRNG(0)),
            buildConfig(),
            general,
            buildCity(),
            buildNation(),
            true,
            wizard,
            new ActionLogger({ generalId: 1, nationId: 1 }),
            new WarActionPipeline([])
        );

        unit.addDex(wizard, 2047);

        expect(general.meta.dex4).toBe(16_519.5);
    });

    it('preserves the legacy fractional morale gain after a win', () => {
        const general = buildGeneral(80);
        general.atmos = 105;
        const crewType = new WarCrewType(buildUnitSet().crewTypes![0]!);
        const unit = new WarUnitGeneral(
            new RandUtil(new ConstantRNG(0)),
            buildConfig(),
            general,
            buildCity(),
            buildNation(),
            true,
            crewType,
            new ActionLogger({ generalId: 1, nationId: 1 }),
            new WarActionPipeline([])
        );
        const defenderCity = new WarUnitCity(
            new RandUtil(new ConstantRNG(0)),
            buildConfig(),
            { ...buildCity(), nationId: 2 },
            { ...buildNation(), id: 2 },
            new WarCrewType(buildUnitSet().crewTypes![1]!),
            new ActionLogger({ generalId: 0, nationId: 2 }),
            200,
            180
        );
        unit.setOppose(defenderCity);

        unit.addWin();

        expect(general.atmos).toBeCloseTo(115.5, 12);
    });

    it('updates the legacy experience level and applies item experience modifiers immediately', () => {
        const general = buildGeneral(80);
        general.experience = 90;
        general.meta.explevel = 0;
        const crewType = new WarCrewType(buildUnitSet().crewTypes![0]!);
        const logger = new ActionLogger({ generalId: 1, nationId: 1 });
        const unit = new WarUnitGeneral(
            new RandUtil(new ConstantRNG(0)),
            buildConfig(),
            general,
            buildCity(),
            buildNation(),
            true,
            crewType,
            logger,
            new WarActionPipeline([
                {
                    onCalcStat: (_context, statName, value) =>
                        statName === 'experience' ? (value as number) * 1.2 : value,
                },
            ])
        );

        unit.addLevelExp(10);
        expect(general.experience).toBe(102);
        expect(general.meta.explevel).toBe(1);
        expect(logger.flush()).toContainEqual(
            expect.objectContaining({
                text: '<C>Lv 1</>로 <C>레벨업</>!',
            })
        );
    });

    it('applies the legacy 90% dexterity gain for wizard and siege arms', () => {
        const general = buildGeneral(80);
        general.meta.dex5 = 5000;
        const siegeCrew = new WarCrewType({
            ...buildUnitSet().crewTypes![0]!,
            id: 101,
            armType: 5,
            name: '공성병',
        });
        const unit = new WarUnitGeneral(
            new RandUtil(new ConstantRNG(0)),
            buildConfig(),
            general,
            buildCity(),
            buildNation(),
            true,
            siegeCrew,
            new ActionLogger({ generalId: 1, nationId: 1 }),
            new WarActionPipeline([])
        );

        unit.addDex(siegeCrew, 100);
        expect(general.meta.dex5).toBe(5090);
    });

    it('consumes one accumulated stat-exp threshold when a battle finishes', () => {
        const general = buildGeneral(80);
        general.meta.intel_exp = 30;
        const crewType = new WarCrewType(buildUnitSet().crewTypes![0]!);
        const unit = new WarUnitGeneral(
            new RandUtil(new ConstantRNG(0)),
            buildConfig(),
            general,
            buildCity(),
            buildNation(),
            true,
            crewType,
            new ActionLogger({ generalId: 1, nationId: 1 }),
            new WarActionPipeline([])
        );

        unit.finishBattle();

        expect(general.stats.intelligence).toBe(71);
        expect(general.meta.intel_exp).toBe(0);
    });

    it('activates and applies critical damage', async () => {
        const rng = new RandUtil(new ConstantRNG(0));
        const config = buildConfig();
        const crewType = new WarCrewType(buildUnitSet().crewTypes![0]!);
        const nation = buildNation();
        const city = buildCity();
        const attackerGeneral = buildGeneral(80);
        attackerGeneral.turnTime = new Date('2026-07-26T13:38:45.000Z');
        attackerGeneral.turnTick = 123_456;

        const attacker = new WarUnitGeneral(
            rng,
            config,
            attackerGeneral,
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
        expect(attackerGeneral.recentWarTime?.toISOString()).toBe('2026-07-26T13:38:45.000Z');
        expect(attackerGeneral.recentWarTick).toBe(123_400);
        expect(attackerGeneral.meta.recent_war_phase).toBe(0);

        attackerGeneral.turnTick = 123_556;
        attacker.setOppose(null);
        expect(attackerGeneral.recentWarTick).toBe(123_500);

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

    it('treats the first conflict nation as the baseline', () => {
        const rng = new RandUtil(new ConstantRNG(0));
        const config = buildConfig();
        const city = buildCity();
        const cityUnit = new WarUnitCity(
            rng,
            config,
            city,
            buildNation(),
            new WarCrewType(buildUnitSet().crewTypes![1]!),
            new ActionLogger({}),
            200,
            180
        );
        const firstNation = buildNation();
        const firstAttacker = new WarUnitGeneral(
            rng,
            config,
            buildGeneral(80),
            city,
            firstNation,
            true,
            new WarCrewType(buildUnitSet().crewTypes![0]!),
            new ActionLogger({ generalId: 1, nationId: 1 }),
            new WarActionPipeline([])
        );
        cityUnit.setOppose(firstAttacker);
        expect(cityUnit.addConflict()).toBe(false);
        expect(city.conflict).toEqual({ 1: 1.05 });
        expect(city.meta.conflict_order).toEqual([1]);
        expect(city.meta.conflict).toBeUndefined();

        const secondNation = { ...buildNation(), id: 2 };
        const secondGeneral = { ...buildGeneral(80), id: 2, nationId: 2 };
        const secondAttacker = new WarUnitGeneral(
            rng,
            config,
            secondGeneral,
            city,
            secondNation,
            true,
            new WarCrewType(buildUnitSet().crewTypes![0]!),
            new ActionLogger({ generalId: 2, nationId: 2 }),
            new WarActionPipeline([])
        );
        cityUnit.setOppose(secondAttacker);
        expect(cityUnit.addConflict()).toBe(true);
        expect(city.conflict).toEqual({ 1: 1.05, 2: 1 });
        expect(city.meta.conflict_order).toEqual([1, 2]);
    });

    it('uses the legacy virtual rice reserve for a neutral defender', () => {
        const events: string[] = [];
        const city = { ...buildCity(), nationId: 0 };

        resolveWarBattle({
            rng: new RandUtil(new ConstantRNG(0)),
            unitSet: buildUnitSet(),
            config: buildConfig(),
            time: { year: 200, month: 1, startYear: 180 },
            attacker: {
                general: buildGeneral(80),
                city: buildCity(),
                nation: buildNation(),
            },
            defenders: [],
            defenderCity: city,
            defenderNation: null,
            trace: (event) => events.push(event.event),
        });

        expect(events).not.toContain('supply_retreat');
        expect(events).toContain('phase_damage');
    });
});

describe('resolveWarBattle', () => {
    it('persists multi-use battle item charges and removes the last charge', async () => {
        const general = buildGeneral(100);
        equipNewItem(general, 'item', 'event_충차', { charges: 2 });
        const itemModules = createItemActionModules(
            createItemModuleRegistry(await loadItemModules(['event_충차']))
        ).war;

        for (const expectedCharges of [1, null] as const) {
            general.crew = 5000;
            general.rice = 10000;
            const defenderCity = { ...buildCity(), wall: 3000, wallMax: 3000 };
            resolveWarBattle({
                rng: new RandUtil(new ConstantRNG(0)),
                unitSet: buildUnitSet(),
                config: buildConfig(),
                time: { year: 200, month: 1, startYear: 180 },
                attacker: {
                    general,
                    city: buildCity(),
                    nation: buildNation(),
                    modules: itemModules,
                },
                defenders: [],
                defenderCity,
                defenderNation: buildNation(),
            });

            const equipped = getEquippedItemInstance(general, 'item');
            if (expectedCharges === null) {
                expect(equipped).toBeNull();
                expect(general.role.items.item).toBeNull();
            } else {
                expect(equipped?.state.charges).toBe(expectedCharges);
                expect(general.role.items.item).toBe('event_충차');
            }
        }
    });

    it('removes a one-use battle item through the canonical inventory', async () => {
        const general = buildGeneral(100);
        equipNewItem(general, 'item', 'che_저격_수극');
        const itemModules = createItemActionModules(
            createItemModuleRegistry(await loadItemModules(['che_저격_수극']))
        ).war;

        resolveWarBattle({
            rng: new RandUtil(new ConstantRNG(0)),
            unitSet: buildUnitSet(),
            config: buildConfig(),
            time: { year: 200, month: 1, startYear: 180 },
            attacker: {
                general,
                city: buildCity(),
                nation: buildNation(),
                modules: itemModules,
            },
            defenders: [],
            defenderCity: buildCity(),
            defenderNation: buildNation(),
        });

        expect(getEquippedItemInstance(general, 'item')).toBeNull();
        expect(general.role.items.item).toBeNull();
    });

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
        expect(outcome.logs.map((log) => log.text)).toContain(
            '<M><b>【패퇴】</b></><D><b>TestNation</b></>이 병량 부족으로 <G><b>TestCity</b></>를 뺏기고 말았습니다.'
        );
    });
});
