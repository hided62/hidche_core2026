/// <reference lib="dom" />

import { constants, publicEncrypt, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter as GatewayAppRouter } from '@sammo-ts/gateway-api';
import type { AppRouter as GameAppRouter } from '@sammo-ts/game-api';
import { createGamePostgresConnector, createRedisConnector, type GamePrisma } from '@sammo-ts/infra';
import { createTurnDaemonRuntime } from '../../../app/game-engine/src/turn/turnDaemon.js';

const gatewayUrl = process.env.SAMMO_LIVE_GATEWAY_URL ?? 'http://caddy/gateway/api/trpc';
const webOrigin = process.env.SAMMO_LIVE_WEB_ORIGIN ?? 'http://caddy';
const profileName = process.env.SAMMO_LIVE_PROFILE ?? 'hwe:default';
const sourceRef = process.env.SAMMO_LIVE_SOURCE_REF ?? 'test/game-clock-reconciliation-20260903';
const artifactDir = path.resolve(
    process.env.SAMMO_LIVE_ARTIFACT_DIR ??
        path.resolve(import.meta.dirname, '../../../test-results/live-ten-user-lifecycle-20260903')
);
const statePath = path.join(artifactDir, 'state.json');

type State = {
    runId: string;
    requestedAt: string;
    preopenAt: string;
    openAt: string;
    resetOperationId: string;
    deployOperationId?: string;
    users?: Array<{
        username: string;
        displayName: string;
        gatewayToken: string;
        gameToken: string;
        generalName: string;
    }>;
    preopenMessages?: Array<{ index: number; text: string; wallSentAt: string; wallObservedAt: string }>;
    verifiedPreopenMessages?: Array<{ index: number; text: string; wallSentAt: string; wallObservedAt: string }>;
    pausedBettingId?: number;
    actionFixture?: {
        nations: Array<{ id: number; name: string; capitalCityId: number }>;
        generals: Array<{
            index: number;
            id: number;
            nationId: number;
            cityId: number;
            officerLevel: number;
        }>;
    };
    pausedWallExpiryMessage?: {
        generalIndex: number;
        messageId: number;
        createdAtWall: string;
        frozenGameTick: string;
    };
    actionableMessages?: { recruitmentId: number; noAggressionId: number };
    cancelNoAggressionMessageId?: number;
    pausedTournamentBet?: {
        bettorGeneralId: number;
        targetGeneralId: number;
        preparedGameTick: string;
    };
};

const log = (event: string, detail: Record<string, unknown> = {}): void => {
    process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...detail })}\n`);
};

const requiredEnv = (name: string): string => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
};

const createGateway = (session: { token?: string }) =>
    createTRPCProxyClient<GatewayAppRouter>({
        links: [
            httpBatchLink({
                url: gatewayUrl,
                headers: () => (session.token ? { 'x-session-token': session.token } : {}),
            }),
        ],
    });

const createGame = (token?: string) =>
    createTRPCProxyClient<GameAppRouter>({
        links: [
            httpBatchLink({
                url: `${webOrigin}/hwe/api/trpc`,
                headers: token ? { authorization: `Bearer ${token}` } : {},
            }),
        ],
    });

const loginAdminWithToken = async () => {
    const session: { token?: string } = {};
    const gateway = createGateway(session);
    const passwordKey = await gateway.auth.passwordKey.query();
    const credential = {
        keyId: passwordKey.keyId,
        ciphertext: publicEncrypt(
            {
                key: passwordKey.publicKeyPem,
                padding: constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256',
            },
            Buffer.from(requiredEnv('INITIAL_ADMIN_PASSWORD'), 'utf8')
        ).toString('base64'),
    };
    const result = await gateway.auth.login.mutate({
        username: requiredEnv('INITIAL_ADMIN_USERNAME'),
        credential,
    });
    if (result.status === 'otp') throw new Error('Admin login unexpectedly requires OTP.');
    session.token = result.sessionToken;
    return { gateway, sessionToken: result.sessionToken };
};

const loginAdmin = async () => (await loginAdminWithToken()).gateway;

const createAdminGame = async () => {
    const { gateway, sessionToken } = await loginAdminWithToken();
    const issued = await gateway.auth.issueGameSession.mutate({ sessionToken, profile: profileName });
    const exchanged = await createGame().auth.exchangeGatewayToken.mutate({ gatewayToken: issued.gameToken });
    return createGame(exchanged.accessToken);
};

const readState = async (): Promise<State> => JSON.parse(await readFile(statePath, 'utf8')) as State;
const writeState = async (state: State): Promise<void> => {
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
};

const gameDatabaseUrl = (): string => {
    const url = process.env.DATABASE_URL
        ? new URL(process.env.DATABASE_URL)
        : new URL(
              `postgresql://${encodeURIComponent(process.env.POSTGRES_USER ?? 'sammo')}:${encodeURIComponent(requiredEnv('POSTGRES_PASSWORD'))}@${process.env.POSTGRES_HOST ?? 'postgres'}:${process.env.POSTGRES_PORT ?? '5432'}/${process.env.POSTGRES_DB ?? 'sammo'}`
          );
    url.searchParams.set('schema', profileName.split(':', 1)[0] ?? 'hwe');
    return url.toString();
};

const redisUrl = (): string => {
    const url = new URL('redis://redis/0');
    url.hostname = process.env.REDIS_HOST ?? 'redis';
    url.port = process.env.REDIS_PORT ?? '6379';
    url.password = requiredEnv('REDIS_PASSWORD');
    return url.toString();
};

const reset = async (): Promise<void> => {
    await mkdir(artifactDir, { recursive: true });
    const gateway = await loginAdmin();
    const requestedAt = new Date();
    const preopenAt = new Date(requestedAt.getTime() + 30_000);
    const openAt = new Date(requestedAt.getTime() + 30 * 60_000);
    const operation = await gateway.admin.operations.requestReset.mutate({
        profileName,
        sourceMode: 'BRANCH',
        sourceRef,
        install: {
            scenarioId: 2601,
            turnTermMinutes: 1,
            sync: true,
            fiction: 1,
            extend: true,
            blockGeneralCreate: 0,
            npcMode: 2,
            showImgLevel: 3,
            tournamentTrig: true,
            joinMode: 'full',
            autorunUser: null,
            preopenAt: preopenAt.toISOString(),
            openAt: openAt.toISOString(),
        },
        publishSchedule: false,
        reason: 'isolated ten-user PREOPEN lifecycle integration',
    });
    const state: State = {
        runId: randomUUID(),
        requestedAt: requestedAt.toISOString(),
        preopenAt: preopenAt.toISOString(),
        openAt: openAt.toISOString(),
        resetOperationId: operation.id,
    };
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    log('reset-requested', {
        operationId: operation.id,
        profileName,
        scenarioId: 2601,
        turnTermMinutes: 1,
        preopenAt: state.preopenAt,
        openAt: state.openAt,
    });
};

const waitOperation = async (operationId: string, eventPrefix: string): Promise<void> => {
    const gateway = await loginAdmin();
    let cursor: string | undefined;
    let lastHeartbeatAt = 0;
    while (true) {
        const result = await gateway.admin.operations.logs.query({
            id: operationId,
            afterCursor: cursor,
            limit: 200,
            timeoutMs: 20_000,
        });
        cursor = result.nextCursor;
        const notable = result.entries.filter((entry) => entry.level !== 'OUTPUT');
        if (notable.length > 0 || Date.now() - lastHeartbeatAt >= 20_000) {
            lastHeartbeatAt = Date.now();
            log(`${eventPrefix}-progress`, {
                status: result.operation.status,
                receivedLogEntries: result.entries.length,
                phases: notable.map((entry) => `${entry.level}:${entry.phase}`),
            });
        }
        if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(result.operation.status)) {
            log(`${eventPrefix}-terminal`, {
                status: result.operation.status,
                error: result.operation.error ?? null,
                completedAt: result.operation.completedAt ?? null,
            });
            if (result.operation.status !== 'SUCCEEDED') process.exitCode = 1;
            return;
        }
    }
};

const waitReset = async (): Promise<void> => {
    const state = await readState();
    await waitOperation(state.resetOperationId, 'reset');
};

const deploy = async (): Promise<void> => {
    const state = await readState();
    const gateway = await loginAdmin();
    const operation = await gateway.admin.operations.requestDeploy.mutate({
        profileName,
        sourceMode: 'BRANCH',
        sourceRef,
        reason: 'deploy suspended-action lifecycle fixes without resetting the isolated season',
    });
    state.deployOperationId = operation.id;
    await writeState(state);
    log('deploy-requested', { operationId: operation.id, profileName, sourceMode: 'BRANCH', sourceRef });
};

const waitDeploy = async (): Promise<void> => {
    const state = await readState();
    if (!state.deployOperationId) throw new Error('No lifecycle deploy operation was requested.');
    await waitOperation(state.deployOperationId, 'deploy');
};

const status = async (): Promise<void> => {
    const gateway = await loginAdmin();
    const profiles = (await gateway.admin.profiles.list.query()) as unknown as Array<
        { profileName: string } & Record<string, unknown>
    >;
    const profile = profiles.find((entry) => entry.profileName === profileName);
    if (!profile) throw new Error(`Profile not found: ${profileName}`);
    log('profile-status', profile);
};

