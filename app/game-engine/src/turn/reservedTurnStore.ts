import { createGamePostgresConnector, type InputJsonValue, type TurnEngineDatabaseClient } from '@sammo-ts/infra';

export interface ReservedTurnEntry {
    action: string;
    args: Record<string, unknown>;
}

export interface ReservedTurnStoreOptions {
    databaseUrl: string;
    maxGeneralTurns?: number;
    maxNationTurns?: number;
}

export interface ReservedTurnStoreHandle {
    store: InMemoryReservedTurnStore;
    close(): Promise<void>;
}

const DEFAULT_TURN_ACTION = '휴식';
const DEFAULT_GENERAL_TURNS = 30;
const DEFAULT_NATION_TURNS = 12;

const asJson = (value: unknown): InputJsonValue => value as InputJsonValue;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeAction = (action: string | null | undefined): string =>
    action && action.length > 0 ? action : DEFAULT_TURN_ACTION;

const normalizeArgs = (args: unknown): Record<string, unknown> => (isRecord(args) ? args : {});

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
        const shift = Math.min(turns.length, amount);
        const padding = Array.from({ length: shift }, () => createDefaultEntry());
        const sliced = turns.slice(0, Math.max(0, turns.length - shift));
        return padding.concat(sliced);
    }
    const shift = Math.min(turns.length, Math.abs(amount));
    const padding = Array.from({ length: shift }, () => createDefaultEntry());
    const sliced = turns.slice(shift);
    return sliced.concat(padding);
};

