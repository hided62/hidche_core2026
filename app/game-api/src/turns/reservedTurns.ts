import type { DatabaseClient, GeneralTurnRow, NationTurnRow, InputJsonValue } from '../context.js';
import { isRecord } from '@sammo-ts/common';

const DEFAULT_TURN_ACTION = '휴식';
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
    autorunLimit?: number | null;
}

export interface ReservedTurnUpdate {
    turnIndices: readonly number[];
    action: string;
    args: unknown;
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

const applyRepeat = (turns: ReservedTurnEntry[], amount: number): ReservedTurnEntry[] => {
    if (amount <= 0 || amount >= turns.length) {
        return turns.slice();
    }
    const repeated = turns.map((entry) => ({
        action: entry.action,
        args: entry.args,
    }));
    const sourceCount = amount * 2 > turns.length ? turns.length - amount : amount;
    for (let sourceIndex = 0; sourceIndex < sourceCount; sourceIndex += 1) {
        const source = turns[sourceIndex] ?? createDefaultEntry();
        for (let targetIndex = sourceIndex + amount; targetIndex < turns.length; targetIndex += amount) {
            repeated[targetIndex] = {
                action: source.action,
                args: source.args,
            };
        }
    }
    return repeated;
};

export const expandGeneralTurnIndices = (rawTurnIndices: readonly number[]): number[] => {
    const expanded = new Set<number>();
    for (const turnIndex of rawTurnIndices) {
        if (turnIndex >= 0) {
            expanded.add(turnIndex);
            continue;
        }
        const start = turnIndex === -2 ? 1 : 0;
        const step = turnIndex === -3 ? 1 : 2;
        for (let index = start; index < MAX_GENERAL_TURNS; index += step) {
            expanded.add(index);
        }
    }
    return Array.from(expanded);
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

const loadGeneralTurns = async (db: DatabaseClient, generalId: number): Promise<ReservedTurnEntry[]> => {
    const rows = await db.generalTurn.findMany({
        where: { generalId },
        orderBy: [{ turnIdx: 'asc' }],
    });
    return buildTurnListFromRows(rows, MAX_GENERAL_TURNS);
};

const loadGeneralAutorunLimit = async (db: DatabaseClient, generalId: number): Promise<number | null> => {
    const general = await db.general.findUnique({ where: { id: generalId }, select: { meta: true } });
    const rawAutorunLimit = isRecord(general?.meta) ? general.meta.autorun_limit : undefined;
    return typeof rawAutorunLimit === 'number' && Number.isFinite(rawAutorunLimit) ? Math.trunc(rawAutorunLimit) : null;
};

export const getGeneralTurnSnapshot = async (db: DatabaseClient, generalId: number): Promise<ReservedTurnSnapshot> => {
    const [turns, revisionRow, autorunLimit] = await Promise.all([
        loadGeneralTurns(db, generalId),
        db.generalTurnRevision.findUnique({ where: { generalId } }),
        loadGeneralAutorunLimit(db, generalId),
    ]);
    return {
        revision: revisionRow?.revision ?? 0,
        turns: serializeTurnList(turns),
        autorunLimit,
    };
};

const loadNationTurns = async (
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

export const getNationTurnSnapshots = async (
    db: DatabaseClient,
    nationId: number,
    officerLevels: readonly number[]
): Promise<Map<number, ReservedTurnSnapshot>> => {
    const levels = [...new Set(officerLevels)];
    if (levels.length === 0) return new Map();
    const [turnRows, revisionRows] = await Promise.all([
        db.nationTurn.findMany({
            where: { nationId, officerLevel: { in: levels } },
            orderBy: [{ officerLevel: 'asc' }, { turnIdx: 'asc' }],
        }),
        db.nationTurnRevision.findMany({
            where: { nationId, officerLevel: { in: levels } },
        }),
    ]);
    const turnsByLevel = new Map<number, NationTurnRow[]>();
    for (const row of turnRows) {
        const rows = turnsByLevel.get(row.officerLevel) ?? [];
        rows.push(row);
        turnsByLevel.set(row.officerLevel, rows);
    }
    const revisionByLevel = new Map(revisionRows.map((row) => [row.officerLevel, row.revision]));
    return new Map(
        levels.map((level) => [
            level,
            {
                revision: revisionByLevel.get(level) ?? 0,
                turns: serializeTurnList(
                    buildTurnListFromRows(turnsByLevel.get(level) ?? [], MAX_NATION_TURNS)
                ),
            },
        ])
    );
};

const claimGeneralRevision = async (
    db: DatabaseClient,
    generalId: number,
    expectedRevision: number
): Promise<number> => {
    const nextRevision = expectedRevision + 1;
    const now = new Date();
    let claimed = await db.generalTurnRevision.updateMany({
        where: {
            generalId,
            revision: expectedRevision,
            OR: [{ leaseOwner: null }, { leaseExpiresAt: { lte: now } }],
        },
        data: {
            revision: nextRevision,
            leaseOwner: null,
            leaseExpiresAt: null,
        },
    });
    if (claimed.count === 0 && expectedRevision === 0) {
        claimed = await db.generalTurnRevision.createMany({
            data: [{ generalId, revision: nextRevision }],
            skipDuplicates: true,
        });
    }
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
    const now = new Date();
    let claimed = await db.nationTurnRevision.updateMany({
        where: {
            nationId,
            officerLevel,
            revision: expectedRevision,
            OR: [{ leaseOwner: null }, { leaseExpiresAt: { lte: now } }],
        },
        data: {
            revision: nextRevision,
            leaseOwner: null,
            leaseExpiresAt: null,
        },
    });
    if (claimed.count === 0 && expectedRevision === 0) {
        claimed = await db.nationTurnRevision.createMany({
            data: [{ nationId, officerLevel, revision: nextRevision }],
            skipDuplicates: true,
        });
    }
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

const assertGeneralRevision = async (
    db: DatabaseClient,
    generalId: number,
    expectedRevision: number
): Promise<ReservedTurnSnapshot> => {
    const snapshot = await getGeneralTurnSnapshot(db, generalId);
    if (snapshot.revision !== expectedRevision) {
        throw new ReservedTurnRevisionConflictError(expectedRevision, snapshot.revision);
    }
    return snapshot;
};

const assertNationRevision = async (
    db: DatabaseClient,
    nationId: number,
    officerLevel: number,
    expectedRevision: number
): Promise<ReservedTurnSnapshot> => {
    const snapshot = await getNationTurnSnapshot(db, nationId, officerLevel);
    if (snapshot.revision !== expectedRevision) {
        throw new ReservedTurnRevisionConflictError(expectedRevision, snapshot.revision);
    }
    return snapshot;
};

export const setGeneralTurns = async (
    db: DatabaseClient,
    generalId: number,
    updates: readonly ReservedTurnUpdate[],
    expectedRevision: number
): Promise<ReservedTurnSnapshot> => {
    const revision = await claimGeneralRevision(db, generalId, expectedRevision);
    const turns = await loadGeneralTurns(db, generalId);
    for (const update of updates) {
        for (const turnIndex of update.turnIndices) {
            turns[turnIndex] = {
                action: normalizeAction(update.action),
                args: normalizeArgs(update.args),
            };
        }
    }
    await persistGeneralTurns(db, generalId, turns);
    return { revision, turns: serializeTurnList(turns), autorunLimit: await loadGeneralAutorunLimit(db, generalId) };
};

export const setGeneralTurn = async (
    db: DatabaseClient,
    generalId: number,
    turnIndex: number,
    action: string,
    args: unknown,
    expectedRevision: number
): Promise<ReservedTurnSnapshot> =>
    setGeneralTurns(db, generalId, [{ turnIndices: [turnIndex], action, args }], expectedRevision);

export const shiftGeneralTurns = async (
    db: DatabaseClient,
    generalId: number,
    amount: number,
    expectedRevision: number
): Promise<ReservedTurnSnapshot> => {
    if (Math.abs(amount) >= MAX_GENERAL_TURNS) {
        return assertGeneralRevision(db, generalId, expectedRevision);
    }
    const revision = await claimGeneralRevision(db, generalId, expectedRevision);
    const turns = await loadGeneralTurns(db, generalId);
    const shifted = applyShift(turns, amount);
    await persistGeneralTurns(db, generalId, shifted);
    return { revision, turns: serializeTurnList(shifted), autorunLimit: await loadGeneralAutorunLimit(db, generalId) };
};

export const repeatGeneralTurns = async (
    db: DatabaseClient,
    generalId: number,
    amount: number,
    expectedRevision: number
): Promise<ReservedTurnSnapshot> => {
    if (amount >= MAX_GENERAL_TURNS) {
        return assertGeneralRevision(db, generalId, expectedRevision);
    }
    const revision = await claimGeneralRevision(db, generalId, expectedRevision);
    const turns = applyRepeat(await loadGeneralTurns(db, generalId), amount);
    await persistGeneralTurns(db, generalId, turns);
    return { revision, turns: serializeTurnList(turns), autorunLimit: await loadGeneralAutorunLimit(db, generalId) };
};

export const setNationTurns = async (
    db: DatabaseClient,
    nationId: number,
    officerLevel: number,
    updates: readonly ReservedTurnUpdate[],
    expectedRevision: number
): Promise<ReservedTurnSnapshot> => {
    const revision = await claimNationRevision(db, nationId, officerLevel, expectedRevision);
    const turns = await loadNationTurns(db, nationId, officerLevel);
    for (const update of updates) {
        for (const turnIndex of update.turnIndices) {
            turns[turnIndex] = {
                action: normalizeAction(update.action),
                args: normalizeArgs(update.args),
            };
        }
    }
    await persistNationTurns(db, nationId, officerLevel, turns);
    return { revision, turns: serializeTurnList(turns) };
};

/**
 * 국가 턴 입력은 화면을 연 뒤 daemon이 선두 턴을 소비했더라도 사용자가 고른
 * 슬롯 번호를 현재 큐에 적용한다. 큐 lease가 실제로 잡혀 있는 충돌은 그대로
 * 거절하고, revision이 앞으로 진행한 경우에만 새 revision으로 재기준화한다.
 */
export const setNationTurnsAtCurrentPositions = async (
    db: DatabaseClient,
    nationId: number,
    officerLevel: number,
    updates: readonly ReservedTurnUpdate[],
    expectedRevision: number
): Promise<ReservedTurnSnapshot> => {
    let revision = expectedRevision;
    for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
            return await setNationTurns(db, nationId, officerLevel, updates, revision);
        } catch (error) {
            if (!(error instanceof ReservedTurnRevisionConflictError) || error.currentRevision === revision) {
                throw error;
            }
            revision = error.currentRevision;
        }
    }
    throw new ReservedTurnRevisionConflictError(revision, revision);
};

export const setNationTurn = async (
    db: DatabaseClient,
    nationId: number,
    officerLevel: number,
    turnIndex: number,
    action: string,
    args: unknown,
    expectedRevision: number
): Promise<ReservedTurnSnapshot> =>
    setNationTurns(db, nationId, officerLevel, [{ turnIndices: [turnIndex], action, args }], expectedRevision);

export const setNationTurnAtCurrentPosition = async (
    db: DatabaseClient,
    nationId: number,
    officerLevel: number,
    turnIndex: number,
    action: string,
    args: unknown,
    expectedRevision: number
): Promise<ReservedTurnSnapshot> =>
    setNationTurnsAtCurrentPositions(
        db,
        nationId,
        officerLevel,
        [{ turnIndices: [turnIndex], action, args }],
        expectedRevision
    );

export const shiftNationTurns = async (
    db: DatabaseClient,
    nationId: number,
    officerLevel: number,
    amount: number,
    expectedRevision: number
): Promise<ReservedTurnSnapshot> => {
    if (Math.abs(amount) >= MAX_NATION_TURNS) {
        return assertNationRevision(db, nationId, officerLevel, expectedRevision);
    }
    const revision = await claimNationRevision(db, nationId, officerLevel, expectedRevision);
    const turns = await loadNationTurns(db, nationId, officerLevel);
    const shifted = applyShift(turns, amount);
    await persistNationTurns(db, nationId, officerLevel, shifted);
    return { revision, turns: serializeTurnList(shifted) };
};

export const repeatNationTurns = async (
    db: DatabaseClient,
    nationId: number,
    officerLevel: number,
    amount: number,
    expectedRevision: number
): Promise<ReservedTurnSnapshot> => {
    if (amount >= MAX_NATION_TURNS) {
        return assertNationRevision(db, nationId, officerLevel, expectedRevision);
    }
    const revision = await claimNationRevision(db, nationId, officerLevel, expectedRevision);
    const turns = applyRepeat(await loadNationTurns(db, nationId, officerLevel), amount);
    await persistNationTurns(db, nationId, officerLevel, turns);
    return { revision, turns: serializeTurnList(turns) };
};
