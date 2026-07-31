import path from 'node:path';

import { createGamePostgresConnector } from '@sammo-ts/infra';
import { describe, expect, it } from 'vitest';

import { seedProfileDatabase } from '../src/orchestrator/seedProfileDatabase.js';

const databaseUrl = process.env.PROFILE_SEED_DATABASE_URL;
const schema = process.env.PROFILE_SEED_DATABASE_SCHEMA ?? 'profile_seed_atomicity';
const describeDatabase = describe.runIf(Boolean(databaseUrl));
const resourceRoot = path.resolve(process.cwd(), '../../resources');

describeDatabase('profile seed atomicity', () => {
    it('rolls back the new season when administrator general creation fails', async () => {
        if (!databaseUrl) {
            throw new Error('PROFILE_SEED_DATABASE_URL is required.');
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
            throw new Error('PROFILE_SEED_DATABASE_SCHEMA must be a safe PostgreSQL identifier.');
        }

        const connector = createGamePostgresConnector({ url: databaseUrl });
        await seedProfileDatabase({
            databaseUrl,
            scenarioId: 1010,
            now: new Date('2034-01-01T00:00:00.000Z'),
            installOptions: {
                serverId: 'profile-seed-baseline',
                installOperationId: 'profile-seed-baseline-operation',
            },
            scenarioOptions: { scenarioRoot: path.join(resourceRoot, 'scenario') },
            mapOptions: { mapRoot: path.join(resourceRoot, 'map') },
            unitSetOptions: { unitSetRoot: path.join(resourceRoot, 'unitset') },
        });

        await connector.connect();
        const prisma = connector.prisma;
        const readSnapshot = async () => ({
            world: await prisma.worldState.findMany({ orderBy: { id: 'asc' } }),
            nations: await prisma.nation.findMany({ orderBy: { id: 'asc' } }),
            cities: await prisma.city.findMany({ orderBy: { id: 'asc' } }),
            generals: await prisma.general.findMany({ orderBy: { id: 'asc' } }),
            history: await prisma.gameHistory.findMany({ orderBy: { id: 'asc' } }),
        });
        const before = await readSnapshot();

        try {
            await prisma.$executeRawUnsafe(`
                CREATE OR REPLACE FUNCTION "${schema}".reject_admin_seed()
                RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF NEW.meta ->> 'createdBy' = 'admin-seed' THEN
                        RAISE EXCEPTION 'injected administrator seed failure';
                    END IF;
                    RETURN NEW;
                END;
                $$
            `);
            await prisma.$executeRawUnsafe(`
                CREATE TRIGGER reject_admin_seed
                BEFORE INSERT ON "${schema}"."general"
                FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_admin_seed()
            `);

            await expect(
                seedProfileDatabase({
                    databaseUrl,
                    scenarioId: 903,
                    now: new Date('2035-02-02T00:00:00.000Z'),
                    installOptions: {
                        serverId: 'profile-seed-failed',
                        installOperationId: 'profile-seed-failed-operation',
                    },
                    scenarioOptions: { scenarioRoot: path.join(resourceRoot, 'scenario') },
                    mapOptions: { mapRoot: path.join(resourceRoot, 'map') },
                    unitSetOptions: { unitSetRoot: path.join(resourceRoot, 'unitset') },
                    adminUser: {
                        id: 'profile-seed-admin',
                        username: 'profile-seed-admin',
                        displayName: '프로필 관리자',
                    },
                })
            ).rejects.toThrow('injected administrator seed failure');

            expect(await readSnapshot()).toEqual(before);
            await expect(prisma.general.findFirst({ where: { userId: 'profile-seed-admin' } })).resolves.toBeNull();
            await expect(
                prisma.gameHistory.findUnique({ where: { serverId: 'profile-seed-failed' } })
            ).resolves.toBeNull();
        } finally {
            await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS reject_admin_seed ON "${schema}"."general"`);
            await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${schema}".reject_admin_seed()`);
            await prisma.gameHistory.deleteMany({
                where: { serverId: { in: ['profile-seed-baseline', 'profile-seed-failed'] } },
            });
            await connector.disconnect();
        }
    });
});
