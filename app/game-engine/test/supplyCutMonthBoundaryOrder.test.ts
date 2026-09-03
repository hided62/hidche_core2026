import { describe, expect, it } from 'vitest';

import type { City, MapDefinition, Nation } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { composeCalendarHandlers } from '../src/turn/calendarHandlers.js';
import { createUpdateCitySupplyHandler } from '../src/turn/monthlyCitySupplyAction.js';
import { createMonthlyEventHandler, type MonthlyEventActionHandler } from '../src/turn/monthlyEventHandler.js';
import { createYearbookHandler } from '../src/turn/yearbookHandler.js';
import type { PendingYearbookSnapshot, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

// Ref 계승 계약 (devel TurnExecutionHelper.php 실행 순서):
//   runEventHandler(PreMonth)  -> UpdateCitySupply (보급 재계산/고립)
//   preUpdateMonthly()         -> LogHistory (방금 끝난 달의 연감 스냅샷)
//   turnDate()                 -> 월 advance
// 즉 월중 출병 점령은 보급을 즉시 끊지 않고(che_출병/aftermath는 점령 도시와
// 천도 신수도에만 supply=1을 쓴다), 보급切断은 다음 달 시작 경계에서 일어난다.
// 단 경계 스냅샷은 Ref #230(d17b2518) 이후 UpdateCitySupply "뒤"에 찍히므로
// 끝난 달(10월)의 연감 지도에는 이미 끊긴 보급선이 반영된다. Core의
// composeCalendarHandlers 순서(monthlyEventHandler -> yearbookHandler)가 이
// 계약을 보존하는지를 고정한다.

const map: MapDefinition = {
    id: 'supply-cut-order-test',
    name: 'supply-cut-order-test',
    cities: [
        {
            id: 10,
            name: '공격기지',
            level: 2,
            region: 1,
            position: { x: 0, y: 0 },
            connections: [20],
            max: { population: 2_000, agriculture: 1_000, commerce: 1_000, security: 1_000, defence: 1_000, wall: 1_000 },
            initial: { population: 1_000, agriculture: 500, commerce: 500, security: 500, defence: 500, wall: 500 },
        },
        {
            id: 20,
            name: '중간 보급로',
            level: 2,
            region: 1,
            position: { x: 1, y: 0 },
            connections: [10, 21, 22],
            max: { population: 2_000, agriculture: 1_000, commerce: 1_000, security: 1_000, defence: 1_000, wall: 1_000 },
            initial: { population: 1_000, agriculture: 500, commerce: 500, security: 500, defence: 500, wall: 500 },
        },
        {
            id: 21,
            name: '수도',
            level: 2,
            region: 1,
            position: { x: 2, y: 0 },
            connections: [20],
            max: { population: 2_000, agriculture: 1_000, commerce: 1_000, security: 1_000, defence: 1_000, wall: 1_000 },
            initial: { population: 1_000, agriculture: 500, commerce: 500, security: 500, defence: 500, wall: 500 },
        },
        {
            id: 22,
            name: '외곽 도시',
            level: 2,
            region: 1,
            position: { x: 3, y: 0 },
            connections: [20],
            max: { population: 2_000, agriculture: 1_000, commerce: 1_000, security: 1_000, defence: 1_000, wall: 1_000 },
            initial: { population: 1_000, agriculture: 500, commerce: 500, security: 500, defence: 500, wall: 500 },
        },
    ],
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
};

const buildCity = (id: number, nationId: number): City => ({
    id,
    name: map.cities.find((city) => city.id === id)?.name ?? `도시${id}`,
    nationId,
    level: 2,
    state: 0,
    population: 1_000,
    populationMax: 2_000,
    agriculture: 500,
    agricultureMax: 1_000,
    commerce: 500,
    commerceMax: 1_000,
    security: 500,
    securityMax: 1_000,
    supplyState: 1,
    frontState: 0,
    defence: 500,
    defenceMax: 1_000,
    wall: 500,
    wallMax: 1_000,
    conflict: {},
    meta: { trust: 50, trade: 100, officer_set: 0, term: 0 },
});

const buildNation = (id: number, capitalCityId: number): Nation => ({
    id,
    name: `국가${id}`,
    color: '#000000',
    capitalCityId,
    chiefGeneralId: null,
    gold: 1_000,
    rice: 1_000,
    power: 0,
    level: 1,
    typeCode: 'che_중립',
    meta: {},
});

type MapCityCompact = [number, number, number, number, number, number];

const buildWorld = (): { world: InMemoryTurnWorld; snapshots: () => PendingYearbookSnapshot[] } => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 191,
        currentMonth: 10,
        tickSeconds: 600,
        lastTurnTime: new Date('0191-10-01T00:00:00.000Z'),
        meta: {},
    };
    const actions = new Map<string, MonthlyEventActionHandler>();
    const snapshot: TurnWorldSnapshot = {
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: {},
            environment: { mapName: map.id, unitSet: 'default' },
        },
        map,
        generals: [],
        cities: [buildCity(10, 2), buildCity(20, 1), buildCity(21, 1), buildCity(22, 1)],
        nations: [buildNation(1, 21), buildNation(2, 10)],
        troops: [],
        diplomacy: [],
        events: [
            {
                id: 1,
                targetCode: 'pre_month',
                priority: 9_000,
                condition: true,
                action: [['UpdateCitySupply']],
                meta: {},
            },
        ],
        initialEvents: [],
    };
    let world: InMemoryTurnWorld | null = null;
    // 프로덕션 turnDaemon과 같은 구성 순서: monthly event(pre_month) -> yearbook.
    const calendarHandler = composeCalendarHandlers(
        createMonthlyEventHandler({ getWorld: () => world, startYear: 180, actions }),
        createYearbookHandler({ profileName: 'test', getWorld: () => world }).handler
    );
    world = new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        calendarHandler,
    });
    actions.set('UpdateCitySupply', createUpdateCitySupplyHandler({ getWorld: () => world!, map }));
    return {
        world: world!,
        snapshots: () => world!.peekDirtyState().pendingYearbookSnapshots,
    };
};

