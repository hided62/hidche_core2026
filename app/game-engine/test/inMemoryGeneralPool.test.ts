import { describe, expect, it } from 'vitest';

import { GAME_TICKS_PER_TURN } from '@sammo-ts/common';
import { buildScenarioGeneralPoolClaimMeta, parseScenarioGeneralPoolCandidate, type City } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnGeneralPoolEntry, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const claimedAt = new Date('0200-05-01T00:00:00.000Z');

const buildCandidateEntry = (
    id: number,
    uniqueName: string,
    patch: Partial<TurnGeneralPoolEntry> = {}
): TurnGeneralPoolEntry => ({
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
            strength: 80,
            intel: 10,
            dex: [10, 20, 30, 40, 50],
            imgsvr: 0,
            picture: 'default.jpg',
        },
    }),
    ...patch,
});

const buildGeneral = (id: number, name: string, meta: TurnGeneral['meta']): TurnGeneral => ({
    id,
    userId: null,
    name,
    nationId: 0,
    cityId: 1,
    troopId: 0,
    stats: { leadership: 70, strength: 80, intelligence: 10 },
    experience: 2_000,
    dedication: 2_000,
    officerLevel: 0,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 20,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    turnTime: claimedAt,
    meta,
});

const city: City = {
    id: 1,
    name: '도시',
    nationId: 0,
    level: 4,
    state: 0,
    population: 10_000,
    populationMax: 20_000,
    agriculture: 1_000,
    agricultureMax: 2_000,
    commerce: 1_000,
    commerceMax: 2_000,
    security: 1_000,
    securityMax: 2_000,
    supplyState: 1,
    frontState: 0,
    defence: 1_000,
    defenceMax: 2_000,
    wall: 1_000,
    wallMax: 2_000,
    meta: {},
};

const buildWorld = (
    generalPoolEntries: TurnGeneralPoolEntry[],
    generals: TurnGeneral[] = [],
    stateOverride: Partial<TurnWorldState> = {}
): InMemoryTurnWorld => {
    const state: TurnWorldState = {
        id: 1,
        currentYear: 200,
        currentMonth: 5,
        tickSeconds: 600,
        lastTurnTime: claimedAt,
        meta: {},
        ...stateOverride,
    };
    const snapshot: TurnWorldSnapshot = {
        scenarioConfig: {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: { targetGeneralPool: 'SPoolUnderU30' },
            const: {},
            environment: { mapName: 'test', unitSet: 'default' },
        },
        map: {
            id: 'test',
            name: 'test',
            cities: [],
            defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
        },
        generals,
        cities: [city],
        nations: [],
        troops: [],
        diplomacy: [],
        events: [],
        initialEvents: [],
        generalPoolEntries,
    };
    return new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
    });
};