const prepareUsers = async (): Promise<void> => {
    const state = await readState();
    if ((state.users?.length ?? 0) > 10) throw new Error('Lifecycle state contains more than ten users.');
    const browser = await chromium.launch({ headless: true });
    const runSlug = state.runId.replaceAll('-', '').slice(0, 8);
    const password = `Live-${state.runId}`;
    const users: NonNullable<State['users']> = [...(state.users ?? [])];
    let browserErrors = 0;
    let applicationHttpErrors = 0;
    try {
        for (let index = users.length + 1; index <= 10; index += 1) {
            const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
            const page = await context.newPage();
            page.setDefaultTimeout(30_000);
            page.on('pageerror', () => {
                browserErrors += 1;
            });
            page.on('response', (response) => {
                if (response.status() >= 400 && !new URL(response.url()).pathname.startsWith('/image/')) {
                    applicationHttpErrors += 1;
                }
            });
            const suffix = String(index).padStart(2, '0');
            const username = `live${runSlug}${suffix}`;
            const displayName = `통합${runSlug.slice(0, 4)}${suffix}`;
            const generalName = `통합장수${suffix}`;
            await page.goto(`${webOrigin}/gateway/signup`, { waitUntil: 'networkidle' });
            await page.locator('#signup-username').fill(username);
            await page.locator('#signup-password').fill(password);
            await page.locator('#signup-confirm-password').fill(password);
            await page.locator('#signup-display-name').fill(displayName);
            await page.locator('#signup-form input[type="checkbox"]').nth(0).check();
            await page.locator('#signup-form input[type="checkbox"]').nth(1).check();
            await page.getByRole('button', { name: '가입', exact: true }).click();
            const registrationResult = await Promise.race([
                page.waitForURL(/\/gateway\/lobby/u).then(() => 'registered' as const),
                page
                    .locator('.signup-error')
                    .waitFor({ state: 'visible' })
                    .then(() => 'rejected' as const),
            ]);
            if (registrationResult === 'rejected') {
                const registrationError = (await page.locator('.signup-error').innerText()).trim();
                if (!registrationError.includes('이미 사용')) {
                    throw new Error(`Gateway registration failed for viewer ${index}: ${registrationError}`);
                }
                await page.goto(`${webOrigin}/gateway/`, { waitUntil: 'networkidle' });
                await page.locator('#username').fill(username);
                await page.locator('#password').fill(password);
                await page.getByRole('button', { name: '로그인', exact: true }).click();
                await page.waitForURL(/\/gateway\/lobby/u);
            }
            const gatewayToken = await page.evaluate(() => window.localStorage.getItem('sammo-session-token'));
            if (!gatewayToken) throw new Error(`Gateway session was not persisted for viewer ${index}.`);

            const createButton = page.getByRole('button', { name: '장수생성', exact: true });
            await createButton.waitFor({ state: 'visible' }).catch(async () => {
                await page.reload({ waitUntil: 'networkidle' });
                await createButton.waitFor({ state: 'visible', timeout: 60_000 });
            });
            await createButton.click();
            await page.waitForURL(/\/hwe\/join/u);
            await page.getByLabel('장수명').fill(generalName);
            await page.getByRole('button', { name: '능력치 초기화', exact: true }).click();
            await page.locator('.create-form').getByRole('button', { name: '장수 생성', exact: true }).click();
            const dialog = page.getByTestId('game-notice-dialog');
            await dialog.waitFor({ state: 'visible' });
            const dialogText = await dialog.innerText();
            if (!dialogText.includes('장수를 생성했습니다')) {
                throw new Error(`General creation failed for viewer ${index}: ${dialogText}`);
            }
            await dialog.getByRole('button', { name: '확인', exact: true }).click();
            await page.waitForURL(/\/hwe\/(?:$|\?)/u);
            const gameToken = await page.evaluate(() => window.localStorage.getItem('sammo-game-token'));
            if (!gameToken?.startsWith('ga_')) throw new Error(`Game access token is missing for viewer ${index}.`);
            if (index === 1) {
                await page.screenshot({ path: path.join(artifactDir, 'preopen-user-01-main.png'), fullPage: true });
            }
            users.push({ username, displayName, gatewayToken, gameToken, generalName });
            state.users = users;
            await writeState(state);
            log('user-created', { index, username, displayName, generalName });
            await context.close();
        }
    } finally {
        await browser.close();
    }
    state.users = users;
    await writeState(state);
    if (!process.env.DATABASE_URL) {
        log('users-prepared', {
            users: users.length,
            browserErrors,
            applicationHttpErrors,
            databaseSnapshot: 'deferred-to-runtime',
        });
        if (browserErrors || applicationHttpErrors || users.length !== 10) process.exitCode = 1;
        return;
    }
    const db = createGamePostgresConnector({ url: gameDatabaseUrl() });
    await db.connect();
    try {
        const [world, humanGenerals, allGenerals] = await Promise.all([
            db.prisma.worldState.findFirstOrThrow({
                select: {
                    scenarioCode: true,
                    currentYear: true,
                    currentMonth: true,
                    tickSeconds: true,
                    clockPhase: true,
                    clockTick: true,
                    clockWallAnchor: true,
                },
            }),
            db.prisma.general.count({ where: { userId: { not: null }, npcState: 0 } }),
            db.prisma.general.count(),
        ]);
        log('users-prepared', {
            users: users.length,
            browserErrors,
            applicationHttpErrors,
            humanGenerals,
            allGenerals,
            world: { ...world, clockTick: world.clockTick?.toString() ?? null },
        });
        if (browserErrors || applicationHttpErrors || users.length !== 10 || humanGenerals !== 10) process.exitCode = 1;
    } finally {
        await db.disconnect();
    }
};

const openUserPages = async () => {
    const state = await readState();
    if (state.users?.length !== 10) throw new Error('Exactly ten lifecycle users are required.');
    const browser = await chromium.launch({ headless: true });
    const records: Array<{
        index: number;
        context: BrowserContext;
        page: Page;
    }> = [];
    let browserErrors = 0;
    let applicationHttpErrors = 0;
    for (const [offset, user] of state.users.entries()) {
        const index = offset + 1;
        const context = await browser.newContext({
            viewport: index === 10 ? { width: 390, height: 844 } : { width: 1280, height: 900 },
        });
        await context.addInitScript(
            ({ gatewayToken, gameToken, profile }) => {
                window.localStorage.setItem('sammo-session-token', gatewayToken);
                window.localStorage.setItem('sammo-game-token', gameToken);
                window.localStorage.setItem('sammo-game-profile', profile);
            },
            { gatewayToken: user.gatewayToken, gameToken: user.gameToken, profile: profileName }
        );
        const page = await context.newPage();
        page.setDefaultTimeout(30_000);
        page.on('pageerror', () => {
            browserErrors += 1;
        });
        page.on('response', (response) => {
            if (response.status() >= 400 && !new URL(response.url()).pathname.startsWith('/image/')) {
                applicationHttpErrors += 1;
            }
        });
        await page.goto(`${webOrigin}/hwe/`, { waitUntil: 'domcontentloaded' });
        await page.locator('.MessagePanel').waitFor({ state: 'visible' });
        records.push({ index, context, page });
    }
    return {
        state,
        browser,
        records,
        errors: () => ({ browserErrors, applicationHttpErrors }),
    };
};

const preopenMessages = async (verifiedPhase = false): Promise<void> => {
    const opened = await openUserPages();
    const prefix = `PREOPEN${verifiedPhase ? '-VERIFIED' : ''}-${opened.state.runId.replaceAll('-', '').slice(0, 8)}`;
    const messages: NonNullable<State['preopenMessages']> = [];
    try {
        for (const { index, page } of opened.records) {
            const text = `${prefix}-${String(index).padStart(2, '0')}`;
            const wallSentAt = new Date().toISOString();
            await page.locator('.PublicTalk').getByRole('button', { name: '↩ 여기로', exact: true }).click();
            await page.locator('.message-text').fill(text);
            await page.getByRole('button', { name: '서신전달&갱신', exact: true }).click();
            await page.locator('.PublicTalk').getByText(text, { exact: true }).waitFor({ state: 'visible' });
            const wallObservedAt = new Date().toISOString();
            messages.push({ index, text, wallSentAt, wallObservedAt });
            log('preopen-message-sent', { index, text, wallSentAt, wallObservedAt });
        }
        for (const { index, page } of opened.records) {
            await page.waitForFunction(
                ({ selector, expected }) => {
                    const text = document.querySelector(selector)?.textContent ?? '';
                    return expected.every((entry) => text.includes(entry));
                },
                { selector: '.PublicTalk', expected: messages.map((message) => message.text) },
                { timeout: 30_000 }
            );
            log('preopen-message-fanout', { viewer: index, observed: messages.length });
        }
        await opened.records[0]!.page.screenshot({
            path: path.join(artifactDir, 'preopen-public-messages-desktop.png'),
            fullPage: true,
        });
        await opened.records[9]!.page.screenshot({
            path: path.join(artifactDir, 'preopen-public-messages-mobile.png'),
            fullPage: true,
        });
        if (verifiedPhase) opened.state.verifiedPreopenMessages = messages;
        else opened.state.preopenMessages = messages;
        await writeState(opened.state);
        const errors = opened.errors();
        log('preopen-messages-complete', { sent: messages.length, fanoutChecks: 100, ...errors });
        if (errors.browserErrors || errors.applicationHttpErrors) process.exitCode = 1;
    } finally {
        await Promise.all(opened.records.map(({ context }) => context.close()));
        await opened.browser.close();
    }
};

const repairPreopenFixture = async (): Promise<void> => {
    const state = await readState();
    if (Date.now() >= new Date(state.openAt).getTime()) throw new Error('Formal opening has already passed.');
    const db = createGamePostgresConnector({ url: gameDatabaseUrl() });
    const redis = createRedisConnector({ url: redisUrl() });
    await db.connect();
    await redis.connect();
    try {
        const world = await db.prisma.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } });
        if (world.clockTick !== 0n || world.clockWallAnchor?.toISOString() !== state.openAt) {
            throw new Error('Refusing PREOPEN repair because tick zero or opening anchor differs.');
        }
        await db.prisma.worldState.update({ where: { id: world.id }, data: { clockPhase: 'PREOPEN' } });
        await redis.client.set(`sammo:${profileName}:clock:phase`, 'PREOPEN');
        log('preopen-fixture-repaired', {
            previousPhase: world.clockPhase,
            nextPhase: 'PREOPEN',
            clockTick: world.clockTick.toString(),
            openAt: state.openAt,
            reason: 'reset seeded with openAt as seed wall time and persisted RUNNING before Gateway promotion',
        });
    } finally {
        await redis.disconnect();
        await db.disconnect();
    }
};

const databaseStatus = async (): Promise<void> => {
    const state = await readState();
    const db = createGamePostgresConnector({ url: gameDatabaseUrl() });
    await db.connect();
    try {
        const [
            world,
            humanGenerals,
            humanGeneralDetails,
            allGenerals,
            nations,
            cities,
            messages,
            monitorMessages,
            betting,
            unification,
            suspensions,
        ] = await Promise.all([
            db.prisma.worldState.findFirstOrThrow({
                select: {
                    scenarioCode: true,
                    currentYear: true,
                    currentMonth: true,
                    tickSeconds: true,
                    clockPhase: true,
                    clockTick: true,
                    lastTurnTick: true,
                    clockWallAnchor: true,
                    clockRevision: true,
                },
            }),
            db.prisma.general.count({ where: { userId: { not: null }, npcState: 0 } }),
            db.prisma.general.findMany({
                where: { userId: { not: null }, npcState: 0 },
                orderBy: { id: 'asc' },
                select: { id: true, name: true, nationId: true, officerLevel: true, turnTime: true, turnTick: true },
            }),
            db.prisma.general.count(),
            db.prisma.nation.count({ where: { id: { gt: 0 }, level: { gt: 0 } } }),
            db.prisma.city.count(),
            db.prisma.$queryRaw<Array<{ id: number; time: Date; timeTick: bigint | null; text: string }>>`
                SELECT id, time, time_tick AS "timeTick", message->>'text' AS text
                FROM message
                WHERE message->>'text' LIKE ${`PREOPEN%${state.runId.replaceAll('-', '').slice(0, 8)}%`}
                ORDER BY id
            `,
            db.prisma.$queryRaw<Array<{ id: number; time: Date; timeTick: bigint | null; text: string }>>`
                SELECT id, time, time_tick AS "timeTick", message->>'text' AS text
                FROM message
                WHERE message->>'text' LIKE ${`MONITOR-${state.runId.replaceAll('-', '').slice(0, 8)}-%`}
                ORDER BY id DESC
                LIMIT 20
            `,
            db.prisma.nationBetting.findMany({
                orderBy: { id: 'asc' },
                select: { id: true, name: true, finished: true, openYearMonth: true, closeYearMonth: true, bets: true },
            }),
            db.prisma.unificationFinalization.findMany({ orderBy: { createdAt: 'asc' } }),
            db.prisma.clockSuspension.findMany({
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true,
                    status: true,
                    sourceRevision: true,
                    targetRevision: true,
                    cutTick: true,
                    cutWallAt: true,
                    resumeWallAt: true,
                    shiftTicks: true,
                    alignedTick: true,
                },
            }),
        ]);
        log('database-status', {
            world: {
                ...world,
                clockTick: world.clockTick?.toString() ?? null,
                lastTurnTick: world.lastTurnTick?.toString() ?? null,
                clockRevision: world.clockRevision.toString(),
            },
            humanGenerals,
            humanGeneralDetails: humanGeneralDetails.map((general) => ({
                ...general,
                turnTime: general.turnTime.toISOString(),
                turnTick: general.turnTick?.toString() ?? null,
            })),
            allGenerals,
            nations,
            cities,
            messages: messages.map((message) => ({
                id: message.id,
                time: message.time.toISOString(),
                timeTick: message.timeTick?.toString() ?? null,
                text: message.text,
            })),
            monitorMessages: monitorMessages.reverse().map((message) => ({
                id: message.id,
                time: message.time.toISOString(),
                timeTick: message.timeTick?.toString() ?? null,
                text: message.text,
            })),
            betting: betting.map((row) => ({
                id: row.id,
                name: row.name,
                finished: row.finished,
                openYearMonth: row.openYearMonth,
                closeYearMonth: row.closeYearMonth,
                bets: row.bets.length,
            })),
            unification: unification.length,
            suspensions: suspensions.map((row) => ({
                ...row,
                sourceRevision: row.sourceRevision.toString(),
                targetRevision: row.targetRevision.toString(),
                cutTick: row.cutTick.toString(),
                cutWallAt: row.cutWallAt.toISOString(),
                resumeWallAt: row.resumeWallAt?.toISOString() ?? null,
                shiftTicks: row.shiftTicks?.toString() ?? null,
                alignedTick: row.alignedTick?.toString() ?? null,
            })),
        });
    } finally {
        await db.disconnect();
    }
};

