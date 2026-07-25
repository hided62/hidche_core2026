import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import type { City } from '@sammo-ts/logic';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { createRegisterNpcHandler } from '../src/turn/monthlyRegisterNpcAction.js';
import { InMemoryReservedTurnStore } from '../src/turn/reservedTurnStore.js';
import { buildCommandEnv } from '../src/turn/reservedTurnCommands.js';
import type { TurnEvent, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const cityId = 990_082;
const createdGeneralId = 990_082;

const city: City = {
    id: cityId,
    name: '등록NPC저장도시',
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
    action: [['RegNPC']],
    meta: {},
};

integration('RegNPC database persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const clean = async () => {
        await db.logEntry.deleteMany({
            where: {
                OR: [{ generalId: createdGeneralId }, { year: 200, month: 1, text: { contains: 'ⓝ저장장수' } }],
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

    it('commits the registered general, resting turns, ranks, and adult log atomically', async () => {
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
                scenarioCode: 'monthly-register-npc-persistence',
                currentYear: 200,
                currentMonth: 1,
                tickSeconds: 600,
                config: {},
                meta: { hiddenSeed: 'register-npc-persistence', lastGeneralId: createdGeneralId - 1 },
            },
        });
        const state: TurnWorldState = {
            id: stateRow.id,
            currentYear: 200,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('0200-01-01T00:00:00.000Z'),
            meta: { hiddenSeed: 'register-npc-persistence', lastGeneralId: createdGeneralId - 1 },
        };
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 165, min: 15, max: 80, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 65 },
                iconPath: '.',
                map: {},
                const: { retirementYear: 80, availablePersonality: ['che_안전'] },
                environment: { mapName: 'test', unitSet: 'default' },
            },
            scenarioMeta: {
                title: 'test',
                startYear: 190,
                life: null,
                fiction: null,
                history: [],
                ignoreDefaultEvents: false,
            },
            worldConfig: { fiction: 0, showImgLevel: 3 },
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
        const handler = createRegisterNpcHandler({
            actionName: 'RegNPC',
            getWorld: () => world,
            reservedTurns,
            env: buildCommandEnv(snapshot.scenarioConfig),
            worldConfig: snapshot.worldConfig,
        });
        const dbHooks = await createDatabaseTurnHooks(databaseUrl!, world, { reservedTurns });

        try {
            await handler(
                [77, '저장장수', 1001, 0, cityId, 60, 50, 40, 7, 186, 240, '유지', '인덕', '대사'],
                {
                    year: 200,
                    month: 1,
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
                name: 'ⓝ저장장수',
                nationId: 0,
                cityId,
                officerLevel: 0,
                npcState: 2,
                affinity: 77,
                bornYear: 186,
                deadYear: 240,
                picture: '1001.jpg',
                experience: 1_400,
                dedication: 1_400,
                personalCode: 'che_유지',
                specialCode: 'che_인덕',
            });
            const turns = await db.generalTurn.findMany({ where: { generalId: createdGeneralId } });
            expect(turns).toHaveLength(30);
            expect(new Set(turns.map((turn) => turn.actionCode))).toEqual(new Set(['휴식']));
            const ranks = await db.rankData.findMany({ where: { generalId: createdGeneralId } });
            expect(ranks).toHaveLength(44);
            expect(ranks.every((rank) => rank.nationId === 0 && rank.value === 0)).toBe(true);
            expect(
                await db.logEntry.findFirst({
                    where: { year: 200, month: 1, text: { contains: 'ⓝ저장장수' } },
                })
            ).toMatchObject({
                category: 'ACTION',
                text: expect.stringContaining('성인이 되어'),
            });
        } finally {
            await dbHooks.close();
            await db.worldState.delete({ where: { id: stateRow.id } });
        }
    });
});
