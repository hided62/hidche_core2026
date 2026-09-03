import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGamePostgresConnector, type GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';

import { DatabaseTurnDaemonLease, TurnDaemonLeaseLostError } from '../src/lifecycle/databaseTurnDaemonLease.js';

const databaseUrl = process.env.TURN_DAEMON_LEASE_DATABASE_URL ?? process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const profilePrefix = 'integration:turn-lease:';
const holderScript = fileURLToPath(new URL('./helpers/turnDaemonLeaseHolder.mjs', import.meta.url));

type HolderReady = {
    profile: string;
    ownerId: string;
    fencingEpoch: string;
};

const waitForHolderReady = async (child: ReturnType<typeof spawn>, timeoutMs = 10_000): Promise<HolderReady> => {
    let output = '';
    const ready = new Promise<HolderReady>((resolve, reject) => {
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
            output += chunk;
            const newline = output.indexOf('\n');
            if (newline < 0) {
                return;
            }
            resolve(JSON.parse(output.slice(0, newline)) as HolderReady);
        });
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            reject(new Error(`lease holder exited before readiness: code=${String(code)} signal=${String(signal)}`));
        });
    });
    const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('lease holder readiness timed out')), timeoutMs).unref();
    });
    return Promise.race([ready, timeout]);
};

const delay = (durationMs: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, durationMs);
    });

