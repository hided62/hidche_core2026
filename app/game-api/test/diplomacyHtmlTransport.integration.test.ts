import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import {
    createGamePostgresConnector,
    createRedisConnector,
    resolveRedisConfigFromEnv,
    type GamePrismaClient,
    type RedisConnector,
} from '@sammo-ts/infra';
import { MESSAGE_MAILBOX_NATIONAL_BASE } from '@sammo-ts/logic';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { createGameApiServer } from '../src/server.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl || !process.env.REDIS_URL);
const profileId = process.env.POSTGRES_SCHEMA ?? 'public';
const profileName = `che:diplomacy-html-${process.pid}`;
const userId = `diplomacy-html-user-${process.pid}`;
// National and diplomacy mailboxes use the Ref-compatible 9000 + nation id
// address space, so a real nation fixture must stay in 1..998; 999 is public.
const fixtureId = 861;
const foreignNationId = fixtureId + 1;
const fixtureMailboxes = [
    MESSAGE_MAILBOX_NATIONAL_BASE + fixtureId,
    MESSAGE_MAILBOX_NATIONAL_BASE + foreignNationId,
] as const;
const secret = 'diplomacy-html-http-secret';
const redisPrefix = `sammo:diplomacy-html:${process.pid}`;
const envKeys = [
    'PROFILE',
    'SCENARIO',
    'GAME_PROFILE_NAME',
    'GAME_API_HOST',
    'GAME_API_PORT',
    'GAME_TOKEN_SECRET',
    'GATEWAY_REDIS_PREFIX',
    'GAME_UPLOAD_DIR',
    'DATABASE_URL',
] as const;
const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));

type RunningServer = Awaited<ReturnType<typeof createGameApiServer>>;

let server: RunningServer | null = null;
let baseUrl = '';
let uploadDir = '';
let db: GamePrismaClient;
let disconnectDb: (() => Promise<void>) | null = null;
let redis: RedisConnector | null = null;
let accessToken = '';
let legacyLetterId = 0;

const restoreEnv = (): void => {
    for (const [key, value] of originalEnv) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
};

const deleteProfileRedisKeys = async (): Promise<void> => {
    if (!redis) return;
    for await (const keys of redis.client.scanIterator({ MATCH: `sammo:game:*:${profileName}:*`, COUNT: 100 })) {
        if (keys.length > 0) await redis.client.del(keys);
    }
};

const isFixtureOutboxPayload = (payload: unknown): boolean => {
    if (!payload || typeof payload !== 'object' || !('changes' in payload)) return false;
    const changes = (payload as { changes?: unknown }).changes;
    return (
        Array.isArray(changes) &&
        changes.some(
            (change) =>
                Array.isArray(change) &&
                (change[0] === 'messages.mailbox' || change[0] === 'messages.diplomacyMailbox') &&
                fixtureMailboxes.includes(change[1] as (typeof fixtureMailboxes)[number])
        )
    );
};

const cleanup = async (): Promise<void> => {
    await db.message.deleteMany({ where: { mailbox: { in: [...fixtureMailboxes] } } });
    await db.diplomacyLetter.deleteMany({
        where: {
            OR: [
                { srcNationId: fixtureId },
                { destNationId: fixtureId },
                { srcNationId: foreignNationId },
                { destNationId: foreignNationId },
            ],
        },
    });
    await db.inputEvent.deleteMany({ where: { actorUserId: userId } });
    await db.readModelRevision.deleteMany({
        where: {
            domain: { in: ['messages.mailbox', 'messages.diplomacyMailbox'] },
            entityId: { in: [...fixtureMailboxes] },
        },
    });
    const outboxes = await db.readModelOutbox.findMany({ select: { id: true, payload: true } });
    const outboxIds = outboxes.filter(({ payload }) => isFixtureOutboxPayload(payload)).map(({ id }) => id);
    if (outboxIds.length > 0) {
        await db.readModelOutbox.deleteMany({ where: { id: { in: outboxIds } } });
    }
    await db.generalAccessLog.deleteMany({ where: { generalId: fixtureId } });
    await db.general.deleteMany({ where: { id: fixtureId } });
    await db.nation.deleteMany({ where: { id: { in: [fixtureId, foreignNationId] } } });
    await db.worldState.deleteMany({ where: { scenarioCode: 'diplomacy-html' } });
};

