import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameClock, GAME_TICKS_PER_TURN as T, readTurnRecovery } from '@sammo-ts/common';
import {
    createGamePostgresConnector,
    readTurnRuntimeReady,
    createRedisConnector,
    GENERAL_ACCESS_PERSISTENCE_LOCK,
    CLOCK_OPERATION_PERSISTENCE_LOCK,
    GamePrisma,
    acquireGameSchemaAdvisoryXactLock,
    type GamePrismaClient,
    type RedisConnector,
} from '@sammo-ts/infra';

import { reconcileClockSuspension, startClockSuspension } from '../src/turn/clockReconciliation.js';
import { applyNextClockProjection } from '../src/turn/clockProjectionOutbox.js';
import { prepareRealtimeRecovery } from '../src/turn/prepareRealtimeRecovery.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { DatabaseTurnDaemonLease } from '../src/lifecycle/databaseTurnDaemonLease.js';

const databaseUrl = process.env.CLOCK_RECONCILIATION_DATABASE_URL;
const enabled = Boolean(databaseUrl) && Boolean(process.env.REDIS_URL);
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration('durable clock reconciliation', () => {
    let db: GamePrismaClient;
    let disconnect: (() => Promise<void>) | undefined;
    let redis: RedisConnector;

    const clean = async (): Promise<void> => {
        await redis.client.flushDb();
        await db.$transaction([
            db.readModelOutbox.deleteMany(),
            db.readModelRevision.deleteMany(),
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
        const connector = createGamePostgresConnector({ url: databaseUrl! });
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

    it('serializes Gateway opening with daemon sync and keeps the opening cursor intact', async () => {
        const baseTime = new Date('2026-09-12T00:00:00Z');
        const row = await db.worldState.create({
            data: {
                scenarioCode: 'opening-sync',
                currentYear: 180,
                currentMonth: 1,
                tickSeconds: 60,
                clockBaseTime: baseTime,
                clockWallAnchor: baseTime,
                clockTick: 0n,
                lastTurnTick: 0n,
                clockMode: 'realtime',
                clockPhase: 'PREOPEN',
                clockRevision: 3n,
                deadlineGeneration: 5n,
            },
        });
        const world = new InMemoryTurnWorld(
            {
                id: row.id,
                currentYear: 180,
                currentMonth: 1,
                tickSeconds: 60,
                lastTurnTime: baseTime,
                clockBaseTime: baseTime,
                clockWallAnchor: baseTime,
                clockTick: 0,
                lastTurnTick: 0,
                clockMode: 'realtime',
                clockPhase: 'PREOPEN',
                clockRevision: 3,
                deadlineGeneration: 5,
                meta: {},
            },
            {
                generals: [],
                cities: [],
                nations: [],
                troops: [],
                diplomacy: [],
                events: [],
                initialEvents: [],
                map: {
                    id: 'opening',
                    name: 'opening',
                    cities: [],
                    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
                },
                scenarioConfig: {
                    stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                    iconPath: '',
                    map: {},
                    const: {},
                    environment: { mapName: 'test', unitSet: 'default' },
                },
            },
            { schedule: { entries: [{ startMinute: 0, tickMinutes: 1 }] } }
        );
        const lease = await DatabaseTurnDaemonLease.connect(databaseUrl!, {
            profile: 'opening-sync',
            heartbeat: false,
        });
        expect(await lease.acquire()).not.toBeNull();
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world, { turnDaemonLease: lease });
        let releaseOpening!: () => void;
        let openingLocked!: () => void;
        const release = new Promise<void>((resolve) => {
            releaseOpening = resolve;
        });
        const locked = new Promise<void>((resolve) => {
            openingLocked = resolve;
        });
        const opening = db.$transaction(
            async (tx) => {
                await acquireGameSchemaAdvisoryXactLock(tx, CLOCK_OPERATION_PERSISTENCE_LOCK);
                await tx.worldState.update({ where: { id: row.id }, data: { clockPhase: 'RUNNING' } });
                openingLocked();
                await release;
            },
            { timeout: 10_000 }
        );
        let sync: Promise<boolean> | undefined;
        try {
            await locked;
            sync = hooks.synchronizeClockAuthority();
            // 실제 별도 connection의 advisory lock 대기를 관찰한 뒤에만 DB 오픈을 commit한다.
            const deadline = Date.now() + 5_000;
            let waiting = false;
            while (!waiting && Date.now() < deadline) {
                const rows = await db.$queryRaw<Array<{ waiting: boolean }>>(GamePrisma.sql`
                    SELECT EXISTS (
                        SELECT 1 FROM pg_locks held JOIN pg_locks pending
                          ON held.locktype = pending.locktype AND held.database = pending.database
                         AND held.classid = pending.classid AND held.objid = pending.objid
                         AND held.objsubid = pending.objsubid
                        JOIN pg_stat_activity activity ON activity.pid = held.pid
                        WHERE held.locktype = 'advisory' AND held.granted AND NOT pending.granted
                          AND activity.datname = current_database()
                    ) AS waiting
                `);
                waiting = rows[0]?.waiting ?? false;
                if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
            }
            expect(waiting).toBe(true);
            expect(world.getGameClockState().phase).toBe('PREOPEN');
            releaseOpening();
            await opening;
            await expect(sync).resolves.toBe(true);
            await expect(hooks.synchronizeClockAuthority()).resolves.toBe(false);
            expect(world.getGameClockState()).toMatchObject({
                phase: 'RUNNING',
                tick: 0,
                lastTurnTick: 0,
                revision: 3,
                deadlineGeneration: 5,
                baseTime,
                wallAnchor: baseTime,
            });
            expect(await db.worldState.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
                clockPhase: 'RUNNING',
                clockTick: 0n,
                lastTurnTick: 0n,
                clockRevision: 3n,
            });
        } finally {
            releaseOpening();
            await Promise.allSettled([opening, ...(sync ? [sync] : [])]);
            await hooks.close();
            await lease.close();
        }
    });

    it('accepts partial starts while rejecting incomplete and off-boundary DB windows', async () => {
        const row = await db.worldState.create({
            data: {
                scenarioCode: 'constraint',
                currentYear: 199,
                currentMonth: 1,
                tickSeconds: 3600,
                clockRecoveryStartTick: 1n,
                clockRecoveryEndTick: BigInt(T),
                clockRecoveryStartWallAt: new Date(),
            },
        });
        for (const data of [
            { clockRecoveryStartWallAt: null },
            { clockRecoveryEndTick: BigInt(T + 1) },
            { clockRecoveryStartTick: BigInt(T) },
            { clockRecoveryStartTick: 0n, clockRecoveryEndTick: BigInt(25 * T) },
        ]) {
            await expect(db.worldState.update({ where: { id: row.id }, data })).rejects.toThrow(
                'world_state_turn_recovery_window_check'
            );
        }
        expect((await db.worldState.findUniqueOrThrow({ where: { id: row.id } })).clockRecoveryStartTick).toBe(1n);
    });

    it.each([300, 420])('applies startup recovery after %i seconds on a 60-minute server', async (delay) => {
        const profile = 'short-startup';
        await db.worldState.create({
            data: {
                scenarioCode: profile,
                currentYear: 199,
                currentMonth: 1,
                tickSeconds: 3600,
                clockBaseTime: new Date('2026-01-01T00:00:00Z'),
                clockTick: BigInt(T / 6),
                clockWallAnchor: new Date(Date.now() - delay * 1000),
                clockMode: 'realtime',
                clockPhase: 'RUNNING',
                clockRevision: 1n,
                deadlineGeneration: 1n,
                lastTurnTick: 0n,
            },
        });
        const lease = await DatabaseTurnDaemonLease.connect(databaseUrl!, { profile, heartbeat: false });
        try {
            const token = (await lease.acquire())!;
            await prepareRealtimeRecovery(db, {
                kind: 'DAEMON',
                profileName: profile,
                ownerId: token.ownerId,
                fencingEpoch: token.fencingEpoch,
            });
            const world = await db.worldState.findFirstOrThrow();
            expect(world.clockPhase).toBe(delay < 360 ? 'RUNNING' : 'RECONCILING');
            expect(readTurnRecovery(world) === null).toBe(delay < 360);
        } finally {
            await lease.close();
        }
    });

    it.each([false, true])('fences outage recovery and reuses its window; repeated outage=%s', async (repeated) => {
        const profile = 'recovery-startup';
        await db.worldState.create({
            data: {
                scenarioCode: profile,
                currentYear: 199,
                currentMonth: 4,
                tickSeconds: 3600,
                clockBaseTime: new Date('0199-01-01T00:00:00Z'),
                clockTick: repeated ? BigInt(4 * T) : 0n,
                clockMode: 'realtime',
                clockWallAnchor: new Date(Date.now() - 4 * 3_600_000),
                lastTurnTick: repeated ? BigInt(4 * T) : 0n,
                ...(repeated
                    ? {
                          clockRecoveryStartTick: 0n,
                          clockRecoveryEndTick: BigInt(8 * T),
                          clockRecoveryStartWallAt: new Date(Date.now() - 6 * 3_600_000),
                      }
                    : {}),
                clockPhase: 'RUNNING',
                clockRevision: 1n,
                deadlineGeneration: 1n,
            },
        });
        const lease = await DatabaseTurnDaemonLease.connect(databaseUrl!, { profile, heartbeat: false });
        try {
            const token = await lease.acquire();
            expect(token).not.toBeNull();
            expect(await readTurnRuntimeReady(db, 1n)).toBe(false);
            const authority = {
                kind: 'DAEMON' as const,
                profileName: profile,
                ownerId: token!.ownerId,
                fencingEpoch: token!.fencingEpoch,
            };
            if (!repeated) {
                await prepareRealtimeRecovery(db, authority, { paused: true });
                const paused = await db.worldState.findFirstOrThrow();
                expect(paused.clockPhase).toBe('SUSPENDED');
                expect(paused.clockTick).toBe(0n);
                expect((await db.clockSuspension.findFirstOrThrow()).status).toBe('SUSPENDED');
                await prepareRealtimeRecovery(db, authority, { paused: true });
                expect((await db.worldState.findFirstOrThrow()).clockPhase).toBe('SUSPENDED');
            }
            await prepareRealtimeRecovery(db, authority);
            const pending = await db.worldState.findFirstOrThrow();
            expect(pending.clockPhase).toBe('RECONCILING');
            const recoveredWindow = readTurnRecovery(pending)!;
            expect(recoveredWindow).not.toBeNull();
            expect(recoveredWindow.endTick - recoveredWindow.startTick).toBe((repeated ? 13 : 9) * T);
            expect(await readTurnRuntimeReady(db, pending.clockRevision)).toBe(false);
            await applyNextClockProjection({ db, redis: redis.client, workerId: profile });
            await lease.markClockReady();
            expect(await readTurnRuntimeReady(db, pending.clockRevision)).toBe(true);
            expect(await readTurnRuntimeReady(db, 1n)).toBe(false);
            await lease.acquire();
            expect(await readTurnRuntimeReady(db, pending.clockRevision)).toBe(false);
            await prepareRealtimeRecovery(db, {
                kind: 'DAEMON',
                profileName: profile,
                ownerId: token!.ownerId,
                fencingEpoch: token!.fencingEpoch,
            });
            const reloaded = await db.worldState.findFirstOrThrow();
            expect(readTurnRecovery(reloaded)).toEqual(readTurnRecovery(pending));
            expect(reloaded.clockRevision).toBe(pending.clockRevision);
        } finally {
            await lease.close();
        }
    });

    it.each([4, 12, 13, 23, 24])(
        'persists recovery for %i turns and reloads the same normal boundary',
        async (turns) => {
            const now = new Date(Date.now() + 3_600_000);
            await db.worldState.create({
                data: {
                    scenarioCode: 'turn-recovery',
                    currentYear: 199,
                    currentMonth: 4,
                    tickSeconds: 3600,
                    clockBaseTime: new Date('2026-01-01T00:00:00Z'),
                    clockTick: 0n,
                    clockMode: 'realtime',
                    clockWallAnchor: now,
                    lastTurnTick: 0n,
                    clockPhase: 'RUNNING',
                    clockRevision: 1n,
                    deadlineGeneration: 1n,
                },
            });
            const generalTick = T + 199_020;
            await db.general.create({
                data: {
                    id: 26,
                    name: '냥냥',
                    turnTick: BigInt(generalTick),
                    turnTime: new Date('2026-01-01T01:00:19.902Z'),
                    meta: { purchasedPhase: true },
                },
            });
            const authority = { kind: 'OFFLINE' as const, profileName: 'recovery-test', reason: 'fixture' };
            const suspension = await startClockSuspension({
                db,
                suspensionId: 'recovery-test',
                source: 'MAINTENANCE',
                policy: turns === 4 ? 'EXACT' : 'RECOVER_TURNS',
                authority,
            });
            const resumedAt = new Date(suspension.cutWallAt.getTime() + turns * 3_600_000);
            const plan = await reconcileClockSuspension({
                db,
                suspensionId: suspension.suspensionId,
                authority,
                testResumeWallAt: resumedAt,
                upgradeMaintenancePolicy: true,
            });
            expect(plan.shiftTicks).toBe(Math.floor(turns / 12) * 12 * T);
            await applyNextClockProjection({ db, redis: redis.client, workerId: 'recovery-test' });
            const row = await db.worldState.findFirstOrThrow();
            const recovery = readTurnRecovery(row);
            const reloaded = new GameClock({
                baseTime: row.clockBaseTime!,
                tick: Number(row.clockTick),
                wallAnchor: row.clockWallAnchor!,
                mode: 'realtime',
                turnSeconds: row.tickSeconds,
                recovery,
            });
            expect(row.currentMonth).toBe(4);
            expect(row.lastTurnTick).toBe(BigInt(plan.shiftTicks));
            const general = await db.general.findUniqueOrThrow({ where: { id: 26 } });
            expect(general.turnTick).toBe(BigInt(generalTick + plan.shiftTicks));
            expect(general.turnTime.toISOString().slice(14)).toBe('00:19.902Z');
            expect(general.meta).toEqual({ purchasedPhase: true });
            if (turns % 12 === 0) {
                expect(recovery).toBeNull();
            } else {
                expect(recovery).not.toBeNull();
                const end = reloaded.tickToWallDate(recovery!.endTick);
                expect(reloaded.nowTick(end)).toBe(recovery!.endTick);
                expect(reloaded.executionRate(new Date(end.getTime() - 1))).toBe(2);
                expect(reloaded.executionRate(end)).toBe(1);
                expect(reloaded.tickToWallDate(recovery!.endTick + 199_020).getTime() - end.getTime()).toBe(19_902);
            }
            const retry = await reconcileClockSuspension({ db, suspensionId: suspension.suspensionId, authority });
            expect(retry.recovery).toEqual(plan.recovery);
            expect(retry.catchUpTicks).toBe(plan.catchUpTicks);
            expect(await applyNextClockProjection({ db, redis: redis.client, workerId: 'retry' })).toBe('IDLE');
            const announcements = await db.message.findMany({ where: { mailbox: 9999 } });
            expect(announcements).toHaveLength(recovery ? 1 : 0);
            if (recovery) {
                expect(announcements[0]!.message).toMatchObject({
                    src: { generalName: '시스템' },
                    option: {
                        recoveryStartsAt: recovery.startWallAt.toISOString(),
                        recoveryEndsAt: reloaded.tickToWallDate(recovery.endTick).toISOString(),
                    },
                });
                expect(await db.messageAction.count()).toBe(0);
                expect(
                    await db.readModelRevision.findFirst({ where: { domain: 'messages.mailbox', entityId: 9999 } })
                ).toMatchObject({ revision: 1n });
            }
        }
    );

    it.each([359999, 360000, 360001, 840000, 12 * 3600000 + 1000])(
        'persists strict recovery boundaries for %i ms',
        async (gap) => {
            const observed = T / 6;
            const future = new Date(Date.now() + 3600000);
            await db.worldState.create({
                data: {
                    scenarioCode: 'wait-boundary',
                    currentYear: 199,
                    currentMonth: 1,
                    tickSeconds: 3600,
                    clockBaseTime: new Date('2026-01-01T00:00:00Z'),
                    clockTick: BigInt(observed),
                    clockMode: 'realtime',
                    clockWallAnchor: future,
                    lastTurnTick: 0n,
                    clockPhase: 'RUNNING',
                    clockRevision: 1n,
                    deadlineGeneration: 1n,
                },
            });
            const authority = { kind: 'OFFLINE' as const, profileName: 'wait-boundary', reason: 'fixture' };
            const suspension = await startClockSuspension({
                db,
                suspensionId: 'wait-boundary',
                source: 'MAINTENANCE',
                policy: 'RECOVER_TURNS',
                authority,
            });
            const now = new Date(suspension.cutWallAt.getTime() + gap);
            const plan = await reconcileClockSuspension({
                db,
                suspensionId: suspension.suspensionId,
                authority,
                testResumeWallAt: now,
            });
            expect(plan.recovery === null).toBe(gap < 360000);
            expect(await db.message.count()).toBe(0);
            // Redis 장애 후에도 알림은 DB의 RUNNING 전이와 함께 한 번만 저장한다.
            await expect(
                applyNextClockProjection({
                    db,
                    workerId: 'failure',
                    redis: {
                        get: (key) => redis.client.get(key),
                        eval: async (script, options) => {
                            await redis.client.eval(script, options);
                            throw new Error('fixture Redis outage');
                        },
                    },
                })
            ).rejects.toThrow('fixture Redis outage');
            expect(await db.message.count()).toBe(0);
            await db.clockProjectionOutbox.updateMany({ data: { availableAt: new Date(0) } });
            expect(await applyNextClockProjection({ db, redis: redis.client, workerId: 'retry' })).toBe('RECOVERED');
            const row = await db.worldState.findFirstOrThrow();
            const recovery = readTurnRecovery(row);
            expect(await db.message.count()).toBe(recovery ? 1 : 0);
            const clock = new GameClock({
                baseTime: row.clockBaseTime!,
                tick: Number(row.clockTick),
                wallAnchor: row.clockWallAnchor!,
                turnSeconds: row.tickSeconds,
                mode: 'realtime',
                recovery,
            });
            if (recovery) {
                expect(row.clockWallAnchor).toEqual(recovery.startWallAt);
                expect(clock.nowTick(now)).toBe(observed + plan.shiftTicks);
                expect(clock.nowTick(new Date(recovery.startWallAt.getTime() - 1))).toBe(observed + plan.shiftTicks);
                const end = clock.tickToWallDate(recovery.endTick);
                expect(clock.nowTick(end)).toBe(clock.normalNowTick(end));
            } else {
                expect(clock.nowTick(now)).toBe(observed + gap * 10);
            }
            expect(await applyNextClockProjection({ db, redis: redis.client, workerId: 'done' })).toBe('IDLE');
            expect(await db.message.count()).toBe(recovery ? 1 : 0);
        }
    );

    it.each([3_142_625, 6 * 3_600_000 + 3_142_625])(
        'preserves purchased turn phases and the execution cursor after %i ms maintenance and reload',
        async (gapMilliseconds) => {
            const baseTime = new Date('2026-09-06T00:00:00.000Z');
            const initialTick = 5 * 36_000_000 + 28_879_860;
            const clock = new GameClock({
                baseTime,
                tick: initialTick,
                mode: 'realtime',
                wallAnchor: new Date(Date.now() + 3_600_000),
                turnSeconds: 3_600,
                phase: 'RUNNING',
            });
            const lastTurnTick = 5 * 36_000_000;
            // 냥냥과 같은 00:19.902 구매 시각. 5시 턴은 이미 처리되어 다음은 6시다.
            const nextTicks = [6 * 36_000_000 + 199_020, 6 * 36_000_000 + 420_010];
            await db.worldState.create({
                data: {
                    scenarioCode: 'maintenance-phase',
                    currentYear: 199,
                    currentMonth: 2,
                    tickSeconds: 3_600,
                    clockBaseTime: baseTime,
                    clockTick: BigInt(initialTick),
                    clockMode: 'realtime',
                    clockWallAnchor: clock.wallAnchor,
                    lastTurnTick: BigInt(lastTurnTick),
                    clockPhase: 'RUNNING',
                    clockRevision: 1n,
                    deadlineGeneration: 1n,
                },
            });
            await db.general.createMany({
                data: nextTicks.map((tick, index) => ({
                    id: index + 1,
                    name: `purchased-${index}`,
                    turnTick: BigInt(tick),
                    turnTime: clock.tickToDate(tick),
                    lastTurn: { command: '휴식' },
                    meta: { killturn: 24 },
                })),
            });
            const authority = { kind: 'OFFLINE' as const, profileName: 'maintenance-phase', reason: 'fixture' };
            const suspended = await startClockSuspension({
                db,
                suspensionId: 'maintenance-phase',
                source: 'MAINTENANCE',
                policy: 'PRESERVE_SCHEDULE',
                authority,
            });
            const plan = await reconcileClockSuspension({
                db,
                suspensionId: suspended.suspensionId,
                authority,
                testResumeWallAt: new Date(suspended.cutWallAt.getTime() + gapMilliseconds),
            });
            const expectedShift = 0;
            expect(plan.shiftTicks).toBe(expectedShift);
            expect(plan.catchUpTicks).toBe(gapMilliseconds * 10);
            expect(await applyNextClockProjection({ db, redis: redis.client, workerId: 'phase-test' })).not.toBe(
                'IDLE'
            );
            const reload = createGamePostgresConnector({ url: databaseUrl! });
            try {
                const world = await reload.prisma.worldState.findFirstOrThrow();
                const generals = await reload.prisma.general.findMany({ orderBy: { id: 'asc' } });
                expect(world).toMatchObject({
                    clockPhase: 'RUNNING',
                    currentYear: 199,
                    currentMonth: 2,
                    lastTurnTick: BigInt(lastTurnTick + expectedShift),
                });
                expect(generals.map((general) => Number(general.turnTick))).toEqual(
                    nextTicks.map((tick) => tick + expectedShift)
                );
                expect(generals.map((general) => general.turnTime.toISOString().slice(14))).toEqual([
                    '00:19.902Z',
                    '00:42.001Z',
                ]);
                expect(generals.map((general) => general.meta)).toEqual([{ killturn: 24 }, { killturn: 24 }]);
                // 미처리된 다음 턴만 남고, 처리한 5시 턴을 다시 만들지 않는다.
                expect(Number(generals[0]!.turnTick)).toBeGreaterThan(Number(world.lastTurnTick));
                expect((await reload.prisma.clockSuspension.findFirstOrThrow()).status).toBe('APPLIED');
            } finally {
                await reload.disconnect();
            }
        }
    );

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
