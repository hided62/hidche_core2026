import { readdir, readFile } from 'node:fs/promises';

import { ConstantRNG, RandUtil } from '@sammo-ts/common';
import { describe, expect, it } from 'vitest';

import { compileCrewTypeCatalog } from '../src/crewType/catalog.js';
import { ActionLogger } from '../src/logging/actionLogger.js';
import type { City, General, Nation } from '../src/domain/entities.js';
import { WarActionPipeline } from '../src/war/actions.js';
import { WarCrewType } from '../src/war/crewType.js';
import { createCrewTypeWarTriggerRegistry } from '../src/war/crewTypeTriggers.js';
import { computeBattleOrder, resolveWarBattle } from '../src/war/engine.js';
import { createWarTriggerEnv, WarTriggerCaller } from '../src/war/triggers.js';
import type { WarEngineConfig } from '../src/war/types.js';
import { WarUnitCity, WarUnitGeneral, type WarUnit } from '../src/war/units.js';
import {
    getCrewTypePickScore,
    getTechAbility,
    getTechCost,
    getTechLevel,
    parseUnitSetDefinition,
} from '../src/world/unitSet.js';
import type { CrewTypeDefinition, UnitSetDefinition } from '../src/world/types.js';

const config: WarEngineConfig = {
    armPerPhase: 500,
    maxTrainByCommand: 100,
    maxAtmosByCommand: 100,
    maxTrainByWar: 110,
    maxAtmosByWar: 150,
    castleCrewTypeId: 1000,
    armTypes: {
        footman: 1,
        archer: 2,
        cavalry: 3,
        wizard: 4,
        siege: 5,
        misc: 6,
        castle: 0,
    },
};

const nation: Nation = {
    id: 1,
    name: '테스트국',
    color: '#000000',
    capitalCityId: 1,
    chiefGeneralId: null,
    gold: 10000,
    rice: 10000,
    power: 0,
    level: 1,
    typeCode: 'test',
    meta: { tech: 3000 },
};

const city: City = {
    id: 1,
    name: '테스트성',
    nationId: 1,
    level: 1,
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
    defenceMax: 1000,
    wall: 1000,
    wallMax: 1000,
    supplyState: 1,
    frontState: 0,
    meta: {},
};

const crewType = (
    id: number,
    armType: number,
    name: string,
    options: Partial<CrewTypeDefinition> = {}
): CrewTypeDefinition => ({
    id,
    armType,
    name,
    attack: 100,
    defence: 100,
    speed: 7,
    avoid: 10,
    magicCoef: 0,
    cost: 10,
    rice: 10,
    requirements: [],
    attackCoef: {},
    defenceCoef: {},
    info: [],
    initSkillTrigger: null,
    phaseSkillTrigger: null,
    iActionList: null,
    ...options,
});

const buildGeneral = (id: number, crewTypeId: number): General => ({
    id,
    name: `장수${id}`,
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 80, strength: 80, intelligence: 80 },
    experience: 0,
    dedication: 0,
    officerLevel: 3,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1000,
    rice: 10000,
    crew: 1000,
    crewTypeId,
    train: 100,
    atmos: 100,
    age: 20,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24, dex1: 1000, dex2: 1000, dex3: 1000, dex5: 1000 },
});

const buildGeneralUnit = (
    rng: RandUtil,
    general: General,
    definition: CrewTypeDefinition,
    attacker: boolean,
    modules: WarActionPipeline = new WarActionPipeline([])
) =>
    new WarUnitGeneral(
        rng,
        config,
        general,
        city,
        nation,
        attacker,
        new WarCrewType(definition),
        new ActionLogger({ generalId: general.id, nationId: general.nationId }),
        modules
    );

