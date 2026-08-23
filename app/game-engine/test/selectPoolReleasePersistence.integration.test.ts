import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGamePostgresConnector, type GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';
import { buildScenarioGeneralPoolClaimMeta } from '@sammo-ts/logic';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { loadTurnWorldFromDatabase } from '../src/turn/worldLoader.js';

const databaseUrl = process.env.SELECT_POOL_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const generalId = 990_904;
const claimedGeneralId = 990_905;
const conflictedGeneralId = 990_906;
const protectedGeneralId = 990_907;
const laterGeneralId = 990_908;
const cityId = 990_904;
const scenarioCode = 'select-pool-release-integration';

const assertDedicatedDatabase = (rawUrl: string): void => {
    const schema = new URL(rawUrl).searchParams.get('schema');
    if (!schema?.endsWith('select_pool_integration')) {
        throw new Error(`Refusing to mutate non-dedicated schema: ${schema ?? '(missing)'}`);
    }
};

integration('select pool release during general deletion', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        assertDedicatedDatabase(databaseUrl!);
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();

        await db.$executeRawUnsafe('DROP TABLE IF EXISTS "select_pool_delete_blocker"');
        await db.selectPoolEntry.deleteMany({
            where: {
                uniqueName: {
                    in: [
                        'release-candidate',
                        'claim-candidate',
                        'conflict-candidate',
                        'early-protected-candidate',
                        'later-free-candidate',
                    ],
                },
            },
        });
        await db.general.deleteMany({
            where: {
                id: { in: [generalId, claimedGeneralId, conflictedGeneralId, protectedGeneralId, laterGeneralId] },
            },
        });
        await db.city.deleteMany({ where: { id: cityId } });
        await db.worldState.deleteMany({ where: { scenarioCode } });

        await db.worldState.create({
            data: {
                scenarioCode,
                currentYear: 180,
                currentMonth: 1,
                tickSeconds: 300,
                config: {
                    npcMode: 2,
                    turnTermMinutes: 5,
                    stat: {
                        total: 165,
                        min: 15,
                        max: 80,
                        npcTotal: 165,
                        npcMax: 80,
                        npcMin: 15,
                        chiefMin: 40,
                    },
                    iconPath: '.',
                    map: {
                        targetGeneralPool: 'SPoolUnderU30',
                        generalPoolAllowOption: ['ego'],
                    },
                    const: {},
                    environment: {
                        mapName: 'che',
                        unitSet: 'che',
                    },
                },
                meta: {
                    hiddenSeed: 'select-pool-release-seed',
                    killturn: 5,
                    turntime: '2026-07-30T12:00:00.000Z',
                },
            },
        });
        await db.city.create({
            data: {
                id: cityId,
                name: '해제성',
                level: 5,
                nationId: 0,
                population: 10_000,
                populationMax: 20_000,
                agriculture: 1_000,
                agricultureMax: 2_000,
                commerce: 1_000,
                commerceMax: 2_000,
                security: 1_000,
                securityMax: 2_000,
                defence: 1_000,
                defenceMax: 2_000,
                wall: 1_000,
                wallMax: 2_000,
                region: 1,
            },
        });
        await db.general.create({
            data: {
                id: generalId,
                userId: 'select-pool-release-user',
                name: '해제대상',
                nationId: 0,
                cityId,
                troopId: 0,
                npcState: 0,
                affinity: 1,
                bornYear: 160,
                deadYear: 240,
                picture: 'default.jpg',
                imageServer: 0,
                leadership: 50,
                strength: 50,
                intel: 50,
                experience: 2_000,
                dedication: 2_000,
                officerLevel: 0,
                turnTime: new Date('2026-07-30T12:01:00.000Z'),
                age: 20,
                startAge: 20,
                personalCode: 'che_안전',
                specialCode: 'che_event_신산',
                special2Code: 'che_무쌍',
                meta: {
                    killturn: 5,
                    dex1: 100_000,
                    dex2: 100_000,
                    dex3: 100_000,
                    dex4: 100_000,
                    dex5: 100_000,
                },
            },
        });
        await db.selectPoolEntry.create({
            data: {
                uniqueName: 'release-candidate',
                ownerUserId: null,
                generalId,
                reservedUntil: null,
                info: {
                    uniqueName: 'release-candidate',
                    generalName: '해제대상',
                    leadership: 50,
                    strength: 50,
                    intel: 50,
                    specialDomestic: 'che_event_신산',
                    dex: [100_000, 100_000, 100_000, 100_000, 100_000],
                    imgsvr: 0,
                    picture: 'default.jpg',
                } as GamePrisma.InputJsonValue,
            },
        });
        await db.selectPoolEntry.createMany({
            data: ['claim-candidate', 'conflict-candidate'].map((uniqueName) => ({
                uniqueName,
                ownerUserId: null,
                generalId: null,
                reservedUntil: null,
                info: {
                    uniqueName,
                    generalName: uniqueName === 'claim-candidate' ? '점유후보' : '충돌후보',
                    leadership: 70,
                    strength: 80,
                    intel: 10,
                    specialDomestic: 'che_event_징병',
                    dex: [10, 20, 30, 40, 50],
                    imgsvr: 0,
                    picture: 'default.jpg',
                } as GamePrisma.InputJsonValue,
            })),
        });
    });

    afterAll(async () => {
        if (!db) {
            await closeDb?.();
            return;
        }
        await db.$executeRawUnsafe('DROP TABLE IF EXISTS "select_pool_delete_blocker"');
        await db.selectPoolEntry.deleteMany({
            where: {
                uniqueName: {
                    in: [
                        'release-candidate',
                        'claim-candidate',
                        'conflict-candidate',
                        'early-protected-candidate',
                        'later-free-candidate',
                    ],
                },
            },
        });
        await db.general.deleteMany({
            where: {
                id: { in: [generalId, claimedGeneralId, conflictedGeneralId, protectedGeneralId, laterGeneralId] },
            },
        });
        await db.city.deleteMany({ where: { id: cityId } });
        await db.worldState.deleteMany({ where: { scenarioCode } });
        await closeDb?.();
    });

    it('round-trips independent event-domestic and war trait slots through a dirty flush', async () => {
        const loaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        const world = new InMemoryTurnWorld(loaded.state, loaded.snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 5 }] },
        });
        const before = world.getGeneralById(generalId);
        expect(before?.role).toMatchObject({
            specialDomestic: 'che_event_신산',
            specialWar: 'che_무쌍',
        });
        expect(world.updateGeneral(generalId, { gold: (before?.gold ?? 0) + 1 })).not.toBeNull();

        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        try {
            await hooks.hooks.flushChanges?.({
                lastTurnTime: loaded.state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 0,
                durationMs: 0,
                partial: false,
            });
        } finally {
            await hooks.close();
        }

        await expect(db.general.findUniqueOrThrow({ where: { id: generalId } })).resolves.toMatchObject({
            specialCode: 'che_event_신산',
            special2Code: 'che_무쌍',
        });
        const reloaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        expect(reloaded.snapshot.generals.find((general) => general.id === generalId)?.role).toMatchObject({
            specialDomestic: 'che_event_신산',
            specialWar: 'che_무쌍',
        });
    });

    it('claims a pool row in the same fenced transaction that creates the NPC', async () => {
        const loaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        const world = new InMemoryTurnWorld(loaded.state, loaded.snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 5 }] },
        });
        const candidate = world
            .listGeneralPoolCandidates(loaded.state.lastTurnTime)
            ?.find((entry) => entry.uniqueName === 'claim-candidate');
        expect(candidate).toBeDefined();
        const template = world.getGeneralById(generalId)!;
        expect(
            world.addGeneral({
                ...structuredClone(template),
                id: claimedGeneralId,
                userId: null,
                name: 'ⓜ점유후보',
                npcState: 3,
                officerLevel: 0,
                meta: {
                    ...template.meta,
                    ...buildScenarioGeneralPoolClaimMeta(candidate!, loaded.state.lastTurnTime),
                },
            })
        ).toBe(true);

        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        try {
            await hooks.hooks.flushChanges?.({
                lastTurnTime: loaded.state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 0,
                durationMs: 0,
                partial: false,
            });
        } finally {
            await hooks.close();
        }

        await expect(db.general.findUnique({ where: { id: claimedGeneralId } })).resolves.not.toBeNull();
        await expect(
            db.selectPoolEntry.findUniqueOrThrow({ where: { uniqueName: 'claim-candidate' } })
        ).resolves.toMatchObject({
            generalId: claimedGeneralId,
            ownerUserId: null,
            reservedUntil: null,
            reservedUntilTick: null,
        });
    });

    it('rolls back the NPC and pool mutation when a concurrent user reservation wins', async () => {
        const loaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        const world = new InMemoryTurnWorld(loaded.state, loaded.snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 5 }] },
        });
        const candidate = world
            .listGeneralPoolCandidates(loaded.state.lastTurnTime)
            ?.find((entry) => entry.uniqueName === 'conflict-candidate');
        expect(candidate).toBeDefined();
        const template = world.getGeneralById(generalId)!;
        expect(
            world.addGeneral({
                ...structuredClone(template),
                id: conflictedGeneralId,
                userId: null,
                name: 'ⓜ충돌후보',
                npcState: 3,
                officerLevel: 0,
                meta: {
                    ...template.meta,
                    ...buildScenarioGeneralPoolClaimMeta(candidate!, loaded.state.lastTurnTime),
                },
            })
        ).toBe(true);
        const reservedUntil = new Date(loaded.state.lastTurnTime.getTime() + 60_000);
        await db.selectPoolEntry.update({
            where: { uniqueName: 'conflict-candidate' },
            data: { ownerUserId: 'concurrent-user', reservedUntil },
        });

        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        try {
            await expect(
                hooks.hooks.flushChanges?.({
                    lastTurnTime: loaded.state.lastTurnTime.toISOString(),
                    processedGenerals: 0,
                    processedTurns: 0,
                    durationMs: 0,
                    partial: false,
                })
            ).rejects.toThrow('select_pool 후보를 점유하지 못했습니다: conflict-candidate');
        } finally {
            await hooks.close();
        }

        await expect(db.general.findUnique({ where: { id: conflictedGeneralId } })).resolves.toBeNull();
        await expect(
            db.selectPoolEntry.findUniqueOrThrow({ where: { uniqueName: 'conflict-candidate' } })
        ).resolves.toMatchObject({
            generalId: null,
            ownerUserId: 'concurrent-user',
            reservedUntil,
        });
    });

    it('checks every NPC claim at its own claimedAt without clearing a later-expiring user reservation', async () => {
        const earlyClaimedAt = new Date('2026-07-30T12:00:00.000Z');
        const reservedUntil = new Date('2026-07-30T12:05:00.000Z');
        const laterClaimedAt = new Date('2026-07-30T12:10:00.000Z');
        await db.selectPoolEntry.createMany({
            data: [
                {
                    uniqueName: 'early-protected-candidate',
                    ownerUserId: 'protected-user',
                    generalId: null,
                    reservedUntil,
                    info: {
                        uniqueName: 'early-protected-candidate',
                        generalName: '보호후보',
                        leadership: 70,
                        strength: 80,
                        intel: 10,
                        specialDomestic: 'che_event_징병',
                        dex: [10, 20, 30, 40, 50],
                        imgsvr: 0,
                        picture: 'default.jpg',
                    } as GamePrisma.InputJsonValue,
                },
                {
                    uniqueName: 'later-free-candidate',
                    ownerUserId: null,
                    generalId: null,
                    reservedUntil: null,
                    info: {
                        uniqueName: 'later-free-candidate',
                        generalName: '후행후보',
                        leadership: 70,
                        strength: 80,
                        intel: 10,
                        specialDomestic: 'che_event_징병',
                        dex: [10, 20, 30, 40, 50],
                        imgsvr: 0,
                        picture: 'default.jpg',
                    } as GamePrisma.InputJsonValue,
                },
            ],
        });
        const loaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        const world = new InMemoryTurnWorld(loaded.state, loaded.snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 5 }] },
        });
        const entries = world.listGeneralPoolEntries()!;
        const protectedCandidate = entries.find((entry) => entry.uniqueName === 'early-protected-candidate')!.candidate;
        const laterCandidate = entries.find((entry) => entry.uniqueName === 'later-free-candidate')!.candidate;
        const template = world.getGeneralById(generalId)!;
        expect(
            world.addGeneral({
                ...structuredClone(template),
                id: protectedGeneralId,
                userId: null,
                name: 'ⓜ보호후보',
                npcState: 3,
                meta: {
                    ...template.meta,
                    ...buildScenarioGeneralPoolClaimMeta(protectedCandidate, earlyClaimedAt),
                },
            })
        ).toBe(true);
        expect(
            world.addGeneral({
                ...structuredClone(template),
                id: laterGeneralId,
                userId: null,
                name: 'ⓜ후행후보',
                npcState: 3,
                meta: {
                    ...template.meta,
                    ...buildScenarioGeneralPoolClaimMeta(laterCandidate, laterClaimedAt),
                },
            })
        ).toBe(true);

        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        try {
            await expect(
                hooks.hooks.flushChanges?.({
                    lastTurnTime: loaded.state.lastTurnTime.toISOString(),
                    processedGenerals: 0,
                    processedTurns: 0,
                    durationMs: 0,
                    partial: false,
                })
            ).rejects.toThrow('select_pool 후보를 점유하지 못했습니다: early-protected-candidate');
        } finally {
            await hooks.close();
        }

        await expect(db.general.findUnique({ where: { id: protectedGeneralId } })).resolves.toBeNull();
        await expect(db.general.findUnique({ where: { id: laterGeneralId } })).resolves.toBeNull();
        await expect(
            db.selectPoolEntry.findUniqueOrThrow({ where: { uniqueName: 'early-protected-candidate' } })
        ).resolves.toMatchObject({
            generalId: null,
            ownerUserId: 'protected-user',
            reservedUntil,
        });
        await expect(
            db.selectPoolEntry.findUniqueOrThrow({ where: { uniqueName: 'later-free-candidate' } })
        ).resolves.toMatchObject({ generalId: null, ownerUserId: null, reservedUntil: null });
    });

    it('rolls back a failed flush, then releases all Ref fields before deleting the general', async () => {
        const loaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        const world = new InMemoryTurnWorld(loaded.state, loaded.snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 5 }] },
        });
        expect(world.removeGeneral(generalId)).toBe(true);

        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        try {
            await db.$executeRawUnsafe(`
                CREATE TABLE "select_pool_delete_blocker" (
                    "general_id" INTEGER PRIMARY KEY
                        REFERENCES "general"("id") ON DELETE RESTRICT
                )
            `);
            await db.$executeRawUnsafe(`INSERT INTO "select_pool_delete_blocker" ("general_id") VALUES (${generalId})`);

            await expect(
                hooks.hooks.flushChanges?.({
                    lastTurnTime: loaded.state.lastTurnTime.toISOString(),
                    processedGenerals: 0,
                    processedTurns: 0,
                    durationMs: 0,
                    partial: false,
                })
            ).rejects.toThrow();
            await expect(db.general.findUnique({ where: { id: generalId } })).resolves.not.toBeNull();
            await expect(
                db.selectPoolEntry.findUniqueOrThrow({
                    where: { uniqueName: 'release-candidate' },
                })
            ).resolves.toMatchObject({
                generalId,
                ownerUserId: null,
                reservedUntil: null,
            });

            await db.$executeRawUnsafe('DROP TABLE "select_pool_delete_blocker"');
            await hooks.hooks.flushChanges?.({
                lastTurnTime: loaded.state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 0,
                durationMs: 0,
                partial: false,
            });

            await expect(db.general.findUnique({ where: { id: generalId } })).resolves.toBeNull();
            await expect(
                db.selectPoolEntry.findUniqueOrThrow({
                    where: { uniqueName: 'release-candidate' },
                })
            ).resolves.toMatchObject({
                generalId: null,
                ownerUserId: null,
                reservedUntil: null,
            });
        } finally {
            await hooks.close();
        }
    });
});
