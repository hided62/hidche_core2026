import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { composeCalendarHandlers } from '../src/turn/calendarHandlers.js';
import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import {
    createMonthlyDiplomacyHandler,
    createMonthlyNationCountHandler,
    createMonthlyNationStatsHandler,
    createMonthlyWarSettingHandler,
} from '../src/turn/monthlyNationStatsHandler.js';
import { loadTurnWorldFromDatabase } from '../src/turn/worldLoader.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const generalIds = [991_301, 991_302];
const cityIds = [991_301, 991_302];
const nationIds = [991_301, 991_302];
const scenarioCode = 'monthly-nation-stats-persistence';

integration('monthly nation statistics persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.rankData.deleteMany({ where: { generalId: { in: generalIds } } });
        await db.general.deleteMany({ where: { id: { in: generalIds } } });
        await db.city.deleteMany({ where: { id: { in: cityIds } } });
        await db.nation.deleteMany({ where: { id: { in: nationIds } } });
        // The turn loader intentionally expects one world per isolated game schema.
        await db.worldState.deleteMany();
    });

    afterAll(async () => {
        await db.rankData.deleteMany({ where: { generalId: { in: generalIds } } });
        await db.general.deleteMany({ where: { id: { in: generalIds } } });
        await db.city.deleteMany({ where: { id: { in: cityIds } } });
        await db.nation.deleteMany({ where: { id: { in: nationIds } } });
        await db.worldState.deleteMany({ where: { scenarioCode } });
        await closeDb?.();
    });

    it('loads previous power and commits power, maxima, war-setting count, and actual general count', async () => {
        await db.nation.createMany({
            data: [
                {
                    id: nationIds[0]!,
                    name: '갑국',
                    color: '#777777',
                    gold: 10_000,
                    rice: 20_000,
                    tech: 100,
                    level: 2,
                    typeCode: 'che_중립',
                    meta: {
                        power: 7,
                        gennum: 9,
                        available_war_setting_cnt: 1,
                        max_power: {
                            maxPower: 999,
                            maxCrew: 50,
                            maxCities: ['옛도시', '옛도시2'],
                        },
                    },
                },
                {
                    id: nationIds[1]!,
                    name: '을국',
                    color: '#777777',
                    gold: 2_000,
                    rice: 3_000,
                    tech: 50,
                    level: 1,
                    typeCode: 'che_중립',
                    meta: { power: 8, gennum: 8 },
                },
            ],
        });
        await db.city.createMany({
            data: cityIds.map((id, index) => {
                const scale = index + 1;
                return {
                    id,
                    name: index === 0 ? '갑성' : '을성',
                    level: 4,
                    nationId: nationIds[index]!,
                    supplyState: 1,
                    population: 1_000 * scale,
                    populationMax: 2_000 * scale,
                    agriculture: 100 * scale,
                    agricultureMax: 200 * scale,
                    commerce: 100 * scale,
                    commerceMax: 200 * scale,
                    security: 100 * scale,
                    securityMax: 200 * scale,
                    defence: 100 * scale,
                    defenceMax: 200 * scale,
                    wall: 100 * scale,
                    wallMax: 200 * scale,
                    region: 1,
                };
            }),
        });
        await db.general.createMany({
            data: [
                {
                    id: generalIds[0]!,
                    name: '갑장',
                    nationId: nationIds[0]!,
                    cityId: cityIds[0]!,
                    npcState: 0,
                    leadership: 50,
                    strength: 40,
                    intel: 30,
                    experience: 100,
                    dedication: 200,
                    gold: 1_000,
                    rice: 2_000,
                    crew: 100,
                    turnTime: new Date('0193-01-01T00:00:00.000Z'),
                    meta: { killturn: 0, dex1: 1_000, dex2: 0, dex3: 0, dex4: 0, dex5: 0 },
                },
                {
                    id: generalIds[1]!,
                    name: '을장',
                    nationId: nationIds[1]!,
                    cityId: cityIds[1]!,
                    npcState: 2,
                    leadership: 60,
                    strength: 50,
                    intel: 40,
                    experience: 300,
                    dedication: 400,
                    gold: 3_000,
                    rice: 4_000,
                    crew: 200,
                    turnTime: new Date('0193-01-01T00:00:00.000Z'),
                    meta: { killturn: 0, dex1: 2_000, dex2: 1_000, dex3: 0, dex4: 0, dex5: 0 },
                },
            ],
        });
        await db.rankData.createMany({
            data: [
                { generalId: generalIds[0]!, nationId: nationIds[0]!, type: 'killcrew_person', value: 100 },
                { generalId: generalIds[0]!, nationId: nationIds[0]!, type: 'deathcrew_person', value: 0 },
                { generalId: generalIds[1]!, nationId: nationIds[1]!, type: 'killcrew_person', value: 0 },
                { generalId: generalIds[1]!, nationId: nationIds[1]!, type: 'deathcrew_person', value: 100 },
            ],
        });
        const worldRow = await db.worldState.create({
            data: {
                scenarioCode,
                currentYear: 193,
                currentMonth: 1,
                tickSeconds: 600,
                config: {
                    stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                    iconPath: '.',
                    map: {},
                    const: {},
                    environment: { mapName: 'che', unitSet: 'che' },
                },
                meta: { hiddenSeed: 'monthly-post-nation-stats-fixture' },
            },
        });

        const loaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        expect(
            loaded.snapshot.nations
                .filter((nation) => nationIds.includes(nation.id))
                .sort((left, right) => left.id - right.id)
                .map((nation) => nation.power)
        ).toEqual([7, 8]);

        let world: InMemoryTurnWorld | null = null;
        world = new InMemoryTurnWorld(loaded.state, loaded.snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            autoAdvanceDiplomacyMonth: false,
            calendarHandler: composeCalendarHandlers(
                createMonthlyNationStatsHandler({ getWorld: () => world }),
                createMonthlyDiplomacyHandler({ getWorld: () => world }),
                createMonthlyWarSettingHandler({ getWorld: () => world }),
                createMonthlyNationCountHandler({ getWorld: () => world })
            ),
        });
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        try {
            await world.advanceMonth(new Date('0193-02-01T00:00:00.000Z'));
            const updatedPowers = nationIds.map((id) => world?.getNationById(id)?.power);
            expect(updatedPowers.every((power) => typeof power === 'number' && power > 0)).toBe(true);
            await hooks.hooks.flushChanges?.({
                lastTurnTime: '0193-02-01T00:00:00.000Z',
                processedGenerals: 0,
                processedTurns: 0,
                durationMs: 0,
                partial: false,
            });

            const rows = await db.nation.findMany({
                where: { id: { in: nationIds } },
                orderBy: { id: 'asc' },
                select: { meta: true },
            });
            expect(rows.map((row) => row.meta)).toEqual([
                expect.objectContaining({
                    power: updatedPowers[0],
                    gennum: 1,
                    available_war_setting_cnt: 3,
                    max_power: {
                        maxPower: 999,
                        maxCrew: 100,
                        maxCities: ['옛도시', '옛도시2'],
                    },
                }),
                expect.objectContaining({
                    power: updatedPowers[1],
                    gennum: 1,
                    available_war_setting_cnt: 2,
                    max_power: {
                        maxPower: updatedPowers[1],
                        maxCrew: 200,
                        maxCities: ['을성'],
                    },
                }),
            ]);
            expect(await db.worldState.findUniqueOrThrow({ where: { id: worldRow.id } })).toMatchObject({
                currentYear: 193,
                currentMonth: 2,
            });
        } finally {
            await hooks.close();
        }
    });
});
