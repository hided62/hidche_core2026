import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient, GeneralTurnRow, NationTurnRow } from '../src/context.js';
import {
    MAX_GENERAL_TURNS,
    MAX_NATION_TURNS,
    expandGeneralTurnIndices,
    getNationTurnSnapshots,
    repeatGeneralTurns,
    repeatNationTurns,
    setGeneralTurn,
    setGeneralTurns,
    setNationTurn,
    setNationTurnAtCurrentPosition,
    setNationTurns,
    setNationTurnsAtCurrentPositions,
    shiftGeneralTurns,
    shiftNationTurns,
    ReservedTurnRevisionConflictError,
} from '../src/turns/reservedTurns.js';

const buildDb = (autorunLimit: number | null = null) => {
    const generalTurns = new Map<number, GeneralTurnRow[]>();
    const nationTurns = new Map<string, NationTurnRow[]>();
    const generalRevisions = new Map<number, number>();
    const nationRevisions = new Map<string, number>();

    type GeneralTurnFindManyArgs = Parameters<DatabaseClient['generalTurn']['findMany']>[0];
    type GeneralTurnDeleteManyArgs = NonNullable<Parameters<DatabaseClient['generalTurn']['deleteMany']>[0]>;
    type GeneralTurnCreateManyArgs = NonNullable<Parameters<DatabaseClient['generalTurn']['createMany']>[0]>;

    type NationTurnFindManyArgs = Parameters<DatabaseClient['nationTurn']['findMany']>[0];
    type NationTurnDeleteManyArgs = NonNullable<Parameters<DatabaseClient['nationTurn']['deleteMany']>[0]>;
    type NationTurnCreateManyArgs = NonNullable<Parameters<DatabaseClient['nationTurn']['createMany']>[0]>;
    type GeneralRevisionFindArgs = Parameters<DatabaseClient['generalTurnRevision']['findUnique']>[0];
    type GeneralRevisionCreateManyArgs = NonNullable<
        Parameters<DatabaseClient['generalTurnRevision']['createMany']>[0]
    >;
    type GeneralRevisionUpdateManyArgs = NonNullable<
        Parameters<DatabaseClient['generalTurnRevision']['updateMany']>[0]
    >;
    type NationRevisionFindArgs = Parameters<DatabaseClient['nationTurnRevision']['findUnique']>[0];
    type NationRevisionCreateManyArgs = NonNullable<Parameters<DatabaseClient['nationTurnRevision']['createMany']>[0]>;
    type NationRevisionUpdateManyArgs = NonNullable<Parameters<DatabaseClient['nationTurnRevision']['updateMany']>[0]>;

    const db = {
        worldState: {
            findFirst: async () => null,
        },
        general: {
            findUnique: async () => ({ meta: autorunLimit === null ? {} : { autorun_limit: autorunLimit } }),
        },
        city: {
            findUnique: async () => null,
        },
        nation: {
            findUnique: async () => null,
        },
        generalTurn: {
            findMany: async (args?: GeneralTurnFindManyArgs) => {
                const generalId = typeof args?.where?.generalId === 'number' ? args.where.generalId : undefined;
                return generalId !== undefined ? (generalTurns.get(generalId) ?? []) : [];
            },
            deleteMany: async ({ where }: GeneralTurnDeleteManyArgs) => {
                if (where && typeof where.generalId === 'number') {
                    generalTurns.delete(where.generalId);
                }
                return {};
            },
            createMany: async ({ data }: GeneralTurnCreateManyArgs) => {
                const dataList = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[];
                const rows: GeneralTurnRow[] = dataList.map((row, index: number) => ({
                    id: index + 1,
                    generalId: row.generalId as number,
                    turnIdx: row.turnIdx as number,
                    actionCode: row.actionCode as string,
                    arg: row.arg as unknown as GeneralTurnRow['arg'],
                    createdAt: new Date(),
                }));
                const firstRow = dataList[0];
                const generalId = firstRow?.generalId as number | undefined;
                if (generalId !== undefined) {
                    generalTurns.set(generalId, rows);
                }
                return {};
            },
        },
        generalTurnRevision: {
            findUnique: async ({ where }: GeneralRevisionFindArgs) => {
                const generalId = where.generalId as number;
                const revision = generalRevisions.get(generalId);
                return revision === undefined
                    ? null
                    : {
                          generalId,
                          revision,
                          updatedAt: new Date(),
                      };
            },
            createMany: async ({ data }: GeneralRevisionCreateManyArgs) => {
                const row = (Array.isArray(data) ? data[0] : data) as {
                    generalId: number;
                    revision?: number;
                };
                if (generalRevisions.has(row.generalId)) {
                    return { count: 0 };
                }
                generalRevisions.set(row.generalId, row.revision ?? 0);
                return { count: 1 };
            },
            updateMany: async ({ where, data }: GeneralRevisionUpdateManyArgs) => {
                const generalId = typeof where?.generalId === 'number' ? where.generalId : -1;
                const expected = typeof where?.revision === 'number' ? where.revision : -1;
                if (generalRevisions.get(generalId) !== expected || typeof data.revision !== 'number') {
                    return { count: 0 };
                }
                generalRevisions.set(generalId, data.revision);
                return { count: 1 };
            },
        },
        nationTurn: {
            findMany: async (args?: NationTurnFindManyArgs) => {
                const nationId = typeof args?.where?.nationId === 'number' ? args.where.nationId : undefined;
                const officerLevel =
                    typeof args?.where?.officerLevel === 'number' ? args.where.officerLevel : undefined;
                if (nationId === undefined || officerLevel === undefined) {
                    return [];
                }
                return nationTurns.get(`${nationId}:${officerLevel}`) ?? [];
            },
            deleteMany: async ({ where }: NationTurnDeleteManyArgs) => {
                if (where && typeof where.nationId === 'number' && typeof where.officerLevel === 'number') {
                    nationTurns.delete(`${where.nationId}:${where.officerLevel}`);
                }
                return {};
            },
            createMany: async ({ data }: NationTurnCreateManyArgs) => {
                const dataList = (Array.isArray(data) ? data : [data]) as Record<string, unknown>[];
                const rows: NationTurnRow[] = dataList.map((row, index: number) => ({
                    id: index + 1,
                    nationId: row.nationId as number,
                    officerLevel: row.officerLevel as number,
                    turnIdx: row.turnIdx as number,
                    actionCode: row.actionCode as string,
                    arg: row.arg as unknown as NationTurnRow['arg'],
                    createdAt: new Date(),
                }));
                const firstRow = dataList[0];
                const nationId = firstRow?.nationId as number | undefined;
                const officerLevel = firstRow?.officerLevel as number | undefined;
                if (nationId !== undefined && officerLevel !== undefined) {
                    nationTurns.set(`${nationId}:${officerLevel}`, rows);
                }
                return {};
            },
        },
        nationTurnRevision: {
            findUnique: async ({ where }: NationRevisionFindArgs) => {
                const compound = where.nationId_officerLevel;
                if (!compound) {
                    return null;
                }
                const key = `${compound.nationId}:${compound.officerLevel}`;
                const revision = nationRevisions.get(key);
                return revision === undefined
                    ? null
                    : {
                          nationId: compound.nationId,
                          officerLevel: compound.officerLevel,
                          revision,
                          updatedAt: new Date(),
                      };
            },
            createMany: async ({ data }: NationRevisionCreateManyArgs) => {
                const row = (Array.isArray(data) ? data[0] : data) as {
                    nationId: number;
                    officerLevel: number;
                    revision?: number;
                };
                const key = `${row.nationId}:${row.officerLevel}`;
                if (nationRevisions.has(key)) {
                    return { count: 0 };
                }
                nationRevisions.set(key, row.revision ?? 0);
                return { count: 1 };
            },
            updateMany: async ({ where, data }: NationRevisionUpdateManyArgs) => {
                const nationId = typeof where?.nationId === 'number' ? where.nationId : -1;
                const officerLevel = typeof where?.officerLevel === 'number' ? where.officerLevel : -1;
                const expected = typeof where?.revision === 'number' ? where.revision : -1;
                const key = `${nationId}:${officerLevel}`;
                if (nationRevisions.get(key) !== expected || typeof data.revision !== 'number') {
                    return { count: 0 };
                }
                nationRevisions.set(key, data.revision);
                return { count: 1 };
            },
        },
    } as unknown as DatabaseClient;

    return { db, nationTurns, nationRevisions };
};

