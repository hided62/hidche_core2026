import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import type { City } from '@sammo-ts/logic';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createCreateManyNpcHandler } from '../src/turn/monthlyCreateManyNpcAction.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';
import type { TurnEvent, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const cityId = 990_081;
const createdGeneralId = 990_081;

const city: City = {
    id: cityId,
    name: '다수NPC저장도시',
    nationId: 0,
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
    defence: 1_000,
    defenceMax: 2_000,
    wall: 1_000,
    wallMax: 2_000,
    meta: {},
};

const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 1_000,
    condition: true,
    action: [['CreateManyNPC', 1, 0]],
    meta: {},
};

integration('CreateManyNPC database persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const clean = async () => {
        await db.logEntry.deleteMany({
            where: {
                OR: [
                    { generalId: createdGeneralId },
                    {
                        text: '<C>●</>5월:<Y>ⓜ가가</>라는 장수가 <S>등장</>하였습니다.',
                        year: 193,
                        month: 5,
                    },
                    {
                        text: '<R>★</>193년 5월:장수 <C>1</>명이 <S>등장</>했습니다.',
                        year: 193,
                        month: 5,
                    },
                ],
            },
        });
        await db.generalTurn.deleteMany({ where: { generalId: createdGeneralId } });
        await db.rankData.deleteMany({ where: { generalId: createdGeneralId } });
        await db.general.deleteMany({ where: { id: createdGeneralId } });
        await db.city.deleteMany({ where: { id: cityId } });
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

    it('commits the general, 30 resting turns, zeroed canonical rank rows, and logs atomically', async () => {
        await db.city.create({
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
        const stateRow = await db.worldState.create({
            data: {
                scenarioCode: 'monthly-create-many-npc-persistence',
                currentYear: 193,
                currentMonth: 5,
                tickSeconds: 600,
                config: {},
                meta: { hiddenSeed: 'create-many-npc-persistence', lastGeneralId: createdGeneralId - 1 },
            },
        });
        const state: TurnWorldState = {
            id: stateRow.id,
            currentYear: 193,
            currentMonth: 5,
            tickSeconds: 600,
            lastTurnTime: new Date('0193-05-01T00:00:00.000Z'),
            meta: { hiddenSeed: 'create-many-npc-persistence', lastGeneralId: createdGeneralId - 1 },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 165, min: 15, max: 80, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 65 },
                iconPath: '',
                map: {},
                const: {
                    randGenFirstName: ['가'],
                    randGenMiddleName: [''],
                    randGenLastName: ['가'],
                    availablePersonality: ['che_안전'],
                },
                environment: { mapName: 'test', unitSet: 'default' },
            },
            map: {
                id: 'test',
                name: 'test',
                cities: [],
                defaults: { trust: 50, trade: 100, supplyState: 1, frontState: 0 },
            },
            generals: [],
            cities: [city],
            nations: [],
            troops: [],
            diplomacy: [],
            events: [event],
            initialEvents: [],
        };
        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        });
        const reservedTurns = new InMemoryReservedTurnStore(db, { maxGeneralTurns: 30, maxNationTurns: 12 });
        const handler = createCreateManyNpcHandler({
            getWorld: () => world,
            reservedTurns,
            env: buildCommandEnv(snapshot.scenarioConfig),
        });
        const dbHooks = await createDatabaseTurnHooks(databaseUrl!, world, { reservedTurns });

        try {
            await handler(
                [1, 0],
                {
                    year: 193,
                    month: 5,
                    startyear: 190,
                    currentEventID: 1,
                    turnTime: state.lastTurnTime,
                },
                event
            );
            await dbHooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 1,
                durationMs: 0,
                partial: false,
            });

            expect(await db.general.findUniqueOrThrow({ where: { id: createdGeneralId } })).toMatchObject({
                name: 'ⓜ가가',
                nationId: 0,
                cityId,
                npcState: 3,
                affinity: expect.any(Number),
                bornYear: expect.any(Number),
                deadYear: expect.any(Number),
                picture: 'default.jpg',
                experience: expect.any(Number),
                dedication: expect.any(Number),
                personalCode: 'che_안전',
            });
            const turns = await db.generalTurn.findMany({
                where: { generalId: createdGeneralId },
                orderBy: { turnIdx: 'asc' },
            });
            expect(turns).toHaveLength(30);
            expect(new Set(turns.map((turn) => turn.actionCode))).toEqual(new Set(['휴식']));
            const ranks = await db.rankData.findMany({ where: { generalId: createdGeneralId } });
            // Legacy inserts 37 RankColumn rows. Core's canonical rank model
            // additionally projects experience/dedication/dex, so it owns 41.
            expect(ranks).toHaveLength(41);
            expect(ranks.every((rank) => rank.nationId === 0 && rank.value === 0)).toBe(true);
            expect(
                await db.logEntry.findMany({
                    where: {
                        year: 193,
                        month: 5,
                        text: {
                            in: [
                                '<C>●</>5월:<Y>ⓜ가가</>라는 장수가 <S>등장</>하였습니다.',
                                '<R>★</>193년 5월:장수 <C>1</>명이 <S>등장</>했습니다.',
                            ],
                        },
                    },
                    orderBy: { id: 'asc' },
                })
            ).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ category: 'ACTION', text: expect.stringContaining('장수가') }),
                    expect.objectContaining({ category: 'HISTORY', text: expect.stringContaining('장수 <C>1</>명') }),
                ])
            );
        } finally {
            await dbHooks.close();
            await db.worldState.delete({ where: { id: stateRow.id } });
        }
    });
});