const fireTriggers = (keys: string[], self: WarUnit, attacker: WarUnit, defender: WarUnit): void => {
    const registry = createCrewTypeWarTriggerRegistry();
    const caller = new WarTriggerCaller();
    for (const key of keys) {
        const trigger = registry[key]?.(self);
        if (!trigger) {
            throw new Error(`Missing trigger: ${key}`);
        }
        if (trigger instanceof WarTriggerCaller) {
            caller.merge(trigger);
        } else {
            caller.append(trigger);
        }
    }
    caller.fire({ rng: self.rng, attacker, defender }, createWarTriggerEnv());
};

describe('crew type catalog', () => {
    it('uses the legacy display-width limit for battle log crew names', () => {
        expect(new WarCrewType(crewType(1405, 4, '남귀병')).getShortName()).toBe('남귀');
        expect(new WarCrewType(crewType(1, 1, 'AB한C')).getShortName()).toBe('AB한');
    });

    it('compiles every shipped unit set and resolves all crew handlers', async () => {
        const unitSetDirectory = new URL('../../../resources/unitset/', import.meta.url);
        const fileNames = (await readdir(unitSetDirectory)).filter((fileName) => fileName.endsWith('.json'));

        for (const fileName of fileNames) {
            const raw = JSON.parse(await readFile(new URL(fileName, unitSetDirectory), 'utf8')) as unknown;
            const unitSet = parseUnitSetDefinition(raw);
            const catalog = compileCrewTypeCatalog(unitSet, createCrewTypeWarTriggerRegistry());

            expect(catalog.byId.size, fileName).toBe(unitSet.crewTypes?.length);
        }

        const raw = JSON.parse(await readFile(new URL('unitset_che.json', unitSetDirectory), 'utf8')) as unknown;
        const cheCatalog = compileCrewTypeCatalog(parseUnitSetDefinition(raw), createCrewTypeWarTriggerRegistry());
        expect(cheCatalog.byId.get(1500)?.actions.map((action) => action.key)).toEqual(['che_성벽선제']);
    });

    it('fails fast for unresolved crew actions and war triggers', () => {
        const base: UnitSetDefinition = {
            id: 'invalid',
            name: 'invalid',
            defaultCrewTypeId: 1100,
            crewTypes: [
                crewType(1100, 1, '보병', {
                    iActionList: ['missing_action'],
                    phaseSkillTrigger: ['missing_trigger'],
                }),
            ],
        };
        expect(() => compileCrewTypeCatalog(base, createCrewTypeWarTriggerRegistry())).toThrow(
            'Unknown crew type action'
        );

        base.crewTypes![0]!.iActionList = null;
        expect(() => compileCrewTypeCatalog(base, createCrewTypeWarTriggerRegistry())).toThrow(
            'Unknown crew type war trigger'
        );
    });

    it('routes 정란의 성벽 우선 action through the war pipeline', () => {
        const tower = crewType(1500, 5, '정란', { iActionList: ['che_성벽선제'] });
        const wall = crewType(1000, 0, '성벽');
        const unitSet: UnitSetDefinition = {
            id: 'tower',
            name: 'tower',
            defaultCrewTypeId: tower.id,
            crewTypes: [wall, tower],
        };
        const catalog = compileCrewTypeCatalog(unitSet, createCrewTypeWarTriggerRegistry());
        const rng = new RandUtil(new ConstantRNG(0));
        const attacker = buildGeneralUnit(
            rng,
            buildGeneral(1, tower.id),
            tower,
            true,
            new WarActionPipeline([catalog.warActionModule])
        );
        const defender = new WarUnitCity(
            rng,
            config,
            city,
            nation,
            new WarCrewType(wall),
            new ActionLogger({ nationId: nation.id }),
            200,
            180
        );

        expect(computeBattleOrder(defender, attacker)).toBe(10000);
    });

    it('uses live injured and full action-adjusted stats for defender order', () => {
        const footman = crewType(1100, 1, '보병');
        const rng = new RandUtil(new ConstantRNG(0));
        const attacker = buildGeneralUnit(rng, buildGeneral(1, footman.id), footman, true);
        const defenderGeneral = { ...buildGeneral(2, footman.id), injury: 50 };
        const defender = buildGeneralUnit(
            rng,
            defenderGeneral,
            footman,
            false,
            new WarActionPipeline([
                {
                    onCalcStat: (_context, statName, value) =>
                        statName === 'leadership' && typeof value === 'number' ? value + 40 : value,
                },
            ])
        );

        expect(computeBattleOrder(defender, attacker)).toBe(260);
    });

    it('excludes defenders below the legacy defence training threshold', () => {
        const footman = crewType(1100, 1, '보병');
        const rng = new RandUtil(new ConstantRNG(0));
        const attacker = buildGeneralUnit(rng, buildGeneral(1, footman.id), footman, true);
        const baseDefender = buildGeneral(2, footman.id);
        const defenderGeneral = {
            ...baseDefender,
            train: 79,
            atmos: 80,
            meta: { ...baseDefender.meta, defence_train: 80 },
        };
        const defender = buildGeneralUnit(rng, defenderGeneral, footman, false);

        expect(computeBattleOrder(defender, attacker)).toBe(0);
    });
});

