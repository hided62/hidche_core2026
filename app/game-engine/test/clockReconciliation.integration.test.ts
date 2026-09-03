import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameClock } from '@sammo-ts/common';
import {
    createGamePostgresConnector,
    createRedisConnector,
    GENERAL_ACCESS_PERSISTENCE_LOCK,
    GamePrisma,
    acquireGameSchemaAdvisoryXactLock,
    type GamePrismaClient,
    type RedisConnector,
} from '@sammo-ts/infra';

import { reconcileClockSuspension, startClockSuspension } from '../src/turn/clockReconciliation.js';
import { applyNextClockProjection } from '../src/turn/clockProjectionOutbox.js';

const enabled =
    process.env.CLOCK_RECONCILIATION_INTEGRATION === '1' &&
    Boolean(process.env.DATABASE_URL) &&
    Boolean(process.env.REDIS_URL);
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration('durable clock reconciliation', () => {
    let db: GamePrismaClient;
    let disconnect: (() => Promise<void>) | undefined;
    let redis: RedisConnector;

    const clean = async (): Promise<void> => {
        await redis.client.flushDb();
        await db.$transaction([
            db.clockProjectionOutbox.deleteMany(),
            db.clockReconciliationParticipant.deleteMany(),
            db.clockSuspension.deleteMany(),
            db.inputEvent.deleteMany(),
            db.vote.deleteMany(),
            db.voteComment.deleteMany(),
            db.votePoll.deleteMany(),
            db.message.deleteMany(),
            db.auctionBid.deleteMany(),
            db.auction.deleteMany(),
            db.npcSelectionToken.deleteMany(),
            db.selectPoolEntry.deleteMany(),
            db.general.deleteMany(),
            db.turnDaemonLease.deleteMany(),
            db.worldState.deleteMany(),
        ]);
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: process.env.DATABASE_URL! });
        db = connector.prisma;
        disconnect = connector.disconnect;
        redis = createRedisConnector({ url: process.env.REDIS_URL! });
        await redis.connect();
    });

    afterAll(async () => {
        await clean();
        await redis.disconnect();
        await disconnect?.();
    });

    beforeEach(async () => {
        await clean();
    });

    it('preserves every remaining deadline and occurrence across a 65m17.250s exact gap', async () => {
        const baseTime = new Date('2026-01-01T00:00:00.000Z');
        const futureAnchor = new Date(Date.now() + 3_600_000);
        const initialTick = 1_000_000;
        const lastTurnTick = 900_000;
        const clock = new GameClock({
            baseTime,
            tick: initialTick,
            mode: 'realtime',
            wallAnchor: futureAnchor,
            turnSeconds: 600,
            phase: 'RUNNING',
            revision: 1,
        });
        const generalTicks = [initialTick + 1_234, initialTick + 36_000_123];
        const reselectionTick = initialTick + 54_000_456;
        const auctionCloseTick = initialTick + 72_000_777;
        const messageOccurrenceTick = initialTick - 500;
        const messageExpiryTick = initialTick + 90_000_999;
        const voteStartTick = initialTick - 200;
        const voteEndTick = initialTick + 18_000_321;
        const poolTick = initialTick + 2_000_111;
        const npcValidTick = initialTick + 3_000_222;
        const npcMoreTick = initialTick + 1_000_333;

        const world = await db.worldState.create({
            data: {
                scenarioCode: 'clock-test',
                currentYear: 180,
                currentMonth: 1,
                tickSeconds: 600,
                clockBaseTime: baseTime,
                clockTick: BigInt(initialTick),
                clockMode: 'realtime',
                clockWallAnchor: futureAnchor,
                lastTurnTick: BigInt(lastTurnTick),
                clockPhase: 'RUNNING',
                clockRevision: 1n,
                deadlineGeneration: 7n,
                meta: {
                    lastTurnTime: clock.tickToDate(lastTurnTick).toISOString(),
                    starttime: clock.tickToDate(initialTick + 100).toISOString(),
                },
            },
        });
        await db.general.createMany({
            data: generalTicks.map((turnTick, index) => ({
                id: index + 1,
                name: `general-${index + 1}`,
                turnTick: BigInt(turnTick),
                turnTime: clock.tickToDate(turnTick),
                recentWarTick: BigInt(initialTick - 100 - index),
                recentWarTime: clock.tickToDate(initialTick - 100 - index),
                meta:
                    index === 0
                        ? {
                              next_change_tick: reselectionTick,
                              next_change: clock.tickToDate(reselectionTick).toISOString(),
                              nextChangeAt: clock.tickToDate(reselectionTick).toISOString(),
                          }
                        : {},
            })),
        });
        await db.auction.create({
            data: {
                type: 'BUY_RICE',
                hostGeneralId: 1,
                status: 'FINALIZING',
                openTick: BigInt(initialTick - 300),
                closeTick: BigInt(auctionCloseTick),
                closeAt: clock.tickToDate(auctionCloseTick),
            },
        });
        await db.message.create({
            data: {
                mailbox: 1,
                type: 'private',
                src: 1,
                dest: 2,
                time: clock.tickToDate(messageOccurrenceTick),
                timeTick: BigInt(messageOccurrenceTick),
                validUntil: clock.tickToDate(messageExpiryTick),
                validUntilTick: BigInt(messageExpiryTick),
                createdAtWall: new Date('2026-01-01T12:34:56.789Z'),
                deleteUntilWall: new Date('2026-01-01T12:39:56.789Z'),
                occurredGameTick: BigInt(messageOccurrenceTick),
                message: {},
                action: {
                    create: {
                        actionType: 'scout',
                        status: 'PENDING',
                        createdGameTick: BigInt(messageOccurrenceTick),
                        expiresGameTick: BigInt(messageExpiryTick),
                        clockRevision: 1n,
                        deadlineGeneration: 7n,
                    },
                },
            },
        });
        await db.votePoll.create({
            data: {
                title: 'clock vote',
                options: ['yes', 'no'],
                revealMode: 'AFTER_VOTE',
                openerGeneralId: 1,
                openerName: 'general-1',
                startAt: clock.tickToDate(voteStartTick),
                startTick: BigInt(voteStartTick),
                endAt: clock.tickToDate(voteEndTick),
                endTick: BigInt(voteEndTick),
            },
        });
        await db.selectPoolEntry.create({
            data: {
                uniqueName: 'clock-pool',
                reservedUntil: clock.tickToDate(poolTick),
                reservedUntilTick: BigInt(poolTick),
                info: {},
            },
        });
        await db.npcSelectionToken.create({
            data: {
                ownerUserId: 'clock-user',
                validUntil: clock.tickToDate(npcValidTick),
                validUntilTick: BigInt(npcValidTick),
                pickMoreFrom: clock.tickToDate(npcMoreTick),
                pickMoreFromTick: BigInt(npcMoreTick),
                pickResult: [],
                nonce: 1,
            },
        });

        const authority = { kind: 'OFFLINE' as const, profileName: 'clock-test', reason: 'integration fixture' };
        const suspended = await startClockSuspension({
            db,
            suspensionId: 'clock-gap-65m17s250',
            source: 'MAINTENANCE',
            authority,
        });
        expect(suspended.cutTick).toBe(initialTick);
        expect((await db.worldState.findUniqueOrThrow({ where: { id: world.id } })).clockPhase).toBe('SUSPENDED');

        const resumeWallAt = new Date(suspended.cutWallAt.getTime() + 65 * 60_000 + 17_250);
        const reconciled = await reconcileClockSuspension({
            db,
            suspensionId: suspended.suspensionId,
            authority,
            testResumeWallAt: resumeWallAt,
        });
        expect(reconciled).toMatchObject({
            phase: 'RECONCILING',
            sourceRevision: 1,
            targetRevision: 2,
            deadlineGeneration: 8,
            gapTicks: 235_035_000,
            shiftTicks: 235_035_000,
            alignedTick: 236_035_000,
        });

        const [afterWorld, generals, auction, message, messageAction, vote, pool, token, ledger, outboxes] =
            await Promise.all([
            db.worldState.findUniqueOrThrow({ where: { id: world.id } }),
            db.general.findMany({ orderBy: { id: 'asc' } }),
            db.auction.findFirstOrThrow(),
            db.message.findFirstOrThrow(),
            db.messageAction.findFirstOrThrow(),
            db.votePoll.findFirstOrThrow(),
            db.selectPoolEntry.findFirstOrThrow(),
            db.npcSelectionToken.findFirstOrThrow(),
            db.clockSuspension.findUniqueOrThrow({ where: { id: suspended.suspensionId } }),
            db.clockProjectionOutbox.findMany(),
            ]);
        const alignedTick = BigInt(reconciled.alignedTick);
        expect(afterWorld).toMatchObject({
            clockPhase: 'RECONCILING',
            clockRevision: 2n,
            deadlineGeneration: 8n,
            clockTick: alignedTick,
            lastTurnTick: BigInt(lastTurnTick + reconciled.shiftTicks),
        });
        expect(generals.map((general) => general.turnTick! - alignedTick)).toEqual(
            generalTicks.map((tick) => BigInt(tick - initialTick))
        );
        const shiftedReselectionMeta = generals[0]!.meta as Record<string, unknown>;
        expect(shiftedReselectionMeta.next_change_tick).toBe(reselectionTick + reconciled.shiftTicks);
        expect(new Date(String(shiftedReselectionMeta.next_change)).getTime()).toBe(
            clock.tickToDate(reselectionTick).getTime() + 65 * 60_000 + 17_250
        );
        expect(auction.closeTick! - alignedTick).toBe(BigInt(auctionCloseTick - initialTick));
        expect(message.validUntilTick! - alignedTick).toBe(BigInt(messageExpiryTick - initialTick));
        expect(messageAction.expiresGameTick! - alignedTick).toBe(BigInt(messageExpiryTick - initialTick));
        expect(messageAction.createdGameTick).toBe(BigInt(messageOccurrenceTick));
        expect(messageAction.clockRevision).toBe(2n);
        expect(messageAction.deadlineGeneration).toBe(8n);
        expect(message.createdAtWall).toEqual(new Date('2026-01-01T12:34:56.789Z'));
        expect(message.deleteUntilWall).toEqual(new Date('2026-01-01T12:39:56.789Z'));
        expect(vote.endTick! - alignedTick).toBe(BigInt(voteEndTick - initialTick));
        expect(pool.reservedUntilTick! - alignedTick).toBe(BigInt(poolTick - initialTick));
        expect(token.validUntilTick! - alignedTick).toBe(BigInt(npcValidTick - initialTick));
        expect(token.pickMoreFromTick! - alignedTick).toBe(BigInt(npcMoreTick - initialTick));
        expect(generals.map((general) => general.recentWarTick)).toEqual([
            BigInt(initialTick - 100),
            BigInt(initialTick - 101),
        ]);
        expect(auction.openTick).toBe(BigInt(initialTick - 300));
        expect(message.timeTick).toBe(BigInt(messageOccurrenceTick));
        expect(vote.startTick).toBe(BigInt(voteStartTick));
        expect(ledger.status).toBe('RECONCILING');
        expect(outboxes).toHaveLength(1);
        expect(outboxes[0]).toMatchObject({ status: 'PENDING', targetRevision: 2n });

        const retried = await reconcileClockSuspension({
            db,
            suspensionId: suspended.suspensionId,
            authority,
            testResumeWallAt: new Date(resumeWallAt.getTime() + 10_000),
        });
        expect(retried).toEqual(reconciled);
        expect(await db.clockProjectionOutbox.count()).toBe(1);
        const keepParticipants = await db.clockReconciliationParticipant.findMany({ where: { policy: 'KEEP' } });
        expect(keepParticipants.every((participant) => participant.beforeChecksum === participant.afterChecksum)).toBe(
            true
        );

        await redis.client.set('sammo:clock-test:clock:active-revision', '1');
        expect(await applyNextClockProjection({ db, redis: redis.client, workerId: 'clock-projection-success' })).toBe(
            'APPLIED'
        );
        expect(await redis.client.get('sammo:clock-test:clock:active-revision')).toBe('2');
        expect(await redis.client.get('sammo:clock-test:clock:deadline-generation')).toBe('8');
        expect(await redis.client.get('sammo:clock-test:clock:phase')).toBe('RUNNING');
        expect(await redis.client.zRangeWithScores('sammo:clock-test:auction:timer', 0, -1)).toEqual([
            { value: String(auction.id), score: Number(auction.closeTick) },
        ]);
        expect(await db.worldState.findUniqueOrThrow({ where: { id: world.id } })).toMatchObject({
            clockPhase: 'RUNNING',
            clockRevision: 2n,
        });
        expect(await db.clockProjectionOutbox.findFirstOrThrow()).toMatchObject({ status: 'APPLIED' });
    });

    it('rejects a live offline fence and preserves a turn deadline across an exact 24-hour gap', async () => {
        const baseTime = new Date('2026-02-01T00:00:00.000Z');
        const futureAnchor = new Date(Date.now() + 3_600_000);
        const initialTick = 5 * 36_000_000;
        const turnTick = initialTick + 17_000_007;
        const clock = new GameClock({
            baseTime,
            tick: initialTick,
            mode: 'realtime',
            wallAnchor: futureAnchor,
            turnSeconds: 3_600,
            phase: 'RUNNING',
        });
        await db.worldState.create({
            data: {
                scenarioCode: 'clock-day-test',
                currentYear: 180,
                currentMonth: 1,
                tickSeconds: 3_600,
                clockBaseTime: baseTime,
                clockTick: BigInt(initialTick),
                clockMode: 'realtime',
                clockWallAnchor: futureAnchor,
                lastTurnTick: BigInt(initialTick),
                clockPhase: 'RUNNING',
                clockRevision: 3n,
                deadlineGeneration: 2n,
            },
        });
        await db.general.create({
            data: { id: 1, name: 'day-general', turnTick: BigInt(turnTick), turnTime: clock.tickToDate(turnTick) },
        });
        const wallMessageCreatedAt = new Date('2026-01-15T12:00:00.000Z');
        const wallMessageDeleteUntil = new Date('2026-01-15T12:05:00.000Z');
        const wallMessage = await db.message.create({
            data: {
                mailbox: 0,
                type: 'public',
                src: 1,
                dest: 0,
                time: wallMessageCreatedAt,
                validUntil: new Date('9999-12-31T00:00:00.000Z'),
                createdAtWall: wallMessageCreatedAt,
                deleteUntilWall: wallMessageDeleteUntil,
                message: { src: {}, dest: {}, text: 'wall clock survives 24h suspension', option: {} },
            },
        });
        await db.turnDaemonLease.create({
            data: {
                profile: 'clock-day-test',
                ownerId: 'other-daemon',
                fencingEpoch: 9n,
                leaseUntil: new Date(Date.now() + 60_000),
            },
        });
        const authority = {
            kind: 'OFFLINE' as const,
            profileName: 'clock-day-test',
            reason: '24-hour integration fixture',
        };
        await expect(
            startClockSuspension({
                db,
                suspensionId: 'clock-gap-24h',
                source: 'MAINTENANCE',
                authority,
            })
        ).rejects.toThrow('daemon lease to be offline');
        await db.turnDaemonLease.delete({ where: { profile: 'clock-day-test' } });
        const suspended = await startClockSuspension({
            db,
            suspensionId: 'clock-gap-24h',
            source: 'MAINTENANCE',
            authority,
        });
        const reconciled = await reconcileClockSuspension({
            db,
            suspensionId: suspended.suspensionId,
            authority,
            testResumeWallAt: new Date(suspended.cutWallAt.getTime() + 24 * 60 * 60_000),
        });

        expect(reconciled).toMatchObject({
            sourceRevision: 3,
            targetRevision: 4,
            gapTicks: 24 * 36_000_000,
            shiftTicks: 24 * 36_000_000,
            alignedTick: initialTick + 24 * 36_000_000,
        });
        const shifted = await db.general.findUniqueOrThrow({ where: { id: 1 } });
        expect(shifted.turnTick! - BigInt(reconciled.alignedTick)).toBe(BigInt(turnTick - initialTick));
        await expect(db.message.findUniqueOrThrow({ where: { id: wallMessage.id } })).resolves.toMatchObject({
            createdAtWall: wallMessageCreatedAt,
            deleteUntilWall: wallMessageDeleteUntil,
        });

        await redis.client.set('sammo:clock-day-test:clock:active-revision', '3');
        const redisThenCrash = {
            get: redis.client.get.bind(redis.client),
            eval: async (script: string, options: { keys: string[]; arguments: string[] }) => {
                await redis.client.eval(script, options);
                throw new Error('fixture crash after Redis commit');
            },
        };
        await expect(
            applyNextClockProjection({ db, redis: redisThenCrash, workerId: 'clock-projection-crash' })
        ).rejects.toThrow('fixture crash after Redis commit');
        expect(await redis.client.get('sammo:clock-day-test:clock:active-revision')).toBe('4');
        expect(await db.worldState.findFirstOrThrow()).toMatchObject({ clockPhase: 'RECONCILING' });
        expect(await db.clockProjectionOutbox.findFirstOrThrow()).toMatchObject({ status: 'FAILED', attempts: 1 });

        await db.clockProjectionOutbox.updateMany({ data: { availableAt: new Date(0) } });
        expect(await applyNextClockProjection({ db, redis: redis.client, workerId: 'clock-projection-restart' })).toBe(
            'RECOVERED'
        );
        expect(await db.worldState.findFirstOrThrow()).toMatchObject({ clockPhase: 'RUNNING', clockRevision: 4n });
        expect(await db.clockProjectionOutbox.findFirstOrThrow()).toMatchObject({ status: 'APPLIED', attempts: 2 });
    });

    it('uses DB wall time despite host drift and does not deadlock with a general-access writer', async () => {
        const [dbWall] = await db.$queryRaw<Array<{ now: Date }>>(GamePrisma.sql`
            SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::timestamp(3) AS now
        `);
        const baseTime = new Date('2026-03-01T00:00:00.000Z');
        const clock = new GameClock({
            baseTime,
            tick: 42,
            mode: 'realtime',
            wallAnchor: dbWall!.now,
            turnSeconds: 600,
            phase: 'RUNNING',
            revision: 1,
        });
        const world = await db.worldState.create({
            data: {
                scenarioCode: 'clock-drift-deadlock-test',
                currentYear: 180,
                currentMonth: 1,
                tickSeconds: 600,
                clockBaseTime: baseTime,
                clockTick: 42n,
                clockMode: 'realtime',
                clockWallAnchor: dbWall!.now,
                lastTurnTick: 42n,
                clockPhase: 'RUNNING',
                clockRevision: 1n,
                deadlineGeneration: 1n,
            },
        });
        await db.general.create({
            data: { id: 1, name: 'lock-general', turnTick: 100n, turnTime: clock.tickToDate(100) },
        });

        let releaseWriter!: () => void;
        let signalWriterLocked!: () => void;
        const writerLocked = new Promise<void>((resolve) => {
            signalWriterLocked = resolve;
        });
        const writerRelease = new Promise<void>((resolve) => {
            releaseWriter = resolve;
        });
        const writer = db.$transaction(async (transaction) => {
            await acquireGameSchemaAdvisoryXactLock(transaction, GENERAL_ACCESS_PERSISTENCE_LOCK);
            signalWriterLocked();
            await writerRelease;
            await transaction.$queryRaw(GamePrisma.sql`
                SELECT id FROM world_state WHERE id = ${world.id} FOR UPDATE
            `);
        });
        await writerLocked;
        const dateNow = vi.spyOn(Date, 'now').mockReturnValue(dbWall!.now.getTime() + 12 * 60 * 60_000);
        try {
            const suspensionPromise = startClockSuspension({
                db,
                suspensionId: 'clock-host-drift-deadlock',
                source: 'MAINTENANCE',
                authority: { kind: 'OFFLINE', profileName: 'clock-drift-deadlock-test', reason: 'fixture' },
            });
            releaseWriter();
            const suspension = await Promise.race([
                Promise.all([writer, suspensionPromise]).then(([, result]) => result),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('general-access/clock-operation deadlock')), 5_000)
                ),
            ]);
            expect(Math.abs(suspension.cutWallAt.getTime() - dbWall!.now.getTime())).toBeLessThan(5_000);
            expect(suspension.cutTick).toBeGreaterThanOrEqual(42);
            expect(suspension.cutTick).toBeLessThan(42 + 60 * 60_000);
        } finally {
            dateNow.mockRestore();
            releaseWriter();
        }
    });
});
