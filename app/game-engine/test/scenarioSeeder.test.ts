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
    selectPoolEntry: {
        count(): Promise<number>;
        findFirst(args: { orderBy: { id: 'asc' | 'desc' } }): Promise<{ uniqueName: string; info: unknown } | null>;
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
            clockWallAnchor: Date | null;
        } | null>;
    };
    gameHistory: {
        findUnique(args: { where: { serverId: string } }): Promise<{ env: unknown } | null>;
        deleteMany(args: { where: { serverId: string } }): Promise<{ count: number }>;
    };
};

const requiredTables = ['world_state', 'nation', 'city', 'general', 'diplomacy', 'troop', 'event'];

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
    test('persists each blank-land scenario item contract without leaking the shared addon', async () => {
        const readPersistedItemContract = async (targetScenarioId: number) => {
            const { applied } = await seedScenarioToDatabase({
                scenarioId: targetScenarioId,
                databaseUrl,
            });

            const connector = createGamePostgresConnector({ url: databaseUrl });
            await connector.connect();
            try {
                const worldState = await connector.prisma.worldState.findFirstOrThrow();
                const config = worldState.config as Record<string, unknown>;
                const scenarioConst = (config.const ?? {}) as Record<string, unknown>;
                const allItems = (scenarioConst.allItems ?? {}) as Record<string, Record<string, number>>;
                const items = allItems.item ?? {};
                const availableSpecialWar = (scenarioConst.availableSpecialWar ?? []) as string[];

                return {
                    applied,
                    battleTraitItemCount: Object.keys(items).filter((key) => key.startsWith('event_전투특기_')).length,
                    availableSpecialWar,
                    items,
                };
            } finally {
                await connector.disconnect();
            }
        };

        const ordinaryBlank = await readPersistedItemContract(0);
        const legacySecretBlank = await readPersistedItemContract(902);

        expect(ordinaryBlank).toMatchObject({
            applied: true,
            battleTraitItemCount: 0,
            availableSpecialWar: [],
        });
        expect(legacySecretBlank.applied).toBe(true);
        expect(legacySecretBlank.battleTraitItemCount).toBe(19);
        expect(legacySecretBlank.availableSpecialWar).toHaveLength(19);
        expect(legacySecretBlank.items).not.toHaveProperty('event_전투특기_견고');
        expect(legacySecretBlank.availableSpecialWar).not.toContain('che_견고');
    });

    test('snapshots the complete opening inheritance balance before game activity', async () => {
        const serverId = 'scenario-seeder-inheritance-baseline';
        const userId = 'scenario-seeder-inheritance-user';
        const connector = createGamePostgresConnector({ url: databaseUrl });
        await connector.connect();
        try {
            await connector.prisma.gameInheritanceBaseline.deleteMany({ where: { serverId } });
            await connector.prisma.gameHistory.deleteMany({ where: { serverId } });
            await connector.prisma.inheritancePoint.deleteMany({ where: { userId } });
            await connector.prisma.inheritancePoint.createMany({
                data: [
                    { userId, key: 'previous', value: 10_000 },
                    { userId, key: 'lived_month', value: 351.9 },
                ],
            });

            await seedScenarioToDatabase({
                scenarioId: 903,
                databaseUrl,
                installOptions: { serverId },
            });

            await expect(
                connector.prisma.gameInheritanceBaseline.findUniqueOrThrow({
                    where: { serverId_userId: { serverId, userId } },
                })
            ).resolves.toMatchObject({ openingPoint: 10_351, source: 'OPENING' });
        } finally {
            await connector.prisma.gameInheritanceBaseline.deleteMany({ where: { serverId } });
            await connector.prisma.gameHistory.deleteMany({ where: { serverId } });
            await connector.prisma.inheritancePoint.deleteMany({ where: { userId } });
            await connector.disconnect();
        }
    });

    test('adds the configured first game index without counting cancelled or unfinished games', async () => {
        const marker = `scenario-seeder-game-index-${Date.now()}`;
        const connector = createGamePostgresConnector({ url: databaseUrl });
        await connector.connect();
        try {
            const completedBefore = await connector.prisma.gameHistory.count({ where: { status: 'COMPLETED' } });
            expect(completedBefore).toBe(0);

            await seedScenarioToDatabase({
                scenarioId: 1010,
                databaseUrl,
                installOptions: { serverId: `${marker}-zero`, firstGameIdx: 0 },
            });
            const zeroWorldState = await connector.prisma.worldState.findFirstOrThrow();
            expect(zeroWorldState.meta).toMatchObject({ firstGameIdx: 0, gameIdx: 0 });
            const zeroBasedHistory = await connector.prisma.gameHistory.findUniqueOrThrow({
                where: { serverId: `${marker}-zero` },
            });
            expect(zeroBasedHistory).toMatchObject({ status: 'OPEN' });
            expect(zeroBasedHistory.env).toMatchObject({ meta: { firstGameIdx: 0, gameIdx: 0 } });
            await connector.prisma.gameHistory.update({
                where: { serverId: `${marker}-zero` },
                data: { status: 'COMPLETED' },
            });

            await connector.prisma.gameHistory.createMany({
                data: [
                    {
                        serverId: `${marker}-abandoned`,
                        date: new Date('2026-08-02T00:00:00.000Z'),
                        season: 1,
                        scenario: 1010,
                        scenarioName: '취소 fixture',
                        status: 'ABANDONED',
                    },
                    {
                        serverId: `${marker}-open`,
                        date: new Date('2026-08-03T00:00:00.000Z'),
                        season: 1,
                        scenario: 1010,
                        scenarioName: '미완료 fixture',
                        status: 'OPEN',
                    },
                ],
            });

            await seedScenarioToDatabase({
                scenarioId: 1010,
                databaseUrl,
                installOptions: { serverId: `${marker}-one`, firstGameIdx: 0 },
            });

            const worldState = await connector.prisma.worldState.findFirstOrThrow();
            expect(worldState.meta).toMatchObject({ firstGameIdx: 0, gameIdx: completedBefore + 1 });
            const oneBasedHistory = await connector.prisma.gameHistory.findUniqueOrThrow({
                where: { serverId: `${marker}-one` },
            });
            expect(oneBasedHistory).toMatchObject({ status: 'OPEN' });
            expect(oneBasedHistory.env).toMatchObject({
                meta: { firstGameIdx: 0, gameIdx: completedBefore + 1 },
            });

            await seedScenarioToDatabase({
                scenarioId: 1010,
                databaseUrl,
                installOptions: { serverId: `${marker}-default` },
            });
            const defaultWorldState = await connector.prisma.worldState.findFirstOrThrow();
            expect(defaultWorldState.meta).toMatchObject({ firstGameIdx: 1, gameIdx: completedBefore + 2 });
        } finally {
            await connector.prisma.gameHistory.deleteMany({ where: { serverId: { startsWith: marker } } });
            await connector.disconnect();
        }
    });

    test('writes scenario data into tables', async () => {
        const { seed } = await seedScenarioToDatabase({
            scenarioId,
            databaseUrl,
        });

        const connector = createGamePostgresConnector({ url: databaseUrl });
        await connector.connect();
        try {
            const prisma = connector.prisma as unknown as ScenarioSeederPrismaClient;
            const worldState = await prisma.worldState.findFirst();
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
            expect(worldState?.config).toMatchObject({ tournamentTrig: true });
            expect(generalCount).toBeGreaterThan(0);
            const seededGeneral = await prisma.general.findFirst();
            expect(seededGeneral?.startAge).toBe(20);
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
                tournamentTrig: false,
                joinMode: 'full',
                autorunUser: {
                    limitMinutes: 60,
                    options: {
                        develop: true,
                    },
                },
                preopenAt: new Date('2030-01-01T01:00:00Z'),
                openAt: new Date('2030-01-01T02:00:00Z'),
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
            expect(worldState.clockWallAnchor).toEqual(new Date('2030-01-01T02:00:00.000Z'));

            const config = (worldState.config ?? {}) as Record<string, unknown>;
            expect(config.extendedGeneral).toBe(false);
            expect(config.joinMode).toBe('full');
            expect(config.tournamentTrig).toBe(false);

            const meta = (worldState.meta ?? {}) as Record<string, unknown>;
            expect(meta.develcost).toBe(
                (worldState.currentYear - (scenario.startYear ?? worldState.currentYear) + 10) * 2
            );
            expect(meta.killturn).toBe(80);
            const autorun = (meta.autorun_user ?? {}) as Record<string, unknown>;
            const autorunOptions = (autorun.options ?? {}) as Record<string, unknown>;
            expect(autorunOptions.develop).toBe(true);
        } finally {
            await connector.disconnect();
        }
    });

    test('persists a tracked scenario effect in the world configuration', async () => {
        await seedScenarioToDatabase({
            scenarioId: 906,
            databaseUrl,
        });

        const connector = createGamePostgresConnector({ url: databaseUrl });
        await connector.connect();
        try {
            const prisma = connector.prisma as unknown as ScenarioSeederPrismaClient;
            const worldState = await prisma.worldState.findFirst();
            const config = (worldState?.config ?? {}) as Record<string, unknown>;
            const environment = (config.environment ?? {}) as Record<string, unknown>;
            expect(environment.scenarioEffect).toBe('event_StrongAttacker');
        } finally {
            await connector.disconnect();
        }
    });

    test('seeds the exact scenario 903 UnderS30 selection pool', async () => {
        await seedScenarioToDatabase({
            scenarioId: 903,
            databaseUrl,
        });

        const connector = createGamePostgresConnector({ url: databaseUrl });
        await connector.connect();
        try {
            const prisma = connector.prisma as unknown as ScenarioSeederPrismaClient;
            expect(await prisma.selectPoolEntry.count()).toBe(1844);
            expect(await prisma.selectPoolEntry.findFirst({ orderBy: { id: 'asc' } })).toMatchObject({
                uniqueName: '⑨탈곡기',
                info: {
                    generalName: '⑨탈곡기',
                    specialDomestic: 'che_event_징병',
                },
            });
            expect(await prisma.selectPoolEntry.findFirst({ orderBy: { id: 'desc' } })).toMatchObject({
                uniqueName: '④야부키 나코',
            });
        } finally {
            await connector.disconnect();
        }
    });

    test('clears general lifecycle rows before reusing general ids on reseed', async () => {
        await seedScenarioToDatabase({
            scenarioId: 903,
            databaseUrl,
        });

        const connector = createGamePostgresConnector({ url: databaseUrl });
        await connector.connect();
        try {
            const prisma = connector.prisma;
            const generalId = 990_903;
            const createSelectedGeneral = async (): Promise<void> => {
                await prisma.general.create({
                    data: {
                        id: generalId,
                        userId: 'scenario-reseed-user',
                        name: '재설치선택장수',
                        turnTime: new Date('2026-07-30T12:00:00.000Z'),
                    },
                });
            };
            const createLifecycleRows = async (): Promise<void> => {
                await prisma.generalTurn.create({
                    data: {
                        generalId,
                        turnIdx: 0,
                        actionCode: '휴식',
                    },
                });
                await prisma.generalTurnRevision.create({
                    data: {
                        generalId,
                        revision: 7,
                    },
                });
                await prisma.rankData.create({
                    data: {
                        nationId: 0,
                        generalId,
                        type: 'experience',
                        value: 123,
                    },
                });
                await prisma.generalAccessLog.create({
                    data: {
                        generalId,
                        userId: 'scenario-reseed-user',
                    },
                });
            };
            const expectLifecycleRows = async (count: number): Promise<void> => {
                await expect(
                    Promise.all([
                        prisma.generalTurn.count({ where: { generalId } }),
                        prisma.generalTurnRevision.count({ where: { generalId } }),
                        prisma.rankData.count({ where: { generalId } }),
                        prisma.generalAccessLog.count({ where: { generalId } }),
                    ])
                ).resolves.toEqual([count, count, count, count]);
            };

            await createSelectedGeneral();
            await createLifecycleRows();
            await expectLifecycleRows(1);

            await seedScenarioToDatabase({
                scenarioId: 903,
                databaseUrl,
            });
            await expectLifecycleRows(0);
            await expect(prisma.general.findUnique({ where: { id: generalId } })).resolves.toBeNull();

            await createSelectedGeneral();
            await createLifecycleRows();
            await expectLifecycleRows(1);

            await seedScenarioToDatabase({
                scenarioId: 903,
                databaseUrl,
            });
            await expectLifecycleRows(0);
        } finally {
            await connector.disconnect();
        }
    });

    test('persists a private hidden seed without copying it into game history', async () => {
        const envName = 'INTEGRATION_WORLD_SEED';
        const originalSeed = process.env[envName];
        const serverId = 'scenario-seeder-hidden-seed-test';
        const connector = createGamePostgresConnector({ url: databaseUrl });
        try {
            process.env[envName] = 'scenario-seeder-explicit-hidden-seed';
            await seedScenarioToDatabase({
                scenarioId: 903,
                databaseUrl,
                installOptions: { serverId },
            });

            await connector.connect();
            const prisma = connector.prisma as unknown as ScenarioSeederPrismaClient;
            const explicitWorld = await prisma.worldState.findFirst();
            expect(explicitWorld?.meta).toMatchObject({
                hiddenSeed: 'scenario-seeder-explicit-hidden-seed',
            });
            const explicitHistory = await prisma.gameHistory.findUnique({ where: { serverId } });
            expect((explicitHistory?.env as { meta?: Record<string, unknown> })?.meta).not.toHaveProperty('hiddenSeed');

            delete process.env[envName];
            await seedScenarioToDatabase({
                scenarioId: 903,
                databaseUrl,
                installOptions: { serverId },
            });
            const randomWorld = await prisma.worldState.findFirst();
            const randomSeed = (randomWorld?.meta as Record<string, unknown>)?.hiddenSeed;
            expect(randomSeed).toMatch(/^[0-9a-f]{32}$/);
            expect(randomSeed).not.toBe('scenario-seeder-explicit-hidden-seed');
            const randomHistory = await prisma.gameHistory.findUnique({ where: { serverId } });
            expect((randomHistory?.env as { meta?: Record<string, unknown> })?.meta).not.toHaveProperty('hiddenSeed');
            await prisma.gameHistory.deleteMany({ where: { serverId } });
        } finally {
            if (originalSeed === undefined) {
                delete process.env[envName];
            } else {
                process.env[envName] = originalSeed;
            }
            await connector.disconnect();
        }
    });

    test('serializes and skips the same committed install generation inside the seed transaction', async () => {
        const envName = 'INTEGRATION_WORLD_SEED';
        const originalSeed = process.env[envName];
        const serverId = 'scenario-seeder-idempotent-generation';
        const installOperationId = 'scenario-seeder-idempotent-operation';
        const installCommitSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        const connector = createGamePostgresConnector({ url: databaseUrl });
        try {
            process.env[envName] = 'scenario-seeder-idempotent-hidden-seed';
            const results = await Promise.all([
                seedScenarioToDatabase({
                    scenarioId: 1010,
                    databaseUrl,
                    installOptions: { serverId, installOperationId, installCommitSha },
                }),
                seedScenarioToDatabase({
                    scenarioId: 1010,
                    databaseUrl,
                    installOptions: { serverId, installOperationId, installCommitSha },
                }),
            ]);
            expect(results.map(({ applied }) => applied).sort()).toEqual([false, true]);

            await connector.connect();
            const worldBeforeMismatch = await connector.prisma.worldState.findFirstOrThrow();
            expect(worldBeforeMismatch.meta).toMatchObject({
                hiddenSeed: 'scenario-seeder-idempotent-hidden-seed',
                installOperationId,
                installCommitSha,
            });
            await expect(
                seedScenarioToDatabase({
                    scenarioId: 903,
                    databaseUrl,
                    installOptions: {
                        serverId,
                        installOperationId,
                        installCommitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
                    },
                })
            ).rejects.toThrow('belongs to a different source commit');
            await expect(connector.prisma.worldState.findFirstOrThrow()).resolves.toEqual(worldBeforeMismatch);
            await expect(connector.prisma.gameHistory.count({ where: { serverId } })).resolves.toBe(1);
        } finally {
            if (originalSeed === undefined) {
                delete process.env[envName];
            } else {
                process.env[envName] = originalSeed;
            }
            await connector.prisma.gameHistory.deleteMany({ where: { serverId } });
            await connector.disconnect();
        }
    });

    test('rolls back the complete season replacement when the final seed hook fails', async () => {
        const envName = 'INTEGRATION_WORLD_SEED';
        const originalSeed = process.env[envName];
        const baselineServerId = 'scenario-seeder-rollback-baseline';
        const failedServerId = 'scenario-seeder-rollback-failed';
        const connector = createGamePostgresConnector({ url: databaseUrl });
        try {
            process.env[envName] = 'scenario-seeder-rollback-hidden-seed';
            await seedScenarioToDatabase({
                scenarioId: 1010,
                databaseUrl,
                now: new Date('2031-01-01T00:00:00.000Z'),
                installOptions: {
                    serverId: baselineServerId,
                    installOperationId: 'baseline-operation',
                },
            });

            await connector.connect();
            const prisma = connector.prisma;
            const readSnapshot = async () => ({
                world: await prisma.worldState.findMany({ orderBy: { id: 'asc' } }),
                nations: await prisma.nation.findMany({ orderBy: { id: 'asc' } }),
                cities: await prisma.city.findMany({ orderBy: { id: 'asc' } }),
                generals: await prisma.general.findMany({ orderBy: { id: 'asc' } }),
                troops: await prisma.troop.findMany({ orderBy: { troopLeaderId: 'asc' } }),
                diplomacy: await prisma.diplomacy.findMany({ orderBy: { id: 'asc' } }),
                events: await prisma.event.findMany({ orderBy: { id: 'asc' } }),
                history: await prisma.gameHistory.findMany({ orderBy: { id: 'asc' } }),
            });
            const before = await readSnapshot();

            await expect(
                seedScenarioToDatabase({
                    scenarioId: 903,
                    databaseUrl,
                    now: new Date('2032-01-01T00:00:00.000Z'),
                    installOptions: {
                        serverId: baselineServerId,
                        installOperationId: 'colliding-operation',
                    },
                })
            ).rejects.toThrow('Game history serverId collision');
            expect(await readSnapshot()).toEqual(before);

            await expect(
                seedScenarioToDatabase({
                    scenarioId: 903,
                    databaseUrl,
                    now: new Date('2032-02-02T00:00:00.000Z'),
                    installOptions: {
                        serverId: failedServerId,
                        installOperationId: 'failed-operation',
                    },
                    onBeforeCommit: async () => {
                        throw new Error('injected final seed failure');
                    },
                })
            ).rejects.toThrow('injected final seed failure');

            expect(await readSnapshot()).toEqual(before);
            await expect(prisma.gameHistory.findUnique({ where: { serverId: failedServerId } })).resolves.toBeNull();
        } finally {
            if (originalSeed === undefined) {
                delete process.env[envName];
            } else {
                process.env[envName] = originalSeed;
            }
            await connector.prisma.gameHistory.deleteMany({
                where: { serverId: { in: [baselineServerId, failedServerId] } },
            });
            await connector.disconnect();
        }
    });

    test('clears current-season services while preserving archive and diagnostic data', async () => {
        const marker = 'scenario-reset-boundary';
        const serverId = 'rst-boundary-server';
        const connector = createGamePostgresConnector({ url: databaseUrl });
        await seedScenarioToDatabase({ scenarioId: 1010, databaseUrl });
        await connector.connect();
        const prisma = connector.prisma;
        try {
            const world = await prisma.worldState.findFirstOrThrow();
            const general = await prisma.general.findFirstOrThrow({ orderBy: { id: 'asc' } });
            const nation = await prisma.nation.findFirstOrThrow({ orderBy: { id: 'asc' } });
            const trafficPeriod = await prisma.trafficPeriod.create({
                data: {
                    worldStateId: world.id,
                    year: 999,
                    month: 12,
                    startedAt: new Date('2033-01-01T00:00:00.000Z'),
                    lastRefresh: new Date('2033-01-01T00:00:00.000Z'),
                },
            });
            await prisma.trafficPeriodGeneral.create({
                data: {
                    periodId: trafficPeriod.id,
                    generalId: general.id,
                    refresh: 1,
                    lastRefresh: new Date('2033-01-01T00:00:00.000Z'),
                },
            });
            await prisma.inputEvent.create({
                data: { requestId: marker, target: 'API', eventType: marker },
            });
            await prisma.turnDaemonLease.create({
                data: {
                    profile: marker,
                    ownerId: marker,
                    leaseUntil: new Date('2033-01-01T00:00:00.000Z'),
                },
            });
            await prisma.npcSelectionToken.create({
                data: {
                    ownerUserId: marker,
                    validUntil: new Date('2033-01-01T00:00:00.000Z'),
                    pickMoreFrom: new Date('2033-01-01T00:00:00.000Z'),
                    pickResult: {},
                    nonce: 1,
                },
            });
            await prisma.messageReadState.create({ data: { generalId: general.id } });
            await prisma.message.create({
                data: {
                    mailbox: general.id,
                    type: marker,
                    src: general.id,
                    dest: general.id,
                    time: new Date('2033-01-01T00:00:00.000Z'),
                    validUntil: new Date('2033-02-01T00:00:00.000Z'),
                    message: { marker },
                },
            });
            await prisma.nationTurn.create({
                data: { nationId: nation.id, officerLevel: 12, turnIdx: 0, actionCode: marker },
            });
            await prisma.nationTurnRevision.create({
                data: { nationId: nation.id, officerLevel: 12, revision: 1 },
            });
            await prisma.diplomacyLetter.create({
                data: {
                    srcNationId: nation.id,
                    destNationId: 0,
                    state: 'PROPOSED',
                    textBrief: marker,
                    textDetail: marker,
                    srcSignerId: general.id,
                },
            });
            const auction = await prisma.auction.create({
                data: {
                    type: 'UNIQUE_ITEM',
                    targetCode: marker,
                    hostGeneralId: general.id,
                    status: 'OPEN',
                    closeAt: new Date('2033-01-01T00:00:00.000Z'),
                },
            });
            await prisma.auctionBid.create({
                data: {
                    auctionId: auction.id,
                    generalId: general.id,
                    amount: 1,
                    eventId: marker,
                    eventAt: new Date('2033-01-01T00:00:00.000Z'),
                },
            });
            const bettingId = 990_731;
            await prisma.nationBetting.create({
                data: {
                    id: bettingId,
                    name: marker,
                    selectCount: 1,
                    openYearMonth: 99901,
                    closeYearMonth: 99902,
                    candidates: [{ id: nation.id }],
                },
            });
            await prisma.nationBet.create({
                data: {
                    bettingId,
                    generalId: general.id,
                    userId: marker,
                    selection: [nation.id],
                    selectionKey: String(nation.id),
                    amount: 1,
                },
            });
            const post = await prisma.boardPost.create({
                data: {
                    nationId: nation.id,
                    authorGeneralId: general.id,
                    authorName: marker,
                    title: marker,
                    contentHtml: marker,
                },
            });
            await prisma.boardComment.create({
                data: {
                    postId: post.id,
                    nationId: nation.id,
                    authorGeneralId: general.id,
                    authorName: marker,
                    contentText: marker,
                },
            });
            const poll = await prisma.votePoll.create({
                data: {
                    title: marker,
                    options: [marker],
                    revealMode: 'never',
                    openerGeneralId: general.id,
                    openerName: marker,
                },
            });
            await prisma.vote.create({
                data: { voteId: poll.id, generalId: general.id, nationId: nation.id, selection: [0] },
            });
            await prisma.voteComment.create({
                data: {
                    voteId: poll.id,
                    generalId: general.id,
                    nationId: nation.id,
                    generalName: marker,
                    nationName: marker,
                    text: marker,
                },
            });
            await prisma.logEntry.create({
                data: { scope: 'SYSTEM', category: 'HISTORY', year: 999, month: 12, text: marker },
            });

            await prisma.errorLog.create({ data: { category: marker, message: marker } });
            await prisma.inheritancePoint.create({ data: { userId: marker, key: marker, value: 1 } });
            await prisma.inheritanceLog.create({
                data: { userId: marker, serverId, year: 999, month: 12, text: marker },
            });
            await prisma.inheritanceResult.create({
                data: { serverId, owner: marker, generalId: general.id, year: 999, month: 12, value: { marker } },
            });
            await prisma.inheritanceUserState.create({ data: { userId: marker, meta: { marker } } });
            await prisma.gameHistory.create({
                data: {
                    serverId,
                    date: new Date('2033-01-01T00:00:00.000Z'),
                    season: 1,
                    scenario: 1010,
                    scenarioName: marker,
                    env: { marker },
                },
            });
            await prisma.oldNation.create({ data: { serverId, nation: 1, sourceId: 1, data: { marker } } });
            await prisma.oldGeneral.create({
                data: {
                    serverId,
                    generalNo: general.id,
                    owner: marker,
                    name: marker,
                    lastYearMonth: 99912,
                    turnTime: new Date('2033-01-01T00:00:00.000Z'),
                    data: { marker },
                },
            });
            await prisma.emperor.create({ data: { serverId, name: marker, history: { marker }, aux: { marker } } });
            await prisma.unificationFinalization.create({
                data: {
                    generationKey: `unification:${serverId}`,
                    serverId,
                    profileName: marker,
                    winnerNation: 1,
                    year: 999,
                    month: 12,
                    completedAt: new Date('2033-01-01T00:00:00.000Z'),
                },
            });
            await prisma.yearbookHistory.create({
                data: {
                    profileName: marker,
                    year: 999,
                    month: 12,
                    map: { marker },
                    nations: [{ marker }],
                    globalHistory: [`${marker}-history`],
                    globalAction: [`${marker}-action`],
                    hash: `${marker}-hash`,
                },
            });
            await prisma.legacyGameStorage.create({
                data: { sourceId: 990_731, namespace: marker, key: marker, value: {}, scope: marker },
            });
            await prisma.hallOfFame.create({
                data: {
                    serverId,
                    season: 1,
                    scenario: 1010,
                    generalNo: general.id,
                    type: 'reset-boundary',
                    value: 1,
                },
            });

            await seedScenarioToDatabase({ scenarioId: 903, databaseUrl });

            await expect(
                Promise.all([
                    prisma.inputEvent.count({ where: { requestId: marker } }),
                    prisma.turnDaemonLease.count({ where: { profile: marker } }),
                    prisma.npcSelectionToken.count({ where: { ownerUserId: marker } }),
                    prisma.trafficPeriod.count({ where: { id: trafficPeriod.id } }),
                    prisma.message.count({ where: { type: marker } }),
                    prisma.nationTurn.count({ where: { actionCode: marker } }),
                    prisma.diplomacyLetter.count({ where: { textBrief: marker } }),
                    prisma.auction.count({ where: { targetCode: marker } }),
                    prisma.nationBetting.count({ where: { id: bettingId } }),
                    prisma.boardPost.count({ where: { title: marker } }),
                    prisma.votePoll.count({ where: { title: marker } }),
                    prisma.logEntry.count({ where: { text: marker } }),
                ])
            ).resolves.toEqual(Array.from({ length: 12 }, () => 0));
            await expect(
                Promise.all([
                    prisma.errorLog.count({ where: { category: marker } }),
                    prisma.inheritancePoint.count({ where: { userId: marker } }),
                    prisma.inheritanceLog.count({ where: { userId: marker } }),
                    prisma.inheritanceResult.count({ where: { owner: marker } }),
                    prisma.inheritanceUserState.count({ where: { userId: marker } }),
                    prisma.gameHistory.count({ where: { serverId } }),
                    prisma.oldNation.count({ where: { serverId } }),
                    prisma.oldGeneral.count({ where: { serverId } }),
                    prisma.emperor.count({ where: { serverId } }),
                    prisma.unificationFinalization.count({ where: { serverId } }),
                    prisma.yearbookHistory.count({ where: { profileName: marker } }),
                    prisma.legacyGameStorage.count({ where: { namespace: marker } }),
                    prisma.hallOfFame.count({ where: { serverId } }),
                ])
            ).resolves.toEqual(Array.from({ length: 13 }, () => 1));
            await expect(
                prisma.yearbookHistory.findUniqueOrThrow({
                    where: {
                        profileName_year_month_sourceId: {
                            profileName: marker,
                            year: 999,
                            month: 12,
                            sourceId: 0,
                        },
                    },
                })
            ).resolves.toMatchObject({
                map: { marker },
                nations: [{ marker }],
                globalHistory: [`${marker}-history`],
                globalAction: [`${marker}-action`],
                hash: `${marker}-hash`,
            });
        } finally {
            await prisma.errorLog.deleteMany({ where: { category: marker } });
            await prisma.inheritancePoint.deleteMany({ where: { userId: marker } });
            await prisma.inheritanceLog.deleteMany({ where: { userId: marker } });
            await prisma.inheritanceResult.deleteMany({ where: { owner: marker } });
            await prisma.inheritanceUserState.deleteMany({ where: { userId: marker } });
            await prisma.oldNation.deleteMany({ where: { serverId } });
            await prisma.oldGeneral.deleteMany({ where: { serverId } });
            await prisma.emperor.deleteMany({ where: { serverId } });
            await prisma.unificationFinalization.deleteMany({ where: { serverId } });
            await prisma.gameHistory.deleteMany({ where: { serverId } });
            await prisma.yearbookHistory.deleteMany({ where: { profileName: marker } });
            await prisma.legacyGameStorage.deleteMany({ where: { namespace: marker } });
            await prisma.hallOfFame.deleteMany({ where: { serverId } });
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
