import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRecord, GAME_TICKS_PER_TURN } from '@sammo-ts/common';
import {
    createGamePostgresConnector,
    withPlayAuditSavepoint,
    hashAuditDiplomacyDocument,
    type GamePrismaClient,
    type GamePrisma,
} from '@sammo-ts/infra';
import { seedScenarioToDatabase } from '../src/scenario/scenarioSeeder.js';
import { createTurnDaemonRuntime, type TurnDaemonRuntime } from '../src/turn/turnDaemon.js';

const databaseUrl = process.env.PLAY_AUDIT_STARTUP_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const profile = 'hwe:903';
const serverId = 'audit-startup-fixture';

integration('initial audit durability before runtime readiness', () => {
    let db: GamePrismaClient;
    let closeDb: () => Promise<void>;
    let runtime: TurnDaemonRuntime | undefined;
    const start = () =>
        createTurnDaemonRuntime({
            profile,
            databaseUrl: databaseUrl!,
            enableDatabaseFlush: true,
            enableLeaseHeartbeat: false,
            leaseOwnerId: 'audit-startup-fixture',
        });
    const clock = () =>
        db.worldState.findFirstOrThrow({
            select: {
                clockPhase: true,
                clockTick: true,
                clockRevision: true,
                deadlineGeneration: true,
                clockWallAnchor: true,
                lastTurnTick: true,
                currentYear: true,
                currentMonth: true,
            },
        });
    beforeAll(async () => {
        if (!new URL(databaseUrl!).searchParams.get('schema')?.endsWith('_audit_startup_fixture'))
            throw new Error('Initial audit test requires its dedicated fixture schema');
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.playAuditMonth.deleteMany();
        await db.playAuditPolicy.deleteMany();
        await db.playAuditDiplomacyEvent.deleteMany();
        await seedScenarioToDatabase({
            scenarioId: 903,
            databaseUrl: databaseUrl!,
            now: new Date(),
            installOptions: {
                openAt: new Date(Date.now() + 86_400_000),
                turnTermMinutes: 5,
                npcMode: 2,
                showImgLevel: 3,
                serverId,
                season: 1,
            },
        });
        await db.nation.createMany({
            data: [
                { id: 91990, name: '기준 발신국', color: '#ffffff' },
                { id: 91991, name: '기준 수신국', color: '#000000' },
            ],
        });
        await db.diplomacy.create({
            data: { srcNationId: 91990, destNationId: 91991, stateCode: 7, term: 12, meta: { dead: 34 } },
        });
        await db.diplomacyLetter.createMany({
            data: Array.from({ length: 201 }, (_, index) => ({
                id: 1000 + index,
                srcNationId: 91990,
                destNationId: 91991,
                prevId: index ? 999 + index : null,
                state: index === 200 ? ('ACTIVATED' as const) : ('REPLACED' as const),
                textBrief: `도입 전 문서 ${index}`,
                textDetail: `<p>보유 원문 ${index}</p>`,
                date: new Date('2026-09-01T00:00:00Z'),
                srcSignerId: 70001,
                destSignerId: 70002,
                aux: { src: { nationName: '옛 국명', generalName: '옛 서명자' }, debug: '비공개 임의 값' },
            })),
        });
    }, 60_000);
    afterAll(async () => {
        await runtime?.close();
        await closeDb?.();
    });

    it('keeps readiness and gameplay when initial audit persistence fails', async () => {
        const before = await clock();
        await db.$executeRawUnsafe(
            "CREATE OR REPLACE FUNCTION audit_initial_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture initial audit failure'; END $$"
        );
        await db.$executeRawUnsafe(
            "CREATE TRIGGER audit_initial_fail BEFORE INSERT ON play_audit_month FOR EACH ROW WHEN (NEW.kind = 'INITIAL') EXECUTE FUNCTION audit_initial_fail()"
        );
        try {
            runtime = await start();
            expect(await db.playAuditMonth.count()).toBe(0);
            expect(await db.playAuditPolicy.count()).toBe(0);
            expect(runtime.world.hasPendingAuditRecords()).toBe(false);
            expect(asRecord((await db.worldState.findFirstOrThrow()).meta).playAuditGap).toMatchObject({
                serverId,
                stage: 'persistence',
            });
            expect((await db.turnDaemonLease.findUniqueOrThrow({ where: { profile } })).clockReady).toBe(true);
            expect(await clock()).toEqual(before);
            await runtime.close();
            runtime = undefined;
            // Restart under the same broken audit table must not pause or accumulate retries.
            runtime = await start();
            expect(runtime.world.hasPendingAuditRecords()).toBe(false);
            expect((await db.turnDaemonLease.findUniqueOrThrow({ where: { profile } })).clockReady).toBe(true);
        } finally {
            await runtime?.close();
            runtime = undefined;
            await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS audit_initial_fail ON play_audit_month');
            await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS audit_initial_fail()');
            // Independent baseline fixture for the following normal-start tests.
            await db.playAuditDiplomacyEvent.deleteMany();
            await db.$executeRawUnsafe(
                "UPDATE world_state SET meta = meta - 'playAuditCollection' - 'playAuditDocuments' - 'playAuditDiplomacy' - 'playAuditGap'"
            );
            await db.$executeRawUnsafe("UPDATE nation SET meta = meta - '_playAuditPolicy'");
        }
    });

    it('persists PREOPEN baseline without starting the lifecycle and reuses it after restart', async () => {
        const beforeClock = await clock();
        const beforeGenerals = await db.general.findMany({ orderBy: { id: 'asc' } });
        const beforeInputs = await db.inputEvent.count();
        expect(beforeClock.clockPhase).toBe('PREOPEN');
        runtime = await start();
        expect(await clock()).toEqual(beforeClock);
        expect(await db.general.findMany({ orderBy: { id: 'asc' } })).toEqual(beforeGenerals);
        expect(await db.inputEvent.count()).toBe(beforeInputs);
        expect((await db.turnDaemonLease.findUniqueOrThrow({ where: { profile } })).clockReady).toBe(true);
        const initial = await db.playAuditMonth.findFirstOrThrow({ where: { serverId, kind: 'INITIAL' } });
        const policies = await db.playAuditPolicy.findMany({ where: { serverId }, orderBy: { id: 'asc' } });
        const diplomacy = await db.playAuditDiplomacyEvent.findMany({
            where: { serverId, category: 'RELATION' },
            orderBy: { ordinal: 'asc' },
        });
        expect(diplomacy).toHaveLength(
            await db.diplomacy.count({ where: { srcNationId: { gt: 0 }, destNationId: { gt: 0 } } })
        );
        expect(diplomacy).toHaveLength(2);
        expect(diplomacy[0]).toMatchObject({
            srcNationId: 91990,
            destNationId: 91991,
            before: null,
            after: { state: 7, term: 12, dead: 34 },
        });
        expect(diplomacy[1]).toMatchObject({
            srcNationId: 91991,
            destNationId: 91990,
            after: { state: 2, term: 0, dead: 0 },
        });
        expect(
            diplomacy.every(
                (event) =>
                    event.source === 'BASELINE' &&
                    event.before === null &&
                    event.actor === null &&
                    event.requestId === null
            )
        ).toBe(true);
        const diplomacyMarker = asRecord((await db.worldState.findFirstOrThrow()).meta).playAuditDiplomacy;
        expect(diplomacyMarker).toMatchObject({ serverId, schemaVersion: 1, relationCount: diplomacy.length });
        const documentEvents = await db.playAuditDiplomacyEvent.findMany({
            where: { serverId, category: 'DOCUMENT' },
            orderBy: { ordinal: 'asc' },
        });
        expect(documentEvents).toHaveLength(201);
        const currentLetter = await db.diplomacyLetter.findUniqueOrThrow({ where: { id: 1200 } });
        expect(documentEvents[200]).toMatchObject({
            source: 'BASELINE',
            eventType: 'LETTER_BASELINE',
            documentId: 1200,
            previousDocumentId: 1199,
            documentHash: hashAuditDiplomacyDocument(currentLetter),
            actor: null,
            before: null,
            after: { state: 'ACTIVATED', srcNationName: '옛 국명', srcSignerName: '옛 서명자' },
        });
        expect(documentEvents[0]).toMatchObject({ after: { state: 'REPLACED' } });
        expect(JSON.stringify(documentEvents.map(({ after }) => after))).not.toContain('비공개 임의 값');
        const documentMarker = asRecord((await db.worldState.findFirstOrThrow()).meta).playAuditDocuments;
        expect(documentMarker).toMatchObject({ serverId, schemaVersion: 1, documentCount: 201 });

        expect(policies).toHaveLength((await db.nation.count()) * 4);
        expect(
            policies.every(
                (policy) =>
                    policy.source === 'BASELINE' &&
                    policy.tick === beforeClock.clockTick &&
                    policy.inputSequence === null
            )
        ).toBe(true);
        expect(await db.playAuditGeneral.count({ where: { sampleId: initial.id } })).toBe(beforeGenerals.length);
        const marker = asRecord((await db.worldState.findFirstOrThrow()).meta).playAuditCollection;
        expect(marker).toMatchObject({
            serverId,
            schemaVersion: 1,
            year: beforeClock.currentYear,
            month: beforeClock.currentMonth,
        });
        expect(runtime.world.hasPendingAuditRecords()).toBe(false);
        await runtime.close();
        runtime = undefined;
        runtime = await start();
        expect(await db.playAuditPolicy.findMany({ where: { serverId }, orderBy: { id: 'asc' } })).toEqual(policies);
        expect(await db.playAuditMonth.findMany({ where: { serverId, kind: 'INITIAL' } })).toEqual([initial]);
        expect(asRecord((await db.worldState.findFirstOrThrow()).meta).playAuditCollection).toEqual(marker);
        expect(
            await db.playAuditDiplomacyEvent.findMany({
                where: { serverId, category: 'RELATION' },
                orderBy: { ordinal: 'asc' },
            })
        ).toEqual(diplomacy);
        expect(asRecord((await db.worldState.findFirstOrThrow()).meta).playAuditDiplomacy).toEqual(diplomacyMarker);
        expect(asRecord((await db.worldState.findFirstOrThrow()).meta).playAuditDocuments).toEqual(documentMarker);
        expect(
            await db.playAuditDiplomacyEvent.findMany({
                where: { serverId, category: 'DOCUMENT' },
                orderBy: { ordinal: 'asc' },
            })
        ).toEqual(documentEvents);
        expect(await clock()).toEqual(beforeClock);
        expect(await db.inputEvent.count()).toBe(beforeInputs);
        await expect(
            db.playAuditMonth.create({
                data: { ...initial, id: 'second-initial', month: initial.month === 12 ? 1 : initial.month + 1 },
            })
        ).rejects.toMatchObject({ code: 'P2002' });
    }, 30_000);

    it('restores missing policy heads from immutable history before restart without rewriting history', async () => {
        await runtime?.close();
        runtime = undefined;
        const policies = await db.playAuditPolicy.findMany({ where: { serverId }, orderBy: { id: 'asc' } });
        const nation = await db.nation.findUniqueOrThrow({ where: { id: 91990 } });
        const { _playAuditPolicy: heads, ...meta } = asRecord(nation.meta);
        await db.nation.update({ where: { id: nation.id }, data: { meta: meta as GamePrisma.InputJsonObject } });
        runtime = await start();
        expect(
            asRecord((await db.nation.findUniqueOrThrow({ where: { id: nation.id } })).meta)._playAuditPolicy
        ).toEqual(heads);
        expect(await db.playAuditPolicy.findMany({ where: { serverId }, orderBy: { id: 'asc' } })).toEqual(policies);
        expect((await db.turnDaemonLease.findUniqueOrThrow({ where: { profile } })).clockReady).toBe(true);
        await runtime.close();
        runtime = undefined;
        runtime = await start();
        expect(await db.playAuditPolicy.findMany({ where: { serverId }, orderBy: { id: 'asc' } })).toEqual(policies);
    }, 30_000);

    it('links an observed policy gap to the recovered head and keeps it idempotent', async () => {
        await runtime?.close();
        runtime = undefined;
        const nation = await db.nation.findUniqueOrThrow({ where: { id: 91990 } });
        const meta = asRecord(nation.meta);
        const heads = asRecord(meta._playAuditPolicy);
        const previous = asRecord(heads.DEFENCE);
        const { DEFENCE: _lost, ...remainingHeads } = heads;
        await db.nation.update({
            where: { id: nation.id },
            data: {
                meta: { ...meta, scout: 1, _playAuditPolicy: remainingHeads } as GamePrisma.InputJsonObject,
            },
        });
        runtime = await start();
        const rows = await db.playAuditPolicy.findMany({
            where: { serverId, nationId: nation.id, area: 'DEFENCE' },
            orderBy: { revision: 'asc' },
        });
        expect(rows.at(-1)).toMatchObject({
            source: 'OBSERVED_GAP',
            previousId: previous.id,
            revision: Number(previous.revision) + 1,
            actor: null,
            before: null,
            after: { scout: 1 },
        });
        expect(asRecord((await db.nation.findUniqueOrThrow({ where: { id: nation.id } })).meta).scout).toBe(1);
        await runtime.close();
        runtime = undefined;
        runtime = await start();
        expect(
            await db.playAuditPolicy.findMany({
                where: { serverId, nationId: nation.id, area: 'DEFENCE' },
                orderBy: { revision: 'asc' },
            })
        ).toEqual(rows);
    }, 30_000);

    it('captures newly observed policies after durable clock recovery without replacing the initial sample', async () => {
        await runtime?.close();
        runtime = undefined;
        const original = await db.worldState.findFirstOrThrow();
        const initial = await db.playAuditMonth.findFirstOrThrow({ where: { serverId, kind: 'INITIAL' } });
        await db.nation.create({ data: { id: 91992, name: '복구 관측국', color: '#ffffff' } });
        await db.worldState.update({
            where: { id: original.id },
            data: {
                clockPhase: 'RUNNING',
                clockMode: 'realtime',
                clockTick: BigInt(GAME_TICKS_PER_TURN / 6),
                clockWallAnchor: new Date(Date.now() - 115 * 60_000),
                lastTurnTick: 0n,
            },
        });
        runtime = await start();
        const recovered = await db.worldState.findFirstOrThrow();
        expect(recovered.clockRevision).toBeGreaterThan(original.clockRevision);
        const policies = await db.playAuditPolicy.findMany({ where: { serverId, nationId: 91992 } });
        expect(policies).toHaveLength(4);
        expect(policies.every((policy) => policy.tick === BigInt(runtime!.world.getGameClockState().tick))).toBe(true);
        expect(await db.playAuditMonth.findMany({ where: { serverId, kind: 'INITIAL' } })).toEqual([initial]);
    }, 30_000);
    it('adopts an empty document collection without duplicating an existing initial sample', async () => {
        await runtime?.close();
        runtime = undefined;
        const original = await db.worldState.findFirstOrThrow();
        const meta = asRecord(original.meta);
        delete meta.playAuditDocuments;
        await db.diplomacyLetter.deleteMany();
        await db.playAuditDiplomacyEvent.deleteMany({ where: { category: 'DOCUMENT' } });
        await db.worldState.update({ where: { id: original.id }, data: { meta: meta as GamePrisma.InputJsonObject } });
        const samples = await db.playAuditMonth.findMany({ orderBy: { id: 'asc' } });
        runtime = await start();
        const marker = asRecord((await db.worldState.findFirstOrThrow()).meta).playAuditDocuments;
        expect(marker).toMatchObject({ serverId, schemaVersion: 1, documentCount: 0 });
        expect(await db.playAuditDiplomacyEvent.count({ where: { category: 'DOCUMENT' } })).toBe(0);
        expect(await db.playAuditMonth.findMany({ orderBy: { id: 'asc' } })).toEqual(samples);
        await runtime.close();
        runtime = undefined;
        runtime = await start();
        expect(asRecord((await db.worldState.findFirstOrThrow()).meta).playAuditDocuments).toEqual(marker);
    }, 30_000);
    it('isolates missing audit tables and bounded SQL waits but propagates core write failures', async () => {
        await runtime?.close();
        runtime = undefined;
        const nation = await db.nation.findUniqueOrThrow({ where: { id: 91990 } });
        await db.$transaction(async (tx) => {
            await tx.nation.update({ where: { id: nation.id }, data: { gold: nation.gold + 1 } });
            const missing = await withPlayAuditSavepoint(tx, () =>
                tx.$queryRawUnsafe('SELECT * FROM nonexistent_audit_fixture_table')
            );
            expect(missing.ok).toBe(false);
            const [settings] = await tx.$queryRaw<
                Array<{ timeout: string }>
            >`SELECT current_setting('statement_timeout') AS timeout`;
            const slow = await withPlayAuditSavepoint(tx, () => tx.$queryRawUnsafe('SELECT pg_sleep(2)::text'));
            expect(slow.ok).toBe(false);
            const [restored] = await tx.$queryRaw<
                Array<{ timeout: string }>
            >`SELECT current_setting('statement_timeout') AS timeout`;
            expect(restored).toEqual(settings);
        });
        expect((await db.nation.findUniqueOrThrow({ where: { id: nation.id } })).gold).toBe(nation.gold + 1);
        await expect(
            db.$transaction(async (tx) => {
                await tx.nation.update({ where: { id: nation.id }, data: { gold: nation.gold + 2 } });
                expect((await withPlayAuditSavepoint(tx, async () => 'audit-ok')).ok).toBe(true);
                throw new Error('core game write failed');
            })
        ).rejects.toThrow('core game write failed');
        expect((await db.nation.findUniqueOrThrow({ where: { id: nation.id } })).gold).toBe(nation.gold + 1);
    });
});