describe('10월중 보급로 도시 점령 -> 11월 경계切断 -> 10월 연감 스냅샷 순서', () => {
    it('keeps supply alive during October and cuts it exactly at the month boundary', async () => {
        const { world } = buildWorld();

        // che_출병의 aftermath effect가 반영된 10월중 상태: 도시 20이 국가2에
        // 점령되고 Ref처럼 supplyState=1만 쓴다. 나머지 도시는 무변경.
        world.updateCity(20, { nationId: 2, supplyState: 1 });

        // 10월 진행중에는 고립될 외곽 도시도 아직 보급 상태다(라이브 지도 기준).
        expect(world.getCityById(22)?.supplyState).toBe(1);
        expect(world.getCityById(21)?.supplyState).toBe(1);

        await world.advanceMonth(new Date('0191-11-01T00:00:00.000Z'));

        //切断은 정확히 월 경계에서 일어난다.
        expect(world.getCityById(22)?.supplyState).toBe(0);
        expect(world.getCityById(21)?.supplyState).toBe(1);
        expect(world.getCityById(20)?.supplyState).toBe(1);
        expect(world.getCityById(10)?.supplyState).toBe(1);
    });

    it('archives the finished month yearbook map after the boundary supply recalculation (Ref #230 order)', async () => {
        const { world, snapshots } = buildWorld();
        world.updateCity(20, { nationId: 2, supplyState: 1 });

        expect(snapshots()).toEqual([]);

        await world.advanceMonth(new Date('0191-11-01T00:00:00.000Z'));

        const pending = snapshots();
        expect(pending).toHaveLength(1);
        const october = pending[0]!;
        expect(october.year).toBe(191);
        expect(october.month).toBe(10);

        const cityList = (october.map as { cityList: MapCityCompact[] }).cityList;
        const supplyFlagById = new Map(cityList.map((entry) => [entry[0], entry[5]]));
        // Ref #230 이후 LogHistory는 UpdateCitySupply 뒤에 실행되므로 끝난 10월의
        // 연감 지도는 이미 고립을 반영한다. 이 순서가 Core의 계약이다.
        expect(supplyFlagById.get(22)).toBe(0);
        expect(supplyFlagById.get(21)).toBe(1);
        expect(supplyFlagById.get(20)).toBe(1);
        expect(supplyFlagById.get(10)).toBe(1);
    });
});