const preparePausedBetting = async (): Promise<void> => {
    const state = await readState();
    if (state.pausedBettingId) throw new Error(`Paused betting fixture already exists: ${state.pausedBettingId}`);
    if (state.users?.length !== 10) throw new Error('Exactly ten lifecycle users are required.');
    const db = createGamePostgresConnector({ url: gameDatabaseUrl() });
    await db.connect();
    try {
        const world = await db.prisma.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } });
        if (world.clockPhase !== 'SUSPENDED') {
            throw new Error(`Refusing paused betting fixture while clock phase is ${world.clockPhase}.`);
        }
        const nations = await db.prisma.nation.findMany({
            where: { id: { gt: 0 }, level: { gt: 0 } },
            orderBy: [{ level: 'desc' }, { id: 'asc' }],
            take: 3,
        });
        if (nations.length < 2) throw new Error(`At least two active nations are required, found ${nations.length}.`);
        const general = await db.prisma.general.findFirstOrThrow({
            where: { name: state.users[0]!.generalName, userId: { not: null } },
        });
        if (!general.userId) throw new Error('Lifecycle user general has no user ID.');
        const aggregate = await db.prisma.nationBetting.aggregate({ _max: { id: true } });
        const bettingId = Math.max(900_000_000, (aggregate._max.id ?? 0) + 1);
        const openYearMonth = world.currentYear * 12 + world.currentMonth - 1;
        const candidates = await Promise.all(
            nations.map(async (nation) => {
                const [generalCount, cityCount] = await Promise.all([
                    db.prisma.general.count({ where: { nationId: nation.id } }),
                    db.prisma.city.count({ where: { nationId: nation.id } }),
                ]);
                return {
                    title: nation.name,
                    info: `국력: ${nation.level}<br>장수 수: ${generalCount}<br>도시 수: ${cityCount}`,
                    isHtml: true,
                    aux: {
                        nation: nation.id,
                        name: nation.name,
                        color: nation.color,
                        type: nation.typeCode,
                        level: nation.level,
                        capital: nation.capitalCityId,
                        gennum: generalCount,
                        power: nation.level,
                        city_cnt: cityCount,
                    },
                };
            })
        );
        await db.prisma.$transaction([
            db.prisma.nationBetting.create({
                data: {
                    id: bettingId,
                    type: 'bettingNation',
                    name: `일시 중지 실제 제출 검증 ${state.runId.slice(0, 8)}`,
                    finished: false,
                    selectCount: 1,
                    isExclusive: null,
                    requiresInheritancePoint: true,
                    openYearMonth,
                    closeYearMonth: openYearMonth + 12,
                    candidates,
                },
            }),
            db.prisma.inheritancePoint.upsert({
                where: { userId_key: { userId: general.userId, key: 'previous' } },
                update: { value: 1000 },
                create: { userId: general.userId, key: 'previous', value: 1000 },
            }),
        ]);
        state.pausedBettingId = bettingId;
        await writeState(state);
        log('paused-betting-fixture-prepared', {
            bettingId,
            clockPhase: world.clockPhase,
            year: world.currentYear,
            month: world.currentMonth,
            candidates: candidates.map((candidate) => candidate.title),
            userGeneral: general.name,
            fixtureOnly: ['nation_betting', 'inheritance_point'],
        });
    } finally {
        await db.disconnect();
    }
};

const submitPausedBetting = async (): Promise<void> => {
    const state = await readState();
    const bettingId = state.pausedBettingId;
    if (!bettingId || state.users?.length !== 10) throw new Error('Paused betting fixture and users are required.');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 500, height: 844 } });
    const user = state.users[0]!;
    await context.addInitScript(
        ({ gatewayToken, gameToken, profile }) => {
            window.localStorage.setItem('sammo-session-token', gatewayToken);
            window.localStorage.setItem('sammo-game-token', gameToken);
            window.localStorage.setItem('sammo-game-profile', profile);
        },
        { gatewayToken: user.gatewayToken, gameToken: user.gameToken, profile: profileName }
    );
    const page = await context.newPage();
    let browserErrors = 0;
    let applicationHttpErrors = 0;
    page.on('pageerror', () => {
        browserErrors += 1;
    });
    page.on('response', (response) => {
        if (response.status() >= 400 && !new URL(response.url()).pathname.startsWith('/image/')) {
            applicationHttpErrors += 1;
        }
    });
    try {
        const before = await createGame(user.gameToken).betting.getDetail.query({ bettingId });
        await page.goto(`${webOrigin}/hwe/nation-betting`, { waitUntil: 'networkidle' });
        await page
            .getByRole('button', { name: new RegExp(`일시 중지 실제 제출 검증 ${state.runId.slice(0, 8)}`) })
            .click();
        await page.locator('.betting-candidate').first().click();
        await page.getByRole('spinbutton', { name: '베팅 금액' }).fill('100');
        const wallSubmittedAt = new Date().toISOString();
        await page.getByRole('button', { name: '베팅', exact: true }).click();
        await page.getByTestId('game-toast').getByText('베팅했습니다', { exact: true }).waitFor({ state: 'visible' });
        await page.screenshot({ path: path.join(artifactDir, 'paused-betting-submitted.png'), fullPage: true });
        const after = await createGame(user.gameToken).betting.getDetail.query({ bettingId });
        log('paused-betting-submitted', {
            bettingId,
            wallSubmittedAt,
            before: { remainPoint: before.remainPoint, myBetting: before.myBetting },
            after: { remainPoint: after.remainPoint, myBetting: after.myBetting },
            browserErrors,
            applicationHttpErrors,
        });
        if (
            after.remainPoint !== before.remainPoint - 100 ||
            !after.myBetting.some(([selection, amount]) => selection === '[0]' && amount === 100) ||
            browserErrors ||
            applicationHttpErrors
        ) {
            process.exitCode = 1;
        }
    } finally {
        await context.close();
        await browser.close();
    }
};

const reserveUserEnlistments = async (): Promise<void> => {
    const state = await readState();
    if (state.users?.length !== 10) throw new Error('Exactly ten lifecycle users are required.');
    const nations = (await createGame(state.users[0]!.gameToken).public.getNationList.query()).filter(
        (nation) => nation.id > 0 && nation.level > 0
    );
    if (nations.length === 0) throw new Error('No active nation exists for enlistment.');
    const reservations: Array<{ index: number; generalId: number; nationId: number; nationName: string }> = [];
    for (const [offset, user] of state.users.entries()) {
        const game = createGame(user.gameToken);
        const generalResult = await game.general.me.query();
        if (!generalResult?.general) throw new Error(`Lifecycle user ${offset + 1} has no general.`);
        if (generalResult.general.nationId > 0) {
            log('user-enlistment-already-complete', {
                index: offset + 1,
                generalId: generalResult.general.id,
                nationId: generalResult.general.nationId,
            });
            continue;
        }
        const target = nations[offset % nations.length]!;
        let snapshot = await game.turns.reserved.getGeneral.query({ generalId: generalResult.general.id });
        for (let turnIndex = 0; turnIndex < 10; turnIndex += 1) {
            snapshot = await game.turns.reserved.setGeneral.mutate({
                generalId: generalResult.general.id,
                turnIndex,
                action: 'che_임관',
                args: { destNationId: target.id },
                expectedRevision: snapshot.revision,
            });
        }
        reservations.push({
            index: offset + 1,
            generalId: generalResult.general.id,
            nationId: target.id,
            nationName: target.name,
        });
    }
    log('user-enlistments-reserved', { reservations });
};

const prepareActionFixture = async (): Promise<void> => {
    const state = await readState();
    if (state.users?.length !== 10) throw new Error('Exactly ten lifecycle users are required.');
    if (state.actionFixture) throw new Error('Action fixture was already prepared.');
    const db = createGamePostgresConnector({ url: gameDatabaseUrl() });
    await db.connect();
    try {
        const fixture = await db.prisma.$transaction(async (tx) => {
            const world = await tx.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } });
            if (world.clockPhase !== 'SUSPENDED') {
                throw new Error(
                    `Action fixture requires a stopped or paused SUSPENDED clock, found ${world.clockPhase}.`
                );
            }
            const nations = await tx.nation.findMany({
                where: { id: { gt: 0 }, level: { gt: 0 } },
                orderBy: [{ level: 'desc' }, { id: 'asc' }],
                take: 2,
            });
            if (nations.length !== 2)
                throw new Error(`Action fixture requires two active nations, found ${nations.length}.`);
            const generalRows = await tx.general.findMany({
                where: { name: { in: state.users!.map((user) => user.generalName) }, userId: { not: null } },
                orderBy: { id: 'asc' },
            });
            if (generalRows.length !== 10) {
                throw new Error(`Action fixture requires ten persisted user generals, found ${generalRows.length}.`);
            }
            const generalByName = new Map(generalRows.map((general) => [general.name, general]));
            const resolvedNations = await Promise.all(
                nations.map(async (nation) => {
                    const city = nation.capitalCityId
                        ? await tx.city.findUnique({ where: { id: nation.capitalCityId } })
                        : await tx.city.findFirst({ where: { nationId: nation.id }, orderBy: { id: 'asc' } });
                    if (!city) throw new Error(`Nation ${nation.id} has no fixture city.`);
                    return { nation, city };
                })
            );
            await tx.general.updateMany({
                where: { nationId: { in: nations.map((nation) => nation.id) }, officerLevel: { gte: 10 } },
                data: { officerLevel: 5 },
            });
            const placements: NonNullable<State['actionFixture']>['generals'] = [];
            const officerLevels = [12, 11, 5, 1, 1] as const;
            for (const [offset, user] of state.users!.entries()) {
                const general = generalByName.get(user.generalName);
                if (!general) throw new Error(`Lifecycle general is missing: ${user.generalName}`);
                const nationIndex = offset < 5 ? 0 : 1;
                const memberIndex = offset % 5;
                const target = resolvedNations[nationIndex]!;
                const updated = await tx.general.update({
                    where: { id: general.id },
                    data: {
                        nationId: target.nation.id,
                        cityId: target.city.id,
                        officerLevel: officerLevels[memberIndex]!,
                        gold: 50_000,
                        rice: 50_000,
                        ...(memberIndex === 2 ? { weaponCode: 'che_무기_01_단도' } : {}),
                    },
                    select: { id: true, nationId: true, cityId: true, officerLevel: true },
                });
                if (!general.userId) throw new Error(`Lifecycle general ${general.id} has no user ID.`);
                await tx.inheritancePoint.upsert({
                    where: { userId_key: { userId: general.userId, key: 'previous' } },
                    update: { value: 5_000 },
                    create: { userId: general.userId, key: 'previous', value: 5_000 },
                });
                placements.push({ index: offset + 1, ...updated });
            }
            for (const [nationIndex, target] of resolvedNations.entries()) {
                const ruler = placements[nationIndex * 5]!;
                await tx.nation.update({
                    where: { id: target.nation.id },
                    data: { chiefGeneralId: ruler.id, gold: 1_000_000, rice: 1_000_000 },
                });
            }
            return {
                clockPhase: world.clockPhase,
                nations: resolvedNations.map(({ nation, city }) => ({
                    id: nation.id,
                    name: nation.name,
                    capitalCityId: city.id,
                })),
                generals: placements,
            };
        });
        state.actionFixture = { nations: fixture.nations, generals: fixture.generals };
        await writeState(state);
        log('action-fixture-prepared', {
            ...fixture,
            fixtureOnly: [
                'general.nation_id/city_id/officer_level/resources/weapon_code',
                'nation.chief_general_id/resources',
                'inheritance_point.previous',
            ],
        });
    } finally {
        await db.disconnect();
    }
};

