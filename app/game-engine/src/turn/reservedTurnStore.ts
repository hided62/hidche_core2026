import { createGamePostgresConnector, type InputJsonValue, type TurnEngineDatabaseClient } from '@sammo-ts/infra';
import { isRecord } from '@sammo-ts/common';
import { randomUUID } from 'node:crypto';

export interface ReservedTurnEntry {
    action: string;
    args: Record<string, unknown>;
}

export interface ReservedTurnStoreOptions {
    databaseUrl: string;
    maxGeneralTurns?: number;
    maxNationTurns?: number;
    leaseOwner?: string;
    leaseDurationMs?: number;
}

export interface ReservedTurnStoreHandle {
    store: InMemoryReservedTurnStore;
    close(): Promise<void>;
}

const DEFAULT_TURN_ACTION = '휴식';
const DEFAULT_GENERAL_TURNS = 30;
const DEFAULT_NATION_TURNS = 12;
const DEFAULT_LEASE_DURATION_MS = 5 * 60_000;

const asJson = (value: unknown): InputJsonValue => value as InputJsonValue;

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

type ReservedTurnDatabaseClient = Pick<TurnEngineDatabaseClient, 'generalTurn' | 'nationTurn'> & {
    generalTurnRevision?: Pick<
        NonNullable<TurnEngineDatabaseClient['generalTurnRevision']>,
        'findUnique' | 'createMany' | 'updateMany'
    >;
    nationTurnRevision?: Pick<
        NonNullable<TurnEngineDatabaseClient['nationTurnRevision']>,
        'findUnique' | 'createMany' | 'updateMany'
    >;
};

export interface ReservedTurnChanges {
    generalIds: number[];
    generalInitializationIds: number[];
    generalLeaseIds: number[];
    nationKeys: string[];
    nationInitializationKeys: string[];
    nationLeaseKeys: string[];
}

export interface InMemoryReservedTurnStateSnapshot {
    generalTurns: Array<[number, ReservedTurnEntry[]]>;
    nationTurns: Array<[string, ReservedTurnEntry[]]>;
    dirtyGeneralIds: number[];
    dirtyNationKeys: string[];
    pendingGeneralInitializationIds: number[];
    pendingNationInitializationKeys: string[];
    leasedGeneralIds: number[];
    leasedNationKeys: string[];
}

export class ReservedTurnLeaseConflictError extends Error {
    constructor(readonly queueKey: string) {
        super(`Reserved turn queue lease conflict: ${queueKey}.`);
        this.name = 'ReservedTurnLeaseConflictError';
    }
}

export class InMemoryReservedTurnStore {
    private readonly generalTurns = new Map<number, ReservedTurnEntry[]>();
    private readonly nationTurns = new Map<string, ReservedTurnEntry[]>();
    private readonly dirtyGeneralIds = new Set<number>();
    private readonly dirtyNationKeys = new Set<string>();
    private readonly pendingGeneralInitializationIds = new Set<number>();
    private readonly pendingNationInitializationKeys = new Set<string>();
    private readonly leasedGeneralIds = new Set<number>();
    private readonly leasedNationKeys = new Set<string>();
    private readonly maxGeneralTurns: number;
    private readonly maxNationTurns: number;
    private readonly leaseOwner: string;
    private readonly leaseDurationMs: number;

    constructor(
        private readonly prisma: ReservedTurnDatabaseClient,
        options: {
            maxGeneralTurns: number;
            maxNationTurns: number;
            leaseOwner?: string;
            leaseDurationMs?: number;
        }
    ) {
        this.maxGeneralTurns = options.maxGeneralTurns;
        this.maxNationTurns = options.maxNationTurns;
        this.leaseOwner = options.leaseOwner ?? randomUUID();
        this.leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    }

