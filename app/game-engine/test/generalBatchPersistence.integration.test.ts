import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient, type TurnEngineGeneralUpdateInput } from '@sammo-ts/infra';
import {
    GENERAL_UPDATE_BATCH_SIZE,
    persistGeneralAccessScores,
    persistGeneralUpdates,
} from '../src/turn/generalBatchPersistence.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const firstId = 995_000;
const at = new Date('0200-01-01T00:00:00.000Z');

const dataFor = (index: number): TurnEngineGeneralUpdateInput => ({
    userId: null,
    name: `n장 ${index} ' "`,
    nationId: 0,
    cityId: 0,
    troopId: 0,
    leadership: 51,
    strength: 52,
    intel: 53,
    experience: 123,
    dedication: 456,
    officerLevel: 0,
    injury: 0,
    gold: 700 + index,
    rice: 1200 + index,
    crew: 100,
    crewTypeId: 1100,
    train: 70,
    atmos: 80,
    age: 21,
    npcState: 2,
    affinity: null,
    bornYear: 179,
    deadYear: 299,
    picture: null,
    imageServer: 0,
    startAge: 20,
    horseCode: 'None',
    weaponCode: 'None',
    bookCode: 'None',
    itemCode: 'None',
    personalCode: 'None',
    specialCode: 'None',
    special2Code: 'None',
    lastTurn: { command: '휴식', args: { text: "한글 ' 문자열" } },
    penalty: {},
    meta: { betgold: index * 10, nested: { preserved: true }, list: [1, null, '값'] },
    turnTime: at,
    turnTick: 9_007_199_254_740_993n,
    recentWarTime: index % 2 ? at : null,
    recentWarTick: index % 2 ? 123n : null,
});

