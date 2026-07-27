import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TurnCommandEnv } from '@sammo-ts/logic';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { composeCalendarHandlers } from '../src/turn/calendarHandlers.js';
import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createMonthlyBoundaryPreHandler } from '../src/turn/monthlyBoundaryPreHandler.js';
import { createNationTurnMonthlyHandler } from '../src/turn/nationTurnMonthlyHandler.js';
import { loadTurnWorldFromDatabase } from '../src/turn/worldLoader.js';
import { createYearbookHandler } from '../src/turn/yearbookHandler.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const generalIds = [991_201, 991_202];
const cityIds = [991_201, 991_202, 991_203, 991_204, 991_205, 991_206, 991_207];
const nationId = 991_201;
const yearbookProfile = 'monthly-boundary-pre-persistence';

integration('monthly pre-update persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.generalAccessLog.deleteMany({ where: { generalId: { in: generalIds } } });
        await db.rankData.deleteMany({ where: { generalId: { in: generalIds } } });
        await db.general.deleteMany({ where: { id: { in: generalIds } } });
        await db.city.deleteMany({ where: { id: { in: cityIds } } });
        await db.nation.deleteMany({ where: { id: nationId } });
        await db.worldState.deleteMany({ where: { scenarioCode: 'monthly-boundary-pre-persistence' } });
        await db.yearbookHistory.deleteMany({ where: { profileName: yearbookProfile } });
    });

    afterAll(async () => {
        await db.generalAccessLog.deleteMany({ where: { generalId: { in: generalIds } } });
        await db.rankData.deleteMany({ where: { generalId: { in: generalIds } } });
        await db.general.deleteMany({ where: { id: { in: generalIds } } });
        await db.city.deleteMany({ where: { id: { in: cityIds } } });
        await db.nation.deleteMany({ where: { id: nationId } });
        await db.worldState.deleteMany({ where: { scenarioCode: 'monthly-boundary-pre-persistence' } });
        await db.yearbookHistory.deleteMany({ where: { profileName: yearbookProfile } });
        await closeDb?.();
    });

    it('loads and commits access score, limits, nation metadata, world development cost, and city state', async () => {
        await db.nation.create({
            data: {
                id: nationId,
                name: 'pre검증국',
                color: '#777777',
                level: 1,
                typeCode: 'che_중립',
                meta: {
                    rate: 35,
                    rate_tmp: 10,
                    strategic_cmd_limit: 2,
                    surlimit: 1,
                    spy: { 1: 1, 2: 2 },
                },
            },
        });
        await db.city.createMany({
            data: cityIds.map((id, index) => ({
                id,
                name: `pre도시${index + 1}`,
                level: 1,
                nationId: index < 2 ? nationId : 0,
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
                region: 1,
                conflict: { 1: (index + 1) * 10 },
                meta: {
                    state: [31, 32, 33, 34, 41, 42, 43][index],
                    term: [1, 2, 0, 3, 1, 2, 3][index],
                },
            })),
        });
        await db.general.createMany({
            data: generalIds.map((id, index) => ({
                id,
                name: `pre장수${index + 1}`,
                nationId: 0,
                cityId: cityIds[index]!,
                npcState: 2,
                turnTime: new Date('0200-12-01T00:00:00.000Z'),
                meta: { killturn: 0, makelimit: index === 0 ? 2 : 0 },
            })),
        });
        await db.generalAccessLog.createMany({
            data: [
                { generalId: generalIds[0]!, refreshScoreTotal: 101 },
                { generalId: generalIds[1]!, refreshScoreTotal: 1 },
            ],
        });
        const worldRow = await db.worldState.create({
            data: {
                scenarioCode: 'monthly-boundary-pre-persistence',
                currentYear: 200,
                currentMonth: 12,
                tickSeconds: 600,
                config: {
                    stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                    iconPath: '.',
                    map: {},
                    const: {},
                    environment: { mapName: 'che', unitSet: 'che' },
                },
                meta: {
                    develcost: 18,
                    scenarioMeta: {
                        title: 'pre persistence',
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
        expect(
            loaded.snapshot.generals
                .filter((general) => generalIds.includes(general.id))
                .map((general) => general.refreshScoreTotal)
        ).toEqual([101, 1]);

        let world: InMemoryTurnWorld | null = null;
        const commandEnv = { develCost: 18 } as TurnCommandEnv;
        const boundary = createMonthlyBoundaryPreHandler({
            getWorld: () => world,
            startYear: 190,
            commandEnv,
        });
        const nations = createNationTurnMonthlyHandler({ getWorld: () => world });
        const yearbook = createYearbookHandler({
            databaseUrl: databaseUrl!,
            profileName: yearbookProfile,
            getWorld: () => world,
        });
        world = new InMemoryTurnWorld(loaded.state, loaded.snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: composeCalendarHandlers(yearbook.handler, boundary, nations),
        });
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        try {
            await world.advanceMonth(new Date('0201-01-01T00:00:00.000Z'));
            await hooks.hooks.flushChanges?.({
                lastTurnTime: '0201-01-01T00:00:00.000Z',
                processedGenerals: 0,
                processedTurns: 0,
                durationMs: 0,
                partial: false,
            });

            expect(
                await db.generalAccessLog.findMany({
                    where: { generalId: { in: generalIds } },
                    orderBy: { generalId: 'asc' },
                    select: { refreshScoreTotal: true },
                })
            ).toEqual([{ refreshScoreTotal: 99 }, { refreshScoreTotal: 0 }]);
            expect(
                (
                    await db.general.findMany({
                        where: { id: { in: generalIds } },
                        orderBy: { id: 'asc' },
                        select: { meta: true },
                    })
                ).map((row) => (row.meta as Record<string, unknown>).makelimit)
            ).toEqual([1, 0]);
            expect(await db.nation.findUniqueOrThrow({ where: { id: nationId } })).toMatchObject({
                meta: expect.objectContaining({
                    rate: 35,
                    rate_tmp: 35,
                    strategic_cmd_limit: 1,
                    surlimit: 0,
                    spy: { 2: 1 },
                }),
            });
            expect(await db.worldState.findUniqueOrThrow({ where: { id: worldRow.id } })).toMatchObject({
                currentYear: 201,
                currentMonth: 1,
                meta: expect.objectContaining({ develcost: 40 }),
            });
            const cityRows = await db.city.findMany({
                where: { id: { in: cityIds } },
                orderBy: { id: 'asc' },
                select: { conflict: true, meta: true },
            });
            expect(cityRows.map((row) => (row.meta as Record<string, unknown>).state)).toEqual([
                0, 31, 0, 33, 0, 41, 42,
            ]);
            expect(cityRows.map((row) => (row.meta as Record<string, unknown>).term)).toEqual([0, 1, 0, 2, 0, 1, 2]);
            expect(cityRows.map((row) => row.conflict)).toEqual([
                {},
                { 1: 20 },
                {},
                { 1: 40 },
                {},
                { 1: 60 },
                { 1: 70 },
            ]);
            const yearbookRow = await db.yearbookHistory.findUniqueOrThrow({
                where: {
                    profileName_year_month_sourceId: {
                        profileName: yearbookProfile,
                        year: 200,
                        month: 12,
                        sourceId: 0,
                    },
                },
            });
            const yearbookStates = new Map(
                (yearbookRow.map as { cityList: Array<[number, number, number]> }).cityList.map(([id, , state]) => [
                    id,
                    state,
                ])
            );
            expect(cityIds.map((id) => yearbookStates.get(id))).toEqual([31, 32, 33, 34, 41, 42, 43]);
        } finally {
            await hooks.close();
            await yearbook.close();
        }
    });
});
