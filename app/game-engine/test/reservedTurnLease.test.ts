import { describe, expect, it, vi } from 'vitest';
import { asRecord } from '@sammo-ts/common';

import { InMemoryReservedTurnStore, ReservedTurnLeaseConflictError } from '../src/turn/reservedTurnStore.js';

interface RevisionRow {
    revision: number;
    leaseOwner: string | null;
    leaseExpiresAt: Date | null;
}

const buildHarness = (initialRevision: RevisionRow | null = null) => {
    let revision = initialRevision;
    let nationRevision: RevisionRow | null = null;
    const writtenTurns: unknown[] = [];
    const generalFindMany = vi.fn(async () => [
        {
            id: 1,
            generalId: 7,
            turnIdx: 0,
            actionCode: 'che_훈련',
            arg: {},
            createdAt: new Date(),
        },
    ]);
    const generalDeleteMany = vi.fn(async () => ({ count: 1 }));
    const generalCreateMany = vi.fn(async (args: unknown) => {
        writtenTurns.push(args);
        return { count: 2 };
    });
    const updateMany = vi.fn(async (rawArgs: unknown) => {
        const args = asRecord(rawArgs);
        const where = asRecord(args.where);
        const data = asRecord(args.data);
        if (!revision) {
            return { count: 0 };
        }
        if (typeof where.generalId === 'number' && where.generalId !== 7) {
            return { count: 0 };
        }
        if (typeof where.leaseOwner === 'string' && where.leaseOwner !== revision.leaseOwner) {
            return { count: 0 };
        }
        if (Array.isArray(where.OR)) {
            const now = new Date();
            const eligible =
                revision.leaseOwner === null ||
                revision.leaseOwner === 'daemon-1' ||
                (revision.leaseExpiresAt !== null && revision.leaseExpiresAt.getTime() <= now.getTime());
            if (!eligible) {
                return { count: 0 };
            }
        }
        const revisionChange = asRecord(data.revision);
        if (typeof revisionChange.increment === 'number') {
            revision.revision += revisionChange.increment;
        }
        if ('leaseOwner' in data) {
            revision.leaseOwner = typeof data.leaseOwner === 'string' ? data.leaseOwner : null;
        }
        if ('leaseExpiresAt' in data) {
            revision.leaseExpiresAt = data.leaseExpiresAt instanceof Date ? data.leaseExpiresAt : null;
        }
        return { count: 1 };
    });
    const createMany = vi.fn(async (rawArgs: unknown) => {
        if (revision) {
            return { count: 0 };
        }
        const args = asRecord(rawArgs);
        const rows = Array.isArray(args.data) ? args.data : [];
        const data = asRecord(rows[0]);
        revision = {
            revision: typeof data.revision === 'number' ? data.revision : 0,
            leaseOwner: typeof data.leaseOwner === 'string' ? data.leaseOwner : null,
            leaseExpiresAt: data.leaseExpiresAt instanceof Date ? data.leaseExpiresAt : null,
        };
        return { count: 1 };
    });
    const nationRevisionUpdateMany = vi.fn(async (rawArgs: unknown) => {
        const args = asRecord(rawArgs);
        const where = asRecord(args.where);
        const data = asRecord(args.data);
        if (!nationRevision) {
            return { count: 0 };
        }
        if (typeof where.leaseOwner === 'string' && where.leaseOwner !== nationRevision.leaseOwner) {
            return { count: 0 };
        }
        const revisionChange = asRecord(data.revision);
        if (typeof revisionChange.increment === 'number') {
            nationRevision.revision += revisionChange.increment;
        }
        if ('leaseOwner' in data) {
            nationRevision.leaseOwner = typeof data.leaseOwner === 'string' ? data.leaseOwner : null;
        }
        if ('leaseExpiresAt' in data) {
            nationRevision.leaseExpiresAt = data.leaseExpiresAt instanceof Date ? data.leaseExpiresAt : null;
        }
        return { count: 1 };
    });
    const nationRevisionCreateMany = vi.fn(async (rawArgs: unknown) => {
        if (nationRevision) {
            return { count: 0 };
        }
        const args = asRecord(rawArgs);
        const rows = Array.isArray(args.data) ? args.data : [];
        const data = asRecord(rows[0]);
        nationRevision = {
            revision: typeof data.revision === 'number' ? data.revision : 0,
            leaseOwner: typeof data.leaseOwner === 'string' ? data.leaseOwner : null,
            leaseExpiresAt: data.leaseExpiresAt instanceof Date ? data.leaseExpiresAt : null,
        };
        return { count: 1 };
    });
    const prisma = {
        generalTurn: {
            findMany: generalFindMany,
            deleteMany: generalDeleteMany,
            createMany: generalCreateMany,
        },
        generalTurnRevision: {
            findUnique: vi.fn(async () => revision),
            createMany,
            updateMany,
        },
        nationTurn: {
            findMany: vi.fn(async () => [
                {
                    id: 1,
                    nationId: 3,
                    officerLevel: 12,
                    turnIdx: 0,
                    actionCode: 'che_포상',
                    arg: {},
                    createdAt: new Date(),
                },
            ]),
            deleteMany: vi.fn(async () => ({ count: 0 })),
            createMany: vi.fn(async () => ({ count: 0 })),
        },
        nationTurnRevision: {
            findUnique: vi.fn(async () => nationRevision),
            createMany: nationRevisionCreateMany,
            updateMany: nationRevisionUpdateMany,
        },
    };
    const store = new InMemoryReservedTurnStore(prisma, {
        maxGeneralTurns: 2,
        maxNationTurns: 1,
        leaseOwner: 'daemon-1',
        leaseDurationMs: 60_000,
    });
    return {
        store,
        prisma,
        generalFindMany,
        generalDeleteMany,
        generalCreateMany,
        writtenTurns,
        getRevision: () => revision,
        getNationRevision: () => nationRevision,
        stealLease: () => {
            if (revision) {
                revision.leaseOwner = 'other-writer';
            }
        },
    };
};