integration('general batch persistence', () => {
    let db: GamePrismaClient;
    let close: () => Promise<void>;
    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        close = () => connector.disconnect();
        await db.general.createMany({
            data: Array.from({ length: GENERAL_UPDATE_BATCH_SIZE + 1 }, (_, index) => ({
                id: firstId + index,
                name: `original${index}`,
                turnTime: at,
                createdAt: at,
                updatedAt: at,
            })),
        });
    });
    afterAll(async () => {
        await db.generalAccessLog.deleteMany({
            where: { generalId: { gte: firstId, lte: firstId + GENERAL_UPDATE_BATCH_SIZE } },
        });
        await db.general.deleteMany({ where: { id: { gte: firstId, lte: firstId + GENERAL_UPDATE_BATCH_SIZE } } });
        await close();
    });

    it('matches Prisma row updates including JSON, nulls, dates, bigint and untouched columns', async () => {
        const data = dataFor(1);
        await db.general.update({ where: { id: firstId }, data });
        let writes = 0;
        await db.$transaction(async (transaction) => {
            await persistGeneralUpdates(
                {
                    $executeRaw: (query) => {
                        writes += 1;
                        return transaction.$executeRaw(query);
                    },
                },
                [{ id: firstId + 1, data }]
            );
        });
        const { id: _leftId, ...left } = await db.general.findUniqueOrThrow({ where: { id: firstId } });
        const { id: _rightId, ...right } = await db.general.findUniqueOrThrow({ where: { id: firstId + 1 } });
        expect(right).toEqual(left);
        expect(writes).toBe(1);
    });

    it('writes 501 distinct generals in two SQL statements and preserves omitted optional years', async () => {
        const updates = Array.from({ length: GENERAL_UPDATE_BATCH_SIZE + 1 }, (_, index) => ({
            id: firstId + index,
            data: { ...dataFor(index), bornYear: undefined, deadYear: undefined },
        }));
        let writes = 0;
        await db.$transaction(async (transaction) => {
            await persistGeneralUpdates(
                {
                    $executeRaw: (query) => {
                        writes += 1;
                        return transaction.$executeRaw(query);
                    },
                },
                updates
            );
        });
        expect(writes).toBe(2);
        const rows = await db.general.findMany({
            where: { id: { gte: firstId, lte: firstId + GENERAL_UPDATE_BATCH_SIZE } },
            orderBy: { id: 'asc' },
        });
        rows.forEach((row, index) => {
            expect(row).toMatchObject({
                gold: 700 + index,
                rice: 1200 + index,
                meta: dataFor(index).meta,
                bornYear: index < 2 ? 179 : 180,
                deadYear: index < 2 ? 299 : 300,
                createdAt: at,
                updatedAt: at,
                turnTick: 9_007_199_254_740_993n,
            });
        });
    });

    it('rolls back the entire transaction when a target is missing', async () => {
        const before = await db.general.findUniqueOrThrow({ where: { id: firstId } });
        await expect(
            db.$transaction(async (transaction) =>
                persistGeneralUpdates(transaction, [
                    { id: firstId, data: dataFor(999) },
                    { id: firstId - 1, data: dataFor(999) },
                ])
            )
        ).rejects.toThrow('expected 2 rows, updated 1');
        expect(await db.general.findUniqueOrThrow({ where: { id: firstId } })).toEqual(before);
    });

    it('preserves unique constraints and rolls back conflicting ownership', async () => {
        const before = await db.general.findMany({
            where: { id: { in: [firstId, firstId + 1] } },
            orderBy: { id: 'asc' },
        });
        await expect(
            db.$transaction(async (transaction) =>
                persistGeneralUpdates(transaction, [
                    { id: firstId, data: { ...dataFor(1), userId: 'batch-collision' } },
                    { id: firstId + 1, data: { ...dataFor(2), userId: 'batch-collision' } },
                ])
            )
        ).rejects.toThrow();
        expect(
            await db.general.findMany({ where: { id: { in: [firstId, firstId + 1] } }, orderBy: { id: 'asc' } })
        ).toEqual(before);
    });

    it('batch upserts access totals while preserving existing actor and activity fields', async () => {
        await db.generalAccessLog.create({
            data: {
                generalId: firstId,
                userId: 'original-owner',
                lastRefresh: at,
                lastActionAt: at,
                refresh: 3,
                refreshTotal: 7,
                refreshScore: 5,
            },
        });
        const updates = Array.from({ length: GENERAL_UPDATE_BATCH_SIZE + 1 }, (_, index) => ({
            generalId: firstId + index,
            userId: null,
            refreshScoreTotal: index + 10,
        }));
        let writes = 0;
        await db.$transaction(async (transaction) => {
            await persistGeneralAccessScores(
                {
                    $executeRaw: (query) => {
                        writes += 1;
                        return transaction.$executeRaw(query);
                    },
                },
                updates
            );
        });
        expect(writes).toBe(2);
        expect(await db.generalAccessLog.findUniqueOrThrow({ where: { generalId: firstId } })).toMatchObject({
            userId: 'original-owner',
            lastRefresh: at,
            lastActionAt: at,
            refresh: 3,
            refreshTotal: 7,
            refreshScore: 5,
            refreshScoreTotal: 10,
        });
        expect(await db.generalAccessLog.findUniqueOrThrow({ where: { generalId: firstId + 500 } })).toMatchObject({
            userId: null,
            lastRefresh: null,
            refresh: 0,
            refreshScoreTotal: 510,
        });
    });

    it('does not write an empty batch and rejects duplicate IDs before SQL', async () => {
        let writes = 0;
        const database = {
            $executeRaw: async () => {
                writes += 1;
                return 0;
            },
        };
        await persistGeneralUpdates(database, []);
        await expect(
            persistGeneralUpdates(database, [
                { id: firstId, data: dataFor(1) },
                { id: firstId, data: dataFor(2) },
            ])
        ).rejects.toThrow('Duplicate general IDs');
        expect(writes).toBe(0);
    });
});
