import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGamePostgresConnector } from '@sammo-ts/infra';
import type { DatabaseClient } from '../src/context.js';
import {
    ReservedTurnRevisionConflictError,
    getGeneralTurnSnapshot,
    setGeneralTurn,
} from '../src/turns/reservedTurns.js';

const databaseUrl = process.env.RESERVED_TURN_DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;
const GENERAL_ID = 2_147_400_001;
const REVISION_ZERO_GENERAL_ID = 2_147_400_002;

describeIntegration('reserved turn queue revision integration', () => {
    const connector = databaseUrl ? createGamePostgresConnector({ url: databaseUrl }) : null;

    beforeAll(async () => {
        if (!connector) {
            return;
        }
        await connector.connect();
        const generalIds = [GENERAL_ID, REVISION_ZERO_GENERAL_ID];
        await connector.prisma.generalTurn.deleteMany({ where: { generalId: { in: generalIds } } });
        await connector.prisma.generalTurnRevision.deleteMany({ where: { generalId: { in: generalIds } } });
    });

    afterAll(async () => {
        if (!connector) {
            return;
        }
        const generalIds = [GENERAL_ID, REVISION_ZERO_GENERAL_ID];
        await connector.prisma.generalTurn.deleteMany({ where: { generalId: { in: generalIds } } });
        await connector.prisma.generalTurnRevision.deleteMany({ where: { generalId: { in: generalIds } } });
        await connector.disconnect();
    });

    it('allows exactly one writer for the same expected revision', async () => {
        if (!connector) {
            throw new Error('integration connector is unavailable');
        }

        const write = (action: string) =>
            connector.prisma.$transaction((transaction) =>
                setGeneralTurn(transaction as unknown as DatabaseClient, GENERAL_ID, 0, action, {}, 0)
            );

        const results = await Promise.allSettled([write('che_훈련'), write('che_사기진작')]);
        const fulfilled = results.filter(
            (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof write>>> =>
                result.status === 'fulfilled'
        );
        const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

        expect(fulfilled).toHaveLength(1);
        expect(fulfilled[0]?.value.revision).toBe(1);
        expect(rejected).toHaveLength(1);
        expect(rejected[0]?.reason).toBeInstanceOf(ReservedTurnRevisionConflictError);

        const snapshot = await getGeneralTurnSnapshot(connector.prisma as unknown as DatabaseClient, GENERAL_ID);
        expect(snapshot.revision).toBe(1);
        expect(['che_훈련', 'che_사기진작']).toContain(snapshot.turns[0]?.action);
        expect(await connector.prisma.generalTurn.count({ where: { generalId: GENERAL_ID } })).toBe(30);
    });

    it('uses an unlocked revision-zero lease row as the first API revision', async () => {
        if (!connector) {
            throw new Error('integration connector is unavailable');
        }

        await connector.prisma.generalTurnRevision.create({
            data: {
                generalId: REVISION_ZERO_GENERAL_ID,
                revision: 0,
                leaseOwner: null,
                leaseExpiresAt: null,
            },
        });

        const result = await connector.prisma.$transaction((transaction) =>
            setGeneralTurn(
                transaction as unknown as DatabaseClient,
                REVISION_ZERO_GENERAL_ID,
                0,
                'che_훈련',
                {},
                0
            )
        );

        expect(result.revision).toBe(1);
        expect(
            await connector.prisma.generalTurn.count({
                where: { generalId: REVISION_ZERO_GENERAL_ID },
            })
        ).toBe(30);
        expect(
            await connector.prisma.generalTurnRevision.findUnique({
                where: { generalId: REVISION_ZERO_GENERAL_ID },
            })
        ).toMatchObject({
            revision: 1,
            leaseOwner: null,
            leaseExpiresAt: null,
        });
    });
});
