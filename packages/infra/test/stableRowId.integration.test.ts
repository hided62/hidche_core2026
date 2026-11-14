import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGamePostgresConnector, GamePrisma, type GamePrismaClient } from '../src/gamePrisma.js';
import { existingRowIdOrNext, upsertWithoutSequence } from '../src/stableRowId.js';

const databaseUrl = process.env.IMMEDIATE_ACTION_DATABASE_URL;
const generalId = 7_329;
const userId = 'stable-id-fixture';

describe.skipIf(!databaseUrl)('natural-key ID persistence on PostgreSQL', () => {
    let db: GamePrismaClient;
    let close: () => Promise<void>;
    const sequence = async (table: 'rank_data' | 'inheritance_point'): Promise<bigint> =>
        (
            await db.$queryRaw<
                Array<{ value: bigint }>
            >`SELECT pg_sequence_last_value(pg_get_serial_sequence(${table}, 'id')::regclass) AS value`
        )[0]!.value;

    beforeAll(async () => {
        if (!new URL(databaseUrl!).searchParams.get('schema')?.endsWith('immediate_action_integration')) {
            throw new Error('Dedicated immediate action schema is required');
        }
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        close = () => connector.disconnect();
        await db.rankData.deleteMany({ where: { generalId } });
        await db.inheritancePoint.deleteMany({ where: { userId } });
    });
    afterAll(async () => {
        if (db) {
            await db.rankData.deleteMany({ where: { generalId } });
            await db.inheritancePoint.deleteMany({ where: { userId } });
        }
        await close?.();
    });

    it('creates missing rows inside the transaction and retains identity on replace and increment', async () => {
        await db.$transaction(async (tx) => {
            await upsertWithoutSequence(tx.rankData, {
                where: { generalId_type: { generalId, type: 'stable_rank' } },
                update: { value: 11 },
                create: { generalId, type: 'stable_rank', value: 11 },
            });
            await upsertWithoutSequence(tx.inheritancePoint, {
                where: { userId_key: { userId, key: 'previous' } },
                update: { value: 100 },
                create: { userId, key: 'previous', value: 100 },
            });
        });
        const original = await db.rankData.findUniqueOrThrow({
            where: { generalId_type: { generalId, type: 'stable_rank' } },
        });
        const before = await sequence('rank_data');
        for (let index = 0; index < 5; index++)
            await db.$transaction((tx) =>
                upsertWithoutSequence(tx.rankData, {
                    where: { generalId_type: { generalId, type: 'stable_rank' } },
                    update: { value: { increment: 1 }, nationId: 3 },
                    create: { generalId, type: 'stable_rank', value: 1, nationId: 3 },
                })
            );
        expect(await db.rankData.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({
            id: original.id,
            value: 16,
            nationId: 3,
        });
        expect(await sequence('rank_data')).toBe(before);
    });

    it('serializes concurrent updates without losing increments or allocating IDs', async () => {
        const before = await sequence('rank_data');
        await Promise.all(
            Array.from({ length: 12 }, () =>
                db.$transaction((tx) =>
                    upsertWithoutSequence(tx.rankData, {
                        where: { generalId_type: { generalId, type: 'stable_rank' } },
                        update: { value: { increment: 1 } },
                        create: { generalId, type: 'stable_rank', value: 1 },
                    })
                )
            )
        );
        expect(
            (await db.rankData.findUniqueOrThrow({ where: { generalId_type: { generalId, type: 'stable_rank' } } }))
                .value
        ).toBe(28);
        expect(await sequence('rank_data')).toBe(before);
        // New-key races still converge through the original ON CONFLICT upsert.
        await Promise.all(
            Array.from({ length: 6 }, () =>
                db.$transaction((tx) =>
                    upsertWithoutSequence(tx.rankData, {
                        where: { generalId_type: { generalId, type: 'stable_race' } },
                        update: { value: { increment: 1 } },
                        create: { generalId, type: 'stable_race', value: 1 },
                    })
                )
            )
        );
        expect(
            (await db.rankData.findUniqueOrThrow({ where: { generalId_type: { generalId, type: 'stable_race' } } }))
                .value
        ).toBe(6);
    });

    it('keeps raw refund increments atomic and does not consume an ID for an existing point row', async () => {
        const point = await db.inheritancePoint.findUniqueOrThrow({
            where: { userId_key: { userId, key: 'previous' } },
        });
        const before = await sequence('inheritance_point');
        await Promise.all(
            Array.from({ length: 8 }, () =>
                db.$executeRaw(GamePrisma.sql`
            INSERT INTO inheritance_point(id,user_id,key,value,updated_at)
            VALUES(${existingRowIdOrNext('inheritance_point', GamePrisma.sql`stable_id.user_id=${userId} AND stable_id.key='previous'`)},${userId},'previous',1,CURRENT_TIMESTAMP)
            ON CONFLICT(user_id,key) DO UPDATE SET value=inheritance_point.value+EXCLUDED.value
        `)
            )
        );
        expect(await db.inheritancePoint.findUniqueOrThrow({ where: { id: point.id } })).toMatchObject({ value: 108 });
        expect(await sequence('inheritance_point')).toBe(before);
    });

    it('preserves rollback and propagates validation/constraint errors without creating a replacement row', async () => {
        const where = { generalId_type: { generalId, type: 'stable_rank' } };
        const before = await db.rankData.findUniqueOrThrow({ where });
        const counter = await sequence('rank_data');
        await expect(
            db.$transaction(async (tx) => {
                await upsertWithoutSequence(tx.rankData, {
                    where,
                    update: { value: 99 },
                    create: { generalId, type: 'stable_rank', value: 99 },
                });
                throw new Error('fixture abort');
            })
        ).rejects.toThrow('fixture abort');
        expect(await db.rankData.findUniqueOrThrow({ where })).toEqual(before);
        await expect(
            upsertWithoutSequence(db.rankData, {
                where,
                update: { type: 'stable_race' },
                create: { generalId, type: 'stable_rank' },
            })
        ).rejects.toMatchObject({ code: 'P2002' });
        expect(await sequence('rank_data')).toBe(counter);
        expect(await db.rankData.count({ where: { generalId } })).toBe(2);
    });
});
