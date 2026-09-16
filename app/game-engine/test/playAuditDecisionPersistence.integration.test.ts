import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import { persistAuditDecisions } from '../src/playAudit/decisionPersistence.js';
import { buildAuditExecutionFixture, buildAuditDecisionFixture as draft } from './fixtures/playAuditDecision.js';
import { prunePreviousAuditBatch } from '../src/playAudit/retention.js';

const databaseUrl = process.env.PLAY_AUDIT_DECISION_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
integration('decision persistence and bounded retention', () => {
    let db: GamePrismaClient;
    let close: () => Promise<void>;
    beforeAll(async () => {
        if (!new URL(databaseUrl!).searchParams.get('schema')?.endsWith('_decision_fixture'))
            throw new Error('Dedicated decision fixture required');
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        close = () => connector.disconnect();
        await db.playAuditDecisionChunk.deleteMany();
        await db.playAuditDecision.deleteMany();
        await db.nation.deleteMany({ where: { id: 990321 } });
        await db.worldState.deleteMany();
        await db.worldState.create({
            data: {
                scenarioCode: 'decision',
                currentYear: 190,
                currentMonth: 1,
                tickSeconds: 600,
                config: {},
                meta: { serverId: 'decision-current' },
            },
        });
    });
    afterAll(async () => {
        await close?.();
    });
    it('rolls back gameplay/header/chunks on insert failure, retries and rejects divergent replay', async () => {
        const decision = draft('decision-one');
        if (decision.steps[0]?.kind === 'DECISION_START') decision.steps[0].effectivePolicy = {"schemaVersion":1,"general":{"priority":["징병"],"flags":{"징병":true,"출병":false}},"nation":{"priority":["천도"],"flags":{"천도":true},"values":{"reqNationGold":4321,"reqNationRice":100,"reqHumanWarUrgentGold":100,"reqHumanWarUrgentRice":100,"reqHumanWarRecommandGold":100,"reqHumanWarRecommandRice":100,"reqHumanDevelGold":100,"reqHumanDevelRice":100,"reqNpcWarGold":100,"reqNpcWarRice":100,"reqNpcDevelGold":100,"reqNpcDevelRice":100,"minimumResourceActionAmount":100,"maximumResourceActionAmount":100,"minNpcWarLeadership":100,"minWarCrew":100,"minNpcRecruitCityPopulation":100,"safeRecruitCityPopulationRatio":100,"properWarTrainAtmos":100,"cureThreshold":100},"combatForce":{"1":[2,3]},"supportForce":[4],"developForce":[5]}};
        decision.summary.codeVersion = 'a'.repeat(40);
        decision.summary.executionCoverage = 'ATTEMPTS';
        decision.steps.push({ ...decision.steps[0]!, ...buildAuditExecutionFixture(), sequence: 302 });
        await expect(
            db.$transaction((tx) => persistAuditDecisions(tx, [{ ...decision, steps: decision.steps.slice(0, -1) }]))
        ).rejects.toThrow('Incomplete play audit decision');
        await db.$executeRawUnsafe(
            `CREATE OR REPLACE FUNCTION decision_fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.ordinal=1 THEN RAISE EXCEPTION 'decision chunk failure'; END IF; RETURN NEW; END $$`
        );
        await db.$executeRawUnsafe(
            `CREATE TRIGGER decision_fixture_failure BEFORE INSERT ON play_audit_decision_chunk FOR EACH ROW EXECUTE FUNCTION decision_fixture_failure()`
        );
        try {
            await expect(
                db.$transaction(async (tx) => {
                    await tx.nation.create({ data: { id: 990321, name: '결정국', color: '#fff' } });
                    await persistAuditDecisions(tx, [decision]);
                })
            ).rejects.toThrow('decision chunk failure');
        } finally {
            await db.$executeRawUnsafe('DROP TRIGGER decision_fixture_failure ON play_audit_decision_chunk');
        }
        expect(await db.nation.findUnique({ where: { id: 990321 } })).toBeNull();
        expect(await db.playAuditDecision.count()).toBe(0);
        expect(await db.playAuditDecisionChunk.count()).toBe(0);
        await db.$transaction(async (tx) => {
            await tx.nation.create({ data: { id: 990321, name: '결정국', color: '#fff' } });
            await persistAuditDecisions(tx, [decision]);
        });
        await db.$transaction((tx) => persistAuditDecisions(tx, [decision]));
        const header = await db.playAuditDecision.findUniqueOrThrow({ where: { id: decision.id } });
        expect(header).toMatchObject({
            tick: 4_320_000_000n,
            stepCount: 303,
            summary: { codeVersion: 'a'.repeat(40) },
        });
        await expect(
            db.$transaction((tx) =>
                persistAuditDecisions(tx, [
                    { ...decision, summary: { ...decision.summary, codeVersion: 'b'.repeat(40) } },
                ])
            )
        ).rejects.toThrow('replay conflict');
        const chunks = await db.playAuditDecisionChunk.findMany({
            where: { decisionId: decision.id },
            orderBy: { ordinal: 'asc' },
        });
        expect(chunks).toHaveLength(3);
        expect(chunks.flatMap((chunk) => chunk.steps)).toEqual(decision.steps);
        await expect(
            db.$transaction((tx) =>
                persistAuditDecisions(tx, [{ ...decision, summary: { ...decision.summary, completed: true } }])
            )
        ).rejects.toThrow('replay conflict');
        await expect(db.playAuditDecision.delete({ where: { id: decision.id } })).rejects.toThrow();
        expect(await db.playAuditDecision.count()).toBe(1);
    });
    it('deletes at most 200 chunks before a header and preserves current season', async () => {
        const active = draft('decision-active', 'decision-current');
        await db.$transaction((tx) => persistAuditDecisions(tx, [active]));
        await db.playAuditDecisionChunk.createMany({
            data: Array.from({ length: 401 }, (_, index) => ({
                decisionId: 'decision-one',
                ordinal: index + 3,
                steps: [],
            })),
        });
        expect(await prunePreviousAuditBatch(db, 'wrong')).toEqual({ status: 'identityChanged', deleted: 0 });
        expect(await prunePreviousAuditBatch(db, 'decision-current')).toEqual({ status: 'progress', deleted: 200 });
        expect(await db.playAuditDecisionChunk.count({ where: { decisionId: 'decision-one' } })).toBe(204);
        expect(await db.playAuditDecision.count({ where: { id: 'decision-one' } })).toBe(1);
        expect(await prunePreviousAuditBatch(db, 'decision-current')).toEqual({ status: 'progress', deleted: 200 });
        expect(await prunePreviousAuditBatch(db, 'decision-current')).toEqual({ status: 'progress', deleted: 4 });
        expect(await prunePreviousAuditBatch(db, 'decision-current')).toEqual({ status: 'progress', deleted: 1 });
        expect(await prunePreviousAuditBatch(db, 'decision-current')).toEqual({ status: 'complete', deleted: 0 });
        expect(await db.playAuditDecision.count()).toBe(1);
        expect(await db.playAuditDecisionChunk.count()).toBe(3);
    });
});
