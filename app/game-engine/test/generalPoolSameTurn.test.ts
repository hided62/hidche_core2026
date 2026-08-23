import { describe, expect, it } from 'vitest';
import { ConstantRNG, RandUtil, SequenceRNG } from '@sammo-ts/common';
import { parseScenarioGeneralPoolCandidate, readScenarioGeneralPoolClaim, type TurnSchedule } from '@sammo-ts/logic';

import type { TurnGeneral, TurnGeneralPoolEntry, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';
import { createTurnTestHarness } from './helpers/turnTestHarness.js';

const start = new Date('0200-01-01T00:00:00.000Z');
const schedule: TurnSchedule = { entries: [{ startMinute: 0, tickMinutes: 10 }] };
const map = {
    id: 'general-pool-same-turn',
    name: '장수 pool 동일 턴 테스트',
    cities: [
        {
            id: 1,
            name: '테스트성',
            level: 1,
            region: 1,
            position: { x: 0, y: 0 },
            connections: [],
            max: {
                population: 50_000,
                agriculture: 1_000,
                commerce: 1_000,
                security: 1_000,
                defence: 1_000,
                wall: 1_000,
            },
            initial: {
                population: 10_000,
                agriculture: 500,
                commerce: 500,
                security: 500,
                defence: 500,
                wall: 500,
            },
        },
    ],
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
};

const buildRuler = (): TurnGeneral => ({
    id: 1,
    userId: 'user-1',
    name: '군주',
    nationId: 1,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 80, strength: 70, intelligence: 60 },
    experience: 0,
    dedication: 0,
    officerLevel: 12,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 2_000,
    rice: 2_000,
    crew: 0,
    crewTypeId: 1,
    train: 40,
    atmos: 40,
    age: 30,
    npcState: 0,
    bornYear: 170,
    deadYear: 260,
    affinity: 50,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    turnTime: start,
});

const buildPoolEntry = (id: number): TurnGeneralPoolEntry => {
    const uniqueName = `후보${id}`;
    return {
        id,
        uniqueName,
        ownerUserId: null,
        generalId: null,
        reservedUntil: null,
        reservedUntilTick: null,
        candidate: parseScenarioGeneralPoolCandidate({
            id,
            uniqueName,
            info: {
                generalName: uniqueName,
                leadership: 70,
                strength: 70,
                intel: 10,
                dex: [10, 10, 10, 10, 10],
                imgsvr: 0,
                picture: 'default.jpg',
            },
        }),
    };
};

const buildSnapshot = (): TurnWorldSnapshot => ({
    scenarioConfig: {
        stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
        iconPath: '',
        map: { targetGeneralPool: 'SPoolUnderU30' },
        const: {
            develCost: 100,
            openingPartYear: 3,
            defaultMaxGeneral: 500,
            initialNationGenLimit: 10,
            defaultNpcGold: 1_000,
            defaultNpcRice: 1_000,
            defaultCrewTypeId: 1,
            retirementYear: 80,
            availablePersonality: ['che_안전'],
        },
        environment: { mapName: map.id, unitSet: 'test' },
    },
    scenarioMeta: {
        title: '장수 pool 동일 턴 테스트',
        startYear: 190,
        life: null,
        fiction: 0,
        history: [],
        ignoreDefaultEvents: false,
    },
    map,
    unitSet: { id: 'test', name: 'test', crewTypes: [] },
    nations: [
        {
            id: 1,
            name: '테스트국',
            color: '#000000',
            capitalCityId: 1,
            chiefGeneralId: 1,
            gold: 10_000,
            rice: 10_000,
            power: 0,
            level: 1,
            typeCode: 'che_중립',
            meta: {
                gennum: 1,
                tech: 0,
                strategic_cmd_limit: 0,
                turn_last_12: { command: '의병모집', arg: {}, term: 2 },
            },
        },
    ],
    cities: [
        {
            id: 1,
            name: '테스트성',
            nationId: 1,
            level: 1,
            state: 0,
            population: 10_000,
            populationMax: 50_000,
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
            meta: { trust: 50, trade: 100, region: 1 },
        },
    ],
    generals: [buildRuler()],
    troops: [],
    diplomacy: [],
    events: [],
    initialEvents: [],
    generalPoolEntries: [1, 2, 3, 4].map(buildPoolEntry),
});

const buildState = (): TurnWorldState => ({
    id: 1,
    currentYear: 200,
    currentMonth: 1,
    tickSeconds: 600,
    lastTurnTime: start,
    meta: { killturn: 24, hiddenSeed: 'general-pool-same-turn' },
});

describe('scenario general pool within one reserved turn', () => {
    it('does not let talent scouting reuse rows claimed earlier by volunteer recruitment', async () => {
        const harness = await createTurnTestHarness({
            snapshot: buildSnapshot(),
            state: buildState(),
            schedule,
            map,
            reservedTurnStoreOptions: { maxGeneralTurns: 30, maxNationTurns: 12 },
            commandRngFactory: ({ actionKey }) =>
                actionKey === 'che_의병모집'
                    ? new RandUtil(new SequenceRNG([0, 0.26, 0.51, 0.76]))
                    : new RandUtil(new ConstantRNG(0)),
        });
        harness.reservedTurnStore.getNationTurns(1, 12)[0] = { action: 'che_의병모집', args: {} };
        harness.reservedTurnStore.getGeneralTurns(1)[0] = { action: 'che_인재탐색', args: {} };

        await harness.runOneTick();

        const created = harness.world.peekDirtyState().createdGenerals;
        const claims = created.map((general) => readScenarioGeneralPoolClaim(general.meta));
        expect(created.map((general) => general.npcState).sort()).toEqual([3, 4, 4, 4]);
        expect(claims.every(Boolean)).toBe(true);
        expect(new Set(claims.map((claim) => claim?.poolEntryId))).toEqual(new Set([1, 2, 3, 4]));

        const createdIds = created.map((general) => general.id);
        expect(harness.reservedTurnStore.peekDirtyState().generalInitializationIds).toEqual(createdIds);
        for (const generalId of createdIds) {
            expect(harness.reservedTurnStore.getGeneralTurns(generalId)).toEqual(
                Array.from({ length: 30 }, () => ({ action: '휴식', args: {} }))
            );
        }

        await harness.reservedTurnStore.flushChanges();

        const persistedRows = harness.mockPrisma.generalTurn.createMany.mock.calls.flatMap(([input]) => input.data);
        const persistedCreatedRows = persistedRows.filter((row) => createdIds.includes(row.generalId));
        expect(persistedCreatedRows).toHaveLength(createdIds.length * 30);
        for (const generalId of createdIds) {
            expect(persistedCreatedRows.filter((row) => row.generalId === generalId)).toEqual(
                Array.from({ length: 30 }, (_, turnIdx) => ({
                    generalId,
                    turnIdx,
                    actionCode: '휴식',
                    arg: {},
                }))
            );
        }
    });
});
