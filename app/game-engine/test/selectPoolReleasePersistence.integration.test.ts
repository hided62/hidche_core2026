import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    createGamePostgresConnector,
    type GamePrisma,
    type GamePrismaClient,
} from '@sammo-ts/infra';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { loadTurnWorldFromDatabase } from '../src/turn/worldLoader.js';

const databaseUrl = process.env.SELECT_POOL_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const generalId = 990_904;
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
            where: { uniqueName: 'release-candidate' },
        });
        await db.general.deleteMany({ where: { id: generalId } });
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
    });

    afterAll(async () => {
        if (!db) {
            await closeDb?.();
            return;
        }
        await db.$executeRawUnsafe('DROP TABLE IF EXISTS "select_pool_delete_blocker"');
        await db.selectPoolEntry.deleteMany({
            where: { uniqueName: 'release-candidate' },
        });
        await db.general.deleteMany({ where: { id: generalId } });
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
        expect(
            reloaded.snapshot.generals.find((general) => general.id === generalId)?.role
        ).toMatchObject({
            specialDomestic: 'che_event_신산',
            specialWar: 'che_무쌍',
        });
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
            await db.$executeRawUnsafe(
                `INSERT INTO "select_pool_delete_blocker" ("general_id") VALUES (${generalId})`
            );

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
