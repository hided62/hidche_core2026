import { describe, expect, it } from 'vitest';

import { ConstantRNG, RandUtil } from '@sammo-ts/common';

import type { City, General, Nation } from '../src/domain/entities.js';
import type { UnitSetDefinition } from '../src/world/types.js';
import { resolveWarAftermath } from '../src/war/aftermath.js';
import type { WarAftermathConfig } from '../src/war/types.js';

const buildUnitSet = (): UnitSetDefinition => ({
    id: 'test',
    name: 'test',
    crewTypes: [
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
            rice: 10,
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

const buildConfig = (): WarAftermathConfig => ({
    initialNationGenLimit: 1,
    techLevelIncYear: 5,
    initialAllowedTechLevel: 1,
    maxTechLevel: 12,
    defaultCityWall: 1000,
    baseGold: 0,
    baseRice: 0,
    castleCrewTypeId: 999,
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
    defence: 100,
    defenceMax: 200,
    supplyState: 1,
    frontState: 0,
    wall: 100,
    wallMax: 200,
    meta: {},
});

const buildNation = (id: number): Nation => ({
    id,
    name: `Nation${id}`,
    color: '#000000',
    capitalCityId: id,
    chiefGeneralId: null,
    gold: 1000,
    rice: 1000,
    power: 0,
    level: 1,
    typeCode: 'test',
    meta: {
        tech: 1000,
    },
});

const buildGeneral = (id: number, nationId: number, cityId: number): General => ({
    id,
    name: `General${id}`,
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
    rice: 1000,
    crew: 1000,
    crewTypeId: 999,
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
});

describe('war aftermath', () => {
    it('updates tech and diplomacy deltas', () => {
        const attackerNation = buildNation(1);
        const defenderNation = buildNation(2);
        const attackerCity = buildCity(1, 1);
        const defenderCity = buildCity(2, 2);
        const attacker = buildGeneral(1, 1, 1);

        const outcome = resolveWarAftermath({
            battle: {
                attacker,
                defenders: [],
                defenderCity,
                logs: [],
                conquered: false,
                reports: [
                    {
                        id: attacker.id,
                        type: 'general',
                        name: attacker.name,
                        isAttacker: true,
                        killed: 100,
                        dead: 50,
                    },
                ],
            },
            attackerNation,
            defenderNation,
            attackerCity,
            defenderCity,
            nations: [attackerNation, defenderNation],
            cities: [attackerCity, defenderCity],
            generals: [attacker],
            unitSet: buildUnitSet(),
            config: buildConfig(),
            time: {
                year: 200,
                month: 1,
                startYear: 180,
            },
        });

        expect(attackerNation.meta.tech).toBe(1001);
        expect(defenderNation.meta.tech).toBe(1001);
        expect(outcome.diplomacyDeltas).toHaveLength(2);
        expect(attackerCity.meta.dead).toBe(60);
        expect(defenderCity.meta.dead).toBe(90);
    });

    it('applies conquest collapse rewards', () => {
        const rng = new RandUtil(new ConstantRNG(0));
        const attackerNation = buildNation(1);
        const defenderNation = buildNation(2);
        defenderNation.gold = 5000;
        defenderNation.rice = 6000;
        const attackerCity = buildCity(1, 1);
        const defenderCity = buildCity(2, 2);
        defenderCity.meta.conflict = JSON.stringify({ 1: 100 });
        const attacker = buildGeneral(1, 1, 1);
        const defender = buildGeneral(2, 2, 2);

        const outcome = resolveWarAftermath({
            battle: {
                attacker,
                defenders: [defender],
                defenderCity,
                logs: [],
                conquered: true,
                reports: [
                    {
                        id: attacker.id,
                        type: 'general',
                        name: attacker.name,
                        isAttacker: true,
                        killed: 10,
                        dead: 5,
                    },
                    {
                        id: defenderCity.id,
                        type: 'city',
                        name: defenderCity.name,
                        isAttacker: false,
                        killed: 0,
                        dead: 0,
                    },
                ],
            },
            attackerNation,
            defenderNation,
            attackerCity,
            defenderCity,
            nations: [attackerNation, defenderNation],
            cities: [attackerCity, defenderCity],
            generals: [attacker, defender],
            unitSet: buildUnitSet(),
            config: buildConfig(),
            time: {
                year: 200,
                month: 1,
                startYear: 180,
            },
            rng,
        });

        expect(outcome.conquest?.nationCollapsed).toBe(true);
        expect(attackerNation.gold).toBe(3600);
        expect(attackerNation.rice).toBe(4600);
        expect(defender.experience).toBe(90);
        expect(defender.dedication).toBe(50);
        expect(defenderCity.nationId).toBe(attackerNation.id);
        expect(defenderCity.meta.conflict).toBe('{}');
    });
});
