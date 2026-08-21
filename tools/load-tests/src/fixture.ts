import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { seedScenarioToDatabase } from '@sammo-ts/game-engine';
import {
    activateReadModelRevisionCoverage,
    createGamePostgresConnector,
    createRedisConnector,
    GamePrisma,
    type GamePrismaClient,
} from '@sammo-ts/infra';

import { canonicalJson, isPrivateTargetHost, sha256, type LoadConfig } from './config.js';

const execFileAsync = promisify(execFile);
const FIXED_NOW = new Date('2026-08-16T00:00:00.000Z');
const SCENARIO_ID = 2601;

type FixtureEnvironment = { databaseUrl: string; redisUrl: string };

const assertNewSecretPath = async (secretPath: string, workspaceRoot: string): Promise<string> => {
    const secretRoot = await realpath(path.join(workspaceRoot, 'tools/load-tests/secrets'));
    const output = path.resolve(secretPath);
    const relative = path.relative(secretRoot, output);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('generated secret files must stay inside tools/load-tests/secrets');
    }
    await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    if ((await realpath(path.dirname(output))) !== secretRoot) {
        throw new Error('generated secret files must not traverse a symbolic-link directory');
    }
    try {
        await lstat(output);
        throw new Error('generated secret output already exists');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return output;
};

const writeNewSecret = async (secretPath: string, content: string): Promise<void> => {
    const handle = await open(secretPath, 'wx', 0o600);
    try {
        await handle.writeFile(content, { encoding: 'utf8' });
    } finally {
        await handle.close();
    }
};

export const prepareCapacitySecrets = async (options: {
    config: LoadConfig;
    workspaceRoot: string;
    env?: NodeJS.ProcessEnv;
}) => {
    const env = options.env ?? process.env;
    const postgresPort = Number(env.CAPACITY_POSTGRES_PORT ?? '15442');
    const redisPort = Number(env.CAPACITY_REDIS_PORT ?? '16379');
    if (!Number.isSafeInteger(postgresPort) || postgresPort < 1024 || postgresPort > 65_535) {
        throw new Error('CAPACITY_POSTGRES_PORT must be an unprivileged TCP port');
    }
    if (!Number.isSafeInteger(redisPort) || redisPort < 1024 || redisPort > 65_535) {
        throw new Error('CAPACITY_REDIS_PORT must be an unprivileged TCP port');
    }
    if (postgresPort === redisPort) throw new Error('capacity PostgreSQL and Redis ports must differ');

    const secretRoot = path.join(options.workspaceRoot, 'tools/load-tests/secrets');
    const postgresPasswordPath = await assertNewSecretPath(
        path.join(secretRoot, 'postgres-password.txt'),
        options.workspaceRoot
    );
    const imageSecretPath = await assertNewSecretPath(
        path.join(secretRoot, 'image-upload-secret.txt'),
        options.workspaceRoot
    );
    const capacityEnvPath = await assertNewSecretPath(path.join(secretRoot, 'capacity.env'), options.workspaceRoot);

    const postgresPassword = randomBytes(32).toString('hex');
    const gameTokenSecret = randomBytes(32).toString('hex');
    const imageUploadSecret = randomBytes(32).toString('hex');
    const databaseUrl =
        `postgresql://sammo_capacity:${postgresPassword}@127.0.0.1:${postgresPort}/sammo_capacity` +
        `?schema=${options.config.isolation.postgresSchema}`;
    const redisUrl = `redis://127.0.0.1:${redisPort}/${options.config.isolation.redisDatabase}`;
    const envLines = [
        `CAPACITY_POSTGRES_PORT='${postgresPort}'`,
        `CAPACITY_REDIS_PORT='${redisPort}'`,
        `LOAD_TEST_DATABASE_URL='${databaseUrl}'`,
        `LOAD_TEST_REDIS_URL='${redisUrl}'`,
        `DATABASE_URL='${databaseUrl}'`,
        `REDIS_URL='${redisUrl}'`,
        `GAME_TOKEN_SECRET='${gameTokenSecret}'`,
        `GAME_IMAGE_UPLOAD_SECRET_FILE='${imageSecretPath}'`,
        `PROFILE='${options.config.isolation.postgresSchema}'`,
        `SCENARIO='2601'`,
        `GAME_PROFILE_NAME='${options.config.isolation.profileName}'`,
        `GAME_API_HOST='127.0.0.1'`,
        `GAME_API_PORT='${new URL(options.config.target.baseUrl).port || '80'}'`,
        `GAME_TRPC_PATH='${options.config.target.trpcPath}'`,
        `GAME_API_EVENTS_PATH='${options.config.target.ssePath}'`,
        `CAPACITY_NODE_BINARY='${process.execPath}'`,
        "CAPACITY_CPUSET='0-3'",
        '',
    ].join('\n');

    const created: string[] = [];
    try {
        await writeNewSecret(postgresPasswordPath, `${postgresPassword}\n`);
        created.push(postgresPasswordPath);
        await writeNewSecret(imageSecretPath, `${imageUploadSecret}\n`);
        created.push(imageSecretPath);
        await writeNewSecret(capacityEnvPath, envLines);
        created.push(capacityEnvPath);
    } catch (error) {
        await Promise.all(created.map((file) => unlink(file).catch(() => undefined)));
        throw error;
    }
    return { prepared: true, secretFilesWritten: created.length, mode: '0600' };
};

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

