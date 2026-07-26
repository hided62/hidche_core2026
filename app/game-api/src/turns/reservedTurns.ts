import type { DatabaseClient, GeneralTurnRow, NationTurnRow, InputJsonValue } from '../context.js';
import { isRecord } from '@sammo-ts/common';

export const DEFAULT_TURN_ACTION = '휴식';
export const MAX_GENERAL_TURNS = 30;
export const MAX_NATION_TURNS = 12;

export interface ReservedTurnEntry {
    action: string;
    args: InputJsonValue;
}

export interface ReservedTurnView {
    index: number;
    action: string;
    args: InputJsonValue;
}

export interface ReservedTurnSnapshot {
    revision: number;
    turns: ReservedTurnView[];
}

export class ReservedTurnRevisionConflictError extends Error {
    constructor(
        readonly expectedRevision: number,
        readonly currentRevision: number
    ) {
        super(`Reserved turn queue revision conflict: expected ${expectedRevision}, current ${currentRevision}.`);
        this.name = 'ReservedTurnRevisionConflictError';
    }
}

const normalizeAction = (action: string | null | undefined): string =>
    action && action.length > 0 ? action : DEFAULT_TURN_ACTION;

const normalizeArgs = (args: unknown): InputJsonValue => (isRecord(args) ? (args as InputJsonValue) : {});

const createDefaultEntry = (): ReservedTurnEntry => ({
    action: DEFAULT_TURN_ACTION,
    args: {},
});

const buildDefaultTurns = (length: number): ReservedTurnEntry[] => Array.from({ length }, () => createDefaultEntry());

const applyShift = (turns: ReservedTurnEntry[], amount: number): ReservedTurnEntry[] => {
    if (amount === 0) {
        return turns.slice();
    }
    if (amount > 0) {
        const padding = Array.from({ length: amount }, () => createDefaultEntry());
        const sliced = turns.slice(0, Math.max(0, turns.length - amount));
        return padding.concat(sliced);
    }
    const shift = Math.min(turns.length, Math.abs(amount));
    const padding = Array.from({ length: shift }, () => createDefaultEntry());
    const sliced = turns.slice(shift);
    return sliced.concat(padding);
};

const buildTurnListFromRows = (rows: Array<GeneralTurnRow | NationTurnRow>, maxTurns: number): ReservedTurnEntry[] => {
    const result = buildDefaultTurns(maxTurns);
    for (const row of rows) {
        if (row.turnIdx < 0 || row.turnIdx >= maxTurns) {
            continue;
        }
        result[row.turnIdx] = {
            action: normalizeAction(row.actionCode),
            args: normalizeArgs(row.arg),
        };
    }
    return result;
};

const serializeTurnList = (turns: ReservedTurnEntry[]): ReservedTurnView[] =>
    turns.map((entry, index) => ({
        index,
        action: entry.action,
        args: entry.args,
    }));

const persistGeneralTurns = async (
    db: DatabaseClient,
    generalId: number,
    turns: ReservedTurnEntry[]
): Promise<void> => {
    await db.generalTurn.deleteMany({ where: { generalId } });
    await db.generalTurn.createMany({
        data: turns.map((entry, turnIdx) => ({
            generalId,
            turnIdx,
            actionCode: normalizeAction(entry.action),
            arg: normalizeArgs(entry.args),
        })),
    });
};

const persistNationTurns = async (
    db: DatabaseClient,
    nationId: number,
    officerLevel: number,
    turns: ReservedTurnEntry[]
): Promise<void> => {
    await db.nationTurn.deleteMany({ where: { nationId, officerLevel } });
    await db.nationTurn.createMany({
        data: turns.map((entry, turnIdx) => ({
            nationId,
            officerLevel,
            turnIdx,
            actionCode: normalizeAction(entry.action),
            arg: normalizeArgs(entry.args),
        })),
    });
};

export const loadGeneralTurns = async (db: DatabaseClient, generalId: number): Promise<ReservedTurnEntry[]> => {
    const rows = await db.generalTurn.findMany({
        where: { generalId },
        orderBy: [{ turnIdx: 'asc' }],
    });
    return buildTurnListFromRows(rows, MAX_GENERAL_TURNS);
};

export const listGeneralTurns = async (db: DatabaseClient, generalId: number): Promise<ReservedTurnView[]> => {
    const turns = await loadGeneralTurns(db, generalId);
    return serializeTurnList(turns);
};

export const getGeneralTurnSnapshot = async (db: DatabaseClient, generalId: number): Promise<ReservedTurnSnapshot> => {
    const [turns, revisionRow] = await Promise.all([
        loadGeneralTurns(db, generalId),
        db.generalTurnRevision.findUnique({ where: { generalId } }),
    ]);
    return {
        revision: revisionRow?.revision ?? 0,
        turns: serializeTurnList(turns),
    };
};

