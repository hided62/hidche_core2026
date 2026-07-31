import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
import {
    createGamePostgresConnector,
    createRedisConnector,
    resolveRedisConfigFromEnv,
    type GamePrismaClient,
    type RedisConnector,
} from '@sammo-ts/infra';

import { RedisAccessTokenStore } from '../src/auth/accessTokenStore.js';
import { createGameApiServer } from '../src/server.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl || !process.env.REDIS_URL);
const profileId = process.env.POSTGRES_SCHEMA ?? 'conditional_integration';
const profileName = `che:nation-html-${process.pid}`;
const userId = `nation-html-user-${process.pid}`;
const fixtureId = 900_000 + (process.pid % 50_000);
const secret = 'nation-html-http-secret';
const redisPrefix = `sammo:nation-html:${process.pid}`;
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

const restoreEnv = (): void => {
    for (const [key, value] of originalEnv) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
};

integration('nation HTML purification over HTTP transport', () => {
    beforeAll(async () => {
        uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-nation-html-http-'));
        process.env.PROFILE = profileId;
        process.env.SCENARIO = 'nation-html';
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

        await db.general.deleteMany({ where: { id: fixtureId } });
        await db.nation.deleteMany({ where: { id: fixtureId } });
        await db.worldState.deleteMany({ where: { id: fixtureId } });
        await db.worldState.create({
            data: {
                id: fixtureId,
                scenarioCode: 'nation-html',
                currentYear: 200,
                currentMonth: 1,
                tickSeconds: 600,
                meta: {
                    lastTurnTime: '2026-07-31T00:00:00.000Z',
                },
            },
        });
        await db.nation.create({
            data: {
                id: fixtureId,
                name: '정화국',
                color: '#00ffff',
                meta: {
                    notice: [
                        '<p data-flip="horizontal" style="color:#00ffff">안전한 방침</p>',
                        '<img src="/image/icons/default.jpg" onerror="globalThis.__nationXss=1">',
                        '<script>globalThis.__nationXss=2</script>',
                        '<iframe src="https://attacker.example/embed/1"></iframe>',
                    ].join(''),
                    infoText: '<strong>임관 권유</strong><svg onload="globalThis.__nationScoutXss=1"></svg>',
                },
            },
        });
        await db.general.create({
            data: {
                id: fixtureId,
                userId,
                name: '정화담당',
                nationId: fixtureId,
                turnTime: new Date('2026-07-31T00:00:00.000Z'),
            },
        });

        redis = createRedisConnector(resolveRedisConfigFromEnv());
        await redis.connect();
        const store = new RedisAccessTokenStore(redis.client, profileName);
        const payload: GameSessionTokenPayload = {
            version: 1,
            profile: profileName,
            issuedAt: new Date(Date.now() - 1_000).toISOString(),
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
            sessionId: `nation-html-session-${process.pid}`,
            user: {
                id: userId,
                username: 'nation-html-user',
                displayName: 'Nation HTML User',
                roles: ['user'],
                createdAt: '2026-07-31T00:00:00.000Z',
            },
            sanctions: {},
        };
        const created = await store.create(payload);
        if (!created) {
            throw new Error('failed to seed nation HTML access token');
        }
        accessToken = created.accessToken;

        server = await createGameApiServer();
        baseUrl = await server.app.listen({ host: server.config.host, port: server.config.port });
    }, 30_000);

    afterAll(async () => {
        await server?.app.close();
        await db?.general.deleteMany({ where: { id: fixtureId } });
        await db?.nation.deleteMany({ where: { id: fixtureId } });
        await db?.worldState.deleteMany({ where: { id: fixtureId } });
        await disconnectDb?.();
        await redis?.disconnect();
        if (uploadDir) {
            await fs.rm(uploadDir, { recursive: true, force: true });
        }
        restoreEnv();
    }, 30_000);

    it('removes pre-existing executable nation notice markup before serialization', async () => {
        const response = await fetch(`${baseUrl}/trpc/general.getFrontStatus`, {
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
        });
        const body = (await response.json()) as {
            result?: {
                data?: {
                    nationNotice?: string;
                };
            };
        };

        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(body.result?.data?.nationNotice).toBe(
            '<p data-flip="horizontal" style="color:#00ffff">안전한 방침</p><img src="/image/icons/default.jpg" alt="default.jpg" /><iframe></iframe>'
        );
    });

    it('removes executable stored recruitment markup from join configuration serialization', async () => {
        const response = await fetch(`${baseUrl}/trpc/join.getConfig`, {
            headers: {
                authorization: `Bearer ${accessToken}`,
            },
        });
        const body = (await response.json()) as {
            result?: {
                data?: {
                    nations?: Array<{
                        id: number;
                        scoutMessage: string | null;
                    }>;
                };
            };
        };

        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(body.result?.data?.nations?.find(({ id }) => id === fixtureId)?.scoutMessage).toBe(
            '<strong>임관 권유</strong>'
        );
    });
});