describe('crew type war triggers', () => {
    it('loads crew triggers automatically in the live battle engine', () => {
        const archer = crewType(1200, 2, '궁병', {
            phaseSkillTrigger: ['che_선제사격시도', 'che_선제사격발동'],
        });
        const footman = crewType(1100, 1, '보병');
        const wall = crewType(1000, 0, '성벽');
        const unitSet: UnitSetDefinition = {
            id: 'live-engine',
            name: 'live-engine',
            defaultCrewTypeId: footman.id,
            crewTypes: [wall, footman, archer],
        };
        const attacker = buildGeneral(1, archer.id);
        const defender = buildGeneral(2, footman.id);

        const outcome = resolveWarBattle({
            rng: new RandUtil(new ConstantRNG(0)),
            unitSet,
            config,
            time: { year: 200, month: 1, startYear: 180 },
            attacker: { general: attacker, city, nation },
            defenders: [{ general: defender, city, nation }],
            defenderCity: city,
            defenderNation: nation,
        });

        expect(outcome.metrics?.attackerActivatedSkills['선제']).toBe(1);
    });

    it('activates wound immunity only for a general fighting a city wall', () => {
        const siege = crewType(1501, 5, '충차');
        const wall = crewType(1000, 0, '성벽');
        const rng = new RandUtil(new ConstantRNG(0));
        const attacker = buildGeneralUnit(rng, buildGeneral(1, siege.id), siege, true);
        const defender = new WarUnitCity(
            rng,
            config,
            city,
            nation,
            new WarCrewType(wall),
            new ActionLogger({ nationId: nation.id }),
            200,
            180
        );
        attacker.setOppose(defender);
        defender.setOppose(attacker);

        fireTriggers(['che_성벽부상무효'], attacker, attacker, defender);

        expect(attacker.hasActivatedSkill('부상무효')).toBe(true);
    });

    it('applies cavalry and footman end-of-phase multipliers', () => {
        const cavalry = crewType(1300, 3, '기병');
        const footman = crewType(1100, 1, '보병');
        const rng = new RandUtil(new ConstantRNG(0));
        const attacker = buildGeneralUnit(rng, buildGeneral(1, cavalry.id), cavalry, true);
        const defender = buildGeneralUnit(rng, buildGeneral(2, footman.id), footman, false);
        attacker.setOppose(defender);
        defender.setOppose(attacker);

        fireTriggers(['che_기병병종전투'], attacker, attacker, defender);
        fireTriggers(['che_방어력증가5p'], defender, attacker, defender);

        expect(attacker.getWarPowerMultiply()).toBeCloseTo(1.02 / 1.05);
        expect(defender.getWarPowerMultiply()).toBeCloseTo(0.97);
    });

    it('executes one-sided preemptive fire once and suppresses the opponent', () => {
        const archer = crewType(1200, 2, '궁병');
        const footman = crewType(1100, 1, '보병');
        const rng = new RandUtil(new ConstantRNG(0));
        const attacker = buildGeneralUnit(rng, buildGeneral(1, archer.id), archer, true);
        const defender = buildGeneralUnit(rng, buildGeneral(2, footman.id), footman, false);
        attacker.setOppose(defender);
        defender.setOppose(attacker);

        fireTriggers(['che_선제사격시도', 'che_선제사격발동'], attacker, attacker, defender);

        expect(attacker.getPhase()).toBe(-1);
        expect(defender.getPhase()).toBe(-1);
        expect(attacker.getWarPowerMultiply()).toBeCloseTo(2 / 3);
        expect(defender.getWarPowerMultiply()).toBe(0);
        expect(attacker.hasActivatedSkill('선제')).toBe(true);
        expect(defender.hasActivatedSkill('회피불가')).toBe(true);
    });

    it('uses the legacy stop probability and never lets an attacker initiate 저지', () => {
        const ram = crewType(1503, 5, '목우');
        const footman = crewType(1100, 1, '보병');
        const rng = new RandUtil(new ConstantRNG(0));
        const attacker = buildGeneralUnit(rng, buildGeneral(1, footman.id), footman, true);
        const defender = buildGeneralUnit(rng, buildGeneral(2, ram.id), ram, false);
        attacker.setOppose(defender);
        defender.setOppose(attacker);

        fireTriggers(['che_저지시도'], attacker, attacker, defender);
        expect(attacker.hasActivatedSkill('저지')).toBe(false);

        fireTriggers(['che_저지시도', 'che_저지발동'], defender, attacker, defender);
        expect(defender.hasActivatedSkill('저지')).toBe(true);
        expect(attacker.getWarPowerMultiply()).toBe(0);
        expect(defender.getWarPowerMultiply()).toBe(0);

        const missRng = new RandUtil(new ConstantRNG(1));
        const missedAttacker = buildGeneralUnit(missRng, buildGeneral(3, footman.id), footman, true);
        const missedDefender = buildGeneralUnit(missRng, buildGeneral(4, ram.id), ram, false);
        missedAttacker.setOppose(missedDefender);
        missedDefender.setOppose(missedAttacker);
        fireTriggers(['che_저지시도', 'che_저지발동'], missedDefender, missedAttacker, missedDefender);
        expect(missedDefender.hasActivatedSkill('저지')).toBe(false);
    });
});

