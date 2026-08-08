import { constants, publicEncrypt } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import { expect, test } from '@playwright/test';
import type { AppRouter as GameAppRouter } from '@sammo-ts/game-api';
import type { AppRouter as GatewayAppRouter } from '@sammo-ts/gateway-api';
import { Pool } from 'pg';

const gatewayUrl = process.env.SAMMO_LIFECYCLE_GATEWAY_URL ?? 'http://127.0.0.1:15001/gateway/api/trpc';
const gameUrl = process.env.SAMMO_LIFECYCLE_GAME_URL ?? 'http://127.0.0.1:15015/hwe/api/trpc';
const profile = process.env.SAMMO_LIFECYCLE_PROFILE_KEY?.trim() || 'hwe:default';
const sampleImage = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
);

const requiredEnv = (name: string): string => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
};

const readPassword = async (account: 'admin' | 'user_a' | 'user_b'): Promise<string> =>
    (await readFile(`${requiredEnv('SAMMO_LIFECYCLE_SECRET_ROOT')}/${account}_password`, 'utf8')).trim();

const createGatewayClient = (session: { token?: string }) =>
    createTRPCProxyClient<GatewayAppRouter>({
        links: [
            httpBatchLink({
                url: gatewayUrl,
                headers: () => (session.token ? { 'x-session-token': session.token } : {}),
            }),
        ],
    });

const createGameClient = (session: { token?: string }) =>
    createTRPCProxyClient<GameAppRouter>({
        links: [
            httpBatchLink({
                url: gameUrl,
                headers: () => (session.token ? { authorization: `Bearer ${session.token}` } : {}),
            }),
        ],
    });

const loginGame = async (username: string, password: string) => {
    const gatewaySession: { token?: string } = {};
    const gateway = createGatewayClient(gatewaySession);
    const passwordKey = await gateway.auth.passwordKey.query();
    const credential = {
        keyId: passwordKey.keyId,
        ciphertext: publicEncrypt(
            {
                key: passwordKey.publicKeyPem,
                padding: constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: 'sha256',
            },
            Buffer.from(password, 'utf8')
        ).toString('base64'),
    };
    const login = await gateway.auth.login.mutate({ username, credential });
    gatewaySession.token = login.sessionToken;
    const issued = await gateway.auth.issueGameSession.mutate({
        sessionToken: login.sessionToken,
        profile,
    });
    const gameSession: { token?: string } = {};
    const game = createGameClient(gameSession);
    gameSession.token = (await game.auth.exchangeGatewayToken.mutate({ gatewayToken: issued.gameToken })).accessToken;
    return { gateway, game };
};

const monthOrdinal = (year: number, month: number): number => year * 12 + month - 1;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createDatabasePool = (): Pool =>
    new Pool({
        host: process.env.POSTGRES_HOST ?? '127.0.0.1',
        port: Number(process.env.POSTGRES_PORT ?? 5432),
        database: process.env.POSTGRES_DB ?? 'sammo',
        user: process.env.POSTGRES_USER ?? 'sammo',
        password: requiredEnv('POSTGRES_PASSWORD'),
        options: '-c search_path=hwe',
    });