describe('in-memory scenario general pool availability', () => {
    it('uses synchronized reselection rows while excluding live, orphaned, and active reservations', () => {
        const oldEntry = buildCandidateEntry(1, '이전후보');
        const currentEntry = buildCandidateEntry(2, '현재후보');
        const legacyOccupiedEntry = buildCandidateEntry(3, '기존점유', { generalId: 2 });
        const expiredEntry = buildCandidateEntry(4, '만료예약', {
            ownerUserId: 'expired-user',
            reservedUntil: new Date(claimedAt.getTime() + 60_000),
            reservedUntilTick: -1,
        });
        const activeEntry = buildCandidateEntry(5, '활성예약', {
            ownerUserId: 'active-user',
            reservedUntil: new Date(claimedAt.getTime() - 60_000),
            reservedUntilTick: 1,
        });
        const orphanedEntry = buildCandidateEntry(6, '고아점유', { generalId: 999 });
        const exactDeadlineEntry = buildCandidateEntry(7, '동률예약', {
            ownerUserId: 'exact-user',
            reservedUntil: new Date(claimedAt.getTime() - 60_000),
            reservedUntilTick: 0,
        });
        const currentClaim = buildScenarioGeneralPoolClaimMeta(currentEntry.candidate, claimedAt);
        const world = buildWorld(
            [oldEntry, currentEntry, legacyOccupiedEntry, expiredEntry, activeEntry, orphanedEntry, exactDeadlineEntry],
            [
                buildGeneral(1, '현재후보', { killturn: 100, ...currentClaim }),
                buildGeneral(2, '기존점유', { killturn: 100 }),
            ]
        );

        expect(world.listGeneralPoolCandidates(claimedAt)?.map((candidate) => candidate.uniqueName)).toEqual([
            '이전후보',
            '만료예약',
        ]);
    });

    it('reuses a linked row only when its general was deleted in the same in-memory batch', () => {
        const linked = buildCandidateEntry(1, '삭제후보', { generalId: 1 });
        const world = buildWorld([linked], [buildGeneral(1, '삭제후보', { killturn: 100 })]);

        expect(world.listGeneralPoolCandidates(claimedAt)).toEqual([]);
        expect(world.removeGeneral(1)).toBe(true);
        expect(world.listGeneralPoolCandidates(claimedAt)?.map((candidate) => candidate.uniqueName)).toEqual([
            '삭제후보',
        ]);
    });

    it('rebases reserved rows with the schedule and restores them on rollback', () => {
        const reservedUntil = new Date(claimedAt.getTime() + 5 * 60_000);
        const reserved = buildCandidateEntry(1, '예약후보', {
            ownerUserId: 'active-user',
            reservedUntil,
            reservedUntilTick: GAME_TICKS_PER_TURN / 2,
        });
        const unreserved = buildCandidateEntry(2, '미예약후보');
        const world = buildWorld([reserved, unreserved]);
        const before = world.captureState();
        const probeAfterOriginalExpiry = new Date(claimedAt.getTime() + 10 * 60_000);

        world.shiftSchedule(15, claimedAt);

        expect(world.captureState().generalPoolEntries).toMatchObject([
            {
                id: 1,
                reservedUntil: new Date(reservedUntil.getTime() + 15 * 60_000),
                reservedUntilTick: GAME_TICKS_PER_TURN / 2,
            },
            { id: 2, reservedUntil: null, reservedUntilTick: null },
        ]);
        expect(
            world.listGeneralPoolCandidates(probeAfterOriginalExpiry)?.map((candidate) => candidate.uniqueName)
        ).toEqual(['미예약후보']);

        world.restoreState(before);

        expect(world.captureState().generalPoolEntries).toMatchObject([
            { id: 1, reservedUntil, reservedUntilTick: GAME_TICKS_PER_TURN / 2 },
            { id: 2, reservedUntil: null, reservedUntilTick: null },
        ]);
        expect(
            world.listGeneralPoolCandidates(probeAfterOriginalExpiry)?.map((candidate) => candidate.uniqueName)
        ).toEqual(['예약후보', '미예약후보']);
    });

    it('rebases tick-owned reservations with a long realtime backlog and restores exact expiry semantics', () => {
        const originalReservedUntilTick = 2 * GAME_TICKS_PER_TURN;
        const originalReservedUntil = new Date(claimedAt.getTime() + 20 * 60_000);
        const reserved = buildCandidateEntry(1, '예약후보', {
            ownerUserId: 'active-user',
            reservedUntil: originalReservedUntil,
            reservedUntilTick: originalReservedUntilTick,
        });
        const world = buildWorld([reserved], [], {
            clockBaseTime: claimedAt,
            clockTick: 0,
            clockMode: 'realtime',
            clockWallAnchor: claimedAt,
            lastTurnTick: 0,
        });
        const before = world.captureState();
        const resumedAt = new Date(claimedAt.getTime() + 40 * 60_000);

        expect(world.rebaseRealtimeBacklog(resumedAt)).toMatchObject({
            skippedTurns: 4,
            shiftedTicks: 4 * GAME_TICKS_PER_TURN,
        });
        const rebasedReservedUntilTick = 6 * GAME_TICKS_PER_TURN;
        const rebasedReservedUntil = world.gameTickToDate(rebasedReservedUntilTick);
        expect(world.captureState().generalPoolEntries).toMatchObject([
            {
                id: 1,
                reservedUntilTick: rebasedReservedUntilTick,
                reservedUntil: rebasedReservedUntil,
            },
        ]);
        expect(world.listGeneralPoolCandidates(resumedAt)).toEqual([]);
        expect(world.listGeneralPoolCandidates(rebasedReservedUntil)).toEqual([]);
        expect(
            world
                .listGeneralPoolCandidates(new Date(rebasedReservedUntil.getTime() + 1))
                ?.map((candidate) => candidate.uniqueName)
        ).toEqual(['예약후보']);

        world.restoreState(before);

        expect(world.captureState().generalPoolEntries).toMatchObject([
            {
                id: 1,
                reservedUntilTick: originalReservedUntilTick,
                reservedUntil: originalReservedUntil,
            },
        ]);
        expect(world.listGeneralPoolCandidates(originalReservedUntil)).toEqual([]);
        expect(
            world
                .listGeneralPoolCandidates(new Date(originalReservedUntil.getTime() + 1))
                ?.map((candidate) => candidate.uniqueName)
        ).toEqual(['예약후보']);
    });
});
