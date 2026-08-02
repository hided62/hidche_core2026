import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RANK_DATA_TYPES, rankDataMetaKey } from '@sammo-ts/common';
import { createGamePostgresConnector, type GamePrismaClient } from '@sammo-ts/infra';
import type { GeneralMeta } from '@sammo-ts/logic';

import { createDatabaseTurnHooks } from '../src/turn/databaseHooks.js';
import { InMemoryTurnWorld } from '../src/turn/inMemoryWorld.js';
import type { TurnGeneral, TurnWorldSnapshot, TurnWorldState } from '../src/turn/types.js';

const databaseUrl = process.env.INPUT_EVENT_DATABASE_URL;
const integration = describe.skipIf(!databaseUrl);
const worldId = 992_400;
const nationId = 992_400;
const cityId = 992_400;
const generalIds = Array.from({ length: 12 }, (_, index) => 992_401 + index);

const makeGeneral = (id: number): TurnGeneral => ({
    id,
    name: `랭킹감사${id}`,
    nationId,
    cityId,
    troopId: 0,
    stats: { leadership: 70, strength: 70, intelligence: 70 },
    turnTime: new Date('0190-01-01T00:10:00.000Z'),
    recentWarTime: null,
    role: {
        items: { horse: null, weapon: null, book: null, item: null },
        personality: null,
        specialDomestic: null,
        specialWar: null,
    },
    triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
    meta: { killturn: 24 },
    penalty: {},
    officerLevel: 1,
    experience: 0,
    dedication: 0,
    injury: 0,
    gold: 1_000,
    rice: 1_000,
    crew: 100,
    crewTypeId: 1,
    train: 100,
    atmos: 100,
    age: 30,
    npcState: 2,
});

integration('best-general rank persistence', () => {
    let db: GamePrismaClient;
    let closeDb: (() => Promise<void>) | undefined;

    const cleanup = async () => {
        await db.rankData.deleteMany({ where: { generalId: { in: generalIds } } });
        await db.general.deleteMany({ where: { id: { in: generalIds } } });
        await db.city.deleteMany({ where: { id: cityId } });
        await db.nation.deleteMany({ where: { id: nationId } });
        await db.worldState.deleteMany({ where: { id: worldId } });
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

    it('flushes every ranking field for twelve active NPCs and keeps the ordered top ten', async () => {
        await db.worldState.create({
            data: {
                id: worldId,
                scenarioCode: 'best-general-rank-persistence',
                currentYear: 190,
                currentMonth: 1,
                tickSeconds: 600,
                config: {},
                meta: {},
            },
        });
        await db.nation.create({
            data: {
                id: nationId,
                name: '랭킹감사국',
                color: '#330000',
                level: 1,
            },
        });
        await db.city.create({
            data: {
                id: cityId,
                name: '랭킹감사성',
                level: 5,
                nationId,
                population: 10_000,
                populationMax: 20_000,
                agriculture: 1_000,
                agricultureMax: 2_000,
                commerce: 1_000,
                commerceMax: 2_000,
                security: 1_000,
                securityMax: 2_000,
                defence: 1_000,
                defenceMax: 2_000,
                wall: 1_000,
                wallMax: 2_000,
                region: 1,
            },
        });
        const initialGenerals = generalIds.map(makeGeneral);
        await db.general.createMany({
            data: initialGenerals.map((general) => ({
                id: general.id,
                name: general.name,
                nationId,
                cityId,
                npcState: general.npcState,
                leadership: general.stats.leadership,
                strength: general.stats.strength,
                intel: general.stats.intelligence,
                turnTime: general.turnTime,
                meta: general.meta,
            })),
        });

        const state: TurnWorldState = {
            id: worldId,
            currentYear: 190,
            currentMonth: 1,
            tickSeconds: 600,
            lastTurnTime: new Date('0190-01-01T00:00:00.000Z'),
            meta: {},
        };
        const snapshot: TurnWorldSnapshot = {
            generals: initialGenerals,
            cities: [],
            nations: [],
            troops: [],
            diplomacy: [],
            events: [],
            initialEvents: [],
            map: {
                id: 'test',
                name: '랭킹 감사 지도',
                cities: [],
            },
            scenarioConfig: {
                stat: { total: 300, min: 10, max: 100, npcTotal: 150, npcMax: 50, npcMin: 10, chiefMin: 70 },
                iconPath: '',
                map: {},
                const: {},
                environment: { mapName: 'test', unitSet: 'test' },
            },
        };
        const world = new InMemoryTurnWorld(state, snapshot, {
            schedule: { entries: [{ startMinute: 0, tickMinutes: 10 }] },
        });
        for (const [index, generalId] of generalIds.entries()) {
            const value = index + 1;
            const meta: GeneralMeta = { killturn: 24 };
            for (const type of RANK_DATA_TYPES) {
                if (type !== 'experience' && type !== 'dedication') {
                    meta[rankDataMetaKey(type)] = value;
                }
            }
            world.updateGeneral(generalId, {
                experience: value,
                dedication: value,
                meta,
            });
        }

        const dbHooks = await createDatabaseTurnHooks(databaseUrl!, world);
        try {
            await dbHooks.hooks.flushChanges?.({
                lastTurnTime: state.lastTurnTime.toISOString(),
                processedGenerals: generalIds.length,
                processedTurns: generalIds.length,
                durationMs: 0,
                partial: false,
            });
        } finally {
            await dbHooks.close();
        }

        const rows = await db.rankData.findMany({
            where: { generalId: { in: generalIds } },
            orderBy: [{ type: 'asc' }, { value: 'desc' }, { generalId: 'asc' }],
        });
        expect(rows).toHaveLength(generalIds.length * RANK_DATA_TYPES.length);
        for (const type of RANK_DATA_TYPES) {
            const topTen = rows.filter((row) => row.type === type).slice(0, 10);
            expect(topTen.map((row) => row.value)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
            expect(topTen.map((row) => row.generalId)).toEqual(generalIds.slice(2).reverse());
        }

        const persistedGenerals = await db.general.findMany({
            where: { id: { in: generalIds } },
            orderBy: { experience: 'desc' },
            select: { id: true, experience: true, dedication: true, meta: true },
        });
        expect(persistedGenerals.slice(0, 10).map((general) => general.id)).toEqual(generalIds.slice(2).reverse());
    });
});
