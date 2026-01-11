import { describe, expect, it } from 'vitest';
import type { City, General, Nation } from '../../../src/domain/entities.js';
import { resolveGeneralAction } from '../../../src/actions/engine.js';
import { ActionDefinition as DeclareWarAction } from '../../../src/actions/turn/nation/che_선전포고.js';
import { ActionDefinition as MoveCapitalAction } from '../../../src/actions/turn/nation/che_천도.js';
import { ActionDefinition as ChangeNationNameAction } from '../../../src/actions/turn/nation/che_국호변경.js';
import { ActionDefinition as ExpandCityAction } from '../../../src/actions/turn/nation/che_증축.js';
import { ActionDefinition as LastStandAction } from '../../../src/actions/turn/nation/che_필사즉생.js';
import { LogCategory, LogScope } from '../../../src/logging/types.js';
import type { MapDefinition } from '../../../src/world/types.js';
import type { TurnSchedule } from '../../../src/turn/calendar.js';

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
    chiefGeneralId: id === 1 ? 1 : null,
    gold: 5000,
    rice: 5000,
    power: 0,
    level: 1,
    typeCode: 'test',
    meta: {
        tech: 1000,
        strategic_cmd_limit: 0,
    },
});

const schedule: TurnSchedule = {
    entries: [{ startMinute: 0, tickMinutes: 60 }],
};

describe('Nation Actions', () => {
    describe('che_선전포고 (Declare War)', () => {
        it('succeeds with neighbor and year 2', () => {
            const nation1 = buildNation(1);
            const nation2 = buildNation(2);
            const city1 = buildCity(1, 1);
            const city2 = buildCity(2, 2);
            const general = buildGeneral(1, 1, 1);
            nation1.chiefGeneralId = general.id;

            const definition = new DeclareWarAction();
            const context = {
                general,
                city: city1,
                nation: nation1,
                destNation: nation2,
                cities: [city1, city2],
                nations: [nation1, nation2],
                rng: {} as any,
                addLog: () => {},
            };

            const resolution = resolveGeneralAction(
                definition,
                context as any,
                { now: new Date(), schedule },
                { destNationId: 2 }
            );

            expect(resolution.effects).toContainEqual(
                expect.objectContaining({
                    type: 'diplomacy:patch',
                    srcNationId: 1,
                    destNationId: 2,
                    patch: expect.objectContaining({ state: 1 }),
                })
            );
            expect(resolution.logs.some((l) => l.scope === LogScope.SYSTEM && l.category === LogCategory.ACTION)).toBe(
                true
            );
            expect(resolution.logs.some((l) => l.text.includes('【국메】'))).toBe(true);
        });

        it('fails if not neighbor', () => {
            const nation1 = buildNation(1);
            const nation2 = buildNation(2);
            const city1 = buildCity(1, 1);
            const city2 = buildCity(99, 2); // city 99 is not connected to city 1

            const isolatedMap: MapDefinition = {
                id: 'test',
                name: 'test',
                cities: [
                    {
                        id: 1,
                        name: 'City1',
                        connections: [],
                        level: 1,
                        region: 1,
                        position: { x: 0, y: 0 },
                        max: {} as any,
                        initial: {} as any,
                    },
                    {
                        id: 99,
                        name: 'City2',
                        connections: [],
                        level: 1,
                        region: 1,
                        position: { x: 1, y: 1 },
                        max: {} as any,
                        initial: {} as any,
                    },
                ],
            };

            const definition = new DeclareWarAction();
            const constraints = definition.buildConstraints(
                {
                    actorId: 1,
                    nationId: 1,
                    destNationId: 2,
                    env: {
                        relYear: 1,
                        map: isolatedMap,
                        cities: [city1, city2],
                    },
                    args: { destNationId: 2 },
                    mode: 'full',
                } as any,
                { destNationId: 2 }
            );

            const nearNationConstraint = constraints.find((c) => c.name === 'nearNation');
            expect(nearNationConstraint).toBeDefined();

            // NearNation needs StateView
            const view = {
                has: () => true,
                get: (req: any) => {
                    if (req.kind === 'env' && req.key === 'cities') return [city1, city2];
                    if (req.kind === 'env' && req.key === 'map') return isolatedMap;
                    if (req.kind === 'destNation') return nation2;
                    if (req.kind === 'nation') return nation1;
                    return null;
                },
            };

            const result = nearNationConstraint!.test(
                {
                    actorId: 1,
                    nationId: 1,
                    destNationId: 2,
                    env: { relYear: 1, map: isolatedMap, cities: [city1, city2] },
                    args: { destNationId: 2 },
                    mode: 'full',
                } as any,
                view as any
            );

            expect(result.kind).toBe('deny');
            if (result.kind === 'deny') {
                expect(result.reason).toBe('인접 국가가 아닙니다.');
            }
        });
    });

    describe('che_필사즉생 (Last Stand)', () => {
        it('increases experience and sets strategic limit', () => {
            const nation = buildNation(1);
            const general = buildGeneral(1, 1, 1);
            const definition = new LastStandAction([]);

            const context = {
                general,
                nation,
                nationGenerals: [general],
                addLog: () => {},
                rng: {} as any,
            };

            definition.resolve(context as any, {});

            expect(general.experience).toBeGreaterThan(100);
            expect(nation.meta.strategic_cmd_limit).toBeGreaterThan(0);
        });
    });

    describe('che_천도 (Move Capital)', () => {
        it('changes nation capital city', () => {
            const nation = buildNation(1);
            const city1 = buildCity(1, 1);
            const city2 = buildCity(2, 1);
            const general = buildGeneral(1, 1, 1);
            const env = { develCost: 100, baseGold: 100, baseRice: 100 };
            const definition = new MoveCapitalAction(env as any);

            const context = {
                general,
                nation,
                city: city1,
                destCity: city2,
                rng: {} as any,
                map: {
                    cities: [
                        { id: 1, connections: [2] },
                        { id: 2, connections: [1] },
                    ],
                } as any,
                addLog: () => {},
            };

            const resolution = definition.resolve(context as any, { destCityID: 2 });

            expect(resolution.effects).toContainEqual(
                expect.objectContaining({
                    type: 'nation:patch',
                    patch: expect.objectContaining({ capitalCityId: 2 }),
                })
            );
        });
    });

    describe('che_국호변경 (Change Nation Name)', () => {
        it('changes nation name', () => {
            const nation = buildNation(1, 'OldName');
            const general = buildGeneral(1, 1, 1);
            const definition = new ChangeNationNameAction();

            const context = {
                general,
                nation,
                rng: {} as any,
                addLog: () => {},
            };

            const resolution = definition.resolve(context as any, { nationName: 'NewName' });

            expect(resolution.effects).toContainEqual(
                expect.objectContaining({
                    type: 'nation:patch',
                    patch: expect.objectContaining({ name: 'NewName' }),
                })
            );
        });
    });

    describe('che_증축 (City Expansion)', () => {
        it('increases city level and stats', () => {
            const nation = buildNation(1);
            const city = buildCity(1, 1);
            city.level = 2;
            const general = buildGeneral(1, 1, 1);
            const env = { develCost: 100, baseGold: 100, baseRice: 100 };
            const definition = new ExpandCityAction(env as any);

            const context = {
                general,
                nation,
                capitalCity: city,
                rng: {} as any,
                addLog: () => {},
            };

            const resolution = definition.resolve(context as any, {});

            expect(resolution.effects).toContainEqual(
                expect.objectContaining({
                    type: 'city:patch',
                    patch: expect.objectContaining({ level: 3 }),
                })
            );
        });
    });
});
