import { createHash } from 'node:crypto';
import { projectCurrentGeneral } from '../src/router/playAudit/projection.js';
import { asRecord } from '@sammo-ts/common';
import fs from 'node:fs/promises';
import { createServer, type Server as HttpServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { encryptGameSessionToken, type GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import {
    createGamePostgresConnector,
    GamePrisma,
    hashAuditDiplomacyDocument,
    createRedisConnector,
    enqueueWebPushOutboxEvents,
    resolveRedisConfigFromEnv,
    type GamePrismaClient,
    type RedisConnector,
} from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { createApiInputPayloadIdentity } from '../src/inputEventBoundary.js';
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
    'turns.reserved.setNationBulk',
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
let reservationWorldId = fixtureWorldId;
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
                { domain: 'general.content', entityId: { in: fixtureGeneralIds } },
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
    expected: {
        actorUserId: string;
        status: 'FAILED' | 'SUCCEEDED';
        payload?: unknown;
        result?: unknown;
    } | null
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
            payload:
                expected.payload === undefined
                    ? {
                          version: 1,
                          digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
                      }
                    : createApiInputPayloadIdentity(expected.payload),
            actorUserId: expected.actorUserId,
            status: expected.status,
            result: expected.status === 'SUCCEEDED' ? (expected.result ?? expect.objectContaining({ ok: true })) : null,
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

const requestReservedNation = (
    accessToken: string,
    idempotencyKey: string,
    targetGeneralId: number,
    command: { action: string; args: unknown } = { action: '휴식', args: {} }
) =>
    requestTrpc('turns.reserved.setNation', {
        method: 'POST',
        input: {
            generalId: targetGeneralId,
            turnIndex: 0,
            action: command.action,
            args: command.args,
            expectedRevision: 0,
        },
        accessToken,
        idempotencyKey,
    });

const requestReservedNationBulk = (
    accessToken: string,
    idempotencyKey: string,
    targetGeneralId: number,
    command: { action: string; args: unknown } = { action: '휴식', args: {} }
) =>
    requestTrpc('turns.reserved.setNationBulk', {
        method: 'POST',
        input: {
            generalId: targetGeneralId,
            entries: [{ turnList: [0, 1], action: command.action, args: command.args }],
            expectedRevision: 0,
        },
        accessToken,
        idempotencyKey,
    });

type NationReservationKind = 'single' | 'bulk';

const nationReservationProcedure = (kind: NationReservationKind) =>
    kind === 'single' ? 'turns.reserved.setNation' : 'turns.reserved.setNationBulk';

const requestNationReservation = (
    kind: NationReservationKind,
    accessToken: string,
    idempotencyKey: string,
    targetGeneralId = generalId,
    command: { action: string; args: unknown } = { action: '휴식', args: {} }
) =>
    kind === 'single'
        ? requestReservedNation(accessToken, idempotencyKey, targetGeneralId, command)
        : requestReservedNationBulk(accessToken, idempotencyKey, targetGeneralId, command);

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
        const existingWorlds = await db.worldState.findMany({
            select: { id: true, scenarioCode: true },
            orderBy: { id: 'asc' },
        });
        if (existingWorlds.length === 0) {
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
        } else if (
            existingWorlds.length === 1 &&
            existingWorlds[0]?.id === fixtureWorldId &&
            existingWorlds[0].scenarioCode === 'security-http'
        ) {
            // A previously interrupted run may leave our own fixture row. It
            // remains owned by this suite and is removed during teardown.
            createdFixtureWorld = true;
        } else {
            throw new Error(
                `security transport fixture requires an empty schema or its owned world row, got ${JSON.stringify(existingWorlds)}`
            );
        }
        const reservationWorlds = await db.worldState.findMany({ select: { id: true } });
        if (reservationWorlds.length !== 1 || reservationWorlds[0]?.id !== fixtureWorldId) {
            throw new Error(
                `security transport fixture requires world ${fixtureWorldId}, got ${JSON.stringify(reservationWorlds)}`
            );
        }
        reservationWorldId = reservationWorlds[0].id;
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
                    { domain: 'general.content', entityId: { in: fixtureGeneralIds } },
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
        await db.general.update({
            where: { id: generalId },
            data: { npcState: 0, meta: {}, penalty: {} },
        });
        await db.worldState.update({
            where: { id: reservationWorldId },
            data: { meta: {} },
        });
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
                    { domain: 'general.content', entityId: { in: fixtureGeneralIds } },
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

    it.each(
        (['single', 'bulk'] as const).flatMap((kind) =>
            [
                { label: 'zero', value: 0 },
                { label: 'false', value: false },
                { label: 'null', value: null },
            ].map((penalty) => ({ kind, ...penalty }))
        )
    )(
        'rejects $kind nation reservation when noChiefTurnInput is $label without committing queue or journal',
        async ({ kind, label, value }) => {
            const procedure = nationReservationProcedure(kind);
            const idempotencyKey = `${mutationRequestPrefix}nation-penalty-${kind}-${label}`;
            const accessToken = await createAccessToken(`matrix-nation-penalty-${kind}-${label}`, {});
            await db.general.update({
                where: { id: generalId },
                data: {
                    meta: { killturn: 3, marker: 'penalty-preserved' },
                    penalty: { noChiefTurnInput: value },
                },
            });
            await db.worldState.update({
                where: { id: reservationWorldId },
                data: { meta: { killturn: 12 } },
            });

            const result = await requestNationReservation(kind, accessToken, idempotencyKey, generalId, {
                action: 'che_포상',
                args: {},
            });

            expect(result.response.status).toBe(412);
            expect(result.body).toMatchObject({
                error: {
                    message: '수뇌 턴 입력 불가능',
                    data: { code: 'PRECONDITION_FAILED' },
                },
            });
            expect(await db.nationTurn.count({ where: { nationId: ownerNationId, officerLevel: 12 } })).toBe(0);
            expect(
                await db.nationTurnRevision.findUnique({
                    where: { nationId_officerLevel: { nationId: ownerNationId, officerLevel: 12 } },
                })
            ).toBeNull();
            expect(await db.general.findUniqueOrThrow({ where: { id: generalId } })).toMatchObject({
                meta: { killturn: 3, marker: 'penalty-preserved' },
                penalty: { noChiefTurnInput: value },
            });
            expect(await db.readModelRevision.count()).toBe(0);
            expect(await db.readModelOutbox.count()).toBe(0);
            await expectApiInputEvent(idempotencyKey, procedure, {
                actorUserId: userId,
                status: 'FAILED',
            });
        }
    );

    it.each([
        { kind: 'single' as const, label: 'single' },
        { kind: 'bulk' as const, label: 'bulk' },
    ])('commits $label nation queue, JSONB killturn refill, and read-model journal together', async ({ kind }) => {
        const procedure = nationReservationProcedure(kind);
        const idempotencyKey = `${mutationRequestPrefix}nation-refill-${kind}`;
        const accessToken = await createAccessToken(`matrix-nation-refill-${kind}`, {});
        await db.general.update({
            where: { id: generalId },
            data: {
                npcState: 0,
                meta: { killturn: 3, marker: 'preserved-by-jsonb-set' },
                penalty: {},
            },
        });
        await db.worldState.update({
            where: { id: reservationWorldId },
            data: { meta: { killturn: 12, marker: 'world-preserved' } },
        });

        const result = await requestNationReservation(kind, accessToken, idempotencyKey);

        expect(result.response.status).toBe(200);
        expect(result.body).toMatchObject({ result: { data: { ok: true, revision: 1 } } });
        expect(
            await db.nationTurn.findMany({
                where: { nationId: ownerNationId, officerLevel: 12 },
                select: { turnIdx: true, actionCode: true, arg: true },
                orderBy: { turnIdx: 'asc' },
            })
        ).toEqual(
            Array.from({ length: 12 }, (_, turnIdx) => ({
                turnIdx,
                actionCode: '휴식',
                arg: {},
            }))
        );
        expect(
            await db.nationTurnRevision.findUniqueOrThrow({
                where: { nationId_officerLevel: { nationId: ownerNationId, officerLevel: 12 } },
            })
        ).toMatchObject({ revision: 1, leaseOwner: null, leaseExpiresAt: null });
        expect(await db.general.findUniqueOrThrow({ where: { id: generalId } })).toMatchObject({
            npcState: 0,
            meta: { killturn: 12, marker: 'preserved-by-jsonb-set' },
        });
        expect(await db.worldState.findUniqueOrThrow({ where: { id: reservationWorldId } })).toMatchObject({
            meta: { killturn: 12, marker: 'world-preserved' },
        });
        expect(
            await db.readModelRevision.findMany({
                select: { domain: true, entityId: true, revision: true },
                orderBy: [{ domain: 'asc' }, { entityId: 'asc' }],
            })
        ).toEqual([
            { domain: 'dashboard.global', entityId: 0, revision: 1n },
            { domain: 'general.content', entityId: generalId, revision: 1n },
        ]);
        expect(await db.readModelOutbox.findMany({ select: { payload: true } })).toEqual([
            {
                payload: {
                    version: 1,
                    changes: [
                        ['dashboard.global', 0, '1'],
                        ['general.content', generalId, '1'],
                    ],
                },
            },
        ]);
        await expectApiInputEvent(idempotencyKey, procedure, {
            actorUserId: userId,
            status: 'SUCCEEDED',
        });
    });

    it.each([
        {
            kind: 'single' as const,
            label: 'already-higher user killturn',
            npcState: 0,
            currentKillturn: 20,
        },
        {
            kind: 'bulk' as const,
            label: 'NPC actor',
            npcState: 2,
            currentKillturn: 3,
        },
    ])('keeps $label unchanged while committing its nation queue', async ({ kind, npcState, currentKillturn }) => {
        const procedure = nationReservationProcedure(kind);
        const idempotencyKey = `${mutationRequestPrefix}nation-refill-noop-${kind}`;
        const accessToken = await createAccessToken(`matrix-nation-refill-noop-${kind}`, {});
        await db.general.update({
            where: { id: generalId },
            data: {
                npcState,
                meta: { killturn: currentKillturn, marker: 'no-op-preserved' },
                penalty: {},
            },
        });
        await db.worldState.update({
            where: { id: reservationWorldId },
            data: { meta: { killturn: 12 } },
        });

        const result = await requestNationReservation(kind, accessToken, idempotencyKey);

        expect(result.response.status).toBe(200);
        expect(result.body).toMatchObject({ result: { data: { ok: true, revision: 1 } } });
        expect(await db.nationTurn.count({ where: { nationId: ownerNationId, officerLevel: 12 } })).toBe(12);
        expect(await db.general.findUniqueOrThrow({ where: { id: generalId } })).toMatchObject({
            npcState,
            meta: { killturn: currentKillturn, marker: 'no-op-preserved' },
        });
        expect(await db.readModelRevision.count()).toBe(0);
        expect(await db.readModelOutbox.count()).toBe(0);
        await expectApiInputEvent(idempotencyKey, procedure, {
            actorUserId: userId,
            status: 'SUCCEEDED',
        });
    });

    it.each([
        { kind: 'single' as const, label: 'single' },
        { kind: 'bulk' as const, label: 'bulk' },
    ])(
        'rolls back $label queue, killturn, and read-model revisions when journal persistence fails',
        async ({ kind }) => {
            const procedure = nationReservationProcedure(kind);
            const idempotencyKey = `${mutationRequestPrefix}nation-refill-rollback-${kind}`;
            const accessToken = await createAccessToken(`matrix-nation-refill-rollback-${kind}`, {});
            await db.general.update({
                where: { id: generalId },
                data: {
                    npcState: 0,
                    meta: { killturn: 3, marker: 'rollback-preserved' },
                    penalty: {},
                },
            });
            await db.worldState.update({
                where: { id: reservationWorldId },
                data: { meta: { killturn: 12 } },
            });
            await db.$executeRawUnsafe(`
                CREATE FUNCTION security_transport_fail_read_model_outbox()
                RETURNS trigger
                LANGUAGE plpgsql
                AS $$
                BEGIN
                    RAISE EXCEPTION 'forced security transport read-model journal failure';
                END;
                $$
            `);
            await db.$executeRawUnsafe(`
                CREATE TRIGGER security_transport_fail_read_model_outbox
                BEFORE INSERT ON read_model_outbox
                FOR EACH ROW
                EXECUTE FUNCTION security_transport_fail_read_model_outbox()
            `);

            const result = await (async () => {
                try {
                    return await requestNationReservation(kind, accessToken, idempotencyKey);
                } finally {
                    await db.$executeRawUnsafe(
                        'DROP TRIGGER IF EXISTS security_transport_fail_read_model_outbox ON read_model_outbox'
                    );
                    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS security_transport_fail_read_model_outbox()');
                }
            })();

            expect(result.response.status).toBe(500);
            expect(result.body).toMatchObject({ error: { data: { code: 'INTERNAL_SERVER_ERROR' } } });
            expect(await db.nationTurn.count({ where: { nationId: ownerNationId, officerLevel: 12 } })).toBe(0);
            expect(
                await db.nationTurnRevision.findUnique({
                    where: { nationId_officerLevel: { nationId: ownerNationId, officerLevel: 12 } },
                })
            ).toBeNull();
            expect(await db.general.findUniqueOrThrow({ where: { id: generalId } })).toMatchObject({
                npcState: 0,
                meta: { killturn: 3, marker: 'rollback-preserved' },
            });
            expect(await db.readModelRevision.count()).toBe(0);
            expect(await db.readModelOutbox.count()).toBe(0);
            await expectApiInputEvent(idempotencyKey, procedure, {
                actorUserId: userId,
                status: 'FAILED',
            });
            expect(
                await db.inputEvent.findUniqueOrThrow({
                    where: { requestId: resolveScopedApiRequestId(idempotencyKey, procedure, userId) },
                    select: { error: true },
                })
            ).toEqual({ error: expect.stringContaining('forced security transport read-model journal failure') });
        }
    );

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

    it('commits an owned officer nation reservation and replays the durable response without a second queue mutation', async () => {
        const idempotencyKey = `${mutationRequestPrefix}nation-success`;
        const inputPayload = {
            generalId,
            turnIndex: 0,
            action: '휴식',
            args: {},
            expectedRevision: 0,
        };
        const accessToken = await createAccessToken('matrix-nation-success', {});
        const databaseBefore = await readReservedMutationState();
        const durableBefore = await readDurableSchemaStateExcludingMatrixApiJournal();
        const allowedTablesBefore = await readSuccessAllowedTableState();
        const redisBefore = await readRealtimeRedisState();

        const first = await requestReservedNation(accessToken, idempotencyKey, generalId);
        expect(first.response.status).toBe(200);
        expect(first.body).toMatchObject({ result: { data: { ok: true, revision: 1 } } });
        const firstResult = (first.body as { result: { data: unknown } }).result.data;
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
            payload: inputPayload,
            result: firstResult,
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
        expect(replay.response.status).toBe(200);
        expect(replay.body).toEqual(first.body);
        const replayState = await readReservedMutationState();
        expect({ ...replayState, generalAccessLogs: committed.generalAccessLogs }).toEqual(committed);
        expectSingleActorActivity(replayState.generalAccessLogs);
        expect(
            withoutDurableTables(await readDurableSchemaStateExcludingMatrixApiJournal(), ['general_access_log'])
        ).toEqual(withoutDurableTables(replayDurableBefore, ['general_access_log']));
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
            payload: inputPayload,
            result: firstResult,
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

    it('play audit HTTP scope, no-general access, bounded history and token revocation', async () => {
        const auditUserId = `audit-http-${process.pid}`;
        const seasonId = `audit-season-${process.pid}`;
        const sampleId = `${seasonId}:190:1`;
        const policyId = (revision: number) =>
            createHash('sha256').update(`${seasonId}:policy:${revision}`).digest('hex');
        const originalWorld = await db.worldState.findUniqueOrThrow({ where: { id: fixtureWorldId } });
        const token = async (roles: string[], sanctions: GameSessionTokenPayload['sanctions'] = {}) => {
            const payload = buildPayload(`audit-${roles.join('-')}`, sanctions, auditUserId);
            payload.user.roles = roles;
            const issued = await accessTokenStore.create(payload);
            if (!issued) throw new Error('audit token fixture failed');
            return issued.accessToken;
        };
        const get = async (path: string, accessToken?: string, input?: unknown) => {
            const response = await fetch(
                `${baseUrl}/trpc/playAudit.${path}${input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
                {
                    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
                }
            );
            return { status: response.status, body: (await response.json()) as unknown };
        };
        try {
            await db.nation.createMany({
                data: [
                    { id: 99121, name: '현재감사국가1', color: '#ffffff' },
                    { id: 99122, name: '현재감사국가2', color: '#ffffff' },
                ],
            });
            await db.worldState.update({
                where: { id: fixtureWorldId },
                data: {
                    currentYear: 190,
                    currentMonth: 2,
                    meta: { serverId: seasonId, scenarioMeta: { startYear: 190 } },
                },
            });
            const current = await db.general.findUniqueOrThrow({ where: { id: generalId } });
            const past = projectCurrentGeneral(current);
            await db.playAuditMonth.create({
                data: {
                    id: sampleId,
                    serverId: seasonId,
                    year: 190,
                    month: 1,
                    kind: 'MONTH_END',
                    settlementsComplete: true,
                    tick: 4_320_000_000n,
                    hash: 'http-fixture',
                    cities: {
                        create: {
                            cityId: 99123,
                            nationId: ownerNationId,
                            data: {
                                id: 99123,
                                name: '과거도시',
                                nationId: ownerNationId,
                                level: 4,
                                state: 0,
                                population: 100,
                                populationMax: 200,
                                agriculture: 10,
                                agricultureMax: 20,
                                commerce: 10,
                                commerceMax: 20,
                                security: 10,
                                securityMax: 20,
                                wall: 10,
                                wallMax: 20,
                                defence: 10,
                                defenceMax: 20,
                                supplyState: 1,
                                frontState: 0,
                                trust: 80,
                            },
                        },
                    },
                    generals: {
                        create: {
                            generalId,
                            nationId: current.nationId,
                            cityId: 99123,
                            npcState: current.npcState,
                            data: { ...past, cityId: 99123, name: '과거이름', hiddenSecret: 'must-not-expose' },
                        },
                    },
                },
            });
            const admin = await token([`admin.playAudit.read:${profileName}`]);
            await db.inputEvent.create({
                data: {
                    sequence: 9007199254740993n,
                    requestId: 'audit-policy-request',
                    target: 'ENGINE',
                    eventType: 'setNpcPolicy',
                    status: 'SUCCEEDED',
                    attempts: 2,
                    payload: { secret: 'request-secret' },
                    result: { secret: 'request-secret' },
                    error: 'request-secret',
                    actorUserId: 'request-secret',
                    lockedBy: 'request-secret',
                    acceptedGameTick: 4320000000n,
                    processingGameTick: 4356000000n,
                    acceptedClockRevision: 3n,
                    processingClockRevision: 4n,
                    processingAt: new Date('2026-09-16T00:00:01Z'),
                    completedAt: new Date('2026-09-16T00:00:02Z'),
                },
            });
            const beforeInputs = await db.inputEvent.count();
            const decisionIds = [policyId(501), policyId(502)].sort().reverse();
            const decisionGeneral = 99129; // live general 없이 보존 이력을 읽는다.
            const decisionSummary = {
                schemaVersion: 1,
                coverage: 'PROCEDURES',
                clockRevision: 1,
                codeVersion: null,
                policyRefs: { DEFENCE: policyId(1), secret: 'decision-secret' },
                requestedAction: '휴식',
                selectedAction: 'che_징병',
                selectedReason: '징병',
                executedAction: '휴식',
                completed: false,
                usedFallback: true,
                blockedReason: '자원 부족',
                seed: 'decision-secret',
            };
            await db.playAuditDecision.createMany({
                data: decisionIds.map((id, index) => ({
                    id,
                    serverId: seasonId,
                    executionId: id,
                    phase: index ? 'nation' : 'general',
                    generalId: decisionGeneral,
                    nationId: ownerNationId,
                    cityId: 1,
                    npcState: index ? 1 : 2,
                    year: 190,
                    month: 1,
                    tick: 4_320_000_000n,
                    stepCount: 129,
                    summary: { ...decisionSummary, codeVersion: index ? null : 'a'.repeat(40) },
                    hash: id,
                })),
            });
            const step = {
                phase: 'general',
                generalId: decisionGeneral,
                nationId: ownerNationId,
                cityId: 1,
                npcState: 2,
                year: 190,
                month: 1,
                tick: 4_320_000_000,
                kind: 'PROCEDURE_START',
                procedure: '상세에서만표시',
                secret: 'decision-secret',
            };
            await db.playAuditDecisionChunk.createMany({
                data: [
                    {
                        decisionId: decisionIds[0]!,
                        ordinal: 0,
                        steps: Array.from({ length: 128 }, (_, sequence) => sequence === 127
                            ? { ...step, sequence, kind: 'DECISION_START', reservedAction: '휴식', effectivePolicy: {"schemaVersion":1,"general":{"priority":["징병"],"flags":{"징병":true,"출병":false}},"nation":{"priority":["천도"],"flags":{"천도":true},"values":{"reqNationGold":4321,"reqNationRice":100,"reqHumanWarUrgentGold":100,"reqHumanWarUrgentRice":100,"reqHumanWarRecommandGold":100,"reqHumanWarRecommandRice":100,"reqHumanDevelGold":100,"reqHumanDevelRice":100,"reqNpcWarGold":100,"reqNpcWarRice":100,"reqNpcDevelGold":100,"reqNpcDevelRice":100,"minimumResourceActionAmount":100,"maximumResourceActionAmount":100,"minNpcWarLeadership":100,"minWarCrew":100,"minNpcRecruitCityPopulation":100,"safeRecruitCityPopulationRatio":100,"properWarTrainAtmos":100,"cureThreshold":100},"combatForce":{"1":[2,3]},"supportForce":[4],"developForce":[5],"secret":"decision-secret"},"secret":"decision-secret"} }
                            : ({ ...step, sequence })),
                    },
                    {
                        decisionId: decisionIds[0]!,
                        ordinal: 1,
                        steps: [
                            {
                                ...step,
                                sequence: 128,
                                kind: 'EXECUTION_ATTEMPT',
                                attempt: 0,
                                requestedAction: 'che_징병',
                                resolvedAction: 'che_징병',
                                executedAction: '휴식',
                                completed: true,
                                usedFallback: true,
                                alternativeAction: null,
                                preparation: null,
                                checks: [
                                    {
                                        stage: 'CONSTRAINT',
                                        action: 'che_징병',
                                        result: 'deny',
                                        reason: '자원 부족',
                                        secret: 'decision-secret',
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });
            const decisionInput = { generalId: decisionGeneral, month: { year: 190, month: 1 }, limit: 1 };
            expect((await get('decisionHistory', undefined, decisionInput)).status).toBe(401);
            expect((await get('decisionHistory', await token(['admin']), decisionInput)).status).toBe(403);
            const decisionList = await get('decisionHistory', admin, decisionInput);
            expect(decisionList.body).toMatchObject({
                result: {
                    data: {
                        coverage: 'PROCEDURES_ONLY',
                        items: [{ id: decisionIds[0], tick: '4320000000', summary: { codeVersion: 'a'.repeat(40) } }],
                        nextCursor: { tick: '4320000000', id: decisionIds[0] },
                    },
                },
            });
            expect(JSON.stringify(decisionList.body)).not.toContain('상세에서만표시');
            expect(JSON.stringify(decisionList.body)).not.toContain('decision-secret');
            expect(
                (
                    await get('decisionHistory', admin, {
                        ...decisionInput,
                        cursor: { tick: '4320000000', id: decisionIds[0] },
                    })
                ).body
            ).toMatchObject({
                result: { data: { items: [{ id: decisionIds[1], summary: { codeVersion: null } }], nextCursor: null } },
            });
            expect((await get('decisionHistory', admin, { ...decisionInput, phase: 'nation' })).body).toMatchObject({
                result: { data: { items: [{ id: decisionIds[1] }] } },
            });
            const decisionDetailInput = { generalId: decisionGeneral, id: decisionIds[0] };
            const decisionPage = await get('decisionDetail', admin, decisionDetailInput);
            expect(decisionPage.status).toBe(200);
            expect(decisionPage.body).toMatchObject({
                result: {
                    data: {
                        chunks: [
                            {
                                ordinal: 0,
                                steps: expect.arrayContaining(
                                    [{ ...step, secret: undefined, sequence: 0 }].map(
                                        ({ secret: _secret, ...value }) => value
                                    )
                                ),
                            },
                        ],
                        nextCursor: 0,
                    },
                },
            });
            expect(JSON.stringify(decisionPage.body)).not.toContain('decision-secret');
            expect(JSON.stringify(decisionPage.body)).toContain('effectivePolicy');
            expect(JSON.stringify(decisionPage.body)).toContain('4321');
            expect((await get('decisionDetail', admin, { ...decisionDetailInput, cursor: 0 })).body).toMatchObject({
                result: {
                    data: {
                        chunks: [
                            {
                                ordinal: 1,
                                steps: [
                                    {
                                        sequence: 128,
                                        kind: 'EXECUTION_ATTEMPT',
                                        checks: [{ stage: 'CONSTRAINT', result: 'deny', reason: '자원 부족' }],
                                    },
                                ],
                            },
                        ],
                        nextCursor: null,
                    },
                },
            });
            expect(
                JSON.stringify((await get('decisionDetail', admin, { ...decisionDetailInput, cursor: 0 })).body)
            ).not.toContain('decision-secret');
            expect((await get('decisionDetail', admin, { ...decisionDetailInput, generalId })).status).toBe(404);
            expect((await get('decisionDetail', admin, { ...decisionDetailInput, limit: 5 })).status).toBe(400);
            expect((await get('decisionHistory', admin, { ...decisionInput, limit: 201 })).status).toBe(400);
            expect(
                (
                    await get('decisionHistory', admin, {
                        ...decisionInput,
                        cursor: { tick: '9007199254740992', id: decisionIds[0] },
                    })
                ).status
            ).toBe(400);
            expect(
                (await get('decisionHistory', admin, { ...decisionInput, month: { year: 9999, month: 1 } })).status
            ).toBe(400);

            const diplomacyInput = {
                nationId: 99121,
                otherNationId: 99122,
                from: { year: 190, month: 1 },
                to: { year: 190, month: 2 },
            };
            const letter = await db.diplomacyLetter.create({
                data: {
                    srcNationId: 99121,
                    destNationId: 99122,
                    srcSignerId: generalId,
                    state: 'CANCELLED',
                    textBrief: '당시 외교 문서',
                    textDetail: '<p>역사 본문</p><script>window.auditInjected=true</script>',
                },
            });
            await db.playAuditDiplomacyEvent.createMany({
                data: [1, 2, 3].map((ordinal) => ({
                    id: policyId(100 + ordinal),
                    sequence: 9007199254741000n + BigInt(ordinal),
                    schemaVersion: 1,
                    serverId: seasonId,
                    nationA: 99121,
                    nationB: 99122,
                    srcNationId: 99121,
                    destNationId: 99122,
                    category: ordinal === 2 ? 'RELATION' : 'DOCUMENT',
                    source: 'API',
                    eventType: 'LETTER_ACCEPTED',
                    documentId: ordinal === 2 ? null : letter.id,
                    documentHash: ordinal === 3 ? 'wrong-hash' : hashAuditDiplomacyDocument(letter),
                    year: 190,
                    month: ordinal === 3 ? 2 : 1,
                    executionId: 'http-fixture',
                    ordinal,
                    requestId: 'hidden-request-in-list',
                    inputSequence: 9007199254740993n,
                    actor: {
                        userId: 'hidden-account',
                        generalId,
                        name: '당시군주',
                        nationId: 99121,
                        officerLevel: 12,
                        npcState: 0,
                        debug: 'hidden-debug',
                    },
                    before: { state: 'PROPOSED', debug: 'hidden-before' },
                    after: { state: 'ACTIVATED', debug: 'hidden-after' },
                    hash: 'fixture',
                })),
            });
            const diplomacyPage = await get('diplomacyHistory', admin, { ...diplomacyInput, limit: 1 });
            expect(diplomacyPage.status).toBe(200);
            expect(diplomacyPage.body).toMatchObject({
                result: {
                    data: {
                        nextCursor: '9007199254741003',
                        coverage: 'RECORDED_EVENTS_ONLY',
                        items: [{ id: policyId(103), sequence: '9007199254741003' }],
                    },
                },
            });
            for (const hidden of [
                'hidden-account',
                'hidden-debug',
                'hidden-request-in-list',
                'before',
                'after',
                '역사 본문',
            ])
                expect(JSON.stringify(diplomacyPage.body)).not.toContain(hidden);
            expect(
                (
                    await get('diplomacyHistory', admin, {
                        ...diplomacyInput,
                        nationId: 99122,
                        otherNationId: 99121,
                        cursor: '9007199254741003',
                    })
                ).body
            ).toMatchObject({
                result: { data: { nextCursor: null, items: [{ id: policyId(102) }, { id: policyId(101) }] } },
            });
            expect(
                (await get('diplomacyHistory', admin, { ...diplomacyInput, category: 'RELATION' })).body
            ).toMatchObject({ result: { data: { items: [{ id: policyId(102) }] } } });
            const eventDetail = await get('diplomacyEvent', admin, { id: policyId(101) });
            expect(eventDetail.status).toBe(200);
            expect(eventDetail.body).toMatchObject({
                result: {
                    data: {
                        event: {
                            before: { state: 'PROPOSED' },
                            after: { state: 'ACTIVATED' },
                            inputSequence: '9007199254740993',
                            documentStatus: 'AVAILABLE',
                            document: {
                                detail: '<p>역사 본문</p><script>window.auditInjected=true</script>',
                                detailHtml: '<p>역사 본문</p>',
                            },
                        },
                    },
                },
            });
            for (const hidden of ['hidden-account', 'hidden-debug', 'hidden-before', 'hidden-after'])
                expect(JSON.stringify(eventDetail.body)).not.toContain(hidden);
            expect((await get('diplomacyEvent', admin, { id: policyId(103) })).body).toMatchObject({
                result: { data: { event: { documentStatus: 'HASH_MISMATCH', document: null } } },
            });
            await db.diplomacyLetter.delete({ where: { id: letter.id } });
            expect((await get('diplomacyEvent', admin, { id: policyId(101) })).body).toMatchObject({
                result: { data: { event: { documentStatus: 'MISSING_REFERENCE', document: null } } },
            });
            for (const patch of [
                { cursor: 'x' },
                { cursor: '9223372036854775808' },
                { limit: 201 },
                { otherNationId: 99121 },
                { from: { year: 189, month: 12 } },
                { to: { year: 191, month: 1 } },
            ])
                expect((await get('diplomacyHistory', admin, { ...diplomacyInput, ...patch })).status).toBe(400);
            expect((await get('diplomacyEvent', admin, { id: '../bad' })).status).toBe(400);
            for (const [operation, input] of [
                ['diplomacyHistory', diplomacyInput],
                ['diplomacyEvent', { id: policyId(101) }],
            ] as const) {
                expect((await get(operation, undefined, input)).status).toBe(401);
                for (const roles of [['admin'], ['admin.playAudit.read:other:default']])
                    expect((await get(operation, await token(roles), input)).status).toBe(403);
            }

            const policyInput = {
                nationId: 99128,
                area: 'DEFENCE',
                from: { year: 190, month: 1 },
                to: { year: 190, month: 2 },
            };
            await db.playAuditPolicy.createMany({
                data: [1, 2, 3].map((revision) => ({
                    id: policyId(revision),
                    serverId: seasonId,
                    nationId: 99128,
                    area: 'DEFENCE',
                    revision,
                    previousId: revision > 1 ? policyId(revision - 1) : null,
                    source: revision === 1 ? 'BASELINE' : 'CHANGE',
                    year: 190,
                    month: revision === 3 ? 2 : 1,
                    ordinal: revision,
                    tick: 4_320_000_000n,
                    requestId: revision > 1 ? 'audit-policy-request' : null,
                    inputSequence: revision > 1 ? 9007199254740993n : null,
                    actor:
                        revision > 1
                            ? {
                                  userId: 'hidden-account',
                                  generalId,
                                  name: '당시군주',
                                  nationId: 99128,
                                  officerLevel: 12,
                                  npcState: 0,
                                  permission: 3,
                                  extra: 'hidden-extra',
                              }
                            : GamePrisma.DbNull,
                    before: revision === 1 ? GamePrisma.DbNull : { scout: revision - 1 },
                    after: { scout: revision },
                    hash: 'fixture',
                })),
            });
            const requestInput = { kind: 'POLICY', id: policyId(2) };
            expect((await get('requestState', undefined, requestInput)).status).toBe(401);
            for (const roles of [['admin'], ['admin.playAudit.read:other:default']])
                expect((await get('requestState', await token(roles), requestInput)).status).toBe(403);
            const requestState = await get('requestState', admin, requestInput);
            expect(requestState.status).toBe(200);
            expect(requestState.body).toMatchObject({
                result: {
                    data: {
                        status: 'AVAILABLE',
                        coverage: 'CURRENT_JOURNAL_STATE',
                        request: {
                            sequence: '9007199254740993',
                            requestId: 'audit-policy-request',
                            status: 'SUCCEEDED',
                            attempts: 2,
                            acceptedGameTick: '4320000000',
                            processingGameTick: '4356000000',
                            acceptedClockRevision: '3',
                            processingClockRevision: '4',
                            resultRecorded: true,
                            errorRecorded: true,
                        },
                    },
                },
            });
            for (const excluded of ['request-secret', 'payload', 'actorUserId', 'lockedBy'])
                expect(JSON.stringify(requestState.body)).not.toContain(excluded);
            expect((await get('requestState', admin, { kind: 'POLICY', id: policyId(1) })).body).toMatchObject({
                result: { data: { status: 'NOT_LINKED', request: null } },
            });
            expect((await get('requestState', admin, { kind: 'POLICY', id: policyId(99) })).status).toBe(404);
            expect((await get('requestState', admin, { ...requestInput, requestId: 'arbitrary' })).status).toBe(400);
            expect((await get('requestState', admin, { ...requestInput, id: '../bad' })).status).toBe(400);
            await db.playAuditPolicy.update({ where: { id: policyId(2) }, data: { inputSequence: null } });
            expect((await get('requestState', admin, requestInput)).body).toMatchObject({
                result: { data: { status: 'INCOMPLETE_REFERENCE', request: null } },
            });
            await db.playAuditPolicy.update({ where: { id: policyId(2) }, data: { inputSequence: 9007199254740994n } });
            expect((await get('requestState', admin, requestInput)).body).toMatchObject({
                result: { data: { status: 'REFERENCE_MISMATCH', request: null } },
            });
            await db.playAuditPolicy.update({ where: { id: policyId(2) }, data: { inputSequence: 9007199254740993n } });
            expect((await get('requestState', admin, { kind: 'DIPLOMACY', id: policyId(101) })).body).toMatchObject({
                result: { data: { status: 'MISSING_REQUEST', request: null } },
            });
            await db.playAuditDiplomacyEvent.update({
                where: { id: policyId(101) },
                data: { requestId: 'audit-policy-request' },
            });
            expect((await get('requestState', admin, { kind: 'DIPLOMACY', id: policyId(101) })).body).toMatchObject({
                result: { data: { status: 'AVAILABLE', request: { sequence: '9007199254740993' } } },
            });
            const policyPage = await get('policyHistory', admin, { ...policyInput, limit: 1 });
            expect(policyPage.status).toBe(200);
            expect(policyPage.body).toMatchObject({
                result: {
                    data: {
                        nextCursor: 3,
                        items: [{ revision: 3, source: 'CHANGE', actor: { name: '당시군주', officerLevel: 12 } }],
                    },
                },
            });
            for (const excluded of ['hidden-account', 'hidden-extra', 'before', 'after', 'inputSequence', 'requestId'])
                expect(JSON.stringify(policyPage.body)).not.toContain(excluded);
            expect((await get('policyHistory', admin, { ...policyInput, cursor: 3 })).body).toMatchObject({
                result: { data: { nextCursor: null, items: [{ revision: 2 }, { revision: 1, actor: null }] } },
            });
            expect(
                (await get('policyHistory', admin, { ...policyInput, to: { year: 190, month: 1 } })).body
            ).toMatchObject({ result: { data: { items: [{ revision: 2 }, { revision: 1 }] } } });
            const policyDetail = await get('policyVersion', admin, { id: policyId(3) });
            expect(policyDetail.status).toBe(200);
            expect(policyDetail.body).toMatchObject({
                result: {
                    data: {
                        version: {
                            previousId: policyId(2),
                            tick: '4320000000',
                            inputSequence: '9007199254740993',
                            fields: [{ key: 'scout', beforeJson: '2', afterJson: '3', changed: true }],
                        },
                    },
                },
            });
            expect(JSON.stringify(policyDetail.body)).not.toContain('hidden-account');
            expect((await get('policyVersion', admin, { id: policyId(1) })).body).toMatchObject({
                result: { data: { version: { fields: [{ beforeJson: null, changed: false }] } } },
            });
            expect((await get('policyVersion', admin, { id: policyId(99) })).status).toBe(404);
            for (const patch of [
                { limit: 201 },
                { cursor: 0 },
                { area: 'ANY' },
                { from: { year: 189, month: 12 } },
                { to: { year: 191, month: 1 } },
                { from: { year: 190, month: 2 }, to: { year: 190, month: 1 } },
            ])
                expect((await get('policyHistory', admin, { ...policyInput, ...patch })).status).toBe(400);
            expect((await get('policyVersion', admin, { id: '../bad' })).status).toBe(400);
            for (const [operation, input] of [
                ['policyHistory', policyInput],
                ['policyVersion', { id: policyId(3) }],
            ] as const) {
                expect((await get(operation, undefined, input)).status).toBe(401);
                for (const roles of [['admin'], ['admin.playAudit.read:other:default']])
                    expect((await get(operation, await token(roles), input)).status).toBe(403);
            }

            const logGeneralId = 99129; // No live general: death must not hide retained records.
            const ownLogs = await Promise.all(
                ['HISTORY', 'ACTION', 'BATTLE_BRIEF', 'BATTLE_DETAIL'].map((category) =>
                    db.logEntry.create({
                        data: {
                            serverId: seasonId,
                            generalId: logGeneralId,
                            scope: 'GENERAL',
                            category: category as 'HISTORY' | 'ACTION' | 'BATTLE_BRIEF' | 'BATTLE_DETAIL',
                            year: 190,
                            month: 1,
                            text: `${seasonId}:${category}`,
                        },
                    })
                )
            );
            const latest = await db.logEntry.create({
                data: {
                    serverId: seasonId,
                    generalId: logGeneralId,
                    scope: 'GENERAL',
                    category: 'HISTORY',
                    year: 190,
                    month: 2,
                    text: `${seasonId}:latest`,
                },
            });
            await db.logEntry.createMany({
                data: [null, `${seasonId}:previous`].map((serverId) => ({
                    serverId,
                    generalId: logGeneralId,
                    scope: 'GENERAL' as const,
                    category: 'HISTORY' as const,
                    year: 190,
                    month: 1,
                    text: `${seasonId}:excluded`,
                })),
            });
            for (const [index, type] of ['generalHistory', 'generalAction', 'battleResult', 'battleDetail'].entries()) {
                const result = await get('generalLogs', admin, {
                    generalId: logGeneralId,
                    type,
                    month: { year: 190, month: 1 },
                });
                expect(result.status).toBe(200);
                expect(result.body).toMatchObject({
                    result: {
                        data: {
                            coverage: 'IDENTIFIED_LOGS_ONLY',
                            items: [{ id: ownLogs[index]!.id }],
                            nextCursor: null,
                        },
                    },
                });
                expect(JSON.stringify(result.body)).not.toContain(`${seasonId}:excluded`);
            }
            expect(
                (await get('generalLogs', admin, { generalId: logGeneralId, type: 'generalHistory', limit: 1 })).body
            ).toMatchObject({ result: { data: { items: [{ id: latest.id }], nextCursor: latest.id } } });
            expect(
                (
                    await get('generalLogs', admin, {
                        generalId: logGeneralId,
                        type: 'generalHistory',
                        limit: 1,
                        cursor: latest.id,
                    })
                ).body
            ).toMatchObject({ result: { data: { items: [{ id: ownLogs[0]!.id }], nextCursor: null } } });
            for (const invalid of [
                { limit: 201 },
                { cursor: 0 },
                { month: { year: 190, month: 3 } },
                { month: { year: 189, month: 12 } },
            ]) {
                expect(
                    (await get('generalLogs', admin, { generalId: logGeneralId, type: 'generalHistory', ...invalid }))
                        .status
                ).toBe(400);
            }

            expect((await get('generalDetail', admin, { id: generalId })).body).toMatchObject({
                result: { data: { collected: true, general: { id: generalId, name: current.name } } },
            });
            expect(
                (await get('generalDetail', admin, { id: generalId, at: { year: 190, month: 1 } })).body
            ).toMatchObject({
                result: {
                    data: {
                        collected: true,
                        sample: { tick: '4320000000' },
                        general: { name: '과거이름' },
                        city: { id: 99123, name: '과거도시' },
                    },
                },
            });
            expect(
                (await get('generalDetail', admin, { id: generalId, at: { year: 190, month: 2 } })).body
            ).toMatchObject({ result: { data: { collected: false, general: null } } });
            expect((await get('generalDetail', await token(['admin']), { id: generalId })).status).toBe(403);
            expect((await get('cityDetail', admin, { id: 99123, at: { year: 190, month: 1 } })).body).toMatchObject({
                result: { data: { collected: true, city: { id: 99123, name: '과거도시', population: 100 } } },
            });
            await db.generalTurn.createMany({
                data: [9001, 9002].map((turnIdx) => ({
                    generalId,
                    turnIdx,
                    actionCode: '휴식',
                    arg: { fixture: turnIdx },
                })),
            });
            expect((await get('generalTurns', admin, { generalId, cursor: 9000, limit: 1 })).body).toMatchObject({
                result: {
                    data: {
                        currentOnly: true,
                        items: [{ turnIdx: 9001, actionCode: '휴식', argumentJson: '{"fixture":9001}' }],
                        nextCursor: 9001,
                    },
                },
            });
            expect((await get('generalTurns', admin, { generalId, cursor: 9001, limit: 1 })).body).toMatchObject({
                result: { data: { items: [{ turnIdx: 9002 }], nextCursor: null } },
            });
            expect((await get('generalTurns', admin, { generalId, at: { year: 190, month: 1 } })).status).toBe(400);
            expect((await get('generalTurns', admin, { generalId, limit: 201 })).status).toBe(400);
            expect((await get('capabilities')).status).toBe(401);
            for (const roles of [['user'], ['admin'], ['admin.audit.read'], ['admin.playAudit.read:other:default']]) {
                expect((await get('capabilities', await token(roles))).status).toBe(403);
            }
            expect(await db.general.findUnique({ where: { userId: auditUserId } })).toBeNull();
            expect((await get('capabilities', admin)).body).toMatchObject({
                result: { data: { read: true, accounts: false } },
            });
            const first = await get('generals', admin, { limit: 1 });
            expect(first.status).toBe(200);
            expect(first.body).toMatchObject({
                result: { data: { nextCursor: generalId, items: [{ id: generalId }] } },
            });
            expect((await get('generals', admin, { limit: 1, cursor: generalId })).body).toMatchObject({
                result: { data: { items: [{ id: sameNationGeneralId }] } },
            });
            expect((await get('generals', admin, { population: 'npc' })).body).toMatchObject({
                result: { data: { items: [{ id: npcGeneralId }] } },
            });
            expect((await get('coverage', admin, { limit: 1 })).body).toMatchObject({
                result: { data: { status: 'COLLECTED', samples: [{ year: 190, month: 1 }] } },
            });
            expect((await get('coverage', admin, { cursor: { year: 190, month: 1 } })).body).toMatchObject({
                result: { data: { status: 'PAGE_EMPTY', samples: [] } },
            });
            expect((await get('generals', admin, { limit: 201 })).status).toBe(400);
            expect((await get('generals', admin, { at: { year: 191, month: 1 } })).status).toBe(400);
            const history = await get('generals', admin, { at: { year: 190, month: 1 } });
            expect(history.status).toBe(200);
            expect(history.body).toMatchObject({
                result: { data: { collected: true, items: [{ name: '과거이름' }] } },
            });
            expect(JSON.stringify(history.body)).not.toContain('must-not-expose');
            for (const name of ['과거', '  과거  ']) {
                expect((await get('generals', admin, { at: { year: 190, month: 1 }, name })).body).toMatchObject({
                    result: { data: { items: [{ name: '과거이름' }] } },
                });
            }
            for (const name of ['없는이름', '%', '_', '\\']) {
                expect((await get('generals', admin, { at: { year: 190, month: 1 }, name })).body).toMatchObject({
                    result: { data: { items: [] } },
                });
            }
            const currentName = (await db.general.findUniqueOrThrow({ where: { id: generalId } })).name;
            expect((await get('generals', admin, { name: currentName })).body).toMatchObject({
                result: { data: { items: expect.arrayContaining([expect.objectContaining({ id: generalId })]) } },
            });
            expect((await get('generals', admin, { name: '과거이름' })).body).toMatchObject({
                result: { data: { items: [] } },
            });
            expect((await get('generals', admin, { name: '%' })).body).toMatchObject({
                result: { data: { items: [] } },
            });
            const descendingIds = await db.general.findMany({ orderBy: { id: 'desc' }, select: { id: true } });
            expect((await get('generals', admin, { order: 'desc', limit: 1 })).body).toMatchObject({
                result: { data: { nextCursor: descendingIds[0]!.id, items: [descendingIds[0]] } },
            });
            expect(
                (await get('generals', admin, { order: 'desc', limit: 1, cursor: descendingIds[0]!.id })).body
            ).toMatchObject({
                result: { data: { items: [descendingIds[1]] } },
            });
            expect(
                (await get('generals', admin, { order: 'desc', at: { year: 190, month: 1 }, cursor: generalId })).body
            ).toMatchObject({
                result: { data: { items: [] } },
            });
            expect((await get('generals', admin, { name: '가'.repeat(65) })).status).toBe(400);
            expect((await get('generals', admin, { order: 'gold' })).status).toBe(400);

            expect((await get('generals', admin, { at: { year: 190, month: 2 } })).body).toMatchObject({
                result: { data: { collected: false, items: [] } },
            });
            const blocked = await token([`admin.playAudit.read:${profileName}`], {
                serverRestrictions: { [profileName]: { blockedFeatures: ['gameplay'] } },
            });
            expect((await get('capabilities', blocked)).status).toBe(403);
            expect((await get('policyHistory', blocked, policyInput)).status).toBe(403);
            expect((await get('diplomacyHistory', blocked, diplomacyInput)).status).toBe(403);
            expect((await get('diplomacyEvent', blocked, { id: policyId(101) })).status).toBe(403);
            expect((await get('policyVersion', blocked, { id: policyId(3) })).status).toBe(403);
            const population = {
                count: 0,
                gold: 0,
                rice: 0,
                dex: { dex1: 0, dex2: 0, dex3: 0, dex4: 0, dex5: 0 },
                averageGold: null,
                averageRice: null,
                averageDex: { dex1: null, dex2: null, dex3: null, dex4: null, dex5: null },
            };
            await db.playAuditMonth.createMany({
                data: [2, 3, 4, 5, 6].map((month) => ({
                    id: `${seasonId}:190:${month}`,
                    serverId: seasonId,
                    year: 190,
                    month,
                    kind: 'MONTH_END',
                    settlementsComplete: true,
                    hash: 'http-series-fixture',
                })),
            });
            await db.playAuditNation.createMany({
                data: [1, 2, 3, 4, 5, 6].map((month) => ({
                    sampleId: `${seasonId}:190:${month}`,
                    nationId: ownerNationId,
                    data: {
                        id: ownerNationId,
                        name: `국가${month}`,
                        color: '#ffffff',
                        gold: month * 100,
                        rice: 200,
                        tech: 10,
                        appliedRate: 20,
                        incomeGold: month,
                        incomeRice: 0,
                        paidGold: 0,
                        paidRice: 0,
                        populations: { human: population, npc: population, troopNpc: population },
                    },
                })),
            });
            await db.worldState.update({ where: { id: fixtureWorldId }, data: { currentMonth: 7 } });
            const finalNation = await db.playAuditNation.findUniqueOrThrow({
                where: { sampleId_nationId: { sampleId: `${seasonId}:190:6`, nationId: ownerNationId } },
            });
            await db.playAuditMonth.create({
                data: {
                    id: `${seasonId}:final`,
                    serverId: seasonId,
                    year: 190,
                    month: 6,
                    kind: 'FINAL',
                    settlementsComplete: true,
                    hash: 'http-final-fixture',
                    nations: {
                        create: {
                            nationId: ownerNationId,
                            data: {
                                ...asRecord(finalNation.data),
                                gold: 999,
                                incomeGold: 999,
                                hiddenSecret: 'must-not-expose',
                            },
                        },
                    },
                },
            });
            await db.playAuditMonth.create({
                data: {
                    id: `${seasonId}:adoption`,
                    serverId: seasonId,
                    year: 190,
                    month: 1,
                    kind: 'INITIAL',
                    settlementsComplete: false,
                    hash: 'http-initial-fixture',
                    nations: {
                        create: {
                            nationId: ownerNationId,
                            data: { ...asRecord(finalNation.data), gold: 777, incomeGold: null },
                        },
                    },
                    generals: {
                        create: {
                            generalId,
                            nationId: current.nationId,
                            cityId: 99123,
                            npcState: current.npcState,
                            data: { ...past, name: '도입장수' },
                        },
                    },
                },
            });
            await db.worldState.update({
                where: { id: fixtureWorldId },
                data: {
                    meta: {
                        serverId: seasonId,
                        scenarioMeta: { startYear: 190 },
                        playAuditCollection: {
                            schemaVersion: 1,
                            serverId: seasonId,
                            year: 190,
                            month: 1,
                            tick: 0,
                            observedAt: '2026-09-16T00:00:00.000Z',
                        },
                    },
                },
            });
            expect((await get('coverage', admin, { limit: 1 })).body).toMatchObject({
                result: {
                    data: {
                        collectionStart: { year: 190, month: 1, observedAt: '2026-09-16T00:00:00.000Z' },
                        samples: [{ kind: 'INITIAL' }],
                        nextCursor: { year: 190, month: 1, kind: 'INITIAL' },
                    },
                },
            });
            expect(
                (await get('coverage', admin, { limit: 1, cursor: { year: 190, month: 1, kind: 'INITIAL' } })).body
            ).toMatchObject({ result: { data: { samples: [{ kind: 'MONTH_END' }] } } });
            expect(
                (
                    await get('nationSnapshot', admin, {
                        nationId: ownerNationId,
                        at: { year: 190, month: 1, kind: 'INITIAL' },
                    })
                ).body
            ).toMatchObject({
                result: { data: { nation: { gold: 777, incomeGold: null }, sample: { kind: 'INITIAL' } } },
            });
            expect(
                (await get('generalDetail', admin, { id: generalId, at: { year: 190, month: 1, kind: 'INITIAL' } }))
                    .body
            ).toMatchObject({ result: { data: { general: { name: '도입장수' } } } });
            expect(
                (
                    await get('nationSnapshot', admin, {
                        nationId: ownerNationId,
                        at: { year: 190, month: 6, kind: 'FINAL' },
                    })
                ).body
            ).toMatchObject({
                result: {
                    data: { collected: true, sample: { kind: 'FINAL' }, nation: { gold: 999, incomeGold: 999 } },
                },
            });
            expect(
                JSON.stringify(
                    (
                        await get('nationSnapshot', admin, {
                            nationId: ownerNationId,
                            at: { year: 190, month: 6, kind: 'FINAL' },
                        })
                    ).body
                )
            ).not.toContain('must-not-expose');
            expect(
                (
                    await get('nationSnapshot', admin, {
                        nationId: ownerNationId,
                        at: { year: 190, month: 7, kind: 'FINAL' },
                    })
                ).body
            ).toMatchObject({ result: { data: { collected: false, nation: null } } });
            expect(
                (await get('nationSnapshot', admin, { nationId: 0, at: { year: 190, month: 6, kind: 'FINAL' } })).body
            ).toMatchObject({ result: { data: { collected: true, nation: null } } });
            expect(
                (
                    await get('nationSnapshot', await token(['admin']), {
                        nationId: ownerNationId,
                        at: { year: 190, month: 6, kind: 'FINAL' },
                    })
                ).status
            ).toBe(403);
            expect((await get('nations', admin, { at: { year: 190, month: 1 }, limit: 1 })).body).toMatchObject({
                result: { data: { collected: true, items: [{ id: ownerNationId, name: '국가1' }] } },
            });
            expect((await get('nations', admin, { at: { year: 190, month: 7 } })).body).toMatchObject({
                result: { data: { collected: false, items: [] } },
            });
            expect((await get('nations', admin, { limit: 201 })).status).toBe(400);
            expect((await get('nations')).status).toBe(401);
            expect((await get('nations', await token(['admin']))).status).toBe(403);
            expect((await get('nations', admin, { limit: 1 })).body).toMatchObject({
                result: {
                    data: {
                        collected: true,
                        nextCursor: expect.any(Number),
                        items: [expect.objectContaining({ id: expect.any(Number), name: expect.any(String) })],
                    },
                },
            });
            await db.playAuditNation.update({
                where: { sampleId_nationId: { sampleId: `${seasonId}:190:6`, nationId: ownerNationId } },
                data: {
                    data: {
                        ...asRecord(finalNation.data),
                        populations: {
                            human: { ...population, count: 2 },
                            npc: { ...population, count: 1 },
                            troopNpc: population,
                        },
                    },
                },
            });
            await db.playAuditGeneral.createMany({
                data: [1, 2].map((id) => ({
                    sampleId: `${seasonId}:190:6`,
                    generalId: id,
                    nationId: ownerNationId,
                    cityId: 0,
                    npcState: 0,
                    data: { crew: id * 1200 },
                })),
            });
            await db.playAuditGeneral.create({
                data: {
                    sampleId: `${seasonId}:190:6`,
                    generalId: 3,
                    nationId: ownerNationId,
                    cityId: 0,
                    npcState: 2,
                    data: { crew: 'invalid' },
                },
            });
            const series = await get('nationSeries', admin, {
                nationId: ownerNationId,
                from: { year: 190, month: 1 },
                to: { year: 190, month: 6 },
            });
            expect(series.status).toBe(200);
            expect(series.body).toMatchObject({
                result: {
                    data: {
                        nextCursor: null,
                        items: [
                            {
                                year: 190,
                                month: 1,
                                complete: true,
                                stock: {
                                    gold: 600,
                                    populations: { human: { crew: 3600 }, npc: { crew: null }, troopNpc: { crew: 0 } },
                                },
                                flows: { incomeGold: 21, incomeRice: 0 },
                            },
                        ],
                    },
                },
            });
            expect(
                (
                    await get('nationSeries', admin, {
                        nationId: ownerNationId,
                        resolution: 'month',
                        limit: 1,
                        from: { year: 190, month: 1 },
                        to: { year: 190, month: 6 },
                    })
                ).body
            ).toMatchObject({
                result: { data: { nextCursor: { year: 190, month: 2 }, items: [{ stock: { gold: 100 } }] } },
            });
            expect(
                (
                    await get('nationSeries', admin, {
                        nationId: ownerNationId,
                        from: { year: 190, month: 7 },
                        to: { year: 190, month: 7 },
                    })
                ).body
            ).toMatchObject({
                result: { data: { items: [{ complete: false, stock: null, flows: { incomeGold: null } }] } },
            });

            // 정산 commit 직후, 아직 월말 표본이 없는 상태를 HTTP로 확인한다.
            for (const [settlementMonth, resource] of [
                [1, 'gold'],
                [7, 'rice'],
            ] as const) {
                await db.worldState.update({
                    where: { id: fixtureWorldId },
                    data: {
                        currentYear: 191,
                        currentMonth: settlementMonth,
                        meta: {
                            serverId: seasonId,
                            scenarioMeta: { startYear: 190 },
                            playAuditFlows: {
                                year: 191,
                                month: settlementMonth,
                                complete: true,
                                entries: {
                                    [`${ownerNationId}:${resource}`]: {
                                        nationId: ownerNationId,
                                        resource,
                                        income: 8765.5,
                                        paid: 4321,
                                    },
                                },
                            },
                        },
                    },
                });
                const input = {
                    nationId: ownerNationId,
                    from: { year: 191, month: settlementMonth },
                    to: { year: 191, month: settlementMonth },
                };
                expect((await get('nationSeries', admin, input)).body).toMatchObject({
                    result: {
                        data: {
                            currentSettlement: {
                                year: 191,
                                month: settlementMonth,
                                [resource]: { income: 8765.5, paid: 4321 },
                            },
                            items: [{ stock: null, complete: false }],
                        },
                    },
                });
                expect((await get('nationSeries', undefined, input)).status).toBe(401);
                expect((await get('nationSeries', await token(['admin']), input)).status).toBe(403);
                expect(
                    (await get('nationSeries', await token(['admin.playAudit.read:other:default']), input)).status
                ).toBe(403);
            }

            // A synchronized opening may start before the scenario's gameplay year.
            await db.worldState.update({
                where: { id: fixtureWorldId },
                data: {
                    currentYear: 189,
                    currentMonth: 10,
                    meta: { serverId: seasonId, initYear: 189, initMonth: 10, scenarioMeta: { startYear: 190 } },
                },
            });
            await db.playAuditMonth.create({
                data: {
                    id: `${seasonId}:initial`,
                    serverId: seasonId,
                    year: 189,
                    month: 10,
                    kind: 'MONTH_END',
                    settlementsComplete: false,
                    hash: 'initial-calendar',
                },
            });
            await db.logEntry.create({
                data: {
                    serverId: seasonId,
                    scope: 'GENERAL',
                    category: 'HISTORY',
                    generalId: logGeneralId,
                    year: 189,
                    month: 10,
                    text: `${seasonId}:initial-log`,
                },
            });
            const initial = { year: 189, month: 10 };
            for (const [path, input] of [
                ['nationSnapshot', { nationId: ownerNationId, at: initial }],
                ['generalDetail', { id: generalId, at: initial }],
                ['cityDetail', { id: 99123, at: initial }],
            ] as const) {
                const response = await get(path, admin, input);
                expect(response.status).toBe(200);
                expect(response.body).toMatchObject({
                    result: { data: { startYear: 189, startMonth: 10, collected: true } },
                });
                expect((await get(path, admin, { ...input, at: { year: 189, month: 9 } })).status).toBe(400);
            }
            expect((await get('nationSeries', admin, { nationId: ownerNationId })).body).toMatchObject({
                result: { data: { items: [{ from: initial, to: initial }] } },
            });
            expect(
                (await get('nationSeries', admin, { nationId: ownerNationId, from: { year: 189, month: 9 } })).status
            ).toBe(400);
            expect(
                (await get('generalLogs', admin, { generalId: logGeneralId, type: 'generalHistory', month: initial }))
                    .body
            ).toMatchObject({ result: { data: { items: [{ text: `${seasonId}:initial-log` }] } } });
            expect(
                (
                    await get('generalLogs', admin, {
                        generalId: logGeneralId,
                        type: 'generalHistory',
                        month: { year: 189, month: 9 },
                    })
                ).status
            ).toBe(400);
            await db.worldState.update({ where: { id: fixtureWorldId }, data: { currentYear: 190, currentMonth: 7 } });

            await db.worldState.update({
                where: { id: fixtureWorldId },
                data: {
                    meta: {
                        serverId: `${seasonId}:new`,
                        scenarioMeta: { startYear: 190 },
                    },
                },
            });
            expect((await get('generals', admin, { at: { year: 190, month: 1 } })).body).toMatchObject({
                result: { data: { collected: false, items: [] } },
            });
            expect((await get('policyHistory', admin, policyInput)).body).toMatchObject({
                result: { data: { items: [] } },
            });
            expect((await get('policyVersion', admin, { id: policyId(3) })).status).toBe(404);
            expect((await get('requestState', admin, requestInput)).status).toBe(404);
            expect((await get('diplomacyHistory', admin, diplomacyInput)).body).toMatchObject({
                result: { data: { items: [] } },
            });
            expect((await get('diplomacyEvent', admin, { id: policyId(101) })).status).toBe(404);
            expect((await get('decisionHistory', admin, decisionInput)).body).toMatchObject({
                result: { data: { items: [] } },
            });
            expect((await get('decisionDetail', admin, decisionDetailInput)).status).toBe(404);
            expect(await db.inputEvent.count()).toBe(beforeInputs);
            await redis!.client.publish(
                `${redisPrefix}:flush`,
                JSON.stringify({
                    userId: auditUserId,
                    flushedAt: new Date().toISOString(),
                    reason: 'audit-role-revoked',
                })
            );
            await expect.poll(async () => (await get('capabilities', admin)).status).toBe(401);
        } finally {
            await db.playAuditDecisionChunk.deleteMany({ where: { decision: { serverId: seasonId } } });
            await db.playAuditDecision.deleteMany({ where: { serverId: seasonId } });
            await db.inputEvent.deleteMany({ where: { requestId: 'audit-policy-request' } });
            await db.playAuditPolicy.deleteMany({ where: { serverId: seasonId } });
            await db.playAuditDiplomacyEvent.deleteMany({ where: { serverId: seasonId } });
            await db.diplomacyLetter.deleteMany({ where: { srcNationId: 99121, destNationId: 99122 } });
            await db.logEntry.deleteMany({ where: { text: { startsWith: `${seasonId}:` } } });
            await db.playAuditMonth.deleteMany({ where: { serverId: seasonId } });
            await db.generalTurn.deleteMany({ where: { generalId, turnIdx: { in: [9001, 9002] } } });
            await db.nation.deleteMany({ where: { id: { in: [99121, 99122] } } });
            await db.worldState.update({
                where: { id: fixtureWorldId },
                data: {
                    meta: originalWorld.meta ?? GamePrisma.JsonNull,
                    currentYear: originalWorld.currentYear,
                    currentMonth: originalWorld.currentMonth,
                },
            });
        }
    });

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
