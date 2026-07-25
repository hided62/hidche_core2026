import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { City, Nation } from '@sammo-ts/logic';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import {
    createFinishNationBettingHandler,
    createOpenNationBettingHandler,
} from '../src/turn/monthlyNationBettingAction.js';
import { createMonthlyEventHandler } from '../src/turn/monthlyEventHandler.js';
import type { TurnEvent, TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const nationIds = [990_061, 990_062] as const;
const cityIds = [990_061, 990_062] as const;
const generalIds = [9_961, 9_962] as const;
const userIds = ['monthly-betting-user-1', 'monthly-betting-user-2'] as const;
const bettingId = 990_061;

const buildNation = (id: number, power: number): Nation => ({
    id,
    name: `베팅국${id}`,
    color: '#123456',
    capitalCityId: id,
    chiefGeneralId: id,
    gold: 1_000,
    rice: 2_000,
    power,
    level: 2,
    typeCode: 'che_유가',
    meta: { tech: 100 },
});

const buildCity = (id: number, nationId: number): City => ({
    id,
    name: `베팅도시${id}`,
    nationId,
    level: 3,
    state: 0,
    population: 1_000,
    populationMax: 2_000,
    agriculture: 1_000,
    agricultureMax: 2_000,
    commerce: 1_000,
    commerceMax: 2_000,
    security: 1_000,
    securityMax: 2_000,
    supplyState: 1,
    frontState: 0,
    defence: 1_000,
    defenceMax: 2_000,
    wall: 1_000,
    wallMax: 2_000,
    meta: { region: 1, trust: 50, trade: 100 },
});

const buildGeneral = (id: number, userId: string, nationId: number): TurnGeneral => ({
    id,
    userId,
    name: `베팅장수${id}`,
    nationId,
    cityId: nationId,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    experience: 0,
    dedication: 0,
    officerLevel: 1,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 0,
    rice: 0,
    crew: 0,
    crewTypeId: 1100,
    train: 0,
    atmos: 0,
    age: 30,
    npcState: 0,
    bornYear: 170,
    deadYear: 250,
    affinity: 1,
    picture: 'default.jpg',
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    lastTurn: { command: '휴식' },
    turnTime: new Date('0200-01-01T00:00:00.000Z'),
    meta: { killturn: 1_000 },
});

const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [['OpenNationBetting', 1, 100]],
    meta: {},
};