describe('reservedTurns', () => {
    it('loads multiple nation officer queues with two batched queries and preserves defaults', async () => {
        const findTurns = vi.fn(async () => [
            {
                id: 1,
                nationId: 4,
                officerLevel: 12,
                turnIdx: 1,
                actionCode: 'che_징병',
                arg: { amount: 100 },
                createdAt: new Date(),
            },
            {
                id: 2,
                nationId: 4,
                officerLevel: 10,
                turnIdx: 0,
                actionCode: 'che_훈련',
                arg: {},
                createdAt: new Date(),
            },
        ] satisfies NationTurnRow[]);
        const findRevisions = vi.fn(async () => [
            { nationId: 4, officerLevel: 12, revision: 7, updatedAt: new Date() },
        ]);
        const db = {
            nationTurn: { findMany: findTurns },
            nationTurnRevision: { findMany: findRevisions },
        } as unknown as DatabaseClient;

        const snapshots = await getNationTurnSnapshots(db, 4, [12, 10, 8, 12]);

        expect(findTurns).toHaveBeenCalledOnce();
        expect(findRevisions).toHaveBeenCalledOnce();
        expect(snapshots.size).toBe(3);
        expect(snapshots.get(12)?.revision).toBe(7);
        expect(snapshots.get(12)?.turns.slice(0, 2)).toEqual([
            { index: 0, action: '휴식', args: {} },
            { index: 1, action: 'che_징병', args: { amount: 100 } },
        ]);
        expect(snapshots.get(10)?.revision).toBe(0);
        expect(snapshots.get(10)?.turns[0]).toEqual({ index: 0, action: 'che_훈련', args: {} });
        expect(snapshots.get(8)?.revision).toBe(0);
        expect(snapshots.get(8)?.turns[0]).toEqual({ index: 0, action: '휴식', args: {} });
        expect(snapshots.get(8)?.turns).toHaveLength(MAX_NATION_TURNS);
    });

    it('sets and shifts general turns', async () => {
        const { db } = buildDb(2408);

        const initial = await setGeneralTurn(db, 1, 0, 'che_화계', { destCityId: 10 }, 0);

        expect(initial.revision).toBe(1);
        expect(initial.turns).toHaveLength(MAX_GENERAL_TURNS);
        expect(initial.turns[0]?.action).toBe('che_화계');
        expect(initial.autorunLimit).toBe(2408);

        const pushed = await shiftGeneralTurns(db, 1, 1, initial.revision);
        expect(pushed.revision).toBe(2);
        expect(pushed.turns[0]?.action).toBe('휴식');
        expect(pushed.turns[1]?.action).toBe('che_화계');
        expect(pushed.autorunLimit).toBe(2408);

        const pulled = await shiftGeneralTurns(db, 1, -1, pushed.revision);
        expect(pulled.turns[0]?.action).toBe('che_화계');
        expect(pulled.turns[MAX_GENERAL_TURNS - 1]?.action).toBe('휴식');
        expect(pulled.autorunLimit).toBe(2408);

        await expect(setGeneralTurn(db, 1, 2, 'che_훈련', {}, 1)).rejects.toBeInstanceOf(
            ReservedTurnRevisionConflictError
        );
    });

    it('sets and shifts nation turns', async () => {
        const { db } = buildDb();

        const initial = await setNationTurn(
            db,
            2,
            5,
            0,
            'che_포상',
            { isGold: true, amount: 200, destGeneralId: 7 },
            0
        );

        expect(initial.revision).toBe(1);
        expect(initial.turns).toHaveLength(MAX_NATION_TURNS);
        expect(initial.turns[0]?.action).toBe('che_포상');

        const pushed = await shiftNationTurns(db, 2, 5, 1, initial.revision);
        expect(pushed.turns[0]?.action).toBe('휴식');
        expect(pushed.turns[1]?.action).toBe('che_포상');
    });

    it('expands legacy general sentinel turn lists and applies bulk entries in order', async () => {
        const { db } = buildDb();

        expect(expandGeneralTurnIndices([-1])).toEqual(
            Array.from({ length: MAX_GENERAL_TURNS / 2 }, (_, index) => index * 2)
        );
        expect(expandGeneralTurnIndices([-2])).toEqual(
            Array.from({ length: MAX_GENERAL_TURNS / 2 }, (_, index) => index * 2 + 1)
        );
        expect(expandGeneralTurnIndices([-3])).toEqual(Array.from({ length: MAX_GENERAL_TURNS }, (_, index) => index));

        const result = await setGeneralTurns(
            db,
            3,
            [
                {
                    turnIndices: expandGeneralTurnIndices([-1]),
                    action: 'che_훈련',
                    args: {},
                },
                {
                    turnIndices: expandGeneralTurnIndices([-2]),
                    action: 'che_사기진작',
                    args: {},
                },
                {
                    turnIndices: [29],
                    action: '휴식',
                    args: {},
                },
            ],
            0
        );

        expect(result.turns[0]?.action).toBe('che_훈련');
        expect(result.turns[1]?.action).toBe('che_사기진작');
        expect(result.turns[28]?.action).toBe('che_훈련');
        expect(result.turns[29]?.action).toBe('휴식');
    });

    it('repeats the leading general pattern at the legacy interval', async () => {
        const { db } = buildDb(2408);
        const seeded = await setGeneralTurns(
            db,
            4,
            [
                { turnIndices: [0], action: 'che_훈련', args: {} },
                { turnIndices: [1], action: 'che_사기진작', args: {} },
                { turnIndices: [2], action: 'che_징병', args: { crewTypeId: 1100, amount: 100 } },
            ],
            0
        );
        const repeated = await repeatGeneralTurns(db, 4, 3, seeded.revision);

        expect(repeated.turns.slice(0, 9).map((turn) => turn.action)).toEqual([
            'che_훈련',
            'che_사기진작',
            'che_징병',
            'che_훈련',
            'che_사기진작',
            'che_징병',
            'che_훈련',
            'che_사기진작',
            'che_징병',
        ]);
        expect(repeated.autorunLimit).toBe(2408);
    });

    it('supports nation bulk/repeat and preserves the legacy amount-12 no-op', async () => {
        const { db } = buildDb();
        const seeded = await setNationTurns(
            db,
            5,
            12,
            [
                { turnIndices: [0, 2], action: 'che_포상', args: { amount: 1 } },
                { turnIndices: [1], action: 'che_몰수', args: { amount: 1 } },
            ],
            0
        );
        const repeated = await repeatNationTurns(db, 5, 12, 3, seeded.revision);
        expect(repeated.turns.slice(0, 6).map((turn) => turn.action)).toEqual([
            'che_포상',
            'che_몰수',
            'che_포상',
            'che_포상',
            'che_몰수',
            'che_포상',
        ]);

        const noOpRepeat = await repeatNationTurns(db, 5, 12, 12, repeated.revision);
        expect(noOpRepeat).toEqual(repeated);
        const noOpPush = await shiftNationTurns(db, 5, 12, 12, repeated.revision);
        expect(noOpPush).toEqual(repeated);
    });

    it('rebases stale nation slot input onto the current queue after a turn advances', async () => {
        const { db, nationTurns, nationRevisions } = buildDb();
        const seeded = await setNationTurns(
            db,
            6,
            12,
            [
                { turnIndices: [0], action: 'che_증축', args: {} },
                { turnIndices: [1], action: 'che_감축', args: {} },
                { turnIndices: [2], action: 'che_천도', args: { destCityId: 3 } },
            ],
            0
        );
        expect(seeded.revision).toBe(1);

        // daemon이 한 턴을 소비한 뒤의 현재 큐를 모사한다.
        nationRevisions.set('6:12', 2);
        nationTurns.set('6:12', [
            {
                id: 1,
                nationId: 6,
                officerLevel: 12,
                turnIdx: 0,
                actionCode: 'che_감축',
                arg: {},
                createdAt: new Date(),
            },
            {
                id: 2,
                nationId: 6,
                officerLevel: 12,
                turnIdx: 1,
                actionCode: 'che_천도',
                arg: { destCityId: 3 },
                createdAt: new Date(),
            },
        ]);

        const result = await setNationTurnsAtCurrentPositions(
            db,
            6,
            12,
            [{ turnIndices: [2], action: 'che_포상', args: { destGeneralId: 77, amount: 100, isGold: true } }],
            1
        );

        expect(result.revision).toBe(3);
        expect(result.turns[0]?.action).toBe('che_감축');
        expect(result.turns[1]?.action).toBe('che_천도');
        expect(result.turns[2]).toMatchObject({
            action: 'che_포상',
            args: { destGeneralId: 77, amount: 100, isGold: true },
        });
    });

    it('rejects an API writer while the daemon holds the queue lease without touching turns', async () => {
        const deleteMany = vi.fn(async () => ({}));
        const createMany = vi.fn(async () => ({}));
        const db = {
            generalTurnRevision: {
                updateMany: vi.fn(async () => ({ count: 0 })),
                createMany: vi.fn(async () => ({ count: 0 })),
                findUnique: vi.fn(async () => ({
                    generalId: 9,
                    revision: 0,
                    leaseOwner: 'daemon-1',
                    leaseExpiresAt: new Date(Date.now() + 60_000),
                    updatedAt: new Date(),
                })),
            },
            generalTurn: {
                findMany: vi.fn(async () => []),
                deleteMany,
                createMany,
            },
        } as unknown as DatabaseClient;

        await expect(setGeneralTurn(db, 9, 0, 'che_훈련', {}, 0)).rejects.toBeInstanceOf(
            ReservedTurnRevisionConflictError
        );
        expect(deleteMany).not.toHaveBeenCalled();
        expect(createMany).not.toHaveBeenCalled();
    });

    it('does not rebase a current-position nation write while the daemon lease holds the same revision', async () => {
        const deleteMany = vi.fn(async () => ({}));
        const createMany = vi.fn(async () => ({}));
        const db = {
            nationTurnRevision: {
                updateMany: vi.fn(async () => ({ count: 0 })),
                createMany: vi.fn(async () => ({ count: 0 })),
                findUnique: vi.fn(async () => ({
                    nationId: 6,
                    officerLevel: 12,
                    revision: 4,
                    leaseOwner: 'daemon-1',
                    leaseExpiresAt: new Date(Date.now() + 60_000),
                    updatedAt: new Date(),
                })),
            },
            nationTurn: {
                findMany: vi.fn(async () => []),
                deleteMany,
                createMany,
            },
        } as unknown as DatabaseClient;

        await expect(setNationTurnAtCurrentPosition(db, 6, 12, 2, 'che_증축', {}, 4)).rejects.toMatchObject({
            expectedRevision: 4,
            currentRevision: 4,
        });
        expect(deleteMany).not.toHaveBeenCalled();
        expect(createMany).not.toHaveBeenCalled();
    });
});
