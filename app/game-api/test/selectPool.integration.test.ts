import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildGameEventChannel, RANK_DATA_TYPES, type RealtimeEvent } from '@sammo-ts/common';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { createTurnDaemonRuntime, seedScenarioToDatabase, type TurnDaemonRuntime } from '@sammo-ts/game-engine';
import {
    createGamePostgresConnector,
    createRedisConnector,
    resolveRedisConfigFromEnv,
    type GamePrisma,
    type GamePrismaClient,
    type RedisConnector,
} from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { InMemoryFlushStore } from '../src/auth/flushStore.js';
import { InMemoryBattleSimTransport } from '../src/battleSim/inMemoryTransport.js';
import type { GameApiContext } from '../src/context.js';
import { DatabaseTurnDaemonTransport } from '../src/daemon/databaseTransport.js';
import type { TurnDaemonTransport } from '../src/daemon/transport.js';
import { RedisRealtimeEventHub } from '../src/realtime/eventHub.js';
import { appRouter } from '../src/router.js';

const databaseUrl = process.env.SELECT_POOL_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const userId = 'select-pool-integration-user';
const otherUserId = 'select-pool-integration-other-user';
const foreignUserId = 'select-pool-integration-foreign-user';
const failureUserId = 'select-pool-integration-failure-user';
const profile = 'hwe:903';
const schemaName = databaseUrl ? (new URL(databaseUrl).searchParams.get('schema') ?? '') : '';

const assertDedicatedDatabase = (rawUrl: string): void => {
    const schema = new URL(rawUrl).searchParams.get('schema');
    if (!schema?.endsWith('select_pool_integration')) {
        throw new Error(`Refusing to mutate non-dedicated schema: ${schema ?? '(missing)'}`);
    }
    if (!/^[a-z0-9_]+$/.test(schema)) {
        throw new Error(`Refusing unsafe schema name: ${schema}`);
    }
};

const auth: GameSessionTokenPayload = {
    version: 1,
    profile,
    issuedAt: '2026-07-30T00:00:00.000Z',
    expiresAt: '2026-08-30T00:00:00.000Z',
    sessionId: 'select-pool-integration-session',
    user: {
        id: userId,
        username: 'select-pool-user',
        displayName: '선택사용자',
        roles: ['user'],
    },
    sanctions: {},
};

const otherAuth: GameSessionTokenPayload = {
    ...auth,
    sessionId: 'select-pool-integration-other-session',
    user: {
        ...auth.user,
        id: otherUserId,
        username: 'select-pool-other',
        displayName: '다른사용자',
    },
};

const foreignAuth: GameSessionTokenPayload = {
    ...auth,
    sessionId: 'select-pool-integration-foreign-session',
    user: {
        ...auth.user,
        id: foreignUserId,
        username: 'select-pool-foreign',
        displayName: '외국사용자',
    },
};

const failureAuth: GameSessionTokenPayload = {
    ...auth,
    sessionId: 'select-pool-integration-failure-session',
    user: {
        ...auth.user,
        id: failureUserId,
        username: 'select-pool-failure',
        displayName: '실패사용자',
    },
};