describe('reserved turn daemon lease', () => {
    it('prunes deleted general and nation queues together with their journal state', () => {
        const harness = buildHarness();
        harness.store.ensureGeneralTurns(7);
        harness.store.ensureGeneralTurns(8);
        harness.store.ensureNationTurns(3, 12);
        harness.store.ensureNationTurns(4, 12);

        expect(harness.store.getQueueCounts()).toMatchObject({
            generalQueues: 2,
            nationQueues: 2,
            pendingGeneralInitializations: 2,
            pendingNationInitializations: 2,
        });
        expect(harness.store.pruneDeletedEntityQueues([7], [3])).toEqual({
            generalQueues: 1,
            nationQueues: 1,
        });
        expect(harness.store.getQueueCounts()).toMatchObject({
            generalQueues: 1,
            nationQueues: 1,
            pendingGeneralInitializations: 1,
            pendingNationInitializations: 1,
        });
        expect(harness.store.getGeneralTurns(8)).toHaveLength(2);
        expect(harness.store.getNationTurns(4, 12)).toHaveLength(1);
    });

    it('restores pruned queues from the transaction savepoint', () => {
        const harness = buildHarness();
        harness.store.ensureGeneralTurns(7);
        harness.store.ensureNationTurns(3, 12);
        const savepoint = harness.store.captureTransactionState();

        harness.store.pruneDeletedEntityQueues([7], [3]);
        expect(harness.store.getQueueCounts()).toMatchObject({ generalQueues: 0, nationQueues: 0 });

        harness.store.restoreState(savepoint);
        expect(harness.store.getQueueCounts()).toMatchObject({
            generalQueues: 1,
            nationQueues: 1,
            pendingGeneralInitializations: 1,
            pendingNationInitializations: 1,
        });
    });

    it('holds the queue lease from refresh through shift and releases it with the revision increment', async () => {
        const harness = buildHarness();

        await harness.store.prepareTurnsForExecution(7);
        expect(harness.getRevision()).toMatchObject({ revision: 0, leaseOwner: 'daemon-1' });
        expect(harness.store.getGeneralTurn(7, 0).action).toBe('che_훈련');

        harness.store.shiftGeneralTurns(7, -1);
        const changes = harness.store.peekDirtyState();
        expect(changes).toMatchObject({ generalIds: [7], generalLeaseIds: [7] });
        await harness.store.persistChanges(harness.prisma, changes);
        harness.store.acknowledgeDirtyState(changes);

        expect(harness.getRevision()).toMatchObject({
            revision: 1,
            leaseOwner: null,
            leaseExpiresAt: null,
        });
        expect(harness.generalDeleteMany).toHaveBeenCalledOnce();
        expect(harness.generalCreateMany).toHaveBeenCalledOnce();
        expect(harness.store.peekDirtyState()).toEqual({
            generalIds: [],
            generalInitializationIds: [],
            generalLeaseIds: [],
            nationKeys: [],
            nationInitializationKeys: [],
            nationLeaseKeys: [],
        });
    });

    it('refreshes after a durable flush whose in-memory lease acknowledgement was interrupted', async () => {
        const harness = buildHarness();
        await harness.store.prepareTurnsForExecution(7);
        harness.store.shiftGeneralTurns(7, -1);
        const changes = harness.store.peekDirtyState();
        await harness.store.persistChanges(harness.prisma, changes);

        expect(harness.store.getGeneralTurn(7, 0).action).toBe('휴식');
        expect(harness.store.peekDirtyState()).toMatchObject({ generalIds: [7], generalLeaseIds: [7] });
        expect(harness.getRevision()).toMatchObject({ revision: 1, leaseOwner: null });

        await harness.store.prepareTurnsForExecution(7);
        expect(harness.store.getGeneralTurn(7, 0).action).toBe('che_훈련');
        expect(harness.generalFindMany).toHaveBeenCalledTimes(2);
    });

    it('re-reads a general queue while retaining its execution lease', async () => {
        const harness = buildHarness();
        await harness.store.prepareTurnsForExecution(7);
        harness.store.shiftGeneralTurns(7, -1);

        expect(harness.getRevision()).toMatchObject({ leaseOwner: 'daemon-1' });
        expect(harness.store.getGeneralTurn(7, 0).action).toBe('휴식');

        await harness.store.prepareTurnsForExecution(7);

        expect(harness.store.getGeneralTurn(7, 0).action).toBe('che_훈련');
        expect(harness.generalFindMany).toHaveBeenCalledTimes(2);
    });

    it('rejects an active foreign lease before reading the queue', async () => {
        const harness = buildHarness({
            revision: 4,
            leaseOwner: 'api-writer',
            leaseExpiresAt: new Date(Date.now() + 60_000),
        });

        await expect(harness.store.prepareTurnsForExecution(7)).rejects.toBeInstanceOf(ReservedTurnLeaseConflictError);
        expect(harness.generalFindMany).not.toHaveBeenCalled();
    });

    it('takes over an expired foreign lease before reading the queue', async () => {
        const harness = buildHarness({
            revision: 4,
            leaseOwner: 'stopped-daemon',
            leaseExpiresAt: new Date(Date.now() - 1_000),
        });

        await harness.store.prepareTurnsForExecution(7);

        expect(harness.getRevision()).toMatchObject({
            revision: 4,
            leaseOwner: 'daemon-1',
        });
        expect(harness.generalFindMany).toHaveBeenCalledOnce();
    });

    it('leases and releases the matching nation officer queue with the general queue', async () => {
        const harness = buildHarness();

        await harness.store.prepareTurnsForExecution(7, { nationId: 3, officerLevel: 12 });
        expect(harness.getRevision()).toMatchObject({ revision: 0, leaseOwner: 'daemon-1' });
        expect(harness.getNationRevision()).toMatchObject({ revision: 0, leaseOwner: 'daemon-1' });

        harness.store.shiftNationTurns(3, 12, -1);
        const changes = harness.store.peekDirtyState();
        expect(changes).toMatchObject({
            generalLeaseIds: [7],
            nationKeys: ['3:12'],
            nationLeaseKeys: ['3:12'],
        });
        await harness.store.persistChanges(harness.prisma, changes);
        harness.store.acknowledgeDirtyState(changes);

        expect(harness.getRevision()).toMatchObject({ revision: 0, leaseOwner: null });
        expect(harness.getNationRevision()).toMatchObject({ revision: 1, leaseOwner: null });
    });

    it('detects a lost lease before deleting or replacing turns', async () => {
        const harness = buildHarness();
        await harness.store.prepareTurnsForExecution(7);
        harness.store.shiftGeneralTurns(7, -1);
        harness.stealLease();
        const changes = harness.store.peekDirtyState();

        await expect(harness.store.persistChanges(harness.prisma, changes)).rejects.toBeInstanceOf(
            ReservedTurnLeaseConflictError
        );
        expect(harness.generalDeleteMany).not.toHaveBeenCalled();
        expect(harness.generalCreateMany).not.toHaveBeenCalled();
        expect(harness.store.peekDirtyState()).toMatchObject({
            generalIds: [7],
            generalLeaseIds: [7],
        });
    });

    it('blocks a daemon-side queue replacement behind an active foreign lease', async () => {
        const harness = buildHarness({
            revision: 6,
            leaseOwner: 'api-writer',
            leaseExpiresAt: new Date(Date.now() + 60_000),
        });
        harness.store.replaceGeneralTurns(7, { action: 'che_훈련', args: {} });
        const changes = harness.store.peekDirtyState();

        await expect(harness.store.persistChanges(harness.prisma, changes)).rejects.toBeInstanceOf(
            ReservedTurnLeaseConflictError
        );
        expect(harness.generalDeleteMany).not.toHaveBeenCalled();
        expect(harness.generalCreateMany).not.toHaveBeenCalled();
    });
});
