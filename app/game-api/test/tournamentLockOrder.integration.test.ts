import { it, expect } from 'vitest';
import {
    createGamePostgresConnector,
    createRedisConnector,
    acquireGameSchemaAdvisoryXactLock,
    CLOCK_OPERATION_PERSISTENCE_LOCK,
} from '@sammo-ts/infra';
import { appRouter } from '../src/router.js';
import { DatabaseTurnDaemonTransport } from '../src/daemon/databaseTransport.js';
import { buildTournamentKeys } from '../src/tournament/keys.js';
import type { GameApiContext } from '../src/context.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = it.skipIf(!databaseUrl || !process.env.REDIS_URL);

integration.each([
    'setState',
    'patchState',
    'setParticipants',
    'setMatches',
    'setBettingEntries',
    'seedParticipants',
    'cancel',
])(
    'serializes %s behind a joining user without holding the ENGINE clock lock',
    async (adminAction) => {
        const url = databaseUrl!;
        const connector = createGamePostgresConnector({ url });
        const redisConnector = createRedisConnector({ url: process.env.REDIS_URL! });
        await connector.connect();
        await redisConnector.connect();
        const db = connector.prisma;
        const redis = redisConnector.client;
        const profileName = 'che:tournament-lock-integration';
        const keys = buildTournamentKeys(profileName);
        const redisKeys = [...Object.values(keys), `${keys.stateKey}:mutation-lock`];
        const prefix = 'integration:tournament-lock:';
        const nextAt = new Date().toISOString();
        let notifyJoin: () => void;
        const joinAtDaemon = new Promise<void>((resolve) => {
            notifyJoin = resolve;
        });
        let notifyAdmin: () => void;
        const adminAtRedis = new Promise<void>((resolve) => {
            notifyAdmin = resolve;
        });
        const transport = new DatabaseTurnDaemonTransport(db, 4_000);
        try {
            await redis.del(redisKeys);
            await db.inputEvent.deleteMany({ where: { requestId: { startsWith: prefix } } });
            await db.worldState.deleteMany({ where: { id: -991900 } });
            await db.general.deleteMany({ where: { id: 991900 } });
            await db.turnDaemonLease.deleteMany({ where: { profile: profileName } });
            await db.turnDaemonLease.create({
                data: {
                    profile: profileName,
                    ownerId: 'audit',
                    leaseUntil: new Date(Date.now() + 60000),
                    clockReady: true,
                },
            });
            await db.worldState.create({
                data: {
                    id: -991900,
                    scenarioCode: 'audit',
                    currentYear: 200,
                    currentMonth: 1,
                    tickSeconds: 60,
                    clockBaseTime: new Date(),
                    clockTick: 0n,
                    clockWallAnchor: new Date(),
                    clockPhase: 'RUNNING',
                    clockRevision: 1n,
                    config: { const: { develCost: 10 } },
                },
            });
            await db.general.create({
                data: { id: 991900, userId: 'audit-user', name: 'audit', turnTime: new Date(), gold: 1000 },
            });
            await redis.set(
                keys.stateKey,
                JSON.stringify({
                    stage: 1,
                    phase: 0,
                    type: 0,
                    auto: false,
                    openYear: 200,
                    openMonth: 1,
                    termSeconds: 60,
                    nextAt,
                })
            );
            const base: Partial<GameApiContext> = {
                db,
                redis,
                profile: { id: 'che', scenario: 'tournament-lock-integration', name: profileName },
                auth: {
                    version: 1,
                    profile: profileName,
                    issuedAt: new Date().toISOString(),
                    expiresAt: '2999-01-01T00:00:00Z',
                    sessionId: 'audit',
                    user: { id: 'audit-user', username: 'audit', displayName: 'audit', roles: [] },
                    sanctions: {},
                },
                turnDaemon: {
                    sendCommand: transport.sendCommand.bind(transport),
                    requestStatus: transport.requestStatus.bind(transport),
                    requestCommand: async (command) => {
                        notifyJoin!();
                        await adminAtRedis;
                        const requestId = await transport.sendCommand(command);
                        return db.$transaction(async (tx) => {
                            // 이전 순서에서는 관리자가 DB lock을 보유하여 별도 ENGINE 연결이 막힌다.
                            await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '500ms'");
                            await acquireGameSchemaAdvisoryXactLock(tx, CLOCK_OPERATION_PERSISTENCE_LOCK);
                            if (command.type !== 'adjustGeneralResources') throw new Error('unexpected command');
                            const result = {
                                type: 'adjustGeneralResources' as const,
                                ok: true as const,
                                processed: 1,
                                missing: 0,
                                totalGoldDelta: -10,
                                totalRiceDelta: 0,
                            };
                            await tx.inputEvent.update({ where: { requestId }, data: { status: 'SUCCEEDED', result } });
                            return result;
                        });
                    },
                },
            };
            const joinContext = { ...base, requestId: `${prefix}join` } as GameApiContext;
            const adminRedis = new Proxy(redis, {
                get(target, property) {
                    if (property === 'set')
                        return async (...args: Parameters<typeof redis.set>) => {
                            if (args[0] === `${keys.stateKey}:mutation-lock`) notifyAdmin!();
                            return redis.set(...args);
                        };
                    const value = Reflect.get(target, property);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
            const adminContext = {
                ...base,
                requestId: `${prefix}admin`,
                redis: adminRedis,
                auth: { ...base.auth!, user: { ...base.auth!.user, roles: ['admin'] } },
            } as GameApiContext;
            const callAdmin = async (context: GameApiContext) => {
                const caller = appRouter.createCaller(context).tournament;
                switch (adminAction) {
                    case 'setState':
                        return caller.setState({
                            stage: 1,
                            phase: 0,
                            type: 0,
                            auto: false,
                            openYear: 200,
                            openMonth: 1,
                            termSeconds: 60,
                            nextAt,
                        });
                    case 'patchState':
                        return caller.patchState({ auto: true });
                    case 'setParticipants':
                        return caller.setParticipants([]);
                    case 'setMatches':
                        return caller.setMatches([]);
                    case 'setBettingEntries':
                        return caller.setBettingEntries([]);
                    case 'seedParticipants':
                        return caller.seedParticipants({ generalIds: [991900] });
                    default:
                        return caller.cancel();
                }
            };
            const join = appRouter.createCaller(joinContext).tournament.join();
            const joinOutcome = join.then(
                (value) => ({ ok: true, value }),
                (error) => ({ ok: false, error })
            );
            await joinAtDaemon;
            const admin = callAdmin(adminContext);
            const adminOutcome = admin.then(
                (value) => ({ ok: true, value }),
                (error) => ({ ok: false, error })
            );
            await adminAtRedis;
            const [joined, managed] = await Promise.all([joinOutcome, adminOutcome]);
            expect(joined).toMatchObject({ ok: true, value: { ok: true, count: 1 } });
            expect(managed).toMatchObject({ ok: true, value: { ok: true } });
            const revision = await redis.get(keys.sourceRevisionKey);
            const engineCount = await db.inputEvent.count({
                where: { requestId: { startsWith: prefix }, target: 'ENGINE' },
            });
            // API 입력 원장은 유지한다. 동일 요청 재실행은 Redis/환불 command를 다시 쓰지 않는다.
            await expect(callAdmin(adminContext)).resolves.toMatchObject({ ok: true });
            expect(await redis.get(keys.sourceRevisionKey)).toBe(revision);
            expect(await db.inputEvent.count({ where: { requestId: { startsWith: prefix }, target: 'ENGINE' } })).toBe(
                engineCount
            );
            const inputEvent = await db.inputEvent.findUniqueOrThrow({
                where: { requestId: `${prefix}admin:tournament.${adminAction}` },
            });
            expect(inputEvent).toMatchObject({ target: 'API', status: 'SUCCEEDED', attempts: 1 });
            expect(await redis.get(`${keys.stateKey}:mutation-lock`)).toBeNull();
            const retryContext = { ...adminContext, requestId: `${prefix}retry` };
            const beforeFailure = await redis.get(keys.sourceRevisionKey);
            await db.worldState.update({ where: { id: -991900 }, data: { clockPhase: 'SUSPENDED' } });
            await expect(callAdmin(retryContext)).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
            expect(await redis.get(`${keys.stateKey}:mutation-lock`)).toBeNull();
            expect(await redis.get(keys.sourceRevisionKey)).toBe(beforeFailure);
            await db.worldState.update({ where: { id: -991900 }, data: { clockPhase: 'RUNNING' } });
            await expect(callAdmin(retryContext)).resolves.toMatchObject({ ok: true });
            expect(
                await db.inputEvent.findUniqueOrThrow({
                    where: { requestId: `${prefix}retry:tournament.${adminAction}` },
                })
            ).toMatchObject({ status: 'SUCCEEDED', attempts: 2 });
        } finally {
            await redis.del(redisKeys);
            await db.inputEvent.deleteMany({ where: { requestId: { startsWith: prefix } } });
            await db.general.deleteMany({ where: { id: 991900 } });
            await db.worldState.deleteMany({ where: { id: -991900 } });
            await db.turnDaemonLease.deleteMany({ where: { profile: profileName } });
            await redisConnector.disconnect();
            await connector.disconnect();
        }
    },
    15000
);
