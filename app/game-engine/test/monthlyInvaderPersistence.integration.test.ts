import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import type { City, Nation } from '@sammo-ts/logic';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createRaiseInvaderHandler } from '../src/turn/monthlyInvaderAction.js';
import { createMonthlyEventHandler } from '../src/turn/monthlyEventHandler.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';
import type { TurnEvent, TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const existingNationId = 991_100;
const createdNationId = 991_101;
const existingGeneralId = 991_100;
const firstCreatedGeneralId = 991_101;
const ordinaryCityId = 991_100;
const invaderCityId = 991_101;
const sourceEventId = 991_100;
const createdEventIds = [991_101, 991_102];

const buildCity = (id: number, nationId: number, level: number, name: string): City => ({
    id,
    name,
    nationId,
    level,
    state: 0,
    population: 1_000,
    populationMax: 10_000,
    agriculture: 2_000,
    agricultureMax: 20_000,
    commerce: 3_000,
    commerceMax: 30_000,
    security: 4_000,
    securityMax: 40_000,
    supplyState: 1,
    frontState: 0,
    defence: 5_000,
    defenceMax: 50_000,
    wall: 6_000,
    wallMax: 60_000,
    meta: { trust: 50, region: 1 },
});

const ordinaryCity = buildCity(ordinaryCityId, existingNationId, 3, '기준도시');
const invaderCity = buildCity(invaderCityId, 0, 4, '남만');
const existingNation: Nation = {
    id: existingNationId,
    name: '기준국',
    color: '#777777',
    capitalCityId: ordinaryCityId,
    chiefGeneralId: existingGeneralId,
    gold: 1_000,
    rice: 1_000,
    power: 0,
    level: 2,
    typeCode: 'che_유가',
    meta: { tech: 100, war: 1, scout: 1 },
};
const existingGeneral: TurnGeneral = {
    id: existingGeneralId,
    userId: null,
    name: '군주',
    nationId: existingNationId,
    cityId: ordinaryCityId,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    experience: 1_000,
    dedication: 1_000,
    officerLevel: 12,
    role: {
        personality: 'che_안전',
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1_000,
    rice: 1_000,
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
    turnTime: new Date('0200-01-01T00:05:00.000Z'),
    recentWarTime: null,
    meta: { killturn: 1_000, dex1: 10, dex2: 20, dex3: 30, dex4: 40, dex5: 50 },
};
const sourceEvent: TurnEvent = {
    id: sourceEventId,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [['RaiseInvader', 10, 150, 100, 20]],
    meta: {},
};

integration('RaiseInvader database persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const clean = async () => {
        const createdGeneralIds = Array.from({ length: 10 }, (_, index) => firstCreatedGeneralId + index);
        await db.logEntry.deleteMany({
            where: { year: 200, month: 1, text: { contains: '【이벤트】' } },
        });
        await db.generalTurn.deleteMany({
            where: { generalId: { in: [existingGeneralId, ...createdGeneralIds] } },
        });
        await db.rankData.deleteMany({
            where: { generalId: { in: [existingGeneralId, ...createdGeneralIds] } },
        });
        await db.general.deleteMany({
            where: { id: { in: [existingGeneralId, ...createdGeneralIds] } },
        });
        await db.nationTurn.deleteMany({ where: { nationId: createdNationId } });
        await db.diplomacy.deleteMany({
            where: {
                OR: [
                    { srcNationId: { in: [existingNationId, createdNationId] } },
                    { destNationId: { in: [existingNationId, createdNationId] } },
                ],
            },
        });
        await db.nation.deleteMany({ where: { id: { in: [existingNationId, createdNationId] } } });
        await db.city.deleteMany({ where: { id: { in: [ordinaryCityId, invaderCityId] } } });
        await db.event.deleteMany({ where: { id: { in: [sourceEventId, ...createdEventIds] } } });
        await db.worldState.deleteMany({ where: { scenarioCode: 'monthly-invader-persistence' } });
    };

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await clean();
    });

    afterAll(async () => {
        await clean();
        await closeDb?.();
    });

    it('commits invader entities, dynamic events, diplomacy, turns, ranks, city state, and logs atomically', async () => {
        const createCity = (city: City) =>
            db.city.create({
                data: {
                    id: city.id,
                    name: city.name,
                    nationId: city.nationId,
                    level: city.level,
                    supplyState: city.supplyState,
                    frontState: city.frontState,
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
                    conflict: {},
                    meta: {},
                },
            });
        await createCity(ordinaryCity);
        await createCity(invaderCity);
        await db.nation.create({
            data: {
                id: existingNationId,
                name: existingNation.name,
                color: existingNation.color,
                capitalCityId: ordinaryCityId,
                chiefGeneralId: existingGeneralId,
                gold: existingNation.gold,
                rice: existingNation.rice,
                tech: 100,
                level: 2,
                typeCode: existingNation.typeCode,
                meta: existingNation.meta,
            },
        });
        await db.general.create({
            data: {
                id: existingGeneralId,
                name: existingGeneral.name,
                nationId: existingNationId,
                cityId: ordinaryCityId,
                leadership: 50,
                strength: 50,
                intel: 50,
                experience: 1_000,
                dedication: 1_000,
                officerLevel: 12,
                gold: 1_000,
                rice: 1_000,
                crewTypeId: 1100,
                age: 30,
                npcState: 0,
                bornYear: 170,
                deadYear: 250,
                affinity: 1,
                personalCode: 'che_안전',
                lastTurn: { command: '휴식' },
                meta: existingGeneral.meta,
                turnTime: existingGeneral.turnTime,
            },
        });
        await db.event.create({
            data: {
                id: sourceEventId,
                targetCode: 'month',
                priority: 1_000,
                condition: true,
                action: [['RaiseInvader', 10, 150, 100, 20]],
                meta: {},
            },
        });
        const stateRow = await db.worldState.create({
            data: {
                scenarioCode: 'monthly-invader-persistence',
                currentYear: 199,
                currentMonth: 12,
                tickSeconds: 600,
                config: {},
                meta: {
                    hiddenSeed: 'raise-invader-persistence',
                    lastGeneralId: firstCreatedGeneralId - 1,
                    lastNationId: createdNationId - 1,
                    serverId: 'raise-invader-persistence',
                },
            },
        });
        const state: TurnWorldState = {
            id: stateRow.id,
            currentYear: 199,
            currentMonth: 12,
            tickSeconds: 600,
            lastTurnTime: new Date('0200-01-01T00:00:00.000Z'),
            meta: {
                hiddenSeed: 'raise-invader-persistence',
                lastGeneralId: firstCreatedGeneralId - 1,
                lastNationId: createdNationId - 1,
                serverId: 'raise-invader-persistence',
            },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
                iconPath: '.',
                map: {},
                const: {},
                environment: { mapName: 'test', unitSet: 'default' },
            },
            map: { id: 'test', name: 'test', cities: [] },
            generals: [existingGeneral],
            cities: [ordinaryCity, invaderCity],
            nations: [existingNation],
            troops: [],
            diplomacy: [],
            events: [sourceEvent],
            initialEvents: [],
        };
        const reservedTurns = new InMemoryReservedTurnStore(db, { maxGeneralTurns: 30, maxNationTurns: 12 });
        let world: InMemoryTurnWorld | null = null;
        const handler = createRaiseInvaderHandler({
            getWorld: () => world,
            reservedTurns,
            env: buildCommandEnv(snapshot.scenarioConfig),
            loadArchivedNationMaxId: async () => 0,
        });
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: createMonthlyEventHandler({
                getWorld: () => world,
                startYear: 190,
                actions: new Map([['RaiseInvader', handler]]),
            }),
        });
        const dbHooks = await createDatabaseTurnHooks(databaseUrl!, world, { reservedTurns });

        try {
            await world.advanceMonth(new Date('0200-01-01T00:00:00.000Z'));
            await dbHooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            expect(await db.nation.findUniqueOrThrow({ where: { id: createdNationId } })).toMatchObject({
                name: 'ⓞ남만족',
                capitalCityId: invaderCityId,
                chiefGeneralId: firstCreatedGeneralId,
                gold: 9_999_999,
                rice: 9_999_999,
                tech: 100,
                level: 2,
                typeCode: 'che_병가',
            });
            expect(await db.general.count({ where: { nationId: createdNationId } })).toBe(10);
            expect(await db.generalTurn.count({ where: { generalId: { gte: firstCreatedGeneralId } } })).toBe(300);
            expect(await db.rankData.count({ where: { generalId: { gte: firstCreatedGeneralId } } })).toBe(440);
            expect(await db.nationTurn.count({ where: { nationId: createdNationId } })).toBe(48);
            expect(
                await db.diplomacy.count({
                    where: {
                        OR: [{ srcNationId: createdNationId }, { destNationId: createdNationId }],
                    },
                })
            ).toBe(2);
            expect(
                await db.event.findMany({
                    where: { id: { in: createdEventIds } },
                    orderBy: { id: 'asc' },
                    select: { id: true, targetCode: true, priority: true, condition: true, action: true },
                })
            ).toEqual([
                {
                    id: createdEventIds[0],
                    targetCode: 'month',
                    priority: 1_000,
                    condition: true,
                    action: [['AutoDeleteInvader', createdNationId]],
                },
                {
                    id: createdEventIds[1],
                    targetCode: 'month',
                    priority: 1_000,
                    condition: true,
                    action: [['InvaderEnding']],
                },
            ]);
            expect(await db.city.findUniqueOrThrow({ where: { id: invaderCityId } })).toMatchObject({
                nationId: createdNationId,
                population: 200_000,
                populationMax: 200_000,
                agriculture: 20_000,
                commerce: 30_000,
                security: 40_000,
                defenceMax: 100_000,
                wallMax: 10_000,
            });
            expect(await db.general.findUniqueOrThrow({ where: { id: existingGeneralId } })).toMatchObject({
                gold: 999_999,
                rice: 999_999,
            });
            expect(
                await db.logEntry.count({
                    where: { year: 200, month: 1, text: { contains: '【이벤트】' } },
                })
            ).toBe(3);
            expect(await db.worldState.findUniqueOrThrow({ where: { id: stateRow.id } })).toMatchObject({
                meta: expect.objectContaining({ isunited: 1, block_change_scout: false }),
            });
            const sequenceProbe = await db.event.create({
                data: {
                    targetCode: 'month',
                    priority: 0,
                    condition: false,
                    action: [],
                    meta: {},
                },
            });
            expect(sequenceProbe.id).toBeGreaterThan(createdEventIds[1]!);
            await db.event.delete({ where: { id: sequenceProbe.id } });
        } finally {
            await dbHooks.close();
        }
    });
});
