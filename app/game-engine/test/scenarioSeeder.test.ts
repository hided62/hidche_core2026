import { createGamePostgresConnector } from '@sammo-ts/infra';
import { describe, expect, test } from 'vitest';
import { resolveDatabaseUrl } from '../src/scenario/databaseUrl.js';
import { seedScenarioToDatabase } from '../src/scenario/scenarioSeeder.js';

const scenarioId = 1010;
const schema = process.env.POSTGRES_SCHEMA ?? 'public';
process.env.POSTGRES_SCHEMA = schema;
const databaseUrl = await resolveDatabaseUrl({ schema });

type ScenarioSeederPrismaClient = {
    $queryRawUnsafe(query: string): Promise<unknown>;
    nation: {
        count(): Promise<number>;
    };
    city: {
        count(): Promise<number>;
    };
    general: {
        count(): Promise<number>;
    };
    diplomacy: {
        count(): Promise<number>;
        findFirst(args: {
            where: { srcNationId: number; destNationId: number };
        }): Promise<{ stateCode: number; term: number } | null>;
    };
};

const canConnectToDatabase = async (url: string): Promise<boolean> => {
    const connector = createGamePostgresConnector({ url });
    try {
        await connector.connect();
        const prisma = connector.prisma as unknown as ScenarioSeederPrismaClient;
        await prisma.$queryRawUnsafe('SELECT 1');
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

        const connector = createGamePostgresConnector({ url: databaseUrl });
        await connector.connect();
        try {
            const prisma = connector.prisma as unknown as ScenarioSeederPrismaClient;
            const [nationCount, cityCount, generalCount, diplomacyCount] = await Promise.all([
                prisma.nation.count(),
                prisma.city.count(),
                prisma.general.count(),
                prisma.diplomacy.count(),
            ]);

            expect(nationCount).toBe(seed.nations.length);
            expect(cityCount).toBe(seed.cities.length);
            expect(generalCount).toBe(seed.generals.length);
            expect(diplomacyCount).toBe(seed.nations.length * Math.max(0, seed.nations.length - 1));
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
                    expect(row.term).toBe(sample.durationMonths);
                }
                const reverse = await prisma.diplomacy.findFirst({
                    where: {
                        srcNationId: sample.toNationId,
                        destNationId: sample.fromNationId,
                    },
                });
                expect(reverse).not.toBeNull();
                if (reverse) {
                    expect(reverse.stateCode).toBe(sample.state);
                    expect(reverse.term).toBe(sample.durationMonths);
                }
            }
        } finally {
            await connector.disconnect();
        }
    });
});
