import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import type { City, MapDefinition, Nation } from '@sammo-ts/logic';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createRaiseNpcNationHandler } from '../src/turn/monthlyRaiseNpcNationAction.js';
import { createMonthlyEventHandler } from '../src/turn/monthlyEventHandler.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';
import type { TurnEvent, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const existingNationId = 990_083;
const createdNationId = 990_086;
const occupiedCityId = 990_083;
const targetCityId = 990_086;
const createdGeneralId = 990_086;

const buildCity = (id: number, nationId: number, name: string): City => ({
    id,
    name,
    nationId,
    level: 5,
    state: 0,
    population: 10_000,
    populationMax: 50_000,
    agriculture: 1_000,
    agricultureMax: 5_000,
    commerce: 2_000,
    commerceMax: 6_000,
    security: 3_000,
    securityMax: 7_000,
    supplyState: 1,
    frontState: 0,
    defence: 4_000,
    defenceMax: 8_000,
    wall: 5_000,
    wallMax: 9_000,
    meta: { trust: 50 },
});

const occupiedCity = buildCity(occupiedCityId, existingNationId, '기준도시');
const targetCity = buildCity(targetCityId, 0, 'NPC건국도시');
const existingNation: Nation = {
    id: existingNationId,
    name: '기준국',
    color: '#777777',
    capitalCityId: occupiedCityId,
    chiefGeneralId: null,
    gold: 1_000,
    rice: 1_000,
    power: 0,
    level: 2,
    typeCode: 'che_유가',
    meta: { tech: 120 },
};

const map: MapDefinition = {
    id: 'test',
    name: 'test',
    cities: [occupiedCityId, 990_084, 990_085, targetCityId].map((id, index, rows) => ({
        id,
        name: `지도도시${id}`,
        level: 5,
        region: 1,
        position: { x: index, y: 0 },
        connections: [...(index > 0 ? [rows[index - 1]!] : []), ...(index + 1 < rows.length ? [rows[index + 1]!] : [])],
        max: {
            population: 50_000,
            agriculture: 5_000,
            commerce: 6_000,
            security: 7_000,
            defence: 8_000,
            wall: 9_000,
        },
        initial: {
            population: 10_000,
            agriculture: 1_000,
            commerce: 2_000,
            security: 3_000,
            defence: 4_000,
            wall: 5_000,
        },
    })),
};

const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [['RaiseNPCNation']],
    meta: {},
};

integration('RaiseNPCNation database persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const clean = async () => {
        await db.logEntry.deleteMany({
            where: {
                OR: [
                    { generalId: createdGeneralId },
                    { year: 200, month: 1, text: { contains: '공백지에 임의의 국가' } },
                ],
            },
        });
        await db.generalTurn.deleteMany({ where: { generalId: createdGeneralId } });
        await db.rankData.deleteMany({ where: { generalId: createdGeneralId } });
        await db.general.deleteMany({ where: { id: createdGeneralId } });
        await db.nationTurn.deleteMany({ where: { nationId: createdNationId } });
        await db.diplomacy.deleteMany({
            where: {
                OR: [{ srcNationId: createdNationId }, { destNationId: createdNationId }],
            },
        });
        await db.nation.deleteMany({ where: { id: { in: [createdNationId, existingNationId] } } });
        await db.city.deleteMany({ where: { id: { in: [occupiedCityId, targetCityId] } } });
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

    it('commits the nation, city, diplomacy, ruler, turns, ranks, and history in one flush', async () => {
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
        await createCity(occupiedCity);
        await createCity(targetCity);
        await db.nation.create({
            data: {
                id: existingNation.id,
                name: existingNation.name,
                color: existingNation.color,
                capitalCityId: existingNation.capitalCityId,
                chiefGeneralId: null,
                gold: existingNation.gold,
                rice: existingNation.rice,
                tech: 120,
                level: existingNation.level,
                typeCode: existingNation.typeCode,
                meta: existingNation.meta,
            },
        });
        const stateRow = await db.worldState.create({
            data: {
                scenarioCode: 'monthly-raise-npc-nation-persistence',
                currentYear: 199,
                currentMonth: 12,
                tickSeconds: 600,
                config: {},
                meta: {
                    hiddenSeed: 'raise-npc-nation-persistence',
                    lastGeneralId: createdGeneralId - 1,
                    lastNationId: createdNationId - 1,
                    serverId: 'raise-npc-nation-persistence',
                },
            },
        });
        const state: TurnWorldState = {
            id: stateRow.id,
            currentYear: 199,
            currentMonth: 12,
            tickSeconds: 600,
            lastTurnTime: new Date('0199-12-01T00:00:00.000Z'),
            meta: {
                hiddenSeed: 'raise-npc-nation-persistence',
                lastGeneralId: createdGeneralId - 1,
                lastNationId: createdNationId - 1,
                serverId: 'raise-npc-nation-persistence',
            },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 165, min: 15, max: 80, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 65 },
                iconPath: '.',
                map: {},
                const: {
                    retirementYear: 80,
                    availablePersonality: ['che_안전'],
                    randGenFirstName: ['가'],
                    randGenMiddleName: [''],
                    randGenLastName: ['나'],
                },
                environment: { mapName: 'test', unitSet: 'default' },
            },
            map,
            generals: [],
            cities: [occupiedCity, targetCity],
            nations: [existingNation],
            troops: [],
            diplomacy: [],
            events: [event],
            initialEvents: [],
        };
        const reservedTurns = new InMemoryReservedTurnStore(db, { maxGeneralTurns: 30, maxNationTurns: 12 });
        let world: InMemoryTurnWorld | null = null;
        const handler = createRaiseNpcNationHandler({
            getWorld: () => world,
            reservedTurns,
            env: buildCommandEnv(snapshot.scenarioConfig),
            map,
            loadArchivedNationMaxId: async () => 0,
        });
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: createMonthlyEventHandler({
                getWorld: () => world,
                startYear: 190,
                actions: new Map([['RaiseNPCNation', handler]]),
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
                name: 'ⓤNPC건국도시',
                capitalCityId: targetCityId,
                chiefGeneralId: createdGeneralId,
                gold: 0,
                rice: 2_000,
                tech: 120,
                level: 2,
            });
            expect(await db.city.findUniqueOrThrow({ where: { id: targetCityId } })).toMatchObject({
                nationId: createdNationId,
                trust: 100,
                population: occupiedCity.population,
                agriculture: occupiedCity.agriculture,
                commerce: occupiedCity.commerce,
                security: occupiedCity.security,
                defence: occupiedCity.defence,
                wall: occupiedCity.wall,
            });
            expect(await db.general.findUniqueOrThrow({ where: { id: createdGeneralId } })).toMatchObject({
                name: 'ⓤNPC건국도시태수',
                nationId: createdNationId,
                cityId: targetCityId,
                officerLevel: 12,
                npcState: 6,
            });
            expect(await db.generalTurn.count({ where: { generalId: createdGeneralId } })).toBe(30);
            expect(await db.nationTurn.count({ where: { nationId: createdNationId } })).toBe(48);
            expect(await db.rankData.count({ where: { generalId: createdGeneralId } })).toBe(44);
            expect(
                await db.diplomacy.count({
                    where: {
                        OR: [{ srcNationId: createdNationId }, { destNationId: createdNationId }],
                    },
                })
            ).toBe(2);
            expect(
                await db.logEntry.findFirst({
                    where: { year: 200, month: 1, text: { contains: '공백지에 임의의 국가' } },
                })
            ).not.toBeNull();
        } finally {
            await dbHooks.close();
            await db.worldState.delete({ where: { id: stateRow.id } });
        }
    });
});