const rotateFirst = <T>(values: readonly T[]): T[] =>
    values.length < 2 ? [...values] : [...values.slice(1), values[0]!];

const readHiddenBuffLevel = (rawMeta: unknown, key: string): number => {
    if (!rawMeta || typeof rawMeta !== 'object' || Array.isArray(rawMeta)) return 0;
    const rawBuff = Reflect.get(rawMeta, 'inheritBuff');
    let buff: unknown = rawBuff;
    if (typeof rawBuff === 'string') {
        try {
            buff = JSON.parse(rawBuff) as unknown;
        } catch {
            return 0;
        }
    }
    if (!buff || typeof buff !== 'object' || Array.isArray(buff)) return 0;
    const value = Reflect.get(buff, key);
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const repairActionItemFixture = async (): Promise<void> => {
    const state = await readState();
    if (!state.actionFixture) throw new Error('The action fixture is required.');
    const gateway = await loginAdmin();
    const profiles = (await gateway.admin.profiles.list.query()) as unknown as Array<{
        profileName: string;
        status: string;
    }>;
    const profile = profiles.find((entry) => entry.profileName === profileName);
    if (profile?.status !== 'STOPPED') {
        throw new Error(`Item fixture repair requires STOPPED, found ${profile?.status ?? 'missing'}.`);
    }
    const db = createGamePostgresConnector({ url: gameDatabaseUrl() });
    await db.connect();
    try {
        const targetGeneralId = state.actionFixture.generals[2]!.id;
        const repaired = await db.prisma.$transaction(async (tx) => {
            const world = await tx.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } });
            if (world.clockPhase !== 'SUSPENDED') {
                throw new Error(`Item fixture repair requires SUSPENDED, found ${world.clockPhase}.`);
            }
            const general = await tx.general.findUniqueOrThrow({ where: { id: targetGeneralId } });
            const meta =
                general.meta && typeof general.meta === 'object' && !Array.isArray(general.meta)
                    ? { ...general.meta }
                    : {};
            delete meta.itemInventory;
            return tx.general.update({
                where: { id: targetGeneralId },
                data: {
                    weaponCode: 'che_무기_01_단도',
                    meta: meta as GamePrisma.InputJsonValue,
                },
                select: { id: true, weaponCode: true },
            });
        });
        log('action-item-fixture-repaired', repaired);
    } finally {
        await db.disconnect();
    }
};

const exercisePausedActions = async (): Promise<void> => {
    const state = await readState();
    if (state.users?.length !== 10 || !state.actionFixture) {
        throw new Error('Ten users and the action fixture are required.');
    }
    const db = createGamePostgresConnector({ url: gameDatabaseUrl() });
    await db.connect();
    try {
        const worldBefore = await db.prisma.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } });
        if (worldBefore.clockPhase !== 'SUSPENDED') {
            throw new Error(`Paused action matrix requires SUSPENDED, found ${worldBefore.clockPhase}.`);
        }
        if (worldBefore.clockTick === null)
            throw new Error('Paused action matrix requires an authoritative clock tick.');
        const clients = state.users.map((user) => createGame(user.gameToken));
        const generals = state.actionFixture.generals;
        const firstNation = state.actionFixture.nations[0]!;
        const secondNation = state.actionFixture.nations[1]!;
        const runSlug = state.runId.replaceAll('-', '').slice(0, 8);

        const publicMessage = await clients[0]!.messages.send.mutate({
            generalId: generals[0]!.id,
            mailbox: 9999,
            text: `PAUSED-PUBLIC-${runSlug}`,
        });
        const privateMessage = await clients[1]!.messages.send.mutate({
            generalId: generals[1]!.id,
            mailbox: generals[2]!.id,
            text: `PAUSED-PRIVATE-${runSlug}`,
        });
        await clients[2]!.messages.readLatest.mutate({
            generalId: generals[2]!.id,
            type: 'private',
            messageId: privateMessage.msgId,
        });
        const nationalMessage = await clients[0]!.messages.send.mutate({
            generalId: generals[0]!.id,
            mailbox: 9000 + firstNation.id,
            text: `PAUSED-NATIONAL-${runSlug}`,
        });
        const deleteMessage = await clients[3]!.messages.send.mutate({
            generalId: generals[3]!.id,
            mailbox: 9999,
            text: `PAUSED-DELETE-NOW-${runSlug}`,
        });
        const deleteResult = await clients[3]!.messages.delete.mutate({
            generalId: generals[3]!.id,
            messageId: deleteMessage.msgId,
        });
        const expiryMessage = await clients[4]!.messages.send.mutate({
            generalId: generals[4]!.id,
            mailbox: 9999,
            text: `PAUSED-DELETE-AFTER-FIVE-${runSlug}`,
        });

        let turnSnapshot = await clients[4]!.turns.reserved.getGeneral.query({ generalId: generals[4]!.id });
        turnSnapshot = await clients[4]!.turns.reserved.setGeneral.mutate({
            generalId: generals[4]!.id,
            turnIndex: 0,
            action: '휴식',
            args: {},
            expectedRevision: turnSnapshot.revision,
        });

        const inheritanceRows = await db.prisma.general.findMany({
            where: { id: { in: generals.map(({ id }) => id) } },
            select: { id: true, meta: true },
        });
        const inheritanceById = new Map(inheritanceRows.map((general) => [general.id, general.meta]));
        const inheritanceGeneralIndex = generals.findIndex(
            (general, index) => index >= 3 && readHiddenBuffLevel(inheritanceById.get(general.id), 'warAvoidRatio') < 1
        );
        if (inheritanceGeneralIndex < 0) throw new Error('No lifecycle user remains for the inheritance purchase.');
        const inheritance = await clients[inheritanceGeneralIndex]!.inherit.buyHiddenBuff.mutate({
            type: 'warAvoidRatio',
            level: 1,
        });
        const permission = await clients[0]!.nation.changePermission.mutate({
            isAmbassador: true,
            targetGeneralIds: [generals[2]!.id],
        });
        const appointment = await clients[0]!.nation.appoint.mutate({
            destGeneralId: generals[4]!.id,
            destCityId: firstNation.capitalCityId,
            officerLevel: 2,
        });
        const rate = await clients[0]!.nation.setRate.mutate({ amount: 20 });
        const bill = await clients[0]!.nation.setBill.mutate({ amount: 100 });
        const blockWar = await clients[0]!.nation.setBlockWar.mutate({ value: true });

        const npcPolicy = await clients[0]!.npc.getPolicy.query();
        const npcPolicyMutation = await clients[0]!.npc.setNationPolicy.mutate({
            reqNationGold: npcPolicy.currentNationPolicy.reqNationGold + 100,
        });
        const npcNationPriority = await clients[0]!.npc.setNationPriority.mutate(
            rotateFirst(npcPolicy.currentNationPriority)
        );
        const npcGeneralPriority = await clients[0]!.npc.setGeneralPriority.mutate(
            rotateFirst(npcPolicy.currentGeneralActionPriority)
        );

        const letter = await clients[0]!.diplomacy.sendLetter.mutate({
            destNationId: secondNation.id,
            brief: `PAUSED 외교문서 ${runSlug}`,
            detail: `SUSPENDED 상태의 WALL_TIME 외교문서 ${runSlug}`,
        });
        const letterResponse = await clients[5]!.diplomacy.respondLetter.mutate({ letterId: letter.id, agree: true });
        const dropped = await clients[2]!.general.dropItem.mutate({ itemType: 'weapon' });

        const [worldAfter, persistedGenerals, persistedMessages, persistedLetter, inheritanceLogs, pendingEvents] =
            await Promise.all([
                db.prisma.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } }),
                db.prisma.general.findMany({
                    where: { id: { in: [generals[2]!.id, generals[4]!.id] } },
                    select: {
                        id: true,
                        nationId: true,
                        cityId: true,
                        officerLevel: true,
                        weaponCode: true,
                        meta: true,
                    },
                    orderBy: { id: 'asc' },
                }),
                db.prisma.message.findMany({
                    where: {
                        id: {
                            in: [publicMessage.msgId, privateMessage.msgId, nationalMessage.msgId, expiryMessage.msgId],
                        },
                    },
                    select: {
                        id: true,
                        time: true,
                        timeTick: true,
                        createdAtWall: true,
                        deleteUntilWall: true,
                        tombstonedAtWall: true,
                        message: true,
                    },
                    orderBy: { id: 'asc' },
                }),
                db.prisma.diplomacyLetter.findUniqueOrThrow({ where: { id: letter.id } }),
                db.prisma.inheritanceLog.findMany({
                    where: { text: { contains: '회피' } },
                    orderBy: { id: 'desc' },
                    take: 5,
                    select: { id: true, userId: true, createdAt: true, year: true, month: true, text: true },
                }),
                db.prisma.inputEvent.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
            ]);
        if (worldAfter.clockTick === null) throw new Error('Paused action matrix lost the authoritative clock tick.');
        if (worldAfter.clockTick !== worldBefore.clockTick) {
            throw new Error(
                `Game tick moved during paused actions: ${worldBefore.clockTick} -> ${worldAfter.clockTick}.`
            );
        }
        if (persistedMessages.some((message) => message.timeTick !== null)) {
            throw new Error('A paused ordinary message unexpectedly persisted a GAME_TIME occurrence tick.');
        }
        if (!persistedGenerals.some((general) => general.id === generals[2]!.id && general.weaponCode === 'None')) {
            throw new Error('Paused item discard did not persist the weapon removal.');
        }
        if (!persistedGenerals.some((general) => general.id === generals[4]!.id && general.officerLevel === 2)) {
            throw new Error('Paused personnel appointment did not persist.');
        }
        const expiryRow = persistedMessages.find((message) => message.id === expiryMessage.msgId);
        if (!expiryRow) throw new Error('Paused wall-expiry message was not persisted.');
        state.pausedWallExpiryMessage = {
            generalIndex: 5,
            messageId: expiryMessage.msgId,
            createdAtWall: expiryRow.createdAtWall.toISOString(),
            frozenGameTick: worldAfter.clockTick.toString(),
        };
        await writeState(state);
        log('paused-action-matrix-complete', {
            clockTickBefore: worldBefore.clockTick.toString(),
            clockTickAfter: worldAfter.clockTick.toString(),
            publicMessage,
            privateMessage,
            nationalMessage,
            deleteResult,
            expiryMessage: state.pausedWallExpiryMessage,
            turnRevision: turnSnapshot.revision,
            inheritance,
            dropped,
            permission,
            appointment,
            rate,
            bill,
            blockWar,
            npcPolicyMutation,
            npcNationPriority,
            npcGeneralPriority,
            diplomacyLetterId: letter.id,
            letterResponse,
            persistedGenerals,
            persistedMessages: persistedMessages.map((message) => ({
                id: message.id,
                time: message.time.toISOString(),
                timeTick: message.timeTick?.toString() ?? null,
                createdAtWall: message.createdAtWall.toISOString(),
                deleteUntilWall: message.deleteUntilWall.toISOString(),
                tombstonedAtWall: message.tombstonedAtWall?.toISOString() ?? null,
            })),
            persistedLetter: {
                id: persistedLetter.id,
                date: persistedLetter.date.toISOString(),
                state: persistedLetter.state,
            },
            inheritanceLogs: inheritanceLogs.map((entry) => ({
                ...entry,
                createdAt: entry.createdAt.toISOString(),
            })),
            pendingEvents,
        });
        if (!deleteResult.deletedIds.includes(deleteMessage.msgId) || pendingEvents !== 0) process.exitCode = 1;
    } finally {
        await db.disconnect();
    }
};

