import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrisma, type GamePrismaClient } from '@sammo-ts/infra';
import type { City, Nation } from '@sammo-ts/logic';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createMonthlyWanderHandler } from '../src/turn/monthlyWanderHandler.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const nationIds = [993_101, 993_104];
const generalIds = [993_101, 993_102, 993_103];
const cityIds = [993_101, 993_102];
const scenarioCode = 'monthly-wander-persistence';
const serverId = 'monthly-wander-test';

const buildGeneral = (options: {
    id: number;
    name: string;
    nationId: number;
    cityId: number;
    officerLevel: number;
    npcState: number;
    gold: number;
    rice: number;
    belong: number;
    permission?: string;
    turnTime: Date;
}): TurnGeneral => ({
    id: options.id,
    name: options.name,
    nationId: options.nationId,
    cityId: options.cityId,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    experience: 0,
    dedication: 0,
    officerLevel: options.officerLevel,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: { horse: null, weapon: null, book: null, item: null },
    },
    injury: 0,
    gold: options.gold,
    rice: options.rice,
    crew: 100,
    crewTypeId: 1100,
    train: 0,
    atmos: 0,
    age: 20,
    npcState: options.npcState,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 0, makelimit: 0, belong: options.belong, permission: options.permission ?? 'normal' },
    turnTime: options.turnTime,
});

const buildNation = (id: number, name: string, level: number, generalCount: number): Nation => ({
    id,
    name,
    color: '#777777',
    capitalCityId: null,
    chiefGeneralId: null,
    gold: 0,
    rice: 0,
    power: 0,
    level,
    typeCode: 'che_중립',
    meta: { gennum: generalCount },
});

const buildCity = (id: number, name: string, nationId: number): City => ({
    id,
    name,
    nationId,
    level: 4,
    state: 0,
    population: 1_000,
    populationMax: 2_000,
    agriculture: 100,
    agricultureMax: 200,
    commerce: 100,
    commerceMax: 200,
    security: 100,
    securityMax: 200,
    supplyState: 1,
    frontState: 1,
    defence: 100,
    defenceMax: 200,
    wall: 100,
    wallMax: 200,
    conflict: {},
    meta: {},
});

