import { describe, expect, it } from 'vitest';

import type { DatabaseClient, GeneralTurnRow, NationTurnRow } from '../src/context.js';
import {
    MAX_GENERAL_TURNS,
    MAX_NATION_TURNS,
    setGeneralTurn,
    setNationTurn,
    shiftGeneralTurns,
    shiftNationTurns,
} from '../src/turns/reservedTurns.js';

const buildDb = () => {
    const generalTurns = new Map<number, GeneralTurnRow[]>();
    const nationTurns = new Map<string, NationTurnRow[]>();

    type GeneralTurnFindManyArgs = Parameters<DatabaseClient['generalTurn']['findMany']>[0];
    type GeneralTurnDeleteManyArgs = NonNullable<Parameters<DatabaseClient['generalTurn']['deleteMany']>[0]>;
    type GeneralTurnCreateManyArgs = NonNullable<Parameters<DatabaseClient['generalTurn']['createMany']>[0]>;

    type NationTurnFindManyArgs = Parameters<DatabaseClient['nationTurn']['findMany']>[0];
    type NationTurnDeleteManyArgs = NonNullable<Parameters<DatabaseClient['nationTurn']['deleteMany']>[0]>;
    type NationTurnCreateManyArgs = NonNullable<Parameters<DatabaseClient['nationTurn']['createMany']>[0]>;

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
    } as unknown as DatabaseClient;

    return { db };
};

describe('reservedTurns', () => {
    it('sets and shifts general turns', async () => {
        const { db } = buildDb();

        const initial = await setGeneralTurn(db, 1, 0, 'che_화계', { destCityId: 10 });

        expect(initial).toHaveLength(MAX_GENERAL_TURNS);
        expect(initial[0]?.action).toBe('che_화계');

        const pushed = await shiftGeneralTurns(db, 1, 1);
        expect(pushed[0]?.action).toBe('휴식');
        expect(pushed[1]?.action).toBe('che_화계');

        const pulled = await shiftGeneralTurns(db, 1, -1);
        expect(pulled[0]?.action).toBe('che_화계');
        expect(pulled[MAX_GENERAL_TURNS - 1]?.action).toBe('휴식');
    });

    it('sets and shifts nation turns', async () => {
        const { db } = buildDb();

        const initial = await setNationTurn(db, 2, 5, 0, 'che_포상', { isGold: true, amount: 200, destGeneralId: 7 });

        expect(initial).toHaveLength(MAX_NATION_TURNS);
        expect(initial[0]?.action).toBe('che_포상');

        const pushed = await shiftNationTurns(db, 2, 5, 1);
        expect(pushed[0]?.action).toBe('휴식');
        expect(pushed[1]?.action).toBe('che_포상');
    });
});
