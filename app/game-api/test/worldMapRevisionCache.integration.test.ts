import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { readMapWorldSourceRevision } from '../src/maps/worldMapSourceRevision.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);

integration('world map PostgreSQL source revision', () => {
    let db: GamePrismaClient;
    let close: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        close = () => connector.disconnect();
    });

    afterAll(async () => close?.());

    it('reads coverage and map.world from the same transaction snapshot', async () => {
        const rollback = new Error('rollback map revision fixture');
        await expect(
            db.$transaction(async (transaction) => {
                await transaction.readModelRevisionMeta.upsert({
                    where: { id: 1 },
                    create: { id: 1, coverageVersion: 1 },
                    update: { coverageVersion: 1 },
                });
                await transaction.readModelRevision.upsert({
                    where: { domain_entityId: { domain: 'map.world', entityId: 0 } },
                    create: { domain: 'map.world', entityId: 0, revision: 37n },
                    update: { revision: 37n },
                });
                await expect(readMapWorldSourceRevision(transaction)).resolves.toBe('37');
                throw rollback;
            })
        ).rejects.toBe(rollback);
    });
});
