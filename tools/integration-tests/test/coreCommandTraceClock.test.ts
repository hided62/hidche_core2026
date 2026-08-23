import { describe, expect, it } from 'vitest';
import type { MapDefinition, UnitSetDefinition } from '@sammo-ts/logic';
import { InMemoryTurnWorld } from '@sammo-ts/game-engine/turn/inMemoryWorld.js';

import type { CanonicalTurnSnapshot } from '../src/turn-differential/canonical.js';
import {
    buildCoreTurnCommandWorldInput,
    runCoreTurnCommandTrace,
    type TurnCommandFixtureRequest,
} from '../src/turn-differential/coreCommandTrace.js';

const cityStats = {
    population: 1_000,
    agriculture: 100,
    commerce: 100,
    security: 100,
    defence: 100,
    wall: 100,
};

const map: MapDefinition = {
    id: 'clock-projection-test',
    name: 'clock projection test',
    cities: [
        {
            id: 1,
            name: '테스트시',
            level: 5,
            region: 1,
            position: { x: 0, y: 0 },
            connections: [],
            initial: cityStats,
            max: cityStats,
        },
    ],
};

const unitSet: UnitSetDefinition = {
    id: 'clock-projection-test',
    name: 'clock projection test',
    defaultCrewTypeId: 1100,
    crewTypes: [],
};

const referenceBefore: CanonicalTurnSnapshot = {
    schemaVersion: 1,
    engine: 'ref',
    world: {
        year: 185,
        month: 1,
        tickMinutes: 60,
        lastTurnTick: 24_229_750_000,
        // Ref snapshots use MySQL's timezone-less microsecond representation.
        turnTime: '2026-08-22 14:02:55.000000',
        gameNow: '2026-08-22 14:02:55.000000',
    },
    generals: [
        {
            id: 1,
            name: '장수',
            nationId: 0,
            cityId: 1,
            troopId: 0,
            officerLevel: 0,
            turnTick: 24_245_250_000,
            turnTime: '2026-08-22 14:28:45.000000',
        },
    ],
    rankData: [],
    cities: [{ id: 1, name: '테스트시', nationId: 0, level: 5 }],
    nations: [],
    troops: [],
    diplomacy: [],
    generalTurns: [],
    nationTurns: [],
    logs: [],
    messages: [],
    watermarks: { logId: 0, historyLogId: 0, messageId: 0 },
};

describe('turn command fixture GameClock projection', () => {
    it('preserves Ref absolute dates when materializing persisted ticks', () => {
        const request: TurnCommandFixtureRequest = {
            kind: 'general',
            actorGeneralId: 1,
            action: '휴식',
        };
        const input = buildCoreTurnCommandWorldInput(request, referenceBefore, unitSet, map);
        const world = new InMemoryTurnWorld(input.state, input.snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 60 }] },
        });

        expect(world.getState().lastTurnTime.toISOString()).toBe('2026-08-22T14:02:55.000Z');
        expect(world.getGeneralById(1)?.turnTime.toISOString()).toBe('2026-08-22T14:28:45.000Z');
    });

    it('injects Ref gameNow instead of the later actor turn time into command messages', async () => {
        const commandSnapshot: CanonicalTurnSnapshot = {
            ...referenceBefore,
            world: {
                ...referenceBefore.world,
                initYear: 180,
                initMonth: 1,
                develCost: 100,
                gameNow: '2026-08-22 14:02:55.123456',
            },
            generals: [
                {
                    ...referenceBefore.generals[0],
                    nationId: 1,
                    cityId: 3,
                    officerLevel: 12,
                    gold: 100_000,
                    rice: 100_000,
                },
                {
                    ...referenceBefore.generals[0],
                    id: 2,
                    name: '수신자',
                    nationId: 2,
                    cityId: 70,
                    officerLevel: 1,
                },
            ],
            cities: [
                {
                    id: 3,
                    name: '아국도시',
                    nationId: 1,
                    level: 5,
                    population: 100_000,
                    populationMax: 200_000,
                    agriculture: 1_000,
                    commerce: 1_000,
                    security: 1_000,
                    defence: 1_000,
                    wall: 1_000,
                    supplyState: 1,
                    frontState: 0,
                    state: 0,
                    trust: 80,
                    trade: 100,
                },
                {
                    id: 70,
                    name: '타국도시',
                    nationId: 2,
                    level: 5,
                    population: 100_000,
                    populationMax: 200_000,
                    agriculture: 1_000,
                    commerce: 1_000,
                    security: 1_000,
                    defence: 1_000,
                    wall: 1_000,
                    supplyState: 1,
                    frontState: 0,
                    state: 0,
                    trust: 80,
                    trade: 100,
                },
            ],
            nations: [
                {
                    id: 1,
                    name: '아국',
                    color: '#111111',
                    capitalCityId: 3,
                    gold: 1_000_000,
                    rice: 1_000_000,
                    power: 1_000,
                    level: 1,
                    typeCode: 'che_중립',
                },
                {
                    id: 2,
                    name: '타국',
                    color: '#222222',
                    capitalCityId: 70,
                    gold: 1_000_000,
                    rice: 1_000_000,
                    power: 1_000,
                    level: 1,
                    typeCode: 'che_중립',
                },
            ],
        };
        const request: TurnCommandFixtureRequest = {
            kind: 'general',
            actorGeneralId: 1,
            action: 'che_등용',
            args: { destGeneralID: 2 },
            setup: {
                isolateWorld: true,
                world: { startYear: 180, year: 185, month: 1, freezeClock: true },
            },
            observe: { generalIds: [1, 2], cityIds: [3, 70], nationIds: [1, 2], messageAfterId: 0 },
        };

        const trace = await runCoreTurnCommandTrace(request, commandSnapshot);

        expect(trace.after.world.gameNow).toBe('2026-08-22 14:02:55.123456');
        expect(trace.after.messages.map((message) => message.createdAt)).toEqual(['2026-08-22T14:02:55.123Z']);
    });

    it('keeps a stale nation gennum visible instead of masking an update omission with live membership', async () => {
        const snapshot: CanonicalTurnSnapshot = {
            ...referenceBefore,
            generals: Array.from({ length: 4 }, (_, index) => ({
                ...referenceBefore.generals[0],
                id: index + 1,
                name: `장수${index + 1}`,
                nationId: 1,
                cityId: 1,
                officerLevel: index === 0 ? 12 : 1,
                gold: 1_000,
                rice: 1_000,
            })),
            cities: [{ ...referenceBefore.cities[0], nationId: 1 }],
            nations: [
                {
                    id: 1,
                    name: '위',
                    color: '#111111',
                    capitalCityId: 1,
                    gold: 1_000,
                    rice: 1_000,
                    power: 1_000,
                    level: 1,
                    typeCode: 'che_중립',
                    // Simulate a command that created three members but omitted
                    // the denormalized nation counter update.
                    generalCount: 1,
                },
            ],
        };

        const trace = await runCoreTurnCommandTrace(
            {
                kind: 'general',
                actorGeneralId: 1,
                action: '휴식',
                observe: { allGenerals: true, allNations: true },
            },
            snapshot
        );

        expect(trace.before.generals.filter((general) => general.nationId === 1)).toHaveLength(4);
        expect(trace.before.nations).toEqual([expect.objectContaining({ id: 1, generalCount: 1 })]);
        expect(trace.after.nations).toEqual([expect.objectContaining({ id: 1, generalCount: 1 })]);
    });
});