integration('diplomacy HTML purification over PostgreSQL and HTTP transport', () => {
    beforeAll(async () => {
        uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-diplomacy-html-http-'));
        process.env.PROFILE = profileId;
        process.env.SCENARIO = 'diplomacy-html';
        process.env.GAME_PROFILE_NAME = profileName;
        process.env.GAME_API_HOST = '127.0.0.1';
        process.env.GAME_API_PORT = '0';
        process.env.GAME_TOKEN_SECRET = secret;
        process.env.GATEWAY_REDIS_PREFIX = redisPrefix;
        process.env.GAME_UPLOAD_DIR = uploadDir;
        process.env.DATABASE_URL = databaseUrl;

        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        disconnectDb = () => connector.disconnect();
        await cleanup();

        await db.worldState.create({
            data: {
                scenarioCode: 'diplomacy-html',
                currentYear: 200,
                currentMonth: 1,
                tickSeconds: 600,
                meta: {},
            },
        });
        await db.nation.createMany({
            data: [
                { id: fixtureId, name: '정화국', color: '#00ffff' },
                { id: foreignNationId, name: '상대국', color: '#ff0000' },
            ],
        });
        await db.general.create({
            data: {
                id: fixtureId,
                userId,
                name: '정화외교관',
                nationId: fixtureId,
                officerLevel: 12,
                turnTime: new Date('2026-07-31T00:00:00.000Z'),
            },
        });
        const legacyLetter = await db.diplomacyLetter.create({
            data: {
                srcNationId: fixtureId,
                destNationId: foreignNationId,
                state: 'PROPOSED',
                textBrief: '<p>과거 공개</p><img src=x onerror="globalThis.__legacyBriefXss=1">',
                textDetail: '<strong>과거 기밀</strong><script>globalThis.__legacyDetailXss=1</script>',
                srcSignerId: fixtureId,
                aux: {
                    src: { nationName: '정화국', nationColor: '#00ffff', generalId: fixtureId },
                    dest: { nationName: '상대국', nationColor: '#ff0000' },
                },
            },
        });
        legacyLetterId = legacyLetter.id;

        redis = createRedisConnector(resolveRedisConfigFromEnv());
        await redis.connect();
        const store = new RedisAccessTokenStore(redis.client, profileName);
        const payload: GameSessionTokenPayload = {
            version: 1,
            profile: profileName,
            issuedAt: new Date(Date.now() - 1_000).toISOString(),
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            sessionId: `diplomacy-html-session-${process.pid}`,
            user: {
                id: userId,
                username: 'diplomacy-html-user',
                displayName: 'Diplomacy HTML User',
                roles: ['user'],
                createdAt: '2026-07-31T00:00:00.000Z',
            },
            sanctions: {},
        };
        const created = await store.create(payload);
        if (!created) throw new Error('failed to seed diplomacy HTML access token');
        accessToken = created.accessToken;

        server = await createGameApiServer();
        baseUrl = await server.app.listen({ host: server.config.host, port: server.config.port });
    }, 30_000);

    afterAll(async () => {
        await server?.app.close();
        if (db) await cleanup();
        await disconnectDb?.();
        await deleteProfileRedisKeys();
        await redis?.disconnect();
        if (uploadDir) await fs.rm(uploadDir, { recursive: true, force: true });
        restoreEnv();
    }, 30_000);

    it('purifies contaminated stored rows before HTTP serialization', async () => {
        const response = await fetch(`${baseUrl}/trpc/diplomacy.getLetters`, {
            headers: { authorization: `Bearer ${accessToken}` },
        });
        const body = (await response.json()) as {
            result?: { data?: { letters?: Array<{ id: number; brief: string; detail: string }> } };
        };

        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(body.result?.data?.letters?.find(({ id }) => id === legacyLetterId)).toMatchObject({
            brief: '<p>과거 공개</p><img src="x" />',
            detail: '<strong>과거 기밀</strong>',
        });
        expect(JSON.stringify(body)).not.toMatch(/onerror|<script|__legacy/i);
    });

    it('persists only canonical editor HTML through the HTTP mutation', async () => {
        const response = await fetch(`${baseUrl}/trpc/diplomacy.sendLetter`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${accessToken}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                destNationId: foreignNationId,
                brief: '<p><u>신규 공개</u></p><img src="javascript:alert(1)" onerror="alert(2)">',
                detail: '<ol><li>조건</li></ol><a href="https://example.com" target="_blank">자료</a>',
            }),
        });
        const body = (await response.json()) as { result?: { data?: { id?: number } } };

        expect(response.status, JSON.stringify(body)).toBe(200);
        const createdId = body.result?.data?.id;
        expect(createdId).toBeTypeOf('number');
        const stored = await db.diplomacyLetter.findUniqueOrThrow({ where: { id: createdId } });
        expect(stored.textBrief).toBe('<p><u>신규 공개</u></p>');
        expect(stored.textDetail).toBe(
            '<ol><li>조건</li></ol><a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">자료</a>'
        );
    });
});
