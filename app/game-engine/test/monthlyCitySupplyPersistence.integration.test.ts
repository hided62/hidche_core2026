import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { City, MapDefinition, Nation } from '@sammo-ts/logic';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createUpdateCitySupplyHandler } from '../src/turn/monthlyCitySupplyAction.js';
import { createMonthlyEventHandler, type MonthlyEventActionHandler } from '../src/turn/monthlyEventHandler.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const nationId = 990_051;
const cityIds = [990_051, 990_052, 990_053] as const;
const generalIds = [990_051, 990_052] as const;
const lostCityName = '고립저장성';

const stats = {
    population: 1_001,
    agriculture: 501,
    commerce: 499,
    security: 99,
    defence: 101,
    wall: 50,
};
const maxStats = {
    population: 2_000,
    agriculture: 1_000,
    commerce: 1_000,
    security: 1_000,
    defence: 1_000,
    wall: 1_000,
};
const map: MapDefinition = {
    id: 'city-supply-persistence',
    name: 'city-supply-persistence',
    cities: cityIds.map((id, index) => ({
        id,
        name: index === 2 ? lostCityName : `보급저장도시${index + 1}`,
        level: 1,
        region: 1,
        position: { x: index, y: 0 },
        connections: index === 0 ? [cityIds[1]] : index === 1 ? [cityIds[0]] : [],
        max: maxStats,
        initial: stats,
    })),
    defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
};

const buildCity = (id: number, trust: number): City => ({
    id,
    name: map.cities.find((city) => city.id === id)?.name ?? String(id),
    nationId,
    level: 1,
    state: 0,
    population: stats.population,
    populationMax: maxStats.population,
    agriculture: stats.agriculture,
    agricultureMax: maxStats.agriculture,
    commerce: stats.commerce,
    commerceMax: maxStats.commerce,
    security: stats.security,
    securityMax: maxStats.security,
    supplyState: 0,
    frontState: 2,
    defence: stats.defence,
    defenceMax: maxStats.defence,
    wall: stats.wall,
    wallMax: maxStats.wall,
    conflict: { 2: 3 },
    meta: { trust, trade: 100, region: 1, officer_set: 7, term: 2 },
});

const nation: Nation = {
    id: nationId,
    name: '보급저장국',
    color: '#000000',
    capitalCityId: cityIds[0],
    chiefGeneralId: null,
    gold: 1_000,
    rice: 1_000,
    power: 0,
    level: 1,
    typeCode: 'che_중립',
    meta: {},
};

const buildGeneral = (id: number, cityId: number): TurnGeneral => ({
    id,
    name: `보급장수${id}`,
    nationId,
    cityId,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    experience: 0,
    dedication: 0,
    officerLevel: 4,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 101,
    crewTypeId: 1100,
    train: 51,
    atmos: 99,
    age: 30,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24, officerCity: cityIds[2], officer_city: cityIds[2] },
    turnTime: new Date('0193-01-01T00:00:00.000Z'),
});

