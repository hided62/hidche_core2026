import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { seedScenarioToDatabase } from '@sammo-ts/game-engine';
import {
    createGamePostgresConnector,
    createRedisConnector,
    type GamePrisma,
    type GamePrismaClient,
} from '@sammo-ts/infra';

import { canonicalJson, isPrivateTargetHost, sha256, type LoadConfig } from './config.js';

const execFileAsync = promisify(execFile);
const FIXED_NOW = new Date('2026-08-16T00:00:00.000Z');
const SCENARIO_ID = 2601;

type FixtureEnvironment = { databaseUrl: string; redisUrl: string };

const requireEnvironment = (env: NodeJS.ProcessEnv): FixtureEnvironment => {
    const databaseUrl = env.LOAD_TEST_DATABASE_URL;
    const redisUrl = env.LOAD_TEST_REDIS_URL;
    if (!databaseUrl || !redisUrl) {
        throw new Error('LOAD_TEST_DATABASE_URL and LOAD_TEST_REDIS_URL are required');
    }
    return { databaseUrl, redisUrl };
};

const assertPrivateUrl = (value: string, protocols: readonly string[], label: string): URL => {
    const parsed = new URL(value);
    if (!protocols.includes(parsed.protocol)) throw new Error(`${label} uses an unsupported protocol`);
    if (!isPrivateTargetHost(parsed.hostname)) throw new Error(`${label} must use a loopback or private/internal host`);
    return parsed;
};

