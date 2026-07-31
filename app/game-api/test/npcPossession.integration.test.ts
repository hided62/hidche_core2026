import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { createTurnDaemonRuntime, seedScenarioToDatabase, type TurnDaemonRuntime } from '@sammo-ts/game-engine';
import { createGamePostgresConnector, GamePrisma, type GamePrismaClient, type RedisConnector } from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import { InMemoryBattleSimTransport } from '../src/battleSim/inMemoryTransport.js';
import type { GameApiContext } from '../src/context.js';
import { DatabaseTurnDaemonTransport } from '../src/daemon/databaseTransport.js';
import type { TurnDaemonTransport } from '../src/daemon/transport.js';
import { appRouter } from '../src/router.js';

const databaseUrl = process.env.NPC_POSSESSION_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const profile = 'hwe:2';
const userId = 'npc-possession-integration-user';
const otherUserId = 'npc-possession-integration-other';
const failureUserId = 'npc-possession-integration-failure';
const rejectedUserId = 'npc-possession-integration-rejected';
const delayedUserId = 'npc-possession-integration-delayed';
const cleanupUserId = 'npc-possession-integration-cleanup';
const raceUserId = 'npc-possession-integration-race';
const schemaName = databaseUrl ? (new URL(databaseUrl).searchParams.get('schema') ?? '') : '';

const assertDedicatedDatabase = (rawUrl: string): void => {
    const schema = new URL(rawUrl).searchParams.get('schema');
    if (!schema?.endsWith('npc_possession_integration')) {
        throw new Error(`Refusing to mutate non-dedicated schema: ${schema ?? '(missing)'}`);
    }
    if (!/^[a-z0-9_]+$/.test(schema)) {
        throw new Error(`Refusing unsafe schema name: ${schema}`);
    }
};

const buildAuth = (id: string, displayName: string, legacyMemberNo: number): GameSessionTokenPayload => ({
    version: 1,
    profile,
    issuedAt: '2026-07-31T00:00:00.000Z',
    expiresAt: '2026-08-31T00:00:00.000Z',
    sessionId: `npc-possession-${id}`,
    user: {
        id,
        username: id,
        displayName,
        roles: ['user'],
        legacyMemberNo,
    },
    sanctions: {
        legacyPenalty: {
            any: {
                ban: { expire: 4_102_444_800, value: 1 },
                expired: { expire: 1, value: 9 },
            },
            hwe: {
                ban: { expire: 4_102_444_800, value: 2 },
                chat: { expire: 4_102_444_800, value: 3 },
            },
        },
    },
    identity: {
        kakaoVerified: true,
        canCreateGeneral: true,
        requiresKakaoVerification: false,
        graceEndsAt: null,
    },
});

