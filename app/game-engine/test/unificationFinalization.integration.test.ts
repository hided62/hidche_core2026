import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createUnificationHandler } from '../src/turn/unificationHandler.js';
import { loadTurnWorldFromDatabase } from '../src/turn/worldLoader.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const fixtureId = 992_001;
const serverId = 'che_unification_atomicity_fixture';
const profileName = 'che';
const userId = 'unification-atomicity-user';

integration('unification finalization transaction', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const cleanup = async (): Promise<void> => {
        await db.unificationFinalization.deleteMany({ where: { serverId } });
        await db.yearbookHistory.deleteMany({ where: { profileName: serverId } });
        await db.emperor.deleteMany({ where: { serverId } });
        await db.oldGeneral.deleteMany({ where: { serverId } });
        await db.oldNation.deleteMany({ where: { serverId } });
        await db.hallOfFame.deleteMany({ where: { serverId } });
        await db.inheritanceResult.deleteMany({ where: { serverId } });
        await db.inheritanceLog.deleteMany({ where: { userId } });
        await db.inheritancePoint.deleteMany({ where: { userId } });
        await db.gameHistory.deleteMany({ where: { serverId } });
        await db.logEntry.deleteMany({ where: { year: 190, month: 7 } });
        await db.rankData.deleteMany({ where: { generalId: fixtureId } });
        await db.general.deleteMany({ where: { id: fixtureId } });
        await db.city.deleteMany({ where: { id: fixtureId } });
        await db.nation.deleteMany({ where: { id: fixtureId } });
        await db.worldState.deleteMany({ where: { scenarioCode: 'unification-atomicity-fixture' } });
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await cleanup();
    });

    afterAll(async () => {
        await cleanup();
        await closeDb?.();
    });

    it('rolls every archive back on a late failure and applies it exactly once on retry', async () => {
        await db.nation.create({
            data: {
                id: fixtureId,
                name: '원자통일국',
                color: '#ffffff',
                capitalCityId: fixtureId,
                chiefGeneralId: fixtureId,
                gold: 1_000,
                rice: 2_000,
                tech: 123,
                level: 1,
                typeCode: 'che_중립',
                meta: {
                    power: 3_000,
                    max_power: { maxPower: 3_500, maxCrew: 400, maxCities: ['원자도시'] },
                },
            },
        });
        await db.city.create({
            data: {
                id: fixtureId,
                name: '원자도시',
                nationId: fixtureId,
                level: 1,
                population: 1_000,
                populationMax: 2_000,
                agriculture: 100,
                agricultureMax: 200,
                commerce: 100,
                commerceMax: 200,
                security: 100,
                securityMax: 200,
                defence: 100,
                defenceMax: 200,
                wall: 100,
                wallMax: 200,
                supplyState: 1,
                frontState: 0,
                region: 1,
                meta: { state: 0 },
            },
        });
        await db.general.create({
            data: {
                id: fixtureId,
                userId,
                name: '원자장수',
                nationId: fixtureId,
                cityId: fixtureId,
                npcState: 0,
                officerLevel: 12,
                leadership: 80,
                strength: 70,
                intel: 60,
                experience: 10,
                dedication: 5,
                age: 40,
                crew: 400,
                picture: '1.png',
                turnTime: new Date('0190-07-01T00:00:00.000Z'),
                meta: {
                    ownerName: '원자 사용자',
                    killturn: 24,
                    inherit_lived_month: 10,
                    max_domestic_critical: 20,
                    inherit_active_action: 3,
                    rank_warnum: 4,
                    firenum: 2,
                    dex1: 100,
                },
            },
        });
        await db.inheritancePoint.createMany({
            data: [
                { userId, key: 'previous', value: 100 },
                { userId, key: 'unifier', value: 7 },
            ],
        });
        const worldRow = await db.worldState.create({
            data: {
                scenarioCode: 'unification-atomicity-fixture',
                currentYear: 190,
                currentMonth: 6,
                tickSeconds: 600,
                config: {
                    stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                    iconPath: '.',
                    map: {},
                    const: { minPushHallAge: 30 },
                    environment: { mapName: 'che', unitSet: 'che' },
                },
                meta: {
                    serverId,
                    serverName: '원자 서버',
                    season: 1,
                    scenarioId: 2,
                    refreshLimit: 2,
                    scenarioMeta: {
                        title: '원자성 시나리오',
                        startYear: 190,
                        life: null,
                        fiction: null,
                        history: [],
                        ignoreDefaultEvents: false,
                    },
                },
            },
        });

        const loaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        let world: InMemoryTurnWorld | null = null;
        const unification = createUnificationHandler({ profileName, getWorld: () => world });
        world = new InMemoryTurnWorld(loaded.state, loaded.snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: unification.handler,
        });
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world, { profileName });
        const runResult = {
            lastTurnTime: '0190-07-01T00:00:00.000Z',
            processedGenerals: 0,
            processedTurns: 1,
            durationMs: 0,
            partial: false,
        };
        try {
            await world.advanceMonth(new Date('0190-07-01T00:00:00.000Z'));
            expect(world.getState().meta).toMatchObject({ isUnited: 2, isunited: 2, refreshLimit: 200 });
            expect(world.peekDirtyState().pendingUnificationFinalizations).toHaveLength(1);
            expect(world.peekDirtyState().pendingYearbookSnapshots).toHaveLength(1);

            await expect(hooks.hooks.flushChanges?.(runResult)).rejects.toThrow();

            expect(await db.unificationFinalization.count({ where: { serverId } })).toBe(0);
            expect(await db.yearbookHistory.count({ where: { profileName: serverId } })).toBe(0);
            expect(await db.inheritanceResult.count({ where: { serverId } })).toBe(0);
            expect(await db.oldGeneral.count({ where: { serverId } })).toBe(0);
            expect(await db.oldNation.count({ where: { serverId } })).toBe(0);
            expect(await db.emperor.count({ where: { serverId } })).toBe(0);
            expect(
                (await db.inheritancePoint.findUniqueOrThrow({ where: { userId_key: { userId, key: 'previous' } } }))
                    .value
            ).toBe(100);
            expect(world.peekDirtyState().pendingUnificationFinalizations).toHaveLength(1);

            await db.gameHistory.create({
                data: {
                    serverId,
                    date: new Date('0190-01-01T00:00:00.000Z'),
                    season: 1,
                    scenario: 2,
                    scenarioName: '원자성 시나리오',
                },
            });
            await hooks.hooks.flushChanges?.(runResult);

            expect(await db.unificationFinalization.count({ where: { serverId } })).toBe(1);
            expect(await db.inheritanceResult.count({ where: { serverId } })).toBe(1);
            expect(await db.oldGeneral.count({ where: { serverId } })).toBe(1);
            expect(await db.oldNation.count({ where: { serverId } })).toBe(2);
            expect(await db.emperor.count({ where: { serverId } })).toBe(1);
            expect((await db.gameHistory.findUniqueOrThrow({ where: { serverId } })).winnerNation).toBe(fixtureId);
            const yearbook = await db.yearbookHistory.findUniqueOrThrow({
                where: {
                    profileName_year_month_sourceId: {
                        profileName: serverId,
                        year: 190,
                        month: 7,
                        sourceId: 0,
                    },
                },
            });
            expect(yearbook.globalHistory).toEqual(expect.arrayContaining([expect.stringContaining('【통일】')]));
            expect(world.peekDirtyState().pendingUnificationFinalizations).toHaveLength(0);

            await hooks.hooks.flushChanges?.(runResult);
            expect(await db.unificationFinalization.count({ where: { serverId } })).toBe(1);
            expect(await db.inheritanceResult.count({ where: { serverId } })).toBe(1);
            expect(await db.emperor.count({ where: { serverId } })).toBe(1);
            expect(await db.worldState.findUniqueOrThrow({ where: { id: worldRow.id } })).toMatchObject({
                currentYear: 190,
                currentMonth: 7,
            });
        } finally {
            await hooks.close();
        }
    });
});