const verifyPausedWallExpiry = async (): Promise<void> => {
    const state = await readState();
    const expiry = state.pausedWallExpiryMessage;
    if (!expiry || state.users?.length !== 10 || !state.actionFixture) {
        throw new Error('Paused wall-expiry message fixture is required.');
    }
    const db = createGamePostgresConnector({ url: gameDatabaseUrl() });
    await db.connect();
    try {
        const before = await db.prisma.message.findUniqueOrThrow({
            where: { id: expiry.messageId },
            select: { createdAtWall: true, deleteUntilWall: true, tombstonedAtWall: true },
        });
        const wallRows = await db.prisma.$queryRaw<Array<{ nowWall: Date }>>`
            SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AS "nowWall"
        `;
        const nowWall = wallRows[0]?.nowWall;
        if (!nowWall) throw new Error('DB wall clock query returned no row.');
        if (nowWall < before.deleteUntilWall) {
            throw new Error(
                `Wall delete window has not expired: ${nowWall.toISOString()} < ${before.deleteUntilWall.toISOString()}.`
            );
        }
        const general = state.actionFixture.generals[expiry.generalIndex - 1]!;
        let rejectedMessage = '';
        try {
            await createGame(state.users[expiry.generalIndex - 1]!.gameToken).messages.delete.mutate({
                generalId: general.id,
                messageId: expiry.messageId,
            });
        } catch (error) {
            rejectedMessage = error instanceof Error ? error.message : String(error);
        }
        if (!rejectedMessage.includes('5분 이내')) {
            throw new Error(
                `Expired paused message was not rejected by the wall window: ${rejectedMessage || 'accepted'}`
            );
        }
        const [after, world] = await Promise.all([
            db.prisma.message.findUniqueOrThrow({
                where: { id: expiry.messageId },
                select: { tombstonedAtWall: true },
            }),
            db.prisma.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } }),
        ]);
        if (after.tombstonedAtWall !== null) throw new Error('Expired message was unexpectedly tombstoned.');
        if (world.clockPhase !== 'SUSPENDED' || world.clockTick?.toString() !== expiry.frozenGameTick) {
            throw new Error(
                `Game clock changed during wall expiry: ${world.clockPhase}@${world.clockTick?.toString() ?? 'null'}.`
            );
        }
        log('paused-wall-expiry-verified', {
            messageId: expiry.messageId,
            createdAtWall: before.createdAtWall.toISOString(),
            deleteUntilWall: before.deleteUntilWall.toISOString(),
            dbNowWall: nowWall.toISOString(),
            wallElapsedSeconds: Math.floor((nowWall.getTime() - before.createdAtWall.getTime()) / 1000),
            frozenGameTick: expiry.frozenGameTick,
            rejection: rejectedMessage,
        });
    } finally {
        await db.disconnect();
    }
};

const prepareTournamentBet = async (): Promise<void> => {
    const state = await readState();
    if (state.users?.length !== 10 || !state.actionFixture) {
        throw new Error('Ten users and the action fixture are required.');
    }
    const db = createGamePostgresConnector({ url: gameDatabaseUrl() });
    await db.connect();
    try {
        const world = await db.prisma.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } });
        if (!['RUNNING', 'MANUAL'].includes(world.clockPhase) || world.clockTick === null || !world.clockWallAnchor) {
            throw new Error(`Tournament setup requires a running authoritative game clock, found ${world.clockPhase}.`);
        }
        const bettor = state.actionFixture.generals[6]!;
        const target = state.actionFixture.generals[7]!;
        const opponent = state.actionFixture.generals[8]!;
        const admin = await createAdminGame();
        const deadline = new Date(world.clockWallAnchor.getTime() + 60 * 60_000).toISOString();
        await admin.tournament.setParticipants.mutate([
            { id: target.id, name: state.users[7]!.generalName, leadership: 70, strength: 70, intel: 70, level: 1 },
            { id: opponent.id, name: state.users[8]!.generalName, leadership: 60, strength: 60, intel: 60, level: 1 },
        ]);
        await admin.tournament.setMatches.mutate([
            {
                id: 1,
                stage: 7,
                roundIndex: 0,
                attackerId: target.id,
                defenderId: opponent.id,
            },
        ]);
        await admin.tournament.setBettingEntries.mutate([]);
        await admin.tournament.setState.mutate({
            stage: 6,
            phase: 0,
            type: 0,
            auto: false,
            openYear: world.currentYear,
            openMonth: world.currentMonth,
            termSeconds: 60,
            nextAt: deadline,
            bettingCloseAt: deadline,
            bettingSettled: false,
            rewardSettled: false,
        });
        state.pausedTournamentBet = {
            bettorGeneralId: bettor.id,
            targetGeneralId: target.id,
            preparedGameTick: world.clockTick.toString(),
        };
        await writeState(state);
        log('tournament-bet-prepared', {
            bettorGeneralId: bettor.id,
            targetGeneralId: target.id,
            opponentGeneralId: opponent.id,
            preparedGameTick: world.clockTick.toString(),
            bettingCloseAt: deadline,
        });
    } finally {
        await db.disconnect();
    }
};

const submitPausedTournamentBet = async (): Promise<void> => {
    const state = await readState();
    if (state.users?.length !== 10 || !state.actionFixture || !state.pausedTournamentBet) {
        throw new Error('A running-clock tournament fixture is required before the paused bet.');
    }
    const db = createGamePostgresConnector({ url: gameDatabaseUrl() });
    await db.connect();
    try {
        const world = await db.prisma.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } });
        if (world.clockPhase !== 'SUSPENDED' || world.clockTick === null) {
            throw new Error(`Paused tournament betting requires SUSPENDED, found ${world.clockPhase}.`);
        }
        const bettor = state.actionFixture.generals[6]!;
        const target = state.actionFixture.generals[7]!;
        if (
            bettor.id !== state.pausedTournamentBet.bettorGeneralId ||
            target.id !== state.pausedTournamentBet.targetGeneralId
        ) {
            throw new Error('Tournament bettor fixture no longer matches the persisted lifecycle state.');
        }
        const before = await db.prisma.general.findUniqueOrThrow({ where: { id: bettor.id }, select: { gold: true } });
        const result = await createGame(state.users[6]!.gameToken).tournament.placeBet.mutate({
            targetId: target.id,
            amount: 100,
        });
        const [after, snapshot, worldAfter] = await Promise.all([
            db.prisma.general.findUniqueOrThrow({ where: { id: bettor.id }, select: { gold: true } }),
            createGame(state.users[6]!.gameToken).tournament.getSnapshot.query(),
            db.prisma.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } }),
        ]);
        if (after.gold !== before.gold - 100 || snapshot.betCount !== 1) {
            throw new Error(
                `Paused tournament bet did not persist exactly once: gold ${before.gold}->${after.gold}, bets ${snapshot.betCount}.`
            );
        }
        if (worldAfter.clockPhase !== 'SUSPENDED' || worldAfter.clockTick !== world.clockTick) {
            throw new Error('Game clock moved while submitting the paused tournament bet.');
        }
        log('paused-tournament-bet-complete', {
            bettorGeneralId: bettor.id,
            targetGeneralId: target.id,
            amount: 100,
            goldBefore: before.gold,
            goldAfter: after.gold,
            betCount: snapshot.betCount,
            clockTick: world.clockTick.toString(),
            preparedGameTick: state.pausedTournamentBet.preparedGameTick,
            result,
        });
    } finally {
        await db.disconnect();
    }
};

const reserveActionableCommands = async (): Promise<void> => {
    const state = await readState();
    if (state.users?.length !== 10 || !state.actionFixture) {
        throw new Error('Ten users and the action fixture are required.');
    }
    const db = createGamePostgresConnector({ url: gameDatabaseUrl() });
    await db.connect();
    try {
        const world = await db.prisma.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } });
        const actor = state.actionFixture.generals[0]!;
        const target = state.actionFixture.generals[9]!;
        const destNation = state.actionFixture.nations[1]!;
        const client = createGame(state.users[0]!.gameToken);
        let generalTurns = await client.turns.reserved.getGeneral.query({ generalId: actor.id });
        generalTurns = await client.turns.reserved.setGeneral.mutate({
            generalId: actor.id,
            turnIndex: 0,
            action: 'che_등용',
            args: { destGeneralId: target.id },
            expectedRevision: generalTurns.revision,
        });
        let nationTurns = await client.turns.reserved.getNation.query({ generalId: actor.id });
        nationTurns = await client.turns.reserved.setNation.mutate({
            generalId: actor.id,
            turnIndex: 0,
            action: 'che_불가침제의',
            args: {
                destNationId: destNation.id,
                year: world.currentYear + 1,
                month: world.currentMonth,
            },
            expectedRevision: nationTurns.revision,
        });
        log('actionable-commands-reserved', {
            clockPhase: world.clockPhase,
            actorGeneralId: actor.id,
            recruitmentTargetGeneralId: target.id,
            noAggressionTargetNationId: destNation.id,
            generalTurnRevision: generalTurns.revision,
            nationTurnRevision: nationTurns.revision,
        });
    } finally {
        await db.disconnect();
    }
};

