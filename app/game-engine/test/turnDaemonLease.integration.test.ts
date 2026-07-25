import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGamePostgresConnector, type GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';

import {
    DatabaseTurnDaemonLease,
    TurnDaemonLeaseLostError,
} from '../src/lifecycle/databaseTurnDaemonLease.js';

const databaseUrl = process.env.TURN_DAEMON_LEASE_DATABASE_URL ?? process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const profilePrefix = 'integration:turn-lease:';

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
});
