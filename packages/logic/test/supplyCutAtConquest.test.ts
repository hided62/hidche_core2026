import { describe, expect, it } from 'vitest';

import type { City, General, Nation } from '../src/domain/entities.js';
import { resolveGeneralAction } from '../src/actions/engine.js';
import { ActionDefinition } from '../src/actions/turn/general/che_출병.js';
import type { DispatchResolveContext } from '../src/actions/turn/general/che_출병.js';
import type { TurnSchedule } from '../src/turn/calendar.js';
import type { WarAftermathConfig, WarEngineConfig } from '../src/war/types.js';
import type { MapDefinition, UnitSetDefinition } from '../src/world/types.js';

// Ref 계승 계약: city.supply 재계산은 월 경계의 UpdateCitySupply(pre_month)에서만
// 일어나고, 출병 점령 순간에는 점령 도시와 긴급천도 신수도에만 supply=1을 쓴다.
// (ref TurnExecutionHelper.php PreMonth→preUpdateMonthly 순서, process_war.php의
//  'supply' => 1 쓰기 두 곳) 월중에는 다른 도시의 supply가 절대 0으로 바뀌면 안 된다.

const buildGeneral = (id: number, nationId: number, cityId: number): General => ({
    id,
    name: `General${id}`,
    nationId,
    cityId,
    troopId: 0,
    stats: { leadership: 70, strength: 70, intelligence: 70 },
    experience: 100,
    dedication: 100,
    officerLevel: 3,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
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
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
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

const buildNation = (id: number, capitalCityId: number): Nation => ({
    id,
    name: `Nation${id}`,
    color: '#000000',
    capitalCityId,
    chiefGeneralId: null,
    gold: 5000,
    rice: 5000,
    power: 0,
    level: 1,
    typeCode: 'test',
    meta: { tech: 1000 },
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
    nextFloat1: () => 0.1,
    nextBool: (probability: number) => probability >= 0.1,
    nextInt: (minInclusive: number, _maxExclusive: number) => minInclusive,
};

const schedule: TurnSchedule = {
    entries: [{ startMinute: 0, tickMinutes: 60 }],
};

// 수도 21 - 중간도시 20 - 외곽도시 22 사슬에서 20만 국가1 영토였고,
// 공격자 국가2의 도시 10이 20과 인접한다. 20을 먹히면 22는 월 경계 이후에
// 고립되지만, 점령 그 순간에는 아니다.
const mapCities: MapDefinition['cities'] = [
    { id: 10, name: 'AggBase', level: 2, region: 1, position: { x: 0, y: 0 }, connections: [20] },
    { id: 20, name: 'Mid', level: 2, region: 1, position: { x: 1, y: 0 }, connections: [10, 21, 22] },
    { id: 21, name: 'Cap', level: 2, region: 1, position: { x: 2, y: 0 }, connections: [20] },
    { id: 22, name: 'Far', level: 2, region: 1, position: { x: 3, y: 0 }, connections: [20] },
].map((city) => ({
    ...city,
    max: { population: 10000, agriculture: 1000, commerce: 1000, security: 1000, defence: 400, wall: 400 },
    initial: { population: 10000, agriculture: 1000, commerce: 1000, security: 1000, defence: 200, wall: 200 },
}));

describe('출병 점령과 보급切断 시점', () => {
    it('does not cut any other city supply in the same turn the route city is conquered', () => {
        const defenderNation = buildNation(1, 21);
        const attackerNation = buildNation(2, 10);
        const aggBase = buildCity(10, attackerNation.id);
        const midCity = buildCity(20, defenderNation.id);
        const capCity = buildCity(21, defenderNation.id);
        const farCity = buildCity(22, defenderNation.id);
        midCity.defence = 0;
        midCity.wall = 0;
        const attacker = buildGeneral(1, attackerNation.id, aggBase.id);
        attacker.turnTime = new Date('2000-01-01T00:00:00Z');

        const context: Omit<DispatchResolveContext, 'addLog'> = {
            general: attacker,
            city: aggBase,
            nation: attackerNation,
            rng,
            destCity: midCity,
            destNation: defenderNation,
            cities: [aggBase, midCity, capCity, farCity],
            nations: [attackerNation, defenderNation],
            generals: [attacker],
            unitSet,
            map: { id: 'supply-chain', name: 'supply-chain', cities: mapCities },
            diplomacy: [
                { fromNationId: attackerNation.id, toNationId: defenderNation.id, state: 0, term: 0 },
                { fromNationId: defenderNation.id, toNationId: attackerNation.id, state: 0, term: 0 },
            ],
            time: { year: 191, month: 10, startYear: 180 },
            seedBase: 'supply-cut-seed',
            warConfig,
            aftermathConfig,
            messageTime: new Date('2000-01-01T00:00:00.000Z'),
        };

        const resolution = resolveGeneralAction(
            new ActionDefinition(),
            context,
            { now: new Date('2000-01-01T00:00:00Z'), schedule },
            { destCityId: midCity.id }
        );

        // 점령 자체가 일어나야 테스트 의미가 있다.
        expect(resolution.completed).toBe(true);

        const cityPatches = resolution.patches?.cities ?? [];

        // 점령 도시는 소유권 이동 + Ref의 'supply' => 1 재설정만 받는다.
        const midPatch = cityPatches.find((patch) => patch.id === midCity.id);
        expect(midPatch?.patch.nationId).toBe(attackerNation.id);
        expect(midPatch?.patch.supplyState).toBe(1);

        // 월중에는 그 어떤 도시도 supply=0으로 패치되지 않는다.
        // (Ref: process_war.php는 점령 도시와 천도 신수도에만 supply=1을 쓴다.)
        expect(
            cityPatches.filter((patch) => 'supplyState' in patch.patch && patch.patch.supplyState === 0)
        ).toEqual([]);

        // 고립될 외곽도시와 수도는 이 명령 처리 중에 손대지 않는다.
        expect(farCity.supplyState).toBe(1);
        expect(capCity.supplyState).toBe(1);
        expect(cityPatches.some((patch) => patch.id === farCity.id && 'supplyState' in patch.patch)).toBe(false);
        expect(cityPatches.some((patch) => patch.id === capCity.id && 'supplyState' in patch.patch)).toBe(false);
    });
});
