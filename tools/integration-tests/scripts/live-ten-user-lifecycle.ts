/// <reference lib="dom" />

import { constants, publicEncrypt, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter as GatewayAppRouter } from '@sammo-ts/gateway-api';
import type { AppRouter as GameAppRouter } from '@sammo-ts/game-api';
import { createGamePostgresConnector, createRedisConnector } from '@sammo-ts/infra';
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
    const openAt = new Date(requestedAt.getTime() + 15 * 60_000);
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

const waitReset = async (): Promise<void> => {
    const state = await readState();
    const gateway = await loginAdmin();
    let cursor: string | undefined;
    let lastHeartbeatAt = 0;
    while (true) {
        const result = await gateway.admin.operations.logs.query({
            id: state.resetOperationId,
            afterCursor: cursor,
            limit: 200,
            timeoutMs: 20_000,
        });
        cursor = result.nextCursor;
        const notable = result.entries.filter((entry) => entry.level !== 'OUTPUT');
        if (notable.length > 0 || Date.now() - lastHeartbeatAt >= 20_000) {
            lastHeartbeatAt = Date.now();
            log('reset-progress', {
                status: result.operation.status,
                receivedLogEntries: result.entries.length,
                phases: notable.map((entry) => `${entry.level}:${entry.phase}`),
            });
        }
        if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(result.operation.status)) {
            log('reset-terminal', {
                status: result.operation.status,
                error: result.operation.error ?? null,
                completedAt: result.operation.completedAt ?? null,
            });
            if (result.operation.status !== 'SUCCEEDED') process.exitCode = 1;
            return;
        }
    }
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
        const target = nations[0]!;
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
    if (!['PAUSE', 'RESUME', 'DELAY', 'ACCELERATE'].includes(action ?? '')) {
        throw new Error('action must be PAUSE, RESUME, DELAY, or ACCELERATE');
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
        action: action as 'PAUSE' | 'RESUME' | 'DELAY' | 'ACCELERATE',
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
else if (command === 'status') await status();
else if (command === 'prepare-users') await prepareUsers();
else if (command === 'preopen-messages') await preopenMessages();
else if (command === 'verified-preopen-messages') await preopenMessages(true);
else if (command === 'repair-preopen-fixture') await repairPreopenFixture();
else if (command === 'database-status') await databaseStatus();
else if (command === 'prepare-paused-betting') await preparePausedBetting();
else if (command === 'submit-paused-betting') await submitPausedBetting();
else if (command === 'reserve-user-enlistments') await reserveUserEnlistments();
else if (command === 'verify-monitor-message') await verifyExistingMonitorMessage();
else if (command === 'resume-daemon') await resumeDaemon();
else if (command === 'fast-forward') await fastForward();
else if (command === 'place-invader-recipients') await placeInvaderRecipients();
else if (command === 'respond-invader-browser') await respondToInvaderMessageInBrowser();
else if (command === 'action') await requestAction();
else if (command === 'monitor-users') await monitorUsers();
else
    throw new Error(
        'usage: live-ten-user-lifecycle.ts <reset|wait-reset|status|prepare-users|preopen-messages|verified-preopen-messages|repair-preopen-fixture|database-status|prepare-paused-betting|submit-paused-betting|reserve-user-enlistments|verify-monitor-message|resume-daemon|fast-forward|place-invader-recipients|respond-invader-browser|action|monitor-users>'
    );
