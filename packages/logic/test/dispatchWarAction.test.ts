import { describe, expect, it } from 'vitest';

import type { City, General, Nation } from '../src/domain/entities.js';
import { resolveGeneralAction } from '../src/actions/engine.js';
import { ActionDefinition } from '../src/actions/turn/general/che_출병.js';
import type { DispatchResolveContext } from '../src/actions/turn/general/che_출병.js';
import type { TurnSchedule } from '../src/turn/calendar.js';
import type { WarAftermathConfig, WarEngineConfig } from '../src/war/types.js';
import type { UnitSetDefinition } from '../src/world/types.js';

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

const buildNation = (id: number): Nation => ({
    id,
    name: `Nation${id}`,
    color: '#000000',
    capitalCityId: id,
    chiefGeneralId: null,
    gold: 5000,
    rice: 5000,
    power: 0,
    level: 1,
    typeCode: 'test',
    meta: {
        tech: 1000,
    },
});

const unitSet: UnitSetDefinition = {
    id: 'test',
    name: 'test',
    defaultCrewTypeId: 100,
    crewTypes: [
        {
            id: 100,
            armType: 1,
            name: 'Infantry',
            attack: 10,
            defence: 10,
            speed: 3,
            avoid: 5,
            magicCoef: 0,
            cost: 0,
            rice: 1,
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
            armType: 5,
            name: 'Castle',
            attack: 0,
            defence: 0,
            speed: 1,
            avoid: 0,
            magicCoef: 0,
            cost: 0,
            rice: 10,
            requirements: [{ type: 'Impossible' }],
            attackCoef: {},
            defenceCoef: {},
            info: [],
            initSkillTrigger: null,
            phaseSkillTrigger: null,
            iActionList: null,
        },
    ],
};

const warConfig: WarEngineConfig = {
    armPerPhase: 500,
    maxTrainByCommand: 100,
    maxAtmosByCommand: 100,
    maxTrainByWar: 110,
    maxAtmosByWar: 150,
    castleCrewTypeId: 999,
    armTypes: {
        footman: 1,
        archer: 2,
        cavalry: 3,
        wizard: 4,
        siege: 5,
        misc: 6,
        castle: 5,
    },
};

const aftermathConfig: WarAftermathConfig = {
    initialNationGenLimit: 1,
    techLevelIncYear: 5,
    initialAllowedTechLevel: 1,
    maxTechLevel: 12,
    defaultCityWall: 1000,
    baseGold: 0,
    baseRice: 0,
    castleCrewTypeId: 999,
};

const rng = {
    nextFloat: () => 0.1,
    nextBool: (probability: number) => probability >= 0.1,
    nextInt: (minInclusive: number, _maxExclusive: number) => minInclusive,
};

const schedule: TurnSchedule = {
    entries: [{ startMinute: 0, tickMinutes: 60 }],
};

describe('che_출병', () => {
    it('runs war battle and emits patches/logs', () => {
        const attackerNation = buildNation(1);
        const defenderNation = buildNation(2);
        const attackerCity = buildCity(1, attackerNation.id);
        const defenderCity = buildCity(2, defenderNation.id);
        const attacker = buildGeneral(1, attackerNation.id, attackerCity.id);
        const defender = buildGeneral(2, defenderNation.id, defenderCity.id);

        const definition = new ActionDefinition();
        const context: Omit<DispatchResolveContext, 'addLog'> = {
            general: attacker,
            city: attackerCity,
            nation: attackerNation,
            rng,
            destCity: defenderCity,
            destNation: defenderNation,
            cities: [attackerCity, defenderCity],
            nations: [attackerNation, defenderNation],
            generals: [attacker, defender],
            unitSet,
            time: {
                year: 200,
                month: 1,
                startYear: 180,
            },
            seedBase: 'test-seed',
            warConfig,
            aftermathConfig,
        };
        const resolution = resolveGeneralAction(
            definition,
            context,
            {
                now: new Date('2000-01-01T00:00:00Z'),
                schedule,
            },
            {
                destCityId: defenderCity.id,
            }
        );

        expect(resolution.logs.length).toBeGreaterThan(0);
        expect(resolution.patches?.generals.some((patch) => patch.id === defender.id)).toBe(true);
        expect(resolution.patches?.cities.some((patch) => patch.id === defenderCity.id)).toBe(true);
        expect(
            resolution.effects.some(
                (effect) =>
                    effect.type === 'diplomacy:patch' &&
                    effect.srcNationId === attackerNation.id &&
                    effect.destNationId === defenderNation.id
            )
        ).toBe(true);
    });
});