    captureState(): InMemoryReservedTurnStateSnapshot {
        return structuredClone({
            generalTurns: Array.from(this.generalTurns.entries()),
            nationTurns: Array.from(this.nationTurns.entries()),
            dirtyGeneralIds: Array.from(this.dirtyGeneralIds),
            dirtyNationKeys: Array.from(this.dirtyNationKeys),
            pendingGeneralInitializationIds: Array.from(this.pendingGeneralInitializationIds),
            pendingNationInitializationKeys: Array.from(this.pendingNationInitializationKeys),
            leasedGeneralIds: Array.from(this.leasedGeneralIds),
            leasedNationKeys: Array.from(this.leasedNationKeys),
        } satisfies InMemoryReservedTurnStateSnapshot);
    }

    /**
     * Hot-path transaction savepoint. Queue mutations replace complete turn
     * arrays and journal sets instead of mutating captured entries in place,
     * so retaining those immutable references is sufficient for rollback.
     * Public inspection snapshots remain deep clones via captureState().
     */
    captureTransactionState(): InMemoryReservedTurnStateSnapshot {
        return {
            generalTurns: Array.from(this.generalTurns.entries()),
            nationTurns: Array.from(this.nationTurns.entries()),
            dirtyGeneralIds: Array.from(this.dirtyGeneralIds),
            dirtyNationKeys: Array.from(this.dirtyNationKeys),
            pendingGeneralInitializationIds: Array.from(this.pendingGeneralInitializationIds),
            pendingNationInitializationKeys: Array.from(this.pendingNationInitializationKeys),
            leasedGeneralIds: Array.from(this.leasedGeneralIds),
            leasedNationKeys: Array.from(this.leasedNationKeys),
        };
    }

    restoreState(snapshot: InMemoryReservedTurnStateSnapshot): void {
        const restored = structuredClone(snapshot);
        this.replaceMap(this.generalTurns, restored.generalTurns);
        this.replaceMap(this.nationTurns, restored.nationTurns);
        this.replaceSet(this.dirtyGeneralIds, restored.dirtyGeneralIds);
        this.replaceSet(this.dirtyNationKeys, restored.dirtyNationKeys);
        this.replaceSet(this.pendingGeneralInitializationIds, restored.pendingGeneralInitializationIds);
        this.replaceSet(this.pendingNationInitializationKeys, restored.pendingNationInitializationKeys);
        this.replaceSet(this.leasedGeneralIds, restored.leasedGeneralIds);
        this.replaceSet(this.leasedNationKeys, restored.leasedNationKeys);
    }