integration('monthly city supply database persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.logEntry.deleteMany({ where: { text: { contains: lostCityName } } });
        await db.general.deleteMany({ where: { id: { in: [...generalIds] } } });
        await db.city.deleteMany({ where: { id: { in: [...cityIds] } } });
        await db.nation.deleteMany({ where: { id: nationId } });
    });

    afterAll(async () => {
        await db.logEntry.deleteMany({ where: { text: { contains: lostCityName } } });
        await db.general.deleteMany({ where: { id: { in: [...generalIds] } } });
        await db.city.deleteMany({ where: { id: { in: [...cityIds] } } });
        await db.nation.deleteMany({ where: { id: nationId } });
        await closeDb?.();
    });

    it('persists supply damage, isolation, officer reset, and the pre-month log date', async () => {
        await db.nation.create({
            data: {
                id: nation.id,
                name: nation.name,
                color: nation.color,
                capitalCityId: nation.capitalCityId,
                chiefGeneralId: null,
                gold: nation.gold,
                rice: nation.rice,
                tech: nation.power,
                level: nation.level,
                typeCode: nation.typeCode,
                meta: {},
            },
        });
        const cities = [buildCity(cityIds[0], 50), buildCity(cityIds[1], 50), buildCity(cityIds[2], 33)];
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
                trust: city.meta.trust as number,
                trade: 100,
                defence: city.defence,
                defenceMax: city.defenceMax,
                wall: city.wall,
                wallMax: city.wallMax,
                region: 1,
                conflict: city.conflict ?? {},
                meta: { officer_set: 7, term: 2 },
            })),
        });
        const generals = [buildGeneral(generalIds[0], cityIds[2]), buildGeneral(generalIds[1], cityIds[0])];
        await db.general.createMany({
            data: generals.map((general) => ({
                id: general.id,
                name: general.name,
                nationId: general.nationId,
                cityId: general.cityId,
                troopId: general.troopId,
                npcState: general.npcState,
                leadership: general.stats.leadership,
                strength: general.stats.strength,
                intel: general.stats.intelligence,
                experience: general.experience,
                dedication: general.dedication,
                officerLevel: general.officerLevel,
                injury: general.injury,
                gold: general.gold,
                rice: general.rice,
                crew: general.crew,
                crewTypeId: general.crewTypeId,
                train: general.train,
                atmos: general.atmos,
                age: general.age,
                turnTime: general.turnTime,
                meta: general.meta,
            })),
        });
        const row = await db.worldState.create({
            data: {
                scenarioCode: 'city-supply-persistence',
                currentYear: 193,
                currentMonth: 1,
                tickSeconds: 600,
                config: {},
                meta: {},
            },
        });
        const state: TurnWorldState = {
            id: row.id,
            currentYear: 193,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('2026-07-25T00:10:00.000Z'),
            meta: {},
        };
        const actions = new Map<string, MonthlyEventActionHandler>();
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: map.id, unitSet: 'default' },
            },
            map,
            generals,
            cities,
            nations: [nation],
            troops: [],
            diplomacy: [],
            events: [
                {
                    id: 1,
                    targetCode: 'pre_month',
                    priority: 9_000,
                    condition: true,
                    action: [['UpdateCitySupply']],
                    meta: {},
                },
            ],
            initialEvents: [],
        };
        let world: InMemoryTurnWorld | null = null;
        const calendarHandler = createMonthlyEventHandler({ getWorld: () => world, startYear: 190, actions });
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler,
        });
        actions.set('UpdateCitySupply', createUpdateCitySupplyHandler({ getWorld: () => world, map }));
        const dbHooks = await createDatabaseTurnHooks(databaseUrl!, world);

        try {
            await world.advanceMonth(new Date('2026-07-25T00:20:00.000Z'));
            await dbHooks.hooks.flushChanges?.({
                lastTurnTime: world.getState().lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            expect(await db.city.findUniqueOrThrow({ where: { id: cityIds[0] } })).toMatchObject({
                nationId,
                supplyState: 1,
                population: 1_001,
            });
            expect(await db.city.findUniqueOrThrow({ where: { id: cityIds[2] } })).toMatchObject({
                nationId: 0,
                supplyState: 0,
                frontState: 0,
                population: 901,
                agriculture: 451,
                commerce: 449,
                security: 89,
                defence: 91,
                wall: 45,
                conflict: {},
                meta: { officer_set: 0, term: 0, state: 0 },
            });
            expect((await db.city.findUniqueOrThrow({ where: { id: cityIds[2] } })).trust).toBeCloseTo(29.7);
            expect(await db.general.findUniqueOrThrow({ where: { id: generalIds[0] } })).toMatchObject({
                officerLevel: 1,
                crew: 96,
                atmos: 94,
                train: 48,
                meta: { officerCity: 0, officer_city: 0 },
            });
            expect(await db.general.findUniqueOrThrow({ where: { id: generalIds[1] } })).toMatchObject({
                officerLevel: 1,
                crew: 101,
                atmos: 99,
                train: 51,
                meta: { officerCity: 0, officer_city: 0 },
            });
            expect(await db.logEntry.findFirstOrThrow({ where: { text: { contains: lostCityName } } })).toMatchObject({
                year: 193,
                month: 1,
                text: `<C>●</>193년 1월:<R><b>【고립】</b></><G><b>${lostCityName}</b></>이 보급이 끊겨 <R>미지배</> 도시가 되었습니다.`,
            });
        } finally {
            await dbHooks.close();
            await db.worldState.delete({ where: { id: row.id } });
        }
    });
});
