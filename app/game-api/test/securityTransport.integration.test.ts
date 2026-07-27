import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { encryptGameSessionToken, type GameSessionTokenPayload } from '@sammo-ts/common/auth/gameToken';
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
const integration = describe.skipIf(!databaseUrl || !process.env.REDIS_HOST || !process.env.REDIS_PORT);
const profileId = process.env.POSTGRES_SCHEMA ?? 'conditional_integration';
const profileName = `che:security-http-${process.pid}`;
const userId = `security-http-user-${process.pid}`;
const generalId = 990_001;
const secret = 'security-http-e2e-secret';
const redisPrefix = `sammo:security-http:${process.pid}`;
const envKeys = [
    'PROFILE',
    'SCENARIO',
    'GAME_PROFILE_NAME',
    'GAME_API_HOST',
    'GAME_API_PORT',
    'GAME_TOKEN_SECRET',
    'GATEWAY_REDIS_PREFIX',
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

const restoreEnv = (): void => {
    for (const [key, value] of originalEnv) {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }
};

const buildPayload = (suffix: string, sanctions: GameSessionTokenPayload['sanctions']): GameSessionTokenPayload => ({
    version: 1,
    profile: profileName,
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    sessionId: `security-http-session-${process.pid}-${suffix}`,
    user: {
        id: userId,
        username: 'security-http-user',
        displayName: 'Security HTTP User',
        roles: ['user'],
        createdAt: '2026-07-26T00:00:00.000Z',
    },
    sanctions,
});

const createAccessToken = async (suffix: string, sanctions: GameSessionTokenPayload['sanctions']): Promise<string> => {
    const created = await accessTokenStore.create(buildPayload(suffix, sanctions));
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
    } = {}
): Promise<{ response: Response; body: unknown }> => {
    const method = options.method ?? 'GET';
    const response = await fetch(`${baseUrl}/trpc/${procedure}`, {
        method,
        headers: {
            ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
            ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
        },
        ...(method === 'POST' ? { body: JSON.stringify(options.input) } : {}),
    });
    return {
        response,
        body: (await response.json()) as unknown,
    };
};

integration('game API security over HTTP transport', () => {
    beforeAll(async () => {
        uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-game-security-http-'));
        process.env.PROFILE = profileId;
        process.env.SCENARIO = 'security-http';
        process.env.GAME_PROFILE_NAME = profileName;
        process.env.GAME_API_HOST = '127.0.0.1';
        process.env.GAME_API_PORT = '0';
        process.env.GAME_TOKEN_SECRET = secret;
        process.env.GATEWAY_REDIS_PREFIX = redisPrefix;
        process.env.GAME_UPLOAD_DIR = uploadDir;

        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        disconnectDb = () => connector.disconnect();
        await db.general.deleteMany({ where: { id: generalId } });
        await db.general.create({
            data: {
                id: generalId,
                userId,
                name: '보안HTTP',
                turnTime: new Date('2026-07-26T00:00:00.000Z'),
            },
        });

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
        await db?.general.deleteMany({ where: { id: generalId } });
        await disconnectDb?.();
        await redis?.disconnect();
        if (uploadDir) {
            await fs.rm(uploadDir, { recursive: true, force: true });
        }
        restoreEnv();
    }, 30_000);

    it.each([
        {
            label: 'global suspension',
            sanctions: { suspendedUntil: '2099-01-01T00:00:00.000Z' },
        },
        {
            label: 'instance game restriction',
            sanctions: {
                serverRestrictions: {
                    [profileName]: {
                        blockedFeatures: ['game'],
                    },
                },
            },
        },
        {
            label: 'profile-id wildcard restriction',
            sanctions: {
                serverRestrictions: {
                    [profileId]: {
                        blockedFeatures: ['*'],
                    },
                },
            },
        },
    ])('blocks an authenticated game API request for $label', async ({ label, sanctions }) => {
        const accessToken = await createAccessToken(label.replaceAll(' ', '-'), sanctions);
        const blocked = await requestTrpc('general.me', { accessToken });

        expect(blocked.response.status).toBe(403);
        expect(blocked.body).toMatchObject({
            error: {
                data: {
                    code: 'FORBIDDEN',
                },
            },
        });
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

        const message = await requestTrpc('messages.send', {
            method: 'POST',
            input: {
                generalId,
                mailbox: 0,
                text: '차단되어야 하는 메시지',
            },
            accessToken,
        });
        expect(message.response.status).toBe(403);
        expect(message.body).toMatchObject({
            error: {
                data: {
                    code: 'FORBIDDEN',
                },
            },
        });
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
    });

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
