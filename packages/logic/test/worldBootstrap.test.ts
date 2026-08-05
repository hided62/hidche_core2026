import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScenarioDefinition } from '../src/scenario/types.js';
import type { MapDefinition, UnitSetDefinition } from '../src/world/types.js';
import { buildScenarioBootstrap } from '../src/world/bootstrap.js';

describe('scenario bootstrap', () => {
    beforeEach(() => {
        vi.spyOn(Math, 'random').mockImplementation(() => {
            throw new Error('scenario bootstrap must not use Math.random');
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('builds snapshot and seed from scenario/map inputs', () => {
        const scenario: ScenarioDefinition = {
            title: 'Test Scenario',
            startYear: 200,
            life: null,
            fiction: null,
            history: [],
            config: {
                stat: {
                    total: 100,
                    min: 10,
                    max: 70,
                    npcTotal: 80,
                    npcMax: 60,
                    npcMin: 5,
                    chiefMin: 50,
                },
                iconPath: '.',
                map: {},
                const: {},
                environment: {
                    mapName: 'test-map',
                    unitSet: 'test-unit',
                },
            },
            nations: [
                {
                    id: 1,
                    name: 'TestNation',
                    color: '#123456',
                    gold: 5000,
                    rice: 3000,
                    infoText: 'Test nation',
                    tech: 100,
                    type: 'Test',
                    level: 3,
                    cities: ['Alpha'],
                },
            ],
            diplomacy: [],
            generals: [
                {
                    affinity: 10,
                    name: 'TestGeneral',
                    picture: 101,
                    nation: 1,
                    city: 'Alpha',
                    leadership: 50,
                    strength: 60,
                    intelligence: 55,
                    officerLevel: 1,
                    birthYear: 180,
                    deathYear: 240,
                    personality: 'Calm',
                    special: 'Special',
                    text: 'Test line',
                },
                {
                    affinity: 11,
                    name: 'MedicalGeneral',
                    picture: null,
                    nation: 1,
                    city: 'Alpha',
                    leadership: 40,
                    strength: 40,
                    intelligence: 70,
                    officerLevel: 1,
                    birthYear: 180,
                    deathYear: 240,
                    personality: '출세',
                    special: '의술',
                    text: null,
                },
                {
                    affinity: 12,
                    name: 'ChargeGeneral',
                    picture: null,
                    nation: 1,
                    city: 'Alpha',
                    leadership: 70,
                    strength: 60,
                    intelligence: 20,
                    officerLevel: 1,
                    birthYear: 180,
                    deathYear: 240,
                    personality: '패권',
                    special: '돌격',
                    text: null,
                },
            ],
            generalsEx: [],
            generalsNeutral: [
                {
                    affinity: 13,
                    name: 'NeutralGeneral',
                    picture: null,
                    nation: null,
                    city: 'Alpha',
                    leadership: 50,
                    strength: 50,
                    intelligence: 50,
                    officerLevel: 0,
                    birthYear: 180,
                    deathYear: 240,
                    personality: 'Calm',
                    special: '',
                    text: null,
                },
            ],
            cities: [],
            events: [],
            initialEvents: [],
            ignoreDefaultEvents: false,
        };

        const map: MapDefinition = {
            id: 'test-map',
            name: 'test-map',
            cities: [
                {
                    id: 1,
                    name: 'Alpha',
                    level: 3,
                    region: 1,
                    position: { x: 10, y: 20 },
                    connections: [],
                    max: {
                        population: 100000,
                        agriculture: 20000,
                        commerce: 20000,
                        security: 15000,
                        defence: 5000,
                        wall: 3000,
                    },
                    initial: {
                        population: 50000,
                        agriculture: 10000,
                        commerce: 10000,
                        security: 8000,
                        defence: 2500,
                        wall: 1500,
                    },
                },
            ],
        };

        const unitSet: UnitSetDefinition = {
            id: 'test-unit',
            name: 'test-unit',
            defaultCrewTypeId: 1200,
        };

        const result = buildScenarioBootstrap({ scenario, map, unitSet });

        expect(result.warnings).toHaveLength(0);
        expect(result.snapshot.nations).toHaveLength(2);
        expect(result.seed.nations).toHaveLength(1);
        expect(result.snapshot.cities[0]?.nationId).toBe(1);
        expect(result.seed.cities[0]?.nationId).toBe(1);
        expect(result.snapshot.generals[0]?.cityId).toBe(1);
        expect(result.snapshot.generals[0]?.crewTypeId).toBe(1200);
        expect(result.seed.generals.map((general) => general.name)).toEqual([
            'ⓝTestGeneral',
            'ⓝMedicalGeneral',
            'ⓝChargeGeneral',
            'ⓤNeutralGeneral',
        ]);
        expect(result.snapshot.generals.map((general) => general.name)).toEqual([
            'ⓝTestGeneral',
            'ⓝMedicalGeneral',
            'ⓝChargeGeneral',
            'ⓤNeutralGeneral',
        ]);
        expect(result.snapshot.generals[0]?.role.specialDomestic).toBe('Special');
        expect(result.snapshot.generals[0]?.role.specialWar).toBeNull();
        expect(result.snapshot.generals[1]?.role).toMatchObject({
            personality: 'che_출세',
            specialDomestic: 'che_event_의술',
            specialWar: null,
        });
        expect(result.seed.generals[1]).toMatchObject({
            special: 'che_event_의술',
            specialWar: null,
        });
        expect(result.snapshot.generals[2]?.role).toMatchObject({
            personality: 'che_패권',
            specialDomestic: 'che_event_돌격',
            specialWar: null,
        });
        expect(result.snapshot.generals[0]?.meta).toMatchObject({
            explevel: 0,
            dedlevel: 1,
            specage: 25,
            specage2: 30,
        });
        expect(result.seed.generals[0]?.meta).toMatchObject({
            deathMonth: expect.any(Number),
            explevel: 0,
            dedlevel: 1,
            specage: 25,
            specage2: 30,
        });
        const preOpening = buildScenarioBootstrap({
            scenario,
            map,
            unitSet,
            options: { initialYear: scenario.startYear! - 1 },
        });
        expect(preOpening.snapshot.generals[0]).toMatchObject({
            age: 19,
            meta: { specage: 25, specage2: 30 },
        });
        expect(preOpening.seed.generals[0]?.meta).toMatchObject({ specage: 25, specage2: 30 });
        expect(buildScenarioBootstrap({ scenario, map, unitSet }).snapshot.generals[0]?.meta).toEqual(
            result.snapshot.generals[0]?.meta
        );
        expect(result.seed.generals[0]?.npcType).toBe(2);
        expect(result.snapshot.scenarioMeta?.title).toBe('Test Scenario');
        expect(result.seed.events[0]).toEqual(['pre_month', 9_000, true, ['UpdateCitySupply'], ['ProcessWarIncome']]);
        expect(result.seed.events.flat(3)).toContain('ProcessSemiAnnual');
        expect(result.seed.events.flat(3)).toContain('NewYear');
        expect(result.seed.initialEvents[0]).toEqual([
            true,
            ['NoticeToHistoryLog', '<S>2년간 거병 및 건국이 가능합니다.</>', 6],
        ]);
    });

    it('places generals without an explicit city in a deterministic valid city', () => {
        const scenario: ScenarioDefinition = {
            title: 'Random placement',
            startYear: 200,
            life: null,
            fiction: null,
            history: [],
            config: {
                stat: { total: 100, min: 10, max: 70, npcTotal: 80, npcMax: 60, npcMin: 5, chiefMin: 50 },
                iconPath: '.',
                map: {},
                const: {},
                environment: { mapName: 'test-map', unitSet: 'test-unit' },
            },
            nations: [
                {
                    id: 1,
                    name: 'TestNation',
                    color: '#123456',
                    gold: 5000,
                    rice: 3000,
                    infoText: null,
                    tech: 100,
                    type: 'Test',
                    level: 3,
                    cities: ['Alpha'],
                },
            ],
            diplomacy: [],
            generals: [
                {
                    affinity: 10,
                    name: 'NationGeneral',
                    picture: null,
                    nation: 1,
                    city: null,
                    leadership: 50,
                    strength: 50,
                    intelligence: 50,
                    officerLevel: 1,
                    birthYear: 180,
                    deathYear: 240,
                    personality: null,
                    special: '',
                    text: '',
                },
                {
                    affinity: 20,
                    name: 'NeutralGeneral',
                    picture: null,
                    nation: null,
                    city: null,
                    leadership: 50,
                    strength: 50,
                    intelligence: 50,
                    officerLevel: 0,
                    birthYear: 180,
                    deathYear: 240,
                    personality: null,
                    special: '',
                    text: '',
                },
            ],
            generalsEx: [],
            generalsNeutral: [],
            cities: [],
            events: [],
            initialEvents: [],
            ignoreDefaultEvents: true,
        };
        const map: MapDefinition = {
            id: 'test-map',
            name: 'test-map',
            cities: [
                {
                    id: 1,
                    name: 'Alpha',
                    level: 5,
                    region: 1,
                    position: { x: 0, y: 0 },
                    connections: [2],
                    max: { population: 1, agriculture: 1, commerce: 1, security: 1, defence: 1, wall: 1 },
                    initial: { population: 1, agriculture: 1, commerce: 1, security: 1, defence: 1, wall: 1 },
                },
                {
                    id: 2,
                    name: 'Beta',
                    level: 5,
                    region: 1,
                    position: { x: 1, y: 0 },
                    connections: [1],
                    max: { population: 1, agriculture: 1, commerce: 1, security: 1, defence: 1, wall: 1 },
                    initial: { population: 1, agriculture: 1, commerce: 1, security: 1, defence: 1, wall: 1 },
                },
            ],
        };

        const first = buildScenarioBootstrap({ scenario, map, options: { hiddenSeed: 'placement-seed' } });
        const second = buildScenarioBootstrap({ scenario, map, options: { hiddenSeed: 'placement-seed' } });

        expect(first.seed.generals.map((general) => general.cityId)).toEqual(
            second.seed.generals.map((general) => general.cityId)
        );
        expect(first.seed.generals[0]?.cityId).toBe(1);
        expect([1, 2]).toContain(first.seed.generals[1]?.cityId);
        expect(first.seed.generals.every((general) => general.cityId > 0)).toBe(true);
        expect(
            first.seed.generals.map((general) => ({
                cityId: general.cityId,
                affinity: general.affinity,
                personality: general.personality,
                experience: general.experience,
                dedication: general.dedication,
                deathMonth: general.meta.deathMonth,
                initialTurnOffsetMicros: general.meta.initialTurnOffsetMicros,
            }))
        ).toEqual([
            {
                cityId: 1,
                affinity: 10,
                personality: 'che_안전',
                experience: 2_000,
                dedication: 2_000,
                deathMonth: 12,
                initialTurnOffsetMicros: 2_161_529_667,
            },
            {
                cityId: 2,
                affinity: 20,
                personality: 'che_재간',
                experience: 2_000,
                dedication: 2_000,
                deathMonth: 7,
                initialTurnOffsetMicros: 3_203_248_275,
            },
        ]);
    });

    it('defers future generals into birth-year registration events and omits expired rows', () => {
        const general = (
            name: string,
            birthYear: number,
            deathYear: number,
            nation: number | string | null = 1
        ): ScenarioDefinition['generals'][number] => ({
            affinity: 0,
            name,
            picture: null,
            nation,
            city: null,
            leadership: 50,
            strength: 60,
            intelligence: 40,
            officerLevel: 3,
            birthYear,
            deathYear,
            personality: null,
            special: '',
            text: '',
        });
        const scenario: ScenarioDefinition = {
            title: 'Delayed generals',
            startYear: 200,
            life: null,
            fiction: null,
            history: [],
            config: {
                stat: { total: 100, min: 10, max: 70, npcTotal: 80, npcMax: 60, npcMin: 5, chiefMin: 50 },
                iconPath: '.',
                map: {},
                const: {},
                environment: { mapName: 'test-map', unitSet: 'test-unit' },
            },
            nations: [
                {
                    id: 1,
                    name: 'TestNation',
                    color: '#123456',
                    gold: 5_000,
                    rice: 3_000,
                    infoText: '',
                    tech: 100,
                    type: 'Test',
                    level: 3,
                    cities: ['Alpha'],
                },
            ],
            diplomacy: [],
            generals: [general('현재', 180, 240), general('미래1', 190, 250, 'TestNation'), general('만료', 170, 200)],
            generalsEx: [general('미래확장', 190, 260)],
            generalsNeutral: [general('미래재야', 191, 260, 0)],
            cities: [],
            events: [['Month', 500, ['Date', '>=', 200, 1], ['Existing']]],
            initialEvents: [],
            ignoreDefaultEvents: true,
        };
        const map: MapDefinition = {
            id: 'test-map',
            name: 'test-map',
            cities: [
                {
                    id: 1,
                    name: 'Alpha',
                    level: 3,
                    region: 1,
                    position: { x: 0, y: 0 },
                    connections: [],
                    max: {
                        population: 100_000,
                        agriculture: 20_000,
                        commerce: 20_000,
                        security: 15_000,
                        defence: 5_000,
                        wall: 3_000,
                    },
                    initial: {
                        population: 50_000,
                        agriculture: 10_000,
                        commerce: 10_000,
                        security: 8_000,
                        defence: 2_500,
                        wall: 1_500,
                    },
                },
            ],
        };

        const result = buildScenarioBootstrap({ scenario, map });

        expect(result.seed.generals.map((row) => row.name)).toEqual(['ⓝ현재']);
        expect(result.snapshot.generals.map((row) => row.name)).toEqual(['ⓝ현재']);
        expect(result.seed.events).toEqual([
            ['Month', 500, ['Date', '>=', 200, 1], ['Existing']],
            [
                'Month',
                1_000,
                ['Date', '>=', 204, 1],
                ['RegNPC', 0, '미래1', null, 1, null, 50, 60, 40, 3, 190, 250, null, '', ''],
                ['RegNPC', 0, '미래확장', null, 1, null, 50, 60, 40, 3, 190, 260, null, '', ''],
                ['DeleteEvent'],
            ],
            [
                'Month',
                1_000,
                ['Date', '>=', 205, 1],
                ['RegNeutralNPC', 0, '미래재야', null, 0, null, 50, 60, 40, 191, 260, null, '', ''],
                ['DeleteEvent'],
            ],
        ]);
        expect(result.snapshot.events).toEqual(result.seed.events);
        expect(result.seed.events.flat(3)).not.toContain('만료');
    });
});