export const assertFixtureIsolation = (config: LoadConfig, env: FixtureEnvironment): void => {
    const database = assertPrivateUrl(env.databaseUrl, ['postgres:', 'postgresql:'], 'LOAD_TEST_DATABASE_URL');
    if (database.searchParams.get('schema') !== config.isolation.postgresSchema) {
        throw new Error('LOAD_TEST_DATABASE_URL schema must exactly match isolation.postgresSchema');
    }
    const redis = assertPrivateUrl(env.redisUrl, ['redis:', 'rediss:'], 'LOAD_TEST_REDIS_URL');
    const redisDatabase = Number(redis.pathname.replace(/^\//u, '') || '0');
    if (redisDatabase !== config.isolation.redisDatabase) {
        throw new Error('LOAD_TEST_REDIS_URL database must exactly match isolation.redisDatabase');
    }
};

const accessKeyPrefix = (config: LoadConfig): string => `sammo:game:access:${config.isolation.profileName}:`;
const manifestKey = (config: LoadConfig): string => `${config.isolation.redisPrefix}fixture-manifest`;

const deleteMatchingRedisKeys = async (
    client: ReturnType<typeof createRedisConnector>['client'],
    pattern: string
): Promise<number> => {
    let deleted = 0;
    for await (const keys of client.scanIterator({ MATCH: pattern, COUNT: 500 })) {
        if (keys.length === 0) continue;
        deleted += await client.del(keys);
    }
    return deleted;
};

const countMatchingRedisKeys = async (
    client: ReturnType<typeof createRedisConnector>['client'],
    pattern: string
): Promise<number> => {
    let count = 0;
    for await (const keys of client.scanIterator({ MATCH: pattern, COUNT: 500 })) count += keys.length;
    return count;
};

const migrateDedicatedSchema = async (workspaceRoot: string, databaseUrl: string): Promise<void> => {
    await execFileAsync('pnpm', ['--filter', '@sammo-ts/infra', 'prisma:migrate:deploy:game'], {
        cwd: workspaceRoot,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        maxBuffer: 10 * 1024 * 1024,
    });
};

type GeneralRow = Awaited<ReturnType<GamePrismaClient['general']['findMany']>>[number];

const cloneGeneral = (
    source: GeneralRow,
    input: { id: number; userId: string | null; npcState: number }
): GamePrisma.GeneralCreateManyInput =>
    ({
        ...source,
        id: input.id,
        name: `${source.name}#L${input.id}`,
        userId: input.userId,
        npcState: input.npcState,
        turnTime: new Date(source.turnTime),
        recentWarTime: source.recentWarTime ? new Date(source.recentWarTime) : null,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        meta: source.meta as GamePrisma.InputJsonValue,
        lastTurn: source.lastTurn as GamePrisma.InputJsonValue,
        penalty: source.penalty as GamePrisma.InputJsonValue,
    }) satisfies GamePrisma.GeneralCreateManyInput;

const projectFixtureState = async (db: GamePrismaClient) => {
    const [world, generals, cities, nations] = await Promise.all([
        db.worldState.findFirst({
            select: {
                scenarioCode: true,
                currentYear: true,
                currentMonth: true,
                tickSeconds: true,
                config: true,
                meta: true,
            },
        }),
        db.general.findMany({
            orderBy: { id: 'asc' },
            select: {
                id: true,
                userId: true,
                name: true,
                nationId: true,
                cityId: true,
                npcState: true,
                leadership: true,
                strength: true,
                intel: true,
                officerLevel: true,
                turnTime: true,
                meta: true,
            },
        }),
        db.city.findMany({ orderBy: { id: 'asc' }, select: { id: true, nationId: true, level: true, meta: true } }),
        db.nation.findMany({ orderBy: { id: 'asc' }, select: { id: true, level: true, meta: true } }),
    ]);
    return { world, generals, cities, nations };
};

const resizeSeededGenerals = async (db: GamePrismaClient, config: LoadConfig): Promise<void> => {
    const source = await db.general.findMany({ orderBy: { id: 'asc' } });
    if (source.length === 0) throw new Error('scenario seed produced no generals');
    const expectedNpc = config.capacity.npcGenerals;
    const expectedHuman = config.capacity.humanGenerals;
    if (expectedHuman !== config.capacity.authenticatedViewers) {
        throw new Error('fixture requires one human general per authenticated viewer');
    }
    await db.$transaction(async (transaction) => {
        await transaction.general.deleteMany();
        const rows: GamePrisma.GeneralCreateManyInput[] = [];
        for (let index = 0; index < expectedNpc; index += 1) {
            rows.push(cloneGeneral(source[index % source.length]!, { id: index + 1, userId: null, npcState: 2 }));
        }
        for (let index = 0; index < expectedHuman; index += 1) {
            rows.push(
                cloneGeneral(source[(expectedNpc + index) % source.length]!, {
                    id: expectedNpc + index + 1,
                    userId: `load-user-${String(index + 1).padStart(4, '0')}`,
                    npcState: 0,
                })
            );
        }
        await transaction.general.createMany({ data: rows });
        const world = await transaction.worldState.findFirstOrThrow({ select: { id: true, meta: true, config: true } });
        await transaction.worldState.update({
            where: { id: world.id },
            data: {
                tickSeconds: Math.trunc(config.capacity.turnIntervalMs / 1_000),
                meta: { ...(world.meta as Record<string, unknown>), lastGeneralId: rows.length } as GamePrisma.InputJsonValue,
                config: {
                    ...(world.config as Record<string, unknown>),
                    maxUserCnt: expectedHuman,
                    turnTermMinutes: config.capacity.turnIntervalMs / 60_000,
                } as GamePrisma.InputJsonValue,
            },
        });
    });
};

const assertNewTokenPath = async (tokenPath: string, workspaceRoot: string): Promise<string> => {
    const secretRoot = await realpath(path.join(workspaceRoot, 'tools/load-tests/secrets'));
    const output = path.resolve(tokenPath);
    const relative = path.relative(secretRoot, output);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(output) !== '.json') {
        throw new Error('seed token output must be a new JSON file inside tools/load-tests/secrets');
    }
    await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    const parent = await realpath(path.dirname(output));
    if (parent !== secretRoot) throw new Error('seed token output must not traverse a symbolic-link directory');
    try {
        await lstat(output);
        throw new Error('seed token output already exists');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return output;
};

const writeTokens = async (tokenPath: string, tokens: readonly string[]): Promise<void> => {
    const handle = await open(tokenPath, 'wx', 0o600);
    try {
        await handle.writeFile(`${JSON.stringify({ tokens })}\n`, { encoding: 'utf8' });
    } finally {
        await handle.close();
    }
};

export const seedCapacityFixture = async (options: {
    config: LoadConfig;
    tokenPath: string;
    workspaceRoot: string;
    env?: NodeJS.ProcessEnv;
}) => {
    const environment = requireEnvironment(options.env ?? process.env);
    assertFixtureIsolation(options.config, environment);
    const tokenPath = await assertNewTokenPath(options.tokenPath, options.workspaceRoot);
    await migrateDedicatedSchema(options.workspaceRoot, environment.databaseUrl);

    const previousSeed = process.env.INTEGRATION_WORLD_SEED;
    process.env.INTEGRATION_WORLD_SEED = `load-capacity-${options.config.name}-v1`;
    try {
        await seedScenarioToDatabase({
            scenarioId: SCENARIO_ID,
            databaseUrl: environment.databaseUrl,
            now: FIXED_NOW,
            gameClockMode: 'manual',
            installOptions: {
                turnTermMinutes: options.config.capacity.turnIntervalMs / 60_000,
                npcMode: 2,
                tournamentTrig: false,
                serverId: `load-${options.config.name}`,
            },
        });
    } finally {
        if (previousSeed === undefined) delete process.env.INTEGRATION_WORLD_SEED;
        else process.env.INTEGRATION_WORLD_SEED = previousSeed;
    }

    const postgres = createGamePostgresConnector({ url: environment.databaseUrl });
    const redis = createRedisConnector({ url: environment.redisUrl });
    await postgres.connect();
    try {
        await resizeSeededGenerals(postgres.prisma, options.config);
        const state = await projectFixtureState(postgres.prisma);
        const fixtureSha256 = `sha256:${sha256(canonicalJson(state))}`;
        await redis.connect();
        try {
            await deleteMatchingRedisKeys(redis.client, `${accessKeyPrefix(options.config)}ga_*`);
            const issuedAt = new Date().toISOString();
            const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
            const tokens = Array.from({ length: options.config.capacity.authenticatedViewers }, () =>
                `ga_${randomUUID()}`
            );
            await Promise.all(
                tokens.map((token, index) => {
                    const userNo = String(index + 1).padStart(4, '0');
                    return redis.client.set(
                        `${accessKeyPrefix(options.config)}${token}`,
                        JSON.stringify({
                            version: 1,
                            profile: options.config.isolation.profileName,
                            issuedAt,
                            expiresAt,
                            sessionId: `load-session-${userNo}`,
                            user: {
                                id: `load-user-${userNo}`,
                                username: `load_user_${userNo}`,
                                displayName: `부하장수${userNo}`,
                                roles: [],
                            },
                            sanctions: {},
                            identity: {
                                kakaoVerified: true,
                                canCreateGeneral: false,
                                requiresKakaoVerification: false,
                                graceEndsAt: null,
                            },
                        }),
                        { EX: 24 * 60 * 60 }
                    );
                })
            );
            await redis.client.set(
                manifestKey(options.config),
                JSON.stringify({
                    schema: options.config.isolation.postgresSchema,
                    profile: options.config.isolation.profileName,
                    fixtureSha256,
                    viewers: options.config.capacity.authenticatedViewers,
                }),
                { EX: 48 * 60 * 60 }
            );
            await writeTokens(tokenPath, tokens);
            return {
                seeded: true,
                fixtureSha256,
                generals: state.generals.length,
                npcGenerals: state.generals.filter((general) => general.npcState >= 2).length,
                humanGenerals: state.generals.filter((general) => general.npcState === 0 && general.userId).length,
                tokensWritten: tokens.length,
            };
        } finally {
            await redis.disconnect();
        }
    } finally {
        await postgres.disconnect();
    }
};

export const verifyCapacityFixture = async (config: LoadConfig, env: NodeJS.ProcessEnv = process.env) => {
    const environment = requireEnvironment(env);
    assertFixtureIsolation(config, environment);
    const postgres = createGamePostgresConnector({ url: environment.databaseUrl });
    const redis = createRedisConnector({ url: environment.redisUrl });
    await postgres.connect();
    try {
        const state = await projectFixtureState(postgres.prisma);
        const fixtureSha256 = `sha256:${sha256(canonicalJson(state))}`;
        await redis.connect();
        try {
            const rawManifest = await redis.client.get(manifestKey(config));
            let manifestFixtureSha256: string | null = null;
            if (rawManifest) {
                try {
                    const parsed = JSON.parse(rawManifest) as Record<string, unknown>;
                    manifestFixtureSha256 =
                        typeof parsed.fixtureSha256 === 'string' ? parsed.fixtureSha256 : null;
                } catch {
                    manifestFixtureSha256 = null;
                }
            }
            const accessTokens = await countMatchingRedisKeys(redis.client, `${accessKeyPrefix(config)}ga_*`);
            const npcGenerals = state.generals.filter((general) => general.npcState >= 2).length;
            const humanGenerals = state.generals.filter(
                (general) => general.npcState === 0 && general.userId
            ).length;
            const valid =
                state.generals.length === config.capacity.npcGenerals + config.capacity.humanGenerals &&
                npcGenerals === config.capacity.npcGenerals &&
                humanGenerals === config.capacity.humanGenerals &&
                accessTokens === config.capacity.authenticatedViewers &&
                manifestFixtureSha256 === fixtureSha256;
            return {
                valid,
                fixtureSha256,
                generals: state.generals.length,
                npcGenerals,
                humanGenerals,
                accessTokens,
                redisManifestPresent: rawManifest !== null,
                redisManifestMatches: manifestFixtureSha256 === fixtureSha256,
            };
        } finally {
            await redis.disconnect();
        }
    } finally {
        await postgres.disconnect();
    }
};

export const cleanupCapacityFixture = async (
    config: LoadConfig,
    confirmation: string,
    env: NodeJS.ProcessEnv = process.env
) => {
    if (confirmation !== config.isolation.postgresSchema) {
        throw new Error('cleanup confirmation must exactly equal isolation.postgresSchema');
    }
    const environment = requireEnvironment(env);
    assertFixtureIsolation(config, environment);
    const redis = createRedisConnector({ url: environment.redisUrl });
    await redis.connect();
    try {
        if (!(await redis.client.get(manifestKey(config)))) {
            throw new Error('refusing cleanup because the dedicated fixture manifest is absent');
        }
        const postgres = createGamePostgresConnector({ url: environment.databaseUrl });
        await postgres.connect();
        try {
            await postgres.prisma.$executeRawUnsafe(`DROP SCHEMA "${config.isolation.postgresSchema}" CASCADE`);
        } finally {
            await postgres.disconnect();
        }
        const accessTokensDeleted = await deleteMatchingRedisKeys(redis.client, `${accessKeyPrefix(config)}ga_*`);
        await redis.client.del(manifestKey(config));
        return { cleaned: true, schemaDropped: true, accessTokensDeleted };
    } finally {
        await redis.disconnect();
    }
};
