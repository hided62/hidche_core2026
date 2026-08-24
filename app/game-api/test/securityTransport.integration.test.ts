import fs from 'node:fs/promises';
import { createServer, type Server as HttpServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { encryptGameSessionToken, type GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import {
    createGamePostgresConnector,
    createRedisConnector,
    enqueueWebPushOutboxEvents,
    resolveRedisConfigFromEnv,
    type GamePrismaClient,
    type RedisConnector,
} from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { scopeHttpIdempotencyKey } from '../src/requestId.js';
import { createGameApiServer } from '../src/server.js';
import { WebPushOutboxWorker } from '../src/services/webPushOutboxWorker.js';

const databaseUrl = process.env.SECURITY_TRANSPORT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl || !process.env.REDIS_URL);
const dedicatedSuffix = 'security_transport';
let profileId = process.env.POSTGRES_SCHEMA ?? 'conditional_integration';
const runId = process.env.CONDITIONAL_INTEGRATION_RUN_ID ?? String(process.pid);
const profileName = `che:security-http-${runId}`;
const userId = `security-http-user-${process.pid}`;
const noGeneralUserId = `security-http-no-general-${process.pid}`;
const sameNationUserId = `security-http-same-nation-${process.pid}`;
const foreignUserId = `security-http-foreign-${process.pid}`;
const ordinaryUserId = `security-http-ordinary-${process.pid}`;
const generalId = 990_001;
const sameNationGeneralId = 990_002;
const foreignGeneralId = 990_003;
const npcGeneralId = 990_004;
const ordinaryGeneralId = 990_005;
const fixtureGeneralIds = [generalId, sameNationGeneralId, foreignGeneralId, npcGeneralId, ordinaryGeneralId];
const ownerNationId = 99_001;
const foreignNationId = 99_002;
const fixtureNationIds = [ownerNationId, foreignNationId];
const fixtureWorldId = 990_001;
const mutationRequestPrefix = `security-http-matrix-${process.pid}-`;
const matrixApiEventTypes = [
    'messages.send',
    'turns.reserved.setGeneral',
    'turns.reserved.setNation',
] as const;
const fixtureActorUserIds = [userId, noGeneralUserId, sameNationUserId, foreignUserId, ordinaryUserId];
const secret = 'security-http-e2e-secret';
const redisPrefix = `sammo:security-http:${process.pid}`;
const envKeys = [
    'DATABASE_URL',
    'PROFILE',
    'SCENARIO',
    'GAME_PROFILE_NAME',
    'GAME_API_HOST',
    'GAME_API_PORT',
    'GAME_TOKEN_SECRET',
    'GATEWAY_REDIS_PREFIX',
    'GATEWAY_INTERNAL_API_URL',
    'GAME_UPLOAD_DIR',
] as const;
const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));

type RunningServer = Awaited<ReturnType<typeof createGameApiServer>>;

let server: RunningServer | null = null;
let baseUrl = '';
let uploadDir = '';
let db: GamePrismaClient;
let disconnectDb: (() => Promise<void>) | null = null;
let redis: RedisConnector | null = null;
let accessTokenStore: RedisAccessTokenStore;
let createdFixtureWorld = false;
let gatewayStatusServer: HttpServer | null = null;
let receivedGatewayWebPushEvents: Array<{ internalToken: string | null; body: unknown }> = [];

export const assertDedicatedSecurityTransportDatabase = (rawUrl: string): void => {
    resolveDedicatedSecurityTransportTarget(rawUrl);
};

const resolveDedicatedSecurityTransportTarget = (rawUrl: string): { databaseUrl: string; schema: string } => {
    const url = new URL(rawUrl);
    const schema = url.searchParams.get('schema');
    const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!schema?.endsWith(dedicatedSuffix) && !databaseName.endsWith(dedicatedSuffix)) {
        throw new Error(
            `Refusing to mutate non-dedicated security transport database: schema=${schema ?? '(missing)'}, database=${databaseName || '(missing)'}`
        );
    }
    const effectiveSchema = schema?.trim() || 'public';
    url.searchParams.set('schema', effectiveSchema);
    return { databaseUrl: url.href, schema: effectiveSchema };
};

const restoreEnv = (): void => {
    for (const [key, value] of originalEnv) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
};

const listenGatewayStatusStub = async (): Promise<string> => {
    gatewayStatusServer = createServer((request, response) => {
        if (request.method === 'GET' && request.url === `/internal/profile-status/${encodeURIComponent(profileName)}`) {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ profileName, status: 'RUNNING' }));
            return;
        }
        if (request.method === 'POST' && request.url === '/internal/account-icon-resets') {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ resets: [] }));
            return;
        }
        if (request.method === 'POST' && request.url === '/internal/web-push-events') {
            const chunks: Buffer[] = [];
            request.on('data', (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
            request.on('end', () => {
                try {
                    receivedGatewayWebPushEvents.push({
                        internalToken:
                            typeof request.headers['x-sammo-internal-token'] === 'string'
                                ? request.headers['x-sammo-internal-token']
                                : null,
                        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
                    });
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end('{}');
                } catch {
                    response.writeHead(400);
                    response.end();
                }
            });
            return;
        }
        response.writeHead(404);
        response.end();
    });
    await new Promise<void>((resolve, reject) => {
        gatewayStatusServer!.once('error', reject);
        gatewayStatusServer!.listen(0, '127.0.0.1', () => {
            gatewayStatusServer!.off('error', reject);
            resolve();
        });
    });
    const address = gatewayStatusServer.address();
    if (!address || typeof address === 'string') throw new Error('gateway status stub did not bind a TCP port');
    return `http://127.0.0.1:${address.port}`;
};

const closeGatewayStatusStub = async (): Promise<void> => {
    if (!gatewayStatusServer) return;
    const current = gatewayStatusServer;
    gatewayStatusServer = null;
    await new Promise<void>((resolve, reject) => current.close((error) => (error ? reject(error) : resolve())));
};

const deleteProfileRedisKeys = async (): Promise<void> => {
    if (!redis) {
        return;
    }
    for (const pattern of [`sammo:game:*:${profileName}:*`, `sammo:${profileName}:*`]) {
        for await (const keys of redis.client.scanIterator({
            MATCH: pattern,
            COUNT: 100,
        })) {
            if (keys.length > 0) {
                await redis.client.del(keys);
            }
        }
    }
};

const buildPayload = (
    suffix: string,
    sanctions: GameSessionTokenPayload['sanctions'],
    actorUserId = userId,
    actorProfile = profileName
): GameSessionTokenPayload => ({
    version: 1,
    profile: actorProfile,
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    sessionId: `security-http-session-${process.pid}-${suffix}`,
    user: {
        id: actorUserId,
        username: 'security-http-user',
        displayName: 'Security HTTP User',
        roles: ['user'],
        createdAt: '2026-07-26T00:00:00.000Z',
    },
    sanctions,
});

const createAccessToken = async (
    suffix: string,
    sanctions: GameSessionTokenPayload['sanctions'],
    actorUserId = userId
): Promise<string> => {
    const created = await accessTokenStore.create(buildPayload(suffix, sanctions, actorUserId));
    if (!created) {
        throw new Error('failed to seed the game access token');
    }
    return created.accessToken;
};

const requestTrpc = async (
    procedure: string,
    options: {
        method?: 'GET' | 'POST';
        input?: unknown;
        accessToken?: string;
        idempotencyKey?: string;
    } = {}
): Promise<{ response: Response; body: unknown }> => {
    const method = options.method ?? 'GET';
    const response = await fetch(`${baseUrl}/trpc/${procedure}`, {
        method,
        headers: {
            ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
            ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
            ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
        },
        ...(method === 'POST' ? { body: JSON.stringify(options.input) } : {}),
    });
    return {
        response,
        body: (await response.json()) as unknown,
    };
};