const waitActionableMessages = async (): Promise<void> => {
    const state = await readState();
    if (state.users?.length !== 10 || !state.actionFixture) {
        throw new Error('Ten users and the action fixture are required.');
    }
    const db = createGamePostgresConnector({ url: gameDatabaseUrl() });
    await db.connect();
    try {
        const targetGeneral = state.actionFixture.generals[9]!;
        const targetNation = state.actionFixture.nations[1]!;
        const deadline = Date.now() + Number(process.env.SAMMO_LIVE_ACTIONABLE_TIMEOUT_MS ?? '300000');
        let recruitmentId: number | undefined;
        let noAggressionId: number | undefined;
        while (Date.now() < deadline && (!recruitmentId || !noAggressionId)) {
            const actions = await db.prisma.messageAction.findMany({
                where: { actionType: { in: ['scout', 'noAggression'] }, status: 'PENDING' },
                orderBy: { createdAtWall: 'desc' },
                include: {
                    message: {
                        select: {
                            id: true,
                            mailbox: true,
                            type: true,
                            createdAtWall: true,
                            occurredGameTick: true,
                        },
                    },
                },
            });
            recruitmentId = actions.find(
                (action) => action.actionType === 'scout' && action.message.mailbox === targetGeneral.id
            )?.messageId;
            noAggressionId = actions.find(
                (action) => action.actionType === 'noAggression' && action.message.mailbox === 9000 + targetNation.id
            )?.messageId;
            if (!recruitmentId || !noAggressionId) await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        if (!recruitmentId || !noAggressionId) {
            throw new Error(
                `Actionable messages were not both delivered: recruitment=${recruitmentId ?? 'missing'}, noAggression=${noAggressionId ?? 'missing'}.`
            );
        }
        const [recruitmentInbox, diplomacyInbox, actions] = await Promise.all([
            createGame(state.users[9]!.gameToken).messages.getRecent.query({ generalId: targetGeneral.id }),
            createGame(state.users[5]!.gameToken).messages.getRecent.query({
                generalId: state.actionFixture.generals[5]!.id,
            }),
            db.prisma.messageAction.findMany({
                where: { messageId: { in: [recruitmentId, noAggressionId] } },
                orderBy: { messageId: 'asc' },
            }),
        ]);
        if (!recruitmentInbox.private.some((message) => message.id === recruitmentId)) {
            throw new Error('Recruitment recipient did not receive the actionable private message.');
        }
        if (!diplomacyInbox.diplomacy.some((message) => message.id === noAggressionId)) {
            throw new Error('Nation ruler did not receive the actionable diplomacy message.');
        }
        const noAggressionAction = actions.find((action) => action.actionType === 'noAggression');
        if (!noAggressionAction || noAggressionAction.expiresGameTick === null) {
            throw new Error('The time-limited no-aggression proposal is missing its authoritative GAME_TIME deadline.');
        }
        state.actionableMessages = { recruitmentId, noAggressionId };
        await writeState(state);
        log('actionable-messages-received', {
            recruitmentId,
            noAggressionId,
            actions: actions.map((action) => ({
                messageId: action.messageId,
                actionType: action.actionType,
                status: action.status,
                createdGameTick: action.createdGameTick.toString(),
                expiresGameTick: action.expiresGameTick?.toString() ?? null,
                deadlinePolicy: action.expiresGameTick === null ? 'INDEFINITE_GAME_ACTION' : 'GAME_TIME',
                clockRevision: action.clockRevision.toString(),
                deadlineGeneration: action.deadlineGeneration.toString(),
            })),
        });
    } finally {
        await db.disconnect();
    }
};

const respondActionableMessages = async (): Promise<void> => {
    const state = await readState();
    if (state.users?.length !== 10 || !state.actionFixture || !state.actionableMessages) {
        throw new Error('Received actionable message state is required.');
    }
    const db = createGamePostgresConnector({ url: gameDatabaseUrl() });
    await db.connect();
    try {
        const worldBefore = await db.prisma.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } });
        if (!['RUNNING', 'MANUAL'].includes(worldBefore.clockPhase) || worldBefore.clockTick === null) {
            throw new Error(`Actionable response requires a running game clock, found ${worldBefore.clockPhase}.`);
        }
        const recruitmentTarget = state.actionFixture.generals[9]!;
        const diplomacyActor = state.actionFixture.generals[5]!;
        const actionsBefore = await db.prisma.messageAction.findMany({
            where: { messageId: { in: Object.values(state.actionableMessages) } },
        });
        const recruitment =
            actionsBefore.find((action) => action.messageId === state.actionableMessages!.recruitmentId)?.status ===
            'PENDING'
                ? await createGame(state.users[9]!.gameToken).messages.respond.mutate({
                      generalId: recruitmentTarget.id,
                      messageId: state.actionableMessages.recruitmentId,
                      // A general who is already serving another nation can receive the
                      // recruitment letter but cannot accept it without first becoming
                      // unaffiliated. Decline it so this lifecycle keeps every user in a
                      // nation while still exercising the actionable ENGINE response.
                      response: false,
                  })
                : { skipped: 'already resolved' };
        const noAggression =
            actionsBefore.find((action) => action.messageId === state.actionableMessages!.noAggressionId)?.status ===
            'PENDING'
                ? await createGame(state.users[5]!.gameToken).messages.respond.mutate({
                      generalId: diplomacyActor.id,
                      messageId: state.actionableMessages.noAggressionId,
                      response: true,
                  })
                : { skipped: 'already resolved' };
        const [targetAfter, actionsAfter, diplomacyRows, worldAfter] = await Promise.all([
            db.prisma.general.findUniqueOrThrow({ where: { id: recruitmentTarget.id } }),
            db.prisma.messageAction.findMany({
                where: { messageId: { in: Object.values(state.actionableMessages) } },
                orderBy: { messageId: 'asc' },
            }),
            db.prisma.diplomacy.findMany({
                where: {
                    srcNationId: { in: state.actionFixture.nations.map((nation) => nation.id) },
                    destNationId: { in: state.actionFixture.nations.map((nation) => nation.id) },
                },
                orderBy: { id: 'asc' },
            }),
            db.prisma.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } }),
        ]);
        if (targetAfter.nationId !== state.actionFixture.nations[1]!.id) {
            throw new Error(`Recruitment response left target in nation ${targetAfter.nationId}.`);
        }
        if (actionsAfter.some((action) => action.status !== 'RESOLVED' || action.resolvedGameTick === null)) {
            throw new Error('An actionable message was not resolved with an authoritative game tick.');
        }
        log('actionable-responses-complete', {
            responseGameTick: worldAfter.clockTick?.toString() ?? null,
            recruitment,
            noAggression,
            recruitmentTarget: {
                id: targetAfter.id,
                nationId: targetAfter.nationId,
                officerLevel: targetAfter.officerLevel,
            },
            actions: actionsAfter.map((action) => ({
                messageId: action.messageId,
                actionType: action.actionType,
                status: action.status,
                resolvedGameTick: action.resolvedGameTick?.toString() ?? null,
            })),
            diplomacyRows: diplomacyRows.map((row) => ({
                srcNationId: row.srcNationId,
                destNationId: row.destNationId,
                stateCode: row.stateCode,
                term: row.term,
            })),
        });
    } finally {
        await db.disconnect();
    }
};

const reserveNoAggressionCancellation = async (): Promise<void> => {
    const state = await readState();
    if (state.users?.length !== 10 || !state.actionFixture) {
        throw new Error('Ten users and the action fixture are required.');
    }
    const actor = state.actionFixture.generals[0]!;
    const destNation = state.actionFixture.nations[1]!;
    const client = createGame(state.users[0]!.gameToken);
    let snapshot = await client.turns.reserved.getNation.query({ generalId: actor.id });
    snapshot = await client.turns.reserved.setNation.mutate({
        generalId: actor.id,
        turnIndex: 0,
        action: 'che_불가침파기제의',
        args: { destNationId: destNation.id },
        expectedRevision: snapshot.revision,
    });
    log('no-aggression-cancellation-reserved', {
        actorGeneralId: actor.id,
        destNationId: destNation.id,
        revision: snapshot.revision,
    });
};

const waitNoAggressionCancellation = async (): Promise<void> => {
    const state = await readState();
    if (state.users?.length !== 10 || !state.actionFixture) {
        throw new Error('Ten users and the action fixture are required.');
    }
    const db = createGamePostgresConnector({ url: gameDatabaseUrl() });
    await db.connect();
    try {
        const targetNation = state.actionFixture.nations[1]!;
        const deadline = Date.now() + Number(process.env.SAMMO_LIVE_ACTIONABLE_TIMEOUT_MS ?? '300000');
        let action:
            (Awaited<ReturnType<typeof db.prisma.messageAction.findFirst>> & { message: { mailbox: number } }) | null =
            null;
        while (Date.now() < deadline && !action) {
            action = await db.prisma.messageAction.findFirst({
                where: {
                    actionType: 'cancelNA',
                    status: 'PENDING',
                    message: { mailbox: 9000 + targetNation.id },
                },
                orderBy: { createdAtWall: 'desc' },
                include: { message: { select: { mailbox: true } } },
            });
            if (!action) await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        if (!action) throw new Error('Non-aggression cancellation message was not delivered.');
        state.cancelNoAggressionMessageId = action.messageId;
        await writeState(state);
        log('no-aggression-cancellation-received', {
            messageId: action.messageId,
            createdGameTick: action.createdGameTick.toString(),
            expiresGameTick: action.expiresGameTick?.toString() ?? null,
            clockRevision: action.clockRevision.toString(),
            deadlineGeneration: action.deadlineGeneration.toString(),
        });
    } finally {
        await db.disconnect();
    }
};

const respondNoAggressionCancellation = async (): Promise<void> => {
    const state = await readState();
    if (state.users?.length !== 10 || !state.actionFixture || !state.cancelNoAggressionMessageId) {
        throw new Error('Received non-aggression cancellation message is required.');
    }
    const db = createGamePostgresConnector({ url: gameDatabaseUrl() });
    await db.connect();
    try {
        const worldBefore = await db.prisma.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } });
        if (!['RUNNING', 'MANUAL'].includes(worldBefore.clockPhase) || worldBefore.clockTick === null) {
            throw new Error(`Cancellation response requires a running game clock, found ${worldBefore.clockPhase}.`);
        }
        const diplomacyActor = state.actionFixture.generals[5]!;
        const result = await createGame(state.users[5]!.gameToken).messages.respond.mutate({
            generalId: diplomacyActor.id,
            messageId: state.cancelNoAggressionMessageId,
            response: true,
        });
        const [action, diplomacyRows, worldAfter] = await Promise.all([
            db.prisma.messageAction.findUniqueOrThrow({ where: { messageId: state.cancelNoAggressionMessageId } }),
            db.prisma.diplomacy.findMany({
                where: {
                    srcNationId: { in: state.actionFixture.nations.map((nation) => nation.id) },
                    destNationId: { in: state.actionFixture.nations.map((nation) => nation.id) },
                },
                orderBy: { id: 'asc' },
            }),
            db.prisma.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } }),
        ]);
        if (action.status !== 'RESOLVED' || action.resolvedGameTick === null) {
            throw new Error('Non-aggression cancellation action was not resolved.');
        }
        if (diplomacyRows.some((row) => row.stateCode === 7)) {
            throw new Error('Accepted cancellation left a non-aggression relation active.');
        }
        log('no-aggression-cancellation-complete', {
            messageId: state.cancelNoAggressionMessageId,
            result,
            resolvedGameTick: action.resolvedGameTick.toString(),
            diplomacyRows: diplomacyRows.map((row) => ({
                srcNationId: row.srcNationId,
                destNationId: row.destNationId,
                stateCode: row.stateCode,
                term: row.term,
            })),
            responseGameTick: worldAfter.clockTick?.toString() ?? null,
        });
    } finally {
        await db.disconnect();
    }
};

const npcActionAudit = async (): Promise<void> => {
    const label = process.argv[3]?.trim() || 'checkpoint';
    const db = createGamePostgresConnector({ url: gameDatabaseUrl() });
    await db.connect();
    try {
        const [world, population, topActions, recentActions, errors, failedInputEvents] = await Promise.all([
            db.prisma.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } }),
            db.prisma.$queryRaw<
                Array<{
                    npcState: number;
                    generals: bigint;
                    affiliated: bigint;
                    armed: bigint;
                    totalCrew: bigint;
                }>
            >`
                SELECT
                    g.npc_state AS "npcState",
                    COUNT(*) AS generals,
                    COUNT(*) FILTER (WHERE g.nation_id > 0) AS affiliated,
                    COUNT(*) FILTER (WHERE g.crew > 0) AS armed,
                    COALESCE(SUM(g.crew), 0)::bigint AS "totalCrew"
                FROM general g
                WHERE g.npc_state >= 2
                GROUP BY g.npc_state
                ORDER BY g.npc_state
            `,
            db.prisma.$queryRaw<Array<{ actionText: string; executions: bigint }>>`
                SELECT
                    regexp_replace(l.text, '<[^>]+>', '', 'g') AS "actionText",
                    COUNT(*) AS executions
                FROM log_entry l
                JOIN general g ON g.id = l.general_id
                WHERE g.npc_state >= 2
                  AND l.category = 'ACTION'::"LogCategory"
                GROUP BY regexp_replace(l.text, '<[^>]+>', '', 'g')
                ORDER BY executions DESC, "actionText" ASC
                LIMIT 40
            `,
            db.prisma.$queryRaw<
                Array<{ id: number; year: number; month: number; generalId: number; generalName: string; text: string }>
            >`
                SELECT
                    l.id,
                    l.year,
                    l.month,
                    l.general_id AS "generalId",
                    g.name AS "generalName",
                    regexp_replace(l.text, '<[^>]+>', '', 'g') AS text
                FROM log_entry l
                JOIN general g ON g.id = l.general_id
                WHERE g.npc_state >= 2
                  AND l.category = 'ACTION'::"LogCategory"
                ORDER BY l.id DESC
                LIMIT 40
            `,
            db.prisma.errorLog.findMany({
                orderBy: { id: 'desc' },
                take: 30,
                select: { id: true, category: true, source: true, message: true, createdAt: true },
            }),
            db.prisma.inputEvent.findMany({
                where: { status: 'FAILED' },
                orderBy: { createdAt: 'desc' },
                take: 30,
                select: { id: true, eventType: true, error: true, createdAt: true },
            }),
        ]);
        log('npc-action-audit', {
            label,
            world: {
                year: world.currentYear,
                month: world.currentMonth,
                clockPhase: world.clockPhase,
                clockTick: world.clockTick?.toString() ?? null,
            },
            population: population.map((row) => ({
                ...row,
                generals: Number(row.generals),
                affiliated: Number(row.affiliated),
                armed: Number(row.armed),
                totalCrew: Number(row.totalCrew),
            })),
            topExecutedActions: topActions.map((row) => ({
                text: row.actionText,
                executions: Number(row.executions),
            })),
            recentExecutedActions: recentActions.reverse(),
            errors: errors.map((error) => ({ ...error, createdAt: error.createdAt.toISOString() })),
            failedInputEvents: failedInputEvents.map((event) => ({
                ...event,
                createdAt: event.createdAt.toISOString(),
            })),
        });
    } finally {
        await db.disconnect();
    }
};