const PRIVILEGED_VIEWER_LEVELS = [12, 10, 8, 6, 11, 9, 7, 5] as const;

export const privilegedViewerPlacement = (index: number, nationId: number, cityId: number) => ({
    nationId,
    cityId,
    officerLevel: PRIVILEGED_VIEWER_LEVELS[index % PRIVILEGED_VIEWER_LEVELS.length]!,
});

const cloneGeneral = (
    source: GeneralRow,
    input: {
        id: number;
        userId: string | null;
        npcState: number;
        nationId?: number;
        cityId?: number;
        officerLevel?: number;
    }
): GamePrisma.GeneralCreateManyInput =>
    ({
        ...source,
        id: input.id,
        name: `${source.name}#L${input.id}`,
        userId: input.userId,
        npcState: input.npcState,
        nationId: input.nationId ?? source.nationId,
        cityId: input.cityId ?? source.cityId,
        officerLevel: input.officerLevel ?? source.officerLevel,
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
    const [source, nations, cities] = await Promise.all([
        db.general.findMany({ orderBy: { id: 'asc' } }),
        db.nation.findMany({ orderBy: { id: 'asc' } }),
        db.city.findMany({ orderBy: { id: 'asc' } }),
    ]);
    if (source.length === 0) throw new Error('scenario seed produced no generals');
    const existingViewerNation = nations.find((nation) => nation.id > 0);
    const viewerCity =
        (existingViewerNation ? cities.find((city) => city.nationId === existingViewerNation.id) : null) ?? cities[0];
    if (!viewerCity) throw new Error('scenario seed produced no city for privileged page load');
    const viewerNationId = existingViewerNation?.id ?? Math.max(...nations.map((nation) => nation.id), 0) + 1;
    const expectedNpc = config.capacity.npcGenerals;
    const expectedHuman = config.capacity.humanGenerals;
    if (expectedHuman !== config.capacity.authenticatedViewers) {
        throw new Error('fixture requires one human general per authenticated viewer');
    }
    await db.$transaction(async (transaction) => {
        await transaction.general.deleteMany();
        if (!existingViewerNation) {
            await transaction.nation.create({
                data: {
                    id: viewerNationId,
                    name: '부하측정국',
                    color: '#334466',
                    capitalCityId: viewerCity.id,
                    gold: 100_000,
                    rice: 100_000,
                    tech: 1_000,
                    level: 1,
                    typeCode: 'che_중립',
                    meta: { cityIds: [viewerCity.id], infoText: null, secretlimit: 3 },
                },
            });
        }
        await transaction.city.update({ where: { id: viewerCity.id }, data: { nationId: viewerNationId } });
        const rows: GamePrisma.GeneralCreateManyInput[] = [];
        for (let index = 0; index < expectedNpc; index += 1) {
            rows.push(cloneGeneral(source[index % source.length]!, { id: index + 1, userId: null, npcState: 2 }));
        }
        for (let index = 0; index < expectedHuman; index += 1) {
            const placement = privilegedViewerPlacement(index, viewerNationId, viewerCity.id);
            rows.push(
                cloneGeneral(source[(expectedNpc + index) % source.length]!, {
                    id: expectedNpc + index + 1,
                    userId: `load-user-${String(index + 1).padStart(4, '0')}`,
                    npcState: 0,
                    ...placement,
                })
            );
        }
        await transaction.general.createMany({ data: rows });
        await transaction.nation.update({
            where: { id: viewerNationId },
            data: { chiefGeneralId: expectedNpc + 1 },
        });
        const world = await transaction.worldState.findFirstOrThrow({ select: { id: true, meta: true, config: true } });
        await transaction.worldState.update({
            where: { id: world.id },
            data: {
                tickSeconds: Math.trunc(config.capacity.turnIntervalMs / 1_000),
                meta: {
                    ...(world.meta as Record<string, unknown>),
                    lastGeneralId: rows.length,
                } as GamePrisma.InputJsonValue,
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
    const output = await assertNewSecretPath(tokenPath, workspaceRoot);
    if (path.extname(output) !== '.json') {
        throw new Error('seed token output must be a new JSON file inside tools/load-tests/secrets');
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
            const tokens = Array.from(
                { length: options.config.capacity.authenticatedViewers },
                () => `ga_${randomUUID()}`
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
        const [state, postgresRows, revisionMeta, revisionHeads, pendingOutbox] = await Promise.all([
            projectFixtureState(postgres.prisma),
            postgres.prisma.$queryRaw<Array<{ version: string }>>(GamePrisma.sql`SELECT version()`),
            postgres.prisma.readModelRevisionMeta.findUnique({ where: { id: 1 } }),
            postgres.prisma.readModelRevision.findMany({
                where: { domain: { in: ['dashboard.global', 'map.world'] }, entityId: 0 },
                orderBy: { domain: 'asc' },
                select: { domain: true, revision: true },
            }),
            postgres.prisma.readModelOutbox.count({ where: { deliveredAt: null } }),
        ]);
        const fixtureSha256 = `sha256:${sha256(canonicalJson(state))}`;
        await redis.connect();
        try {
            const rawManifest = await redis.client.get(manifestKey(config));
            let manifestFixtureSha256: string | null = null;
            if (rawManifest) {
                try {
                    const parsed = JSON.parse(rawManifest) as Record<string, unknown>;
                    manifestFixtureSha256 = typeof parsed.fixtureSha256 === 'string' ? parsed.fixtureSha256 : null;
                } catch {
                    manifestFixtureSha256 = null;
                }
            }
            const accessTokens = await countMatchingRedisKeys(redis.client, `${accessKeyPrefix(config)}ga_*`);
            const redisInfo = await redis.client.info('server');
            const redisVersion = /^redis_version:(.+)$/mu.exec(redisInfo)?.[1]?.trim() ?? 'unknown';
            const npcGenerals = state.generals.filter((general) => general.npcState >= 2).length;
            const humanGenerals = state.generals.filter((general) => general.npcState === 0 && general.userId).length;
            const privilegedHumanGenerals = state.generals.filter(
                (general) =>
                    general.npcState === 0 && general.userId && general.nationId > 0 && general.officerLevel >= 5
            );
            const viewerNationIds = [...new Set(privilegedHumanGenerals.map((general) => general.nationId))];
            const valid =
                state.generals.length === config.capacity.npcGenerals + config.capacity.humanGenerals &&
                npcGenerals === config.capacity.npcGenerals &&
                humanGenerals === config.capacity.humanGenerals &&
                privilegedHumanGenerals.length === config.capacity.humanGenerals &&
                viewerNationIds.length === 1 &&
                accessTokens === config.capacity.authenticatedViewers &&
                manifestFixtureSha256 === fixtureSha256;
            return {
                valid,
                fixtureSha256,
                generals: state.generals.length,
                npcGenerals,
                humanGenerals,
                privilegedHumanGenerals: privilegedHumanGenerals.length,
                viewerNations: viewerNationIds.length,
                accessTokens,
                redisManifestPresent: rawManifest !== null,
                redisManifestMatches: manifestFixtureSha256 === fixtureSha256,
                postgresVersion: postgresRows[0]?.version ?? 'unknown',
                redisVersion,
                coverageVersion: revisionMeta?.coverageVersion ?? null,
                revisionHeads: revisionHeads.map((head) => ({
                    domain: head.domain,
                    revision: head.revision.toString(),
                })),
                pendingOutbox,
            };
        } finally {
            await redis.disconnect();
        }
    } finally {
        await postgres.disconnect();
    }
};

export const activateCapacityCoverage = async (
    config: LoadConfig,
    confirmation: string,
    env: NodeJS.ProcessEnv = process.env
) => {
    if (confirmation !== config.isolation.postgresSchema) {
        throw new Error('coverage activation confirmation must exactly equal isolation.postgresSchema');
    }
    const environment = requireEnvironment(env);
    assertFixtureIsolation(config, environment);
    const fixture = await verifyCapacityFixture(config, env);
    if (!fixture.valid) {
        throw new Error('fixture verification failed; refusing coverage activation');
    }
    const postgres = createGamePostgresConnector({ url: environment.databaseUrl });
    await postgres.connect();
    try {
        const result = await postgres.prisma.$transaction((transaction) =>
            activateReadModelRevisionCoverage(transaction, 0)
        );
        return { activated: true, ...result };
    } finally {
        await postgres.disconnect();
    }
};

export const materializeCalibrationConfig = async (options: {
    config: LoadConfig;
    outputPath: string;
    workspaceRoot: string;
    env?: NodeJS.ProcessEnv;
}) => {
    const env = options.env ?? process.env;
    const output = path.resolve(options.outputPath);
    const resultsRoot = await realpath(path.join(options.workspaceRoot, 'tools/load-tests/results'));
    const relative = path.relative(resultsRoot, output);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(output) !== '.json') {
        throw new Error('calibration config output must be a new JSON file inside tools/load-tests/results');
    }
    try {
        await lstat(output);
        throw new Error('calibration config output already exists');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const verified = await verifyCapacityFixture(options.config, env);
    if (!verified.valid) throw new Error('fixture verification failed; refusing to materialize calibration config');
    const gitCommit = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: options.workspaceRoot })).stdout.trim();
    const runtimeConfig: LoadConfig = {
        ...options.config,
        name: `${options.config.name}-calibration`,
        runtimeMetadata: {
            fixtureSha256: verified.fixtureSha256,
            imageDigest: env.LOAD_TEST_IMAGE_DIGEST ?? `source-tree:${gitCommit}:dirty`,
            postgresVersion: verified.postgresVersion,
            redisVersion: verified.redisVersion,
        },
        phases: options.config.phases.map((phase) => ({
            ...phase,
            name: phase.name.replace(/-(?:5|10|30)m$/u, '-calibration'),
            durationMs: phase.kind === 'idle' ? 5_000 : 10_000,
        })),
    };
    await writeNewSecret(output, `${JSON.stringify(runtimeConfig, null, 2)}\n`);
    return {
        materialized: true,
        fixtureSha256: verified.fixtureSha256,
        phaseDurationMs: runtimeConfig.phases.map((phase) => phase.durationMs),
        runtimeKind: env.LOAD_TEST_IMAGE_DIGEST ? 'image' : 'dirty-source-tree',
    };
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
