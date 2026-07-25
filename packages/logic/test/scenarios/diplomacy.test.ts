import { describe, expect, it } from 'vitest';
import { MINIMAL_MAP } from '../fixtures/minimalMap.js';
import { InMemoryWorld, TestGameRunner } from '../testEnv.js';
import type { City, General, Nation } from '../../src/domain/entities.js';
import type { WorldSnapshot } from '../../src/world/types.js';
import { commandSpec as declareWarSpec } from '../../src/actions/turn/nation/che_선전포고.js';
import { commandSpec as deploySpec } from '../../src/actions/turn/general/che_출병.js';
import type { TurnCommandEnv } from '../../src/actions/turn/commandEnv.js';
import { processDiplomacyMonth, DIPLOMACY_STATE, type DiplomacyEntry } from '../../src/diplomacy/index.js';
import { evaluateConstraints } from '../../src/constraints/evaluate.js';
import type { ConstraintContext, RequirementKey, StateView } from '../../src/constraints/types.js';

describe('Diplomacy Scenario', () => {
    it('changes deployment from denied to allowed when a declaration becomes war', async () => {
        // 1. Setup World
        const NATION_A_ID = 1;
        const NATION_B_ID = 2; // Target nation

        const mockNationA: Nation = {
            id: NATION_A_ID,
            name: 'Nation A',
            color: '#FF0000',
            capitalCityId: 1,
            chiefGeneralId: 1,
            gold: 10000,
            rice: 10000,
            power: 0,
            level: 5,
            typeCode: 'test',
            meta: {},
        };
        const mockNationB: Nation = {
            id: NATION_B_ID,
            name: 'Nation B',
            color: '#0000FF',
            capitalCityId: 2,
            chiefGeneralId: 2,
            gold: 10000,
            rice: 10000,
            power: 0,
            level: 5,
            typeCode: 'test',
            meta: {},
        };

        const cityADef = MINIMAL_MAP.cities[0];
        const cityBDef = MINIMAL_MAP.cities[1];
        if (!cityADef || !cityBDef) throw new Error('City definition missing');

        const mockCityA: City = {
            id: 1,
            name: cityADef.name,
            nationId: NATION_A_ID,
            level: 1,
            state: 0,
            population: 10000,
            populationMax: 10000,
            agriculture: 1000,
            agricultureMax: 1000,
            commerce: 1000,
            commerceMax: 1000,
            security: 1000,
            securityMax: 1000,
            defence: 1000,
            defenceMax: 1000,
            wall: 1000,
            wallMax: 1000,
            supplyState: 1,
            frontState: 0,
            meta: {},
        };
        const mockCityB: City = {
            id: 2,
            name: cityBDef.name,
            nationId: NATION_B_ID,
            level: 1,
            state: 0,
            population: 10000,
            populationMax: 10000,
            agriculture: 1000,
            agricultureMax: 1000,
            commerce: 1000,
            commerceMax: 1000,
            security: 1000,
            securityMax: 1000,
            defence: 1000,
            defenceMax: 1000,
            wall: 1000,
            wallMax: 1000,
            supplyState: 1,
            frontState: 0,
            meta: {},
        };

        const mockGeneralA: General = {
            id: 1,
            name: 'Leader A',
            nationId: NATION_A_ID,
            cityId: 1,
            troopId: 0,
            npcState: 0,
            experience: 100,
            dedication: 100,
            officerLevel: 5,
            gold: 1000,
            rice: 1000,
            crew: 5000,
            crewTypeId: 1,
            train: 100,
            atmos: 100,
            injury: 0,
            age: 30,
            stats: { leadership: 100, strength: 100, intelligence: 100 },
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: null },
            },
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: { killturn: 24 },
        };

        const snapshot: WorldSnapshot = {
            scenarioConfig: { environment: { mapName: 'minimal_map', unitSet: 'default' }, options: {} } as any,
            scenarioMeta: {
                title: 'Test',
                startYear: 200,
                life: 0,
                fiction: 0,
                history: [],
                ignoreDefaultEvents: false,
            },
            map: MINIMAL_MAP,
            unitSet: {
                id: 'default',
                name: 'default',
                defaultCrewTypeId: 1,
                armTypes: { 0: '성벽', 1: '보병' },
                crewTypes: [
                    {
                        id: 0,
                        name: '성벽',
                        armType: 0,
                        attack: 0,
                        defence: 100,
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
                    {
                        id: 1,
                        name: '보병',
                        armType: 1,
                        attack: 100,
                        defence: 100,
                        speed: 5,
                        avoid: 0,
                        magicCoef: 0,
                        cost: 10,
                        rice: 1,
                        requirements: [],
                        attackCoef: {},
                        defenceCoef: {},
                        info: [],
                        initSkillTrigger: null,
                        phaseSkillTrigger: null,
                        iActionList: null,
                    },
                ],
            },
            nations: [mockNationA, mockNationB],
            cities: [mockCityA, mockCityB],
            generals: [mockGeneralA],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
        };

        const world = new InMemoryWorld(snapshot);
        const runner = new TestGameRunner(world, 200, 1);

        const systemEnv: TurnCommandEnv = {
            develCost: 50,
            trainDelta: 5,
            atmosDelta: 5,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            sabotageDefaultProb: 0.5,
            sabotageProbCoefByStat: 0.1,
            sabotageDefenceCoefByGeneralCount: 0.1,
            sabotageDamageMin: 10,
            sabotageDamageMax: 20,
            openingPartYear: 200,
            maxGeneral: 10,
            defaultNpcGold: 1000,
            defaultNpcRice: 1000,
            defaultCrewTypeId: 1,
            defaultSpecialDomestic: null,
            defaultSpecialWar: null,
            initialNationGenLimit: 10,
            maxTechLevel: 10,
            baseGold: 1000,
            baseRice: 1000,
            maxResourceActionAmount: 1000,
        };

        // 2. Declare War
        const declareWarDef = declareWarSpec.createDefinition(systemEnv);
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_선전포고',
                resolver: declareWarDef,
                args: { destNationId: NATION_B_ID },
                context: {
                    destNation: mockNationB,
                },
            },
        ]);

        const diplomacyAB = world.getDiplomacy(NATION_A_ID, NATION_B_ID);
        expect(diplomacyAB).toBeDefined();
        expect(diplomacyAB?.state).toBe(DIPLOMACY_STATE.DECLARATION);

        const dispatchArgs = { destCityId: 2 };

        const buildConstraintView = (): StateView => {
            const get = (requirement: RequirementKey): unknown | null => {
                switch (requirement.kind) {
                    case 'general':
                    case 'destGeneral':
                        return world.getGeneral(requirement.id) ?? null;
                    case 'generalList':
                        return world.getAllGenerals();
                    case 'city':
                    case 'destCity':
                        return world.getCity(requirement.id) ?? null;
                    case 'nation':
                    case 'destNation':
                        return world.getNation(requirement.id) ?? null;
                    case 'nationList':
                        return world.getAllNations();
                    case 'diplomacy':
                        return world.getDiplomacy(requirement.srcNationId, requirement.destNationId) ?? null;
                    case 'diplomacyList':
                        return world.snapshot.diplomacy;
                    case 'arg':
                        return dispatchArgs[requirement.key as keyof typeof dispatchArgs] ?? null;
                    case 'env':
                        if (requirement.key === 'map') return world.snapshot.map;
                        if (requirement.key === 'cities') return world.getAllCities();
                        if (requirement.key === 'nations') return world.getAllNations();
                        if (requirement.key === 'relYear') return 200;
                        if (requirement.key === 'openingPartYear') return 200;
                        return null;
                }
            };
            return {
                has: (requirement) => get(requirement) !== null,
                get,
            };
        };
        const buildDispatchConstraintContext = (): ConstraintContext => ({
            actorId: mockGeneralA.id,
            cityId: mockGeneralA.cityId,
            nationId: mockGeneralA.nationId,
            destCityId: dispatchArgs.destCityId,
            destNationId: NATION_B_ID,
            args: dispatchArgs,
            env: {
                relYear: 200,
                openingPartYear: 200,
            },
            mode: 'full',
        });

        // 3. A declaration is not yet a war, so deployment must be rejected.
        const deployDef = deploySpec.createDefinition(systemEnv);
        const declarationResult = evaluateConstraints(
            deployDef.buildConstraints(buildDispatchConstraintContext(), dispatchArgs),
            buildDispatchConstraintContext(),
            buildConstraintView()
        );
        expect(declarationResult).toMatchObject({
            kind: 'deny',
            constraintName: 'hasRouteWithEnemy',
            reason: '교전중인 국가가 아닙니다.',
        });
        expect(world.getGeneral(1)?.experience).toBe(100);

        // 4. Simulate State Transition
        for (let i = 0; i < 24; i++) {
            const entries: DiplomacyEntry[] = world.snapshot.diplomacy.map((s) => ({
                fromNationId: s.fromNationId,
                toNationId: s.toNationId,
                state: s.state,
                term: s.durationMonths,
                dead: 0,
                meta: {},
            }));

            const updatedEntries = processDiplomacyMonth(entries, new Map());

            world.snapshot.diplomacy = updatedEntries.map((e) => ({
                fromNationId: e.fromNationId,
                toNationId: e.toNationId,
                state: e.state,
                durationMonths: e.term,
            }));

            runner.currentDate.setMonth(runner.currentDate.getMonth() + 1);
        }

        const diplomacyAB_After = world.getDiplomacy(NATION_A_ID, NATION_B_ID);
        expect(diplomacyAB_After?.state).toBe(DIPLOMACY_STATE.WAR);

        // 5. The same command becomes valid after the declaration reaches WAR.
        const warResult = evaluateConstraints(
            deployDef.buildConstraints(buildDispatchConstraintContext(), dispatchArgs),
            buildDispatchConstraintContext(),
            buildConstraintView()
        );
        expect(warResult).toEqual({ kind: 'allow' });
    });
});