    inspectState(): InMemoryReservedTurnStateSnapshot {
        return this.captureState();
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

    private replaceMap<K, V>(target: Map<K, V>, entries: Array<[K, V]>): void {
        target.clear();
        for (const [key, value] of entries) {
            target.set(key, value);
        }
    }

    private replaceSet<T>(target: Set<T>, values: T[]): void {
        target.clear();
        for (const value of values) {
            target.add(value);
        }
    }

    private getLeaseExpiresAt(): Date {
        return new Date(Date.now() + this.leaseDurationMs);
    }

    private async acquireGeneralLease(generalId: number): Promise<void> {
        const revisionStore = this.prisma.generalTurnRevision;
        if (!revisionStore) {
            return;
        }
        const now = new Date();
        const leaseExpiresAt = this.getLeaseExpiresAt();
        let claimed = await revisionStore.updateMany({
            where: {
                generalId,
                OR: [{ leaseOwner: this.leaseOwner }, { leaseOwner: null }, { leaseExpiresAt: { lte: now } }],
            },
            data: {
                leaseOwner: this.leaseOwner,
                leaseExpiresAt,
            },
        });
        if (claimed.count === 0) {
            claimed = await revisionStore.createMany({
                data: [{ generalId, revision: 0, leaseOwner: this.leaseOwner, leaseExpiresAt }],
                skipDuplicates: true,
            });
            if (claimed.count === 0) {
                claimed = await revisionStore.updateMany({
                    where: {
                        generalId,
                        OR: [{ leaseOwner: this.leaseOwner }, { leaseOwner: null }, { leaseExpiresAt: { lte: now } }],
                    },
                    data: {
                        leaseOwner: this.leaseOwner,
                        leaseExpiresAt,
                    },
                });
            }
        }
        if (claimed.count !== 1) {
            throw new ReservedTurnLeaseConflictError(`general:${generalId}`);
        }
        this.leasedGeneralIds.add(generalId);
    }

    private async acquireNationLease(nationId: number, officerLevel: number): Promise<void> {
        const revisionStore = this.prisma.nationTurnRevision;
        if (!revisionStore) {
            return;
        }
        const now = new Date();
        const leaseExpiresAt = this.getLeaseExpiresAt();
        let claimed = await revisionStore.updateMany({
            where: {
                nationId,
                officerLevel,
                OR: [{ leaseOwner: this.leaseOwner }, { leaseOwner: null }, { leaseExpiresAt: { lte: now } }],
            },
            data: {
                leaseOwner: this.leaseOwner,
                leaseExpiresAt,
            },
        });
        if (claimed.count === 0) {
            claimed = await revisionStore.createMany({
                data: [{ nationId, officerLevel, revision: 0, leaseOwner: this.leaseOwner, leaseExpiresAt }],
                skipDuplicates: true,
            });
            if (claimed.count === 0) {
                claimed = await revisionStore.updateMany({
                    where: {
                        nationId,
                        officerLevel,
                        OR: [{ leaseOwner: this.leaseOwner }, { leaseOwner: null }, { leaseExpiresAt: { lte: now } }],
                    },
                    data: {
                        leaseOwner: this.leaseOwner,
                        leaseExpiresAt,
                    },
                });
            }
        }
        if (claimed.count !== 1) {
            throw new ReservedTurnLeaseConflictError(`nation:${nationId}:${officerLevel}`);
        }
        this.leasedNationKeys.add(buildNationKey(nationId, officerLevel));
    }

    private async releaseGeneralLease(generalId: number): Promise<void> {
        await this.prisma.generalTurnRevision?.updateMany({
            where: { generalId, leaseOwner: this.leaseOwner },
            data: { leaseOwner: null, leaseExpiresAt: null },
        });
        this.leasedGeneralIds.delete(generalId);
    }

    private async releaseNationLease(nationId: number, officerLevel: number): Promise<void> {
        await this.prisma.nationTurnRevision?.updateMany({
            where: { nationId, officerLevel, leaseOwner: this.leaseOwner },
            data: { leaseOwner: null, leaseExpiresAt: null },
        });
        this.leasedNationKeys.delete(buildNationKey(nationId, officerLevel));
    }

    async prepareTurnsForExecution(
        generalId: number,
        nation?: { nationId: number; officerLevel: number }
    ): Promise<void> {
        const hadGeneralLease = this.leasedGeneralIds.has(generalId);
        const nationKey = nation ? buildNationKey(nation.nationId, nation.officerLevel) : null;
        const hadNationLease = nationKey ? this.leasedNationKeys.has(nationKey) : false;
        try {
            await this.acquireGeneralLease(generalId);
            if (nation) {
                await this.acquireNationLease(nation.nationId, nation.officerLevel);
            }
            await Promise.all([
                // A newly acquired lease starts a fresh API/daemon ownership boundary.
                // Re-read PostgreSQL even if a prior run left a stale dirty marker;
                // repeated access under the same held lease keeps local mutations.
                this.refreshGeneralTurns(generalId, !hadGeneralLease),
                nation ? this.refreshNationTurns(nation.nationId, nation.officerLevel) : Promise.resolve(),
            ]);
        } catch (error) {
            if (nation && nationKey !== null && !hadNationLease && this.leasedNationKeys.has(nationKey)) {
                await this.releaseNationLease(nation.nationId, nation.officerLevel);
            }
            if (!hadGeneralLease && this.leasedGeneralIds.has(generalId)) {
                await this.releaseGeneralLease(generalId);
            }
            throw error;
        }
    }

    async refreshGeneralTurns(generalId: number, force = false): Promise<void> {
        if (!force && this.dirtyGeneralIds.has(generalId)) {
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
        if (this.dirtyNationKeys.has(key) || this.pendingNationInitializationKeys.has(key)) {
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

    ensureGeneralTurns(generalId: number): void {
        this.getGeneralTurns(generalId);
        this.pendingGeneralInitializationIds.add(generalId);
    }

    replaceGeneralTurns(generalId: number, entry: ReservedTurnEntry): void {
        this.generalTurns.set(
            generalId,
            Array.from({ length: this.maxGeneralTurns }, () => ({
                action: normalizeAction(entry.action),
                args: normalizeArgs(entry.args),
            }))
        );
        this.pendingGeneralInitializationIds.delete(generalId);
        this.dirtyGeneralIds.add(generalId);
    }

    setGeneralTurn(generalId: number, turnIdx: number, entry: ReservedTurnEntry): void {
        if (turnIdx < 0 || turnIdx >= this.maxGeneralTurns) {
            return;
        }
        const turns = this.getGeneralTurns(generalId).slice();
        turns[turnIdx] = {
            action: normalizeAction(entry.action),
            args: normalizeArgs(entry.args),
        };
        this.generalTurns.set(generalId, turns);
        this.pendingGeneralInitializationIds.delete(generalId);
        this.dirtyGeneralIds.add(generalId);
    }

    ensureNationTurns(nationId: number, officerLevel: number): void {
        const key = buildNationKey(nationId, officerLevel);
        this.getNationTurns(nationId, officerLevel);
        this.pendingNationInitializationKeys.add(key);
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

    peekDirtyState(): ReservedTurnChanges {
        return {
            generalIds: Array.from(this.dirtyGeneralIds),
            generalInitializationIds: Array.from(this.pendingGeneralInitializationIds),
            generalLeaseIds: Array.from(this.leasedGeneralIds),
            nationKeys: Array.from(this.dirtyNationKeys),
            nationInitializationKeys: Array.from(this.pendingNationInitializationKeys),
            nationLeaseKeys: Array.from(this.leasedNationKeys),
        };
    }

    acknowledgeDirtyState(changes: ReservedTurnChanges): void {
        for (const generalId of changes.generalIds) {
            this.dirtyGeneralIds.delete(generalId);
        }
        for (const generalId of changes.generalInitializationIds) {
            this.pendingGeneralInitializationIds.delete(generalId);
        }
        for (const generalId of changes.generalLeaseIds) {
            this.leasedGeneralIds.delete(generalId);
        }
        for (const key of changes.nationKeys) {
            this.dirtyNationKeys.delete(key);
        }
        for (const key of changes.nationInitializationKeys) {
            this.pendingNationInitializationKeys.delete(key);
        }
        for (const key of changes.nationLeaseKeys) {
            this.leasedNationKeys.delete(key);
        }
    }

    private async claimGeneralFlushLease(prisma: ReservedTurnDatabaseClient, generalId: number): Promise<boolean> {
        const revisionStore = prisma.generalTurnRevision;
        if (!revisionStore) {
            return false;
        }
        const leaseExpiresAt = this.getLeaseExpiresAt();
        const where = this.leasedGeneralIds.has(generalId)
            ? { generalId, leaseOwner: this.leaseOwner }
            : {
                  generalId,
                  OR: [{ leaseOwner: this.leaseOwner }, { leaseOwner: null }, { leaseExpiresAt: { lte: new Date() } }],
              };
        let claimed = await revisionStore.updateMany({
            where,
            data: {
                leaseOwner: this.leaseOwner,
                leaseExpiresAt,
            },
        });
        if (claimed.count === 0 && !this.leasedGeneralIds.has(generalId)) {
            claimed = await revisionStore.createMany({
                data: [{ generalId, revision: 0, leaseOwner: this.leaseOwner, leaseExpiresAt }],
                skipDuplicates: true,
            });
            if (claimed.count === 0) {
                claimed = await revisionStore.updateMany({
                    where,
                    data: {
                        leaseOwner: this.leaseOwner,
                        leaseExpiresAt,
                    },
                });
            }
        }
        if (claimed.count !== 1) {
            throw new ReservedTurnLeaseConflictError(`general:${generalId}`);
        }
        return true;
    }

    private async finalizeGeneralFlush(
        prisma: ReservedTurnDatabaseClient,
        generalId: number,
        claimedLease: boolean
    ): Promise<void> {
        const revisionStore = prisma.generalTurnRevision;
        if (!revisionStore) {
            return;
        }
        if (!claimedLease) {
            throw new ReservedTurnLeaseConflictError(`general:${generalId}`);
        }
        const finalized = await revisionStore.updateMany({
            where: { generalId, leaseOwner: this.leaseOwner },
            data: {
                revision: { increment: 1 },
                leaseOwner: null,
                leaseExpiresAt: null,
            },
        });
        if (finalized.count !== 1) {
            throw new ReservedTurnLeaseConflictError(`general:${generalId}`);
        }
    }

    private async claimNationFlushLease(
        prisma: ReservedTurnDatabaseClient,
        nationId: number,
        officerLevel: number
    ): Promise<boolean> {
        const revisionStore = prisma.nationTurnRevision;
        const key = buildNationKey(nationId, officerLevel);
        if (!revisionStore) {
            return false;
        }
        const leaseExpiresAt = this.getLeaseExpiresAt();
        const where = this.leasedNationKeys.has(key)
            ? { nationId, officerLevel, leaseOwner: this.leaseOwner }
            : {
                  nationId,
                  officerLevel,
                  OR: [{ leaseOwner: this.leaseOwner }, { leaseOwner: null }, { leaseExpiresAt: { lte: new Date() } }],
              };
        let claimed = await revisionStore.updateMany({
            where,
            data: {
                leaseOwner: this.leaseOwner,
                leaseExpiresAt,
            },
        });
        if (claimed.count === 0 && !this.leasedNationKeys.has(key)) {
            claimed = await revisionStore.createMany({
                data: [{ nationId, officerLevel, revision: 0, leaseOwner: this.leaseOwner, leaseExpiresAt }],
                skipDuplicates: true,
            });
            if (claimed.count === 0) {
                claimed = await revisionStore.updateMany({
                    where,
                    data: {
                        leaseOwner: this.leaseOwner,
                        leaseExpiresAt,
                    },
                });
            }
        }
        if (claimed.count !== 1) {
            throw new ReservedTurnLeaseConflictError(`nation:${nationId}:${officerLevel}`);
        }
        return true;
    }

    private async finalizeNationFlush(
        prisma: ReservedTurnDatabaseClient,
        nationId: number,
        officerLevel: number,
        claimedLease: boolean
    ): Promise<void> {
        const revisionStore = prisma.nationTurnRevision;
        if (!revisionStore) {
            return;
        }
        if (!claimedLease) {
            throw new ReservedTurnLeaseConflictError(`nation:${nationId}:${officerLevel}`);
        }
        const finalized = await revisionStore.updateMany({
            where: { nationId, officerLevel, leaseOwner: this.leaseOwner },
            data: {
                revision: { increment: 1 },
                leaseOwner: null,
                leaseExpiresAt: null,
            },
        });
        if (finalized.count !== 1) {
            throw new ReservedTurnLeaseConflictError(`nation:${nationId}:${officerLevel}`);
        }
    }

    async persistChanges(prisma: ReservedTurnDatabaseClient, changes: ReservedTurnChanges): Promise<void> {
        for (const generalId of changes.generalIds) {
            const turns = this.getGeneralTurns(generalId);
            const claimedLease = await this.claimGeneralFlushLease(prisma, generalId);
            await prisma.generalTurn.deleteMany({ where: { generalId } });
            await prisma.generalTurn.createMany({
                data: turns.map((entry, turnIdx) => ({
                    generalId,
                    turnIdx,
                    actionCode: normalizeAction(entry.action),
                    arg: asJson(normalizeArgs(entry.args)),
                })),
            });
            await this.finalizeGeneralFlush(prisma, generalId, claimedLease);
        }

        for (const generalId of changes.generalInitializationIds) {
            if (changes.generalIds.includes(generalId)) {
                continue;
            }
            const turns = this.getGeneralTurns(generalId);
            await prisma.generalTurn.createMany({
                data: turns.map((entry, turnIdx) => ({
                    generalId,
                    turnIdx,
                    actionCode: normalizeAction(entry.action),
                    arg: asJson(normalizeArgs(entry.args)),
                })),
                skipDuplicates: true,
            });
        }

        for (const key of changes.nationKeys) {
            const [nationIdRaw, officerLevelRaw] = key.split(':');
            const nationId = Number(nationIdRaw);
            const officerLevel = Number(officerLevelRaw);
            const turns = this.getNationTurns(nationId, officerLevel);
            const claimedLease = await this.claimNationFlushLease(prisma, nationId, officerLevel);
            await prisma.nationTurn.deleteMany({
                where: { nationId, officerLevel },
            });
            await prisma.nationTurn.createMany({
                data: turns.map((entry, turnIdx) => ({
                    nationId,
                    officerLevel,
                    turnIdx,
                    actionCode: normalizeAction(entry.action),
                    arg: asJson(normalizeArgs(entry.args)),
                })),
            });
            await this.finalizeNationFlush(prisma, nationId, officerLevel, claimedLease);
        }

        for (const key of changes.nationInitializationKeys) {
            if (changes.nationKeys.includes(key)) {
                continue;
            }
            const [nationIdRaw, officerLevelRaw] = key.split(':');
            const nationId = Number(nationIdRaw);
            const officerLevel = Number(officerLevelRaw);
            const turns = this.getNationTurns(nationId, officerLevel);
            await prisma.nationTurn.createMany({
                data: turns.map((entry, turnIdx) => ({
                    nationId,
                    officerLevel,
                    turnIdx,
                    actionCode: normalizeAction(entry.action),
                    arg: asJson(normalizeArgs(entry.args)),
                })),
                skipDuplicates: true,
            });
        }

        for (const generalId of changes.generalLeaseIds) {
            if (changes.generalIds.includes(generalId)) {
                continue;
            }
            await prisma.generalTurnRevision?.updateMany({
                where: { generalId, leaseOwner: this.leaseOwner },
                data: { leaseOwner: null, leaseExpiresAt: null },
            });
        }

        for (const key of changes.nationLeaseKeys) {
            if (changes.nationKeys.includes(key)) {
                continue;
            }
            const [nationIdRaw, officerLevelRaw] = key.split(':');
            await prisma.nationTurnRevision?.updateMany({
                where: {
                    nationId: Number(nationIdRaw),
                    officerLevel: Number(officerLevelRaw),
                    leaseOwner: this.leaseOwner,
                },
                data: { leaseOwner: null, leaseExpiresAt: null },
            });
        }
    }

    async flushChanges(): Promise<void> {
        const changes = this.peekDirtyState();
        await this.persistChanges(this.prisma, changes);
        this.acknowledgeDirtyState(changes);
    }
}

export const createReservedTurnStore = async (options: ReservedTurnStoreOptions): Promise<ReservedTurnStoreHandle> => {
    const connector = createGamePostgresConnector({ url: options.databaseUrl });
    await connector.connect();
    const store = new InMemoryReservedTurnStore(connector.prisma, {
        maxGeneralTurns: options.maxGeneralTurns ?? DEFAULT_GENERAL_TURNS,
        maxNationTurns: options.maxNationTurns ?? DEFAULT_NATION_TURNS,
        leaseOwner: options.leaseOwner,
        leaseDurationMs: options.leaseDurationMs,
    });
    await store.loadAll();
    return {
        store,
        close: () => connector.disconnect(),
    };
};
