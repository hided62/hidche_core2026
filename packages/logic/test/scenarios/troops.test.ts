import { describe, expect, it } from 'vitest';
import { MINIMAL_MAP } from '../fixtures/minimalMap.js';
import { InMemoryWorld, TestGameRunner } from '../testEnv.js';
import type { City, General, Nation } from '../../src/domain/entities.js';
import type { WorldSnapshot } from '../../src/world/types.js';
import { commandSpec as recruitSpec } from '../../src/actions/turn/general/che_징병.js';
import { commandSpec as trainSpec } from '../../src/actions/turn/general/che_훈련.js';
import { commandSpec as atmosSpec } from '../../src/actions/turn/general/che_사기진작.js';
import type { TurnCommandEnv } from '../../src/actions/turn/commandEnv.js';
import { createRefOrderedActionStack } from '../../src/actionModules/bundle.js';
import type { GeneralActionModule } from '../../src/actionModules/general.js';
import { applyLegacyInjury, finalizeLegacyStat } from '../../src/actions/turn/general/legacyGeneralStat.js';

describe('Troop Management Scenario', () => {
    it('applies injury before action stat modifiers and floors like Ref General::getLeadership()', () => {
        const injured = applyLegacyInjury(62, 3);
        expect(injured).toBeCloseTo(60.14, 12);
        expect(finalizeLegacyStat(injured * 2)).toBe(120);
        expect(Math.round(((120 * 100) / 6076) * 30)).toBe(59);
    });

    it('should successfully draft troops, then train and boost morale', async () => {
        // 1. Setup World
        const mockNation: Nation = {
            id: 1,
            name: 'Militaristic Nation',
            color: '#FF0000',
            capitalCityId: 1,
            chiefGeneralId: 1,
            gold: 50000,
            rice: 50000,
            power: 0,
            level: 5,
            typeCode: 'test',
            meta: {},
        };

        const cityDef = MINIMAL_MAP.cities[0];
        if (!cityDef) throw new Error('City definition missing');
        const mockCity: City = {
            id: 1,
            name: cityDef.name,
            nationId: 1,
            level: 1,
            state: 0,
            population: 50000,
            populationMax: 50000,
            agriculture: 500,
            agricultureMax: 1000,
            commerce: 500,
            commerceMax: 1000,
            security: 500,
            securityMax: 1000,
            defence: 500,
            defenceMax: 1000,
            wall: 500,
            wallMax: 1000,
            supplyState: 1,
            frontState: 0,
            meta: {},
        };

        const mockGeneral: General = {
            id: 1,
            name: 'General Lee',
            nationId: 1,
            cityId: 1,
            troopId: 0,
            npcState: 0,
            experience: 100,
            dedication: 100,
            officerLevel: 5,
            gold: 1000,
            rice: 1000,
            crew: 0,
            crewTypeId: 1,
            train: 10,
            atmos: 10,
            injury: 0,
            age: 30,
            stats: { leadership: 100, strength: 100, intelligence: 50 },
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
                crewTypes: [{ id: 1, name: 'Infantry', armType: 1, cost: 10, requirements: [] }],
            } as any,
            nations: [mockNation],
            cities: [mockCity],
            generals: [mockGeneral],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
        };

        const world = new InMemoryWorld(snapshot);
        const runner = new TestGameRunner(world, 200, 1);

        const systemEnv: TurnCommandEnv = {
            develCost: 50,
            trainDelta: 35,
            atmosDelta: 35,
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
            ...(snapshot.unitSet ? { unitSet: snapshot.unitSet } : {}),
            generalActionModules: (() => {
                const noOp = {};
                return createRefOrderedActionStack({
                    nation: noOp,
                    officer: noOp,
                    domestic: noOp,
                    war: noOp,
                    personality: {
                        eventHandlers: {},
                        onCalcStat: (_context, statName, value) => {
                            if (typeof value !== 'number') return value;
                            if (statName === 'experience') return value * 0.9;
                            if (statName === 'addDex') return value * 0.5;
                            return value;
                        },
                    } satisfies GeneralActionModule,
                    crewType: null,
                    inheritance: noOp,
                    scenario: null,
                    items: [],
                });
            })(),
        };

        // 2. Draft Troops
        const recruitDef = recruitSpec.createDefinition(systemEnv);
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_징병',
                resolver: recruitDef,
                args: { crewType: 1, amount: 1000 },
            },
        ]);

        const generalAfterDraft = world.getGeneral(1)!;
        expect(generalAfterDraft.crew).toBe(1000);
        // Ref's General::addExperience() applies personality/item stat modules
        // after rounding the crew-based base reward. Dedication is routed
        // through the same pipeline but remains unchanged in this fixture.
        expect(generalAfterDraft.experience).toBe(109);
        expect(generalAfterDraft.dedication).toBe(110);
        // General::addDex(): 보병(armType 1)은 징병 인원 / 100만큼 숙련도가 오른다.
        expect(generalAfterDraft.meta.dex1).toBe(5);
        // Ref che_징병 stores aux.armType and its AI keeps that category on
        // later recruitment decisions.
        expect(generalAfterDraft.meta.armType).toBe(1);
        // 훈련/사기진작의 실제 증가분과 addDex 파이프라인을 관찰할 여유를 만든다.
        world.snapshot.generals = world.snapshot.generals.map((general) =>
            general.id === generalAfterDraft.id ? { ...general, train: 80, atmos: 80 } : general
        );

        // 3. Train
        const trainDef = trainSpec.createDefinition(systemEnv);
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_훈련',
                resolver: trainDef,
                args: {},
            },
        ]);

        const generalAfterTrain = world.getGeneral(1)!;
        // 레거시 훈련식: round(통솔 * 100 * trainDelta / 병력), 상한까지 적용.
        expect(generalAfterTrain.train).toBe(100);
        // General::addExperience()/addDedication()/addDex()와 동일하게 모듈 보정을 거친다.
        expect(generalAfterTrain.experience).toBe(199);
        expect(generalAfterTrain.dedication).toBe(180);
        expect(generalAfterTrain.meta.dex1).toBe(15);

        // 4. Boost Morale
        const atmosDef = atmosSpec.createDefinition(systemEnv);
        await runner.runTurn([
            {
                generalId: 1,
                commandKey: 'che_사기진작',
                resolver: atmosDef,
                args: {},
            },
        ]);

        const generalAfterAtmos = world.getGeneral(1)!;
        // 레거시 사기진작식: round(통솔 * 100 / 병력 * atmosDelta), 명령 상한까지 적용.
        expect(generalAfterAtmos.atmos).toBe(100);
        expect(generalAfterAtmos.experience).toBe(289);
        expect(generalAfterAtmos.dedication).toBe(250);
        expect(generalAfterAtmos.meta.dex1).toBe(25);
    });
});
