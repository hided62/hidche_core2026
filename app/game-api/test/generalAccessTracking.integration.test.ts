import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { upsertGeneralAccess } from '../src/services/generalAccess.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const generalId = 9_980_071;

integration('general access tracking persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.generalAccessLog.deleteMany({ where: { generalId } });
    });

    afterAll(async () => {
        await db.generalAccessLog.deleteMany({ where: { generalId } });
        await closeDb?.();
    });

    it('atomically increments concurrent requests and resets only windowed counters', async () => {
        const firstWindow = {
            generalId,
            userId: 'access-user-a',
            now: new Date('2026-07-26T03:05:00.000Z'),
            dayStartedAt: new Date('2026-07-26T00:00:00.000Z'),
            scoreStartedAt: new Date('2026-07-26T03:00:00.000Z'),
        };
        await upsertGeneralAccess(db, { ...firstWindow, weight: 2 });
        await Promise.all(
            Array.from({ length: 20 }, (_, index) =>
                upsertGeneralAccess(db, {
                    ...firstWindow,
                    now: new Date(firstWindow.now.getTime() + index + 1),
                    weight: 1,
                })
            )
        );

        expect(await db.generalAccessLog.findUniqueOrThrow({ where: { generalId } })).toMatchObject({
            userId: 'access-user-a',
            refresh: 22,
            refreshTotal: 22,
            refreshScore: 22,
            refreshScoreTotal: 22,
        });

        await upsertGeneralAccess(db, {
            generalId,
            userId: 'access-user-b',
            now: new Date('2026-07-27T00:05:00.000Z'),
            dayStartedAt: new Date('2026-07-27T00:00:00.000Z'),
            scoreStartedAt: new Date('2026-07-27T00:00:00.000Z'),
            weight: 1,
        });

        expect(await db.generalAccessLog.findUniqueOrThrow({ where: { generalId } })).toMatchObject({
            userId: 'access-user-b',
            refresh: 1,
            refreshTotal: 23,
            refreshScore: 1,
            refreshScoreTotal: 23,
        });
    });
});
