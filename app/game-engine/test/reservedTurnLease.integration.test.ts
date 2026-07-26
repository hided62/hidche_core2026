import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector } from '@sammo-ts/infra';

import {
    InMemoryReservedTurnStore,
    ReservedTurnLeaseConflictError,
} from '../src/turn/reservedTurnStore.js';

const databaseUrl = process.env.RESERVED_TURN_DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;
const GENERAL_ID = 2_147_400_002;

describeIntegration('reserved turn daemon/API lease integration', () => {
    const connector = databaseUrl ? createGamePostgresConnector({ url: databaseUrl }) : null;

    beforeAll(async () => {
        if (!connector) {
            return;
        }
        await connector.connect();
        await connector.prisma.generalTurn.deleteMany({ where: { generalId: GENERAL_ID } });
        await connector.prisma.generalTurnRevision.deleteMany({ where: { generalId: GENERAL_ID } });
        await connector.prisma.generalTurn.createMany({
            data: [
                { generalId: GENERAL_ID, turnIdx: 0, actionCode: 'che_훈련', arg: {} },
                { generalId: GENERAL_ID, turnIdx: 1, actionCode: 'che_사기진작', arg: {} },
            ],
        });
    });

    afterAll(async () => {
        if (!connector) {
            return;
        }
        await connector.prisma.generalTurn.deleteMany({ where: { generalId: GENERAL_ID } });
        await connector.prisma.generalTurnRevision.deleteMany({ where: { generalId: GENERAL_ID } });
        await connector.disconnect();
    });

    it('blocks the API CAS during execution and releases the lease atomically with the shifted queue', async () => {
        if (!connector) {
            throw new Error('integration connector is unavailable');
        }
        const store = new InMemoryReservedTurnStore(connector.prisma, {
            maxGeneralTurns: 2,
            maxNationTurns: 1,
            leaseOwner: 'integration-daemon',
            leaseDurationMs: 60_000,
        });

        await store.prepareTurnsForExecution(GENERAL_ID);
        const leased = await connector.prisma.generalTurnRevision.findUniqueOrThrow({
            where: { generalId: GENERAL_ID },
        });
        expect(leased).toMatchObject({ revision: 0, leaseOwner: 'integration-daemon' });

        const blockedApiClaim = await connector.prisma.generalTurnRevision.updateMany({
            where: {
                generalId: GENERAL_ID,
                revision: 0,
                OR: [{ leaseOwner: null }, { leaseExpiresAt: { lte: new Date() } }],
            },
            data: {
                revision: 1,
                leaseOwner: null,
                leaseExpiresAt: null,
            },
        });
        expect(blockedApiClaim.count).toBe(0);

        store.shiftGeneralTurns(GENERAL_ID, -1);
        const changes = store.peekDirtyState();
        await connector.prisma.$transaction((transaction) => store.persistChanges(transaction, changes));
        store.acknowledgeDirtyState(changes);

        const committed = await connector.prisma.generalTurnRevision.findUniqueOrThrow({
            where: { generalId: GENERAL_ID },
        });
        expect(committed).toMatchObject({
            revision: 1,
            leaseOwner: null,
            leaseExpiresAt: null,
        });
        const turns = await connector.prisma.generalTurn.findMany({
            where: { generalId: GENERAL_ID },
            orderBy: { turnIdx: 'asc' },
        });
        expect(turns.map((turn) => turn.actionCode)).toEqual(['che_사기진작', '휴식']);

        const nextApiClaim = await connector.prisma.generalTurnRevision.updateMany({
            where: {
                generalId: GENERAL_ID,
                revision: 1,
                OR: [{ leaseOwner: null }, { leaseExpiresAt: { lte: new Date() } }],
            },
            data: { revision: 2 },
        });
        expect(nextApiClaim.count).toBe(1);
    });

    it('blocks a daemon-side replacement before deleting turns while an API lease is active', async () => {
        if (!connector) {
            throw new Error('integration connector is unavailable');
        }
        await connector.prisma.generalTurnRevision.update({
            where: { generalId: GENERAL_ID },
            data: {
                leaseOwner: 'integration-api',
                leaseExpiresAt: new Date(Date.now() + 60_000),
            },
        });
        const before = await connector.prisma.generalTurn.findMany({
            where: { generalId: GENERAL_ID },
            orderBy: { turnIdx: 'asc' },
        });
        const store = new InMemoryReservedTurnStore(connector.prisma, {
            maxGeneralTurns: 2,
            maxNationTurns: 1,
            leaseOwner: 'integration-daemon-replacement',
            leaseDurationMs: 60_000,
        });
        store.replaceGeneralTurns(GENERAL_ID, { action: 'che_훈련', args: {} });
        const changes = store.peekDirtyState();

        await expect(
            connector.prisma.$transaction((transaction) => store.persistChanges(transaction, changes))
        ).rejects.toBeInstanceOf(ReservedTurnLeaseConflictError);

        const after = await connector.prisma.generalTurn.findMany({
            where: { generalId: GENERAL_ID },
            orderBy: { turnIdx: 'asc' },
        });
        expect(after.map((turn) => turn.actionCode)).toEqual(before.map((turn) => turn.actionCode));
    });
});