const readReservedMutationState = async () => ({
    generals: await db.general.findMany({
        where: { id: { in: fixtureGeneralIds } },
        select: {
            id: true,
            userId: true,
            nationId: true,
            officerLevel: true,
            lastTurn: true,
            meta: true,
        },
        orderBy: { id: 'asc' },
    }),
    generalTurns: await db.generalTurn.findMany({
        where: { generalId: { in: fixtureGeneralIds } },
        select: { generalId: true, turnIdx: true, actionCode: true, arg: true },
        orderBy: [{ generalId: 'asc' }, { turnIdx: 'asc' }],
    }),
    generalTurnRevisions: await db.generalTurnRevision.findMany({
        where: { generalId: { in: fixtureGeneralIds } },
        select: { generalId: true, revision: true, leaseOwner: true, leaseExpiresAt: true },
        orderBy: { generalId: 'asc' },
    }),
    generalAccessLogs: await db.generalAccessLog.findMany({
        where: { generalId: { in: fixtureGeneralIds } },
        select: {
            generalId: true,
            userId: true,
            lastRefresh: true,
            refresh: true,
            refreshTotal: true,
            refreshScore: true,
            refreshScoreTotal: true,
            lastActionAt: true,
        },
        orderBy: { generalId: 'asc' },
    }),
    nationTurns: await db.nationTurn.findMany({
        where: { nationId: { in: fixtureNationIds } },
        select: { nationId: true, officerLevel: true, turnIdx: true, actionCode: true, arg: true },
        orderBy: [{ nationId: 'asc' }, { officerLevel: 'asc' }, { turnIdx: 'asc' }],
    }),
    nationTurnRevisions: await db.nationTurnRevision.findMany({
        where: { nationId: { in: fixtureNationIds } },
        select: { nationId: true, officerLevel: true, revision: true, leaseOwner: true, leaseExpiresAt: true },
        orderBy: [{ nationId: 'asc' }, { officerLevel: 'asc' }],
    }),
    readModelRevisions: await db.readModelRevision.findMany({
        where: {
            OR: [
                { domain: 'reserved.general', entityId: { in: fixtureGeneralIds } },
                { domain: 'dashboard.global', entityId: 0 },
            ],
        },
        select: { domain: true, entityId: true, revision: true },
        orderBy: [{ domain: 'asc' }, { entityId: 'asc' }],
    }),
    readModelOutbox: await db.readModelOutbox.findMany({
        select: { id: true, payload: true },
        orderBy: { id: 'asc' },
    }),
    messages: await db.message.findMany({
        where: {
            OR: [{ src: { in: fixtureGeneralIds } }, { dest: { in: [...fixtureGeneralIds, ...fixtureNationIds] } }],
        },
        select: { id: true, mailbox: true, type: true, src: true, dest: true, message: true },
        orderBy: { id: 'asc' },
    }),
    logs: await db.logEntry.findMany({
        where: {
            OR: [{ generalId: { in: fixtureGeneralIds } }, { nationId: { in: fixtureNationIds } }],
        },
        select: { id: true, scope: true, category: true, generalId: true, nationId: true, text: true },
        orderBy: { id: 'asc' },
    }),
    engineInputEvents: await db.inputEvent.findMany({
        where: { target: 'ENGINE', actorUserId: { in: fixtureActorUserIds } },
        select: { requestId: true, eventType: true, status: true, actorUserId: true },
        orderBy: { sequence: 'asc' },
    }),
    webPushOutboxCount: await db.webPushOutbox.count(),
    eventCount: await db.event.count(),
    auctionCount: await db.auction.count(),
    auctionBidCount: await db.auctionBid.count(),
});

const quotePostgresIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const isMatrixApiInputEvent = (rowJson: string): boolean => {
    const row = JSON.parse(rowJson) as { target?: unknown; event_type?: unknown };
    return row.target === 'API' && matrixApiEventTypes.includes(row.event_type as (typeof matrixApiEventTypes)[number]);
};

const deleteMatrixInputEvents = async (): Promise<void> => {
    await db.inputEvent.deleteMany({
        where: {
            OR: [
                { requestId: { startsWith: mutationRequestPrefix } },
                { target: 'API', eventType: { in: [...matrixApiEventTypes] } },
                { target: 'ENGINE', actorUserId: { in: fixtureActorUserIds } },
            ],
        },
    });
};

const resolveScopedApiRequestId = (idempotencyKey: string, procedure: string, actorUserId: string): string => {
    const scopedRequestId = scopeHttpIdempotencyKey({ rawKey: idempotencyKey, profileId, userId: actorUserId });
    if (!scopedRequestId) {
        throw new Error('matrix idempotency key unexpectedly resolved to an empty request ID');
    }
    return `${scopedRequestId}:${procedure}`;
};

