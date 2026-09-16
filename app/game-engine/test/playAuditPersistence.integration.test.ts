import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import { persistAuditMonth, type PendingAuditMonth } from '../src/playAudit/persistence.js';
import { buildAuditSnapshot } from '../src/playAudit/snapshot.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const serverId = 'play-audit-persistence-fixture-20260916';

integration('play audit transactional month persistence', () => {
    let db: GamePrismaClient;
    let close: () => Promise<void>;
    const snapshot: PendingAuditMonth = {
        serverId,
        year: 200,
        month: 1,
        tick: 4_320_000_000,
        kind: 'MONTH_END',
        settlementsComplete: true,
        ...buildAuditSnapshot({
            nations: [
                {
                    id: 1,
                    name: '감사국',
                    color: '#ffffff',
                    capitalCityId: null,
                    chiefGeneralId: null,
                    gold: 100,
                    rice: 200,
                    power: 0,
                    level: 1,
                    typeCode: 'che_중립',
                    meta: {},
                },
            ],
            cities: [],
            generals: [],
            settlements: [],
            settlementsComplete: true,
        }),
    };
    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        close = () => connector.disconnect();
    });
    afterAll(async () => {
        await db.playAuditMonth.deleteMany({ where: { serverId } });
        await close();
    });
    it('rolls back all audit rows, reloads exact data, rejects conflicting replay and deduplicates retries', async () => {
        await expect(
            db.$transaction(async (tx) => {
                await tx.nation.create({ data: { id: 999_916, name: 'rollback audit', color: '#ffffff' } });
                await persistAuditMonth(tx, snapshot);
                throw new Error('fixture rollback');
            })
        ).rejects.toThrow('fixture rollback');
        expect(await db.playAuditMonth.count({ where: { serverId } })).toBe(0);
        expect(await db.nation.findUnique({ where: { id: 999_916 } })).toBeNull();
        await db.$transaction((tx) => persistAuditMonth(tx, snapshot));
        await db.$transaction((tx) => persistAuditMonth(tx, snapshot));
        const saved = await db.playAuditMonth.findFirstOrThrow({ where: { serverId }, include: { nations: true } });
        expect(saved.nations.map((row) => row.data)).toEqual(snapshot.nations);
        expect(await db.playAuditMonth.count({ where: { serverId } })).toBe(1);
        await expect(db.$transaction((tx) => persistAuditMonth(tx, { ...snapshot, tick: 11 }))).rejects.toThrow(
            'replay payload conflict'
        );
        expect((await db.playAuditMonth.findUniqueOrThrow({ where: { id: saved.id } })).tick).toBe(4_320_000_000n);
        await db.playAuditMonth.delete({ where: { id: saved.id } });
        expect(await db.playAuditNation.count({ where: { sampleId: saved.id } })).toBe(0);
    });
});