integration('monthly nation betting persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.event.deleteMany({ where: { id: { in: [2, 3] } } });
        await db.nationBetting.deleteMany({ where: { id: bettingId } });
        await db.diplomacy.deleteMany({
            where: {
                OR: [{ srcNationId: { in: [...nationIds] } }, { destNationId: { in: [...nationIds] } }],
            },
        });
        await db.rankData.deleteMany({ where: { generalId: { in: [...generalIds] } } });
        await db.inheritanceLog.deleteMany({ where: { userId: { in: [...userIds] } } });
        await db.inheritancePoint.deleteMany({ where: { userId: { in: [...userIds] } } });
        await db.logEntry.deleteMany({ where: { text: { contains: '천통국 예상 내기의 결과' } } });
        await db.general.deleteMany({ where: { id: { in: [...generalIds] } } });
        await db.city.deleteMany({ where: { id: { in: [...cityIds] } } });
        await db.nation.deleteMany({ where: { id: { in: [...nationIds] } } });
    });

    afterAll(async () => {
        await db.event.deleteMany({ where: { id: { in: [2, 3] } } });
        await db.nationBetting.deleteMany({ where: { id: bettingId } });
        await db.diplomacy.deleteMany({
            where: {
                OR: [{ srcNationId: { in: [...nationIds] } }, { destNationId: { in: [...nationIds] } }],
            },
        });
        await db.rankData.deleteMany({ where: { generalId: { in: [...generalIds] } } });
        await db.inheritanceLog.deleteMany({ where: { userId: { in: [...userIds] } } });
        await db.inheritancePoint.deleteMany({ where: { userId: { in: [...userIds] } } });
        await db.logEntry.deleteMany({ where: { text: { contains: '천통국 예상 내기의 결과' } } });
        await db.message.deleteMany({ where: { mailbox: { in: [...generalIds] } } });
        await db.general.deleteMany({ where: { id: { in: [...generalIds] } } });
        await db.city.deleteMany({ where: { id: { in: [...cityIds] } } });
        await db.nation.deleteMany({ where: { id: { in: [...nationIds] } } });
        await closeDb?.();
    });

    it('persists open data and settles inheritance rewards in the world flush transaction', async () => {
        const nations = [buildNation(nationIds[0], 100), buildNation(nationIds[1], 300)];
        const cities = [buildCity(cityIds[0], nationIds[0]), buildCity(cityIds[1], nationIds[1])];
        const generals = [
            buildGeneral(generalIds[0], userIds[0], nationIds[0]),
            buildGeneral(generalIds[1], userIds[1], nationIds[1]),
        ];
        await db.nation.createMany({
            data: nations.map((nation) => ({
                id: nation.id,
                name: nation.name,
                color: nation.color,
                capitalCityId: nation.capitalCityId,
                chiefGeneralId: nation.chiefGeneralId,
                gold: nation.gold,
                rice: nation.rice,
                tech: 100,
                level: nation.level,
                typeCode: nation.typeCode,
                meta: {},
            })),
        });
        await db.city.createMany({
            data: cities.map((city) => ({
                id: city.id,
                name: city.name,
                level: city.level,
                nationId: city.nationId,
                population: city.population,
                populationMax: city.populationMax,
                agriculture: city.agriculture,
                agricultureMax: city.agricultureMax,
                commerce: city.commerce,
                commerceMax: city.commerceMax,
                security: city.security,
                securityMax: city.securityMax,
                trust: 50,
                trade: 100,
                defence: city.defence,
                defenceMax: city.defenceMax,
                wall: city.wall,
                wallMax: city.wallMax,
                region: 1,
                meta: {},
            })),
        });
        await db.general.createMany({
            data: generals.map((general) => ({
                id: general.id,
                userId: general.userId,
                name: general.name,
                nationId: general.nationId,
                cityId: general.cityId,
                npcState: general.npcState,
                leadership: 50,
                strength: 50,
                intel: 50,
                officerLevel: 1,
                turnTime: general.turnTime,
                meta: general.meta,
            })),
        });
        const row = await db.worldState.create({
            data: {
                scenarioCode: 'monthly-nation-betting-persistence',
                currentYear: 199,
                currentMonth: 12,
                tickSeconds: 600,
                config: {},
                meta: { lastBettingId: bettingId - 1 },
            },
        });
        const state: TurnWorldState = {
            id: row.id,
            currentYear: 199,
            currentMonth: 12,
            tickSeconds: 600,
            lastTurnTime: new Date('2026-07-25T00:00:00.000Z'),
            meta: { lastBettingId: bettingId - 1 },
        };
        const scenarioConfig: TurnWorldSnapshot['scenarioConfig'] = {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
            iconPath: '.',
            map: {},
            const: {},
            environment: { mapName: 'test', unitSet: 'default' },
        };
        let world: InMemoryTurnWorld | null = null;
        const open = createOpenNationBettingHandler({ getWorld: () => world });
        const finish = createFinishNationBettingHandler({ getWorld: () => world });
        world = new InMemoryTurnWorld(
            state,
            {
                scenarioConfig,
                map: { id: 'test', name: 'test', cities: [] },
                generals,
                cities,
                nations,
                troops: [],
                diplomacy: [],
                events: [event],
                initialEvents: [],
            },
            {
                schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
                calendarHandler: createMonthlyEventHandler({
                    getWorld: () => world,
                    startYear: 190,
                    actions: new Map([
                        ['OpenNationBetting', open],
                        ['FinishNationBetting', finish],
                    ]),
                }),
            }
        );
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);

        try {
            await world.advanceMonth(new Date('0200-01-01T00:00:00.000Z'));
            await hooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            expect(await db.nationBetting.findUniqueOrThrow({ where: { id: bettingId } })).toMatchObject({
                name: '천통국 예상',
                selectCount: 1,
                openYearMonth: 2_400,
                closeYearMonth: 2_424,
                finished: false,
            });
            expect(await db.nationBet.findMany({ where: { bettingId } })).toEqual([
                expect.objectContaining({ generalId: 0, selectionKey: '[-1]', amount: 100 }),
            ]);
            expect(await db.message.count({ where: { mailbox: { in: [...generalIds] } } })).toBe(2);

            await db.nationBet.createMany({
                data: [
                    {
                        bettingId,
                        generalId: generalIds[0],
                        userId: userIds[0],
                        selection: [1],
                        selectionKey: '[1]',
                        amount: 100,
                    },
                    {
                        bettingId,
                        generalId: generalIds[1],
                        userId: userIds[1],
                        selection: [0],
                        selectionKey: '[0]',
                        amount: 100,
                    },
                ],
            });
            await db.inheritancePoint.createMany({
                data: userIds.map((userId) => ({ userId, key: 'previous', value: 900 })),
            });
            world.updateNation(nationIds[0], { level: 0 });
            expect(world.removeEvent(event.id)).toBe(true);
            expect(
                world.addEvent({
                    id: 3,
                    targetCode: 'month',
                    priority: 1_000,
                    condition: true,
                    action: [['FinishNationBetting', bettingId]],
                    meta: {},
                })
            ).toBe(true);
            await world.advanceMonth(new Date('0200-02-01T00:00:00.000Z'));
            await hooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            expect(await db.nationBetting.findUniqueOrThrow({ where: { id: bettingId } })).toMatchObject({
                finished: true,
                winner: [0],
            });
            expect(
                await db.inheritancePoint.findUniqueOrThrow({
                    where: { userId_key: { userId: userIds[1], key: 'previous' } },
                })
            ).toMatchObject({ value: 1_200 });
            expect(
                await db.inheritancePoint.findUniqueOrThrow({
                    where: { userId_key: { userId: userIds[0], key: 'previous' } },
                })
            ).toMatchObject({ value: 900 });
            expect(
                await db.rankData.findUniqueOrThrow({
                    where: { generalId_type: { generalId: generalIds[1], type: 'inherit_earned_act' } },
                })
            ).toMatchObject({ value: 300 });
            expect(await db.inheritanceLog.count({ where: { userId: userIds[1] } })).toBe(2);
            expect(
                await db.logEntry.findFirstOrThrow({
                    where: { text: { contains: '천통국 예상 내기의 결과' } },
                })
            ).toMatchObject({
                year: 200,
                month: 2,
                text: '<C>●</>200년 2월:<B><b>【내기】</b></> 200년 1월에 열렸던 천통국 예상 내기의 결과가 나왔습니다!',
            });
        } finally {
            await hooks.close();
            await db.worldState.delete({ where: { id: row.id } });
        }
    });
});