const repairOpeningClockRuntime = async (): Promise<void> => {
    const gateway = await loginAdmin();
    const profiles = (await gateway.admin.profiles.list.query()) as unknown as Array<{
        profileName: string;
        status: string;
        openAt: string | null;
    }>;
    const profile = profiles.find((entry) => entry.profileName === profileName);
    if (!profile) throw new Error(`Profile not found: ${profileName}`);
    if (profile.status !== 'PREOPEN' || !profile.openAt || new Date(profile.openAt).getTime() > Date.now()) {
        throw new Error(`Opening clock repair requires an overdue PREOPEN profile, found ${profile.status}.`);
    }
    const db = createGamePostgresConnector({ url: gameDatabaseUrl() });
    const redis = createRedisConnector({ url: redisUrl() });
    await db.connect();
    await redis.connect();
    try {
        const [world, activeSuspensions, pendingOutboxes] = await Promise.all([
            db.prisma.worldState.findFirstOrThrow({ orderBy: { id: 'asc' } }),
            db.prisma.clockSuspension.count({ where: { status: { in: ['SUSPENDED', 'RECONCILING'] } } }),
            db.prisma.clockProjectionOutbox.count({ where: { status: { in: ['PENDING', 'APPLYING'] } } }),
        ]);
        if (
            world.clockPhase !== 'RUNNING' ||
            world.clockTick !== 0n ||
            activeSuspensions !== 0 ||
            pendingOutboxes !== 0
        ) {
            throw new Error(
                `Refusing opening clock repair for ${world.clockPhase}@${world.clockTick?.toString() ?? 'null'} with ${activeSuspensions} suspensions and ${pendingOutboxes} outboxes.`
            );
        }
        const keys = [
            `sammo:${profileName}:clock:active-revision`,
            `sammo:${profileName}:clock:deadline-generation`,
            `sammo:${profileName}:clock:phase`,
        ];
        const before = await Promise.all(keys.map((key) => redis.client.get(key)));
        const result = await redis.client.eval(
            `
            for index = 1, 3 do
                local current = redis.call('GET', KEYS[index])
                if (current or '') ~= ARGV[index] then return 0 end
            end
            redis.call('SET', KEYS[1], ARGV[4])
            redis.call('SET', KEYS[2], ARGV[5])
            redis.call('SET', KEYS[3], 'RUNNING')
            return 1
            `,
            {
                keys,
                arguments: [
                    before[0] ?? '',
                    before[1] ?? '',
                    before[2] ?? '',
                    world.clockRevision.toString(),
                    world.deadlineGeneration.toString(),
                ],
            }
        );
        if (Number(result) !== 1) throw new Error('Redis clock authority changed during opening repair.');
        const after = await Promise.all(keys.map((key) => redis.client.get(key)));
        log('opening-clock-runtime-repaired', {
            profileStatus: profile.status,
            worldClock: {
                phase: world.clockPhase,
                tick: world.clockTick.toString(),
                revision: world.clockRevision.toString(),
                deadlineGeneration: world.deadlineGeneration.toString(),
            },
            redisBefore: before,
            redisAfter: after,
            activeSuspensions,
            pendingOutboxes,
            reason: 'stale season-owned Redis clock authority survived RESET',
        });
    } finally {
        await redis.disconnect();
        await db.disconnect();
    }
};

const verifyExistingMonitorMessage = async (): Promise<void> => {
    const opened = await openUserPages();
    const sequence = Number(process.argv[3] ?? '22');
    if (!Number.isInteger(sequence) || sequence < 1) throw new Error('Monitor message sequence must be positive.');
    const text = `MONITOR-${opened.state.runId.replaceAll('-', '').slice(0, 8)}-${String(sequence).padStart(2, '0')}`;
    try {
        await Promise.all(
            opened.records.map(({ page }) =>
                page
                    .locator('.PublicTalk')
                    .getByText(text, { exact: true })
                    .waitFor({ state: 'visible', timeout: 60_000 })
            )
        );
        await opened.records[0]!.page.screenshot({
            path: path.join(artifactDir, `monitor-recovered-${String(sequence).padStart(2, '0')}.png`),
            fullPage: true,
        });
        log('monitor-message-recovered-fanout', { text, viewersObserved: 10, ...opened.errors() });
    } finally {
        await Promise.all(opened.records.map(({ context }) => context.close()));
        await opened.browser.close();
    }
};

