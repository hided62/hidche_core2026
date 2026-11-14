import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { upsertRankRows } from '../src/turn/databaseHooks.js';

const databaseUrl = process.env.IMMEDIATE_ACTION_DATABASE_URL;

// The conditional runner owns this schema and runs integration files serially.
describe.skipIf(!databaseUrl)('rank data bigint PostgreSQL persistence', () => {
    let db: GamePrismaClient;
    let disconnect: () => Promise<void>;
    const generalId = 7_319;

    beforeAll(async () => {
        const schema = new URL(databaseUrl!).searchParams.get('schema');
        if (!schema?.endsWith('immediate_action_integration')) {
            throw new Error('Refusing to mutate a non-dedicated rank persistence schema');
        }
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        disconnect = () => connector.disconnect();
        await db.rankData.deleteMany({ where: { generalId } });
        // Even conflict-update on an existing row used to exhaust int4 IDs.
        await db.$executeRaw`SELECT setval(pg_get_serial_sequence('rank_data', 'id'), 2147483647)`;
    });

    afterAll(async () => {
        if (db) await db.rankData.deleteMany({ where: { generalId } });
        await disconnect?.();
    });

    it('reuses IDs across batches, updates ownership and values, and allocates bigint IDs only for new rows', async () => {
        const rows = Array.from({ length: 1_001 }, (_, index) => ({
            generalId,
            nationId: 10,
            type: `rank_fixture_${index}`,
            value: index,
        }));
        await db.$transaction((tx) => upsertRankRows(tx, rows));
        const original = await db.rankData.findMany({ where: { generalId }, orderBy: { type: 'asc' } });
        expect(original).toHaveLength(rows.length);
        expect(original.every((row) => row.id > 2_147_483_647n)).toBe(true);
        const sequenceBefore = await db.$queryRaw<
            Array<{ last_value: bigint }>
        >`SELECT last_value FROM rank_data_id_seq`;
        for (let count = 0; count < 3; count++) {
            await db.$transaction((tx) =>
                upsertRankRows(
                    tx,
                    rows.map((row) => ({ ...row, nationId: 20, value: row.value + 3 }))
                )
            );
        }
        const updated = await db.rankData.findMany({ where: { generalId }, orderBy: { type: 'asc' } });
        expect(updated.map((row) => row.id)).toEqual(original.map((row) => row.id));
        expect(updated.map((row) => [row.nationId, row.value])).toEqual(original.map((row) => [20, row.value + 3]));
        expect(await db.$queryRaw`SELECT last_value FROM rank_data_id_seq`).toEqual(sequenceBefore);
        await db.$transaction((tx) =>
            upsertRankRows(tx, [rows[0]!, { generalId, nationId: 30, type: 'new_rank', value: 17 }])
        );
        expect(await db.rankData.count({ where: { generalId } })).toBe(1_002);
        expect(await db.$queryRaw`SELECT last_value FROM rank_data_id_seq`).toEqual([
            { last_value: sequenceBefore[0]!.last_value + 1n },
        ]);
    });

    it('reloads bigint IDs for high churn queues, logs, upserts and the traffic foreign key', async () => {
        const tables = [
            'general_access_log',
            'diplomacy',
            'inheritance_point',
            'log_entry',
            'error_log',
            'inheritance_log',
            'traffic_period',
        ];
        for (const table of tables) {
            await db.$executeRaw`SELECT setval(pg_get_serial_sequence(${table}, 'id'), 2147483647)`;
        }
        await expect(
            db.$transaction(async (tx) => {
                const now = new Date();
                const world = await tx.worldState.create({
                    data: {
                        scenarioCode: 'bigint-fixture',
                        currentYear: 200,
                        currentMonth: 1,
                        tickSeconds: 600,
                    },
                });
                const rows = await Promise.all([
                    tx.generalAccessLog.create({ data: { generalId } }),
                    tx.diplomacy.create({ data: { srcNationId: 3, destNationId: 4, stateCode: 0 } }),
                    tx.inheritancePoint.create({ data: { userId: 'bigint-fixture', key: 'previous', value: 123 } }),
                    tx.logEntry.create({
                        data: { scope: 'SYSTEM', category: 'HISTORY', year: 200, month: 1, text: 'fixture' },
                    }),
                    tx.errorLog.create({ data: { category: 'fixture', message: 'fixture' } }),
                    tx.inheritanceLog.create({
                        data: { userId: 'bigint-fixture', year: 200, month: 1, text: 'fixture' },
                    }),
                ]);
                expect(rows.every((row) => row.id > 2_147_483_647n)).toBe(true);
                const generalQueue = await tx.generalTurn.create({
                    data: { generalId, turnIdx: 0, actionCode: 'fixture' },
                });
                const nationQueue = await tx.nationTurn.create({
                    data: { nationId: 3, officerLevel: 12, turnIdx: 0, actionCode: 'fixture' },
                });
                expect(generalQueue).not.toHaveProperty('id');
                expect(nationQueue).not.toHaveProperty('id');
                const period = await tx.trafficPeriod.create({
                    data: {
                        worldStateId: world.id,
                        year: 200,
                        month: 1,
                        startedAt: now,
                        lastRefresh: now,
                        generals: { create: { generalId, lastRefresh: now } },
                    },
                    include: { generals: true },
                });
                expect(period.id).toBeGreaterThan(2_147_483_647n);
                expect(period.generals[0]?.periodId).toBe(period.id);
                expect((await tx.logEntry.findUniqueOrThrow({ where: { id: rows[3]!.id } })).text).toBe('fixture');
                throw new Error('high churn fixture rollback');
            })
        ).rejects.toThrow('high churn fixture rollback');
    });

    it('rolls value updates back atomically and retains the logical unique constraint', async () => {
        const where = { generalId_type: { generalId, type: 'new_rank' } };
        const before = await db.rankData.findUniqueOrThrow({ where });
        await expect(
            db.$transaction(async (tx) => {
                await upsertRankRows(tx, [{ generalId, nationId: 99, type: 'new_rank', value: 999 }]);
                throw new Error('fixture rollback');
            })
        ).rejects.toThrow('fixture rollback');
        expect(await db.rankData.findUniqueOrThrow({ where })).toEqual(before);
        await expect(
            db.rankData.create({ data: { generalId, nationId: 99, type: 'new_rank', value: 999 } })
        ).rejects.toThrow();
    });
});
