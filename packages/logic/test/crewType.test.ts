import { describe, expect, it } from 'vitest';

import type { City, General, Nation } from '../src/domain/entities.js';
import type { MapDefinition } from '../src/world/types.js';
import { isCrewTypeAvailable, parseUnitSetDefinition } from '../src/world/unitSet.js';

const buildMap = (): MapDefinition => ({
    id: 'test',
    name: 'test',
    cities: [
        {
            id: 1,
            name: 'A',
            level: 6,
            region: 1,
            position: { x: 0, y: 0 },
            connections: [],
            max: {
                population: 100000,
                agriculture: 1000,
                commerce: 1000,
                security: 1000,
                defence: 1000,
                wall: 1000,
            },
            initial: {
                population: 50000,
                agriculture: 500,
                commerce: 500,
                security: 500,
                defence: 500,
                wall: 500,
            },
        },
    ],
    meta: {
        regionMap: {
            A: 1,
        },
    },
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

const buildGeneral = (): General => ({
    id: 1,
    name: 'TestGeneral',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
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
    crew: 0,
    crewTypeId: 1100,
    train: 0,
    atmos: 0,
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

const buildCities = (): City[] => [
    {
        id: 1,
        name: 'A',
        nationId: 1,
        level: 6,
        state: 0,
        population: 50000,
        populationMax: 100000,
        agriculture: 500,
        agricultureMax: 1000,
        commerce: 500,
        commerceMax: 1000,
        security: 500,
        securityMax: 1000,
        supplyState: 1,
        frontState: 0,
        defence: 500,
        defenceMax: 1000,
        wall: 500,
        wallMax: 1000,
        meta: {},
    },
];

describe('crew type availability', () => {
    it('parses unit set data and normalizes coefficients', () => {
        const parsed = parseUnitSetDefinition({
            id: 'test',
            name: 'test',
            defaultCrewTypeId: 1100,
            crewTypes: [
                {
                    id: 1100,
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
                    attackCoef: [],
                    defenceCoef: { 1: 1.2 },
                    info: ['테스트'],
                    initSkillTrigger: null,
                    phaseSkillTrigger: null,
                    iActionList: null,
                },
            ],
        });

        expect(parsed.defaultCrewTypeId).toBe(1100);
        expect(parsed.crewTypes?.[0]?.attackCoef).toEqual({});
    });

    it('checks tech/region/city requirements', () => {
        const unitSet = parseUnitSetDefinition({
            id: 'test',
            name: 'test',
            crewTypes: [
                {
                    id: 1100,
                    armType: 1,
                    name: '기본',
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
                    id: 1200,
                    armType: 1,
                    name: '기술병',
                    attack: 100,
                    defence: 100,
                    speed: 7,
                    avoid: 10,
                    magicCoef: 0,
                    cost: 9,
                    rice: 9,
                    requirements: [
                        { type: 'ReqTech', tech: 2000 },
                        { type: 'ReqRegions', regions: ['A'] },
                    ],
                    attackCoef: {},
                    defenceCoef: {},
                    info: [],
                    initSkillTrigger: null,
                    phaseSkillTrigger: null,
                    iActionList: null,
                },
                {
                    id: 1300,
                    armType: 1,
                    name: '도시병',
                    attack: 100,
                    defence: 100,
                    speed: 7,
                    avoid: 10,
                    magicCoef: 0,
                    cost: 9,
                    rice: 9,
                    requirements: [{ type: 'ReqCitiesWithCityLevel', level: 7, cities: ['A'] }],
                    attackCoef: {},
                    defenceCoef: {},
                    info: [],
                    initSkillTrigger: null,
                    phaseSkillTrigger: null,
                    iActionList: null,
                },
            ],
        });

        const context = {
            general: buildGeneral(),
            nation: buildNation(),
            map: buildMap(),
            cities: buildCities(),
            currentYear: 10,
            startYear: 1,
        };

        expect(isCrewTypeAvailable(unitSet, 1100, context)).toBe(true);
        expect(isCrewTypeAvailable(unitSet, 1200, context)).toBe(true);
        expect(isCrewTypeAvailable(unitSet, 1300, context)).toBe(false);
    });
});
