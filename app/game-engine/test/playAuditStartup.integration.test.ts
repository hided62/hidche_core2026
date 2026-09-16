import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRecord, GAME_TICKS_PER_TURN } from '@sammo-ts/common';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
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
    }, 60_000);
    afterAll(async () => {
        await runtime?.close();
        await closeDb?.();
    });

    it('rolls initial policies, sample and collection marker back before readiness on persistence failure', async () => {
        const before = await clock();
        await db.$executeRawUnsafe(
            "CREATE OR REPLACE FUNCTION audit_initial_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture initial audit failure'; END $$"
        );
        await db.$executeRawUnsafe(
            "CREATE TRIGGER audit_initial_fail BEFORE INSERT ON play_audit_month FOR EACH ROW WHEN (NEW.kind = 'INITIAL') EXECUTE FUNCTION audit_initial_fail()"
        );
        try {
            let error: unknown;
            try {
                runtime = await start();
            } catch (cause) {
                error = cause;
            }
            expect(String(error)).toContain('fixture initial audit failure');
            expect(await db.playAuditMonth.count()).toBe(0);
            expect(await db.playAuditPolicy.count()).toBe(0);
            expect(await db.playAuditDiplomacyEvent.count()).toBe(0);
            expect(asRecord((await db.worldState.findFirstOrThrow()).meta).playAuditDiplomacy).toBeUndefined();
            expect(asRecord((await db.worldState.findFirstOrThrow()).meta).playAuditCollection).toBeUndefined();
            expect(
                (await db.nation.findMany()).every((nation) => asRecord(nation.meta)._playAuditPolicy === undefined)
            ).toBe(true);
            expect((await db.turnDaemonLease.findMany()).every((lease) => !lease.clockReady)).toBe(true);
            expect(await clock()).toEqual(before);
        } finally {
            await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS audit_initial_fail ON play_audit_month');
            await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS audit_initial_fail()');
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
            where: { serverId },
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

        expect(policies).toHaveLength((await db.nation.count()) * 4);
        expect(
            policies.every(
                (policy) =>
                    policy.source === 'BASELINE' &&
                    policy.tick === Number(beforeClock.clockTick) &&
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
        expect(await db.playAuditDiplomacyEvent.findMany({ where: { serverId }, orderBy: { ordinal: 'asc' } })).toEqual(
            diplomacy
        );
        expect(asRecord((await db.worldState.findFirstOrThrow()).meta).playAuditDiplomacy).toEqual(diplomacyMarker);
        expect(await clock()).toEqual(beforeClock);
        expect(await db.inputEvent.count()).toBe(beforeInputs);
        await expect(
            db.playAuditMonth.create({
                data: { ...initial, id: 'second-initial', month: initial.month === 12 ? 1 : initial.month + 1 },
            })
        ).rejects.toMatchObject({ code: 'P2002' });
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
        expect(policies.every((policy) => policy.tick === runtime!.world.getGameClockState().tick)).toBe(true);
        expect(await db.playAuditMonth.findMany({ where: { serverId, kind: 'INITIAL' } })).toEqual([initial]);
    }, 30_000);
});