describe('crew type numeric policy', () => {
    it('uses the scenario 913 maximum tech level for ability and cost', () => {
        expect(getTechLevel(13_000, 15)).toBe(13);
        expect(getTechAbility(13_000, 15)).toBe(325);
        expect(getTechCost(13_000, 15)).toBe(2.95);

        expect(getTechLevel(15_000, 15)).toBe(15);
        expect(getTechAbility(15_000, 15)).toBe(375);
        expect(getTechCost(15_000, 15)).toBe(3.25);

        expect(getTechLevel(15_000)).toBe(12);
        expect(getTechAbility(15_000)).toBe(300);
        expect(getTechCost(15_000)).toBe(2.8);
    });

    it('matches the legacy pickScore formula including magicCoef', () => {
        const wizard = crewType(1400, 4, '귀병', {
            attack: 80,
            defence: 80,
            speed: 7,
            avoid: 5,
            magicCoef: 0.5,
        });
        const expected = ((500 + 80 + 80 + 75 * 2) * (1 + 7 / 2) * (1 + 0.5 / 2)) / (1 - 0.05);
        expect(getCrewTypePickScore(wizard, 3000, 500)).toBeCloseTo(expected);
    });

    it('uses the scenario maximum tech level in the crew pick score', () => {
        const wizard = crewType(1400, 4, '귀병', {
            attack: 80,
            defence: 80,
            speed: 7,
            avoid: 5,
            magicCoef: 0.5,
        });
        const expected = ((500 + 80 + 80 + 375 * 2) * (1 + 7 / 2) * (1 + 0.5 / 2)) / (1 - 0.05);

        expect(getCrewTypePickScore(wizard, 15_000, 500, 15)).toBeCloseTo(expected);
    });
});
