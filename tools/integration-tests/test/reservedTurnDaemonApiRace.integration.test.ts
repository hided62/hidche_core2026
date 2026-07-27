import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DatabaseClient } from '@sammo-ts/game-api/context.js';
import {
    ReservedTurnRevisionConflictError,
    getGeneralTurnSnapshot,
    setGeneralTurn,
} from '@sammo-ts/game-api/turns/reservedTurns.js';
import { InMemoryReservedTurnStore } from '@sammo-ts/game-engine/turn/reservedTurnStore.js';
import { createGamePostgresConnector } from '@sammo-ts/infra';

const databaseUrl = process.env.RESERVED_TURN_DATABASE_URL;
const describeIntegration = databaseUrl ? describe : describe.skip;
const GENERAL_ID = 2_147_400_010;

describeIntegration('reserved turn daemon/API stale-cache race', () => {
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
                { generalId: GENERAL_ID, turnIdx: 1, actionCode: '휴식', arg: {} },
            ],
        });
        await connector.prisma.generalTurnRevision.create({
            data: { generalId: GENERAL_ID, revision: 0 },
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

    it('refreshes an already-loaded daemon queue after an API write and serializes later writers', async () => {
        if (!connector) {
            throw new Error('integration connector is unavailable');
        }
        const store = new InMemoryReservedTurnStore(connector.prisma, {
            maxGeneralTurns: 30,
            maxNationTurns: 12,
            leaseOwner: 'integration-stale-cache-daemon',
            leaseDurationMs: 60_000,
        });

        await store.loadAll();
        expect(store.getGeneralTurn(GENERAL_ID, 1).action).toBe('휴식');

        const apiWrite = await connector.prisma.$transaction((transaction) =>
            setGeneralTurn(transaction as unknown as DatabaseClient, GENERAL_ID, 1, 'che_화계', { destCityId: 7 }, 0)
        );
        expect(apiWrite.revision).toBe(1);

        await store.prepareTurnsForExecution(GENERAL_ID);
        expect(store.getGeneralTurn(GENERAL_ID, 1)).toEqual({
            action: 'che_화계',
            args: { destCityId: 7 },
        });

        await expect(
            connector.prisma.$transaction((transaction) =>
                setGeneralTurn(transaction as unknown as DatabaseClient, GENERAL_ID, 2, 'che_사기진작', {}, 1)
            )
        ).rejects.toBeInstanceOf(ReservedTurnRevisionConflictError);

        store.shiftGeneralTurns(GENERAL_ID, -1);
        const changes = store.peekDirtyState();
        await connector.prisma.$transaction((transaction) => store.persistChanges(transaction, changes));
        store.acknowledgeDirtyState(changes);

        const afterDaemon = await getGeneralTurnSnapshot(connector.prisma as unknown as DatabaseClient, GENERAL_ID);
        expect(afterDaemon.revision).toBe(2);
        expect(afterDaemon.turns[0]).toMatchObject({
            action: 'che_화계',
            args: { destCityId: 7 },
        });

        const retry = await connector.prisma.$transaction((transaction) =>
            setGeneralTurn(transaction as unknown as DatabaseClient, GENERAL_ID, 2, 'che_사기진작', {}, 2)
        );
        expect(retry.revision).toBe(3);
    });
});