const resumeDaemon = async (): Promise<void> => {
    const game = await createAdminGame();
    const result = await game.turnDaemon.resume.mutate({
        reason: 'isolated lifecycle recovery after failed paused DELAY',
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const after = await game.turnDaemon.status.query({ timeoutMs: 1000 });
    log('turn-daemon-resumed-directly', { requestId: result.requestId, after });
};

const fastForward = async (): Promise<void> => {
    const state = await readState();
    const maxMonths = Number(process.argv[3] ?? '1200');
    const stopNationCount = Number(process.env.SAMMO_FAST_FORWARD_STOP_NATIONS ?? '0');
    if (!Number.isInteger(maxMonths) || maxMonths < 1) throw new Error('fast-forward months must be positive.');
    if (!Number.isInteger(stopNationCount) || stopNationCount < 0) {
        throw new Error('SAMMO_FAST_FORWARD_STOP_NATIONS must be a non-negative integer.');
    }
    const runtime = await createTurnDaemonRuntime({
        profile: profileName.split(':', 1)[0] ?? 'hwe',
        databaseUrl: gameDatabaseUrl(),
        gameClockMode: 'manual',
        leaseOwnerId: `lifecycle-fast-forward-${state.runId.slice(0, 8)}`,
        enableLeaseHeartbeat: true,
        leaseDurationMs: 300_000,
        exclusiveFastForward: true,
        databaseTransactionTimeoutMs: 300_000,
    });
    const startedAt = Date.now();
    let months = 0;
    try {
        while (months < maxMonths) {
            const before = runtime.world.getState();
            const targetTime = new Date(before.lastTurnTime.getTime() + before.tickSeconds * 1000);
            let checkpoint;
            do {
                const result = await runtime.processor.run(
                    targetTime,
                    { budgetMs: 300_000, maxGenerals: 10_000, catchUpCap: 1 },
                    checkpoint
                );
                await runtime.hooks?.flushChanges?.(result);
                checkpoint = result.checkpoint;
                if (result.partial && result.processedGenerals === 0 && result.processedTurns === 0) {
                    throw new Error('Fast-forward made no progress within its budget.');
                }
            } while (checkpoint);
            months += 1;
            const state = runtime.world.getState();
            const activeNations = runtime.world.listNations().filter((nation) => nation.id > 0 && nation.level > 0);
            const rawUnited = Reflect.get(state.meta, 'isunited') ?? Reflect.get(state.meta, 'isUnited') ?? 0;
            const isUnited = typeof rawUnited === 'number' ? rawUnited : Number(rawUnited);
            if (
                months === 1 ||
                months % 12 === 0 ||
                activeNations.length <= Math.max(stopNationCount, 5) ||
                isUnited >= 2
            ) {
                log('fast-forward-progress', {
                    months,
                    year: state.currentYear,
                    month: state.currentMonth,
                    activeNations: activeNations.length,
                    generals: runtime.world.listGenerals().length,
                    isUnited,
                    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
                });
            }
            if (isUnited >= 2 || (stopNationCount > 0 && activeNations.length <= stopNationCount)) break;
        }
        const state = runtime.world.getState();
        log('fast-forward-complete', {
            months,
            year: state.currentYear,
            month: state.currentMonth,
            activeNations: runtime.world.listNations().filter((nation) => nation.id > 0 && nation.level > 0).length,
            elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
        });
    } finally {
        await runtime.close();
    }
};

const placeInvaderRecipients = async (): Promise<void> => {
    const state = await readState();
    if (state.users?.length !== 10) throw new Error('Exactly ten lifecycle users are required.');
    const db = createGamePostgresConnector({ url: gameDatabaseUrl() });
    await db.connect();
    try {
        const nations = await db.prisma.nation.findMany({
            where: { id: { gt: 0 }, level: { gt: 0 } },
            orderBy: [{ level: 'desc' }, { id: 'asc' }],
            take: 5,
        });
        if (nations.length < 2 || nations.length > 5) {
            throw new Error(`Recipient fixture requires two to five active nations, found ${nations.length}.`);
        }
        const placements = [];
        for (const [index, user] of state.users.entries()) {
            const nation = nations[index % nations.length]!;
            const city = nation.capitalCityId
                ? { id: nation.capitalCityId }
                : await db.prisma.city.findFirstOrThrow({ where: { nationId: nation.id }, orderBy: { id: 'asc' } });
            const officerLevel = 5 + Math.floor(index / nations.length);
            const general = await db.prisma.general.update({
                where: { id: (await db.prisma.general.findFirstOrThrow({ where: { name: user.generalName } })).id },
                data: { nationId: nation.id, cityId: city.id, officerLevel },
                select: { id: true, name: true, nationId: true, officerLevel: true, cityId: true },
            });
            placements.push({ ...general, nationName: nation.name });
        }
        log('invader-recipient-fixture-placed', {
            activeNations: nations.map((nation) => ({ id: nation.id, name: nation.name, level: nation.level })),
            placements,
            fixtureOnly: ['general.nation_id', 'general.city_id', 'general.officer_level'],
        });
    } finally {
        await db.disconnect();
    }
};

const respondToInvaderMessageInBrowser = async (): Promise<void> => {
    const state = await readState();
    if (state.users?.length !== 10) throw new Error('Exactly ten lifecycle users are required.');
    const messageId = Number(requiredEnv('SAMMO_INVADER_MESSAGE_ID'));
    const userIndex = Number(requiredEnv('SAMMO_INVADER_USER_INDEX'));
    if (!Number.isInteger(messageId) || messageId < 1) throw new Error('SAMMO_INVADER_MESSAGE_ID must be positive.');
    if (!Number.isInteger(userIndex) || userIndex < 1 || userIndex > state.users.length) {
        throw new Error('SAMMO_INVADER_USER_INDEX must identify a lifecycle user.');
    }
    const user = state.users[userIndex - 1]!;
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
        await context.addInitScript(
            ({ gatewayToken, gameToken, profile }) => {
                window.localStorage.setItem('sammo-session-token', gatewayToken);
                window.localStorage.setItem('sammo-game-token', gameToken);
                window.localStorage.setItem('sammo-game-profile', profile);
            },
            { gatewayToken: user.gatewayToken, gameToken: user.gameToken, profile: profileName }
        );
        const page = await context.newPage();
        page.setDefaultTimeout(30_000);
        let browserErrors = 0;
        let applicationHttpErrors = 0;
        page.on('pageerror', () => {
            browserErrors += 1;
        });
        page.on('response', (response) => {
            if (response.status() >= 400 && !new URL(response.url()).pathname.startsWith('/image/')) {
                applicationHttpErrors += 1;
            }
        });
        await page.goto(`${webOrigin}/hwe/`, { waitUntil: 'domcontentloaded' });
        const plate = page.locator(`#msg_${messageId}`);
        await plate.waitFor({ state: 'visible' });
        const beforeText = (await plate.locator('.msg-content').textContent())?.trim() ?? '';
        await page.screenshot({ path: path.join(artifactDir, 'invader-message-before-response.png'), fullPage: true });
        const responsePromise = page.waitForResponse(
            (response) =>
                response.url().includes('/api/trpc/messages.respond') && response.request().method() === 'POST'
        );
        page.once('dialog', (dialog) => dialog.accept());
        await plate.locator('.prompt-yes').click();
        const response = await responsePromise;
        await page.waitForTimeout(2_000);
        await page.screenshot({ path: path.join(artifactDir, 'invader-message-after-response.png'), fullPage: true });
        log('invader-message-browser-response', {
            messageId,
            userIndex,
            generalName: user.generalName,
            beforeText,
            responseStatus: response.status(),
            browserErrors,
            applicationHttpErrors,
        });
        if (response.status() !== 200 || browserErrors || applicationHttpErrors) process.exitCode = 1;
    } finally {
        await context.close();
        await browser.close();
    }
};

const requestAction = async (): Promise<void> => {
    const action = process.argv[3];
    if (!['PAUSE', 'RESUME', 'STOP', 'DELAY', 'ACCELERATE'].includes(action ?? '')) {
        throw new Error('action must be PAUSE, RESUME, STOP, DELAY, or ACCELERATE');
    }
    const durationMinutes = process.argv[4] ? Number(process.argv[4]) : undefined;
    if (
        (action === 'DELAY' || action === 'ACCELERATE') &&
        (!Number.isInteger(durationMinutes) || durationMinutes! < 1)
    ) {
        throw new Error('DELAY and ACCELERATE require a positive integer minute duration.');
    }
    const gateway = await loginAdmin();
    const result = await gateway.admin.profiles.requestAction.mutate({
        profileName,
        action: action as 'PAUSE' | 'RESUME' | 'STOP' | 'DELAY' | 'ACCELERATE',
        ...(durationMinutes ? { durationMinutes } : {}),
        reason: `isolated lifecycle integration ${action.toLowerCase()}`,
    });
    log('admin-action-requested', {
        action,
        durationMinutes: durationMinutes ?? null,
        accepted: result.ok,
        runtimeActionId: result.action && 'id' in result.action ? result.action.id : null,
    });
};

const waitProfileStatus = async (): Promise<void> => {
    const expectedStatus = process.argv[3]?.trim();
    if (!expectedStatus) throw new Error('wait-profile-status requires an expected profile status.');
    const timeoutMs = Number(process.env.SAMMO_LIVE_STATUS_TIMEOUT_MS ?? '300000');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000) {
        throw new Error('SAMMO_LIVE_STATUS_TIMEOUT_MS must be an integer of at least 1000.');
    }
    const gateway = await loginAdmin();
    const startedAt = Date.now();
    let lastStatus: string | null = null;
    while (Date.now() - startedAt < timeoutMs) {
        const profiles = (await gateway.admin.profiles.list.query()) as unknown as Array<
            { profileName: string; status: string } & Record<string, unknown>
        >;
        const profile = profiles.find((entry) => entry.profileName === profileName);
        if (!profile) throw new Error(`Profile not found: ${profileName}`);
        if (profile.status !== lastStatus) {
            lastStatus = profile.status;
            log('profile-status-wait', { expectedStatus, observedStatus: profile.status });
        }
        if (profile.status === expectedStatus) {
            log('profile-status-reached', {
                expectedStatus,
                elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
            });
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(`Profile did not reach ${expectedStatus}; last observed status was ${lastStatus ?? 'unknown'}.`);
};

const waitRuntimeAction = async (): Promise<void> => {
    const actionId = process.argv[3]?.trim();
    if (!actionId) throw new Error('wait-runtime-action requires an action ID.');
    const gateway = await loginAdmin();
    const deadline = Date.now() + Number(process.env.SAMMO_LIVE_STATUS_TIMEOUT_MS ?? '300000');
    let lastStatus: string | null = null;
    while (Date.now() < deadline) {
        const profiles = (await gateway.admin.profiles.list.query()) as unknown as Array<{
            profileName: string;
            runtimeActions?: Array<{ id: string; status: string; detail?: string | null; attempts?: number }>;
        }>;
        const action = profiles
            .find((entry) => entry.profileName === profileName)
            ?.runtimeActions?.find((entry) => entry.id === actionId);
        if (!action) throw new Error(`Runtime action not found: ${actionId}`);
        if (action.status !== lastStatus) {
            lastStatus = action.status;
            log('runtime-action-wait', { actionId, status: action.status, detail: action.detail ?? null });
        }
        if (['APPLIED', 'FAILED', 'IGNORED'].includes(action.status)) {
            log('runtime-action-terminal', { actionId, ...action });
            if (action.status !== 'APPLIED') process.exitCode = 1;
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(`Runtime action did not finish: ${actionId}; last status ${lastStatus ?? 'unknown'}.`);
};

const monitorUsers = async (): Promise<void> => {
    const opened = await openUserPages();
    const durationMinutes = Number(process.env.SAMMO_LIVE_MONITOR_MINUTES ?? '30');
    if (!Number.isFinite(durationMinutes) || durationMinutes < 10 || durationMinutes > 120) {
        throw new Error('SAMMO_LIVE_MONITOR_MINUTES must be from 10 to 120.');
    }
    const outputPath = path.join(artifactDir, 'user-monitor.ndjson');
    const startedAt = Date.now();
    const deadline = startedAt + durationMinutes * 60_000;
    let sampleIndex = 0;
    let messageIndex = Number(process.env.SAMMO_LIVE_MONITOR_START_INDEX ?? '0');
    if (!Number.isInteger(messageIndex) || messageIndex < 0) {
        throw new Error('SAMMO_LIVE_MONITOR_START_INDEX must be a non-negative integer.');
    }
    let fanoutFailures = 0;
    try {
        await appendFile(
            outputPath,
            `${JSON.stringify({ at: new Date().toISOString(), event: 'monitor-started', viewers: 10, durationMinutes })}\n`,
            { mode: 0o600 }
        );
        while (Date.now() < deadline) {
            sampleIndex += 1;
            const info = await createGame(opened.state.users![0]!.gameToken).lobby.info.query();
            const visiblePanels = (
                await Promise.all(opened.records.map(({ page }) => page.locator('.MessagePanel').isVisible()))
            ).filter(Boolean).length;
            const sample = {
                at: new Date().toISOString(),
                event: 'user-monitor-sample',
                sampleIndex,
                visiblePanels,
                year: info.year,
                month: info.month,
                turnTerm: info.turnTerm,
                userCnt: info.userCnt,
                npcCnt: info.npcCnt,
                nationCnt: info.nationCnt,
                wallElapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
            };
            log('user-monitor-sample', sample);
            await appendFile(outputPath, `${JSON.stringify(sample)}\n`);

            if (sampleIndex % 2 === 0) {
                messageIndex += 1;
                const sender = opened.records[(messageIndex - 1) % opened.records.length]!;
                const text = `MONITOR-${opened.state.runId.replaceAll('-', '').slice(0, 8)}-${String(messageIndex).padStart(2, '0')}`;
                await sender.page.locator('.PublicTalk').getByRole('button', { name: '↩ 여기로', exact: true }).click();
                await sender.page.locator('.message-text').fill(text);
                const wallSentAt = new Date().toISOString();
                await sender.page.getByRole('button', { name: '서신전달&갱신', exact: true }).click();
                const fanout = await Promise.all(
                    opened.records.map(({ page }) =>
                        page
                            .locator('.PublicTalk')
                            .getByText(text, { exact: true })
                            .waitFor({ state: 'visible', timeout: 30_000 })
                            .then(() => true)
                            .catch(() => false)
                    )
                );
                const viewersObserved = fanout.filter(Boolean).length;
                if (viewersObserved !== 10) fanoutFailures += 1;
                const messageEvent = {
                    at: new Date().toISOString(),
                    event: 'monitor-message-fanout',
                    sender: sender.index,
                    text,
                    wallSentAt,
                    viewersObserved,
                };
                log('monitor-message-fanout', messageEvent);
                await appendFile(outputPath, `${JSON.stringify(messageEvent)}\n`);
            }
            if (sampleIndex % 10 === 0) {
                await opened.records[0]!.page.screenshot({
                    path: path.join(artifactDir, `monitor-${String(sampleIndex).padStart(3, '0')}.png`),
                    fullPage: true,
                });
            }
            const remaining = deadline - Date.now();
            if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, remaining)));
        }
        const errors = opened.errors();
        log('user-monitor-complete', {
            durationMinutes,
            samples: sampleIndex,
            messages: messageIndex,
            fanoutFailures,
            ...errors,
        });
        await appendFile(
            outputPath,
            `${JSON.stringify({ at: new Date().toISOString(), event: 'monitor-complete', samples: sampleIndex, messages: messageIndex, fanoutFailures, ...errors })}\n`
        );
        if (
            errors.browserErrors ||
            errors.applicationHttpErrors ||
            fanoutFailures ||
            sampleIndex < durationMinutes * 2 - 2
        ) {
            process.exitCode = 1;
        }
    } finally {
        await Promise.all(opened.records.map(({ context }) => context.close()));
        await opened.browser.close();
    }
};

const command = process.argv[2];
if (command === 'reset') await reset();
else if (command === 'wait-reset') await waitReset();
else if (command === 'deploy') await deploy();
else if (command === 'wait-deploy') await waitDeploy();
else if (command === 'status') await status();
else if (command === 'prepare-users') await prepareUsers();
else if (command === 'preopen-messages') await preopenMessages();
else if (command === 'verified-preopen-messages') await preopenMessages(true);
else if (command === 'repair-preopen-fixture') await repairPreopenFixture();
else if (command === 'database-status') await databaseStatus();
else if (command === 'prepare-paused-betting') await preparePausedBetting();
else if (command === 'submit-paused-betting') await submitPausedBetting();
else if (command === 'reserve-user-enlistments') await reserveUserEnlistments();
else if (command === 'prepare-action-fixture') await prepareActionFixture();
else if (command === 'repair-action-item-fixture') await repairActionItemFixture();
else if (command === 'exercise-paused-actions') await exercisePausedActions();
else if (command === 'verify-paused-wall-expiry') await verifyPausedWallExpiry();
else if (command === 'prepare-tournament-bet') await prepareTournamentBet();
else if (command === 'submit-paused-tournament-bet') await submitPausedTournamentBet();
else if (command === 'reserve-actionable-commands') await reserveActionableCommands();
else if (command === 'wait-actionable-messages') await waitActionableMessages();
else if (command === 'respond-actionable-messages') await respondActionableMessages();
else if (command === 'reserve-no-aggression-cancellation') await reserveNoAggressionCancellation();
else if (command === 'wait-no-aggression-cancellation') await waitNoAggressionCancellation();
else if (command === 'respond-no-aggression-cancellation') await respondNoAggressionCancellation();
else if (command === 'npc-action-audit') await npcActionAudit();
else if (command === 'repair-opening-clock-runtime') await repairOpeningClockRuntime();
else if (command === 'verify-monitor-message') await verifyExistingMonitorMessage();
else if (command === 'resume-daemon') await resumeDaemon();
else if (command === 'fast-forward') await fastForward();
else if (command === 'place-invader-recipients') await placeInvaderRecipients();
else if (command === 'respond-invader-browser') await respondToInvaderMessageInBrowser();
else if (command === 'action') await requestAction();
else if (command === 'wait-profile-status') await waitProfileStatus();
else if (command === 'wait-runtime-action') await waitRuntimeAction();
else if (command === 'monitor-users') await monitorUsers();
else
    throw new Error(
        'usage: live-ten-user-lifecycle.ts <reset|wait-reset|deploy|wait-deploy|status|prepare-users|preopen-messages|verified-preopen-messages|repair-preopen-fixture|database-status|prepare-paused-betting|submit-paused-betting|reserve-user-enlistments|prepare-action-fixture|repair-action-item-fixture|exercise-paused-actions|verify-paused-wall-expiry|prepare-tournament-bet|submit-paused-tournament-bet|reserve-actionable-commands|wait-actionable-messages|respond-actionable-messages|reserve-no-aggression-cancellation|wait-no-aggression-cancellation|respond-no-aggression-cancellation|npc-action-audit|repair-opening-clock-runtime|verify-monitor-message|resume-daemon|fast-forward|place-invader-recipients|respond-invader-browser|action|wait-profile-status|wait-runtime-action|monitor-users>'
    );