integration('scenario 903 select pool through the durable turn daemon', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;
    let runtime: TurnDaemonRuntime | undefined;
    let daemonLoop: Promise<void> | undefined;
    let turnDaemon: TurnDaemonTransport;
    let worldStateId: number;
    let realtimeHub: RedisRealtimeEventHub | undefined;
    let unsubscribeRealtime = () => {};
    const realtimeEvents: RealtimeEvent[] = [];

    const waitForRealtimeEvent = async (
        predicate: (event: RealtimeEvent) => boolean,
        timeoutMs = 2_000
    ): Promise<RealtimeEvent> => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const event = realtimeEvents.find(predicate);
            if (event) return event;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error('Timed out waiting for select-pool realtime event.');
    };

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
            profile: { id: 'hwe', scenario: '903', name: profile },
            uploadDir: 'uploads',
            uploadPath: '/uploads',
            uploadPublicUrl: null,
            auth: actorAuth,
            accessTokenStore: new RedisAccessTokenStore(redisClient, profile),
            flushStore: new InMemoryFlushStore(),
            gameTokenSecret: 'select-pool-test-secret',
        };
    };

    beforeAll(async () => {
        assertDedicatedDatabase(databaseUrl!);
        const previousSeed = process.env.INTEGRATION_WORLD_SEED;
        process.env.INTEGRATION_WORLD_SEED = 'select-pool-integration-seed';
        try {
            await seedScenarioToDatabase({
                scenarioId: 903,
                databaseUrl: databaseUrl!,
                now: new Date('2099-07-30T12:00:00.000Z'),
                installOptions: {
                    turnTermMinutes: 5,
                    npcMode: 2,
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
        worldStateId = (await db.worldState.findFirstOrThrow()).id;

        if (process.env.REDIS_URL) {
            const realtimeSubscriber = createRedisConnector(resolveRedisConfigFromEnv());
            await realtimeSubscriber.connect();
            realtimeHub = new RedisRealtimeEventHub(realtimeSubscriber.client, buildGameEventChannel(profile));
            unsubscribeRealtime = realtimeHub.subscribe((event) => realtimeEvents.push(event));
            await realtimeHub.start();
        }

        runtime = await createTurnDaemonRuntime({
            profile,
            databaseUrl: databaseUrl!,
            enableDatabaseFlush: true,
            enableLeaseHeartbeat: false,
            leaseOwnerId: 'select-pool-integration-daemon',
        });
        turnDaemon = new DatabaseTurnDaemonTransport(db, 10_000);
        daemonLoop = runtime.lifecycle.start();
        await expect(turnDaemon.requestStatus(10_000)).resolves.toMatchObject({
            state: expect.any(String),
        });
    }, 60_000);

    afterAll(async () => {
        if (runtime) {
            await runtime.lifecycle.stop('select-pool integration complete');
            await daemonLoop;
            await runtime.close();
        }
        unsubscribeRealtime();
        await realtimeHub?.stop();
        await closeDb?.();
    }, 30_000);

    it('creates and reselects in one durable DB and in-memory command boundary', async () => {
        await expect(
            appRouter.createCaller(buildContext('select-pool-public-lobby')).lobby.info()
        ).resolves.toMatchObject({ selectionPoolEnabled: true });
        const joinConfig = await appRouter.createCaller(buildContext('select-pool-config')).join.getConfig();
        expect(joinConfig).toMatchObject({
            serverInfo: {
                currentYear: 180,
                currentMonth: 1,
                tickMinutes: 5,
                maxGeneral: 500,
            },
        });

        const [firstReservation, concurrentReservation] = await Promise.all([
            appRouter.createCaller(buildContext('select-pool-reserve-a')).join.getSelectionPool(),
            appRouter.createCaller(buildContext('select-pool-reserve-b')).join.getSelectionPool(),
        ]);
        expect(concurrentReservation).toEqual(firstReservation);
        expect(firstReservation.candidates).toHaveLength(14);
        expect(await db.selectPoolEntry.count({ where: { ownerUserId: userId } })).toBe(14);
        const reservedNames = new Set(firstReservation.candidates.map((candidate) => candidate.uniqueName));
        expect(
            runtime!.world
                .listGeneralPoolCandidates(new Date(firstReservation.validUntil))
                ?.some((candidate) => reservedNames.has(candidate.uniqueName))
        ).toBe(false);
        const reserveEvent = await db.inputEvent.findUniqueOrThrow({
            where: { requestId: `select-pool:${userId}:select-pool-reserve-a:reserve` },
        });
        expect(reserveEvent).toMatchObject({
            eventType: 'selectPoolReserve',
            status: 'SUCCEEDED',
            actorUserId: userId,
            processingGameTick: expect.anything(),
        });
        expect(reserveEvent.payload).not.toHaveProperty('acceptedGameAt');
        expect(reserveEvent.payload).not.toHaveProperty('acceptedGameTick');

        const createRequestIds = ['select-pool-create-a', 'select-pool-create-b'] as const;
        const attempts = await Promise.allSettled([
            appRouter.createCaller(buildContext(createRequestIds[0])).join.selectPoolGeneral({
                uniqueName: firstReservation.candidates[0]!.uniqueName,
                personality: 'che_안전',
            }),
            appRouter.createCaller(buildContext(createRequestIds[1])).join.selectPoolGeneral({
                uniqueName: firstReservation.candidates[1]!.uniqueName,
                personality: 'che_유지',
            }),
        ]);
        expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
        expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
        const successfulAttemptIndex = attempts.findIndex((attempt) => attempt.status === 'fulfilled');
        if (successfulAttemptIndex < 0) {
            throw new Error('one concurrent selection request must succeed');
        }
        const successfulRequestId = createRequestIds[successfulAttemptIndex];
        if (!successfulRequestId) {
            throw new Error('successful selection request must have a request ID');
        }

        const initial = await db.general.findFirstOrThrow({ where: { userId } });
        const initialRuntime = runtime!.world.getGeneralById(initial.id);
        const initialAccess = await db.generalAccessLog.findUniqueOrThrow({ where: { generalId: initial.id } });
        expect(initial).toMatchObject({ picture: 'default.jpg', imageServer: 0 });
        const acceptedEvent = await db.inputEvent.findUniqueOrThrow({
            where: { requestId: `${successfulRequestId}:join.selectPoolGeneral` },
        });
        expect(acceptedEvent).toMatchObject({
            actorUserId: userId,
            eventType: 'selectPoolCreate',
            status: 'SUCCEEDED',
            result: { type: 'selectPoolCreate', ok: true, generalId: initial.id },
        });
        if (!initialAccess.lastRefresh) {
            throw new Error('selected general must have an initial access timestamp');
        }
        expect(initialAccess.lastRefresh).toEqual(acceptedEvent.createdAt);
        expect(
            new Date((initial.meta as Record<string, unknown>).prestart_delete_after as string).getTime() -
                acceptedEvent.createdAt.getTime()
        ).toBe(2 * 5 * 60 * 1_000);
        expect(initialRuntime).toMatchObject({
            id: initial.id,
            userId,
            name: initial.name,
            imageServer: 0,
            picture: 'default.jpg',
            stats: {
                leadership: initial.leadership,
                strength: initial.strength,
                intelligence: initial.intel,
            },
        });
        expect(initial.id).toBeGreaterThan(
            Math.max(
                ...runtime!.world
                    .listGenerals()
                    .filter((general) => general.id !== initial.id)
                    .map((general) => general.id)
            )
        );
        expect(
            await db.generalTurn.findMany({
                where: { generalId: initial.id },
                orderBy: { turnIdx: 'asc' },
                select: { turnIdx: true, actionCode: true, arg: true },
            })
        ).toEqual(
            Array.from({ length: 30 }, (_, turnIdx) => ({
                turnIdx,
                actionCode: '휴식',
                arg: {},
            }))
        );
        await expect(
            db.generalTurnRevision.findUniqueOrThrow({ where: { generalId: initial.id } })
        ).resolves.toMatchObject({ revision: 0, leaseOwner: null, leaseExpiresAt: null });
        const initialRankRows = await db.rankData.findMany({
            where: { generalId: initial.id },
            orderBy: { type: 'asc' },
            select: { nationId: true, type: true, value: true },
        });
        expect(initialRankRows).toHaveLength(RANK_DATA_TYPES.length);
        expect(initialRankRows.map(({ type }) => type).sort()).toEqual([...RANK_DATA_TYPES].sort());
        expect(initialRankRows.every(({ nationId, value }) => nationId === 0 && value === 0)).toBe(true);
        expect(await db.selectPoolEntry.count({ where: { generalId: initial.id } })).toBe(1);
        expect(await db.selectPoolEntry.count({ where: { ownerUserId: userId } })).toBe(0);
        expect(runtime!.world.listGeneralPoolEntries()?.filter((entry) => entry.ownerUserId === userId)).toEqual([]);
        expect(
            runtime!.world.listGeneralPoolEntries()?.find((entry) => entry.generalId === initial.id)?.candidate.name
        ).toBe(initial.name);
        expect(
            await db.logEntry.count({
                where: { meta: { path: ['ownerUserId'], equals: userId } },
            })
        ).toBe(2);
        if (realtimeHub) {
            const creationEvent = await waitForRealtimeEvent(
                (event) => event.type === 'readModelChanged' && event.changes.globalRecordsChanged
            );
            expect(creationEvent).toMatchObject({
                type: 'readModelChanged',
                changes: {
                    generalIds: [initial.id],
                    globalRecordsChanged: true,
                },
            });
        }

        await expect(
            appRouter.createCaller(buildContext('select-pool-cooldown')).join.getSelectionPool()
        ).rejects.toMatchObject({ message: '아직 다시 고를 수 없습니다' });

        const cooledAt = '2026-07-29T00:00:00.000Z';
        const cooledTick = runtime!.world.dateToGameTick(runtime!.world.getGameNow(new Date())) - 1;
        await expect(
            turnDaemon.requestCommand({
                type: 'patchGeneral',
                requestId: 'select-pool-cooldown-patch',
                generalId: initial.id,
                patch: {
                    meta: {
                        next_change: cooledAt,
                        nextChangeAt: cooledAt,
                        next_change_tick: cooledTick,
                    },
                },
            })
        ).resolves.toMatchObject({ type: 'patchGeneral', ok: true, generalId: initial.id });

        const reselection = await appRouter
            .createCaller(buildContext('select-pool-reserve-reselection'))
            .join.getSelectionPool();
        const target = reselection.candidates.find((candidate) => candidate.generalName !== initial.name)!;
        await expect(
            appRouter
                .createCaller(buildContext('select-pool-reselect'))
                .join.reselectPoolGeneral({ uniqueName: target.uniqueName })
        ).resolves.toEqual({ ok: true, generalId: initial.id });
        const reselectionEvent = await db.inputEvent.findUniqueOrThrow({
            where: { requestId: 'select-pool-reselect:join.reselectPoolGeneral' },
        });
        expect(reselectionEvent).toMatchObject({
            eventType: 'selectPoolReselect',
            actorUserId: userId,
            processingGameTick: expect.anything(),
        });
        expect(reselectionEvent.payload).not.toHaveProperty('acceptedGameAt');
        expect(reselectionEvent.payload).not.toHaveProperty('acceptedGameTick');

        const updated = await db.general.findUniqueOrThrow({ where: { id: initial.id } });
        expect(updated).toMatchObject({
            id: initial.id,
            userId,
            name: target.generalName,
            leadership: target.leadership,
            strength: target.strength,
            intel: target.intel,
            personalCode: initial.personalCode,
            specialCode: target.specialDomestic,
            imageServer: 0,
            picture: 'default.jpg',
        });
        expect(runtime!.world.getGeneralById(initial.id)).toMatchObject({
            id: initial.id,
            userId,
            name: target.generalName,
            imageServer: 0,
            picture: 'default.jpg',
            stats: {
                leadership: target.leadership,
                strength: target.strength,
                intelligence: target.intel,
            },
        });
        expect(await db.selectPoolEntry.count({ where: { generalId: initial.id } })).toBe(1);
        expect(await db.selectPoolEntry.findUniqueOrThrow({ where: { uniqueName: target.uniqueName } })).toMatchObject({
            generalId: initial.id,
            ownerUserId: null,
            reservedUntil: null,
        });
        expect(runtime!.world.listGeneralPoolEntries()?.filter((entry) => entry.ownerUserId === userId)).toEqual([]);
        expect(
            runtime!.world.listGeneralPoolEntries()?.find((entry) => entry.generalId === initial.id)?.uniqueName
        ).toBe(target.uniqueName);
        expect(
            await db.logEntry.count({
                where: { meta: { path: ['ownerUserId'], equals: userId } },
            })
        ).toBe(4);

        await expect(
            turnDaemon.requestCommand({
                type: 'patchGeneral',
                requestId: 'select-pool-post-reselection-flush',
                generalId: initial.id,
                patch: { meta: { postReselectionFlush: 1 } },
            })
        ).resolves.toMatchObject({ type: 'patchGeneral', ok: true });
        await expect(db.general.findUniqueOrThrow({ where: { id: initial.id } })).resolves.toMatchObject({
            name: target.generalName,
            leadership: target.leadership,
            strength: target.strength,
            intel: target.intel,
        });

        const fullWorld = await db.worldState.findUniqueOrThrow({ where: { id: worldStateId } });
        const fullConfig = fullWorld.config as Record<string, unknown>;
        runtime!.world.updateWorldConfig({ maxGeneral: 1 });
        await db.worldState.update({
            where: { id: worldStateId },
            data: { config: { ...fullConfig, maxGeneral: 1 } as GamePrisma.InputJsonValue },
        });
        const secondCooledAt = '2026-07-28T00:00:00.000Z';
        const secondCooledTick = runtime!.world.dateToGameTick(runtime!.world.getGameNow(new Date())) - 1;
        await turnDaemon.requestCommand({
            type: 'patchGeneral',
            requestId: 'select-pool-full-cooldown-patch',
            generalId: initial.id,
            patch: {
                meta: {
                    next_change: secondCooledAt,
                    nextChangeAt: secondCooledAt,
                    next_change_tick: secondCooledTick,
                },
            },
        });
        const fullReselection = await appRouter
            .createCaller(buildContext('select-pool-full-reselection-reserve'))
            .join.getSelectionPool();
        await expect(
            appRouter.createCaller(buildContext('select-pool-full-reselection')).join.reselectPoolGeneral({
                uniqueName: fullReselection.candidates[0]!.uniqueName,
            })
        ).resolves.toEqual({ ok: true, generalId: initial.id });

        const otherReservation = await appRouter
            .createCaller(buildContext('select-pool-full-new-user-reserve', otherAuth))
            .join.getSelectionPool();
        await expect(
            appRouter.createCaller(buildContext('select-pool-full-new-user-create', otherAuth)).join.selectPoolGeneral({
                uniqueName: otherReservation.candidates[0]!.uniqueName,
                personality: 'che_안전',
            })
        ).rejects.toMatchObject({ message: '더 이상 등록 할 수 없습니다.' });
        expect(await db.general.count({ where: { userId: otherUserId } })).toBe(0);
        runtime!.world.updateWorldConfig({ maxGeneral: joinConfig.serverInfo.maxGeneral });
        await db.worldState.update({
            where: { id: worldStateId },
            data: { config: fullConfig as GamePrisma.InputJsonValue },
        });
    }, 30_000);

    it('keeps a stable ENGINE event for retries and rejects reservation bypasses', async () => {
        const logicalNow = runtime!.world.getGameNow(new Date());
        const logicalNowMs = logicalNow.getTime();
        const logicalNowTick = runtime!.world.dateToGameTick(logicalNow);
        const reservation = await appRouter
            .createCaller(buildContext('select-pool-other-reserve', otherAuth))
            .join.getSelectionPool();
        const candidate = reservation.candidates[0]!;

        await expect(
            appRouter.createCaller(buildContext('select-pool-foreign-token', foreignAuth)).join.selectPoolGeneral({
                uniqueName: candidate.uniqueName,
                personality: 'che_안전',
            })
        ).rejects.toMatchObject({ message: '유효한 장수 목록이 없습니다.' });
        expect(await db.general.count({ where: { userId: foreignUserId } })).toBe(0);

        await db.selectPoolEntry.update({
            where: { uniqueName: candidate.uniqueName },
            data: {
                reservedUntil: new Date(logicalNowMs - 60_000),
                reservedUntilTick: BigInt(logicalNowTick - 1),
            },
        });
        await expect(
            appRouter.createCaller(buildContext('select-pool-expired-token', otherAuth)).join.selectPoolGeneral({
                uniqueName: candidate.uniqueName,
                personality: 'che_안전',
            })
        ).rejects.toMatchObject({ message: '유효한 장수 목록이 없습니다.' });
        expect(await db.general.count({ where: { userId: otherUserId } })).toBe(0);

        await expect(
            appRouter.createCaller(buildContext('select-pool-generic-bypass', otherAuth)).join.createGeneral({
                name: '우회장수',
                leadership: 55,
                strength: 55,
                intel: 55,
                pic: false,
                character: 'che_안전',
            })
        ).rejects.toMatchObject({ message: '장수 선택 목록에서 장수를 골라 주세요.' });

        const input = {
            uniqueName: reservation.candidates[1]!.uniqueName,
            personality: 'che_안전',
        };
        await db.selectPoolEntry.updateMany({
            where: { ownerUserId: otherUserId, generalId: null },
            data: { reservedUntil: new Date(logicalNowMs + 60_000) },
        });
        const runtimeAllocatorBefore = runtime!.world.getState().meta.lastGeneralId;
        const persistedAllocatorBefore = (
            (await db.worldState.findUniqueOrThrow({ where: { id: worldStateId } })).meta as Record<string, unknown>
        ).lastGeneralId;
        await expect(
            appRouter.createCaller(buildContext('select-pool-invalid-personality', otherAuth)).join.selectPoolGeneral({
                ...input,
                personality: 'not-a-personality',
                clientRequestId: '11111111-1111-4111-8111-111111111111',
            })
        ).rejects.toMatchObject({ message: '올바르지 않은 성격입니다.' });
        expect(runtime!.world.getState().meta.lastGeneralId).toBe(runtimeAllocatorBefore);
        expect(
            ((await db.worldState.findUniqueOrThrow({ where: { id: worldStateId } })).meta as Record<string, unknown>)
                .lastGeneralId
        ).toBe(persistedAllocatorBefore);
        expect(await db.general.count({ where: { userId: otherUserId } })).toBe(0);

        const stableClientRequestId = '22222222-2222-4222-8222-222222222222';
        const stableInput = { ...input, clientRequestId: stableClientRequestId };
        const first = await appRouter
            .createCaller(buildContext('select-pool-http-attempt-a', otherAuth))
            .join.selectPoolGeneral(stableInput);
        const retried = await appRouter
            .createCaller(buildContext('select-pool-http-attempt-b', otherAuth))
            .join.selectPoolGeneral(stableInput);
        expect(retried).toEqual(first);
        expect(await db.general.count({ where: { userId: otherUserId } })).toBe(1);
        const stableEvent = await db.inputEvent.findUniqueOrThrow({
            where: {
                requestId: `select-pool:${otherUserId}:${stableClientRequestId}:create`,
            },
        });
        expect(stableEvent).toMatchObject({
            status: 'SUCCEEDED',
            attempts: 1,
            actorUserId: otherUserId,
            processingGameTick: expect.anything(),
        });
        expect(stableEvent.payload).not.toHaveProperty('acceptedGameAt');
        expect(stableEvent.payload).not.toHaveProperty('acceptedGameTick');
    }, 30_000);

    it('rolls back a hard failure and retries the same ENGINE event exactly once', async () => {
        const reservation = await appRouter
            .createCaller(buildContext('select-pool-failure-reserve', failureAuth))
            .join.getSelectionPool();
        const candidate = reservation.candidates[0]!;
        const requestUuid = '33333333-3333-4333-8333-333333333333';
        const requestId = `select-pool:${failureUserId}:${requestUuid}:create`;
        const triggerName = 'select_pool_fail_first_log';
        const functionName = 'select_pool_fail_first_log_fn';

        await db.$executeRawUnsafe(`
            CREATE OR REPLACE FUNCTION "${schemaName}"."${functionName}"()
            RETURNS trigger AS $$
            BEGIN
                IF NEW.meta ->> 'ownerUserId' = '${failureUserId}'
                   AND EXISTS (
                       SELECT 1
                       FROM "${schemaName}"."input_event"
                       WHERE "request_id" = '${requestId}'
                         AND "status" = 'PROCESSING'
                         AND "attempts" = 1
                   )
                THEN
                    RAISE EXCEPTION 'injected first selection log failure';
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
                appRouter.createCaller(buildContext('select-pool-failure-http', failureAuth)).join.selectPoolGeneral({
                    uniqueName: candidate.uniqueName,
                    personality: 'che_안전',
                    clientRequestId: requestUuid,
                })
            ).resolves.toMatchObject({ ok: true, generalId: expect.any(Number) });
        } finally {
            await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "${schemaName}"."log_entry"`);
            await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${schemaName}"."${functionName}"()`);
        }

        const created = await db.general.findFirstOrThrow({ where: { userId: failureUserId } });
        expect(runtime!.world.getGeneralById(created.id)).toMatchObject({
            id: created.id,
            userId: failureUserId,
            name: created.name,
        });
        expect(await db.general.count({ where: { userId: failureUserId } })).toBe(1);
        expect(await db.generalTurn.count({ where: { generalId: created.id } })).toBe(30);
        expect(await db.generalTurnRevision.count({ where: { generalId: created.id } })).toBe(1);
        expect(await db.rankData.count({ where: { generalId: created.id } })).toBe(RANK_DATA_TYPES.length);
        expect(await db.generalAccessLog.count({ where: { generalId: created.id } })).toBe(1);
        expect(await db.selectPoolEntry.count({ where: { generalId: created.id } })).toBe(1);
        expect(
            await db.logEntry.count({
                where: { meta: { path: ['ownerUserId'], equals: failureUserId } },
            })
        ).toBe(2);
        await expect(db.inputEvent.findUniqueOrThrow({ where: { requestId } })).resolves.toMatchObject({
            status: 'SUCCEEDED',
            attempts: 2,
            actorUserId: failureUserId,
            error: null,
        });
    }, 30_000);
});
