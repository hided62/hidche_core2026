import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import type { City, ItemModule, Nation } from '@sammo-ts/logic';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createUpdateNationLevelHandler } from '../src/turn/monthlyNationLevelAction.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import type { TurnEvent, TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const nationId = 990_061;
const generalId = 990_061;
const cityIds = [990_061, 990_062] as const;
const userId = 'monthly-nation-level-user';
const itemKey = 'test_monthly_nation_unique';

const uniqueHorse: ItemModule = {
    key: itemKey,
    name: '작위시험마',
    rawName: '작위시험마',
    info: '',
    slot: 'horse',
    cost: null,
    buyable: false,
    consumable: false,
    reqSecu: 0,
    unique: true,
};

const nation: Nation = {
    id: nationId,
    name: '작위저장국',
    color: '#000000',
    capitalCityId: cityIds[0],
    chiefGeneralId: generalId,
    gold: 10_000,
    rice: 20_000,
    power: 0,
    level: 0,
    typeCode: 'che_중립',
    meta: {},
};

const buildCity = (id: number): City => ({
    id,
    name: `작위도시${id}`,
    nationId,
    level: 4,
    state: 0,
    population: 1_000,
    populationMax: 2_000,
    agriculture: 500,
    agricultureMax: 1_000,
    commerce: 500,
    commerceMax: 1_000,
    security: 500,
    securityMax: 1_000,
    supplyState: 1,
    frontState: 0,
    defence: 500,
    defenceMax: 1_000,
    wall: 500,
    wallMax: 1_000,
    meta: { trust: 50, region: 1 },
});

const general: TurnGeneral = {
    id: generalId,
    userId,
    name: '조조',
    nationId,
    cityId: cityIds[0],
    troopId: 0,
    stats: { leadership: 90, strength: 70, intelligence: 90 },
    experience: 0,
    dedication: 0,
    officerLevel: 12,
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
    train: 100,
    atmos: 100,
    age: 30,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 1_000, belong: 10 },
    turnTime: new Date('0193-01-01T00:00:00.000Z'),
};

const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [['UpdateNationLevel']],
    meta: {},
};

integration('monthly nation level database persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.logEntry.deleteMany({ where: { OR: [{ nationId }, { generalId }] } });
        await db.nationTurn.deleteMany({ where: { nationId } });
        await db.inheritancePoint.deleteMany({ where: { userId } });
        await db.general.deleteMany({ where: { id: generalId } });
        await db.city.deleteMany({ where: { id: { in: [...cityIds] } } });
        await db.nation.deleteMany({ where: { id: nationId } });
    });

    afterAll(async () => {
        await db.logEntry.deleteMany({ where: { OR: [{ nationId }, { generalId }] } });
        await db.nationTurn.deleteMany({ where: { nationId } });
        await db.inheritancePoint.deleteMany({ where: { userId } });
        await db.general.deleteMany({ where: { id: generalId } });
        await db.city.deleteMany({ where: { id: { in: [...cityIds] } } });
        await db.nation.deleteMany({ where: { id: nationId } });
        await closeDb?.();
    });

    it('commits nation resources, chief turns, unique reward, logs, and unifier points together', async () => {
        await db.nation.create({
            data: {
                id: nation.id,
                name: nation.name,
                color: nation.color,
                capitalCityId: nation.capitalCityId,
                chiefGeneralId: nation.chiefGeneralId,
                gold: nation.gold,
                rice: nation.rice,
                tech: nation.power,
                level: nation.level,
                typeCode: nation.typeCode,
                meta: {},
            },
        });
        const cities = cityIds.map(buildCity);
        await db.city.createMany({
            data: cities.map((city) => ({
                id: city.id,
                name: city.name,
                level: city.level,
                nationId: city.nationId,
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
                defence: city.defence,
                defenceMax: city.defenceMax,
                wall: city.wall,
                wallMax: city.wallMax,
                region: 1,
                conflict: {},
                meta: {},
            })),
        });
        await db.general.create({
            data: {
                id: general.id,
                userId,
                name: general.name,
                nationId,
                cityId: general.cityId,
                troopId: 0,
                npcState: 0,
                leadership: general.stats.leadership,
                strength: general.stats.strength,
                intel: general.stats.intelligence,
                experience: 0,
                dedication: 0,
                officerLevel: 12,
                injury: 0,
                gold: 1_000,
                rice: 1_000,
                crew: 100,
                crewTypeId: 1100,
                train: 100,
                atmos: 100,
                age: 30,
                turnTime: general.turnTime,
                meta: general.meta,
            },
        });
        await db.nationTurn.create({
            data: {
                nationId,
                officerLevel: 9,
                turnIdx: 0,
                actionCode: 'che_포상',
                arg: { amount: 100 },
            },
        });
        const stateRow = await db.worldState.create({
            data: {
                scenarioCode: 'monthly-nation-level-persistence',
                currentYear: 193,
                currentMonth: 2,
                tickSeconds: 600,
                config: {},
                meta: { hiddenSeed: 'nation-level-persistence', killturn: 1_000 },
            },
        });
        const state: TurnWorldState = {
            id: stateRow.id,
            currentYear: 193,
            currentMonth: 2,
            tickSeconds: 600,
            lastTurnTime: new Date('2026-07-25T00:20:00.000Z'),
            meta: { hiddenSeed: 'nation-level-persistence', killturn: 1_000 },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: { allItems: { horse: { [itemKey]: 1 } }, maxUniqueItemLimit: [[-1, 1]] },
                environment: { mapName: 'test', unitSet: 'default' },
            },
            map: {
                id: 'test',
                name: 'test',
                cities: [],
                defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
            },
            generals: [general],
            cities,
            nations: [nation],
            troops: [],
            diplomacy: [],
            events: [event],
            initialEvents: [],
        };
        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        });
        const reservedTurns = new InMemoryReservedTurnStore(db, { maxGeneralTurns: 30, maxNationTurns: 12 });
        await reservedTurns.loadAll();
        const handler = createUpdateNationLevelHandler({
            getWorld: () => world,
            reservedTurns,
            itemModules: [uniqueHorse],
        });
        const dbHooks = await createDatabaseTurnHooks(databaseUrl!, world, { reservedTurns });

        try {
            await handler(
                [],
                { year: 193, month: 2, startyear: 190, currentEventID: 1, turnTime: state.lastTurnTime },
                event
            );
            await dbHooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            expect(await db.nation.findUniqueOrThrow({ where: { id: nationId } })).toMatchObject({
                level: 2,
                gold: 12_000,
                rice: 22_000,
            });
            expect(await db.general.findUniqueOrThrow({ where: { id: generalId } })).toMatchObject({
                horseCode: itemKey,
            });
            expect(await db.nationTurn.count({ where: { nationId } })).toBe(36);
            expect(
                await db.nationTurn.findUniqueOrThrow({
                    where: {
                        nationId_officerLevel_turnIdx: {
                            nationId,
                            officerLevel: 9,
                            turnIdx: 0,
                        },
                    },
                })
            ).toMatchObject({ actionCode: 'che_포상', arg: { amount: 100 } });
            expect(
                await db.inheritancePoint.findUniqueOrThrow({ where: { userId_key: { userId, key: 'unifier' } } })
            ).toMatchObject({
                value: 500,
            });
            expect(await db.logEntry.count({ where: { OR: [{ nationId }, { generalId }] } })).toBeGreaterThanOrEqual(3);
        } finally {
            await dbHooks.close();
            await db.worldState.delete({ where: { id: stateRow.id } });
        }
    });
});
