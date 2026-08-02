import { describe, expect, it } from 'vitest';

import type { City, General, Nation } from '../src/domain/entities.js';
import { commandSpec as fireSpec } from '../src/actions/turn/general/che_화계.js';
import type { TurnCommandEnv } from '../src/actions/turn/commandEnv.js';
import type { WorldSnapshot } from '../src/world/types.js';
import { MINIMAL_MAP } from './fixtures/minimalMap.js';
import { InMemoryWorld, TestGameRunner } from './testEnv.js';

const commandEnv: TurnCommandEnv = {
    develCost: 100,
    trainDelta: 35,
    atmosDelta: 35,
    maxTrainByCommand: 100,
    maxAtmosByCommand: 100,
    sabotageDefaultProb: 0.5,
    sabotageProbCoefByStat: 0.1,
    sabotageDefenceCoefByGeneralCount: 0.1,
    sabotageDamageMin: 10,
    sabotageDamageMax: 30,
    openingPartYear: 180,
    maxGeneral: 10,
    defaultNpcGold: 1_000,
    defaultNpcRice: 1_000,
    defaultCrewTypeId: 1,
    defaultSpecialDomestic: null,
    defaultSpecialWar: null,
    initialNationGenLimit: 10,
    maxTechLevel: 10,
    baseGold: 1_000,
    baseRice: 1_000,
    maxResourceActionAmount: 1_000,
};

const makeNation = (id: number): Nation => ({
    id,
    name: `계략감사국${id}`,
    color: '#330000',
    capitalCityId: id,
    chiefGeneralId: id,
    gold: 10_000,
    rice: 10_000,
    power: 0,
    level: 1,
    typeCode: 'che_중립',
    meta: {},
});

const makeCity = (id: number, nationId: number): City => ({
    id,
    name: `계략감사성${id}`,
    nationId,
    level: 1,
    state: 0,
    population: 10_000,
    populationMax: 20_000,
    agriculture: 2_000,
    agricultureMax: 2_000,
    commerce: 2_000,
    commerceMax: 2_000,
    security: 1_000,
    securityMax: 2_000,
    defence: 500,
    defenceMax: 500,
    wall: 500,
    wallMax: 500,
    supplyState: 1,
    frontState: 0,
    meta: { trust: 50 },
});

const makeGeneral = (id: number, nationId: number, cityId: number): General => ({
    id,
    name: `계략감사장${id}`,
    nationId,
    cityId,
    troopId: 0,
    npcState: 0,
    experience: 0,
    dedication: 0,
    officerLevel: 5,
    gold: 100_000,
    rice: 100_000,
    crew: 1_000,
    crewTypeId: 1,
    train: 100,
    atmos: 100,
    injury: 0,
    age: 30,
    stats: { leadership: 70, strength: 70, intelligence: 70 },
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
});

describe('best-general sabotage audit', () => {
    it('repeats real fire-attack turns until one succeeds and increments firenum', async () => {
        const attackerNation = makeNation(1);
        const defenderNation = makeNation(2);
        const attackerCity = makeCity(1, 1);
        const defenderCity = makeCity(2, 2);
        const attacker = makeGeneral(1, 1, 1);
        const defender = makeGeneral(2, 2, 2);
        const snapshot: WorldSnapshot = {
            scenarioConfig: { environment: { mapName: 'minimal_map', unitSet: 'default' } } as never,
            scenarioMeta: { startYear: 180 } as never,
            map: MINIMAL_MAP,
            unitSet: { id: 'default', name: 'default', crewTypes: [] },
            nations: [attackerNation, defenderNation],
            cities: [attackerCity, defenderCity],
            generals: [attacker, defender],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
        };
        const world = new InMemoryWorld(snapshot);
        const runner = new TestGameRunner(world, 180, 1, 'best-general-sabotage-audit-2');
        const fire = fireSpec.createDefinition(commandEnv);
        let attempts = 0;

        while ((world.getGeneral(attacker.id)?.meta.firenum ?? 0) === 0 && attempts < 20) {
            attempts += 1;
            await runner.runTurn([
                {
                    generalId: attacker.id,
                    commandKey: 'che_화계',
                    resolver: fire,
                    args: { destCityId: defenderCity.id },
                    context: {
                        destCity: world.getCity(defenderCity.id),
                        destNation: defenderNation,
                        destGenerals: [world.getGeneral(defender.id)],
                        distance: 1,
                        env: commandEnv,
                        map: MINIMAL_MAP,
                    },
                },
            ]);
        }

        expect(attempts).toBe(3);
        expect(world.getGeneral(attacker.id)?.meta.firenum).toBe(1);
    });
});
