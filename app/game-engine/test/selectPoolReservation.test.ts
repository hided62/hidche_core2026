import { describe, expect, it } from 'vitest';

import { GAME_TICKS_PER_TURN } from '@sammo-ts/common';
import { parseScenarioGeneralPoolCandidate } from '@sammo-ts/logic';

import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import {
    buildInitialTurnTime,
    reserveSelectionPool,
    resolveSelectionPoolUserIcon,
} from '../src/turn/selectPoolService.js';
import type { TurnGeneralPoolEntry, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

interface TestPoolRow {
    id: number;
    uniqueName: string;
    ownerUserId: string | null;
    generalId: number | null;
    reservedUntil: Date | null;
    reservedUntilTick: bigint | null;
    info: Record<string, unknown>;
}

interface PoolWhere {
    id?: { in: number[] };
    ownerUserId?: string | null;
    generalId?: number | null;
    reservedUntil?: null | { lt?: Date; gte?: Date };
    reservedUntilTick?: null | { lt?: bigint; gte?: bigint };
    OR?: PoolWhere[];
}

const acceptedAt = new Date('0200-05-01T00:00:00.000Z');

describe('selection-pool initial turn scheduling', () => {
    it('does not inherit a turntime base from before the opening boundary', () => {
        const openingGameAt = new Date('0200-01-01T00:00:00.000Z');
        const preopenGameAt = new Date(openingGameAt.getTime() - 30 * 60_000);
        const rng = {
            nextRangeInt(min: number) {
                return min;
            },
        };

        const turnTime = buildInitialTurnTime(
            rng,
            {
                tickSeconds: 300,
                meta: { turntime: preopenGameAt.toISOString() },
            } as unknown as Parameters<typeof buildInitialTurnTime>[1],
            preopenGameAt,
            openingGameAt
        );

        expect(turnTime.getTime()).toBeGreaterThanOrEqual(openingGameAt.getTime());
    });
});

const buildRows = (): TestPoolRow[] =>
    Array.from({ length: 29 }, (_, index) => {
        const uniqueName = `P${String(index + 1).padStart(2, '0')}`;
        return {
            id: index + 1,
            uniqueName,
            ownerUserId: index === 0 ? 'existing-user' : null,
            generalId: null,
            reservedUntil: index === 0 ? new Date(acceptedAt.getTime() + 30 * 60_000) : null,
            reservedUntilTick: index === 0 ? 3_000_000n : null,
            info: {
                uniqueName,
                generalName: uniqueName,
                leadership: 70,
                strength: 80,
                intel: 10,
                specialDomestic: null,
                dex: [100 + index, 0, 0, 0, 0],
                imgsvr: 0,
                picture: 'default.jpg',
            },
        };
    });

const buildWorld = (rows: TestPoolRow[]): InMemoryTurnWorld => {
    const generalPoolEntries: TurnGeneralPoolEntry[] = rows.map((row) => ({
        id: row.id,
        uniqueName: row.uniqueName,
        ownerUserId: row.ownerUserId,
        generalId: row.generalId,
        reservedUntil: row.reservedUntil,
        reservedUntilTick: row.reservedUntilTick === null ? null : Number(row.reservedUntilTick),
        candidate: parseScenarioGeneralPoolCandidate(row),
    }));
    const state: TurnWorldState = {
        id: 1,
        currentYear: 200,
        currentMonth: 5,
        tickSeconds: 300,
        lastTurnTime: acceptedAt,
        meta: { hiddenSeed: 'selection-reservation-test' },
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
        generals: [],
        cities: [],
        nations: [],
        troops: [],
        diplomacy: [],
        events: [],
        initialEvents: [],
        generalPoolEntries,
    };
    return new InMemoryTurnWorld(state, snapshot, {
        schedule: { entries: [{ startMinute: 0, tickMinutes: 5 }] },
    });
};

const matchesPoolWhere = (row: TestPoolRow, where: PoolWhere): boolean => {
    if (where.id && !where.id.in.includes(row.id)) {
        return false;
    }
    if (where.ownerUserId !== undefined && row.ownerUserId !== where.ownerUserId) {
        return false;
    }
    if (where.generalId !== undefined && row.generalId !== where.generalId) {
        return false;
    }
    if (where.reservedUntil !== undefined) {
        if (where.reservedUntil === null) {
            if (row.reservedUntil !== null) {
                return false;
            }
        } else if (
            row.reservedUntil === null ||
            (where.reservedUntil.lt !== undefined && row.reservedUntil >= where.reservedUntil.lt) ||
            (where.reservedUntil.gte !== undefined && row.reservedUntil < where.reservedUntil.gte)
        ) {
            return false;
        }
    }
    if (where.reservedUntilTick !== undefined) {
        if (where.reservedUntilTick === null) {
            if (row.reservedUntilTick !== null) {
                return false;
            }
        } else if (
            row.reservedUntilTick === null ||
            (where.reservedUntilTick.lt !== undefined && row.reservedUntilTick >= where.reservedUntilTick.lt) ||
            (where.reservedUntilTick.gte !== undefined && row.reservedUntilTick < where.reservedUntilTick.gte)
        ) {
            return false;
        }
    }
    return where.OR === undefined || where.OR.some((alternative) => matchesPoolWhere(row, alternative));
};

const buildDb = (rows: TestPoolRow[]) => ({
    $executeRaw: async () => 0,
    general: {
        findFirst: async () => null,
    },
    selectPoolEntry: {
        findMany: async () => structuredClone(rows),
        updateMany: async (input: { where: PoolWhere; data: Partial<TestPoolRow> }) => {
            let count = 0;
            for (const row of rows) {
                if (!matchesPoolWhere(row, input.where)) {
                    continue;
                }
                Object.assign(row, input.data);
                count += 1;
            }
            return { count };
        },
    },
});

const worldState = {
    currentYear: 200,
    currentMonth: 5,
    tickSeconds: 300,
    config: {
        npcMode: 2,
        turnTermMinutes: 5,
        map: { targetGeneralPool: 'SPoolUnderU30' },
    },
    meta: { hiddenSeed: 'selection-reservation-test' },
};

describe('selection-pool reservation command state', () => {
    it('uses only an explicitly selected owner icon for a human general', () => {
        expect(resolveSelectionPoolUserIcon({ showImgLevel: 3 })).toEqual({
            picture: 'default.jpg',
            imageServer: 0,
        });
        expect(
            resolveSelectionPoolUserIcon({
                showImgLevel: 3,
                ownerPicture: 'uploaded/user.png',
                ownerImageServer: 1,
            })
        ).toEqual({ picture: 'uploaded/user.png', imageServer: 1 });
        expect(
            resolveSelectionPoolUserIcon({
                showImgLevel: 0,
                ownerPicture: 'uploaded/user.png',
                ownerImageServer: 1,
            })
        ).toEqual({ picture: 'default.jpg', imageServer: 0 });
    });

    it('excludes current reservations and keeps serialized users disjoint in DB and memory', async () => {
        const rows = buildRows();
        const world = buildWorld(rows);
        const db = buildDb(rows);
        const reserve = (userId: string, processingGameTick: number) =>
            reserveSelectionPool({
                db: db as never,
                world,
                worldState: worldState as never,
                userId,
                seedOwnerIdentity: userId,
                now: acceptedAt,
                processingGameTick,
            });

        const first = await reserve('first-user', 0);
        const retried = await reserve('first-user', 1);
        const second = await reserve('second-user', 2);

        expect(retried).toEqual(first);
        expect(first.candidates).toHaveLength(14);
        expect(second.candidates).toHaveLength(14);
        expect(new Set(first.candidates.map((candidate) => candidate.uniqueName))).not.toContain('P01');
        expect(
            first.candidates.some((candidate) =>
                second.candidates.some((other) => other.uniqueName === candidate.uniqueName)
            )
        ).toBe(false);
        expect(rows.filter((row) => row.ownerUserId === 'first-user')).toHaveLength(14);
        expect(rows.filter((row) => row.ownerUserId === 'second-user')).toHaveLength(14);
        expect(rows.find((row) => row.ownerUserId === 'first-user')?.reservedUntilTick).toBe(
            BigInt(2 * GAME_TICKS_PER_TURN)
        );
        expect(first.validUntil).toBe(world.gameTickToDate(2 * GAME_TICKS_PER_TURN).toISOString());
        expect(world.listGeneralPoolCandidates(acceptedAt)).toEqual([]);
    });

    it('uses Ref nowTick equality and resynchronizes DB expiry into the in-memory pool', async () => {
        const rows = buildRows();
        rows[0]!.ownerUserId = 'stale-user';
        rows[0]!.reservedUntil = new Date(acceptedAt.getTime() + 60 * 60_000);
        rows[0]!.reservedUntilTick = -1n;
        rows[1]!.ownerUserId = 'exact-user';
        rows[1]!.reservedUntil = new Date(acceptedAt.getTime() - 60_000);
        rows[1]!.reservedUntilTick = 0n;
        const world = buildWorld(rows);
        const db = buildDb(rows);
        const reserve = (userId: string, processingGameTick: number) =>
            reserveSelectionPool({
                db: db as never,
                world,
                worldState: worldState as never,
                userId,
                seedOwnerIdentity: userId,
                now: acceptedAt,
                processingGameTick,
            });

        const first = await reserve('first-user', 0);

        expect(rows[0]!.ownerUserId).not.toBe('stale-user');
        expect(rows[1]).toMatchObject({ ownerUserId: 'exact-user', reservedUntilTick: 0n });
        expect(first.candidates.map((candidate) => candidate.uniqueName)).not.toContain('P02');
        expect(first.validUntil).toBe(world.gameTickToDate(2 * GAME_TICKS_PER_TURN).toISOString());

        await reserve('second-user', 1);

        expect(rows[1]!.ownerUserId).not.toBe('exact-user');
        const synchronizedById = new Map(world.listGeneralPoolEntries()?.map((entry) => [entry.id, entry]));
        for (const row of rows) {
            expect(synchronizedById.get(row.id)).toMatchObject({
                ownerUserId: row.ownerUserId,
                generalId: row.generalId,
                reservedUntil: row.reservedUntil,
                reservedUntilTick: row.reservedUntilTick === null ? null : Number(row.reservedUntilTick),
            });
        }
    });
});
