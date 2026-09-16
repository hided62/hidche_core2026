import { seedScenarioToDatabase } from '../src/scenario/scenarioSeeder.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import { AUDIT_RETENTION_BATCH_SIZE, prunePreviousAuditBatch } from '../src/playAudit/retention.js';

const databaseUrl = process.env.PLAY_AUDIT_RETENTION_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
integration('bounded previous-season audit retention', () => {
    let db: GamePrismaClient;
    let close: () => Promise<void>;
    beforeAll(async () => {
        if (!new URL(databaseUrl!).searchParams.get('schema')?.endsWith('_retention_fixture')) {
            throw new Error('Audit retention requires its dedicated fixture schema');
        }
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        close = () => connector.disconnect();
    });
    afterAll(async () => {
        await close?.();
    });

    it('keeps the active season, bounds each transaction and retries after rollback', async () => {
        await db.playAuditMonth.deleteMany();
        await db.playAuditPolicy.deleteMany();
        await db.worldState.deleteMany();
        const world = await db.worldState.create({
            data: {
                scenarioCode: 'audit-retention',
                currentYear: 190,
                currentMonth: 1,
                tickSeconds: 600,
                config: {},
                meta: { serverId: 'active' },
            },
        });
        const sample = (id: string, serverId: string) => ({
            id,
            serverId,
            year: 190,
            month: 1,
            kind: 'MONTH_END',
            hash: id,
            settlementsComplete: true,
        });
        await db.playAuditMonth.createMany({ data: [sample('old-sample', 'old'), sample('active-sample', 'active')] });
        await db.playAuditGeneral.createMany({
            data: Array.from({ length: 401 }, (_, index) => ({
                sampleId: 'old-sample',
                generalId: index + 1,
                nationId: 1,
                cityId: 1,
                npcState: 2,
                data: { marker: 'old' },
            })),
        });
        await db.playAuditCity.createMany({
            data: Array.from({ length: 201 }, (_, index) => ({
                sampleId: 'old-sample',
                cityId: index + 1,
                nationId: 1,
                data: {},
            })),
        });
        await db.playAuditNation.create({ data: { sampleId: 'old-sample', nationId: 1, data: {} } });
        await db.playAuditGeneral.create({
            data: {
                sampleId: 'active-sample',
                generalId: 1,
                nationId: 1,
                cityId: 1,
                npcState: 2,
                data: { marker: 'preserved' },
            },
        });
        expect(await prunePreviousAuditBatch(db, 'wrong')).toEqual({ status: 'identityChanged', deleted: 0 });
        expect(await prunePreviousAuditBatch(db, '')).toEqual({ status: 'identityChanged', deleted: 0 });
        expect(await prunePreviousAuditBatch(db, 'active')).toEqual({
            status: 'progress',
            deleted: AUDIT_RETENTION_BATCH_SIZE,
        });
        expect(await db.playAuditGeneral.count({ where: { sampleId: 'old-sample' } })).toBe(201);
        await db.$executeRawUnsafe(
            `CREATE OR REPLACE FUNCTION audit_retention_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'retention fixture rollback'; END $$`
        );
        await db.$executeRawUnsafe(
            `CREATE TRIGGER audit_retention_test_failure BEFORE DELETE ON play_audit_general FOR EACH ROW EXECUTE FUNCTION audit_retention_test_failure()`
        );
        try {
            await expect(prunePreviousAuditBatch(db, 'active')).rejects.toThrow();
            expect(await db.playAuditGeneral.count({ where: { sampleId: 'old-sample' } })).toBe(201);
        } finally {
            await db.$executeRawUnsafe('DROP TRIGGER audit_retention_test_failure ON play_audit_general');
            await db.$executeRawUnsafe('DROP FUNCTION audit_retention_test_failure()');
        }
        // A RESET holder makes cleanup defer without waiting for the reset transaction.
        await db.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(current_schema(), 0))::text`;
            expect(await prunePreviousAuditBatch(db, 'active')).toEqual({ status: 'busy', deleted: 0 });
        });
        const deleted = [];
        for (let attempt = 0; attempt < 10; attempt++) {
            const result = await prunePreviousAuditBatch(db, 'active');
            if (result.status === 'complete') break;
            expect(result.status).toBe('progress');
            expect(result.deleted).toBeLessThanOrEqual(AUDIT_RETENTION_BATCH_SIZE);
            deleted.push(result.deleted);
        }
        expect(deleted).toEqual([200, 1, 200, 1, 1, 1]);
        expect(await db.playAuditMonth.findUnique({ where: { id: 'old-sample' } })).toBeNull();
        expect(
            await db.playAuditGeneral.findUnique({
                where: { sampleId_generalId: { sampleId: 'active-sample', generalId: 1 } },
            })
        ).toMatchObject({ data: { marker: 'preserved' } });
        expect(await prunePreviousAuditBatch(db, 'active')).toEqual({ status: 'complete', deleted: 0 });
        // A worker from the old runtime must stop after the world identity changes.
        await db.worldState.update({ where: { id: world.id }, data: { meta: { serverId: 'next' } } });
        expect(await prunePreviousAuditBatch(db, 'active')).toEqual({ status: 'identityChanged', deleted: 0 });
        expect(await db.playAuditMonth.count()).toBe(1);
    });
    it('starts bounded cleanup only after seed commits, including a reserved opening', async () => {
        await db.playAuditMonth.deleteMany();
        await db.playAuditPolicy.deleteMany();
        await db.worldState.deleteMany();
        await db.worldState.create({
            data: {
                scenarioCode: 'before-reset',
                currentYear: 190,
                currentMonth: 1,
                tickSeconds: 600,
                config: {},
                meta: { serverId: 'before-reset' },
            },
        });
        await db.playAuditMonth.create({
            data: {
                id: 'reset-old-sample',
                serverId: 'before-reset',
                year: 190,
                month: 1,
                kind: 'MONTH_END',
                hash: 'reset',
                settlementsComplete: true,
            },
        });
        await db.playAuditGeneral.createMany({
            data: Array.from({ length: 201 }, (_, index) => ({
                sampleId: 'reset-old-sample',
                generalId: index + 1,
                nationId: 1,
                cityId: 1,
                npcState: 2,
                data: {},
            })),
        });
        const options = {
            scenarioId: 1010,
            databaseUrl: databaseUrl!,
            resetTables: true,
            now: new Date('2030-01-01T00:00:00Z'),
            wallNow: new Date('2030-01-01T00:00:00Z'),
            installOptions: {
                serverId: 'after-reset',
                preopenAt: new Date('2030-01-03T00:00:00Z'),
                openAt: new Date('2030-01-04T00:00:00Z'),
            },
        };
        await expect(
            seedScenarioToDatabase({
                ...options,
                onBeforeCommit: async () => {
                    throw new Error('seed fixture rollback');
                },
            })
        ).rejects.toThrow('seed fixture rollback');
        expect(await db.playAuditGeneral.count({ where: { sampleId: 'reset-old-sample' } })).toBe(201);
        expect(await db.worldState.findFirst()).toMatchObject({ meta: { serverId: 'before-reset' } });
        const result = await seedScenarioToDatabase(options);
        expect(result.applied).toBe(true);
        expect(await db.worldState.findFirst()).toMatchObject({ meta: { serverId: 'after-reset' } });
        expect(await db.playAuditGeneral.count({ where: { sampleId: 'reset-old-sample' } })).toBe(1);
        expect(result.warnings).toContainEqual({
            code: 'audit_retention_pending',
            message: '이전 플레이 감사 자료의 나머지는 서버 시작 후 정리합니다.',
        });
    });
    it('prunes old policy versions by key and preserves the active policy history', async () => {
        await db.playAuditMonth.deleteMany();
        await db.playAuditPolicy.deleteMany();
        await db.worldState.updateMany({ data: { meta: { serverId: 'policy-active' } } });
        const row = (id: string, serverId: string, revision: number) => ({
            id,
            serverId,
            nationId: 1,
            area: 'DEFENCE',
            revision,
            source: 'BASELINE',
            year: 190,
            month: 1,
            ordinal: revision,
            after: {},
            hash: id,
        });
        await db.playAuditPolicy.createMany({
            data: [
                ...Array.from({ length: 201 }, (_, index) => row(`old-policy-${index}`, 'old-policy', index + 1)),
                row('active-policy', 'policy-active', 1),
            ],
        });
        expect(await prunePreviousAuditBatch(db, 'policy-active')).toEqual({ status: 'progress', deleted: 200 });
        expect(await db.playAuditPolicy.count({ where: { serverId: 'old-policy' } })).toBe(1);
        expect(await prunePreviousAuditBatch(db, 'policy-active')).toEqual({ status: 'progress', deleted: 1 });
        expect(await prunePreviousAuditBatch(db, 'policy-active')).toEqual({ status: 'complete', deleted: 0 });
        expect(await db.playAuditPolicy.findUnique({ where: { id: 'active-policy' } })).not.toBeNull();
    });
});
