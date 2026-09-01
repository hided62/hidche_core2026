import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RANK_DATA_TYPES } from '@sammo-ts/common';
import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import { createTurnDaemonRuntime, seedScenarioToDatabase, type TurnDaemonRuntime } from '@sammo-ts/game-engine';
import {
    createGamePostgresConnector,
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
import { appRouter } from '../src/router.js';

const databaseUrl = process.env.CREATE_GENERAL_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const profile = 'hwe:2';
const userId = 'create-general-integration-user';
const failureUserId = 'create-general-integration-failure-user';
const rejectedUserId = 'create-general-integration-rejected-user';
const customIconId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const schemaName = databaseUrl ? (new URL(databaseUrl).searchParams.get('schema') ?? '') : '';

const assertDedicatedDatabase = (rawUrl: string): void => {
    const schema = new URL(rawUrl).searchParams.get('schema');
    if (!schema?.endsWith('create_general_integration')) {
        throw new Error(`Refusing to mutate non-dedicated schema: ${schema ?? '(missing)'}`);
    }
    if (!/^[a-z0-9_]+$/.test(schema)) {
        throw new Error(`Refusing unsafe schema name: ${schema}`);
    }
};

const buildAuth = (id: string, displayName: string, legacyMemberNo: number): GameSessionTokenPayload => ({
    version: 1,
    profile,
    issuedAt: '2026-07-30T00:00:00.000Z',
    expiresAt: '2026-08-30T00:00:00.000Z',
    sessionId: `create-general-${id}`,
    user: {
        id,
        username: id,
        displayName,
        roles: ['user'],
        legacyMemberNo,
        picture: 'custom-owner.webp',
        imageServer: 2,
        iconUpdatedAt: '2026-07-30T00:00:00.000Z',
        canUseGeneralPicture: true,
        icons: [
            {
                id: customIconId,
                picture: 'custom-owner.webp',
                imageServer: 2,
                createdAt: '2026-07-30T00:00:00.000Z',
            },
        ],
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
});

integration('generic general creation through the durable turn daemon', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;
    let runtime: TurnDaemonRuntime | undefined;
    let daemonLoop: Promise<void> | undefined;
    let turnDaemon: TurnDaemonTransport;

    const buildContext = (requestId: string, auth: GameSessionTokenPayload): GameApiContext => {
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
            auth,
            accessTokenStore: new RedisAccessTokenStore(redisClient, profile),
            flushStore: new InMemoryFlushStore(),
            gameTokenSecret: 'create-general-test-secret',
            accountIconSource: {
                get: async (accountId) =>
                    accountId === auth.user.id && auth.user.iconUpdatedAt
                        ? {
                              revision: auth.user.iconUpdatedAt,
                              picture: auth.user.picture ?? 'default.jpg',
                              imageServer: auth.user.imageServer ?? 0,
                          }
                        : null,
            },
        };
    };

    const stopRuntime = async (reason: string): Promise<void> => {
        if (!runtime) {
            return;
        }
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
        process.env.INTEGRATION_WORLD_SEED = 'create-general-integration-seed';
        try {
            await seedScenarioToDatabase({
                scenarioId: 2,
                databaseUrl: databaseUrl!,
                now: new Date('2099-07-30T12:00:00.000Z'),
                installOptions: {
                    turnTermMinutes: 5,
                    npcMode: 0,
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
        await db.inheritanceLog.deleteMany({
            where: { userId: { in: [userId, failureUserId] } },
        });
        await db.oldGeneral.deleteMany({
            where: { serverId: { startsWith: 'create-general-old-' } },
        });
        await db.gameHistory.deleteMany({
            where: { serverId: { startsWith: 'create-general-old-' } },
        });
        await db.gameHistory.createMany({
            data: [1, 2, 3, 4].map((index) => ({
                serverId: `create-general-old-${index}`,
                date: new Date(`2026-0${5 - index}-01T00:00:00.000Z`),
                winnerNation: 1,
                map: 'miniche_b',
                season: 1,
                scenario: 2,
                scenarioName: '통합 과거기',
                env: {},
            })),
        });
        await db.oldGeneral.create({
            data: {
                serverId: 'create-general-old-4',
                generalNo: 1,
                owner: userId,
                name: '과거장수',
                lastYearMonth: 18001,
                turnTime: new Date('2026-01-01T00:00:00.000Z'),
                data: {},
            },
        });
        for (const ownerUserId of [userId, failureUserId]) {
            await db.inheritancePoint.upsert({
                where: {
                    userId_key: { userId: ownerUserId, key: 'previous' },
                },
                update: { value: 10_000 },
                create: {
                    userId: ownerUserId,
                    key: 'previous',
                    value: 10_000,
                },
            });
        }
        for (const [key, value] of [
            ['active_action', 250.9],
            ['combat', 100.8],
        ] as const) {
            await db.inheritancePoint.upsert({
                where: { userId_key: { userId, key } },
                update: { value },
                create: { userId, key, value },
            });
        }
        await startRuntime('create-general-integration-daemon');
    }, 60_000);

    afterAll(async () => {
        await stopRuntime('create-general integration complete');
        await closeDb?.();
    }, 30_000);

    it('commits one complete ref-shaped general and survives a daemon reload', async () => {
        const auth = buildAuth(userId, '생성사용자', 4242);
        const config = await appRouter.createCaller(buildContext('create-general-config', auth)).join.getConfig();
        expect(config.rules.allowDirectCreation).toBe(true);
        expect(config.personalities.map(({ key }) => key)).not.toContain('che_은둔');
        expect(config.inherit.turnTimeZones[1]).toBe('00:05.000 ~ 00:09.999');
        const city = await db.city.findFirstOrThrow({ orderBy: { id: 'asc' } });
        const clientRequestId = '11111111-1111-4111-8111-111111111111';
        const input = {
            name: '일/반-장수#',
            leadership: 55,
            strength: 55,
            intel: 55,
            pic: true,
            iconId: customIconId,
            character: 'che_안전' as const,
            clientRequestId,
            inheritTurntimeZone: 7,
            inheritCity: city.id,
            inheritBonusStat: [2, 1, 1] as [number, number, number],
        };

        const first = await appRouter
            .createCaller(buildContext('create-general-http-a', auth))
            .join.createGeneral(input);
        const retried = await appRouter
            .createCaller(buildContext('create-general-http-b', auth))
            .join.createGeneral(input);
        expect(retried).toEqual(first);

        const created = await db.general.findUniqueOrThrow({
            where: { id: first.generalId },
        });
        expect(created).toMatchObject({
            userId,
            name: '일반장수',
            nationId: 0,
            cityId: city.id,
            npcState: 0,
            leadership: 57,
            strength: 56,
            intel: 56,
            bornYear: 180,
            deadYear: 300,
            picture: 'custom-owner.webp',
            imageServer: 2,
            crewTypeId: 1100,
            personalCode: 'che_안전',
            penalty: {
                ban: 2,
                chat: 3,
            },
        });
        expect(created.affinity).toBeGreaterThanOrEqual(1);
        expect(created.affinity).toBeLessThanOrEqual(150);
        expect(created.meta).toMatchObject({
            createdBy: 'join',
            ownerName: '생성사용자',
            killturn: 6,
            inherit_spent_dyn: 4500,
            accountIconUpdatedAt: '2026-07-30T00:00:00.000Z',
        });
        const createdAccess = await db.generalAccessLog.findUniqueOrThrow({ where: { generalId: created.id } });
        const acceptedEvent = await db.inputEvent.findUniqueOrThrow({
            where: { requestId: `join-create:${userId}:${clientRequestId}` },
        });
        if (!createdAccess.lastRefresh) {
            throw new Error('created general must have an initial access timestamp');
        }
        expect(createdAccess.lastRefresh).toEqual(acceptedEvent.createdAt);
        expect(
            new Date((created.meta as Record<string, unknown>).prestart_delete_after as string).getTime() -
                acceptedEvent.createdAt.getTime()
        ).toBe(2 * 5 * 60 * 1_000);
        expect(runtime!.world.getGeneralById(created.id)).toMatchObject({
            id: created.id,
            userId,
            name: created.name,
            cityId: city.id,
            role: {
                specialDomestic: null,
                specialWar: null,
            },
            inheritancePoints: {
                previous: 7351,
            },
        });
        expect(await db.general.count({ where: { userId } })).toBe(1);
        expect(await db.generalTurn.count({ where: { generalId: created.id } })).toBe(30);
        expect(await db.generalTurnRevision.count({ where: { generalId: created.id } })).toBe(1);
        expect(await db.rankData.count({ where: { generalId: created.id } })).toBe(RANK_DATA_TYPES.length);
        expect(
            await db.rankData.findUniqueOrThrow({
                where: {
                    generalId_type: {
                        generalId: created.id,
                        type: 'inherit_spent_dyn',
                    },
                },
            })
        ).toMatchObject({ nationId: 0, value: 4500 });
        const access = await db.generalAccessLog.findUniqueOrThrow({
            where: { generalId: created.id },
        });
        expect(access).toMatchObject({ userId });
        expect(
            await db.inheritancePoint.findUniqueOrThrow({
                where: { userId_key: { userId, key: 'previous' } },
            })
        ).toMatchObject({ value: 7351 });
        expect(await db.inheritancePoint.count({ where: { userId } })).toBe(1);
        await expect(
            db.gameInheritanceBaseline.findUniqueOrThrow({
                where: { serverId_userId: { serverId: profile, userId } },
            })
        ).resolves.toMatchObject({ openingPoint: 10_351, source: 'FIRST_ACTIVITY' });
        expect(await db.inheritanceLog.count({ where: { userId } })).toBe(9);
        expect(
            await db.inheritanceLog.findFirst({
                where: {
                    userId,
                    text: '신규/복귀 생성으로 포인트 1500 지급',
                },
            })
        ).not.toBeNull();
        const event = await db.inputEvent.findUniqueOrThrow({
            where: { requestId: `join-create:${userId}:${clientRequestId}` },
        });
        expect(event).toMatchObject({
            target: 'ENGINE',
            status: 'SUCCEEDED',
            attempts: 1,
            actorUserId: userId,
        });
        expect(access.lastRefresh?.getTime()).toBe(event.createdAt.getTime());
        const turnGridOffsetSeconds =
            ((created.turnTime.getTime() - runtime!.world.getState().lastTurnTime.getTime()) / 1000 + 300) % 300;
        expect(turnGridOffsetSeconds).toBeGreaterThanOrEqual(35);
        expect(turnGridOffsetSeconds).toBeLessThan(40);

        await stopRuntime('verify generic join reload');
        await startRuntime('create-general-integration-reloaded-daemon');
        expect(runtime!.world.getGeneralById(created.id)).toMatchObject({
            id: created.id,
            userId,
            name: created.name,
            cityId: city.id,
            role: {
                specialDomestic: null,
                specialWar: null,
            },
            inheritancePoints: {
                previous: 7351,
            },
        });

        await expect(
            appRouter.createCaller(buildContext('create-general-conflict', auth)).join.createGeneral({
                ...input,
                name: '다른장수',
            })
        ).rejects.toMatchObject({ code: 'CONFLICT' });
        expect(await db.general.count({ where: { userId } })).toBe(1);
    }, 45_000);

    it('rejects an unaffordable inheritance before consuming allocator state', async () => {
        const auth = buildAuth(rejectedUserId, '거절사용자', 4444);
        const requestUuid = '33333333-3333-4333-8333-333333333333';
        const requestId = `join-create:${rejectedUserId}:${requestUuid}`;
        const runtimeMetaBefore = runtime!.world.getState().meta;
        const persistedMetaBefore = (await db.worldState.findFirstOrThrow()).meta;

        await expect(
            appRouter.createCaller(buildContext('create-general-rejected-http', auth)).join.createGeneral({
                name: '포인트부족',
                leadership: 55,
                strength: 55,
                intel: 55,
                pic: false,
                character: 'che_안전',
                inheritSpecial: 'che_무쌍',
                clientRequestId: requestUuid,
            })
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: '유산 포인트가 부족합니다. 다시 가입해주세요!',
        });

        expect(await db.general.count({ where: { userId: rejectedUserId } })).toBe(0);
        expect(runtime!.world.getState().meta).toEqual(runtimeMetaBefore);
        expect((await db.worldState.findFirstOrThrow()).meta).toEqual(persistedMetaBefore);
        await expect(db.inputEvent.findUniqueOrThrow({ where: { requestId } })).resolves.toMatchObject({
            target: 'ENGINE',
            status: 'SUCCEEDED',
            attempts: 1,
            actorUserId: rejectedUserId,
            result: {
                type: 'joinCreateGeneral',
                ok: false,
                code: 'BAD_REQUEST',
            },
        });
    }, 30_000);

    it('rolls back a hard failure and retries the ENGINE event exactly once', async () => {
        const auth = buildAuth(failureUserId, '실패사용자', 4343);
        const requestUuid = '22222222-2222-4222-8222-222222222222';
        const requestId = `join-create:${failureUserId}:${requestUuid}`;
        const triggerName = 'create_general_fail_first_log';
        const functionName = 'create_general_fail_first_log_fn';

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
                    RAISE EXCEPTION 'injected first generic join log failure';
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
                appRouter.createCaller(buildContext('create-general-failure-http', auth)).join.createGeneral({
                    name: '재시장수',
                    leadership: 55,
                    strength: 55,
                    intel: 55,
                    pic: false,
                    character: 'Random',
                    clientRequestId: requestUuid,
                })
            ).resolves.toMatchObject({ ok: true, generalId: expect.any(Number) });
        } finally {
            await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "${schemaName}"."log_entry"`);
            await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${schemaName}"."${functionName}"()`);
        }

        const created = await db.general.findFirstOrThrow({
            where: { userId: failureUserId },
        });
        expect(runtime!.world.getGeneralById(created.id)).toMatchObject({
            id: created.id,
            userId: failureUserId,
            name: created.name,
        });
        expect(await db.general.count({ where: { userId: failureUserId } })).toBe(1);
        expect(await db.generalTurn.count({ where: { generalId: created.id } })).toBe(30);
        expect(await db.rankData.count({ where: { generalId: created.id } })).toBe(RANK_DATA_TYPES.length);
        await expect(db.inputEvent.findUniqueOrThrow({ where: { requestId } })).resolves.toMatchObject({
            status: 'SUCCEEDED',
            attempts: 2,
            actorUserId: failureUserId,
            error: null,
        });
    }, 45_000);

    it('rejects a forged ENGINE event whose actor does not own the command', async () => {
        const requestId = 'join-create:forged-owner:forged-request';
        await db.inputEvent.create({
            data: {
                requestId,
                target: 'ENGINE',
                eventType: 'joinCreateGeneral',
                actorUserId: 'different-actor',
                payload: {
                    type: 'joinCreateGeneral',
                    requestId,
                    userId: 'forged-owner',
                    ownerDisplayName: '위조사용자',
                    seedOwnerIdentity: 4545,
                    name: '위조장수',
                    leadership: 55,
                    strength: 55,
                    intel: 55,
                    pic: false,
                    character: 'che_안전',
                    profileId: 'hwe',
                } as GamePrisma.InputJsonValue,
            },
        });

        const deadline = Date.now() + 5_000;
        let event = await db.inputEvent.findUniqueOrThrow({
            where: { requestId },
        });
        while (event.status !== 'FAILED' && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            event = await db.inputEvent.findUniqueOrThrow({
                where: { requestId },
            });
        }
        expect(event).toMatchObject({
            status: 'FAILED',
            actorUserId: 'different-actor',
            attempts: 3,
            error: expect.stringContaining('actor does not match'),
        });
        expect(await db.general.count({ where: { userId: 'forged-owner' } })).toBe(0);
        expect(runtime!.world.listGenerals()).not.toEqual(
            expect.arrayContaining([expect.objectContaining({ userId: 'forged-owner' })])
        );
    }, 10_000);
});
