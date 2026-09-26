import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import { loadProfileReadiness } from '../src/services/clockReadiness.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
integration('profile deployment readiness', () => {
    let db: GamePrismaClient;
    let close: () => Promise<void>;
    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        close = () => connector.disconnect();
    });
    afterAll(async () => {
        await close?.();
    });
    it('rejects absent, initializing, expired and other-profile leases; accepts ready paused/preopen runtime', async () => {
        const rollback = new Error('readiness fixture rollback');
        await expect(
            db.$transaction(async (tx) => {
                // Shared integration fixtures may leave projection work; rollback restores it.
                await tx.clockProjectionOutbox.deleteMany();
                await tx.worldState.create({
                    data: {
                        id: -998901,
                        scenarioCode: 'readiness-fixture',
                        currentYear: 190,
                        currentMonth: 1,
                        tickSeconds: 300,
                        clockPhase: 'PREOPEN',
                        config: {},
                        meta: {},
                    },
                });
                const profile = 'readiness:fixture';
                expect((await loadProfileReadiness(tx, profile)).ok).toBe(false);
                await tx.turnDaemonLease.create({
                    data: {
                        profile,
                        ownerId: 'fixture',
                        fencingEpoch: 1n,
                        heartbeatAt: new Date(),
                        leaseUntil: new Date(Date.now() + 60_000),
                        clockReady: false,
                    },
                });
                expect((await loadProfileReadiness(tx, profile)).ok).toBe(false);
                await tx.turnDaemonLease.update({ where: { profile }, data: { clockReady: true } });
                expect((await loadProfileReadiness(tx, profile)).ok).toBe(true);
                expect((await loadProfileReadiness(tx, 'readiness:other')).ok).toBe(false);
                await tx.turnDaemonLease.update({
                    where: { profile },
                    data: { leaseUntil: new Date(Date.now() - 60_000) },
                });
                expect((await loadProfileReadiness(tx, profile)).ok).toBe(false);
                throw rollback;
            })
        ).rejects.toBe(rollback);
    });
});
