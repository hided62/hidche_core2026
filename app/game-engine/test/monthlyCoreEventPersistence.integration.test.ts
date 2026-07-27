import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import type { City, MapDefinition, Nation } from '@sammo-ts/logic';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { createIncomeHandler } from '../src/turn/incomeHandler.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import {
    createNewYearHandler,
    createNoticeToHistoryLogHandler,
    createProcessIncomeActionHandler,
    createResetOfficerLockHandler,
} from '../src/turn/monthlyCoreEventAction.js';
import { createMonthlyEventHandler, type MonthlyEventActionHandler } from '../src/turn/monthlyEventHandler.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const generalId = 992_401;
const cityId = 992_401;
const nationId = 992_401;
const fixtureYear = 2190;

const map: MapDefinition = {
    id: 'monthly-core-event-persistence',
    name: 'monthly-core-event-persistence',
    cities: [],
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
};

integration('core monthly event action persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.logEntry.deleteMany({ where: { year: fixtureYear } });
        await db.general.deleteMany({ where: { id: generalId } });
        await db.city.deleteMany({ where: { id: cityId } });
        await db.nation.deleteMany({ where: { id: nationId } });
        await db.worldState.deleteMany();
    });

    afterAll(async () => {
        await db.logEntry.deleteMany({ where: { year: fixtureYear } });
        await db.general.deleteMany({ where: { id: generalId } });
        await db.city.deleteMany({ where: { id: cityId } });
        await db.nation.deleteMany({ where: { id: nationId } });
        await db.worldState.deleteMany({ where: { scenarioCode: 'monthly-core-event-persistence' } });
        await closeDb?.();
    });

    it('commits explicit income, formatted logs, NewYear state, and reset locks in one flush', async () => {
        const nation: Nation = {
            id: nationId,
            name: '갑국',
            color: '#777777',
            capitalCityId: cityId,
            chiefGeneralId: generalId,
            gold: 10_000,
            rice: 20_000,
            power: 0,
            level: 1,
            typeCode: 'che_중립',
            meta: { rate: 35, rate_tmp: 10, bill: 0, chief_set: 1 },
        };
        const city: City = {
            id: cityId,
            name: '갑성',
            nationId,
            level: 4,
            state: 0,
            population: 10_000,
            populationMax: 20_000,
            agriculture: 1_000,
            agricultureMax: 2_000,
            commerce: 1_000,
            commerceMax: 2_000,
            security: 1_000,
            securityMax: 2_000,
            supplyState: 1,
            frontState: 0,
            defence: 500,
            defenceMax: 1_000,
            wall: 500,
            wallMax: 1_000,
            conflict: {},
            meta: { trust: 80, trade: 100, officer_set: 1 },
        };
        const general: TurnGeneral = {
            id: generalId,
            name: '갑장',
            nationId,
            cityId,
            troopId: 0,
            stats: { leadership: 50, strength: 50, intelligence: 50 },
            experience: 0,
            dedication: 100,
            officerLevel: 5,
            role: {
                personality: null,
                specialDomestic: null,
                specialWar: null,
                items: { horse: null, weapon: null, book: null, item: null },
            },
            injury: 0,
            gold: 1_000,
            rice: 1_000,
            crew: 100,
            crewTypeId: 1100,
            train: 50,
            atmos: 50,
            age: 30,
            npcState: 0,
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: { killturn: 24, belong: 3 },
            turnTime: new Date(`${fixtureYear}-06-01T00:00:00.000Z`),
        };
        await db.nation.create({
            data: {
                id: nation.id,
                name: nation.name,
                color: nation.color,
                capitalCityId: cityId,
                gold: nation.gold,
                rice: nation.rice,
                tech: 0,
                level: nation.level,
                typeCode: nation.typeCode,
                meta: nation.meta,
            },
        });
        await db.city.create({
            data: {
                id: city.id,
                name: city.name,
                level: city.level,
                nationId,
                population: city.population,
                populationMax: city.populationMax,
                agriculture: city.agriculture,
                agricultureMax: city.agricultureMax,
                commerce: city.commerce,
                commerceMax: city.commerceMax,
                security: city.security,
                securityMax: city.securityMax,
                trust: 80,
                trade: 100,
                defence: city.defence,
                defenceMax: city.defenceMax,
                wall: city.wall,
                wallMax: city.wallMax,
                region: 1,
                meta: city.meta,
            },
        });
        await db.general.create({
            data: {
                id: general.id,
                name: general.name,
                nationId,
                cityId,
                officerLevel: general.officerLevel,
                npcState: general.npcState,
                leadership: general.stats.leadership,
                strength: general.stats.strength,
                intel: general.stats.intelligence,
                experience: general.experience,
                dedication: general.dedication,
                gold: general.gold,
                rice: general.rice,
                crew: general.crew,
                crewTypeId: general.crewTypeId,
                train: general.train,
                atmos: general.atmos,
                age: general.age,
                turnTime: general.turnTime,
                meta: general.meta,
            },
        });
        const worldRow = await db.worldState.create({
            data: {
                scenarioCode: 'monthly-core-event-persistence',
                currentYear: fixtureYear,
                currentMonth: 6,
                tickSeconds: 600,
                config: {},
                meta: { hiddenSeed: 'monthly-core-event-persistence' },
            },
        });
        const events: TurnWorldSnapshot['events'] = [
            {
                id: 1,
                targetCode: 'month',
                priority: 1,
                condition: true,
                action: [
                    ['NoticeToHistoryLog', '<S>경계 알림</>', 6],
                    ['NewYear'],
                    ['ResetOfficerLock'],
                    ['ProcessIncome', 'gold'],
                ],
                meta: {},
            },
        ];
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: {
                    total: 300,
                    min: 10,
                    max: 100,
                    npcTotal: 150,
                    npcMax: 50,
                    npcMin: 10,
                    chiefMin: 70,
                },
                iconPath: '',
                map: {},
                const: { baseGold: 0, baseRice: 0 },
                environment: { mapName: map.id, unitSet: 'default' },
            },
            scenarioMeta: {
                title: 'monthly core event persistence',
                startYear: fixtureYear,
                life: null,
                fiction: null,
                history: [],
                ignoreDefaultEvents: false,
            },
            map,
            diplomacy: [],
            events,
            initialEvents: [],
            generals: [general],
            cities: [city],
            nations: [nation],
            troops: [],
        };
        const state: TurnWorldState = {
            id: worldRow.id,
            currentYear: fixtureYear,
            currentMonth: 6,
            tickSeconds: 600,
            lastTurnTime: general.turnTime,
            meta: { hiddenSeed: 'monthly-core-event-persistence' },
        };
        let world: InMemoryTurnWorld | null = null;
        const incomeHandler = createIncomeHandler({
            getWorld: () => world,
            scenarioConfig: snapshot.scenarioConfig,
            nationTraits: new Map(),
        });
        const actions = new Map<string, MonthlyEventActionHandler>([
            ['NoticeToHistoryLog', createNoticeToHistoryLogHandler({ getWorld: () => world })],
            ['NewYear', createNewYearHandler({ getWorld: () => world })],
            ['ResetOfficerLock', createResetOfficerLockHandler({ getWorld: () => world })],
            ['ProcessIncome', createProcessIncomeActionHandler(incomeHandler)],
        ]);
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: createMonthlyEventHandler({
                getWorld: () => world,
                startYear: fixtureYear,
                actions,
            }),
        });
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        try {
            await world.advanceMonth(new Date(`${fixtureYear}-07-01T00:00:00.000Z`));
            await hooks.hooks.flushChanges?.({
                lastTurnTime: `${fixtureYear}-07-01T00:00:00.000Z`,
                processedGenerals: 0,
                processedTurns: 0,
                durationMs: 0,
                partial: false,
            });

            expect(
                await db.general.findUnique({ where: { id: generalId }, select: { age: true, meta: true } })
            ).toEqual({
                age: 31,
                meta: expect.objectContaining({ belong: 4 }),
            });
            expect(
                await db.nation.findUnique({ where: { id: nationId }, select: { gold: true, rice: true, meta: true } })
            ).toEqual({
                gold: 10_105,
                rice: 20_000,
                meta: expect.objectContaining({
                    rate: 35,
                    rate_tmp: 10,
                    chief_set: 0,
                    prev_income_gold: 105,
                }),
            });
            expect(await db.city.findUnique({ where: { id: cityId }, select: { meta: true } })).toEqual({
                meta: expect.objectContaining({ officer_set: 0 }),
            });
            expect(
                await db.logEntry.findMany({
                    where: { year: fixtureYear },
                    orderBy: { id: 'asc' },
                    select: { category: true, text: true },
                })
            ).toEqual(
                expect.arrayContaining([
                    {
                        category: 'HISTORY',
                        text: `<S>◆</>${fixtureYear}년 7월:<S>경계 알림</>`,
                    },
                    {
                        category: 'ACTION',
                        text: `<C>●</>7월:<C>${fixtureYear}</>년이 되었습니다.`,
                    },
                    {
                        category: 'HISTORY',
                        text: `<C>●</>${fixtureYear}년 7월:<W><b>【지급】</b></>봄이 되어 봉록에 따라 자금이 지급됩니다.`,
                    },
                ])
            );
        } finally {
            await hooks.close();
        }
    });
});