export const loadNationTurns = async (
    db: DatabaseClient,
    nationId: number,
    officerLevel: number
): Promise<ReservedTurnEntry[]> => {
    const rows = await db.nationTurn.findMany({
        where: { nationId, officerLevel },
        orderBy: [{ turnIdx: 'asc' }],
    });
    return buildTurnListFromRows(rows, MAX_NATION_TURNS);
};

export const listNationTurns = async (
    db: DatabaseClient,
    nationId: number,
    officerLevel: number
): Promise<ReservedTurnView[]> => {
    const turns = await loadNationTurns(db, nationId, officerLevel);
    return serializeTurnList(turns);
};

export const getNationTurnSnapshot = async (
    db: DatabaseClient,
    nationId: number,
    officerLevel: number
): Promise<ReservedTurnSnapshot> => {
    const [turns, revisionRow] = await Promise.all([
        loadNationTurns(db, nationId, officerLevel),
        db.nationTurnRevision.findUnique({
            where: {
                nationId_officerLevel: {
                    nationId,
                    officerLevel,
                },
            },
        }),
    ]);
    return {
        revision: revisionRow?.revision ?? 0,
        turns: serializeTurnList(turns),
    };
};

const claimGeneralRevision = async (
    db: DatabaseClient,
    generalId: number,
    expectedRevision: number
): Promise<number> => {
    const nextRevision = expectedRevision + 1;
    const claimed =
        expectedRevision === 0
            ? await db.generalTurnRevision.createMany({
                  data: [{ generalId, revision: nextRevision }],
                  skipDuplicates: true,
              })
            : await db.generalTurnRevision.updateMany({
                  where: { generalId, revision: expectedRevision },
                  data: { revision: nextRevision },
              });
    if (claimed.count === 1) {
        return nextRevision;
    }
    const current = await db.generalTurnRevision.findUnique({ where: { generalId } });
    throw new ReservedTurnRevisionConflictError(expectedRevision, current?.revision ?? 0);
};

const claimNationRevision = async (
    db: DatabaseClient,
    nationId: number,
    officerLevel: number,
    expectedRevision: number
): Promise<number> => {
    const nextRevision = expectedRevision + 1;
    const claimed =
        expectedRevision === 0
            ? await db.nationTurnRevision.createMany({
                  data: [{ nationId, officerLevel, revision: nextRevision }],
                  skipDuplicates: true,
              })
            : await db.nationTurnRevision.updateMany({
                  where: { nationId, officerLevel, revision: expectedRevision },
                  data: { revision: nextRevision },
              });
    if (claimed.count === 1) {
        return nextRevision;
    }
    const current = await db.nationTurnRevision.findUnique({
        where: {
            nationId_officerLevel: {
                nationId,
                officerLevel,
            },
        },
    });
    throw new ReservedTurnRevisionConflictError(expectedRevision, current?.revision ?? 0);
};

export const setGeneralTurn = async (
    db: DatabaseClient,
    generalId: number,
    turnIndex: number,
    action: string,
    args: unknown,
    expectedRevision: number
): Promise<ReservedTurnSnapshot> => {
    const revision = await claimGeneralRevision(db, generalId, expectedRevision);
    const turns = await loadGeneralTurns(db, generalId);
    turns[turnIndex] = {
        action: normalizeAction(action),
        args: normalizeArgs(args),
    };
    await persistGeneralTurns(db, generalId, turns);
    return { revision, turns: serializeTurnList(turns) };
};

export const shiftGeneralTurns = async (
    db: DatabaseClient,
    generalId: number,
    amount: number,
    expectedRevision: number
): Promise<ReservedTurnSnapshot> => {
    const revision = await claimGeneralRevision(db, generalId, expectedRevision);
    const turns = await loadGeneralTurns(db, generalId);
    const shifted = applyShift(turns, amount);
    await persistGeneralTurns(db, generalId, shifted);
    return { revision, turns: serializeTurnList(shifted) };
};

export const setNationTurn = async (
    db: DatabaseClient,
    nationId: number,
    officerLevel: number,
    turnIndex: number,
    action: string,
    args: unknown,
    expectedRevision: number
): Promise<ReservedTurnSnapshot> => {
    const revision = await claimNationRevision(db, nationId, officerLevel, expectedRevision);
    const turns = await loadNationTurns(db, nationId, officerLevel);
    turns[turnIndex] = {
        action: normalizeAction(action),
        args: normalizeArgs(args),
    };
    await persistNationTurns(db, nationId, officerLevel, turns);
    return { revision, turns: serializeTurnList(turns) };
};

export const shiftNationTurns = async (
    db: DatabaseClient,
    nationId: number,
    officerLevel: number,
    amount: number,
    expectedRevision: number
): Promise<ReservedTurnSnapshot> => {
    const revision = await claimNationRevision(db, nationId, officerLevel, expectedRevision);
    const turns = await loadNationTurns(db, nationId, officerLevel);
    const shifted = applyShift(turns, amount);
    await persistNationTurns(db, nationId, officerLevel, shifted);
    return { revision, turns: serializeTurnList(shifted) };
};
