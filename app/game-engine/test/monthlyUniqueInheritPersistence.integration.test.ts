import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadActionModuleBundle, type Nation } from '@sammo-ts/logic';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import { loadTurnWorldFromDatabase } from '../src/turn/worldLoader.js';
import {
    createLostUniqueItemHandler,
    createMergeInheritPointRankHandler,
} from '../src/turn/monthlyUniqueInheritAction.js';
import type { TurnEvent, TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const nationId = 990_101;
const generalId = 990_101;

const event: TurnEvent = {
    id: 1,
    targetCode: 'month',
    priority: 9_000,
    condition: true,
    action: [],
    meta: {},
};

const nation: Nation = {
    id: nationId,
    name: '망실검증국',
    color: '#777777',
    capitalCityId: null,
    chiefGeneralId: null,
    gold: 0,
    rice: 0,
    power: 0,
    level: 2,
    typeCode: 'che_중립',
    meta: {},
};

const general: TurnGeneral = {
    id: generalId,
    userId: 'monthly-unique-user',
    name: '망실대상',
    nationId,
    cityId: 0,
    troopId: 0,
    stats: { leadership: 50, strength: 50, intelligence: 50 },
    experience: 0,
    dedication: 0,
    officerLevel: 1,
    role: {
        personality: null,
        specialDomestic: null,
        specialWar: null,
        items: {
            horse: 'che_명마_12_옥란백용구',
            weapon: 'che_무기_01_단도',
            book: null,
            item: 'che_저지_삼황내문',
        },
    },
    injury: 0,
    gold: 0,
    rice: 0,
    crew: 0,
    crewTypeId: 0,
    train: 0,
    atmos: 0,
    age: 30,
    startAge: 20,
    npcState: 0,
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: {
        killturn: 1,
        belong: 3,
        inherit_lived_month: 2,
        max_domestic_critical: 4,
        inherit_active_action: 5,
        dex1: 1000,
        dex2: 0,
        dex3: 0,
        dex4: 0,
        dex5: 0,
        rank_warnum: 2,
        firenum: 1,
        betwin: 2,
        betgold: 4000,
        betwingold: 2000,
        inherit_earned_act: 11,
        inherit_spent_dyn: 9,
    },
    inheritancePoints: {
        previous: 999,
        unifier: 6,
        tournament: 7,
    },
    lastTurn: { command: '휴식' },
    turnTime: new Date('2026-07-25T00:00:00.000Z'),
};

integration('monthly unique-item and inheritance-rank persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    beforeAll(async () => {
        const connector = createGamePostgresConnector({ url: databaseUrl! });
        await connector.connect();
        db = connector.prisma;
        closeDb = () => connector.disconnect();
        await db.logEntry.deleteMany({ where: { generalId } });
        await db.rankData.deleteMany({ where: { generalId } });
        await db.inheritancePoint.deleteMany({ where: { userId: general.userId! } });
        await db.general.deleteMany({ where: { id: generalId } });
        await db.nation.deleteMany({ where: { id: nationId } });
    });

    afterAll(async () => {
        await db.logEntry.deleteMany({ where: { generalId } });
        await db.rankData.deleteMany({ where: { generalId } });
        await db.inheritancePoint.deleteMany({ where: { userId: general.userId! } });
        await db.general.deleteMany({ where: { id: generalId } });
        await db.nation.deleteMany({ where: { id: nationId } });
        await closeDb?.();
    });

    it('commits removed item slots, item inventory, logs, and all merged rank columns', async () => {
        await db.nation.create({
            data: {
                id: nation.id,
                name: nation.name,
                color: nation.color,
                level: nation.level,
                typeCode: nation.typeCode,
                meta: {},
            },
        });
        await db.general.create({
            data: {
                id: general.id,
                userId: general.userId,
                name: general.name,
                nationId: general.nationId,
                cityId: general.cityId,
                leadership: general.stats.leadership,
                strength: general.stats.strength,
                intel: general.stats.intelligence,
                age: general.age,
                startAge: general.startAge,
                npcState: general.npcState,
                horseCode: general.role.items.horse ?? 'None',
                weaponCode: general.role.items.weapon ?? 'None',
                itemCode: general.role.items.item ?? 'None',
                turnTime: general.turnTime,
                meta: general.meta,
            },
        });
        await db.rankData.createMany({
            data: [
                { generalId, nationId, type: 'warnum', value: 2 },
                { generalId, nationId, type: 'firenum', value: 1 },
                { generalId, nationId, type: 'betwin', value: 2 },
                { generalId, nationId, type: 'betgold', value: 4000 },
                { generalId, nationId, type: 'betwingold', value: 2000 },
                { generalId, nationId, type: 'inherit_earned', value: 999 },
                { generalId, nationId, type: 'inherit_earned_act', value: 11 },
                { generalId, nationId, type: 'inherit_earned_dyn', value: 999 },
                { generalId, nationId, type: 'inherit_spent', value: 999 },
                { generalId, nationId, type: 'inherit_spent_dyn', value: 9 },
            ],
        });
        await db.inheritancePoint.createMany({
            data: Object.entries(general.inheritancePoints!).map(([key, value]) => ({
                userId: general.userId!,
                key,
                value,
            })),
        });
        const worldRow = await db.worldState.create({
            data: {
                scenarioCode: 'monthly-unique-inherit-persistence',
                currentYear: 210,
                currentMonth: 1,
                tickSeconds: 600,
                config: {
                    stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
                    iconPath: '.',
                    map: {},
                    const: {},
                    environment: { mapName: 'che', unitSet: 'che' },
                },
                meta: { hiddenSeed: 'monthly-unique-inherit-persistence' },
            },
        });
        const state: TurnWorldState = {
            id: worldRow.id,
            currentYear: 210,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: general.turnTime,
            meta: { hiddenSeed: 'monthly-unique-inherit-persistence' },
        };
        const loaded = await loadTurnWorldFromDatabase({ databaseUrl: databaseUrl! });
        const loadedGeneral = loaded.snapshot.generals.find((entry) => entry.id === generalId);
        expect(loadedGeneral?.meta).toEqual(
            expect.objectContaining({
                rank_warnum: 2,
                firenum: 1,
                betwin: 2,
                betgold: 4000,
                betwingold: 2000,
                inherit_earned_act: 11,
                inherit_spent_dyn: 9,
            })
        );
        expect(loadedGeneral?.inheritancePoints).toEqual(general.inheritancePoints);
        const snapshot: TurnWorldSnapshot = {
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 75, npcMin: 10, chiefMin: 70 },
                iconPath: '.',
                map: {},
                const: {},
                environment: { mapName: 'test', unitSet: 'default' },
            },
            map: { id: 'test', name: 'test', cities: [] },
            generals: [general],
            cities: [],
            nations: [nation],
            troops: [],
            diplomacy: [],
            events: [event],
            initialEvents: [],
        };
        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        });
        const hooks = await createDatabaseTurnHooks(databaseUrl!, world);
        const modules = (await loadActionModuleBundle()).itemModules;
        const environment = {
            year: 210,
            month: 1,
            startyear: 180,
            currentEventID: 1,
            turnTime: state.lastTurnTime,
        };

        try {
            await createLostUniqueItemHandler({ getWorld: () => world, itemModules: modules })([1], environment, event);
            await createMergeInheritPointRankHandler({ getWorld: () => world })([], environment, event);
            await hooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: 0,
                processedTurns: 2,
                durationMs: 0,
                partial: false,
            });

            const row = await db.general.findUniqueOrThrow({ where: { id: generalId } });
            expect(row).toMatchObject({
                horseCode: 'None',
                weaponCode: 'che_무기_01_단도',
                itemCode: 'None',
            });
            expect(row.meta).toHaveProperty('itemInventory');
            expect(
                await db.rankData.findMany({
                    where: {
                        generalId,
                        type: {
                            in: [
                                'inherit_earned',
                                'inherit_earned_act',
                                'inherit_earned_dyn',
                                'inherit_spent',
                                'inherit_spent_dyn',
                            ],
                        },
                    },
                    orderBy: { type: 'asc' },
                    select: { type: true, value: true },
                })
            ).toEqual([
                { type: 'inherit_earned', value: 111 },
                { type: 'inherit_earned_act', value: 11 },
                { type: 'inherit_earned_dyn', value: 100 },
                { type: 'inherit_spent', value: 9 },
                { type: 'inherit_spent_dyn', value: 9 },
            ]);
            expect(await db.logEntry.count({ where: { generalId } })).toBe(2);
        } finally {
            await hooks.close();
            await db.worldState.deleteMany({ where: { id: worldRow.id } });
        }
    });
});