const readDurableSchemaStateExcludingMatrixApiJournal = async () => {
    const tables = await db.$queryRawUnsafe<Array<{ tableName: string }>>(
        `SELECT table_name AS "tableName"
         FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
        profileId
    );
    return Promise.all(
        tables.map(async ({ tableName }) => {
            const qualifiedTable = `${quotePostgresIdentifier(profileId)}.${quotePostgresIdentifier(tableName)}`;
            const rows = await db.$queryRawUnsafe<Array<{ rowJson: string }>>(
                `SELECT to_jsonb(snapshot_row)::text AS "rowJson"
                 FROM ${qualifiedTable} AS snapshot_row
                 ORDER BY to_jsonb(snapshot_row)::text`
            );
            return {
                tableName,
                rows: rows
                    .map(({ rowJson }) => rowJson)
                    .filter((rowJson) => tableName !== 'input_event' || !isMatrixApiInputEvent(rowJson)),
            };
        })
    );
};

type DurableSchemaState = Awaited<ReturnType<typeof readDurableSchemaStateExcludingMatrixApiJournal>>;

const withoutDurableTables = (state: DurableSchemaState, allowedTables: readonly string[]): DurableSchemaState => {
    const allowed = new Set(allowedTables);
    return state.filter(({ tableName }) => !allowed.has(tableName));
};

const readSuccessAllowedTableState = async () => ({
    generalTurns: await db.generalTurn.findMany({ orderBy: [{ generalId: 'asc' }, { turnIdx: 'asc' }] }),
    generalTurnRevisions: await db.generalTurnRevision.findMany({ orderBy: { generalId: 'asc' } }),
    nationTurns: await db.nationTurn.findMany({
        orderBy: [{ nationId: 'asc' }, { officerLevel: 'asc' }, { turnIdx: 'asc' }],
    }),
    nationTurnRevisions: await db.nationTurnRevision.findMany({
        orderBy: [{ nationId: 'asc' }, { officerLevel: 'asc' }],
    }),
    generalAccessLogs: await db.generalAccessLog.findMany({ orderBy: { generalId: 'asc' } }),
    readModelRevisions: await db.readModelRevision.findMany({
        orderBy: [{ domain: 'asc' }, { entityId: 'asc' }],
    }),
    readModelOutbox: await db.readModelOutbox.findMany({ orderBy: { id: 'asc' } }),
});

const readAccessTelemetryState = async () => ({
    periods: await db.trafficPeriod.findMany({ orderBy: { id: 'asc' } }),
    generals: await db.trafficPeriodGeneral.findMany({
        orderBy: [{ periodId: 'asc' }, { generalId: 'asc' }],
    }),
    accessLogs: await db.generalAccessLog.findMany({ orderBy: { generalId: 'asc' } }),
});

const readRealtimeRedisState = async (): Promise<Array<[string, string | null]>> => {
    if (!redis) return [];
    const keys = new Set<string>();
    for (const pattern of [`sammo:game:*:${profileName}:*`, `sammo:${profileName}:*`]) {
        for await (const batch of redis.client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
            for (const key of batch) keys.add(key);
        }
    }
    return Promise.all(
        [...keys].sort().map(async (key) => [key, await redis!.client.get(key)] as [string, string | null])
    );
};

const expectApiInputEvent = async (
    idempotencyKey: string,
    procedure: string,
    expected: { actorUserId: string; status: 'FAILED' | 'SUCCEEDED' } | null
): Promise<void> => {
    const events = await db.inputEvent.findMany({
        // The HTTP boundary hashes the raw client key together with profile and
        // actor. Query the whole procedure matrix so an unexpected extra row
        // cannot hide behind the full-schema snapshot's explicit exclusion.
        where: { target: 'API', eventType: { in: [...matrixApiEventTypes] } },
        select: {
            requestId: true,
            target: true,
            eventType: true,
            payload: true,
            actorUserId: true,
            status: true,
            result: true,
            error: true,
            attempts: true,
            lockedBy: true,
            leaseUntil: true,
            processingAt: true,
            completedAt: true,
            createdAt: true,
        },
        orderBy: { sequence: 'asc' },
    });
    if (!expected) {
        expect(events).toEqual([]);
        return;
    }
    const requestId = resolveScopedApiRequestId(idempotencyKey, procedure, expected.actorUserId);
    expect(events).toEqual([
        {
            requestId,
            target: 'API',
            eventType: procedure,
            payload: {},
            actorUserId: expected.actorUserId,
            status: expected.status,
            result: expected.status === 'SUCCEEDED' ? { ok: true } : null,
            error: expected.status === 'SUCCEEDED' ? null : expect.any(String),
            attempts: 1,
            lockedBy: null,
            leaseUntil: null,
            processingAt: expect.any(Date),
            completedAt: expect.any(Date),
            createdAt: expect.any(Date),
        },
    ]);
    const event = events[0];
    if (!event?.processingAt || !event.completedAt) {
        throw new Error('API input event must have processing/completion timestamps');
    }
    expect(event.completedAt.getTime()).toBeGreaterThanOrEqual(event.processingAt.getTime());
    if (expected.status === 'FAILED') {
        expect(event.error?.length).toBeGreaterThan(0);
    }
};

const expectSingleActorActivity = (
    rows: Awaited<ReturnType<typeof readReservedMutationState>>['generalAccessLogs']
) => {
    expect(rows).toEqual([
        {
            generalId,
            userId,
            lastRefresh: null,
            refresh: 0,
            refreshTotal: 0,
            refreshScore: 0,
            refreshScoreTotal: 0,
            lastActionAt: expect.any(Date),
        },
    ]);
};

const requestReservedGeneral = (accessToken: string | undefined, idempotencyKey: string, targetGeneralId = generalId) =>
    requestTrpc('turns.reserved.setGeneral', {
        method: 'POST',
        input: {
            generalId: targetGeneralId,
            turnIndex: 0,
            action: '휴식',
            args: {},
            expectedRevision: 0,
        },
        accessToken,
        idempotencyKey,
    });

const requestReservedNation = (accessToken: string, idempotencyKey: string, targetGeneralId: number) =>
    requestTrpc('turns.reserved.setNation', {
        method: 'POST',
        input: {
            generalId: targetGeneralId,
            turnIndex: 0,
            action: '휴식',
            args: {},
            expectedRevision: 0,
        },
        accessToken,
        idempotencyKey,
    });

const ownershipDenialCases = [
    {
        label: 'authenticated user without a general',
        actorUserId: noGeneralUserId,
        targetGeneralId: generalId,
    },
    {
        label: 'same-nation foreign-owned general',
        actorUserId: userId,
        targetGeneralId: sameNationGeneralId,
    },
    {
        label: 'other-nation foreign-owned general',
        actorUserId: userId,
        targetGeneralId: foreignGeneralId,
    },
    {
        label: 'NPC general',
        actorUserId: userId,
        targetGeneralId: npcGeneralId,
    },
] as const;

describe('security transport database guard', () => {
    it('rejects a shared database and schema before connecting', () => {
        expect(() =>
            assertDedicatedSecurityTransportDatabase('postgresql://fixture:fixture@127.0.0.1:5432/sammo?schema=public')
        ).toThrow('Refusing to mutate non-dedicated security transport database');
    });

    it('accepts only an explicitly dedicated schema or database name', () => {
        expect(() =>
            assertDedicatedSecurityTransportDatabase(
                'postgresql://fixture:fixture@127.0.0.1:5432/sammo?schema=ci_security_transport'
            )
        ).not.toThrow();
        expect(() =>
            assertDedicatedSecurityTransportDatabase(
                'postgresql://fixture:fixture@127.0.0.1:5432/ci_security_transport'
            )
        ).not.toThrow();
    });
});

integration('game API security over HTTP transport', () => {
    beforeAll(async () => {
        const dedicatedTarget = resolveDedicatedSecurityTransportTarget(databaseUrl!);
        profileId = dedicatedTarget.schema;
        uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-game-security-http-'));
        process.env.DATABASE_URL = dedicatedTarget.databaseUrl;
        process.env.PROFILE = dedicatedTarget.schema;
        process.env.SCENARIO = 'security-http';
        process.env.GAME_PROFILE_NAME = profileName;
        process.env.GAME_API_HOST = '127.0.0.1';
        process.env.GAME_API_PORT = '0';
        process.env.GAME_TOKEN_SECRET = secret;
        process.env.GATEWAY_REDIS_PREFIX = redisPrefix;
        process.env.GATEWAY_INTERNAL_API_URL = await listenGatewayStatusStub();
        process.env.GAME_UPLOAD_DIR = uploadDir;

        const connector = createGamePostgresConnector({ url: dedicatedTarget.databaseUrl });
        await connector.connect();
        db = connector.prisma;
        disconnectDb = () => connector.disconnect();
        await db.generalAccessLog.deleteMany({ where: { generalId: { in: fixtureGeneralIds } } });
        await db.generalTurn.deleteMany({ where: { generalId: { in: fixtureGeneralIds } } });
        await db.generalTurnRevision.deleteMany({ where: { generalId: { in: fixtureGeneralIds } } });
        await db.nationTurn.deleteMany({ where: { nationId: { in: fixtureNationIds } } });
        await db.nationTurnRevision.deleteMany({ where: { nationId: { in: fixtureNationIds } } });
        await db.general.deleteMany({ where: { id: { in: fixtureGeneralIds } } });
        await db.general.createMany({
            data: [
                {
                    id: generalId,
                    userId,
                    name: '보안HTTP',
                    nationId: ownerNationId,
                    officerLevel: 12,
                    turnTime: new Date('2026-07-26T00:00:00.000Z'),
                },
                {
                    id: sameNationGeneralId,
                    userId: sameNationUserId,
                    name: '동일국타인',
                    nationId: ownerNationId,
                    officerLevel: 5,
                    turnTime: new Date('2026-07-26T00:00:00.000Z'),
                },
                {
                    id: foreignGeneralId,
                    userId: foreignUserId,
                    name: '타국타인',
                    nationId: foreignNationId,
                    officerLevel: 5,
                    turnTime: new Date('2026-07-26T00:00:00.000Z'),
                },
                {
                    id: npcGeneralId,
                    userId: null,
                    name: 'NPC장수',
                    nationId: ownerNationId,
                    npcState: 2,
                    officerLevel: 5,
                    turnTime: new Date('2026-07-26T00:00:00.000Z'),
                },
                {
                    id: ordinaryGeneralId,
                    userId: ordinaryUserId,
                    name: '비수뇌',
                    nationId: ownerNationId,
                    officerLevel: 4,
                    turnTime: new Date('2026-07-26T00:00:00.000Z'),
                },
            ],
        });
        if ((await db.worldState.count()) === 0) {
            await db.worldState.create({
                data: {
                    id: fixtureWorldId,
                    scenarioCode: 'security-http',
                    currentYear: 190,
                    currentMonth: 1,
                    tickSeconds: 600,
                    config: {},
                    meta: {},
                },
            });
            createdFixtureWorld = true;
        }
        await db.trafficPeriodGeneral.deleteMany({ where: { generalId: { in: fixtureGeneralIds } } });
        await db.trafficPeriod.deleteMany({ where: { worldStateId: fixtureWorldId } });
        await db.readModelOutbox.deleteMany();
        await db.webPushOutbox.deleteMany();

        redis = createRedisConnector(resolveRedisConfigFromEnv());
        await redis.connect();
        accessTokenStore = new RedisAccessTokenStore(redis.client, profileName);

        server = await createGameApiServer();
        baseUrl = await server.app.listen({
            host: server.config.host,
            port: server.config.port,
        });
    }, 30_000);

    afterAll(async () => {
        await server?.app.close();
        await closeGatewayStatusStub();
        if (db) await deleteMatrixInputEvents();
        await db?.trafficPeriodGeneral.deleteMany({ where: { generalId: { in: fixtureGeneralIds } } });
        await db?.trafficPeriod.deleteMany({ where: { worldStateId: fixtureWorldId } });
        await db?.generalAccessLog.deleteMany({ where: { generalId: { in: fixtureGeneralIds } } });
        await db?.generalTurn.deleteMany({ where: { generalId: { in: fixtureGeneralIds } } });
        await db?.generalTurnRevision.deleteMany({ where: { generalId: { in: fixtureGeneralIds } } });
        await db?.nationTurn.deleteMany({ where: { nationId: { in: fixtureNationIds } } });
        await db?.nationTurnRevision.deleteMany({ where: { nationId: { in: fixtureNationIds } } });
        await db?.readModelRevision.deleteMany({
            where: {
                OR: [
                    { domain: 'reserved.general', entityId: { in: fixtureGeneralIds } },
                    { domain: 'dashboard.global', entityId: 0 },
                ],
            },
        });
        await db?.readModelOutbox.deleteMany();
        await db?.webPushOutbox.deleteMany();
        await db?.general.deleteMany({ where: { id: { in: fixtureGeneralIds } } });
        if (createdFixtureWorld) {
            await db?.worldState.deleteMany({ where: { id: fixtureWorldId } });
        }
        await disconnectDb?.();
        await deleteProfileRedisKeys();
        await redis?.disconnect();
        if (uploadDir) {
            await fs.rm(uploadDir, { recursive: true, force: true });
        }
        restoreEnv();
    }, 30_000);

    beforeEach(async () => {
        await deleteMatrixInputEvents();
        await db.trafficPeriodGeneral.deleteMany({ where: { generalId: { in: fixtureGeneralIds } } });
        await db.trafficPeriod.deleteMany({ where: { worldStateId: fixtureWorldId } });
        await db.generalAccessLog.deleteMany({ where: { generalId: { in: fixtureGeneralIds } } });
        await db.generalTurn.deleteMany({ where: { generalId: { in: fixtureGeneralIds } } });
        await db.generalTurnRevision.deleteMany({ where: { generalId: { in: fixtureGeneralIds } } });
        await db.nationTurn.deleteMany({ where: { nationId: { in: fixtureNationIds } } });
        await db.nationTurnRevision.deleteMany({ where: { nationId: { in: fixtureNationIds } } });
        await db.readModelRevision.deleteMany({
            where: {
                OR: [
                    { domain: 'reserved.general', entityId: { in: fixtureGeneralIds } },
                    { domain: 'dashboard.global', entityId: 0 },
                ],
            },
        });
        await db.readModelOutbox.deleteMany();
        await db.webPushOutbox.deleteMany();
        receivedGatewayWebPushEvents = [];
        if (redis) {
            await redis.client.del(`sammo:${profileName}:read-model:revision`);
        }
    });

    it('accepts an authenticated query from a POST JSON body', async () => {
        const accessToken = await createAccessToken('json-query-body', {});
        const general = await requestTrpc('general.me', {
            method: 'POST',
            input: null,
            accessToken,
        });

        expect(general.response.status).toBe(200);
        expect(general.body).toMatchObject({
            result: {
                data: {
                    general: {
                        id: generalId,
                    },
                },
            },
        });
    });

    it.each([
        {
            label: 'global suspension',
            sanctions: () => ({ suspendedUntil: '2099-01-01T00:00:00.000Z' }),
        },
        {
            label: 'instance game restriction',
            sanctions: () => ({
                serverRestrictions: {
                    [profileName]: {
                        blockedFeatures: ['game'],
                    },
                },
            }),
        },
        {
            label: 'profile-id wildcard restriction',
            sanctions: () => ({
                serverRestrictions: {
                    [profileId]: {
                        blockedFeatures: ['*'],
                    },
                },
            }),
        },
    ])('blocks an authenticated game API request for $label', async ({ label, sanctions }) => {
        const accessToken = await createAccessToken(label.replaceAll(' ', '-'), sanctions());
        const durableBefore = await readDurableSchemaStateExcludingMatrixApiJournal();
        const redisBefore = await readRealtimeRedisState();
        const blocked = await requestTrpc('general.me', { accessToken });

        expect(blocked.response.status).toBe(403);
        expect(blocked.body).toMatchObject({
            error: {
                data: {
                    code: 'FORBIDDEN',
                },
            },
        });
        expect(await readDurableSchemaStateExcludingMatrixApiJournal()).toEqual(durableBefore);
        expect(await readRealtimeRedisState()).toEqual(redisBefore);
    });

    it.each([
        {
            label: 'global mute',
            sanctions: { mutedUntil: '2099-01-01T00:00:00.000Z' },
        },
        {
            label: 'instance message restriction',
            sanctions: {
                serverRestrictions: {
                    [profileName]: {
                        blockedFeatures: ['messages'],
                    },
                },
            },
        },
    ])('allows non-message APIs but blocks message send for $label', async ({ label, sanctions }) => {
        const accessToken = await createAccessToken(label.replaceAll(' ', '-'), sanctions);
        const idempotencyKey = `${mutationRequestPrefix}message-${label.replaceAll(' ', '-')}`;
        const general = await requestTrpc('general.me', { accessToken });
        expect(general.response.status).toBe(200);
        expect(general.body).toMatchObject({
            result: {
                data: {
                    general: {
                        id: generalId,
                    },
                },
            },
        });
        const durableBefore = await readDurableSchemaStateExcludingMatrixApiJournal();
        const telemetryBefore = await readAccessTelemetryState();
        const redisBefore = await readRealtimeRedisState();

        const message = await requestTrpc('messages.send', {
            method: 'POST',
            input: {
                generalId,
                mailbox: 0,
                text: '차단되어야 하는 메시지',
            },
            accessToken,
            idempotencyKey,
        });
        expect(message.response.status).toBe(403);
        expect(message.body).toMatchObject({
            error: {
                data: {
                    code: 'FORBIDDEN',
                },
            },
        });
        await expectApiInputEvent(idempotencyKey, 'messages.send', {
            actorUserId: userId,
            status: 'FAILED',
        });
        expect(telemetryBefore).toEqual({ periods: [], generals: [], accessLogs: [] });
        const telemetryAfter = await readAccessTelemetryState();
        expect(telemetryAfter.periods).toEqual([
            {
                id: expect.any(Number),
                worldStateId: fixtureWorldId,
                year: 190,
                month: 1,
                startedAt: expect.any(Date),
                lastRefresh: expect.any(Date),
                refresh: 1,
                online: 1,
            },
        ]);
        const trafficPeriod = telemetryAfter.periods[0];
        if (!trafficPeriod) throw new Error('message access did not create its traffic period');
        expect(telemetryAfter.generals).toEqual([
            {
                periodId: trafficPeriod.id,
                generalId,
                userId,
                refresh: 1,
                lastRefresh: trafficPeriod.lastRefresh,
            },
        ]);
        expect(telemetryAfter.accessLogs).toEqual([
            {
                id: expect.any(Number),
                generalId,
                userId,
                lastRefresh: trafficPeriod.lastRefresh,
                lastActionAt: null,
                refresh: 1,
                refreshTotal: 1,
                refreshScore: 1,
                refreshScoreTotal: 1,
            },
        ]);
        expect(trafficPeriod.lastRefresh.getTime()).toBeGreaterThanOrEqual(trafficPeriod.startedAt.getTime());
        expect(
            withoutDurableTables(await readDurableSchemaStateExcludingMatrixApiJournal(), [
                'traffic_period',
                'traffic_period_general',
                'general_access_log',
            ])
        ).toEqual(
            withoutDurableTables(durableBefore, ['traffic_period', 'traffic_period_general', 'general_access_log'])
        );
        expect(await readRealtimeRedisState()).toEqual(redisBefore);
    });

    it('rejects a restricted signed gateway token before issuing a game access token', async () => {
        const gatewayToken = encryptGameSessionToken(
            buildPayload('gateway-restricted', {
                serverRestrictions: {
                    [profileName]: {
                        blockedFeatures: ['gameplay'],
                    },
                },
            }),
            secret
        );
        const durableBefore = await readDurableSchemaStateExcludingMatrixApiJournal();
        const redisBefore = await readRealtimeRedisState();
        const blocked = await requestTrpc('auth.exchangeGatewayToken', {
            method: 'POST',
            input: { gatewayToken },
        });

        expect(blocked.response.status).toBe(403);
        expect(blocked.body).toMatchObject({
            error: {
                data: {
                    code: 'FORBIDDEN',
                },
            },
        });
        expect(await readDurableSchemaStateExcludingMatrixApiJournal()).toEqual(durableBefore);
        expect(await readRealtimeRedisState()).toEqual(redisBefore);
    });

    it.each([
        {
            label: 'missing bearer token',
            accessToken: async () => undefined,
            expectedStatus: 401,
            expectedCode: 'UNAUTHORIZED',
        },
        {
            label: 'unknown bearer token',
            accessToken: async () => 'unknown-security-http-token',
            expectedStatus: 401,
            expectedCode: 'UNAUTHORIZED',
        },
        {
            label: 'access token stored for another profile',
            accessToken: async () => {
                const otherProfileStore = new RedisAccessTokenStore(redis!.client, `${profileName}:other`);
                const created = await otherProfileStore.create(
                    buildPayload('cross-profile', {}, userId, `${profileName}:other`)
                );
                if (!created) throw new Error('failed to seed the cross-profile access token');
                return created.accessToken;
            },
            expectedStatus: 401,
            expectedCode: 'UNAUTHORIZED',
        },
        {
            label: 'gameplay sanction',
            accessToken: () =>
                createAccessToken('matrix-sanction', {
                    serverRestrictions: { [profileName]: { blockedFeatures: ['gameplay'] } },
                }),
            expectedStatus: 403,
            expectedCode: 'FORBIDDEN',
        },
    ])(
        'rejects $label before creating an API input event or any durable/Redis gameplay side effect',
        async ({ label, accessToken, expectedStatus, expectedCode }) => {
            const idempotencyKey = `${mutationRequestPrefix}auth-${label.replaceAll(' ', '-')}`;
            const token = await accessToken();
            const databaseBefore = await readReservedMutationState();
            const durableBefore = await readDurableSchemaStateExcludingMatrixApiJournal();
            const redisBefore = await readRealtimeRedisState();

            const result = await requestReservedGeneral(token, idempotencyKey);

            expect(result.response.status).toBe(expectedStatus);
            expect(result.body).toMatchObject({ error: { data: { code: expectedCode } } });
            expect(await readReservedMutationState()).toEqual(databaseBefore);
            expect(await readDurableSchemaStateExcludingMatrixApiJournal()).toEqual(durableBefore);
            expect(await readRealtimeRedisState()).toEqual(redisBefore);
            await expectApiInputEvent(idempotencyKey, 'turns.reserved.setGeneral', null);
        }
    );

    it.each(ownershipDenialCases)(
        'keeps reserved queues, journal/outbox, ENGINE events, and profile Redis unchanged for $label general ownership denial',
        async ({ label, actorUserId, targetGeneralId }) => {
            const idempotencyKey = `${mutationRequestPrefix}owner-${label.replaceAll(' ', '-')}`;
            const accessToken = await createAccessToken(`matrix-owner-${label.replaceAll(' ', '-')}`, {}, actorUserId);
            const databaseBefore = await readReservedMutationState();
            const durableBefore = await readDurableSchemaStateExcludingMatrixApiJournal();
            const redisBefore = await readRealtimeRedisState();

            const result = await requestReservedGeneral(accessToken, idempotencyKey, targetGeneralId);

            expect(result.response.status).toBe(403);
            expect(result.body).toMatchObject({ error: { data: { code: 'FORBIDDEN' } } });
            expect(await readReservedMutationState()).toEqual(databaseBefore);
            expect(await readDurableSchemaStateExcludingMatrixApiJournal()).toEqual(durableBefore);
            expect(await readRealtimeRedisState()).toEqual(redisBefore);
            await expectApiInputEvent(idempotencyKey, 'turns.reserved.setGeneral', {
                actorUserId,
                status: 'FAILED',
            });
        }
    );

    it.each(ownershipDenialCases)(
        'keeps reserved queues, journal/outbox, ENGINE events, and profile Redis unchanged for $label nation ownership denial',
        async ({ label, actorUserId, targetGeneralId }) => {
            const idempotencyKey = `${mutationRequestPrefix}nation-owner-${label.replaceAll(' ', '-')}`;
            const accessToken = await createAccessToken(
                `matrix-nation-owner-${label.replaceAll(' ', '-')}`,
                {},
                actorUserId
            );
            const databaseBefore = await readReservedMutationState();
            const durableBefore = await readDurableSchemaStateExcludingMatrixApiJournal();
            const redisBefore = await readRealtimeRedisState();

            const result = await requestReservedNation(accessToken, idempotencyKey, targetGeneralId);

            expect(result.response.status).toBe(403);
            expect(result.body).toMatchObject({ error: { data: { code: 'FORBIDDEN' } } });
            expect(await readReservedMutationState()).toEqual(databaseBefore);
            expect(await readDurableSchemaStateExcludingMatrixApiJournal()).toEqual(durableBefore);
            expect(await readRealtimeRedisState()).toEqual(redisBefore);
            await expectApiInputEvent(idempotencyKey, 'turns.reserved.setNation', {
                actorUserId,
                status: 'FAILED',
            });
        }
    );

    it('keeps the nation queue unchanged when an owned general is below the officer threshold', async () => {
        const idempotencyKey = `${mutationRequestPrefix}nation-non-officer`;
        const accessToken = await createAccessToken('matrix-nation-non-officer', {}, ordinaryUserId);
        const databaseBefore = await readReservedMutationState();
        const durableBefore = await readDurableSchemaStateExcludingMatrixApiJournal();
        const redisBefore = await readRealtimeRedisState();

        const result = await requestReservedNation(accessToken, idempotencyKey, ordinaryGeneralId);

        expect(result.response.status).toBe(403);
        expect(result.body).toMatchObject({ error: { data: { code: 'FORBIDDEN' } } });
        expect(await readReservedMutationState()).toEqual(databaseBefore);
        expect(await readDurableSchemaStateExcludingMatrixApiJournal()).toEqual(durableBefore);
        expect(await readRealtimeRedisState()).toEqual(redisBefore);
        await expectApiInputEvent(idempotencyKey, 'turns.reserved.setNation', {
            actorUserId: ordinaryUserId,
            status: 'FAILED',
        });
    });

    it('commits an owned general reservation once with an authenticated actor and durable journal', async () => {
        const idempotencyKey = `${mutationRequestPrefix}general-success`;
        const accessToken = await createAccessToken('matrix-general-success', {});
        const databaseBefore = await readReservedMutationState();
        const durableBefore = await readDurableSchemaStateExcludingMatrixApiJournal();
        const allowedTablesBefore = await readSuccessAllowedTableState();
        const redisBefore = await readRealtimeRedisState();

        const result = await requestReservedGeneral(accessToken, idempotencyKey);

        expect(result.response.status).toBe(200);
        expect(result.body).toMatchObject({ result: { data: { ok: true, revision: 1 } } });
        expect(
            await db.generalTurn.findMany({
                where: { generalId },
                select: { generalId: true, turnIdx: true, actionCode: true, arg: true },
                orderBy: { turnIdx: 'asc' },
            })
        ).toEqual(
            Array.from({ length: 30 }, (_, turnIdx) => ({
                generalId,
                turnIdx,
                actionCode: '휴식',
                arg: {},
            }))
        );
        expect(await db.generalTurnRevision.findUnique({ where: { generalId } })).toMatchObject({
            revision: 1,
            leaseOwner: null,
            leaseExpiresAt: null,
        });
        await expectApiInputEvent(idempotencyKey, 'turns.reserved.setGeneral', {
            actorUserId: userId,
            status: 'SUCCEEDED',
        });
        expect(
            await db.inputEvent.count({
                where: { target: 'ENGINE', actorUserId: userId },
            })
        ).toBe(0);
        await expect.poll(() => db.readModelOutbox.count()).toBe(1);
        await expect
            .poll(
                async () => {
                    const row = await db.readModelOutbox.findFirst();
                    return {
                        delivered: row?.deliveredAt instanceof Date,
                        attempts: row?.attempts ?? null,
                        locked: row?.lockedAt instanceof Date,
                        lastError: row?.lastError ?? null,
                    };
                },
                { timeout: 5_000, interval: 50 }
            )
            .toEqual({ delivered: true, attempts: 1, locked: false, lastError: null });
        const readModelRedisRevisionKey = `sammo:${profileName}:read-model:revision`;
        await expect
            .poll(() => redis!.client.get(readModelRedisRevisionKey), { timeout: 5_000, interval: 50 })
            .toBe('1');
        expect(
            await db.readModelRevision.findMany({
                where: {
                    OR: [
                        { domain: 'reserved.general', entityId: generalId },
                        { domain: 'dashboard.global', entityId: 0 },
                    ],
                },
                select: { domain: true, entityId: true, revision: true },
                orderBy: [{ domain: 'asc' }, { entityId: 'asc' }],
            })
        ).toEqual([
            { domain: 'dashboard.global', entityId: 0, revision: 1n },
            { domain: 'reserved.general', entityId: generalId, revision: 1n },
        ]);
        expect(await db.readModelOutbox.findMany({ select: { payload: true } })).toEqual([
            {
                payload: {
                    version: 1,
                    changes: [
                        ['dashboard.global', 0, '1'],
                        ['reserved.general', generalId, '1'],
                    ],
                },
            },
        ]);
        const databaseAfter = await readReservedMutationState();
        expect(databaseAfter.generals).toEqual(databaseBefore.generals);
        expect(databaseAfter.generalTurns).toEqual(
            Array.from({ length: 30 }, (_, turnIdx) => ({
                generalId,
                turnIdx,
                actionCode: '휴식',
                arg: {},
            }))
        );
        expect(databaseAfter.generalTurnRevisions).toEqual([
            { generalId, revision: 1, leaseOwner: null, leaseExpiresAt: null },
        ]);
        expect(databaseAfter.nationTurns).toEqual(databaseBefore.nationTurns);
        expect(databaseAfter.nationTurnRevisions).toEqual(databaseBefore.nationTurnRevisions);
        expect(databaseAfter.messages).toEqual(databaseBefore.messages);
        expect(databaseAfter.logs).toEqual(databaseBefore.logs);
        expect(databaseAfter.engineInputEvents).toEqual(databaseBefore.engineInputEvents);
        expect(databaseAfter.webPushOutboxCount).toBe(databaseBefore.webPushOutboxCount);
        expect(databaseAfter.eventCount).toBe(databaseBefore.eventCount);
        expect(databaseAfter.auctionCount).toBe(databaseBefore.auctionCount);
        expect(databaseAfter.auctionBidCount).toBe(databaseBefore.auctionBidCount);
        expectSingleActorActivity(databaseAfter.generalAccessLogs);
        const allowedTablesAfter = await readSuccessAllowedTableState();
        expect(allowedTablesBefore.readModelOutbox).toEqual([]);
        expect(allowedTablesAfter.generalTurns.filter((row) => row.generalId !== generalId)).toEqual(
            allowedTablesBefore.generalTurns.filter((row) => row.generalId !== generalId)
        );
        const committedGeneralTurns = allowedTablesAfter.generalTurns.filter((row) => row.generalId === generalId);
        expect(
            committedGeneralTurns.map(({ generalId: rowGeneralId, turnIdx, actionCode, arg }) => ({
                generalId: rowGeneralId,
                turnIdx,
                actionCode,
                arg,
            }))
        ).toEqual(databaseAfter.generalTurns);
        expect(new Set(committedGeneralTurns.map(({ id }) => id)).size).toBe(30);
        expect(committedGeneralTurns.every(({ id, createdAt }) => id > 0 && createdAt instanceof Date)).toBe(true);
        expect(allowedTablesAfter.generalTurnRevisions.filter((row) => row.generalId !== generalId)).toEqual(
            allowedTablesBefore.generalTurnRevisions.filter((row) => row.generalId !== generalId)
        );
        expect(allowedTablesAfter.generalTurnRevisions.filter((row) => row.generalId === generalId)).toEqual([
            {
                generalId,
                revision: 1,
                leaseOwner: null,
                leaseExpiresAt: null,
                updatedAt: expect.any(Date),
            },
        ]);
        expect(allowedTablesAfter.generalAccessLogs.filter((row) => row.generalId !== generalId)).toEqual(
            allowedTablesBefore.generalAccessLogs.filter((row) => row.generalId !== generalId)
        );
        expect(allowedTablesAfter.generalAccessLogs.filter((row) => row.generalId === generalId)).toEqual([
            {
                id: expect.any(Number),
                generalId,
                userId,
                lastRefresh: null,
                lastActionAt: expect.any(Date),
                refresh: 0,
                refreshTotal: 0,
                refreshScore: 0,
                refreshScoreTotal: 0,
            },
        ]);
        const expectedReadModelKeys = new Set([`dashboard.global:0`, `reserved.general:${generalId}`]);
        expect(
            allowedTablesAfter.readModelRevisions.filter(
                ({ domain, entityId }) => !expectedReadModelKeys.has(`${domain}:${entityId}`)
            )
        ).toEqual(
            allowedTablesBefore.readModelRevisions.filter(
                ({ domain, entityId }) => !expectedReadModelKeys.has(`${domain}:${entityId}`)
            )
        );
        expect(
            allowedTablesAfter.readModelRevisions.filter(({ domain, entityId }) =>
                expectedReadModelKeys.has(`${domain}:${entityId}`)
            )
        ).toEqual([
            { domain: 'dashboard.global', entityId: 0, revision: 1n, updatedAt: expect.any(Date) },
            { domain: 'reserved.general', entityId: generalId, revision: 1n, updatedAt: expect.any(Date) },
        ]);
        expect(allowedTablesAfter.readModelOutbox).toEqual([
            {
                id: expect.anything(),
                payload: {
                    version: 1,
                    changes: [
                        ['dashboard.global', 0, '1'],
                        ['reserved.general', generalId, '1'],
                    ],
                },
                attempts: 1,
                availableAt: expect.any(Date),
                lockedAt: null,
                lockOwner: null,
                deliveredAt: expect.any(Date),
                lastError: null,
                createdAt: expect.any(Date),
            },
        ]);
        const deliveredOutbox = allowedTablesAfter.readModelOutbox[0];
        if (!deliveredOutbox?.deliveredAt) throw new Error('read-model outbox was not delivered');
        expect(typeof deliveredOutbox.id).toBe('bigint');
        expect(deliveredOutbox.id).toBeGreaterThan(0n);
        expect(deliveredOutbox.deliveredAt.getTime()).toBeGreaterThanOrEqual(deliveredOutbox.createdAt.getTime());
        expect(
            withoutDurableTables(await readDurableSchemaStateExcludingMatrixApiJournal(), [
                'general_turn',
                'general_turn_revision',
                'general_access_log',
                'read_model_revision',
                'read_model_outbox',
            ])
        ).toEqual(
            withoutDurableTables(durableBefore, [
                'general_turn',
                'general_turn_revision',
                'general_access_log',
                'read_model_revision',
                'read_model_outbox',
            ])
        );
        expect(redisBefore.some(([key]) => key === readModelRedisRevisionKey)).toBe(false);
        const expectedRedisAfter: Array<[string, string | null]> = [...redisBefore, [readModelRedisRevisionKey, '1']];
        expectedRedisAfter.sort(([left], [right]) => left.localeCompare(right));
        expect(await readRealtimeRedisState()).toEqual(expectedRedisAfter);
    }, 15_000);

    it('accepts the minimum officer level into its own nation queue partition over HTTP', async () => {
        const idempotencyKey = `${mutationRequestPrefix}nation-minimum-officer-success`;
        const accessToken = await createAccessToken('matrix-nation-minimum-officer-success', {}, sameNationUserId);
        const databaseBefore = await readReservedMutationState();
        const durableBefore = await readDurableSchemaStateExcludingMatrixApiJournal();
        const allowedTablesBefore = await readSuccessAllowedTableState();
        const redisBefore = await readRealtimeRedisState();

        const result = await requestReservedNation(accessToken, idempotencyKey, sameNationGeneralId);

        expect(result.response.status).toBe(200);
        expect(result.body).toMatchObject({ result: { data: { ok: true, revision: 1 } } });
        const expectedTurns = Array.from({ length: 12 }, (_, turnIdx) => ({
            nationId: ownerNationId,
            officerLevel: 5,
            turnIdx,
            actionCode: '휴식',
            arg: {},
        }));
        expect(
            await db.nationTurn.findMany({
                where: { nationId: ownerNationId, officerLevel: 5 },
                select: { nationId: true, officerLevel: true, turnIdx: true, actionCode: true, arg: true },
                orderBy: { turnIdx: 'asc' },
            })
        ).toEqual(expectedTurns);
        expect(
            await db.nationTurnRevision.findUnique({
                where: { nationId_officerLevel: { nationId: ownerNationId, officerLevel: 5 } },
            })
        ).toMatchObject({ revision: 1, leaseOwner: null, leaseExpiresAt: null });
        await expectApiInputEvent(idempotencyKey, 'turns.reserved.setNation', {
            actorUserId: sameNationUserId,
            status: 'SUCCEEDED',
        });

        const committed = await readReservedMutationState();
        expect(committed.generals).toEqual(databaseBefore.generals);
        expect(committed.generalTurns).toEqual(databaseBefore.generalTurns);
        expect(committed.generalTurnRevisions).toEqual(databaseBefore.generalTurnRevisions);
        expect(committed.nationTurns).toEqual(expectedTurns);
        expect(committed.nationTurnRevisions).toEqual([
            {
                nationId: ownerNationId,
                officerLevel: 5,
                revision: 1,
                leaseOwner: null,
                leaseExpiresAt: null,
            },
        ]);
        expect(committed.generalAccessLogs).toEqual([
            {
                generalId: sameNationGeneralId,
                userId: sameNationUserId,
                lastRefresh: null,
                refresh: 0,
                refreshTotal: 0,
                refreshScore: 0,
                refreshScoreTotal: 0,
                lastActionAt: expect.any(Date),
            },
        ]);
        expect(committed.readModelRevisions).toEqual(databaseBefore.readModelRevisions);
        expect(committed.readModelOutbox).toEqual(databaseBefore.readModelOutbox);
        expect(committed.messages).toEqual(databaseBefore.messages);
        expect(committed.logs).toEqual(databaseBefore.logs);
        expect(committed.engineInputEvents).toEqual(databaseBefore.engineInputEvents);
        expect(committed.webPushOutboxCount).toBe(databaseBefore.webPushOutboxCount);
        expect(committed.eventCount).toBe(databaseBefore.eventCount);
        expect(committed.auctionCount).toBe(databaseBefore.auctionCount);
        expect(committed.auctionBidCount).toBe(databaseBefore.auctionBidCount);

        const allowedTablesAfter = await readSuccessAllowedTableState();
        expect(
            allowedTablesAfter.nationTurns.filter((row) => row.nationId !== ownerNationId || row.officerLevel !== 5)
        ).toEqual(
            allowedTablesBefore.nationTurns.filter((row) => row.nationId !== ownerNationId || row.officerLevel !== 5)
        );
        const committedNationTurns = allowedTablesAfter.nationTurns.filter(
            (row) => row.nationId === ownerNationId && row.officerLevel === 5
        );
        expect(
            committedNationTurns.map(({ nationId, officerLevel, turnIdx, actionCode, arg }) => ({
                nationId,
                officerLevel,
                turnIdx,
                actionCode,
                arg,
            }))
        ).toEqual(expectedTurns);
        expect(new Set(committedNationTurns.map(({ id }) => id)).size).toBe(12);
        expect(committedNationTurns.every(({ id, createdAt }) => id > 0 && createdAt instanceof Date)).toBe(true);
        expect(
            allowedTablesAfter.nationTurnRevisions.filter(
                (row) => row.nationId !== ownerNationId || row.officerLevel !== 5
            )
        ).toEqual(
            allowedTablesBefore.nationTurnRevisions.filter(
                (row) => row.nationId !== ownerNationId || row.officerLevel !== 5
            )
        );
        expect(
            allowedTablesAfter.nationTurnRevisions.filter(
                (row) => row.nationId === ownerNationId && row.officerLevel === 5
            )
        ).toEqual([
            {
                nationId: ownerNationId,
                officerLevel: 5,
                revision: 1,
                leaseOwner: null,
                leaseExpiresAt: null,
                updatedAt: expect.any(Date),
            },
        ]);
        expect(allowedTablesAfter.generalAccessLogs.filter((row) => row.generalId !== sameNationGeneralId)).toEqual(
            allowedTablesBefore.generalAccessLogs.filter((row) => row.generalId !== sameNationGeneralId)
        );
        expect(allowedTablesAfter.generalAccessLogs.filter((row) => row.generalId === sameNationGeneralId)).toEqual([
            {
                id: expect.any(Number),
                generalId: sameNationGeneralId,
                userId: sameNationUserId,
                lastRefresh: null,
                lastActionAt: expect.any(Date),
                refresh: 0,
                refreshTotal: 0,
                refreshScore: 0,
                refreshScoreTotal: 0,
            },
        ]);
        expect(
            withoutDurableTables(await readDurableSchemaStateExcludingMatrixApiJournal(), [
                'nation_turn',
                'nation_turn_revision',
                'general_access_log',
            ])
        ).toEqual(withoutDurableTables(durableBefore, ['nation_turn', 'nation_turn_revision', 'general_access_log']));
        expect(await readRealtimeRedisState()).toEqual(redisBefore);
    }, 15_000);

    it('commits an owned officer nation reservation and rejects duplicate idempotency replay without a second queue mutation', async () => {
        const idempotencyKey = `${mutationRequestPrefix}nation-success`;
        const accessToken = await createAccessToken('matrix-nation-success', {});
        const databaseBefore = await readReservedMutationState();
        const durableBefore = await readDurableSchemaStateExcludingMatrixApiJournal();
        const allowedTablesBefore = await readSuccessAllowedTableState();
        const redisBefore = await readRealtimeRedisState();

        const first = await requestReservedNation(accessToken, idempotencyKey, generalId);
        expect(first.response.status).toBe(200);
        expect(first.body).toMatchObject({ result: { data: { ok: true, revision: 1 } } });
        expect(
            await db.nationTurn.findMany({
                where: { nationId: ownerNationId, officerLevel: 12 },
                select: { nationId: true, officerLevel: true, turnIdx: true, actionCode: true, arg: true },
                orderBy: { turnIdx: 'asc' },
            })
        ).toEqual(
            Array.from({ length: 12 }, (_, turnIdx) => ({
                nationId: ownerNationId,
                officerLevel: 12,
                turnIdx,
                actionCode: '휴식',
                arg: {},
            }))
        );
        expect(
            await db.nationTurnRevision.findUnique({
                where: { nationId_officerLevel: { nationId: ownerNationId, officerLevel: 12 } },
            })
        ).toMatchObject({ revision: 1, leaseOwner: null, leaseExpiresAt: null });
        await expectApiInputEvent(idempotencyKey, 'turns.reserved.setNation', {
            actorUserId: userId,
            status: 'SUCCEEDED',
        });

        const committed = await readReservedMutationState();
        expect(committed.generals).toEqual(databaseBefore.generals);
        expect(committed.generalTurns).toEqual(databaseBefore.generalTurns);
        expect(committed.generalTurnRevisions).toEqual(databaseBefore.generalTurnRevisions);
        expect(committed.nationTurns).toEqual(
            Array.from({ length: 12 }, (_, turnIdx) => ({
                nationId: ownerNationId,
                officerLevel: 12,
                turnIdx,
                actionCode: '휴식',
                arg: {},
            }))
        );
        expect(committed.nationTurnRevisions).toEqual([
            {
                nationId: ownerNationId,
                officerLevel: 12,
                revision: 1,
                leaseOwner: null,
                leaseExpiresAt: null,
            },
        ]);
        expect(committed.readModelRevisions).toEqual(databaseBefore.readModelRevisions);
        expect(committed.readModelOutbox).toEqual(databaseBefore.readModelOutbox);
        expect(committed.messages).toEqual(databaseBefore.messages);
        expect(committed.logs).toEqual(databaseBefore.logs);
        expect(committed.engineInputEvents).toEqual(databaseBefore.engineInputEvents);
        expect(committed.webPushOutboxCount).toBe(databaseBefore.webPushOutboxCount);
        expect(committed.eventCount).toBe(databaseBefore.eventCount);
        expect(committed.auctionCount).toBe(databaseBefore.auctionCount);
        expect(committed.auctionBidCount).toBe(databaseBefore.auctionBidCount);
        expectSingleActorActivity(committed.generalAccessLogs);
        const allowedTablesAfter = await readSuccessAllowedTableState();
        expect(
            allowedTablesAfter.nationTurns.filter((row) => row.nationId !== ownerNationId || row.officerLevel !== 12)
        ).toEqual(
            allowedTablesBefore.nationTurns.filter((row) => row.nationId !== ownerNationId || row.officerLevel !== 12)
        );
        const committedNationTurns = allowedTablesAfter.nationTurns.filter(
            (row) => row.nationId === ownerNationId && row.officerLevel === 12
        );
        expect(
            committedNationTurns.map(({ nationId, officerLevel, turnIdx, actionCode, arg }) => ({
                nationId,
                officerLevel,
                turnIdx,
                actionCode,
                arg,
            }))
        ).toEqual(committed.nationTurns);
        expect(new Set(committedNationTurns.map(({ id }) => id)).size).toBe(12);
        expect(committedNationTurns.every(({ id, createdAt }) => id > 0 && createdAt instanceof Date)).toBe(true);
        expect(
            allowedTablesAfter.nationTurnRevisions.filter(
                (row) => row.nationId !== ownerNationId || row.officerLevel !== 12
            )
        ).toEqual(
            allowedTablesBefore.nationTurnRevisions.filter(
                (row) => row.nationId !== ownerNationId || row.officerLevel !== 12
            )
        );
        expect(
            allowedTablesAfter.nationTurnRevisions.filter(
                (row) => row.nationId === ownerNationId && row.officerLevel === 12
            )
        ).toEqual([
            {
                nationId: ownerNationId,
                officerLevel: 12,
                revision: 1,
                leaseOwner: null,
                leaseExpiresAt: null,
                updatedAt: expect.any(Date),
            },
        ]);
        expect(allowedTablesAfter.generalAccessLogs.filter((row) => row.generalId !== generalId)).toEqual(
            allowedTablesBefore.generalAccessLogs.filter((row) => row.generalId !== generalId)
        );
        expect(allowedTablesAfter.generalAccessLogs.filter((row) => row.generalId === generalId)).toEqual([
            {
                id: expect.any(Number),
                generalId,
                userId,
                lastRefresh: null,
                lastActionAt: expect.any(Date),
                refresh: 0,
                refreshTotal: 0,
                refreshScore: 0,
                refreshScoreTotal: 0,
            },
        ]);
        expect(
            withoutDurableTables(await readDurableSchemaStateExcludingMatrixApiJournal(), [
                'nation_turn',
                'nation_turn_revision',
                'general_access_log',
            ])
        ).toEqual(withoutDurableTables(durableBefore, ['nation_turn', 'nation_turn_revision', 'general_access_log']));
        expect(await readRealtimeRedisState()).toEqual(redisBefore);
        const replayDurableBefore = await readDurableSchemaStateExcludingMatrixApiJournal();
        const replayRedisBefore = await readRealtimeRedisState();
        const replayRequestId = resolveScopedApiRequestId(idempotencyKey, 'turns.reserved.setNation', userId);
        const replayJournalBefore = await db.inputEvent.findUniqueOrThrow({
            where: { requestId: replayRequestId },
        });
        const replay = await requestReservedNation(accessToken, idempotencyKey, generalId);
        expect(replay.response.status).toBe(409);
        expect(replay.body).toMatchObject({ error: { data: { code: 'CONFLICT' } } });
        expect(await readReservedMutationState()).toEqual(committed);
        expect(await readDurableSchemaStateExcludingMatrixApiJournal()).toEqual(replayDurableBefore);
        expect(await readRealtimeRedisState()).toEqual(replayRedisBefore);
        expect(
            await db.inputEvent.findUniqueOrThrow({
                where: { requestId: replayRequestId },
            })
        ).toEqual(replayJournalBefore);
        expect(await db.inputEvent.count({ where: { requestId: replayRequestId } })).toBe(1);
        await expectApiInputEvent(idempotencyKey, 'turns.reserved.setNation', {
            actorUserId: userId,
            status: 'SUCCEEDED',
        });
    });

    it('delivers a non-UTC-session Web Push outbox row once with its original instant', async () => {
        const eventId = `security-http-web-push-${process.pid}`;
        const beforeInsert = Date.now();
        await db.$transaction(async (transaction) => {
            await transaction.$executeRaw`SET LOCAL TIME ZONE 'Asia/Seoul'`;
            await expect(
                enqueueWebPushOutboxEvents(transaction, [
                    {
                        eventId,
                        eventType: 'PRIVATE_MESSAGE_RECEIVED',
                        userIds: [userId],
                    },
                ])
            ).resolves.toBe(1);
        });
        const afterInsert = Date.now();

        await expect.poll(() => receivedGatewayWebPushEvents.length, { timeout: 6_000, interval: 50 }).toBe(1);
        await expect
            .poll(
                async () => {
                    const row = await db.webPushOutbox.findUniqueOrThrow({ where: { eventId } });
                    return {
                        attempts: row.attempts,
                        locked: row.lockedAt instanceof Date,
                        lockOwner: row.lockOwner,
                        delivered: row.deliveredAt instanceof Date,
                        lastError: row.lastError,
                    };
                },
                { timeout: 6_000, interval: 50 }
            )
            .toEqual({ attempts: 1, locked: false, lockOwner: null, delivered: true, lastError: null });
        const delivered = await db.webPushOutbox.findUniqueOrThrow({ where: { eventId } });
        expect(delivered).toMatchObject({
            attempts: 1,
            lockedAt: null,
            lockOwner: null,
            deliveredAt: expect.any(Date),
            lastError: null,
        });
        const [storedInstant] = await db.$queryRaw<Array<{ createdMs: number }>>`
            SELECT (EXTRACT(EPOCH FROM "created_at") * 1000)::double precision AS "createdMs"
            FROM "web_push_outbox"
            WHERE "event_id" = ${eventId}
        `;
        if (!storedInstant) throw new Error('web push outbox instant was not persisted');

        const [received] = receivedGatewayWebPushEvents;
        expect(received?.internalToken).toMatch(/^[a-f0-9]{64}$/u);
        expect(received?.body).toEqual({
            version: 1,
            eventId: `game:${profileName}:${eventId}`,
            eventType: 'PRIVATE_MESSAGE_RECEIVED',
            profileName,
            userIds: [userId],
            occurredAt: expect.any(String),
        });
        const occurredAt = Date.parse((received?.body as { occurredAt: string }).occurredAt);
        expect(occurredAt).toBeGreaterThanOrEqual(beforeInsert - 1_000);
        expect(occurredAt).toBeLessThanOrEqual(afterInsert + 1_000);
        expect(Math.abs(occurredAt - storedInstant.createdMs)).toBeLessThanOrEqual(1);
    }, 10_000);

    it('keeps Web Push due, lease, and prune boundaries in UTC wall time under a KST database session', async () => {
        const eventIds = {
            future: `security-http-web-push-future-${process.pid}`,
            recentLock: `security-http-web-push-recent-lock-${process.pid}`,
            staleLock: `security-http-web-push-stale-lock-${process.pid}`,
            retainedDelivery: `security-http-web-push-retained-delivery-${process.pid}`,
            prunedDelivery: `security-http-web-push-pruned-delivery-${process.pid}`,
        } as const;
        const [databaseSession] = await db.$queryRaw<Array<{ timeZone: string }>>`
            SELECT current_setting('TIMEZONE') AS "timeZone"
        `;
        expect(databaseSession?.timeZone).toBe('Asia/Seoul');

        await db.$transaction(async (transaction) => {
            await transaction.$executeRaw`SET LOCAL TIME ZONE 'Asia/Seoul'`;
            const [transactionSession] = await transaction.$queryRaw<Array<{ timeZone: string }>>`
                SELECT current_setting('TIMEZONE') AS "timeZone"
            `;
            expect(transactionSession?.timeZone).toBe('Asia/Seoul');
            await transaction.$executeRaw`
                INSERT INTO "web_push_outbox" (
                    "event_id",
                    "event_type",
                    "user_ids",
                    "attempts",
                    "available_at",
                    "locked_at",
                    "lock_owner",
                    "delivered_at",
                    "created_at"
                )
                VALUES
                    (
                        ${eventIds.future},
                        'PRIVATE_MESSAGE_RECEIVED',
                        ARRAY[${userId}]::text[],
                        0,
                        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '2 hours',
                        NULL,
                        NULL,
                        NULL,
                        CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
                    ),
                    (
                        ${eventIds.recentLock},
                        'PRIVATE_MESSAGE_RECEIVED',
                        ARRAY[${userId}]::text[],
                        4,
                        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 minute',
                        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 second',
                        'previous-owner',
                        NULL,
                        CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
                    ),
                    (
                        ${eventIds.staleLock},
                        'PRIVATE_MESSAGE_RECEIVED',
                        ARRAY[${userId}]::text[],
                        2,
                        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 minute',
                        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '31 seconds',
                        'previous-owner',
                        NULL,
                        CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
                    ),
                    (
                        ${eventIds.retainedDelivery},
                        'PRIVATE_MESSAGE_RECEIVED',
                        ARRAY[${userId}]::text[],
                        1,
                        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '20 hours',
                        NULL,
                        NULL,
                        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '20 hours',
                        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '21 hours'
                    ),
                    (
                        ${eventIds.prunedDelivery},
                        'PRIVATE_MESSAGE_RECEIVED',
                        ARRAY[${userId}]::text[],
                        1,
                        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '25 hours',
                        NULL,
                        NULL,
                        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '25 hours',
                        (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '26 hours'
                    )
            `;
        });

        const boundaryWorker = new WebPushOutboxWorker(db, process.env.GATEWAY_INTERNAL_API_URL!, secret, profileName, {
            intervalMs: 60_000,
        });
        boundaryWorker.start();
        await boundaryWorker.stop();

        await expect
            .poll(
                async () => {
                    const staleLock = await db.webPushOutbox.findUnique({
                        where: { eventId: eventIds.staleLock },
                    });
                    return staleLock
                        ? {
                              attempts: staleLock.attempts,
                              lockedAt: staleLock.lockedAt,
                              lockOwner: staleLock.lockOwner,
                              delivered: staleLock.deliveredAt instanceof Date,
                              lastError: staleLock.lastError,
                          }
                        : null;
                },
                { timeout: 6_000, interval: 50 }
            )
            .toEqual({ attempts: 3, lockedAt: null, lockOwner: null, delivered: true, lastError: null });
        await expect
            .poll(
                async () =>
                    db.webPushOutbox.count({
                        where: { eventId: eventIds.prunedDelivery },
                    }),
                { timeout: 6_000, interval: 50 }
            )
            .toBe(0);

        const remaining = await db.webPushOutbox.findMany({
            where: { eventId: { in: Object.values(eventIds) } },
            orderBy: { eventId: 'asc' },
        });
        const byEventId = new Map(remaining.map((row) => [row.eventId, row]));
        expect(byEventId.get(eventIds.future)).toMatchObject({
            attempts: 0,
            lockedAt: null,
            lockOwner: null,
            deliveredAt: null,
            lastError: null,
        });
        expect(byEventId.get(eventIds.recentLock)).toMatchObject({
            attempts: 4,
            lockedAt: expect.any(Date),
            lockOwner: 'previous-owner',
            deliveredAt: null,
            lastError: null,
        });
        expect(byEventId.get(eventIds.retainedDelivery)).toMatchObject({
            attempts: 1,
            lockedAt: null,
            lockOwner: null,
            deliveredAt: expect.any(Date),
            lastError: null,
        });
        expect(byEventId.has(eventIds.prunedDelivery)).toBe(false);
        expect(receivedGatewayWebPushEvents).toHaveLength(1);
        expect(receivedGatewayWebPushEvents[0]?.body).toMatchObject({
            eventId: `game:${profileName}:${eventIds.staleLock}`,
        });
    }, 10_000);

    // Flush invalidates every token issued before the user watermark. Keep it
    // last so this lifecycle assertion cannot invalidate the actor tokens used
    // by the transport authorization matrix above.
    it('invalidates an existing access token after a gateway flush event', async () => {
        const accessToken = await createAccessToken('flush', {});
        expect((await requestTrpc('general.me', { accessToken })).response.status).toBe(200);

        await redis!.client.publish(
            `${redisPrefix}:flush`,
            JSON.stringify({
                userId,
                flushedAt: new Date().toISOString(),
                reason: 'security-http-e2e',
            })
        );

        const deadline = Date.now() + 5_000;
        let response = await requestTrpc('general.me', { accessToken });
        while (response.response.status !== 401 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            response = await requestTrpc('general.me', { accessToken });
        }
        expect(response.response.status).toBe(401);
        expect(response.body).toMatchObject({
            error: {
                data: {
                    code: 'UNAUTHORIZED',
                },
            },
        });
    });
});
