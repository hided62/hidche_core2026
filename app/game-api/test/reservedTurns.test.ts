import { describe, expect, it } from 'vitest';

import type { DatabaseClient, GeneralTurnRow, NationTurnRow } from '../src/context.js';
import {
    MAX_GENERAL_TURNS,
    MAX_NATION_TURNS,
    setGeneralTurn,
    setNationTurn,
    shiftGeneralTurns,
    shiftNationTurns,
    ReservedTurnRevisionConflictError,
} from '../src/turns/reservedTurns.js';

const buildDb = () => {
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
            findUnique: async () => null,
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

    return { db };
};

describe('reservedTurns', () => {
    it('sets and shifts general turns', async () => {
        const { db } = buildDb();

        const initial = await setGeneralTurn(db, 1, 0, 'che_화계', { destCityId: 10 }, 0);

        expect(initial.revision).toBe(1);
        expect(initial.turns).toHaveLength(MAX_GENERAL_TURNS);
        expect(initial.turns[0]?.action).toBe('che_화계');

        const pushed = await shiftGeneralTurns(db, 1, 1, initial.revision);
        expect(pushed.revision).toBe(2);
        expect(pushed.turns[0]?.action).toBe('휴식');
        expect(pushed.turns[1]?.action).toBe('che_화계');

        const pulled = await shiftGeneralTurns(db, 1, -1, pushed.revision);
        expect(pulled.turns[0]?.action).toBe('che_화계');
        expect(pulled.turns[MAX_GENERAL_TURNS - 1]?.action).toBe('휴식');

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
});