const createPartitionableTcpProxy = async (
    upstreamHost: string,
    upstreamPort: number
): Promise<{
    port: number;
    partition: () => Promise<void>;
    restore: () => Promise<void>;
    close: () => Promise<void>;
}> => {
    type ProxyPair = {
        client: Socket;
        upstream: Socket;
    };
    const pairs = new Set<ProxyPair>();
    let server: Server | null = null;
    let port = 0;
    let partitioned = false;

    const resumePair = (pair: ProxyPair): void => {
        if (partitioned || pair.client.destroyed || pair.upstream.destroyed || pair.upstream.connecting) {
            return;
        }
        pair.client.pipe(pair.upstream);
        pair.upstream.pipe(pair.client);
    };

    const listen = async (requestedPort: number): Promise<void> => {
        const nextServer = createServer((client) => {
            const upstream = createConnection({ host: upstreamHost, port: upstreamPort });
            const pair = { client, upstream };
            pairs.add(pair);
            client.on('error', () => undefined);
            upstream.on('error', () => undefined);
            client.once('close', () => {
                pairs.delete(pair);
                if (!upstream.destroyed) {
                    upstream.destroy();
                }
            });
            upstream.once('close', () => {
                pairs.delete(pair);
                if (!client.destroyed) {
                    client.destroy();
                }
            });
            upstream.once('connect', () => resumePair(pair));
        });
        await new Promise<void>((resolve, reject) => {
            const onError = (error: Error): void => reject(error);
            nextServer.once('error', onError);
            nextServer.listen(requestedPort, '127.0.0.1', () => {
                nextServer.off('error', onError);
                resolve();
            });
        });
        server = nextServer;
        const address = nextServer.address();
        if (!address || typeof address === 'string') {
            throw new Error('TCP proxy did not expose a numeric port');
        }
        port = address.port;
    };

    const partition = (): Promise<void> => {
        partitioned = true;
        for (const pair of pairs) {
            pair.client.unpipe(pair.upstream);
            pair.upstream.unpipe(pair.client);
        }
        return Promise.resolve();
    };

    const close = async (): Promise<void> => {
        const activeServer = server;
        server = null;
        if (!activeServer) {
            return;
        }
        const closed = new Promise<void>((resolve, reject) => {
            activeServer.close((error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
        for (const pair of pairs) {
            pair.client.destroy();
            pair.upstream.destroy();
        }
        pairs.clear();
        await closed;
    };

    await listen(0);
    return {
        get port() {
            return port;
        },
        partition,
        restore: () => {
            partitioned = false;
            for (const pair of pairs) {
                resumePair(pair);
            }
            return Promise.resolve();
        },
        close,
    };
};

integration('database turn daemon lease and fencing', () => {
    let db: GamePrismaClient;
    let disconnect: (() => Promise<void>) | undefined;
    const leases: DatabaseTurnDaemonLease[] = [];

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        disconnect = () => connector.disconnect();
        await db.turnDaemonLease.deleteMany({
            where: { profile: { startsWith: profilePrefix } },
        });
    });

    afterAll(async () => {
        await Promise.allSettled(leases.map((lease) => lease.close()));
        await db.turnDaemonLease.deleteMany({
            where: { profile: { startsWith: profilePrefix } },
        });
        await disconnect?.();
    });

    const createLease = async (profile: string, ownerId: string) => {
        const lease = await DatabaseTurnDaemonLease.connect(databaseUrl!, {
            profile,
            ownerId,
            leaseDurationMs: 60_000,
            heartbeat: false,
        });
        leases.push(lease);
        return lease;
    };

    it('allows only one owner to acquire an active profile lease', async () => {
        const profile = `${profilePrefix}exclusive`;
        const first = await createLease(profile, 'owner-a');
        const second = await createLease(profile, 'owner-b');

        const [firstToken, secondToken] = await Promise.all([first.acquire(), second.acquire()]);

        expect([firstToken, secondToken].filter(Boolean)).toHaveLength(1);
        const row = await db.turnDaemonLease.findUniqueOrThrow({ where: { profile } });
        expect(row.fencingEpoch).toBe(1n);
        expect(row.ownerId).toBe(firstToken ? 'owner-a' : 'owner-b');
    });

    it('persists and evaluates lease wall time as UTC under a non-UTC database session', async () => {
        const profile = `${profilePrefix}utc-wall`;
        const zonedUrl = new URL(databaseUrl!);
        const schema = zonedUrl.searchParams.get('schema') ?? 'public';
        zonedUrl.searchParams.delete('schema');
        zonedUrl.searchParams.set('options', `-c search_path=${schema} -c TimeZone=Asia/Seoul`);
        const zonedConnector = createGamePostgresConnector({ url: zonedUrl.toString() });
        await zonedConnector.connect();
        const lease = await DatabaseTurnDaemonLease.connect(zonedUrl.toString(), {
            profile,
            ownerId: 'utc-owner',
            leaseDurationMs: 60_000,
            heartbeat: false,
        });
        leases.push(lease);
        try {
            await expect(lease.acquire()).resolves.toMatchObject({ profile, ownerId: 'utc-owner' });
            const [leaseRows, wallRows] = await Promise.all([
                zonedConnector.prisma.$queryRaw<Array<{ leaseUntil: Date }>>`
                    SELECT lease_until AS "leaseUntil"
                    FROM turn_daemon_lease
                    WHERE profile = ${profile}
                `,
                zonedConnector.prisma.$queryRaw<Array<{ zone: string; wallNow: Date }>>`
                    SELECT current_setting('TimeZone') AS zone,
                           (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::timestamp(3) AS "wallNow"
                `,
            ]);
            expect(wallRows[0]?.zone).toBe('Asia/Seoul');
            expect(leaseRows[0]!.leaseUntil.getTime() - wallRows[0]!.wallNow.getTime()).toBeGreaterThan(50_000);
            expect(leaseRows[0]!.leaseUntil.getTime() - wallRows[0]!.wallNow.getTime()).toBeLessThanOrEqual(60_000);

            await lease.release();
            const [releasedRows, releasedWall] = await Promise.all([
                zonedConnector.prisma.$queryRaw<Array<{ leaseUntil: Date }>>`
                    SELECT lease_until AS "leaseUntil"
                    FROM turn_daemon_lease
                    WHERE profile = ${profile}
                `,
                zonedConnector.prisma.$queryRaw<Array<{ wallNow: Date }>>`
                    SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::timestamp(3) AS "wallNow"
                `,
            ]);
            expect(Math.abs(releasedRows[0]!.leaseUntil.getTime() - releasedWall[0]!.wallNow.getTime())).toBeLessThan(
                1_000
            );
        } finally {
            await zonedConnector.disconnect();
        }
    });

    it('increments the epoch on expiry takeover and fences the stale owner', async () => {
        const profile = `${profilePrefix}takeover`;
        const first = await createLease(profile, 'owner-a');
        const second = await createLease(profile, 'owner-b');

        const firstToken = await first.acquire();
        expect(firstToken?.fencingEpoch).toBe(1n);
        await db.turnDaemonLease.update({
            where: { profile },
            data: { leaseUntil: new Date(Date.now() - 1_000) },
        });

        const secondToken = await second.acquire();
        expect(secondToken).toMatchObject({
            profile,
            ownerId: 'owner-b',
            fencingEpoch: 2n,
        });
        await expect(first.assertActive()).rejects.toBeInstanceOf(TurnDaemonLeaseLostError);
        await expect(second.assertActive()).resolves.toBeUndefined();
    });

    it('rolls back a stale fenced transaction without writing its completion marker', async () => {
        const profile = `${profilePrefix}rollback`;
        const requestId = `${profilePrefix}stale-write`;
        const first = await createLease(profile, 'owner-a');
        const second = await createLease(profile, 'owner-b');
        await first.acquire();
        await db.turnDaemonLease.update({
            where: { profile },
            data: { leaseUntil: new Date(Date.now() - 1_000) },
        });
        await second.acquire();

        await expect(
            db.$transaction(async (transaction) => {
                await first.assertActive(transaction);
                await transaction.inputEvent.create({
                    data: {
                        requestId,
                        target: 'ENGINE',
                        eventType: 'fenced-test',
                        payload: {} as GamePrisma.InputJsonValue,
                    },
                });
            })
        ).rejects.toBeInstanceOf(TurnDaemonLeaseLostError);
        expect(await db.inputEvent.findUnique({ where: { requestId } })).toBeNull();
    });

    it('permits a clean successor after release while fencing a resumed old token', async () => {
        const profile = `${profilePrefix}release`;
        const first = await createLease(profile, 'owner-a');
        const second = await createLease(profile, 'owner-b');

        expect((await first.acquire())?.fencingEpoch).toBe(1n);
        await first.release();
        expect((await second.acquire())?.fencingEpoch).toBe(2n);
        await expect(first.assertActive()).rejects.toBeInstanceOf(TurnDaemonLeaseLostError);
    });

    it('takes over after a heartbeat owner process is killed and its lease expires', async () => {
        const profile = `${profilePrefix}process-kill`;
        const leaseDurationMs = 1_200;
        const holder = spawn(process.execPath, ['--experimental-strip-types', holderScript], {
            env: {
                ...process.env,
                TURN_DAEMON_LEASE_DATABASE_URL: databaseUrl!,
                TURN_DAEMON_LEASE_PROFILE: profile,
                TURN_DAEMON_LEASE_OWNER_ID: 'process-owner',
                TURN_DAEMON_LEASE_DURATION_MS: String(leaseDurationMs),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let successor: DatabaseTurnDaemonLease | null = null;
        try {
            await expect(waitForHolderReady(holder)).resolves.toEqual({
                profile,
                ownerId: 'process-owner',
                fencingEpoch: '1',
            });
            expect(await db.turnDaemonLease.findUniqueOrThrow({ where: { profile } })).toMatchObject({
                ownerId: 'process-owner',
                fencingEpoch: 1n,
            });

            expect(holder.kill('SIGKILL')).toBe(true);
            const [exitCode, signal] = (await once(holder, 'exit')) as [number | null, NodeJS.Signals | null];
            expect(exitCode).toBeNull();
            expect(signal).toBe('SIGKILL');

            successor = await createLease(profile, 'successor-owner');
            expect(await successor.acquire()).toBeNull();

            const deadline = Date.now() + leaseDurationMs * 4;
            let successorToken = null;
            while (Date.now() < deadline) {
                successorToken = await successor.acquire();
                if (successorToken) {
                    break;
                }
                await delay(100);
            }
            expect(successorToken).toMatchObject({
                profile,
                ownerId: 'successor-owner',
                fencingEpoch: 2n,
            });
            expect(await successor.assertActive()).toBeUndefined();
        } finally {
            if (holder.exitCode === null && holder.signalCode === null) {
                holder.kill('SIGKILL');
                await once(holder, 'exit');
            }
            await successor?.release();
        }
    }, 15_000);

    it('stays fenced after a database partition outlasts the heartbeat lease and connectivity recovers', async () => {
        const profile = `${profilePrefix}database-partition`;
        const leaseDurationMs = 1_800;
        const directUrl = new URL(databaseUrl!);
        const upstreamPort = Number(directUrl.port || '5432');
        const proxy = await createPartitionableTcpProxy(directUrl.hostname, upstreamPort);
        directUrl.hostname = '127.0.0.1';
        directUrl.port = String(proxy.port);
        const partitionedOwner = await DatabaseTurnDaemonLease.connect(directUrl.toString(), {
            profile,
            ownerId: 'partitioned-owner',
            leaseDurationMs,
            heartbeat: true,
        });
        leases.push(partitionedOwner);
        let successor: DatabaseTurnDaemonLease | null = null;
        try {
            expect((await partitionedOwner.acquire())?.fencingEpoch).toBe(1n);

            await proxy.partition();
            successor = await createLease(profile, 'partition-successor');
            expect(await successor.acquire()).toBeNull();

            const lostDeadline = Date.now() + leaseDurationMs * 2;
            while (!partitionedOwner.isLost() && Date.now() < lostDeadline) {
                await delay(50);
            }
            expect(partitionedOwner.isLost()).toBe(true);

            const takeoverDeadline = Date.now() + leaseDurationMs * 4;
            let successorToken = null;
            while (Date.now() < takeoverDeadline) {
                successorToken = await successor.acquire();
                if (successorToken) {
                    break;
                }
                await delay(100);
            }
            expect(successorToken).toMatchObject({
                profile,
                ownerId: 'partition-successor',
                fencingEpoch: 2n,
            });

            await proxy.restore();
            expect(await partitionedOwner.renew()).toBe(false);
            await expect(partitionedOwner.assertActive()).rejects.toBeInstanceOf(TurnDaemonLeaseLostError);
            await expect(successor.assertActive()).resolves.toBeUndefined();
        } finally {
            await proxy.close();
            await successor?.release();
        }
    }, 20_000);
});