test('two users enlist, the engine advances three months, and only a chief uploads a nation image', async () => {
    test.setTimeout(300_000);

    const adminUsername = requiredEnv('SAMMO_LIFECYCLE_ADMIN_USERNAME');
    const [{ game: admin }, { game: userA }, { game: userB }] = await Promise.all([
        loginGame(adminUsername, await readPassword('admin')),
        loginGame('guiusera', await readPassword('user_a')),
        loginGame('guiuserb', await readPassword('user_b')),
    ]);

    const db = createDatabasePool();

    try {
        const initialWorldResult = await db.query<{ current_year: number; current_month: number }>(
            'SELECT current_year, current_month FROM world_state LIMIT 1'
        );
        const initialWorld = initialWorldResult.rows[0];
        if (!initialWorld) throw new Error('HWE world_state is missing.');
        const initialOrdinal = monthOrdinal(initialWorld.current_year, initialWorld.current_month);

        const reserveEnlist = async (game: typeof userA, destNationId: number) => {
            const context = await game.general.me.query();
            if (!context?.general) throw new Error('User general is missing.');
            if (context.general.nationId > 0) return context.general.id;
            const snapshot = await game.turns.reserved.getGeneral.query({ generalId: context.general.id });
            await game.turns.reserved.setGeneral.mutate({
                generalId: context.general.id,
                turnIndex: 0,
                action: 'che_임관',
                args: { destNationId },
                expectedRevision: snapshot.revision,
            });
            return context.general.id;
        };

        const [generalAId, generalBId] = await Promise.all([reserveEnlist(userA, 1), reserveEnlist(userB, 1)]);

        const runNextMonth = async () => {
            const before = await admin.turnDaemon.status.query({ timeoutMs: 5_000 });
            if (!before?.lastTurnTime) throw new Error('Turn daemon did not report the last monthly boundary.');
            const beforeWorldResult = await db.query<{ current_year: number; current_month: number }>(
                'SELECT current_year, current_month FROM world_state LIMIT 1'
            );
            const beforeWorld = beforeWorldResult.rows[0];
            if (!beforeWorld) throw new Error('HWE world_state is missing before turn execution.');
            const expectedOrdinal = monthOrdinal(beforeWorld.current_year, beforeWorld.current_month) + 1;
            const lastBoundary = new Date(before.lastTurnTime).getTime();
            const targetTime = new Date(Math.floor(lastBoundary / 3_600_000) * 3_600_000 + 3_900_000).toISOString();
            await admin.turnDaemon.run.mutate({
                reason: 'manual',
                targetTime,
                budget: { budgetMs: 90_000, maxGenerals: 10_000, catchUpCap: 1 },
            });

            const deadline = Date.now() + 90_000;
            while (Date.now() < deadline) {
                const after = await admin.turnDaemon.status.query({ timeoutMs: 5_000 });
                if (after?.lastError) throw new Error(`Turn daemon failed: ${after.lastError}`);
                const worldResult = await db.query<{ current_year: number; current_month: number }>(
                    'SELECT current_year, current_month FROM world_state LIMIT 1'
                );
                const world = worldResult.rows[0];
                if (world && monthOrdinal(world.current_year, world.current_month) >= expectedOrdinal) {
                    return;
                }
                await sleep(250);
            }
            throw new Error('Turn daemon did not complete the requested monthly boundary.');
        };

        for (let index = 0; index < 3; index += 1) {
            await runNextMonth();
        }

        const progressedWorldResult = await db.query<{ current_year: number; current_month: number }>(
            'SELECT current_year, current_month FROM world_state LIMIT 1'
        );
        const progressedWorld = progressedWorldResult.rows[0];
        if (!progressedWorld) throw new Error('HWE world_state disappeared.');
        expect(monthOrdinal(progressedWorld.current_year, progressedWorld.current_month) - initialOrdinal).toBe(3);

        let enlisted = await db.query<{ id: number; nation_id: number; officer_level: number }>(
            'SELECT id, nation_id, officer_level FROM general WHERE id = ANY($1::int[]) ORDER BY id',
            [[generalAId, generalBId]]
        );
        expect(enlisted.rows).toHaveLength(2);
        if (enlisted.rows.some((general) => general.nation_id === 0)) {
            const candidateResult = await db.query<{ id: number }>(
                `SELECT n.id
                   FROM nation n
                   LEFT JOIN general g ON g.nation_id = n.id
                  WHERE n.id > 0
                  GROUP BY n.id, n.level
                 HAVING COUNT(g.id) < 10
                  ORDER BY n.level DESC, n.id
                  LIMIT 1`
            );
            const candidate = candidateResult.rows[0];
            if (!candidate) throw new Error('No nation has room for an opening-period enlistment.');
            if (enlisted.rows.find((general) => general.id === generalAId)?.nation_id === 0) {
                await reserveEnlist(userA, candidate.id);
            }
            if (enlisted.rows.find((general) => general.id === generalBId)?.nation_id === 0) {
                await reserveEnlist(userB, candidate.id);
            }
            await runNextMonth();
            enlisted = await db.query<{ id: number; nation_id: number; officer_level: number }>(
                'SELECT id, nation_id, officer_level FROM general WHERE id = ANY($1::int[]) ORDER BY id',
                [[generalAId, generalBId]]
            );
        }
        expect(enlisted.rows.every((general) => general.nation_id > 0)).toBe(true);

        // Appointment is fixture setup for the authorization boundary below. Enlistment and
        // month advancement above are performed exclusively by the real turn daemon.
        const connection = await db.connect();
        try {
            await connection.query('BEGIN');
            await connection.query('UPDATE general SET officer_level = 5 WHERE id = $1', [generalAId]);
            await connection.query('UPDATE general SET officer_level = 1 WHERE id = $1', [generalBId]);
            await connection.query('COMMIT');
        } catch (error) {
            await connection.query('ROLLBACK');
            throw error;
        } finally {
            connection.release();
        }

        await expect(userB.board.uploadImage.mutate({ dataUrl: sampleImage.toString('base64') })).rejects.toThrow(
            '권한이 부족합니다. 수뇌부가 아닙니다.'
        );

        const uploaded = await userA.board.uploadImage.mutate({ dataUrl: sampleImage.toString('base64') });
        expect(uploaded.url).toMatch(/^https:\/\/sam-image\.hided\.net\/uploads\/core2026\/[a-f0-9]{32}\.webp$/);
        expect(uploaded.format).toBe('webp');
        expect(uploaded.width).toBe(1);
        expect(uploaded.height).toBe(1);
        expect(uploaded.size).toBeGreaterThan(0);
    } finally {
        await db.end();
    }
});
