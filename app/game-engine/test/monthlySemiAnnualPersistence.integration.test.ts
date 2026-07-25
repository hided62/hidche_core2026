import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { City, Nation } from '@sammo-ts/logic';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createProcessSemiAnnualHandler } from '../src/turn/monthlySemiAnnualAction.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const nationId = 990_071;
const generalId = 990_071;
const cityIds = [990_071, 990_072] as const;

const nation: Nation = {
    id: nationId,
    name: '반기저장국',
    color: '#777777',
    capitalCityId: cityIds[0],
    chiefGeneralId: generalId,
    gold: 100_001,
    rice: 7_777,
    power: 0,
    level: 1,
    typeCode: 'che_중립',
    meta: { rate: 20 },
};

const buildCity = (id: number, nationIdValue: number): City => ({
    id,
    name: `반기저장도시${id}`,
    nationId: nationIdValue,
    level: 1,
    state: 0,
    population: 10_000,
    populationMax: 50_000,
    agriculture: 1_001,
    agricultureMax: 5_000,
    commerce: 1_001,
    commerceMax: 5_000,
    security: 1_001,
    securityMax: 2_000,
    supplyState: 1,
    frontState: 0,
    defence: 1_001,
    defenceMax: 5_000,
    wall: 1_001,
    wallMax: 5_000,
    conflict: {},
    meta: { trust: 55, trade: 100, region: 1, dead: 123 },
});

const general: TurnGeneral = {
    id: generalId,
    name: '반기저장장수',
    nationId,
    cityId: cityIds[0],
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
    gold: 10_001,
    rice: 8_888,
    crew: 0,
    crewTypeId: 1_100,
    train: 0,
    atmos: 0,
    age: 20,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 1_000 },
    turnTime: new Date('0193-01-01T00:00:00.000Z'),
};

integration('monthly semi-annual database persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.general.deleteMany({ where: { id: generalId } });
        await db.city.deleteMany({ where: { id: { in: [...cityIds] } } });
        await db.nation.deleteMany({ where: { id: nationId } });
    });

    afterAll(async () => {
        await db.general.deleteMany({ where: { id: generalId } });
        await db.city.deleteMany({ where: { id: { in: [...cityIds] } } });
        await db.nation.deleteMany({ where: { id: nationId } });
        await closeDb?.();
    });

    it('persists population growth, neutral double decay, dead reset, and resource maintenance', async () => {
        await db.nation.create({
            data: {
                id: nation.id,
                name: nation.name,
                color: nation.color,
                capitalCityId: nation.capitalCityId,
                chiefGeneralId: nation.chiefGeneralId,
                gold: nation.gold,
                rice: nation.rice,
                tech: 0,
                level: nation.level,
                typeCode: nation.typeCode,
                meta: nation.meta,
            },
        });
        const cities = [buildCity(cityIds[0], nationId), buildCity(cityIds[1], 0)];
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
                conflict: {},
                meta: { dead: 123 },
            })),
        });
        await db.general.create({
            data: {
                id: general.id,
                name: general.name,
                nationId: general.nationId,
                cityId: general.cityId,
                troopId: general.troopId,
                npcState: general.npcState,
                leadership: general.stats.leadership,
                strength: general.stats.strength,
                intel: general.stats.intelligence,
                officerLevel: general.officerLevel,
                gold: general.gold,
                rice: general.rice,
                crewTypeId: general.crewTypeId,
                age: general.age,
                turnTime: general.turnTime,
                meta: general.meta,
            },
        });
        const row = await db.worldState.create({
            data: {
                scenarioCode: 'monthly-semi-annual-persistence',
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
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
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
            events: [],
            initialEvents: [],
        };
        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        });
        const dbHooks = await createDatabaseTurnHooks(databaseUrl!, world);

        try {
            const handler = createProcessSemiAnnualHandler({ getWorld: () => world });
            await handler(
                ['gold'],
                {
                    year: 193,
                    month: 1,
                    startyear: 190,
                    currentEventID: 1,
                    turnTime: state.lastTurnTime,
                },
                { id: 1, targetCode: 'month', priority: 0, condition: true, action: [], meta: {} }
            );
            await dbHooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            expect(await db.city.findUniqueOrThrow({ where: { id: cityIds[0] } })).toMatchObject({
                population: 15_525,
                agriculture: 991,
                commerce: 991,
                security: 991,
                defence: 991,
                wall: 991,
                trust: 55,
                meta: { dead: 0 },
            });
            expect(await db.city.findUniqueOrThrow({ where: { id: cityIds[1] } })).toMatchObject({
                population: 10_000,
                agriculture: 981,
                commerce: 981,
                security: 981,
                defence: 981,
                wall: 981,
                trust: 50,
                meta: { dead: 0 },
            });
            expect(await db.general.findUniqueOrThrow({ where: { id: generalId } })).toMatchObject({
                gold: 9_701,
                rice: 8_888,
            });
            expect(await db.nation.findUniqueOrThrow({ where: { id: nationId } })).toMatchObject({
                gold: 95_001,
                rice: 7_777,
                meta: { rate: 20 },
            });
        } finally {
            await dbHooks.close();
            await db.worldState.delete({ where: { id: row.id } });
        }
    });
});