integration('mode 1 NPC possession through token reservation and the durable daemon', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;
    let runtime: TurnDaemonRuntime | undefined;
    let daemonLoop: Promise<void> | undefined;
    let turnDaemon: TurnDaemonTransport;

    const auth = buildAuth(userId, '빙의사용자', 7_701);
    const otherAuth = buildAuth(otherUserId, '다른사용자', 7_702);
    const failureAuth = buildAuth(failureUserId, '재시도사용자', 7_703);
    const rejectedAuth = buildAuth(rejectedUserId, '거절사용자', 7_704);
    const delayedAuth = buildAuth(delayedUserId, '지연사용자', 7_705);
    const cleanupAuth = buildAuth(cleanupUserId, '정리사용자', 7_706);
    const raceAuth = buildAuth(raceUserId, '경합사용자', 7_707);

    const buildContext = (requestId: string, actorAuth: GameSessionTokenPayload = auth): GameApiContext => {
        const redisClient = {
            get: async () => null,
            set: async () => null,
        };
        return {
            requestId,
            db,
            redis: redisClient as unknown as RedisConnector['client'],
            turnDaemon,
            battleSim: new InMemoryBattleSimTransport(),
            profile: { id: 'hwe', scenario: '2', name: profile },
            uploadDir: 'uploads',
            uploadPath: '/uploads',
            uploadPublicUrl: null,
            auth: actorAuth,
            accessTokenStore: new RedisAccessTokenStore(redisClient, profile),
            flushStore: new InMemoryFlushStore(),
            gameTokenSecret: 'npc-possession-test-secret',
        };
    };

    const stopRuntime = async (reason: string): Promise<void> => {
        if (!runtime) return;
        await runtime.lifecycle.stop(reason);
        await daemonLoop;
        await runtime.close();
        runtime = undefined;
        daemonLoop = undefined;
    };

    const startRuntime = async (ownerId: string): Promise<void> => {
        runtime = await createTurnDaemonRuntime({
            profile,
            databaseUrl: databaseUrl!,
            enableDatabaseFlush: true,
            enableLeaseHeartbeat: false,
            leaseOwnerId: ownerId,
        });
        turnDaemon = new DatabaseTurnDaemonTransport(db, 10_000);
        daemonLoop = runtime.lifecycle.start();
        await expect(turnDaemon.requestStatus(10_000)).resolves.toMatchObject({
            state: expect.any(String),
        });
    };

    beforeAll(async () => {
        assertDedicatedDatabase(databaseUrl!);
        const previousSeed = process.env.INTEGRATION_WORLD_SEED;
        process.env.INTEGRATION_WORLD_SEED = 'npc-possession-integration-seed';
        try {
            await seedScenarioToDatabase({
                scenarioId: 2,
                databaseUrl: databaseUrl!,
                now: new Date('2099-07-31T12:00:00.000Z'),
                installOptions: {
                    turnTermMinutes: 5,
                    npcMode: 1,
                    showImgLevel: 3,
                    serverId: profile,
                    season: 1,
                },
            });
        } finally {
            if (previousSeed === undefined) {
                delete process.env.INTEGRATION_WORLD_SEED;
            } else {
                process.env.INTEGRATION_WORLD_SEED = previousSeed;
            }
        }
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.inputEvent.deleteMany();
        await db.logEntry.deleteMany();
        await db.npcSelectionToken.deleteMany();
        const city = await db.city.findFirstOrThrow({ orderBy: { id: 'asc' } });
        await db.general.createMany({
            data: Array.from({ length: 24 }, (_, index) => ({
                id: index + 1,
                userId: null,
                name: `빙의후보${index + 1}`,
                nationId: 0,
                cityId: city.id,
                npcState: 2,
                leadership: 40 + index,
                strength: 50 + index,
                intel: 60 + index,
                turnTime: new Date('2099-07-31T12:05:00.000Z'),
                personalCode: 'che_안전',
                specialCode: 'che_인덕',
                special2Code: 'che_무쌍',
                picture: 'default.jpg',
                imageServer: 0,
                meta: { killturn: 6 },
                penalty: {},
            })),
        });
        await startRuntime('npc-possession-integration-daemon');
    }, 60_000);

    afterAll(async () => {
        await stopRuntime('npc possession integration complete');
        await closeDb?.();
    }, 30_000);

    it('reserves at most five exact type-2 NPCs and preserves Ref refresh/keep timing', async () => {
        const config = await appRouter.createCaller(buildContext('npc-possession-config')).join.getConfig();
        expect(config.npcPossession).toEqual({ enabled: true });

        const [first, concurrentSameOwner] = await Promise.all([
            appRouter.createCaller(buildContext('npc-possession-token-a')).join.listPossessCandidates({}),
            appRouter.createCaller(buildContext('npc-possession-token-concurrent')).join.listPossessCandidates({}),
        ]);
        expect(concurrentSameOwner).toEqual(first);
        expect(await db.npcSelectionToken.count({ where: { ownerUserId: userId } })).toBe(1);
        expect(first.candidates.length).toBeGreaterThan(0);
        expect(first.candidates.length).toBeLessThanOrEqual(5);
        expect(new Set(first.candidates.map(({ id }) => id)).size).toBe(first.candidates.length);
        expect(first.pickMoreSeconds).toBe(0);
        expect(first.candidates.every(({ keepCount }) => keepCount === 3)).toBe(true);
        const rows = await db.general.findMany({
            where: { id: { in: first.candidates.map(({ id }) => id) } },
            select: { id: true, userId: true, npcState: true },
        });
        expect(rows).toHaveLength(first.candidates.length);
        expect(rows.every((row) => row.userId === null && row.npcState === 2)).toBe(true);

        const reused = await appRouter
            .createCaller(buildContext('npc-possession-token-b'))
            .join.listPossessCandidates({});
        expect(reused).toEqual(first);

        const kept = first.candidates[0]!;
        const refreshed = await appRouter
            .createCaller(buildContext('npc-possession-token-refresh'))
            .join.listPossessCandidates({ refresh: true, keepIds: [kept.id] });
        expect(refreshed.tokenNonce).not.toBe(first.tokenNonce);
        expect(refreshed.pickMoreSeconds).toBeGreaterThan(0);
        expect(refreshed.candidates.find(({ id }) => id === kept.id)?.keepCount).toBe(2);

        await expect(
            appRouter
                .createCaller(buildContext('npc-possession-token-too-early'))
                .join.listPossessCandidates({ refresh: true, keepIds: [] })
        ).rejects.toMatchObject({
            code: 'PRECONDITION_FAILED',
            message: '아직 다시 뽑을 수 없습니다',
        });

        const other = await appRouter
            .createCaller(buildContext('npc-possession-token-other', otherAuth))
            .join.listPossessCandidates({});
        const firstIds = new Set(refreshed.candidates.map(({ id }) => id));
        expect(other.candidates.some(({ id }) => firstIds.has(id))).toBe(false);
    }, 30_000);

    it('commits exactly one of two concurrent picks and keeps retry, logs, token and reload atomic', async () => {
        const reservation = await appRouter
            .createCaller(buildContext('npc-possession-token-current'))
            .join.listPossessCandidates({});
        const firstCandidate = reservation.candidates[0]!;
        const secondCandidate = reservation.candidates[1]!;
        const firstClientRequestId = '11111111-1111-4111-8111-111111111111';
        const secondClientRequestId = '22222222-2222-4222-8222-222222222222';
        const firstInput = {
            generalId: firstCandidate.id,
            tokenNonce: reservation.tokenNonce,
            clientRequestId: firstClientRequestId,
        };
        const secondInput = {
            generalId: secondCandidate.id,
            tokenNonce: reservation.tokenNonce,
            clientRequestId: secondClientRequestId,
        };
        const concurrent = await Promise.allSettled([
            appRouter.createCaller(buildContext('npc-possession-http-a')).join.possessGeneral(firstInput),
            appRouter.createCaller(buildContext('npc-possession-http-b')).join.possessGeneral(secondInput),
        ]);
        expect(concurrent.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
        expect(concurrent.filter(({ status }) => status === 'rejected')).toHaveLength(1);
        const fulfilledIndex = concurrent.findIndex(({ status }) => status === 'fulfilled');
        const candidate = fulfilledIndex === 0 ? firstCandidate : secondCandidate;
        const input = fulfilledIndex === 0 ? firstInput : secondInput;
        const clientRequestId = input.clientRequestId;
        const first = concurrent[fulfilledIndex]!;
        if (first.status !== 'fulfilled') {
            throw new Error('Exactly one NPC possession must succeed.');
        }
        const retried = await appRouter
            .createCaller(buildContext('npc-possession-http-retry'))
            .join.possessGeneral(input);
        expect(retried).toEqual(first.value);

        const persisted = await db.general.findUniqueOrThrow({ where: { id: candidate.id } });
        expect(persisted).toMatchObject({
            userId,
            npcState: 1,
            penalty: {
                ban: 2,
                chat: 3,
            },
        });
        expect(persisted.meta).toMatchObject({
            npc_org: 2,
            ownerName: '빙의사용자',
            owner_name: '빙의사용자',
            killturn: 6,
            defence_train: 80,
            permission: 'normal',
        });
        expect(runtime!.world.getGeneralById(candidate.id)).toMatchObject({
            userId,
            npcState: 1,
            penalty: {
                ban: 2,
                chat: 3,
            },
        });
        expect(await db.general.count({ where: { userId } })).toBe(1);
        expect(await db.npcSelectionToken.findUnique({ where: { ownerUserId: userId } })).toBeNull();
        const access = await db.generalAccessLog.findUniqueOrThrow({ where: { generalId: candidate.id } });
        expect(access).toMatchObject({
            userId,
            refresh: 0,
            refreshTotal: 0,
            refreshScore: 0,
            refreshScoreTotal: 0,
        });
        const requestId = `npc-possess:${userId}:${clientRequestId}`;
        const event = await db.inputEvent.findUniqueOrThrow({ where: { requestId } });
        expect(event).toMatchObject({
            target: 'ENGINE',
            eventType: 'npcPossessGeneral',
            status: 'SUCCEEDED',
            attempts: 1,
            actorUserId: userId,
        });
        expect(access.lastRefresh?.getTime()).toBe(event.createdAt.getTime());
        const logs = await db.logEntry.findMany({
            where: {
                OR: [
                    { generalId: candidate.id, text: { contains: '빙의되다' } },
                    { text: { contains: '빙의</>됩니다' } },
                ],
            },
        });
        expect(logs).toHaveLength(2);
        await expect(
            appRouter.createCaller(buildContext('npc-possession-lobby-after')).lobby.info()
        ).resolves.toMatchObject({
            userCnt: 1,
            npcCnt: 23,
            npcPossessionEnabled: true,
            selectionPoolEnabled: false,
            myGeneral: {
                name: candidate.name,
            },
        });

        await expect(
            appRouter.createCaller(buildContext('npc-possession-conflict')).join.possessGeneral({
                ...input,
                generalId: candidate.id === firstCandidate.id ? secondCandidate.id : firstCandidate.id,
            })
        ).rejects.toMatchObject({ code: 'CONFLICT' });

        await stopRuntime('verify NPC possession reload');
        await startRuntime('npc-possession-integration-reloaded-daemon');
        expect(runtime!.world.getGeneralById(candidate.id)).toMatchObject({
            userId,
            npcState: 1,
            penalty: {
                ban: 2,
                chat: 3,
            },
        });
    }, 45_000);

    it('keeps an accepted token through wall-clock expiry until the queued ENGINE event finishes', async () => {
        const reservation = await appRouter
            .createCaller(buildContext('npc-possession-delayed-token', delayedAuth))
            .join.listPossessCandidates({});
        const candidate = reservation.candidates[0]!;
        const clientRequestId = '88888888-8888-4888-8888-888888888888';
        const requestId = `npc-possess:${delayedUserId}:${clientRequestId}`;
        const input = {
            generalId: candidate.id,
            tokenNonce: reservation.tokenNonce,
            clientRequestId,
        };

        await stopRuntime('hold accepted NPC possession past token expiry');
        turnDaemon = new DatabaseTurnDaemonTransport(db, 100);
        await expect(
            appRouter.createCaller(buildContext('npc-possession-delayed-http', delayedAuth)).join.possessGeneral(input)
        ).rejects.toMatchObject({ code: 'TIMEOUT' });

        const event = await db.inputEvent.findUniqueOrThrow({ where: { requestId } });
        const acceptedSecond = new Date(Math.floor(event.createdAt.getTime() / 1000) * 1000);
        await db.npcSelectionToken.update({
            where: { ownerUserId: delayedUserId },
            data: { validUntil: acceptedSecond },
        });
        await new Promise((resolve) => setTimeout(resolve, 1_100));

        await appRouter
            .createCaller(buildContext('npc-possession-cleanup-token', cleanupAuth))
            .join.listPossessCandidates({});
        await expect(
            db.npcSelectionToken.findUnique({ where: { ownerUserId: delayedUserId } })
        ).resolves.not.toBeNull();
        await expect(
            appRouter
                .createCaller(buildContext('npc-possession-delayed-refresh', delayedAuth))
                .join.listPossessCandidates({ refresh: true, keepIds: [] })
        ).rejects.toMatchObject({
            code: 'CONFLICT',
            message: 'NPC 빙의 요청 처리 중에는 후보를 다시 뽑을 수 없습니다.',
        });

        await startRuntime('npc-possession-delayed-retry-daemon');
        await expect(
            appRouter.createCaller(buildContext('npc-possession-delayed-retry', delayedAuth)).join.possessGeneral(input)
        ).resolves.toEqual({ ok: true, generalId: candidate.id });
        await expect(db.inputEvent.findUniqueOrThrow({ where: { requestId } })).resolves.toMatchObject({
            status: 'SUCCEEDED',
            attempts: 1,
        });
        expect(await db.general.count({ where: { userId: delayedUserId } })).toBe(1);
    }, 45_000);

    it('serializes durable enqueue before a token refresh can replace its nonce', async () => {
        const reservation = await appRouter
            .createCaller(buildContext('npc-possession-race-token', raceAuth))
            .join.listPossessCandidates({});
        const candidate = reservation.candidates[0]!;
        const clientRequestId = '99999999-9999-4999-8999-999999999999';
        const requestId = `npc-possess:${raceUserId}:${clientRequestId}`;
        const input = {
            generalId: candidate.id,
            tokenNonce: reservation.tokenNonce,
            clientRequestId,
        };

        await stopRuntime('hold NPC possession enqueue behind the reservation lock');
        turnDaemon = new DatabaseTurnDaemonTransport(db, 100);

        let releaseLock!: () => void;
        let markLockReady!: () => void;
        const lockReady = new Promise<void>((resolve) => {
            markLockReady = resolve;
        });
        const lockRelease = new Promise<void>((resolve) => {
            releaseLock = resolve;
        });
        const blocker = db.$transaction(
            async (transaction) => {
                await transaction.$executeRaw(
                    GamePrisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('npc-possession', 1))`
                );
                markLockReady();
                await lockRelease;
            },
            { timeout: 5_000 }
        );
        await lockReady;

        const enqueue = appRouter
            .createCaller(buildContext('npc-possession-race-http', raceAuth))
            .join.possessGeneral(input);
        await new Promise((resolve) => setTimeout(resolve, 150));
        await expect(db.inputEvent.findUnique({ where: { requestId } })).resolves.toBeNull();

        releaseLock();
        await blocker;
        await expect(enqueue).rejects.toMatchObject({ code: 'TIMEOUT' });
        await expect(
            appRouter
                .createCaller(buildContext('npc-possession-race-refresh', raceAuth))
                .join.listPossessCandidates({ refresh: true, keepIds: [] })
        ).rejects.toMatchObject({
            code: 'CONFLICT',
            message: 'NPC 빙의 요청 처리 중에는 후보를 다시 뽑을 수 없습니다.',
        });
        await expect(db.npcSelectionToken.findUnique({ where: { ownerUserId: raceUserId } })).resolves.toMatchObject({
            nonce: reservation.tokenNonce,
        });

        await startRuntime('npc-possession-race-retry-daemon');
        await expect(
            appRouter.createCaller(buildContext('npc-possession-race-retry', raceAuth)).join.possessGeneral(input)
        ).resolves.toEqual({ ok: true, generalId: candidate.id });
    }, 45_000);

    it('rolls back a late log failure and retries the same ENGINE event once', async () => {
        const reservation = await appRouter
            .createCaller(buildContext('npc-possession-failure-token', failureAuth))
            .join.listPossessCandidates({});
        const candidate = reservation.candidates[0]!;
        const clientRequestId = '33333333-3333-4333-8333-333333333333';
        const requestId = `npc-possess:${failureUserId}:${clientRequestId}`;
        const triggerName = 'npc_possession_fail_first_log';
        const functionName = 'npc_possession_fail_first_log_fn';

        await db.$executeRawUnsafe(`
            CREATE OR REPLACE FUNCTION "${schemaName}"."${functionName}"()
            RETURNS trigger AS $$
            BEGIN
                IF NEW.text LIKE '%재시도사용자%'
                   AND EXISTS (
                       SELECT 1
                       FROM "${schemaName}"."input_event"
                       WHERE "request_id" = '${requestId}'
                         AND "status" = 'PROCESSING'
                         AND "attempts" = 1
                   )
                THEN
                    RAISE EXCEPTION 'injected first NPC possession log failure';
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        `);
        await db.$executeRawUnsafe(`
            CREATE TRIGGER "${triggerName}"
            BEFORE INSERT ON "${schemaName}"."log_entry"
            FOR EACH ROW EXECUTE FUNCTION "${schemaName}"."${functionName}"()
        `);

        try {
            await expect(
                appRouter.createCaller(buildContext('npc-possession-failure-http', failureAuth)).join.possessGeneral({
                    generalId: candidate.id,
                    tokenNonce: reservation.tokenNonce,
                    clientRequestId,
                })
            ).resolves.toEqual({ ok: true, generalId: candidate.id });
        } finally {
            await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "${schemaName}"."log_entry"`);
            await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${schemaName}"."${functionName}"()`);
        }

        expect(await db.general.count({ where: { userId: failureUserId } })).toBe(1);
        expect(runtime!.world.getGeneralById(candidate.id)).toMatchObject({
            userId: failureUserId,
            npcState: 1,
        });
        expect(await db.npcSelectionToken.findUnique({ where: { ownerUserId: failureUserId } })).toBeNull();
        await expect(db.inputEvent.findUniqueOrThrow({ where: { requestId } })).resolves.toMatchObject({
            status: 'SUCCEEDED',
            attempts: 2,
            actorUserId: failureUserId,
            error: null,
        });
        expect(
            await db.logEntry.count({
                where: { text: { contains: '재시도사용자' } },
            })
        ).toBe(2);
    }, 45_000);

    it('rejects wrong mode, foreign nonce, unlisted ID, expiry and a full server without mutation', async () => {
        await db.npcSelectionToken.deleteMany({ where: { ownerUserId: cleanupUserId } });
        const worldState = await db.worldState.findFirstOrThrow();
        const originalConfig = worldState.config as GamePrisma.InputJsonObject;
        await db.worldState.update({
            where: { id: worldState.id },
            data: {
                config: {
                    ...originalConfig,
                    npcMode: 0,
                },
            },
        });
        await expect(
            appRouter
                .createCaller(buildContext('npc-possession-reject-mode-token', rejectedAuth))
                .join.listPossessCandidates({})
        ).rejects.toMatchObject({
            code: 'PRECONDITION_FAILED',
            message: '빙의 가능한 서버가 아닙니다',
        });

        await db.worldState.update({
            where: { id: worldState.id },
            data: { config: originalConfig },
        });
        const reservation = await appRouter
            .createCaller(buildContext('npc-possession-reject-token', rejectedAuth))
            .join.listPossessCandidates({});
        const foreignToken = await db.npcSelectionToken.findUniqueOrThrow({
            where: { ownerUserId: otherUserId },
        });
        await expect(
            appRouter.createCaller(buildContext('npc-possession-reject-foreign', rejectedAuth)).join.possessGeneral({
                generalId: reservation.candidates[0]!.id,
                tokenNonce: foreignToken.nonce,
                clientRequestId: '44444444-4444-4444-8444-444444444444',
            })
        ).rejects.toMatchObject({
            code: 'PRECONDITION_FAILED',
            message: '유효한 장수 목록이 없습니다.',
        });

        const reservedIds = new Set(reservation.candidates.map(({ id }) => id));
        const unlisted = await db.general.findFirstOrThrow({
            where: {
                userId: null,
                npcState: 2,
                id: { notIn: [...reservedIds] },
            },
        });
        await expect(
            appRouter.createCaller(buildContext('npc-possession-reject-unlisted', rejectedAuth)).join.possessGeneral({
                generalId: unlisted.id,
                tokenNonce: reservation.tokenNonce,
                clientRequestId: '55555555-5555-4555-8555-555555555555',
            })
        ).rejects.toMatchObject({
            code: 'PRECONDITION_FAILED',
            message: '선택한 장수가 목록에 없습니다.',
        });

        await db.npcSelectionToken.update({
            where: { ownerUserId: rejectedUserId },
            data: { validUntil: new Date('2000-01-01T00:00:00.000Z') },
        });
        await expect(
            appRouter.createCaller(buildContext('npc-possession-reject-expired', rejectedAuth)).join.possessGeneral({
                generalId: reservation.candidates[0]!.id,
                tokenNonce: reservation.tokenNonce,
                clientRequestId: '66666666-6666-4666-8666-666666666666',
            })
        ).rejects.toMatchObject({
            code: 'PRECONDITION_FAILED',
            message: '유효한 장수 목록이 없습니다.',
        });

        const fresh = await appRouter
            .createCaller(buildContext('npc-possession-reject-fresh-token', rejectedAuth))
            .join.listPossessCandidates({});
        const activeCount = await db.general.count({ where: { npcState: { lt: 2 } } });
        await db.worldState.update({
            where: { id: worldState.id },
            data: {
                config: {
                    ...originalConfig,
                    npcMode: 1,
                    maxGeneral: activeCount,
                },
            },
        });
        await expect(
            appRouter.createCaller(buildContext('npc-possession-reject-cap', rejectedAuth)).join.possessGeneral({
                generalId: fresh.candidates[0]!.id,
                tokenNonce: fresh.tokenNonce,
                clientRequestId: '77777777-7777-4777-8777-777777777777',
            })
        ).rejects.toMatchObject({
            code: 'PRECONDITION_FAILED',
            message: '더 이상 등록 할 수 없습니다.',
        });
        await db.worldState.update({
            where: { id: worldState.id },
            data: { config: originalConfig },
        });

        expect(await db.general.count({ where: { userId: rejectedUserId } })).toBe(0);
        expect(runtime!.world.listGenerals().some(({ userId: owner }) => owner === rejectedUserId)).toBe(false);
    }, 45_000);
});