integration('monthly wandering nation persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const cleanup = async (): Promise<void> => {
        await db.diplomacy.deleteMany({
            where: {
                OR: [{ srcNationId: { in: nationIds } }, { destNationId: { in: nationIds } }],
            },
        });
        await db.rankData.deleteMany({ where: { generalId: { in: generalIds } } });
        await db.logEntry.deleteMany({
            where: {
                OR: [
                    { generalId: { in: generalIds } },
                    { text: { contains: '방랑국' } },
                    { text: { contains: '방랑주' } },
                ],
            },
        });
        await db.general.deleteMany({ where: { id: { in: generalIds } } });
        await db.city.deleteMany({ where: { id: { in: cityIds } } });
        await db.nation.deleteMany({ where: { id: { in: nationIds } } });
        await db.oldNation.deleteMany({ where: { serverId, nation: nationIds[1] } });
        await db.worldState.deleteMany({ where: { scenarioCode } });
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

    it('commits detachments, legacy resource bug, logs, and old-nation archive atomically', async () => {
        const scenarioConfig: TurnWorldSnapshot['scenarioConfig'] = {
            stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
            iconPath: '',
            map: {},
            const: { baseGold: 1_000, baseRice: 1_000 },
            environment: { mapName: 'test', unitSet: 'default' },
        };
        const nations = [buildNation(nationIds[0]!, '존속국', 1, 1), buildNation(nationIds[1]!, '방랑국', 0, 2)];
        const generals = [
            buildGeneral({
                id: generalIds[0]!,
                name: '방랑주',
                nationId: nationIds[1]!,
                cityId: cityIds[0]!,
                officerLevel: 12,
                npcState: 2,
                gold: 2_000,
                rice: 3_000,
                belong: 7,
                permission: 'ambassador',
                turnTime: new Date('0195-02-01T12:28:00.000Z'),
            }),
            buildGeneral({
                id: generalIds[1]!,
                name: '방랑객',
                nationId: nationIds[1]!,
                cityId: cityIds[0]!,
                officerLevel: 1,
                npcState: 0,
                gold: 1_500,
                rice: 4_000,
                belong: 5,
                permission: 'auditor',
                turnTime: new Date('0195-02-01T12:53:00.000Z'),
            }),
            buildGeneral({
                id: generalIds[2]!,
                name: '존속장',
                nationId: nationIds[0]!,
                cityId: cityIds[1]!,
                officerLevel: 12,
                npcState: 2,
                gold: 500,
                rice: 500,
                belong: 1,
                turnTime: new Date('0195-02-01T13:21:00.000Z'),
            }),
        ];
        const cities = [
            buildCity(cityIds[0]!, '방랑성', nationIds[1]!),
            buildCity(cityIds[1]!, '존속성', nationIds[0]!),
        ];
        await db.nation.createMany({
            data: nations.map((nation) => ({
                id: nation.id,
                name: nation.name,
                color: nation.color,
                gold: 0,
                rice: 0,
                tech: 0,
                level: nation.level,
                typeCode: nation.typeCode,
                meta: nation.meta,
            })),
        });
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
                defence: city.defence,
                defenceMax: city.defenceMax,
                wall: city.wall,
                wallMax: city.wallMax,
                region: 1,
            })),
        });
        await db.general.createMany({
            data: generals.map((general) => ({
                id: general.id,
                name: general.name,
                nationId: general.nationId,
                cityId: general.cityId,
                officerLevel: general.officerLevel,
                npcState: general.npcState,
                gold: general.gold,
                rice: general.rice,
                crew: general.crew,
                turnTime: general.turnTime,
                meta: general.meta,
            })),
        });
        await db.diplomacy.createMany({
            data: [
                {
                    srcNationId: nationIds[0]!,
                    destNationId: nationIds[1]!,
                    stateCode: 2,
                    term: 0,
                    meta: { dead: 0 },
                },
                {
                    srcNationId: nationIds[1]!,
                    destNationId: nationIds[0]!,
                    stateCode: 2,
                    term: 0,
                    meta: { dead: 0 },
                },
            ],
        });
        const worldRow = await db.worldState.create({
            data: {
                scenarioCode,
                currentYear: 195,
                currentMonth: 1,
                tickSeconds: 600,
                config: scenarioConfig as unknown as GamePrisma.InputJsonValue,
                meta: { serverId },
            },
        });
        const state: TurnWorldState = {
            id: worldRow.id,
            currentYear: 195,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('0195-01-01T00:00:00.000Z'),
            meta: { serverId },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig,
            scenarioMeta: {
                title: 'test',
                startYear: 193,
                life: null,
                fiction: null,
                history: [],
                ignoreDefaultEvents: false,
            },
            map: { id: 'test', name: 'test', cities: [] },
            diplomacy: [
                { fromNationId: nationIds[0]!, toNationId: nationIds[1]!, state: 2, term: 0, dead: 0, meta: {} },
                { fromNationId: nationIds[1]!, toNationId: nationIds[0]!, state: 2, term: 0, dead: 0, meta: {} },
            ],
            events: [],
            initialEvents: [],
            generals,
            cities,
            nations,
            troops: [],
        };
        let world: InMemoryTurnWorld | null = null;
        world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
            calendarHandler: createMonthlyWanderHandler({
                getWorld: () => world,
                startYear: 193,
                commandEnv: buildCommandEnv(scenarioConfig),
            }),
        });
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        try {
            await world.advanceMonth(new Date('0195-02-01T00:00:00.000Z'));
            await hooks.hooks.flushChanges?.({
                lastTurnTime: '0195-02-01T00:00:00.000Z',
                processedGenerals: 0,
                processedTurns: 0,
                durationMs: 0,
                partial: false,
            });

            expect(await db.nation.findUnique({ where: { id: nationIds[1]! } })).toBeNull();
            expect(
                await db.general.findMany({
                    where: { id: { in: generalIds.slice(0, 2) } },
                    orderBy: { id: 'asc' },
                    select: {
                        nationId: true,
                        officerLevel: true,
                        gold: true,
                        rice: true,
                        lastTurn: true,
                        meta: true,
                    },
                })
            ).toEqual([
                expect.objectContaining({
                    nationId: 0,
                    officerLevel: 0,
                    gold: 1_000,
                    rice: 1_000,
                    lastTurn: { command: '해산', arg: {} },
                    meta: expect.objectContaining({ belong: 0, makelimit: 12, permission: 'normal' }),
                }),
                expect.objectContaining({
                    nationId: 0,
                    officerLevel: 0,
                    gold: 1_000,
                    rice: 4_000,
                    meta: expect.objectContaining({ belong: 0, max_belong: 5, permission: 'normal' }),
                }),
            ]);
            expect(await db.city.findUniqueOrThrow({ where: { id: cityIds[0]! } })).toMatchObject({
                nationId: 0,
                frontState: 0,
            });
            expect(
                await db.diplomacy.count({
                    where: {
                        OR: [{ srcNationId: nationIds[1]! }, { destNationId: nationIds[1]! }],
                    },
                })
            ).toBe(0);
            const archive = await db.oldNation.findUniqueOrThrow({
                where: { serverId_nation: { serverId, nation: nationIds[1]! } },
            });
            expect(archive.data).toMatchObject({
                nation: nationIds[1],
                name: '방랑국',
                generals: generalIds.slice(0, 2),
            });
            const logs = await db.logEntry.findMany({
                where: {
                    OR: [
                        { generalId: { in: generalIds.slice(0, 2) } },
                        { text: { contains: '방랑국' } },
                        { text: { contains: '방랑주' } },
                    ],
                },
                orderBy: { id: 'asc' },
                select: { scope: true, category: true, generalId: true, year: true, month: true, text: true },
            });
            expect(logs).toEqual([
                {
                    scope: 'SYSTEM',
                    category: 'HISTORY',
                    generalId: null,
                    year: 195,
                    month: 2,
                    text: '<C>●</>195년 2월:<R><b>【멸망】</b></><D><b>방랑국</b></>은 <R>멸망</>했습니다.',
                },
                {
                    scope: 'GENERAL',
                    category: 'HISTORY',
                    generalId: generalIds[1],
                    year: 195,
                    month: 2,
                    text: '<C>●</>195년 2월:<D><b>방랑국</b></>이 <R>멸망</>',
                },
                {
                    scope: 'GENERAL',
                    category: 'ACTION',
                    generalId: generalIds[1],
                    year: 195,
                    month: 2,
                    text: '<C>●</><D><b>방랑국</b></>이 <R>멸망</>했습니다.',
                },
                {
                    scope: 'GENERAL',
                    category: 'HISTORY',
                    generalId: generalIds[0],
                    year: 195,
                    month: 2,
                    text: '<C>●</>195년 2월:<D><b>방랑국</b></>을 해산',
                },
                {
                    scope: 'GENERAL',
                    category: 'HISTORY',
                    generalId: generalIds[0],
                    year: 195,
                    month: 2,
                    text: '<C>●</>195년 2월:<D><b>방랑국</b></>이 <R>멸망</>',
                },
                {
                    scope: 'GENERAL',
                    category: 'ACTION',
                    generalId: generalIds[0],
                    year: 195,
                    month: 2,
                    text: '<C>●</>초반 제한후 방랑군은 자동 해산됩니다.',
                },
                {
                    scope: 'GENERAL',
                    category: 'ACTION',
                    generalId: generalIds[0],
                    year: 195,
                    month: 2,
                    text: '<C>●</>2월:세력을 해산했습니다. <1>12:28</>',
                },
                {
                    scope: 'GENERAL',
                    category: 'ACTION',
                    generalId: generalIds[0],
                    year: 195,
                    month: 2,
                    text: '<C>●</><D><b>방랑국</b></>이 <R>멸망</>했습니다.',
                },
                {
                    scope: 'SYSTEM',
                    category: 'SUMMARY',
                    generalId: null,
                    year: 195,
                    month: 2,
                    text: '<C>●</>2월:<Y>방랑주</>가 세력을 해산했습니다.',
                },
            ]);
        } finally {
            await hooks.close();
        }
    });
});