const buildTurnListFromRows = (
    rows: Array<{ turnIdx: number; actionCode: string; arg: unknown }>,
    maxTurns: number
): ReservedTurnEntry[] => {
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

const buildNationKey = (nationId: number, officerLevel: number): string => `${nationId}:${officerLevel}`;

type ReservedTurnDatabaseClient = Pick<TurnEngineDatabaseClient, 'generalTurn' | 'nationTurn'>;

export class InMemoryReservedTurnStore {
    private readonly generalTurns = new Map<number, ReservedTurnEntry[]>();
    private readonly nationTurns = new Map<string, ReservedTurnEntry[]>();
    private readonly dirtyGeneralIds = new Set<number>();
    private readonly dirtyNationKeys = new Set<string>();
    private readonly maxGeneralTurns: number;
    private readonly maxNationTurns: number;

    constructor(
        private readonly prisma: ReservedTurnDatabaseClient,
        options: { maxGeneralTurns: number; maxNationTurns: number }
    ) {
        this.maxGeneralTurns = options.maxGeneralTurns;
        this.maxNationTurns = options.maxNationTurns;
    }

    async loadAll(): Promise<void> {
        const [generalRows, nationRows] = await Promise.all([
            this.prisma.generalTurn.findMany(),
            this.prisma.nationTurn.findMany(),
        ]);

        const generalGroups = new Map<number, typeof generalRows>();
        for (const row of generalRows) {
            const list = generalGroups.get(row.generalId);
            if (list) {
                list.push(row);
            } else {
                generalGroups.set(row.generalId, [row]);
            }
        }
        for (const [generalId, rows] of generalGroups.entries()) {
            this.generalTurns.set(generalId, buildTurnListFromRows(rows, this.maxGeneralTurns));
        }

        const nationGroups = new Map<string, typeof nationRows>();
        for (const row of nationRows) {
            const key = buildNationKey(row.nationId, row.officerLevel);
            const list = nationGroups.get(key);
            if (list) {
                list.push(row);
            } else {
                nationGroups.set(key, [row]);
            }
        }
        for (const [key, rows] of nationGroups.entries()) {
            this.nationTurns.set(key, buildTurnListFromRows(rows, this.maxNationTurns));
        }
    }

    async refreshGeneralTurns(generalId: number): Promise<void> {
        if (this.dirtyGeneralIds.has(generalId)) {
            return;
        }
        const rows = await this.prisma.generalTurn.findMany({
            where: { generalId },
            orderBy: [{ turnIdx: 'asc' }],
        });
        this.generalTurns.set(generalId, buildTurnListFromRows(rows, this.maxGeneralTurns));
    }

    async prefetchGeneralTurns(generalIds: number[]): Promise<void> {
        const targetIds = Array.from(new Set(generalIds)).filter((generalId) => !this.dirtyGeneralIds.has(generalId));
        if (targetIds.length === 0) {
            return;
        }
        const rows = await this.prisma.generalTurn.findMany({
            where: { generalId: { in: targetIds } },
            orderBy: [{ generalId: 'asc' }, { turnIdx: 'asc' }],
        });
        const grouped = new Map<number, typeof rows>();
        for (const row of rows) {
            const list = grouped.get(row.generalId);
            if (list) {
                list.push(row);
            } else {
                grouped.set(row.generalId, [row]);
            }
        }
        for (const generalId of targetIds) {
            const list = grouped.get(generalId) ?? [];
            this.generalTurns.set(generalId, buildTurnListFromRows(list, this.maxGeneralTurns));
        }
    }

    async refreshNationTurns(nationId: number, officerLevel: number): Promise<void> {
        const key = buildNationKey(nationId, officerLevel);
        if (this.dirtyNationKeys.has(key)) {
            return;
        }
        const rows = await this.prisma.nationTurn.findMany({
            where: { nationId, officerLevel },
            orderBy: [{ turnIdx: 'asc' }],
        });
        this.nationTurns.set(key, buildTurnListFromRows(rows, this.maxNationTurns));
    }

    getGeneralTurns(generalId: number): ReservedTurnEntry[] {
        const current = this.generalTurns.get(generalId);
        if (current) {
            return current;
        }
        const created = buildDefaultTurns(this.maxGeneralTurns);
        this.generalTurns.set(generalId, created);
        return created;
    }

    getNationTurns(nationId: number, officerLevel: number): ReservedTurnEntry[] {
        const key = buildNationKey(nationId, officerLevel);
        const current = this.nationTurns.get(key);
        if (current) {
            return current;
        }
        const created = buildDefaultTurns(this.maxNationTurns);
        this.nationTurns.set(key, created);
        return created;
    }

    getGeneralTurn(generalId: number, turnIdx: number): ReservedTurnEntry {
        const list = this.getGeneralTurns(generalId);
        return list[turnIdx] ?? createDefaultEntry();
    }

    getNationTurn(nationId: number, officerLevel: number, turnIdx: number): ReservedTurnEntry {
        const list = this.getNationTurns(nationId, officerLevel);
        return list[turnIdx] ?? createDefaultEntry();
    }

    shiftGeneralTurns(generalId: number, amount: number): void {
        const list = this.getGeneralTurns(generalId);
        this.generalTurns.set(generalId, applyShift(list, amount));
        this.dirtyGeneralIds.add(generalId);
    }

    shiftNationTurns(nationId: number, officerLevel: number, amount: number): void {
        const key = buildNationKey(nationId, officerLevel);
        const list = this.getNationTurns(nationId, officerLevel);
        this.nationTurns.set(key, applyShift(list, amount));
        this.dirtyNationKeys.add(key);
    }

    async flushChanges(): Promise<void> {
        const generalIds = Array.from(this.dirtyGeneralIds);
        for (const generalId of generalIds) {
            const turns = this.getGeneralTurns(generalId);
            await this.prisma.generalTurn.deleteMany({ where: { generalId } });
            await this.prisma.generalTurn.createMany({
                data: turns.map((entry, turnIdx) => ({
                    generalId,
                    turnIdx,
                    actionCode: normalizeAction(entry.action),
                    arg: asJson(normalizeArgs(entry.args)),
                })),
            });
        }

        const nationKeys = Array.from(this.dirtyNationKeys);
        for (const key of nationKeys) {
            const [nationIdRaw, officerLevelRaw] = key.split(':');
            const nationId = Number(nationIdRaw);
            const officerLevel = Number(officerLevelRaw);
            const turns = this.getNationTurns(nationId, officerLevel);
            await this.prisma.nationTurn.deleteMany({
                where: { nationId, officerLevel },
            });
            await this.prisma.nationTurn.createMany({
                data: turns.map((entry, turnIdx) => ({
                    nationId,
                    officerLevel,
                    turnIdx,
                    actionCode: normalizeAction(entry.action),
                    arg: asJson(normalizeArgs(entry.args)),
                })),
            });
        }

        this.dirtyGeneralIds.clear();
        this.dirtyNationKeys.clear();
    }
}

export const createReservedTurnStore = async (options: ReservedTurnStoreOptions): Promise<ReservedTurnStoreHandle> => {
    const connector = createGamePostgresConnector({ url: options.databaseUrl });
    await connector.connect();
    const store = new InMemoryReservedTurnStore(connector.prisma, {
        maxGeneralTurns: options.maxGeneralTurns ?? DEFAULT_GENERAL_TURNS,
        maxNationTurns: options.maxNationTurns ?? DEFAULT_NATION_TURNS,
    });
    await store.loadAll();
    return {
        store,
        close: () => connector.disconnect(),
    };
};
