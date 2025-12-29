import { createPostgresConnector } from '@sammo-ts/infra';
import { describe, expect, test } from 'vitest';
import { resolveDatabaseUrl } from '../src/scenario/databaseUrl.js';
import { seedScenarioToDatabase } from '../src/scenario/scenarioSeeder.js';

const scenarioId = 1010;
const databaseUrl = await resolveDatabaseUrl();

const canConnectToDatabase = async (url: string): Promise<boolean> => {
    const connector = createPostgresConnector({ url });
    try {
        await connector.connect();
        await connector.prisma.$queryRawUnsafe('SELECT 1');
        return true;
    } catch {
        return false;
    } finally {
        await connector.disconnect();
    }
};

const canRun = await canConnectToDatabase(databaseUrl);
const describeDb = describe.runIf(canRun);

describeDb('scenario database seed', () => {
    test('writes scenario data into tables', async () => {
        const { seed } = await seedScenarioToDatabase({
            scenarioId,
            databaseUrl,
        });

        const connector = createPostgresConnector({ url: databaseUrl });
        await connector.connect();
        try {
            const prisma = connector.prisma;
            const [
                nationCount,
                cityCount,
                generalCount,
                diplomacyCount,
            ] = await Promise.all([
                prisma.nation.count(),
                prisma.city.count(),
                prisma.general.count(),
                prisma.diplomacy.count(),
            ]);

            expect(nationCount).toBe(seed.nations.length);
            expect(cityCount).toBe(seed.cities.length);
            expect(generalCount).toBe(seed.generals.length);
            expect(diplomacyCount).toBe(seed.diplomacy.length);
            expect(generalCount).toBeGreaterThan(0);

            if (seed.diplomacy.length > 0) {
                const sample = seed.diplomacy[0];
                const row = await prisma.diplomacy.findFirst({
                    where: {
                        srcNationId: sample.fromNationId,
                        destNationId: sample.toNationId,
                    },
                });
                expect(row).not.toBeNull();
                if (row) {
                    expect(row.stateCode).toBe(sample.state);
                }
            }
        } finally {
            await connector.disconnect();
        }
    });
});
