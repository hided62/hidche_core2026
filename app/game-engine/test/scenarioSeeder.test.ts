import { createGamePostgresConnector } from '@sammo-ts/infra';
import { describe, expect, test } from 'vitest';
import { resolveDatabaseUrl } from '../src/scenario/databaseUrl.js';
import { loadScenarioDefinitionById } from '../src/scenario/scenarioLoader.js';
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
        findUnique(args: { where: { id: number } }): Promise<{
            population: number;
            agriculture: number;
            commerce: number;
            security: number;
            trust: number;
            defence: number;
            wall: number;
        } | null>;
    };
    general: {
        count(): Promise<number>;
        findFirst(): Promise<{ age: number; startAge: number; meta: unknown } | null>;
    };
    diplomacy: {
        count(): Promise<number>;
        findFirst(args: {
            where: { srcNationId: number; destNationId: number };
        }): Promise<{ stateCode: number; term: number } | null>;
    };
    event: {
        count(): Promise<number>;
    };
    worldState: {
        findFirst(): Promise<{
            config: unknown;
            meta: unknown;
            tickSeconds: number;
            currentYear: number;
            currentMonth: number;
        } | null>;
    };
};

const requiredTables = [
    'world_state',
    'nation',
    'city',
    'general',
    'diplomacy',
    'troop',
    'event',
];

const hasRequiredTables = async (prisma: ScenarioSeederPrismaClient, schemaName: string): Promise<boolean> => {
    for (const table of requiredTables) {
        const result = (await prisma.$queryRawUnsafe(
            `SELECT to_regclass('${schemaName}.${table}')::text as regclass`
        )) as Array<{ regclass: string | null }>;
        if (!Array.isArray(result) || result.length === 0 || result[0]?.regclass === null) {
            return false;
        }
    }
    return true;
};

const canConnectToDatabase = async (url: string): Promise<boolean> => {
    const connector = createGamePostgresConnector({ url });
    try {
        await connector.connect();
        const prisma = connector.prisma as unknown as ScenarioSeederPrismaClient;
        await prisma.$queryRawUnsafe('SELECT 1');
        if (!(await hasRequiredTables(prisma, schema))) {
            return false;
        }
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
            const [nationCount, cityCount, generalCount, diplomacyCount, eventCount] = await Promise.all([
                prisma.nation.count(),
                prisma.city.count(),
                prisma.general.count(),
                prisma.diplomacy.count(),
                prisma.event.count(),
            ]);

            expect(nationCount).toBe(seed.nations.length);
            expect(cityCount).toBe(seed.cities.length);
            expect(generalCount).toBe(seed.generals.length);
            expect(diplomacyCount).toBe(seed.nations.length * Math.max(0, seed.nations.length - 1));
            expect(eventCount).toBe(seed.events.length);
            expect(generalCount).toBeGreaterThan(0);
            const seededGeneral = await prisma.general.findFirst();
            expect(seededGeneral?.startAge).toBe(seededGeneral?.age);
            expect(seededGeneral?.meta).toEqual(
                expect.objectContaining({
                    specage: expect.any(Number),
                    specage2: expect.any(Number),
                })
            );

            const freeCity = seed.cities.find((city) => city.nationId === 0);
            const occupiedCity = seed.cities.find((city) => city.nationId !== 0);
            expect(freeCity).toMatchObject({
                population: freeCity ? Math.round(freeCity.populationMax * 0.7) : undefined,
                agriculture: freeCity ? Math.round(freeCity.agricultureMax * 0.7) : undefined,
                commerce: freeCity ? Math.round(freeCity.commerceMax * 0.7) : undefined,
                security: freeCity ? Math.round(freeCity.securityMax * 0.7) : undefined,
                trust: 80,
            });
            expect(occupiedCity).toMatchObject({
                population: occupiedCity ? Math.round(occupiedCity.populationMax * 0.7) : undefined,
                defence: occupiedCity ? Math.round(occupiedCity.defenceMax * 0.7) : undefined,
                wall: occupiedCity ? Math.round(occupiedCity.wallMax * 0.7) : undefined,
                trust: 80,
            });
            for (const city of [freeCity, occupiedCity]) {
                expect(city).toBeDefined();
                if (!city) {
                    continue;
                }
                expect(await prisma.city.findUnique({ where: { id: city.id } })).toMatchObject({
                    population: city.population,
                    agriculture: city.agriculture,
                    commerce: city.commerce,
                    security: city.security,
                    trust: city.trust,
                    defence: city.defence,
                    wall: city.wall,
                });
            }

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

    test('applies install options to world state', async () => {
        const scenario = await loadScenarioDefinitionById(scenarioId);
        const { seed } = await seedScenarioToDatabase({
            scenarioId,
            databaseUrl,
            now: new Date('2030-01-01T00:00:00Z'),
            installOptions: {
                turnTermMinutes: 60,
                sync: false,
                fiction: 1,
                extend: false,
                blockGeneralCreate: 2,
                npcMode: 0,
                showImgLevel: 3,
                tournamentTrig: true,
                joinMode: 'full',
                autorunUser: {
                    limitMinutes: 60,
                    options: {
                        develop: true,
                    },
                },
            },
        });

        // Future-born entries are converted to delayed events, so the raw
        // scenario array length is not the installed general count.
        expect(seed.generals.length).toBeGreaterThan(0);
        expect(seed.generals.length).toBeLessThan(
            scenario.generals.length + scenario.generalsNeutral.length + scenario.generalsEx.length
        );

        const connector = createGamePostgresConnector({ url: databaseUrl });
        await connector.connect();
        try {
            const prisma = connector.prisma as unknown as ScenarioSeederPrismaClient;
            const worldState = await prisma.worldState.findFirst();
            expect(worldState).not.toBeNull();
            if (!worldState) {
                return;
            }
            expect(worldState.tickSeconds).toBe(3600);
            expect(worldState.currentMonth).toBe(1);

            const config = (worldState.config ?? {}) as Record<string, unknown>;
            expect(config.extendedGeneral).toBe(false);
            expect(config.joinMode).toBe('full');

            const meta = (worldState.meta ?? {}) as Record<string, unknown>;
            const autorun = (meta.autorun_user ?? {}) as Record<string, unknown>;
            const autorunOptions = (autorun.options ?? {}) as Record<string, unknown>;
            expect(autorunOptions.develop).toBe(true);
        } finally {
            await connector.disconnect();
        }
    });
});

describe('tracked scenario composition', () => {
    test('loads the shared event and buyable unique extensions', async () => {
        const standard = await loadScenarioDefinitionById(1010);
        const expanded = await loadScenarioDefinitionById(2141);
        const mixedConst = await loadScenarioDefinitionById(2904);

        expect(standard.events).toHaveLength(1);
        expect(standard.initialEvents).toHaveLength(1);
        expect(expanded.events).toHaveLength(7);
        expect(expanded.initialEvents).toHaveLength(1);
        expect(expanded.config.const.availableSpecialWar).toHaveLength(20);
        expect(Object.keys(expanded.config.const.allItems as object)).toEqual(['horse', 'weapon', 'book', 'item']);
        expect(mixedConst.config.const.scenarioEffect).toBe('event_StrongAttacker');
        expect(mixedConst.config.const.availableSpecialWar).toEqual(expanded.config.const.availableSpecialWar);
        expect(mixedConst.config.const.allItems).toEqual(expanded.config.const.allItems);
    });
});
