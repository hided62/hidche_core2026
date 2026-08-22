import { describe, expect, it } from 'vitest';
import type { City, General, Nation } from '../../src/domain/entities.js';
import { loadActionModuleBundle } from '../../src/actionModules/bundle.js';
import { commandSpec as conscriptSpec } from '../../src/actions/turn/general/che_징병.js';
import { commandSpec as recruitSpec } from '../../src/actions/turn/general/che_모병.js';
import type { TurnCommandEnv } from '../../src/actions/turn/commandEnv.js';
import type { WorldSnapshot } from '../../src/world/types.js';
import { MINIMAL_MAP } from '../fixtures/minimalMap.js';
import { InMemoryWorld, TestGameRunner } from '../testEnv.js';

const NATION_ID = 1;
const CITY_ID = 1;
const GENERAL_ID = 1;
const CREW_TYPE_ID = 1;
const UNIT_SET = {
    id: 'default',
    name: 'default',
    crewTypes: [
        {
            id: CREW_TYPE_ID,
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
};

const makeWorld = (): InMemoryWorld => {
    const nation: Nation = {
        id: NATION_ID,
        name: '추가 통솔 테스트국',
        color: '#ffffff',
        capitalCityId: CITY_ID,
        chiefGeneralId: GENERAL_ID,
        gold: 100_000,
        rice: 100_000,
        power: 0,
        level: 5,
        typeCode: 'test',
        meta: { tech: 0 },
    };
    const cityDefinition = MINIMAL_MAP.cities[0];
    if (!cityDefinition) {
        throw new Error('minimal map city is missing');
    }
    const city: City = {
        id: CITY_ID,
        name: cityDefinition.name,
        nationId: NATION_ID,
        level: 1,
        state: 0,
        population: 100_000,
        populationMax: 100_000,
        agriculture: 1_000,
        agricultureMax: 1_000,
        commerce: 1_000,
        commerceMax: 1_000,
        security: 1_000,
        securityMax: 1_000,
        defence: 1_000,
        defenceMax: 1_000,
        wall: 1_000,
        wallMax: 1_000,
        supplyState: 1,
        frontState: 0,
        meta: { trust: 100 },
    };
    const general: General = {
        id: GENERAL_ID,
        name: '추가 통솔 장수',
        nationId: NATION_ID,
        cityId: CITY_ID,
        troopId: 0,
        npcState: 0,
        experience: 0,
        dedication: 0,
        officerLevel: 5,
        gold: 100_000,
        rice: 100_000,
        crew: 10_000,
        crewTypeId: CREW_TYPE_ID,
        train: 100,
        atmos: 100,
        injury: 0,
        age: 30,
        stats: { leadership: 100, strength: 70, intelligence: 70 },
        role: {
            personality: null,
            specialDomestic: null,
            specialWar: null,
            items: { horse: 'che_명마_10_옥추마', weapon: null, book: null, item: null },
        },
        triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
        meta: { killturn: 24 },
    };
    const snapshot: WorldSnapshot = {
        scenarioConfig: { environment: { mapName: 'minimal_map', unitSet: 'default' }, options: {} } as never,
        scenarioMeta: {
            title: '추가 통솔 테스트',
            startYear: 200,
            life: 0,
            fiction: 0,
            history: [],
            ignoreDefaultEvents: false,
        },
        map: MINIMAL_MAP,
        unitSet: UNIT_SET,
        nations: [nation],
        cities: [city],
        generals: [general],
        troops: [],
        diplomacy: [],
        events: [],
        initialEvents: [],
    };
    return new InMemoryWorld(snapshot);
};

const makeEnv = async (): Promise<TurnCommandEnv> => {
    const actionModules = await loadActionModuleBundle();
    return {
        unitSet: UNIT_SET,
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
        defaultNpcGold: 1_000,
        defaultNpcRice: 1_000,
        defaultCrewTypeId: CREW_TYPE_ID,
        defaultSpecialDomestic: null,
        defaultSpecialWar: null,
        initialNationGenLimit: 10,
        maxTechLevel: 10,
        baseGold: 1_000,
        baseRice: 1_000,
        maxResourceActionAmount: 1_000,
        generalActionModules: actionModules.general,
    };
};

describe.each([
    ['징병', 'che_징병', conscriptSpec],
    ['모병', 'che_모병', recruitSpec],
] as const)('%s 추가 통솔 병력 여유', (_name, commandKey, commandSpec) => {
    it('원시 통솔 한도에 도달해도 보정 통솔만큼 같은 병종을 추가 모집한다', async () => {
        const world = makeWorld();
        const runner = new TestGameRunner(world, 200, 1);
        const definition = commandSpec.createDefinition(await makeEnv());

        await runner.runTurn([
            {
                generalId: GENERAL_ID,
                commandKey,
                resolver: definition,
                args: { crewType: CREW_TYPE_ID, amount: 100 },
            },
        ]);

        expect(world.getGeneral(GENERAL_ID)?.crew).toBe(10_100);
    });
});
