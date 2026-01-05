import { describe, expect, it } from 'vitest';

import type {
    DatabaseClient,
    GeneralTurnRow,
    NationTurnRow,
} from '../src/context.js';
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
            findMany: async ({ where }: any) => generalTurns.get(where.generalId) ?? [],
            deleteMany: async ({ where }: any) => {
                generalTurns.delete(where.generalId);
                return {};
            },
            createMany: async ({ data }: any) => {
                const rows = data.map((row: any, index: number) => ({
                    id: index + 1,
                    generalId: row.generalId,
                    turnIdx: row.turnIdx,
                    actionCode: row.actionCode,
                    arg: row.arg,
                }));
                const generalId = data[0]?.generalId;
                if (generalId !== undefined) {
                    generalTurns.set(generalId, rows);
                }
                return {};
            },
        },
        nationTurn: {
            findMany: async ({ where }: any) =>
                nationTurns.get(`${where.nationId}:${where.officerLevel}`) ?? [],
            deleteMany: async ({ where }: any) => {
                nationTurns.delete(`${where.nationId}:${where.officerLevel}`);
                return {};
            },
            createMany: async ({ data }: any) => {
                const rows = data.map((row: any, index: number) => ({
                    id: index + 1,
                    nationId: row.nationId,
                    officerLevel: row.officerLevel,
                    turnIdx: row.turnIdx,
                    actionCode: row.actionCode,
                    arg: row.arg,
                }));
                const nationId = data[0]?.nationId;
                const officerLevel = data[0]?.officerLevel;
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

        const initial = await setGeneralTurn(
            db,
            1,
            0,
            'che_화계',
            { destCityId: 10 }
        );

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

        const initial = await setNationTurn(
            db,
            2,
            5,
            0,
            'che_포상',
            { isGold: true, amount: 200, destGeneralId: 7 }
        );

        expect(initial).toHaveLength(MAX_NATION_TURNS);
        expect(initial[0]?.action).toBe('che_포상');

        const pushed = await shiftNationTurns(db, 2, 5, 1);
        expect(pushed[0]?.action).toBe('휴식');
        expect(pushed[1]?.action).toBe('che_포상');
    });
});
